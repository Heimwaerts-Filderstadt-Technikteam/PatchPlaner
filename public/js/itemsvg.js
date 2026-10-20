// Geräte-Geometrie und SVG für beide Ausrichtungen.
// Ports sind beschriftete Tabs in der Kabelfarbe, die über die Gerätekante hinausragen.
import { typeOf } from './consts.js';
import { esc, trunc } from './ui.js';

const FS = 11;            // Schriftgröße der Port-Tabs
const TAB_H = 20;         // Höhe eines Tabs
const OUT = 10;           // so weit ragt ein Tab über die Kante
const ROW = 24;           // Zeilenabstand (Links → Rechts)
const HEAD = 34, EL = 14, PAD = 8;
const CH = FS * 0.6;      // ungefähre Zeichenbreite

const cache = new Map();
export function clearLayoutCache() { cache.clear(); }

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const tabW = (label) => clampN(Math.ceil(String(label).length * CH) + 18, 48, 150);
const fitLabel = (label, w) => trunc(label, Math.max(3, Math.floor((w - 14) / CH)));
const label = (p) => (p.dir === 'io' ? '⇄ ' : '') + p.name;

// Lesbare Textfarbe auf einer Hintergrundfarbe
export function textOn(hex) {
  const m = String(hex || '').match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#14181c' : '#ffffff';
}

export function layout(it, orient) {
  const els = (it.elements || []).filter(Boolean);
  const title = it.label || it.name, sub = it.label ? it.name : (it.inv || '');
  const key = orient + '|' + it.ports.map(p => p.id + p.dir + p.name).join(',') + '|' + els.join('¦') + '|' + title + '|' + sub;
  const c = cache.get(it.id);
  if (c && c.key === key) return c.g;
  const ins = [], outs = [], ios = [];
  it.ports.forEach(p => (p.dir === 'in' ? ins : p.dir === 'out' ? outs : ios).push(p));
  const headW = Math.max(title.length * 13 * 0.56, sub.length * 10 * 0.56) + 28;
  const elH = els.length ? els.length * EL + 4 : 0;
  const map = {}, tabs = [];
  let g;
  if (orient === 'tb') {
    const top = [...ins, ...ios], bot = [...outs, ...ios];
    const colW = Math.max(56, ...[...top, ...bot].map(p => tabW(label(p)))) + 6;
    const cols = Math.max(top.length, bot.length, 1);
    const w = Math.max(190, cols * colW + 16, headW, ...els.map(e => e.length * 10 * 0.55 + 24));
    const inner = TAB_H - OUT;
    const hy = inner + 8;
    const h = hy + HEAD + elH + 8 + inner;
    const xAt = (n, i) => (w - n * colW) / 2 + colW * (i + 0.5);
    top.forEach((p, i) => {
      const x = xAt(top.length, i);
      (map[p.id] = map[p.id] || { dir: p.dir, anchors: [] }).anchors.push({ x, y: -OUT, side: 'T' });
      tabs.push({ p, side: 'T', x: x - (colW - 6) / 2, y: -OUT, w: colW - 6, align: 'middle' });
    });
    bot.forEach((p, i) => {
      const x = xAt(bot.length, i);
      (map[p.id] = map[p.id] || { dir: p.dir, anchors: [] }).anchors.push({ x, y: h + OUT, side: 'B' });
      tabs.push({ p, side: 'B', x: x - (colW - 6) / 2, y: h + OUT - TAB_H, w: colW - 6, align: 'middle' });
    });
    g = { orient, w, h, map, tabs, els, hy, title, sub };
  } else {
    const inW = ins.length ? Math.max(...ins.map(p => tabW(p.name))) : 0;
    const outW = outs.length ? Math.max(...outs.map(p => tabW(p.name))) : 0;
    const ioW = ios.length ? Math.max(...ios.map(p => tabW(label(p)))) + 24 : 0;
    const w = Math.max(200, inW + outW + 28 - 2 * OUT, ioW, headW, ...els.map(e => e.length * 10 * 0.55 + 24));
    const p0 = HEAD + elH + PAD;
    const rows = Math.max(ins.length, outs.length);
    ins.forEach((p, i) => { const y = p0 + i * ROW; map[p.id] = { dir: 'in', anchors: [{ x: -OUT, y: y + TAB_H / 2, side: 'L' }] }; tabs.push({ p, side: 'L', x: -OUT, y, w: inW, align: 'start' }); });
    outs.forEach((p, i) => { const y = p0 + i * ROW; map[p.id] = { dir: 'out', anchors: [{ x: w + OUT, y: y + TAB_H / 2, side: 'R' }] }; tabs.push({ p, side: 'R', x: w + OUT - outW, y, w: outW, align: 'end' }); });
    const gap = rows && ios.length ? 6 : 0, ioTop = p0 + rows * ROW + gap;
    ios.forEach((p, i) => {
      const y = ioTop + i * ROW;
      map[p.id] = { dir: 'io', anchors: [{ x: -OUT, y: y + TAB_H / 2, side: 'L' }, { x: w + OUT, y: y + TAB_H / 2, side: 'R' }] };
      tabs.push({ p, side: 'LR', x: -OUT, y, w: w + 2 * OUT, align: 'middle' });
    });
    const h = Math.max(p0 + 4, ioTop + ios.length * ROW + PAD - (ios.length || rows ? 4 : 0));
    g = { orient, w, h, map, tabs, els, title, sub };
  }
  cache.set(it.id, { key, g });
  return g;
}

