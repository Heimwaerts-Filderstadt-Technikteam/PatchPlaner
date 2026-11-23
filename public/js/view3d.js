// 3D-Ansicht: Ebenen übereinander, Grundrisse als Texturen, Geräte, Kabel und Steigleitungen.
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

export async function open3D(scene, { fileBase = 'plan' } = {}) {
  const T = await ensureThree();
  const U = scene.U;
  const css = getComputedStyle(document.documentElement);
  const cssv = (n, d) => (css.getPropertyValue(n).trim() || d);
  const bg = cssv('--canvas', scene.dark ? '#0d1013' : '#dfe3e7');
  const fg = cssv('--fg', scene.dark ? '#e3e7eb' : '#1a2026');

  const levels = [...scene.levels].sort((a, b) => a.elev - b.elev);
  // Ebenen mit gleicher Höhe trotzdem auseinanderziehen
  const baseY = {}; let last = -Infinity;
  levels.forEach(l => { let y = l.elev; if (y <= last + 0.5) y = last + 3; baseY[l.id] = y; last = y; });
  const visible = new Set(levels.map(l => l.id));

  const ov = document.createElement('div');
  ov.className = 'v3d';
  ov.innerHTML = `
    <div class="v3d-top">
      <div class="v3d-title"><b>3D-Ansicht</b><span>${esc(scene.title)}</span></div>
      <div class="v3d-tools">
        <div class="v3d-lv">${[...levels].reverse().map(l => `<label class="chk"><input type="checkbox" data-v3lv="${l.id}" checked> ${esc(l.name)}</label>`).join('')}</div>
        <label class="v3d-range">Abstand <input type="range" id="v3Gap" min="1" max="4" step="0.1" value="1.6"></label>
        <label class="chk"><input type="checkbox" id="v3Floors" checked> Grundrisse</label>
        <label class="chk"><input type="checkbox" id="v3Labels" checked> Beschriftung</label>
        <div class="grp"><button id="v3Top">Draufsicht</button><button id="v3Reset">Schräg</button><button id="v3Png">Als Bild</button></div>
        <button class="btn pri" id="v3Close">Schließen</button>
      </div>
    </div>
    <div class="v3d-stage"><div class="v3d-hint">Ziehen: drehen · Rechte Maustaste oder Shift: verschieben · Mausrad: zoomen</div></div>`;
  document.body.appendChild(ov);
  const stage = ov.querySelector('.v3d-stage');

  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(new T.Color(bg));
  stage.prepend(renderer.domElement);
  const s3 = new T.Scene();
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 5000);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  s3.add(new T.AmbientLight(0xffffff, 0.75));
  const sun = new T.DirectionalLight(0xffffff, 0.55); sun.position.set(30, 60, 20); s3.add(sun);

  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };
  const groups = {}; // je Ebene: { root, floors, labels }
  let gap = 1.6;

  // Inhalte zentrieren
  const xs = [], ys = [];
  scene.floors.forEach(f => { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.h); });
  scene.items.forEach(i => { xs.push(i.x + i.w / 2); ys.push(i.y + i.h / 2); });
  scene.cables.forEach(c => c.pts.forEach(q => { xs.push(q.x); ys.push(q.y); }));
  if (xs.length === 1) { xs.push(xs[0] + 10 * U); ys.push(ys[0] + 6 * U); }
  if (!xs.length) { xs.push(0, 20 * U); ys.push(0, 12 * U); }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / U;
  const X = (x) => (x - cx) / U, Z = (y) => (y - cy) / U;
  const LS = Math.max(0.42, span / 55); // Schriftgröße passend zur Gebäudegröße
  // Geräte als kompakte Blöcke: das Schaltplan-Symbol ist oft viel breiter als das echte Gerät
  const box = {};
  scene.items.forEach(i => { box[i.id] = { x: X(i.x + i.w / 2), z: Z(i.y + i.h / 2), w: Math.min(1.2, Math.max(0.35, i.w / U)), d: Math.min(0.8, Math.max(0.3, i.h / U)) }; });

  function label(text, { size = 0.42, color = fg, bgc = null } = {}) {
    const fs = 64, pad = 18;
    const cv = document.createElement('canvas'); const c = cv.getContext('2d');
    c.font = `600 ${fs}px "Barlow Condensed", "IBM Plex Sans", Arial, sans-serif`;
    const w = Math.ceil(c.measureText(text).width) + pad * 2, h = fs + pad;
    cv.width = w; cv.height = h;
    c.font = `600 ${fs}px "Barlow Condensed", "IBM Plex Sans", Arial, sans-serif`;
    if (bgc) { c.fillStyle = bgc; c.beginPath(); c.roundRect ? c.roundRect(0, 0, w, h, 14) : c.rect(0, 0, w, h); c.fill(); }
    c.fillStyle = color; c.textBaseline = 'middle'; c.fillText(text, pad, h / 2 + 2);
    const tex = keep(new T.CanvasTexture(cv)); tex.anisotropy = 4;
    const sp = new T.Sprite(keep(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true })));
    sp.scale.set(size * w / h, size, 1); sp.renderOrder = 10;
    return sp;
  }
  async function floorTexture(f) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = f.url; });
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0, cv.width, cv.height);
    if (scene.dark) { // dunkle Linien auf dunklem Grund wären unsichtbar: Farben umkehren, Transparenz behalten
      const d = c.getImageData(0, 0, cv.width, cv.height); const a = d.data;
      for (let i = 0; i < a.length; i += 4) { a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; }
      c.putImageData(d, 0, 0);
    }
    const tex = keep(new T.CanvasTexture(cv));
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.repeat.set(f.crop.w / f.aw, f.crop.h / f.ah);
    tex.offset.set(f.crop.x / f.aw, 1 - (f.crop.y + f.crop.h) / f.ah);
    return tex;
  }

  // Aufbau je Ebene
  for (const l of levels) {
    const root = new T.Group(); root.userData.lv = l.id; s3.add(root);
    groups[l.id] = { root, floors: [], labels: [] };
    const fl = scene.floors.filter(f => f.lv === l.id), it = scene.items.filter(i => i.lv === l.id);
    // Bodenplatte mit Umriss
    const bx = [], by = [];
    fl.forEach(f => { bx.push(f.x, f.x + f.w); by.push(f.y, f.y + f.h); });
    it.forEach(i => { bx.push(i.x + i.w / 2 - U, i.x + i.w / 2 + U); by.push(i.y + i.h / 2 - U, i.y + i.h / 2 + U); });
    if (bx.length) {
      const x1 = Math.min(...bx), x2 = Math.max(...bx), y1 = Math.min(...by), y2 = Math.max(...by);
      const pg = keep(new T.PlaneGeometry((x2 - x1) / U, (y2 - y1) / U));
      const slab = new T.Mesh(pg, keep(new T.MeshBasicMaterial({ color: scene.dark ? 0xffffff : 0x1a2026, transparent: true, opacity: 0.045, side: T.DoubleSide, depthWrite: false })));
      slab.rotation.x = -Math.PI / 2; slab.position.set(X((x1 + x2) / 2), -0.01, Z((y1 + y2) / 2)); root.add(slab);
      const edge = new T.LineSegments(keep(new T.EdgesGeometry(pg)), keep(new T.LineBasicMaterial({ color: scene.dark ? 0x8893a0 : 0x5a646e, transparent: true, opacity: 0.6 })));
      edge.rotation.x = -Math.PI / 2; edge.position.copy(slab.position); root.add(edge);
      const lb = label(l.name, { size: LS * 2, color: '#1a2026', bgc: '#f0b21c' }); lb.position.set(X(x1) - LS * 0.5, 0, Z(y2) + LS * 0.5); lb.center.set(1, 0); root.add(lb); groups[l.id].labels.push(lb);
    }
    // Grundrisse
    for (const f of fl) {
      const g = keep(new T.PlaneGeometry(f.w / U, f.h / U));
      const m = keep(new T.MeshBasicMaterial({ transparent: true, opacity: f.opacity, side: T.DoubleSide, depthWrite: false, color: 0xffffff }));
      const mesh = new T.Mesh(g, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(f.x + f.w / 2), 0, Z(f.y + f.h / 2)); mesh.renderOrder = 1;
      root.add(mesh); groups[l.id].floors.push(mesh);
      floorTexture(f).then(tex => { m.map = tex; m.needsUpdate = true; draw(); }).catch(() => {});
    }
    // Zonen
    for (const z of scene.zones.filter(q => q.lv === l.id)) {
      const g = keep(new T.PlaneGeometry(z.w / U, z.h / U));
      const mesh = new T.Mesh(g, keep(new T.MeshBasicMaterial({ color: new T.Color(z.color), transparent: true, opacity: 0.14, side: T.DoubleSide, depthWrite: false })));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(z.x + z.w / 2), 0.02, Z(z.y + z.h / 2)); root.add(mesh);
      if (z.label) { const lb = label(z.label, { size: LS * 1.1, color: '#fff', bgc: z.color }); lb.position.set(X(z.x) + 0.1, 0.3, Z(z.y)); lb.center.set(0, 0); root.add(lb); groups[l.id].labels.push(lb); }
    }
    // Geräte: flache Kacheln in Gerätefarbe, Name darüber
    for (const i of it) {
      const bb = box[i.id];
      const g = keep(new T.BoxGeometry(bb.w, 0.45, bb.d));
      const mesh = new T.Mesh(g, keep(new T.MeshLambertMaterial({ color: new T.Color(i.color) })));
      mesh.position.set(bb.x, 0.225, bb.z); root.add(mesh);
      const e = new T.LineSegments(keep(new T.EdgesGeometry(g)), keep(new T.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }))); e.position.copy(mesh.position); root.add(e);
      const lb = label(i.name, { size: LS, color: fg, bgc: scene.dark ? 'rgba(20,24,28,.85)' : 'rgba(255,255,255,.9)' }); lb.position.set(mesh.position.x, 0.45 + LS * 0.9, mesh.position.z); root.add(lb); groups[l.id].labels.push(lb);
    }
  }
  // Kabel (eigene Gruppe, weil sie Ebenen verbinden)
  const cableGroup = new T.Group(); s3.add(cableGroup);
  function buildCables() {
    cableGroup.clear();
    scene.cables.forEach((c, n) => {
      if (!visible.has(c.lvA) && !visible.has(c.lvB)) return;
      const off = 0.12 + (n % 6) * 0.03;
      const yA = baseY[c.lvA] * gap + off, yB = baseY[c.lvB] * gap + off;
      const A = box[c.from], B = box[c.to];
      const mid = c.pts.slice(1, -1).map(p => new T.Vector3(X(p.x), yA, Z(p.y)));
      const pts = [new T.Vector3(A.x, yA, A.z), ...mid];
      if (c.lvA !== c.lvB) { // Steigleitung am Ende der Trasse, dann waagerecht zum Ziel
        const e = c.pts[c.pts.length - 1]; pts.push(new T.Vector3(X(e.x), yA, Z(e.y)), new T.Vector3(X(e.x), yB, Z(e.y)));
      }
      pts.push(new T.Vector3(B.x, yB, B.z));
      const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.001);
      if (clean.length < 2) return;
      if (c.radio) {
        const g = keep(new T.BufferGeometry().setFromPoints(clean));
        const line = new T.Line(g, keep(new T.LineDashedMaterial({ color: new T.Color(c.color), dashSize: 0.3, gapSize: 0.25 }))); line.computeLineDistances(); cableGroup.add(line); return;
      }
      const path = new T.CurvePath(); for (let i = 1; i < clean.length; i++) path.add(new T.LineCurve3(clean[i - 1], clean[i]));
      const tube = keep(new T.TubeGeometry(path, Math.max(8, clean.length * 8), Math.max(0.04, span / 900), 6, false));
      cableGroup.add(new T.Mesh(tube, keep(new T.MeshLambertMaterial({ color: new T.Color(c.color) }))));
    });
  }
  function layout() {
    for (const l of levels) { const g = groups[l.id]; g.root.position.y = baseY[l.id] * gap; g.root.visible = visible.has(l.id); }
    buildCables(); draw();
  }

  // Kamera
  const ymid = () => { const v = levels.filter(l => visible.has(l.id)); return v.length ? (Math.min(...v.map(l => baseY[l.id])) + Math.max(...v.map(l => baseY[l.id]))) / 2 * gap : 0; };
  function viewOblique() {
    const yr = levels.length ? (Math.max(...levels.map(l => baseY[l.id])) - Math.min(...levels.map(l => baseY[l.id]))) * gap : 0;
    const d = Math.max(10, span * 0.95 + yr * 0.6);
    controls.target.set(0, ymid(), 0);
    camera.position.set(-d * 0.62, ymid() + d * 0.72, d * 0.78);
    controls.update(); draw();
  }
  function viewTop() {
    const d = Math.max(10, span * 1.05);
    controls.target.set(0, ymid(), 0); camera.position.set(0, ymid() + d, 0.001); controls.update(); draw();
  }

  let raf = 0;
  function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderer.render(s3, camera); }); }
  function resize() {
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px';
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); draw();
  }
  controls.addEventListener('change', draw);
  const ro = new ResizeObserver(resize); ro.observe(stage);

  // Bedienung
  const q = (s) => ov.querySelector(s);
  ov.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.v3lv) { t.checked ? visible.add(t.dataset.v3lv) : visible.delete(t.dataset.v3lv); layout(); }
    if (t.id === 'v3Floors') { Object.values(groups).forEach(g => g.floors.forEach(m => { m.visible = t.checked; })); draw(); }
    if (t.id === 'v3Labels') { Object.values(groups).forEach(g => g.labels.forEach(m => { m.visible = t.checked; })); draw(); }
  });
  q('#v3Gap').addEventListener('input', (e) => { gap = +e.target.value; layout(); controls.target.y = ymid(); controls.update(); });
  q('#v3Top').onclick = viewTop;
  q('#v3Reset').onclick = viewOblique;
  q('#v3Png').onclick = () => { renderer.render(s3, camera); renderer.domElement.toBlob(b => b && download(b, `${fileBase}-3d.png`)); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  function close() {
    document.removeEventListener('keydown', onKey, true); ro.disconnect(); controls.dispose();
    cableGroup.clear(); disposables.forEach(d => { try { d.dispose(); } catch { /* egal */ } }); renderer.dispose();
    ov.remove();
  }
  q('#v3Close').onclick = close;

  resize(); layout(); viewOblique();
  return { close };
}
