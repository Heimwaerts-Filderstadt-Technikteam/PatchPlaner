// 3D-Ansicht: Ebenen in echter Höhe, Grundrisse, hochgezogene Wände, Podeste, Geräte in Montagehöhe,
// Kabel mit allen senkrechten Stücken und Steigleitungen. Klick auf zwei Geräte verbindet sie.
// three.js liegt lokal unter /vendor/three, damit es auch ohne Internet läuft.
import { esc, download } from './ui.js';

const loadScript = (src) => new Promise((res, rej) => {
  if ([...document.scripts].some(s => s.src.endsWith(src))) { res(); return; }
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Datei fehlt: ' + src)); document.head.appendChild(s);
});
async function ensureThree() {
  if (!window.THREE) await loadScript('/vendor/three/three.min.js');
  if (!window.THREE.OrbitControls) await loadScript('/vendor/three/OrbitControls.js');
  return window.THREE;
}

export async function open3D(scene, opts = {}) {
  const T = await ensureThree();
  const fileBase = opts.fileBase || 'plan', fmt = opts.fmt || ((v) => v.toFixed(2) + ' m');
  const css = getComputedStyle(document.documentElement);
  const cssv = (n, d) => (css.getPropertyValue(n).trim() || d);
  const bg = cssv('--canvas', scene.dark ? '#0d1013' : '#dfe3e7');
  const fg = cssv('--fg', scene.dark ? '#e3e7eb' : '#1a2026');
  const ACC = cssv('--accent', '#f0b21c');

  const st = { ex: 1, floors: true, walls: true, labels: true, hidden: new Set(), sel: null };

  const ov = document.createElement('div');
  ov.className = 'v3d';
  ov.innerHTML = `
    <div class="v3d-top">
      <div class="v3d-title"><b>3D-Ansicht</b><span>${esc(scene.title)}</span></div>
      <div class="v3d-tools">
        <div class="v3d-lv" id="v3Lv"></div>
        <label class="v3d-range" title="Ebenen zum besseren Hineinsehen auseinanderziehen">Abstand <input type="range" id="v3Gap" min="1" max="4" step="0.1" value="1"></label>
        <label class="chk"><input type="checkbox" id="v3Floors" checked> Grundrisse</label>
        <label class="chk"><input type="checkbox" id="v3Walls" checked> Wände</label>
        <label class="chk"><input type="checkbox" id="v3Labels" checked> Beschriftung</label>
        <div class="grp"><button id="v3Top">Draufsicht</button><button id="v3Reset">Schräg</button><button id="v3Png">Als Bild</button></div>
        <button class="btn pri" id="v3Close">Schließen</button>
      </div>
    </div>
    <div class="v3d-stage">
      <div class="v3d-info" id="v3Info" hidden></div>
      <div class="v3d-hint">${scene.readonly ? '' : '<b>Verbinden:</b> Gerät anklicken, dann das zweite Gerät – auch auf einer anderen Ebene · '}Ziehen: drehen · Rechte Maustaste/Shift: verschieben · Mausrad: zoomen</div>
    </div>`;
  document.body.appendChild(ov);
  const stage = ov.querySelector('.v3d-stage'), info = ov.querySelector('#v3Info');
  const q = (s) => ov.querySelector(s);

  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(new T.Color(bg));
  stage.prepend(renderer.domElement);
  const s3 = new T.Scene();
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 5000);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  s3.add(new T.AmbientLight(0xffffff, 0.72));
  const sun = new T.DirectionalLight(0xffffff, 0.6); sun.position.set(30, 60, 20); s3.add(sun);
  const world = new T.Group(); s3.add(world);

  const texCache = new Map(), wallCache = new Map();
  let bag = [], picks = [], labels = [], floorMeshes = [], wallMeshes = [], token = 0;
  const keep = (o) => { bag.push(o); return o; };

  // Koordinaten: Plan (Welt-Einheiten) → Meter, zentriert
  let U, cx, cy, span, X, Z, baseY, elev, Y;
  function frame() {
    U = scene.U;
    const xs = [], ys = [];
    scene.floors.forEach(f => { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.h); });
    scene.items.forEach(i => { xs.push(i.x + i.w / 2); ys.push(i.y + i.h / 2); });
    scene.cables.forEach(c => c.pts.forEach(p => { xs.push(p.x); ys.push(p.y); }));
    if (!xs.length) { xs.push(0, 20 * U); ys.push(0, 12 * U); }
    if (xs.length === 1) { xs.push(xs[0] + 10 * U); ys.push(ys[0] + 6 * U); }
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / U;
    X = (x) => (x - cx) / U; Z = (y) => (y - cy) / U;
    // Ebenen mit gleicher Fußbodenhöhe trotzdem übereinanderstapeln
    baseY = {}; elev = {}; let last = -Infinity, lastH = 3;
    [...scene.levels].sort((a, b) => a.elev - b.elev).forEach(l => { let y = l.elev; if (y < last + 0.5) y = last + lastH; baseY[l.id] = y; elev[l.id] = l.elev; last = y; lastH = l.height || 3; });
    Y = (lv, abs) => baseY[lv] * st.ex + (abs - elev[lv]);
  }

  function label(text, { size = 0.42, color = fg, bgc = null } = {}) {
    const fs = 64, pad = 18;
    const cv = document.createElement('canvas'); const c = cv.getContext('2d');
    const font = `600 ${fs}px "Barlow Condensed", "IBM Plex Sans", Arial, sans-serif`;
    c.font = font;
    const w = Math.ceil(c.measureText(text).width) + pad * 2, h = fs + pad;
    cv.width = w; cv.height = h; c.font = font;
    if (bgc) { c.fillStyle = bgc; c.beginPath(); c.roundRect ? c.roundRect(0, 0, w, h, 14) : c.rect(0, 0, w, h); c.fill(); }
    c.fillStyle = color; c.textBaseline = 'middle'; c.fillText(text, pad, h / 2 + 2);
    const tex = keep(new T.CanvasTexture(cv)); tex.anisotropy = 4;
    const sp = new T.Sprite(keep(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true })));
    sp.scale.set(size * w / h, size, 1); sp.renderOrder = 10; sp.visible = st.labels;
    labels.push(sp);
    return sp;
  }
  function floorTexture(f) {
    const key = f.url + '|' + scene.dark;
    if (!texCache.has(key)) texCache.set(key, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = f.url; }).then(img => {
      const big = 2048, nw = img.naturalWidth || f.aw, nh = img.naturalHeight || f.ah;
      const k = f.vector ? big / Math.max(nw, nh) : Math.min(1, big / Math.max(nw, nh));
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(nw * k)); cv.height = Math.max(1, Math.round(nh * k));
      const c = cv.getContext('2d'); c.drawImage(img, 0, 0, cv.width, cv.height);
      if (scene.dark) { const d = c.getImageData(0, 0, cv.width, cv.height); const a = d.data; for (let i = 0; i < a.length; i += 4) { a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; } c.putImageData(d, 0, 0); }
      const tex = new T.CanvasTexture(cv); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }));
    return texCache.get(key).then(base => { const t = base.clone(); t.needsUpdate = true; t.repeat.set(f.crop.w / f.aw, f.crop.h / f.ah); t.offset.set(f.crop.x / f.aw, 1 - (f.crop.y + f.crop.h) / f.ah); return keep(t); });
  }
  // Wände aus einem Vektor-Grundriss („Nur Wände und Fenster“) lesen
  function floorWalls(f) {
    if (!wallCache.has(f.url)) wallCache.set(f.url, fetch(f.url, { credentials: 'same-origin' }).then(r => r.text()).then(txt => {
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml'); const out = [];
      doc.querySelectorAll('path').forEach(p => {
        const subs = []; let cur = null;
        (p.getAttribute('d') || '').replace(/([MLZ])([^MLZ]*)/gi, (m, cmd, args) => {
          if (cmd === 'Z' || cmd === 'z') { if (cur) cur.closed = true; return m; }
          if (cmd === 'M' || cmd === 'm') { cur = { pts: [], closed: false }; subs.push(cur); }
          const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
          for (let i = 0; i + 1 < n.length; i += 2) cur && cur.pts.push([n[i], n[i + 1]]);
          return m;
        });
        out.push({ k: p.getAttribute('data-k') || 'w', fill: (p.getAttribute('fill') || 'none') !== 'none', sw: +p.getAttribute('stroke-width') || 0, subs });
      });
      return out;
    }).catch(() => []));
    return wallCache.get(f.url);
  }

  const mat = {};
  function materials() {
    mat.wall = keep(new T.MeshLambertMaterial({ color: scene.dark ? 0x6b7681 : 0xd2d8de, transparent: true, opacity: 0.82 }));
    mat.glass = keep(new T.MeshLambertMaterial({ color: 0x5aa0e8, transparent: true, opacity: 0.35, depthWrite: false }));
    mat.shaft = keep(new T.MeshBasicMaterial({ color: new T.Color(ACC), transparent: true, opacity: 0.16, depthWrite: false }));
    mat.edge = keep(new T.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    mat.selEdge = keep(new T.LineBasicMaterial({ color: new T.Color(ACC) }));
  }

  function build() {
    const my = ++token;
    bag.forEach(o => { try { o.dispose(); } catch { /* egal */ } }); bag = [];
    world.clear(); picks = []; labels = []; floorMeshes = []; wallMeshes = [];
    frame(); materials();
    const LS = Math.max(0.42, span / 55);
    const box = {};
    scene.items.forEach(i => { box[i.id] = { x: X(i.x + i.w / 2), z: Z(i.y + i.h / 2), w: Math.max(0.05, i.real.w), d: Math.max(0.05, i.real.d), h: Math.max(0.05, i.real.h) }; });

    for (const l of scene.levels) {
      if (st.hidden.has(l.id)) continue;
      const root = new T.Group(); world.add(root);
      const fl = scene.floors.filter(f => f.lv === l.id), it = scene.items.filter(i => i.lv === l.id);
      const y0 = Y(l.id, l.elev);
      // Bodenplatte
      const bx = [], by = [];
      fl.forEach(f => { bx.push(f.x, f.x + f.w); by.push(f.y, f.y + f.h); });
      it.forEach(i => { bx.push(i.x + i.w / 2 - U, i.x + i.w / 2 + U); by.push(i.y + i.h / 2 - U, i.y + i.h / 2 + U); });
      if (bx.length) {
        const x1 = Math.min(...bx), x2 = Math.max(...bx), y1 = Math.min(...by), y2 = Math.max(...by);
        const pg = keep(new T.PlaneGeometry((x2 - x1) / U, (y2 - y1) / U));
        const slab = new T.Mesh(pg, keep(new T.MeshBasicMaterial({ color: scene.dark ? 0xffffff : 0x1a2026, transparent: true, opacity: 0.045, side: T.DoubleSide, depthWrite: false })));
        slab.rotation.x = -Math.PI / 2; slab.position.set(X((x1 + x2) / 2), y0 - 0.01, Z((y1 + y2) / 2)); root.add(slab);
        const edge = new T.LineSegments(keep(new T.EdgesGeometry(pg)), keep(new T.LineBasicMaterial({ color: scene.dark ? 0x8893a0 : 0x5a646e, transparent: true, opacity: 0.6 })));
        edge.rotation.x = -Math.PI / 2; edge.position.copy(slab.position); root.add(edge);
        const lb = label(`${l.name} · ${fmt(l.elev)}`, { size: LS * 1.6, color: '#1a2026', bgc: ACC }); lb.position.set(X(x1) - LS * 0.5, y0, Z(y2) + LS * 0.5); lb.center.set(1, 0); root.add(lb);
      }
      // Grundrisse und hochgezogene Wände
      for (const f of fl) {
        const g = keep(new T.PlaneGeometry(f.w / U, f.h / U));
        const m = keep(new T.MeshBasicMaterial({ transparent: true, opacity: f.opacity, side: T.DoubleSide, depthWrite: false, color: 0xffffff }));
        const mesh = new T.Mesh(g, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(f.x + f.w / 2), y0 + 0.004, Z(f.y + f.h / 2)); mesh.renderOrder = 1; mesh.visible = st.floors;
        root.add(mesh); floorMeshes.push(mesh);
        floorTexture(f).then(tex => { if (my !== token) return; m.map = tex; m.needsUpdate = true; draw(); }).catch(() => {});
        if (f.vector) floorWalls(f).then(paths => { if (my !== token) return; addWalls(root, f, paths, y0, l.height || 3); draw(); });
      }
      // Bereiche: Podest als Block, Name darauf
      for (const z of scene.zones.filter(qq => qq.lv === l.id)) {
        const col = new T.Color(z.color);
        if (z.zf > 0.01) {
          const g = keep(new T.BoxGeometry(z.w / U, z.zf, z.h / U));
          const mesh = new T.Mesh(g, keep(new T.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.38 })));
          mesh.position.set(X(z.x + z.w / 2), y0 + z.zf / 2, Z(z.y + z.h / 2)); root.add(mesh);
          const e = new T.LineSegments(keep(new T.EdgesGeometry(g)), keep(new T.LineBasicMaterial({ color: col }))); e.position.copy(mesh.position); root.add(e);
        } else {
          const g = keep(new T.PlaneGeometry(z.w / U, z.h / U));
          const mesh = new T.Mesh(g, keep(new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, side: T.DoubleSide, depthWrite: false })));
          mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(z.x + z.w / 2), y0 + 0.02, Z(z.y + z.h / 2)); root.add(mesh);
        }
        if (z.label) { const lb = label(z.label + (z.zf ? ` +${fmt(z.zf)}` : ''), { size: LS * 1.1, color: '#fff', bgc: z.color }); lb.position.set(X(z.x) + 0.1, y0 + z.zf + 0.3, Z(z.y)); lb.center.set(0, 0); root.add(lb); }
      }
      // Geräte in Montagehöhe (gestrichelte Linie zum Boden, wenn sie höher hängen)
      for (const i of it) {
        const bb = box[i.id], yb = Y(l.id, i.z);
        const g = keep(new T.BoxGeometry(bb.w, bb.h, bb.d));
        const sel = st.sel && st.sel.kind === 'item' && st.sel.id === i.id;
        const mesh = new T.Mesh(g, keep(new T.MeshLambertMaterial({ color: new T.Color(i.color), emissive: sel ? new T.Color(ACC) : new T.Color(0x000000), emissiveIntensity: sel ? 0.45 : 0 })));
        mesh.position.set(bb.x, yb + bb.h / 2, bb.z); mesh.userData = { kind: 'item', id: i.id }; root.add(mesh); picks.push(mesh);
        const e = new T.LineSegments(keep(new T.EdgesGeometry(g)), sel ? mat.selEdge : mat.edge); e.position.copy(mesh.position); root.add(e);
        if (i.mount > 0.15) {
          const yf = Y(l.id, i.floor);
          const lg = keep(new T.BufferGeometry().setFromPoints([new T.Vector3(bb.x, yf, bb.z), new T.Vector3(bb.x, yb, bb.z)]));
          const line = new T.Line(lg, keep(new T.LineDashedMaterial({ color: scene.dark ? 0xaab4be : 0x5a646e, dashSize: 0.15, gapSize: 0.1 }))); line.computeLineDistances(); root.add(line);
        }
        const lb = label(i.name, { size: LS, color: sel ? '#1a2026' : fg, bgc: sel ? ACC : scene.dark ? 'rgba(20,24,28,.85)' : 'rgba(255,255,255,.9)' }); lb.position.set(bb.x, yb + bb.h + LS * 0.9, bb.z); root.add(lb);
      }
    }
    // Kabel: Gerät → senkrecht zum Kabelweg → Trasse → (Steigleitung) → senkrecht zum Gerät
    const rad = Math.max(0.035, span / 800);
    scene.cables.forEach((c, n) => {
      if (st.hidden.has(c.lvA) && st.hidden.has(c.lvB)) return;
      const A = box[c.from], B = box[c.to]; if (!A || !B) return;
      const off = 0.05 + (n % 6) * 0.03;
      const yA = (abs) => Y(c.lvA, abs), yB = (abs) => Y(c.lvB, abs);
      const sel = st.sel && st.sel.kind === 'cable' && st.sel.id === c.id;
      const color = new T.Color(c.color);
      if (c.radio) {
        const g = keep(new T.BufferGeometry().setFromPoints([new T.Vector3(A.x, yA(c.zA), A.z), new T.Vector3(B.x, yB(c.zB), B.z)]));
        const line = new T.Line(g, keep(new T.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.25 }))); line.computeLineDistances(); world.add(line); return;
      }
      const p0 = c.pts[0], pn = c.pts[c.pts.length - 1];
      const rA = yA(c.rA) + off, rB = yB(c.rB) + off;
      const P = [new T.Vector3(A.x, yA(c.zA), A.z), new T.Vector3(X(p0.x), yA(c.zA), Z(p0.y)), new T.Vector3(X(p0.x), rA, Z(p0.y))];
      c.pts.slice(1, -1).forEach(p => P.push(new T.Vector3(X(p.x), rA, Z(p.y))));
      P.push(new T.Vector3(X(pn.x), rA, Z(pn.y)));
      if (Math.abs(rA - rB) > 0.005) P.push(new T.Vector3(X(pn.x), rB, Z(pn.y)));
      P.push(new T.Vector3(X(pn.x), yB(c.zB), Z(pn.y)), new T.Vector3(B.x, yB(c.zB), B.z));
      const clean = P.filter((p, i) => i === 0 || p.distanceTo(P[i - 1]) > 0.001);
      if (clean.length < 2) return;
      const path = new T.CurvePath(); for (let i = 1; i < clean.length; i++) path.add(new T.LineCurve3(clean[i - 1], clean[i]));
      const tube = keep(new T.TubeGeometry(path, Math.max(16, clean.length * 10), sel ? rad * 2.2 : rad, 6, false));
      const mesh = new T.Mesh(tube, keep(new T.MeshLambertMaterial({ color, emissive: sel ? color : new T.Color(0x000000), emissiveIntensity: sel ? 0.5 : 0 })));
      mesh.userData = { kind: 'cable', id: c.id }; world.add(mesh); picks.push(mesh);
      // Steigleitung zwischen Ebenen hervorheben
      if (c.lvA !== c.lvB) {
        const h = Math.max(0.01, Math.abs(rA - rB)); const g = keep(new T.CylinderGeometry(0.18, 0.18, h, 16, 1, true));
        const shaft = new T.Mesh(g, mat.shaft); shaft.position.set(X(pn.x), (rA + rB) / 2, Z(pn.y)); world.add(shaft);
        const lb = label(`↕ ${fmt(c.riser)}`, { size: LS * 0.85, color: '#1a2026', bgc: ACC }); lb.position.set(X(pn.x) + 0.25, (rA + rB) / 2, Z(pn.y)); lb.center.set(0, 0.5); world.add(lb);
      }
    });
    renderLvList(); renderInfo(); draw();
  }

  function addWalls(root, f, paths, y0, H) {
    const kx = f.w / f.crop.w, ky = f.h / f.crop.h;
    const toW = (p) => ({ x: X(f.x + (p[0] - f.crop.x) * kx), z: Z(f.y + (p[1] - f.crop.y) * ky) });
    const inCrop = (p) => p[0] >= f.crop.x - 1 && p[0] <= f.crop.x + f.crop.w + 1 && p[1] >= f.crop.y - 1 && p[1] <= f.crop.y + f.crop.h + 1;
    const mPerUnit = kx / U;
    const seg = (a, b, thick, h0, h1, material) => {
      const A = toW(a), B = toW(b), L = Math.hypot(B.x - A.x, B.z - A.z); if (L < 0.02) return;
      const g = keep(new T.BoxGeometry(L, h1 - h0, thick));
      const m = new T.Mesh(g, material); m.position.set((A.x + B.x) / 2, y0 + (h0 + h1) / 2, (A.z + B.z) / 2); m.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);
      m.visible = st.walls; root.add(m); wallMeshes.push(m);
    };
    for (const p of paths) {
      if (p.k === 'd') continue;
      for (const s of p.subs) {
        if (s.pts.length < 2 || !s.pts.some(inCrop)) continue;
        if (p.k === 'f') { for (let i = 1; i < s.pts.length; i++) seg(s.pts[i - 1], s.pts[i], 0.03, 0.9, Math.min(H, 2.2), mat.glass); continue; }
        if (p.fill && s.closed && s.pts.length >= 3) {
          const shape = new T.Shape(s.pts.map(qq => { const w = toW(qq); return new T.Vector2(w.x, w.z); }));
          const g = keep(new T.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }));
          const m = new T.Mesh(g, mat.wall); m.rotation.x = Math.PI / 2; m.position.y = y0 + H; m.visible = st.walls; root.add(m); wallMeshes.push(m);
          continue;
        }
        const thick = Math.max(0.06, p.sw * mPerUnit);
        const pts = s.closed ? [...s.pts, s.pts[0]] : s.pts;
        for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], thick, 0, H, mat.wall);
      }
    }
  }

  // Ebenen-Schalter und Infobereich
  function renderLvList() {
    q('#v3Lv').innerHTML = [...scene.levels].sort((a, b) => b.elev - a.elev).map(l => `<label class="chk"><input type="checkbox" data-v3lv="${l.id}"${st.hidden.has(l.id) ? '' : ' checked'}> ${esc(l.name)}</label>`).join('');
  }
  const num = (v) => String(+v.toFixed(2)).replace('.', ',');
  function renderInfo() {
    const s = st.sel;
    if (!s) { info.hidden = true; return; }
    if (s.kind === 'item') {
      const i = scene.items.find(x => x.id === s.id); if (!i) { st.sel = null; info.hidden = true; return; }
      const l = scene.levels.find(x => x.id === i.lv);
      info.innerHTML = `<div class="v3i-h"><b>${esc(i.name)}</b><button class="btn sm ghost" data-v3="unsel" aria-label="Auswahl aufheben">✕</button></div>
        <div class="small muted">${esc(l ? l.name : '')} · ${i.used}/${i.ports} Ports belegt</div>
        <label class="row"><span>Höhe über Boden</span><span class="inline"><input class="inp sm" id="v3Mz" inputmode="decimal" value="${i.mountSet ? num(i.mount) : ''}" placeholder="${num(i.mount)}" style="width:70px" ${scene.readonly ? 'disabled' : ''}><span class="small muted">${esc(scene.unit)}</span></span></label>
        ${l && i.floor - l.elev > 0.01 ? `<div class="small muted">steht auf einem Podest (+${fmt(i.floor - l.elev)})</div>` : ''}
        ${scene.readonly ? '' : '<p class="v3i-tip">Jetzt ein zweites Gerät anklicken, um die beiden zu verbinden – auch auf einer anderen Ebene.</p>'}
        <button class="btn sm" data-v3="plan">Im Plan zeigen</button>`;
    } else {
      const c = scene.cables.find(x => x.id === s.id); if (!c) { st.sel = null; info.hidden = true; return; }
      info.innerHTML = `<div class="v3i-h"><b><span class="dot" style="background:${c.color}"></span> ${esc(c.label)}</b><button class="btn sm ghost" data-v3="unsel" aria-label="Auswahl aufheben">✕</button></div>
        <div class="small">${esc(c.fromName)}<br>→ ${esc(c.toName)}</div>
        <table class="calc small"><tr><td>Weg im Grundriss</td><td>${fmt(c.geo)}</td></tr>${scene.vert || c.vertical ? `<tr><td>Senkrecht${c.lvA !== c.lvB ? ' inkl. Steigleitung' : ''}</td><td>${fmt(c.vertical)}</td></tr>` : ''}
        <tr class="tot"><td>Berechnet (mit Zuschlägen)</td><td>${fmt(c.total)}</td></tr><tr class="pack"><td>Packliste</td><td>${fmt(c.pack)}</td></tr></table>
        <button class="btn sm" data-v3="plan">Im Plan zeigen</button>`;
    }
    info.hidden = false;
  }

  // Kamera
  const levelsShown = () => scene.levels.filter(l => !st.hidden.has(l.id));
  const ymid = () => { const v = levelsShown(); return v.length ? (Math.min(...v.map(l => Y(l.id, l.elev))) + Math.max(...v.map(l => Y(l.id, l.elev + (l.height || 3))))) / 2 : 0; };
  function viewOblique() {
    const v = levelsShown(); const yr = v.length ? Math.max(...v.map(l => Y(l.id, l.elev + (l.height || 3)))) - Math.min(...v.map(l => Y(l.id, l.elev))) : 0;
    const d = Math.max(10, span * 1.25 + yr * 0.6);
    controls.target.set(0, ymid(), 0); camera.position.set(-d * 0.62, ymid() + d * 0.72, d * 0.78); controls.update(); draw();
  }
  function viewTop() { const d = Math.max(10, span * 1.05); controls.target.set(0, ymid(), 0); camera.position.set(0, ymid() + d, 0.001); controls.update(); draw(); }

  let raf = 0;
  function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderer.render(s3, camera); }); }
  function resize() {
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px';
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); draw();
  }
  controls.addEventListener('change', draw);
  const ro = new ResizeObserver(resize); ro.observe(stage);

  // Anklicken: auswählen, zweites Gerät verbinden
  const ray = new T.Raycaster(); const mouse = new T.Vector2(); let down = null;
  const pickAt = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(picks, false)[0];
    return hit ? hit.object.userData : null;
  };
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons) return; renderer.domElement.style.cursor = pickAt(e) ? 'pointer' : ''; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) { down = null; return; }
    down = null;
    const h = pickAt(e);
    if (h && h.kind === 'item' && st.sel && st.sel.kind === 'item' && st.sel.id !== h.id && !scene.readonly && opts.onConnect) { opts.onConnect(st.sel.id, h.id); return; }
    st.sel = h ? { kind: h.kind, id: h.id } : null;
    build();
  });

  // Bedienung
  ov.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.v3lv) { t.checked ? st.hidden.delete(t.dataset.v3lv) : st.hidden.add(t.dataset.v3lv); build(); }
    if (t.id === 'v3Floors') { st.floors = t.checked; floorMeshes.forEach(m => { m.visible = t.checked; }); draw(); }
    if (t.id === 'v3Walls') { st.walls = t.checked; wallMeshes.forEach(m => { m.visible = t.checked; }); draw(); }
    if (t.id === 'v3Labels') { st.labels = t.checked; labels.forEach(m => { m.visible = t.checked; }); draw(); }
    if (t.id === 'v3Mz' && st.sel && opts.onMount) { const v = t.value.trim() === '' ? null : parseFloat(t.value.replace(',', '.')); if (v == null || isFinite(v)) opts.onMount(st.sel.id, v == null ? null : Math.max(-50, Math.min(100, v))); }
  });
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3]'); if (!b) return;
    if (b.dataset.v3 === 'unsel') { st.sel = null; build(); }
    if (b.dataset.v3 === 'plan' && st.sel && opts.onSelect) { const id = st.sel.id; close(); opts.onSelect(id); }
  });
  q('#v3Gap').addEventListener('input', (e) => { st.ex = +e.target.value; build(); controls.target.y = ymid(); controls.update(); });
  q('#v3Top').onclick = viewTop;
  q('#v3Reset').onclick = viewOblique;
  q('#v3Png').onclick = () => { renderer.render(s3, camera); renderer.domElement.toBlob(b => b && download(b, `${fileBase}-3d.png`)); };
  const onKey = (e) => {
    if (document.querySelector('.ov')) return; // Dialog darüber (z. B. Port-Auswahl) hat Vorrang
    if (e.key === 'Escape') { e.stopPropagation(); if (st.sel) { st.sel = null; build(); } else close(); }
  };
  document.addEventListener('keydown', onKey, true);
  function close() {
    document.removeEventListener('keydown', onKey, true); ro.disconnect(); controls.dispose();
    bag.forEach(o => { try { o.dispose(); } catch { /* egal */ } }); bag = [];
    texCache.forEach(p => p.then(t => t.dispose()).catch(() => {}));
    renderer.dispose(); ov.remove();
    opts.onClose && opts.onClose();
  }
  q('#v3Close').onclick = close;

  // Bildschirmposition eines Geräts/Kabels (für Tests und Barrierefreiheit)
  ov.screenOf = (id) => { const m = picks.find(o => o.userData.id === id); if (!m) return null; m.geometry.computeBoundingSphere(); const p = m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  build(); resize(); viewOblique();
  return {
    close,
    refresh(next, { selectCableOf } = {}) {
      scene = next;
      if (selectCableOf) { const [a, b] = selectCableOf; const c = [...scene.cables].reverse().find(x => (x.from === a && x.to === b) || (x.from === b && x.to === a)); if (c) st.sel = { kind: 'cable', id: c.id }; }
      build();
    },
  };
}