// Ankerpunkt eines Ports in Weltkoordinaten. toward = Richtung des Gegenübers (für I/O mit zwei Anschlüssen)
export function anchorOf(it, pid, orient, ds, toward, forceSide) {
  const g = layout(it, orient), m = g.map[pid];
  if (!m) return null;
  let a = m.anchors[0];
  if (m.anchors.length > 1) {
    if (forceSide && forceSide !== 'LR') a = m.anchors.find(x => x.side === forceSide) || a;
    else if (toward) {
      if (orient === 'tb') a = toward.y < it.y + (g.h * ds) / 2 ? m.anchors.find(x => x.side === 'T') : m.anchors.find(x => x.side === 'B');
      else a = toward.x < it.x + (g.w * ds) / 2 ? m.anchors.find(x => x.side === 'L') : m.anchors.find(x => x.side === 'R');
    }
  }
  return { x: it.x + a.x * ds, y: it.y + a.y * ds, side: a.side };
}

// Inneres SVG eines Geräts (Ursprung oben links, unskaliert)
export function itemInner(it, orient, used = () => false) {
  const g = layout(it, orient);
  const headFg = textOn(it.color);
  const tt = (p) => `<title>${esc(p.name)} · ${esc(typeOf(p.type).name)} · ${p.dir === 'io' ? 'Ein- und Ausgang (I/O)' : p.dir === 'in' ? 'Eingang' : 'Ausgang'}</title>`;
  let o = `<title>${esc(it.name)}${it.inv ? ' · ' + esc(it.inv) : ''}${it.notes ? '\n' + esc(it.notes) : ''}</title>`;
  o += `<rect class="body" width="${g.w}" height="${g.h}" rx="7"/>`;
  // Kopfzeile
  if (orient === 'tb') {
    o += `<rect x="0" y="${g.hy}" width="${g.w}" height="${HEAD}" fill="${esc(it.color)}"/>`;
    o += `<text class="t-head" x="${g.w / 2}" y="${g.hy + (g.sub ? 15 : 22)}" text-anchor="middle" style="fill:${headFg}">${esc(g.title)}</text>`;
    if (g.sub) o += `<text class="t-sub" x="${g.w / 2}" y="${g.hy + 28}" text-anchor="middle" style="fill:${headFg}">${esc(g.sub)}</text>`;
    g.els.forEach((e, i) => { o += `<text class="t-el" x="${g.w / 2}" y="${g.hy + HEAD + 13 + i * EL}" text-anchor="middle">${esc(e)}</text>`; });
  } else {
    o += `<path d="M0 7a7 7 0 0 1 7-7h${g.w - 14}a7 7 0 0 1 7 7v${HEAD - 7}h-${g.w}z" fill="${esc(it.color)}"/>`;
    o += `<text class="t-head" x="12" y="${g.sub ? 15 : 22}" style="fill:${headFg}">${esc(g.title)}</text>`;
    if (g.sub) o += `<text class="t-sub" x="12" y="28" style="fill:${headFg}">${esc(g.sub)}</text>`;
    g.els.forEach((e, i) => { o += `<text class="t-el" x="12" y="${HEAD + 13 + i * EL}">${esc(e)}</text>`; });
  }
  // Port-Tabs
  for (const t of g.tabs) {
    const color = typeOf(t.p.type).color, on = used(t.p);
    const txt = fitLabel(t.side === 'LR' || orient === 'tb' ? label(t.p) : t.p.name, t.w);
    const tx = t.align === 'start' ? t.x + 8 : t.align === 'end' ? t.x + t.w - 8 : t.x + t.w / 2;
    const fg = on ? textOn(color) : null;
    o += `<g class="ptab${on ? ' on' : ''}" data-port="${t.p.id}" data-side="${t.side}">${tt(t.p)}` +
      `<rect class="tab-bg" x="${t.x}" y="${t.y}" width="${t.w}" height="${TAB_H}" rx="5"/>` +
      `<rect class="tab-fg" x="${t.x}" y="${t.y}" width="${t.w}" height="${TAB_H}" rx="5" fill="${color}" fill-opacity="${on ? 1 : 0.18}" stroke="${color}"/>` +
      `<text class="t-port" x="${tx}" y="${t.y + TAB_H / 2 + FS * 0.36}" text-anchor="${t.align}"${fg ? ` style="fill:${fg}"` : ''}>${esc(txt)}</text></g>`;
  }
  return { svg: o, w: g.w, h: g.h };
}

// Eigenständige Vorschau (Builder, Bibliothek)
export function itemPreviewSVG(gear, orient = 'ltr', maxW = 260) {
  const it = { id: 'pv-' + (gear.id || 'x') + orient, name: gear.name || 'Gerät', label: '', inv: gear.gear_id || '', color: gear.color || '#4a5560', elements: gear.elements || [],
    ports: (gear.ports || []).map((p, i) => ({ id: 'p' + i, ...p })) };
  cache.delete(it.id);
  const r = itemInner(it, orient);
  const pad = OUT + 4;
  return `<svg class="itemsvg" viewBox="${-pad} ${-pad} ${r.w + pad * 2} ${r.h + pad * 2}" style="max-width:${maxW}px;width:100%" role="img" aria-label="Vorschau ${esc(it.name)}"><g class="item">${r.svg}</g></svg>`;
}
