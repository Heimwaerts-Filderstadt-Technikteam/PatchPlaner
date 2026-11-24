// Vektor-Grundriss: SVG (direkt oder aus einer PDF-Seite) einlesen und nur Wände und Fenster behalten.
// Text, Bemaßung, Möbel, Türen, Legende, Plankopf und Blattrahmen fliegen raus.
//
// Ablauf: parseSVG() → Liste von Elementen mit Polylinien in Seitenkoordinaten
//         classify()  → je Element: 'wall' | 'window' | 'detail' | 'off' (+ Grund)
//         buildSVG()  → sauberes SVG nur mit dem, was übernommen wird, auf den Inhalt zugeschnitten

const SKIP = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'style', 'title', 'desc', 'metadata', 'script', 'filter', 'foreignObject']);

/* ---------- Matrizen ---------- */
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
function parseTransform(s) {
  let m = I;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let r;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = I;
    switch (r[1]) {
      case 'matrix': if (a.length === 6) n = a; break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
      case 'rotate': { const t = (a[0] || 0) * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t); n = [c, sn, -sn, c, 0, 0]; if (a.length === 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]); break; }
      case 'skewX': n = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

/* ---------- Pfade in Polylinien zerlegen ---------- */
function flattenPath(d, curveSteps = 8) {
  const subs = []; let cur = null;
  const toks = String(d || '').match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = '';
  const num = () => +toks[i++];
  const more = () => i < toks.length && !/^[a-z]$/i.test(toks[i]);
  const start = (nx, ny) => { cur = { pts: [[nx, ny]], closed: false, curved: false }; subs.push(cur); x = sx = nx; y = sy = ny; };
  const line = (nx, ny) => { if (!cur) start(x, y); cur.pts.push([nx, ny]); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, nx, ny) => {
    if (!cur) start(x, y);
    for (let k = 1; k <= curveSteps; k++) { const t = k / curveSteps, u = 1 - t; cur.pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny]); }
    cur.curved = true; x = nx; y = ny;
  };
  const arc = (rx, ry, rot, large, sweep, nx, ny) => {
    if (!cur) start(x, y);
    if (!rx || !ry) { line(nx, ny); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const ph = rot * Math.PI / 180, cs = Math.cos(ph), sn = Math.sin(ph);
    const dx = (x - nx) / 2, dy = (y - ny) / 2, x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
    let l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry); if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
    const sg = large === sweep ? -1 : 1;
    const q = Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1));
    const co = sg * Math.sqrt(q), cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
    const ccx = cs * cxp - sn * cyp + (x + nx) / 2, ccy = sn * cxp + cs * cyp + (y + ny) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry); let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 8)));
    for (let k = 1; k <= n; k++) { const t = t1 + dt * k / n; cur.pts.push([ccx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, ccy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs]); }
    cur.curved = true; x = nx; y = ny;
  };
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; cur = null; } prev = 'Z'; if (!more()) continue; }
    if (!more() && C !== 'Z') { i++; continue; }
    switch (C) {
      case 'M': start(num() + ox, num() + oy); cmd = rel ? 'l' : 'L'; break;
      case 'L': line(num() + ox, num() + oy); break;
      case 'H': line(num() + (rel ? x : 0), y); break;
      case 'V': line(x, num() + (rel ? y : 0)); break;
      case 'C': { const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]; cubic(...a); cx = a[2]; cy = a[3]; break; }
      case 'S': { const r1 = /[CS]/.test(prev) ? [2 * x - cx, 2 * y - cy] : [x, y]; const a = [num() + ox, num() + oy, num() + ox, num() + oy]; cubic(r1[0], r1[1], ...a); cx = a[0]; cy = a[1]; break; }
      case 'Q': { const q1 = [num() + ox, num() + oy], e = [num() + ox, num() + oy]; cubic(x + 2 / 3 * (q1[0] - x), y + 2 / 3 * (q1[1] - y), e[0] + 2 / 3 * (q1[0] - e[0]), e[1] + 2 / 3 * (q1[1] - e[1]), e[0], e[1]); cx = q1[0]; cy = q1[1]; break; }
      case 'T': { const q1 = /[QT]/.test(prev) ? [2 * x - cx, 2 * y - cy] : [x, y]; const e = [num() + ox, num() + oy]; cubic(x + 2 / 3 * (q1[0] - x), y + 2 / 3 * (q1[1] - y), e[0] + 2 / 3 * (q1[0] - e[0]), e[1] + 2 / 3 * (q1[1] - e[1]), e[0], e[1]); cx = q1[0]; cy = q1[1]; break; }
      case 'A': arc(num(), num(), num(), num(), num(), num() + ox, num() + oy); break;
      default: i++;
    }
    prev = C;
  }
  return subs.filter(s => s.pts.length > 1 || s.closed);
}
function shapeToSubs(el) {
  const n = (a) => parseFloat(el.getAttribute(a)) || 0;
  switch (el.localName) {
    case 'path': return flattenPath(el.getAttribute('d'));
    case 'line': return [{ pts: [[n('x1'), n('y1')], [n('x2'), n('y2')]], closed: false }];
    case 'polyline': case 'polygon': {
      const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); const pts = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
      return pts.length > 1 ? [{ pts, closed: el.localName === 'polygon' }] : [];
    }
    case 'rect': { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); return w && h ? [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }] : []; }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.localName === 'circle' ? n('r') : n('rx'), ry = el.localName === 'circle' ? n('r') : n('ry'); const pts = [];
      for (let k = 0; k < 24; k++) { const t = k / 24 * Math.PI * 2; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
      return rx && ry ? [{ pts, closed: true, curved: true }] : [];
    }
  }
  return [];
}

