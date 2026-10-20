// Orthogonales Kabel-Routing um Geräte herum (A* auf einem Sichtbarkeitsgitter) und Kabelsprünge

class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const sideDir = { R: 0, B: 1, L: 2, T: 3 };

// A2/B2: Stummel-Endpunkte außerhalb der Geräte; sA/sB: Seiten; obstacles: [{x,y,w,h}] (bereits um margin vergrößert)
export function routeOrtho(A2, sA, B2, sB, obstacles, opts = {}) {
  const bend = opts.bend ?? 30;
  const inside = (x, y) => { for (const o of obstacles) if (x > o.x + 0.01 && x < o.x + o.w - 0.01 && y > o.y + 0.01 && y < o.y + o.h - 0.01) return true; return false; };
  if (inside(A2.x, A2.y) || inside(B2.x, B2.y)) return null;
  const xsS = new Set([A2.x, B2.x]), ysS = new Set([A2.y, B2.y]);
  for (const o of obstacles) { xsS.add(o.x); xsS.add(o.x + o.w); ysS.add(o.y); ysS.add(o.y + o.h); }
  const pad = 40;
  let minX = Math.min(A2.x, B2.x), maxX = Math.max(A2.x, B2.x), minY = Math.min(A2.y, B2.y), maxY = Math.max(A2.y, B2.y);
  for (const o of obstacles) { minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x + o.w); minY = Math.min(minY, o.y); maxY = Math.max(maxY, o.y + o.h); }
  xsS.add(minX - pad); xsS.add(maxX + pad); ysS.add(minY - pad); ysS.add(maxY + pad);
  const withMid = (s) => { const a = [...s].sort((p, q) => p - q); const out = []; for (let i = 0; i < a.length; i++) { if (i && a[i] - a[i - 1] > 1) out.push((a[i] + a[i - 1]) / 2); out.push(a[i]); } return out; };
  const xs = withMid(xsS), ys = withMid(ysS);
  const nx = xs.length, ny = ys.length;
  if (nx * ny > 90000) return null;
  const ix = (v, arr) => { let lo = 0, hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] === v) return m; if (arr[m] < v) lo = m + 1; else hi = m - 1; } return -1; };
  const sx = ix(A2.x, xs), sy = ix(A2.y, ys), tx = ix(B2.x, xs), ty = ix(B2.y, ys);
  if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
  const blocked = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (inside(xs[i], ys[j])) blocked[j * nx + i] = 1;
  const edgeOk = (i, j, d) => {
    const i2 = i + DX[d], j2 = j + DY[d];
    if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny || blocked[j2 * nx + i2]) return false;
    return !inside((xs[i] + xs[i2]) / 2, (ys[j] + ys[j2]) / 2);
  };
  const N = nx * ny * 4;
  const gScore = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const h = (i, j) => Math.abs(xs[i] - B2.x) + Math.abs(ys[j] - B2.y);
  const heap = new Heap();
  const d0 = sideDir[sA] ?? 0;
  const s0 = ((sy * nx + sx) << 2) | d0;
  gScore[s0] = 0; heap.push({ s: s0, f: h(sx, sy) });
  const endDir = sB != null ? (sideDir[sB] + 2) % 4 : -1; // Ankunftsrichtung in den Zielstummel
  let goal = -1, iter = 0;
  while (heap.size) {
    if (++iter > 400000) return null;
    const { s } = heap.pop();
    const d = s & 3, cell = s >> 2, i = cell % nx, j = (cell / nx) | 0;
    if (i === tx && j === ty) { goal = s; break; }
    const g0 = gScore[s];
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // keine Kehrtwende
      if (!edgeOk(i, j, nd)) continue;
      const i2 = i + DX[nd], j2 = j + DY[nd];
      let cost = Math.abs(xs[i2] - xs[i]) + Math.abs(ys[j2] - ys[j]);
      if (nd !== d) cost += bend;
      if (i2 === tx && j2 === ty && endDir >= 0 && nd !== endDir) cost += bend;
      const ns = ((j2 * nx + i2) << 2) | nd;
      const g = g0 + cost;
      if (g < gScore[ns]) { gScore[ns] = g; from[ns] = s; heap.push({ s: ns, f: g + h(i2, j2) }); }
    }
  }
  if (goal < 0) return null;
  const pts = [];
  for (let s = goal; s !== -1; s = from[s]) { const cell = s >> 2; pts.push({ x: xs[cell % nx], y: ys[(cell / nx) | 0] }); }
  pts.reverse();
  return simplify(pts);
}

export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.01 && Math.abs(out[out.length - 1].y - p.y) < 0.01) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

// SVG-Pfad mit Sprüngen über früher gezeichnete Kabel
export function pathWithHops(pts, earlierSegs, r) {
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const horiz = Math.abs(a.y - b.y) < 0.01, vert = Math.abs(a.x - b.x) < 0.01;
    const hops = [];
    if (r > 0 && (horiz || vert)) {
      const len = horiz ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
      for (const s of earlierSegs) {
        if (horiz && s.v) {
          if (s.x > Math.min(a.x, b.x) + r * 1.5 && s.x < Math.max(a.x, b.x) - r * 1.5 && a.y > s.y1 + r && a.y < s.y2 - r) hops.push(s.x);
        } else if (vert && s.h) {
          if (s.y > Math.min(a.y, b.y) + r * 1.5 && s.y < Math.max(a.y, b.y) - r * 1.5 && a.x > s.x1 + r && a.x < s.x2 - r) hops.push(s.y);
        }
      }
      if (len < r * 4) hops.length = 0;
    }
    if (!hops.length) { d += ` L${f(b.x)} ${f(b.y)}`; continue; }
    const dir = horiz ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y);
    hops.sort((p, q) => (p - q) * dir);
    let last = -Infinity;
    for (const c of hops) {
      if (Math.abs(c - last) < r * 2.2) continue;
      last = c;
      if (horiz) d += ` L${f(c - r * dir)} ${f(a.y)} A${f(r)} ${f(r)} 0 0 ${dir > 0 ? 1 : 0} ${f(c + r * dir)} ${f(a.y)}`;
      else d += ` L${f(a.x)} ${f(c - r * dir)} A${f(r)} ${f(r)} 0 0 ${dir > 0 ? 0 : 1} ${f(a.x)} ${f(c + r * dir)}`;
    }
    d += ` L${f(b.x)} ${f(b.y)}`;
  }
  return d;
}
export function segmentsOf(pts) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (Math.abs(a.x - b.x) < 0.01) out.push({ v: true, x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
    else if (Math.abs(a.y - b.y) < 0.01) out.push({ h: true, y: a.y, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) });
  }
  return out;
}
const f = (n) => (Math.round(n * 10) / 10).toString();