/* ---------- Stil ---------- */
function parseColor(v) {
  if (!v) return undefined;
  v = String(v).trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  let m = v.match(/^#([\da-f])([\da-f])([\da-f])$/); if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = v.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/); if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = v.match(/^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/);
  if (m) return [1, 3, 5].map(k => Math.round(m[k + 1] ? +m[k] * 2.55 : +m[k]));
  const named = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128], blue: [0, 0, 255], green: [0, 128, 0] };
  if (named[v]) return named[v];
  if (v.startsWith('url(')) return [128, 128, 128];
  return [0, 0, 0];
}
const lum = (c) => (c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 1);
const hex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
function cssRules(doc) {
  const rules = {};
  doc.querySelectorAll('style').forEach(st => {
    const t = st.textContent.replace(/\/\*[\s\S]*?\*\//g, ''); const re = /([^{}]+)\{([^}]*)\}/g; let r;
    while ((r = re.exec(t))) r[1].split(',').map(s => s.trim()).filter(s => /^\.[\w-]+$/.test(s)).forEach(s => { rules[s.slice(1)] = Object.assign(rules[s.slice(1)] || {}, declOf(r[2])); });
  });
  return rules;
}
function declOf(s) { const o = {}; String(s || '').split(';').forEach(p => { const k = p.indexOf(':'); if (k > 0) o[p.slice(0, k).trim()] = p.slice(k + 1).trim(); }); return o; }
const STY = ['fill', 'stroke', 'stroke-width', 'display', 'visibility', 'opacity', 'stroke-opacity', 'fill-opacity'];
function styleOf(el, parent, rules) {
  const s = { ...parent };
  (el.getAttribute('class') || '').split(/\s+/).forEach(c => { if (rules[c]) Object.assign(s, pick(rules[c])); });
  STY.forEach(k => { const v = el.getAttribute(k); if (v != null) s[k] = v; });
  Object.assign(s, pick(declOf(el.getAttribute('style'))));
  return s;
}
const pick = (o) => { const r = {}; STY.forEach(k => { if (o[k] != null) r[k] = o[k]; }); return r; };

const unitToMm = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
const layerName = (g) => g.getAttribute('inkscape:label') || g.getAttribute('data-name') || g.getAttribute('serif:id') || (g.id && !/^(surface|g|layer|clip|glyph|path)[-_\d]*$/i.test(g.id) ? g.id.replace(/_x([\da-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/_/g, ' ') : '');

/**
 * SVG einlesen. unitMm: mm pro SVG-Einheit, wenn bekannt (PDF über pdftocairo: 25.4/72).
 */
export function parseSVG(text, { unitMm = null } = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') throw new Error('Die Datei ist kein gültiges SVG.');
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const wa = String(root.getAttribute('width') || ''), ha = String(root.getAttribute('height') || '');
  const W = vb.length === 4 && vb[2] ? vb[2] : parseFloat(wa) || 1000, H = vb.length === 4 && vb[3] ? vb[3] : parseFloat(ha) || 700;
  const x0 = vb.length === 4 ? vb[0] : 0, y0 = vb.length === 4 ? vb[1] : 0;
  if (!unitMm) { const m = wa.match(/^\s*([\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/); unitMm = m ? (+m[1] * (unitToMm[m[2] || ''] || unitToMm.px)) / W : unitToMm.px; }
  const rules = cssRules(doc);
  const ids = {}; doc.querySelectorAll('[id]').forEach(e => { ids[e.id] = e; });
  const glyphBox = new Map();
  const els = [], texts = [], layers = new Map();
  const base = [1, 0, 0, 1, -x0, -y0];
  const clipBox = (ref, m) => {
    const id = (ref || '').match(/url\(\s*#([^)]+)\)/); const cp = id && ids[id[1]]; if (!cp) return null;
    let b = null;
    cp.querySelectorAll('path,rect,polygon,polyline,circle,ellipse').forEach(sh => {
      const mm = mul(m, parseTransform(sh.getAttribute('transform')));
      shapeToSubs(sh).forEach(s => s.pts.forEach(p => { const [X, Y] = ap(mm, p[0], p[1]); b = b ? [Math.min(b[0], X), Math.min(b[1], Y), Math.max(b[2], X), Math.max(b[3], Y)] : [X, Y, X, Y]; }));
    });
    return b;
  };
  const walk = (el, m, st, layer, clip) => {
    for (const ch of el.children) {
      const tag = ch.localName;
      if (SKIP.has(tag)) continue;
      const s = styleOf(ch, st, rules);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const mm = mul(m, parseTransform(ch.getAttribute('transform')));
      let cl = clip;
      if (ch.getAttribute('clip-path')) { const b = clipBox(ch.getAttribute('clip-path'), tag === 'g' ? mm : m); if (b) cl = clip ? [Math.max(clip[0], b[0]), Math.max(clip[1], b[1]), Math.min(clip[2], b[2]), Math.min(clip[3], b[3])] : b; }
      if (tag === 'g' || tag === 'a' || tag === 'svg') {
        let ly = layer;
        if (el === root && tag === 'g') { const n = layerName(ch); if (n) ly = n; }
        else if (!layer && tag === 'g' && ch.getAttribute('inkscape:groupmode') === 'layer') ly = layerName(ch) || layer;
        walk(ch, mm, s, ly, cl); continue;
      }
      if (tag === 'use') {
        const href = ch.getAttribute('href') || ch.getAttribute('xlink:href') || ''; const ref = ids[href.replace(/^#/, '')];
        const um = mul(mm, [1, 0, 0, 1, parseFloat(ch.getAttribute('x')) || 0, parseFloat(ch.getAttribute('y')) || 0]);
        if (!ref) continue;
        if (/glyph/i.test(href) || ref.closest('defs') && /glyph|font/i.test(ref.id + ' ' + (ref.parentNode?.id || ''))) {
          // Schriftzeichen aus pdftocairo
          let b = glyphBox.get(ref.id);
          if (!b) { b = boxOf(ref); glyphBox.set(ref.id, b); }
          if (b) { const p1 = ap(um, b[0], b[1]), p2 = ap(um, b[2], b[3]); texts.push({ box: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])], layer }); }
          continue;
        }
        const wrap = { children: [ref] };
        walk(wrap, um, s, layer, cl); continue;
      }
      if (tag === 'text') {
        const fs = parseFloat(ch.getAttribute('font-size') || declOf(ch.getAttribute('style'))['font-size']) || 12;
        const tx = parseFloat(ch.getAttribute('x')) || 0, ty = parseFloat(ch.getAttribute('y')) || 0, len = (ch.textContent || '').trim().length;
        const p1 = ap(mm, tx, ty - fs), p2 = ap(mm, tx + len * fs * 0.55, ty);
        for (let k = 0; k < Math.max(1, len); k++) texts.push({ box: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])], layer });
        continue;
      }
      if (tag === 'image') continue;
      const subs = shapeToSubs(ch); if (!subs.length) continue;
      const stroke = parseColor(s.stroke), fill = s.fill === undefined ? [0, 0, 0] : parseColor(s.fill);
      const swRaw = s['stroke-width'] != null ? parseFloat(s['stroke-width']) : 1;
      const sw = stroke ? (isNaN(swRaw) ? 1 : swRaw) * scaleOf(mm) : 0;
      let ps = subs.map(sb => ({ pts: sb.pts.map(p => ap(mm, p[0], p[1])), closed: sb.closed, curved: !!sb.curved }));
      if (cl) ps = clipSubs(ps, cl);
      if (!ps.length) continue;
      const e = { id: els.length, subs: ps, stroke: stroke || null, fill: fill || null, sw, layer: layer || '' };
      e.box = bboxOf(ps); e.len = ps.reduce((a, sb) => a + plen(sb.pts, sb.closed), 0);
      e.curved = ps.some(sb => sb.curved);
      els.push(e);
      if (layer) layers.set(layer, (layers.get(layer) || 0) + 1);
    }
  };
  function boxOf(node) {
    let b = null;
    const g = (n, m) => {
      for (const ch of n.children || []) {
        const mm = mul(m, parseTransform(ch.getAttribute && ch.getAttribute('transform')));
        if (ch.localName === 'g') { g(ch, mm); continue; }
        shapeToSubs(ch).forEach(s => s.pts.forEach(p => { const [X, Y] = ap(mm, p[0], p[1]); b = b ? [Math.min(b[0], X), Math.min(b[1], Y), Math.max(b[2], X), Math.max(b[3], Y)] : [X, Y, X, Y]; }));
      }
    };
    if (node.localName === 'g' || node.localName === 'symbol') g(node, I); else g({ children: [node] }, I);
    return b;
  }
  walk(root, base, { fill: undefined }, '', null);
  return { W, H, unitMm, els, texts, layers: [...layers.entries()].map(([name, n]) => ({ name, n })) };
}

/* ---------- Geometrie-Helfer ---------- */
const plen = (pts, closed) => { let l = 0; for (let k = 1; k < pts.length; k++) l += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); if (closed && pts.length > 2) l += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]); return l; };
function bboxOf(subs) { let b = [Infinity, Infinity, -Infinity, -Infinity]; subs.forEach(s => s.pts.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); })); return b; }
function clipSeg(p, q, b) {
  let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
  const P = [-dx, dx, -dy, dy], Q = [p[0] - b[0], b[2] - p[0], p[1] - b[1], b[3] - p[1]];
  for (let k = 0; k < 4; k++) {
    if (P[k] === 0) { if (Q[k] < 0) return null; continue; }
    const r = Q[k] / P[k];
    if (P[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}
function clipSubs(subs, b) {
  const out = [];
  for (const s of subs) {
    const bb = bboxOf([s]);
    if (bb[0] >= b[0] && bb[1] >= b[1] && bb[2] <= b[2] && bb[3] <= b[3]) { out.push(s); continue; }
    if (bb[2] < b[0] || bb[0] > b[2] || bb[3] < b[1] || bb[1] > b[3]) continue;
    if (s.closed) { // Fläche: auf das Rechteck zuschneiden (Sutherland-Hodgman)
      let poly = s.pts;
      const edges = [[(p) => p[0] >= b[0], (p, q) => [b[0], p[1] + (q[1] - p[1]) * (b[0] - p[0]) / (q[0] - p[0])]], [(p) => p[0] <= b[2], (p, q) => [b[2], p[1] + (q[1] - p[1]) * (b[2] - p[0]) / (q[0] - p[0])]],
        [(p) => p[1] >= b[1], (p, q) => [p[0] + (q[0] - p[0]) * (b[1] - p[1]) / (q[1] - p[1]), b[1]]], [(p) => p[1] <= b[3], (p, q) => [p[0] + (q[0] - p[0]) * (b[3] - p[1]) / (q[1] - p[1]), b[3]]]];
      for (const [inside, cut] of edges) { const res = []; for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; if (inside(q)) { if (!inside(p)) res.push(cut(p, q)); res.push(q); } else if (inside(p)) res.push(cut(p, q)); } poly = res; if (!poly.length) break; }
      if (poly.length > 2) out.push({ pts: poly, closed: true, curved: s.curved });
      continue;
    }
    let run = null;
    for (let k = 1; k < s.pts.length; k++) {
      const c = clipSeg(s.pts[k - 1], s.pts[k], b);
      if (!c) { if (run) { out.push(run); run = null; } continue; }
      if (!run) run = { pts: [c[0]], closed: false, curved: s.curved };
      run.pts.push(c[1]);
      if (c[1][0] !== s.pts[k][0] || c[1][1] !== s.pts[k][1]) { out.push(run); run = null; }
    }
    if (run && run.pts.length > 1) out.push(run);
  }
  return out;
}

// Layer-Namen: was sind Wände, was Fenster? (deutsch, englisch, AIA-Kürzel wie A-WALL, A-GLAZ)
export const WALL_RE = /wand|wände|waende|mauer|wall|stütze|stuetze|column|a-cols|s-cols|tragwerk|beton|rohbau|mauerwerk|brüstung|bruestung/i;
export const WIN_RE = /fenster|window|glas|glaz|verglasung/i;
export const OFF_RE = /möbel|moebel|furn|bemaß|bemass|dim|anno|text|schrift|achs|grid|raster|plankopf|rahmen|title|legende|möblierung|einrichtung|sanitär|sanitaer|elektro|hlk|tga|treppe|stair|tür|tuer|door|schraff|hatch|patt|boden|floor|decke|ceil|dach|roof/i;
export const keepLayer = (n) => (WALL_RE.test(n) || WIN_RE.test(n)) && !/text|anno|dim|bemaß|bemass/i.test(n);   // Wand-Schraffur (Vollfläche) gehört dazu

/* ---------- Klassen (gleiche Strichstärke/Farbe) ---------- */
export function classKey(e) {
  if (e.fill && lum(e.fill) < 0.92 && (!e.stroke || e.sw < 0.01 || e.subs.every(s => s.closed))) return 'F|' + hex(e.fill.map(v => Math.round(v / 16) * 16));
  if (!e.stroke) return 'N';
  return 'S|' + (Math.round(e.sw * 100) / 100) + '|' + hex(e.stroke.map(v => Math.round(v / 32) * 32));
}
export function classLabel(key, unitMm) {
  const p = key.split('|');
  if (p[0] === 'F') return { kind: 'fill', color: p[1], text: 'Gefüllte Flächen' };
  if (p[0] === 'N') return { kind: 'none', color: '#000', text: 'Ohne Linie' };
  const c = p[2].match(/[\da-f]{2}/gi).map(h => parseInt(h, 16)), mx = Math.max(...c), mn = Math.min(...c);
  const cname = mx - mn > 60 ? 'farbig' : mx < 40 ? '' : mx < 200 ? 'grau' : 'hellgrau';
  return { kind: 'stroke', color: p[2], sw: +p[1], text: `Linie ${(+p[1] * unitMm).toLocaleString('de-DE', { maximumFractionDigits: 2 })} mm${cname ? ' · ' + cname : ''}` };
}

/**
 * Elemente einordnen.
 * opts.scale: Zeichnungsmaßstab (z. B. 100), opts.cls: { key: 'wall'|'auto'|'off' } (Nutzer-Korrektur),
 * opts.layers: { name: true|false } wenn nach Layern gefiltert wird, opts.windows, opts.sheet, opts.text, opts.tolMm
 */
export function classify(model, opts = {}) {
  const { W, H, els, texts, unitMm } = model;
  const scale = opts.scale || 100;
  const mmU = 1 / unitMm;                                   // SVG-Einheiten pro Papier-mm
  const paper = opts.paper || 1;                            // DXF: echte Maße → Papiergrößen wie bei 1:100 umrechnen
  const tol = (opts.tolMm ?? 0.7) * mmU * paper;
  const maxOpen = ((opts.maxOpenM ?? 4) * 1000 / scale) * mmU;
  const res = new Array(els.length).fill('off'), why = new Array(els.length).fill('');
  let stats = null, auto = null, total = 1;
  const sheetBoxes = [];

  // 1. Blattrahmen, Plankopf, Legende (Kästen voller Text)
  if (opts.sheet !== false) {
    const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const inside = (b, t) => t[0] >= b[0] - 1 && t[1] >= b[1] - 1 && t[2] <= b[2] + 1 && t[3] <= b[3] + 1;
    els.forEach((e, k) => {
      const b = e.box, bw = b[2] - b[0], bh = b[3] - b[1];
      if (bw > W * 0.8 && bh > H * 0.8) { res[k] = 'off'; why[k] = 'frame'; return; }
      const isRect = e.subs.length === 1 && e.subs[0].closed && e.subs[0].pts.length <= 5 && e.subs[0].pts.every(p => (Math.abs(p[0] - b[0]) < 0.5 || Math.abs(p[0] - b[2]) < 0.5) && (Math.abs(p[1] - b[1]) < 0.5 || Math.abs(p[1] - b[3]) < 0.5));
      if (!isRect || bw < 12 * mmU * paper || bh < 8 * mmU * paper || area(b) > W * H * 0.4) return;
      const n = texts.filter(t => inside(b, t.box)).length;
      const dens = n / (area(b) / (100 * mmU * mmU * paper * paper));          // Zeichen pro cm²
      if (n >= 12 && dens > 0.45) sheetBoxes.push(b);
    });
    els.forEach((e, k) => {
      if (why[k]) return;
      const cx = (e.box[0] + e.box[2]) / 2, cy = (e.box[1] + e.box[3]) / 2;
      if (sheetBoxes.some(b => cx >= b[0] - 0.5 && cx <= b[2] + 0.5 && cy >= b[1] - 0.5 && cy <= b[3] + 0.5)) why[k] = 'sheet';
    });
  }
  const live = els.filter((e, k) => !why[k]);

  // 2. Layer-Modus: der Nutzer entscheidet über die Layer
  if (opts.layers) {
    els.forEach((e, k) => { if (!why[k]) { const on = opts.layers[e.layer || '(ohne Layer)']; res[k] = on ? (WIN_RE.test(e.layer) ? 'window' : 'wall') : 'off'; why[k] = on ? 'layer' : 'layer-off'; } });
    return finish();
  }

  // 3. Wand-Klassen automatisch: dunkle Füllungen + die dicksten Linien mit nennenswerter Länge
  stats = new Map();
  live.forEach(e => { const key = classKey(e); const s = stats.get(key) || { key, n: 0, len: 0, sw: e.sw }; s.n++; s.len += e.len; stats.set(key, s); });
  total = [...stats.values()].reduce((a, s) => a + s.len, 0) || 1;
  const strokes = [...stats.values()].filter(s => s.key.startsWith('S|'));
  const fills = [...stats.values()].filter(s => s.key.startsWith('F|'));
  const fillShare = fills.reduce((a, s) => a + s.len, 0) / total;
  auto = {};
  for (const s of stats.values()) auto[s.key] = s.key === 'N' ? 'off' : 'auto';
  if (fillShare > 0.08) {
    // Wände als gefüllte Flächen (Poché): die Füllungen sind die Wände, alle Linien werden geprüft
    fills.forEach(s => { auto[s.key] = 'wall'; });
  } else {
    // Wände als Linien: die dickste Linienart mit nennenswerter Länge (und fast gleich dicke)
    const sig = strokes.filter(s => s.len / total > 0.05);
    const maxW = sig.length ? Math.max(...sig.map(s => s.sw)) : 0;
    sig.forEach(s => { if (s.sw >= maxW * 0.9) auto[s.key] = 'wall'; });
    fills.forEach(s => { if (s.len / total > 0.01) auto[s.key] = 'wall'; });
  }
  const mode = (key) => (opts.cls && opts.cls[key]) || auto[key];

  // 4. Wandmaske rastern (leicht aufgedickt) und prüfen, welche dünnen Linien zwischen Wandenden liegen
  const R = Math.min(3200 / Math.max(W, H), 6 * mmU / mmU);  // Pixel pro Einheit
  const cw = Math.ceil(W * R), ch = Math.ceil(H * R);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineJoin = 'round'; c.lineCap = 'round';
  const trace = (e) => { c.beginPath(); e.subs.forEach(s => { s.pts.forEach((p, i) => (i ? c.lineTo(p[0] * R, p[1] * R) : c.moveTo(p[0] * R, p[1] * R))); if (s.closed) c.closePath(); }); };
  els.forEach((e, k) => {
    if (why[k]) return;
    if (mode(classKey(e)) !== 'wall') return;
    res[k] = 'wall'; why[k] = 'class';
    trace(e);
    if (e.fill && e.subs.every(s => s.closed)) c.fill('evenodd');
    c.lineWidth = Math.max(1, (e.sw + 2 * tol) * R); c.stroke();
  });
  const mask = c.getImageData(0, 0, cw, ch).data;
  const inMask = (p) => { const x = Math.round(p[0] * R), y = Math.round(p[1] * R); if (x < 0 || y < 0 || x >= cw || y >= ch) return false; return mask[(y * cw + x) * 4 + 3] > 0; };
  els.forEach((e, k) => {
    if (why[k]) return;
    const md = mode(classKey(e));
    if (md === 'off') { why[k] = 'class-off'; return; }
    if (opts.windows === false) { why[k] = 'thin'; return; }
    const b = e.box; const ext = Math.max(b[2] - b[0], b[3] - b[1]);
    if (ext > maxOpen) { why[k] = 'long'; return; }
    // Ecken/Endpunkte (bei Kurven: alle Punkte, damit Türbögen mit freiem Ende rausfallen)
    let ok = true, n = 0, nin = 0;
    for (const s of e.subs) {
      const vs = s.curved ? s.pts : (s.closed ? s.pts : [s.pts[0], ...s.pts.slice(1, -1), s.pts[s.pts.length - 1]]);
      for (const p of vs) { if (!inMask(p)) { ok = false; break; } }
      if (!ok) break;
      for (let t = 0; t < s.pts.length - 1; t++) for (let u = 0.25; u < 1; u += 0.25) { n++; if (inMask([s.pts[t][0] + (s.pts[t + 1][0] - s.pts[t][0]) * u, s.pts[t][1] + (s.pts[t + 1][1] - s.pts[t][1]) * u])) nin++; }
    }
    if (!ok) { why[k] = 'free'; return; }
    const frac = n ? nin / n : 1;
    res[k] = frac > 0.9 ? 'detail' : 'window'; why[k] = frac > 0.9 ? 'inside' : 'opening';
  });
  return finish();

  function finish() {
    const classes = [...(stats || new Map()).values()].map(s => ({ ...s, auto: auto ? auto[s.key] : 'auto', mode: (opts.cls && opts.cls[s.key]) || (auto ? auto[s.key] : 'auto'), share: s.len / (total || 1), ...classLabel(s.key, unitMm) })).sort((a, b) => (a.kind === 'fill' ? -1 : 0) - (b.kind === 'fill' ? -1 : 0) || b.sw - a.sw);
    const kept = res.map(r => r !== 'off');
    const counts = { wall: 0, window: 0, detail: 0, off: 0, text: texts.length, sheet: sheetBoxes.length };
    res.forEach(r => { counts[r]++; });
    return { res, why, kept, classes, counts, sheetBoxes };
  }
}

/** Sauberes SVG aus dem, was übernommen wird. Auf den Inhalt zugeschnitten; ox/oy = Versatz zur Originalseite. */
export function buildSVG(model, cl, { keepText = false, colors = false, margin = 6, paper = 1 } = {}) {
  const { els } = model;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  els.forEach((e, k) => { if (cl.kept[k]) { b[0] = Math.min(b[0], e.box[0] - e.sw); b[1] = Math.min(b[1], e.box[1] - e.sw); b[2] = Math.max(b[2], e.box[2] + e.sw); b[3] = Math.max(b[3], e.box[3] + e.sw); } });
  if (!isFinite(b[0])) throw new Error('Mit diesen Einstellungen bleibt nichts übrig. Markiere mindestens eine Linienart als Wand.');
  const mg = margin * paper / model.unitMm;
  const ox = Math.max(0, b[0] - mg), oy = Math.max(0, b[1] - mg);
  const w = Math.min(model.W, b[2] + mg) - ox, h = Math.min(model.H, b[3] + mg) - oy;
  const f = (v) => +v.toFixed(2);
  const dOf = (e) => e.subs.map(s => 'M' + s.pts.map(p => f(p[0] - ox) + ' ' + f(p[1] - oy)).join('L') + (s.closed ? 'Z' : '')).join('');
  let out = '';
  els.forEach((e, k) => {
    if (!cl.kept[k]) return;
    const filled = e.fill && lum(e.fill) < 0.92 && e.subs.every(s => s.closed);
    const fillC = filled ? (colors ? hex(e.fill) : (lum(e.fill) < 0.5 ? '#3c3c3c' : '#8a8a8a')) : 'none';
    const strokeC = e.stroke && e.sw > 0 ? (colors ? hex(e.stroke) : '#000') : 'none';
    out += `<path data-k="${cl.res[k] === 'window' ? 'f' : cl.res[k] === 'detail' ? 'd' : 'w'}" d="${dOf(e)}" fill="${fillC}"${filled ? ' fill-rule="evenodd"' : ''} stroke="${strokeC}"${strokeC !== 'none' ? ` stroke-width="${f(Math.max(e.sw, 0.2))}"` : ''}/>`;
  });
  if (keepText) model.texts.forEach(t => { /* Text wird nicht nachgebaut – nur als Hinweis ausgelassen */ });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}"><g stroke-linecap="round" stroke-linejoin="round">${out}</g></svg>`;
  return { svg, ox, oy, w, h };
}

/** Vorschau in ein Canvas zeichnen: Übernommenes dunkel, Entferntes blass rot. */
export function drawPreview(cv, model, cl, { showOff = true } = {}) {
  const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const c = cv.getContext('2d');
  const k = Math.min(cv.width / model.W, cv.height / model.H) * 0.98, ox = (cv.width - model.W * k) / 2, oy = (cv.height - model.H * k) / 2;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#d7dbe0'; c.lineWidth = 1; c.strokeRect(ox, oy, model.W * k, model.H * k);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const path = (e) => { c.beginPath(); e.subs.forEach(s => { s.pts.forEach((p, i) => (i ? c.lineTo(ox + p[0] * k, oy + p[1] * k) : c.moveTo(ox + p[0] * k, oy + p[1] * k))); if (s.closed) c.closePath(); }); };
  if (showOff) {
    c.strokeStyle = 'rgba(214,69,65,.35)'; c.fillStyle = 'rgba(214,69,65,.12)';
    model.els.forEach((e, i) => { if (cl.kept[i]) return; path(e); if (e.fill && e.subs.every(s => s.closed)) c.fill('evenodd'); c.lineWidth = Math.max(0.6, e.sw * k); c.stroke(); });
    c.fillStyle = 'rgba(214,69,65,.35)';
    model.texts.forEach(t => c.fillRect(ox + t.box[0] * k, oy + t.box[1] * k, Math.max(1, (t.box[2] - t.box[0]) * k), Math.max(1, (t.box[3] - t.box[1]) * k)));
  }
  const col = { wall: '#14181c', window: '#1f6fd1', detail: '#14181c' };
  model.els.forEach((e, i) => {
    if (!cl.kept[i]) return;
    path(e);
    if (e.fill && e.subs.every(s => s.closed) && lum(e.fill) < 0.92) { c.fillStyle = cl.res[i] === 'window' ? col.window : '#3c3c3c'; c.fill('evenodd'); }
    c.strokeStyle = col[cl.res[i]] || '#14181c'; c.lineWidth = Math.max(cl.res[i] === 'window' ? 1.2 : 1, e.sw * k); c.stroke();
  });
}

/* ---------- DXF (AutoCAD-Austauschformat, z. B. aus LibreCAD) ---------- */
const ACI = { 1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255], 6: [255, 0, 255], 7: [0, 0, 0], 8: [128, 128, 128], 9: [192, 192, 192], 250: [51, 51, 51], 251: [80, 80, 80], 252: [105, 105, 105], 253: [130, 130, 130], 254: [190, 190, 190], 255: [255, 255, 255] };
const aci = (n) => ACI[Math.abs(n)] || [90, 90, 90];
export const DXF_UNITS = { 1: ['Zoll', 25.4], 2: ['Fuß', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };

/**
 * DXF einlesen. Liefert dasselbe Modell wie parseSVG (Koordinaten in Zeichnungseinheiten, y nach unten),
 * plus unit/unitGuess, ox0/oy0 (Versatz zum Zeichnungsursprung, damit Ebenen aus einem Plansatz deckungsgleich liegen).
 */
export function parseDXF(text, { unitMm = null } = {}) {
  if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error('Binäre DXF-Dateien werden nicht unterstützt. Bitte als ASCII-DXF speichern (in LibreCAD: „Speichern unter“ → DXF).');
  const L = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) { const c = parseInt(L[i], 10); if (isNaN(c)) { i--; continue; } pairs.push([c, L[i + 1].trim()]); }
  if (!pairs.some(p => p[0] === 0 && p[1] === 'SECTION')) throw new Error('Die Datei ist keine gültige DXF.');
  // in Gruppen „0 / TYP“ zerlegen
  const recs = []; let cur = null, section = null, sub = null;
  for (const [c, v] of pairs) {
    if (c === 0) {
      if (v === 'SECTION') { section = 'pending'; cur = null; continue; }
      if (v === 'ENDSEC') { section = null; cur = null; continue; }
      cur = { type: v, section, g: [] }; recs.push(cur); continue;
    }
    if (section === 'pending' && c === 2) { section = v; continue; }
    if (cur) cur.g.push([c, v]);
  }
  const get = (r, code, def) => { const p = r.g.find(x => x[0] === code); return p ? p[1] : def; };
  const num = (r, code, def = 0) => { const v = get(r, code); return v == null ? def : parseFloat(v); };
  // Kopf: Einheiten
  let insunits = null;
  { const h = pairs.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS'); if (h >= 0 && pairs[h + 1]) insunits = parseInt(pairs[h + 1][1], 10); }
  // Layer
  const layers = {};
  recs.filter(r => r.section === 'TABLES' && r.type === 'LAYER').forEach(r => {
    const name = get(r, 2, '0'), col = parseInt(get(r, 62, '7'), 10), fl = parseInt(get(r, 70, '0'), 10), lw = parseInt(get(r, 370, '-3'), 10);
    layers[name] = { name, color: col, off: col < 0 || (fl & 1) === 1, lw: lw > 0 ? lw / 100 : 0.25 };
  });
  const layerOf = (n) => layers[n] || (layers[n] = { name: n, color: 7, off: false, lw: 0.25 });
  // Blöcke
  const blocks = {}; let blk = null;
  recs.filter(r => r.section === 'BLOCKS').forEach(r => {
    if (r.type === 'BLOCK') { blk = { name: get(r, 2, ''), bx: num(r, 10), by: num(r, 20), ents: [] }; blocks[blk.name] = blk; return; }
    if (r.type === 'ENDBLK') { blk = null; return; }
    if (blk) blk.ents.push(r);
  });
  const ents = recs.filter(r => r.section === 'ENTITIES');

  // Entitäten → Polylinien (in Zeichnungseinheiten, y nach oben); Transformation für Blockreferenzen
  const raw = [], texts = [];
  const arcPts = (cx, cy, r, a0, a1) => { let d = a1 - a0; while (d <= 0) d += Math.PI * 2; const n = Math.max(6, Math.ceil(d / (Math.PI / 18))); const out = []; for (let k = 0; k <= n; k++) { const t = a0 + d * k / n; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return out; };
  const bulgePts = (p, q, b) => {
    if (!b) return [q];
    const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], ch = Math.hypot(dx, dy); if (!ch) return [q];
    const r = ch / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, hgt = r * Math.cos(th / 2);
    const cx = mx - hgt * dy / ch, cy = my + hgt * dx / ch;
    const a0 = Math.atan2(p[1] - cy, p[0] - cx); const n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 18))); const out = [];
    for (let k = 1; k <= n; k++) { const t = a0 + th * k / n; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); }
    out[out.length - 1] = q; return out;
  };
  // Vertex-Folgen für POLYLINE einsammeln
  function walk(list, m, inherit, depth) {
    if (depth > 8) return;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (get(r, 67) === '1') continue;                           // Papierbereich
      if (get(r, 60) === '1') continue;                           // unsichtbar
      let layer = get(r, 8, '0'); if (layer === '0' && inherit) layer = inherit.layer;
      const ly = layerOf(layer); if (ly.off) continue;
      let col = parseInt(get(r, 62, '256'), 10); if (col === 256) col = ly.color; if (col === 0 && inherit) col = inherit.color;
      let lw = parseInt(get(r, 370, '-1'), 10); lw = lw > 0 ? lw / 100 : ly.lw;
      const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const add = (subs, fill = false, curved = false) => raw.push({ layer, color: aci(col), lw, fill, curved, subs: subs.map(s => ({ pts: s.pts.map(p => T(p[0], p[1])), closed: s.closed, curved: curved || s.curved })) });
      switch (r.type) {
        case 'LINE': add([{ pts: [[num(r, 10), num(r, 20)], [num(r, 11), num(r, 21)]], closed: false }]); break;
        case 'LWPOLYLINE': {
          const closed = (parseInt(get(r, 70, '0'), 10) & 1) === 1; const vs = []; let v = null;
          for (const [c, val] of r.g) { if (c === 10) { v = { x: +val, y: 0, b: 0 }; vs.push(v); } else if (c === 20 && v) v.y = +val; else if (c === 42 && v) v.b = +val; }
          if (vs.length < 2) break;
          const pts = [[vs[0].x, vs[0].y]]; let curved = false;
          for (let k = 1; k < vs.length + (closed ? 1 : 0); k++) { const a = vs[k - 1], b = vs[k % vs.length]; if (a.b) curved = true; pts.push(...bulgePts([a.x, a.y], [b.x, b.y], a.b)); }
          if (closed) pts.pop();
          add([{ pts, closed, curved }], false, curved); break;
        }
        case 'POLYLINE': {
          const closed = (parseInt(get(r, 70, '0'), 10) & 1) === 1; const vs = [];
          for (i++; i < list.length && list[i].type === 'VERTEX'; i++) vs.push({ x: num(list[i], 10), y: num(list[i], 20), b: num(list[i], 42) });
          if (vs.length < 2) break;
          const pts = [[vs[0].x, vs[0].y]]; let curved = false;
          for (let k = 1; k < vs.length + (closed ? 1 : 0); k++) { const a = vs[k - 1], b = vs[k % vs.length]; if (a.b) curved = true; pts.push(...bulgePts([a.x, a.y], [b.x, b.y], a.b)); }
          if (closed) pts.pop();
          add([{ pts, closed, curved }], false, curved); break;
        }
        case 'CIRCLE': add([{ pts: arcPts(num(r, 10), num(r, 20), num(r, 40), 0, Math.PI * 2).slice(0, -1), closed: true }], false, true); break;
        case 'ARC': add([{ pts: arcPts(num(r, 10), num(r, 20), num(r, 40), num(r, 50) * Math.PI / 180, num(r, 51) * Math.PI / 180), closed: false }], false, true); break;
        case 'ELLIPSE': {
          const cx = num(r, 10), cy = num(r, 20), mx = num(r, 11), my = num(r, 21), ratio = num(r, 40, 1), t0 = num(r, 41, 0), t1 = num(r, 42, Math.PI * 2);
          const ra = Math.hypot(mx, my), rot = Math.atan2(my, mx), rb = ra * ratio; let d = t1 - t0; while (d <= 0) d += Math.PI * 2;
          const n = Math.max(8, Math.ceil(d / (Math.PI / 18))), pts = [];
          for (let k = 0; k <= n; k++) { const t = t0 + d * k / n, x = ra * Math.cos(t), y = rb * Math.sin(t); pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
          const full = Math.abs(d - Math.PI * 2) < 1e-6; if (full) pts.pop();
          add([{ pts, closed: full }], false, true); break;
        }
        case 'SPLINE': {
          const fit = [], ctl = []; let p = null, q = null;
          for (const [c, val] of r.g) { if (c === 10) { p = [+val, 0]; ctl.push(p); } else if (c === 20 && p) p[1] = +val; else if (c === 11) { q = [+val, 0]; fit.push(q); } else if (c === 21 && q) q[1] = +val; }
          const pts = fit.length > 1 ? fit : ctl; if (pts.length > 1) add([{ pts, closed: (parseInt(get(r, 70, '0'), 10) & 1) === 1 }], false, true); break;
        }
        case 'SOLID': case 'TRACE': {
          const pts = [[num(r, 10), num(r, 20)], [num(r, 11), num(r, 21)], [num(r, 13, num(r, 12)), num(r, 23, num(r, 22))], [num(r, 12), num(r, 22)]];
          add([{ pts, closed: true }], true); break;
        }
        case 'HATCH': {
          // nur Vollflächen (Poché) übernehmen, Muster-Schraffuren sind Deko
          if (get(r, 70) !== '1') break;
          const subs = []; let poly = null, curP = null;
          for (const [c, val] of r.g) {
            if (c === 92) { poly = { pts: [], closed: true }; subs.push(poly); }
            else if ((c === 10 || c === 11) && poly) { curP = [+val, 0]; poly.pts.push(curP); }
            else if ((c === 20 || c === 21) && curP) curP[1] = +val;
          }
          const ok = subs.filter(s => s.pts.length > 2).map(s => ({ pts: s.pts.filter((pp, k) => k === 0 || pp[0] !== s.pts[k - 1][0] || pp[1] !== s.pts[k - 1][1]), closed: true }));
          if (ok.length) add(ok, true); break;
        }
        case 'TEXT': case 'MTEXT': case 'ATTRIB': {
          const x = num(r, 10), y = num(r, 20), h = num(r, 40, 2.5), s = String(get(r, 1, '')).replace(/\\[A-Za-z][^;]*;|[{}]/g, ''), n = Math.max(1, Math.min(200, s.length));
          const p1 = T(x, y), p2 = T(x + n * h * 0.6, y + h);
          for (let k = 0; k < n; k++) texts.push({ box: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])], layer });
          break;
        }
        case 'INSERT': {
          const b = blocks[get(r, 2, '')]; if (!b || /^\*[DT]/i.test(b.name)) break;   // Bemaßungs-Blöcke überspringen
          const sx = num(r, 41, 1), sy = num(r, 42, 1), a = num(r, 50, 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
          const cols = Math.max(1, num(r, 70, 1)), rows = Math.max(1, num(r, 71, 1)), dc = num(r, 44, 0), dr = num(r, 45, 0);
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const tx = num(r, 10) + ci * dc * c - ri * dr * sn, ty = num(r, 20) + ci * dc * sn + ri * dr * c;
            // M_insert = T(tx,ty) · R(a) · S(sx,sy) · T(-base)
            const n = [c * sx, sn * sx, -sn * sy, c * sy, tx - (c * sx * b.bx - sn * sy * b.by), ty - (sn * sx * b.bx + c * sy * b.by)];
            const mm = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
            walk(b.ents, mm, { layer, color: col }, depth + 1);
          }
          break;
        }
        default: break;   // DIMENSION, POINT, 3DFACE, IMAGE … werden nicht übernommen
      }
    }
  }
  walk(ents, [1, 0, 0, 1, 0, 0], null, 0);
  if (!raw.length) throw new Error('In der DXF sind keine Linien im Modellbereich. Liegt die Zeichnung nur im Layout/Papierbereich?');

  // Ausdehnung (Ausreißer weit weg vom Rest ignorieren: Koordinaten-Reste in vielen CAD-Dateien)
  const xs = [], ys = []; raw.forEach(e => e.subs.forEach(s => s.pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); })));
  const qs = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))]; };
  const x1q = qs(xs, 0.01), x2q = qs(xs, 0.99), y1q = qs(ys, 0.01), y2q = qs(ys, 0.99), pad = Math.max(x2q - x1q, y2q - y1q) * 0.5 + 1e-9;
  const inR = (p) => p[0] >= x1q - pad && p[0] <= x2q + pad && p[1] >= y1q - pad && p[1] <= y2q + pad;
  const keepRaw = raw.filter(e => e.subs.every(s => s.pts.every(inR)));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  keepRaw.forEach(e => e.subs.forEach(s => s.pts.forEach(p => { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); })));
  const W = Math.max(1e-6, maxx - minx), H = Math.max(1e-6, maxy - miny);
  // Einheit: aus dem Kopf, sonst aus der Größe raten (Gebäude sind 5–300 m groß)
  let unitGuess = false;
  if (!unitMm) {
    if (DXF_UNITS[insunits]) unitMm = DXF_UNITS[insunits][1];
    else { unitGuess = true; const ext = Math.max(W, H); unitMm = ext > 2000 ? 1 : ext > 200 ? 10 : 1000; }
  }
  const lwUnits = (mmPaper) => (mmPaper * 100) / unitMm;          // Linienstärke wie in einem 1:100-Plan
  const els = keepRaw.map((e, k) => {
    const subs = e.subs.map(s => ({ pts: s.pts.map(p => [p[0] - minx, maxy - p[1]]), closed: s.closed, curved: s.curved }));
    const o = { id: k, subs, stroke: e.fill ? null : e.color, fill: e.fill ? e.color : null, sw: e.fill ? 0 : lwUnits(e.lw), layer: e.layer };
    o.box = bboxOf(subs); o.len = subs.reduce((a, s) => a + plen(s.pts, s.closed), 0); o.curved = subs.some(s => s.curved);
    return o;
  });
  const tx = texts.filter(t => inR([t.box[0], t.box[1]])).map(t => ({ box: [t.box[0] - minx, maxy - t.box[3], t.box[2] - minx, maxy - t.box[1]], layer: t.layer }));
  const cnt = new Map(); els.forEach(e => cnt.set(e.layer, (cnt.get(e.layer) || 0) + 1)); tx.forEach(t => { if (!cnt.has(t.layer)) cnt.set(t.layer, 0); });
  return { W, H, unitMm, unitGuess, insunits, els, texts: tx, ox0: minx, oy0: -maxy, dxf: true,
    layers: [...cnt.entries()].map(([name, n]) => ({ name, n, color: hex(aci(layerOf(name).color)) })).sort((a, b) => a.name.localeCompare(b.name, 'de')) };
}
