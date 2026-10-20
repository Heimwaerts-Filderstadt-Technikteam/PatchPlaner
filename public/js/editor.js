// PatchPlaner Plan-Editor
import { api, clientId, ApiError } from './api.js';
import { U, TYPES, FT_LENS, typeOf, DIRS, COLORS, COLNAMES, SYMS, SHAPES, CATCOL, units, toUser, fromUser, uName, fmtLen, fmtNum, M_PER_FT } from './consts.js';
import { $, $$, esc, trunc, uid, clamp, toast, modal, armButton, copyText, download, relTime, fmtDate, initials, avatarColor, debounce } from './ui.js';
import { layout, anchorOf, itemInner, clearLayoutCache, itemPreviewSVG } from './itemsvg.js';
import { routeOrtho, simplify, pathWithHops, segmentsOf } from './routing.js';
import { mountPortEditor, portSummary, typeOptions } from './builder.js';
import { renderPlanCanvas, canvasBlob, buildPdf, toCSV, pdfToPngBrowser } from './export.js';

const MARGIN = 10, STUB = 18;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polyLen = (p) => { let l = 0; for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]); return l; };
const normBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy; let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const SIDE_V = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

export async function openEditor(root, opts) {
  const { planId, shareToken, me, config, navigate } = opts;
  const userSettings = (me && me.settings) || {};
  const listeners = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push(() => t.removeEventListener(ev, fn, o)); };
  let destroyed = false;

  /* ---------- Laden ---------- */
  root.innerHTML = `<div class="ed-loading"><div class="spinner"></div><p>Plan wird geladen …</p></div>`;
  let loaded;
  try { loaded = shareToken ? await api.get(`/api/share/${encodeURIComponent(shareToken)}`, { noAuthRedirect: true }) : await api.get(`/api/plans/${planId}`); }
  catch (e) {
    root.innerHTML = `<div class="ed-loading"><h2>Plan nicht verfügbar</h2><p>${esc(e.message)}</p>${me ? '<button class="btn pri" data-back>Zu den Plänen</button>' : ''}</div>`;
    root.querySelector('[data-back]')?.addEventListener('click', () => navigate('/plans'));
    return { destroy() {}, canLeave: () => true };
  }
  const meta = { ...loaded }; delete meta.data; delete meta.checks; delete meta.assets;
  const readonly = !!shareToken || loaded.access === 'view';
  let S = normalize(loaded.data);
  let checks = loaded.checks || {};
  const assets = new Map((loaded.assets || []).map(a => [a.id, a]));
  const assetUrl = (id) => `/api/assets/${id}${shareToken ? '?s=' + encodeURIComponent(shareToken) : ''}`;
  let version = loaded.version;

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const s = {
      v: 3, orient: d.orient || userSettings.orient || 'tb', ds: d.ds ?? 0.8, grid: d.grid ?? true, labels: d.labels ?? true, legend: d.legend ?? true,
      strict: d.strict ?? false, hops: d.hops ?? true, packZones: d.packZones ?? false,
      floors: Array.isArray(d.floors) ? d.floors : [], items: Array.isArray(d.items) ? d.items : [], cables: Array.isArray(d.cables) ? d.cables : [],
      shapes: Array.isArray(d.shapes) ? d.shapes : [], extras: Array.isArray(d.extras) ? d.extras : [],
      settings: { endSlack: userSettings.endSlack ?? 1, heightAdd: 0, reserve: userSettings.reserve ?? 10, roundUp: userSettings.roundUp ?? true, route: 'auto', ...(d.settings || {}) },
    };
    s.items.forEach(it => { it.ports = it.ports || []; it.elements = it.elements || []; it.ports.forEach(p => { p.id = p.id || uid(); }); });
    s.cables.forEach(c => { c.wps = c.wps || []; c.extra = c.extra || 0; });
    return s;
  }

  /* ---------- Gerüst ---------- */
  root.innerHTML = `
  <div class="editor${readonly ? ' readonly' : ''}">
    <header class="ed-top">
      <div class="ed-left">
        ${me && !shareToken ? '<button class="btn ghost" data-act="exit" title="Zurück zu den Plänen">← Pläne</button>' : '<a class="brand-mini" href="/">Patch<i>Planer</i></a>'}
        <input id="edName" class="ed-name" aria-label="Planname" ${readonly ? 'readonly' : ''}>
        <span class="savestate" id="saveState"></span>
        ${readonly ? '<span class="chip">Nur ansehen</span>' : ''}
        <div class="presence" id="presence"></div>
      </div>
      <div class="tools">
        ${readonly ? '' : `
        <div class="grp" role="group" aria-label="Modus">
          <button data-mode="select" class="on" title="Auswählen (V)">Auswählen</button>
          <button data-mode="calib" title="Maßstab am Grundriss setzen (K)">Maßstab</button>
          <button data-mode="measure" title="Strecke messen (M)">Messen</button>
        </div>
        <div class="grp">
          <button data-act="draw" id="bDraw" title="Zeichenwerkzeuge (Shift+D)">Zeichnen</button>
          <button data-act="undo" id="bUndo" title="Rückgängig (Strg+Z)" aria-label="Rückgängig">↶</button>
          <button data-act="redo" id="bRedo" title="Wiederholen (Strg+Shift+Z)" aria-label="Wiederholen">↷</button>
        </div>`}
        <div class="grp">
          ${readonly ? '<button data-mode="measure" title="Strecke messen (M)">Messen</button>' : '<button data-act="grid" id="bGrid" title="Am Raster ausrichten (G)">Raster</button>'}
          ${readonly ? '' : '<button data-act="orient" id="bOrient" title="Ausrichtung umschalten (L)">LTR</button>'}
          <button data-act="fit" title="Alles einpassen (F)">Einpassen</button>
          <button data-act="zoomout" title="Verkleinern (−)" aria-label="Verkleinern">−</button>
          <button data-act="zoomin" title="Vergrößern (+)" aria-label="Vergrößern">+</button>
        </div>
        <div class="grp">
          ${readonly ? '' : '<button data-act="share">Teilen</button>'}
          <button data-act="export">Export</button>
          <button data-act="help" title="Tastenkürzel (?)" aria-label="Hilfe">?</button>
        </div>
      </div>
    </header>
    <div class="ed-main">
      ${readonly ? '' : `<aside class="side lib" id="lib">
        <div class="lib-head">
          <div class="seg full" role="tablist"><button data-ltab="mine" class="on">Meine Geräte</button><button data-ltab="community">Community</button></div>
          <input class="inp" id="libSearch" placeholder="Geräte suchen …" aria-label="Geräte suchen">
          <button class="btn pri" data-act="newgear">+ Gerät bauen</button>
        </div>
        <div class="lib-list" id="libList"><p class="hint">Lade Geräte …</p></div>
      </aside>`}
      <section class="stage" id="stage">
        <svg id="svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="gMin" patternUnits="userSpaceOnUse" width="10" height="10"><path id="gMinP" class="gridline" fill="none"/></pattern>
            <pattern id="gMaj" patternUnits="userSpaceOnUse" width="250" height="250"><path id="gMajP" class="gridmaj" fill="none"/></pattern>
          </defs>
          <g id="world">
            <g id="lFloors"></g>
            <rect id="gridA" class="gridrect" fill="url(#gMin)" pointer-events="none"/>
            <rect id="gridB" class="gridrect" fill="url(#gMaj)" pointer-events="none"/>
            <g id="lZones"></g><g id="lShapes"></g><g id="lCables"></g><g id="lItems"></g><g id="lText"></g><g id="lOver"></g>
          </g>
        </svg>
        <div class="dtb" id="dtb" hidden></div>
        <div class="legend" id="legend" hidden></div>
        <div class="scalebar" id="scalebar"></div>
        <div class="zoomlbl" id="zoomlbl"></div>
        <div class="hud" id="hud" hidden></div>
        <div class="banner" id="banner" hidden></div>
      </section>
      <aside class="side insp" id="insp">
        <nav class="tabs" role="tablist">
          <button data-tab="sel" class="on">Auswahl</button><button data-tab="plan">Plan</button><button data-tab="pack">Packliste</button><button data-tab="patch">Patches</button>
        </nav>
        <div class="pane" id="pane"></div>
      </aside>
    </div>
    <div class="ctx" id="ctx" hidden></div>
    <input type="file" id="fFloor" accept="image/*,.pdf,application/pdf" hidden>
    <input type="file" id="fJson" accept=".json,application/json" hidden>
  </div>`;
  const E = root.querySelector('.editor');
  const svg = $('#svg', E), world = $('#world', E), pane = $('#pane', E), ctxEl = $('#ctx', E);

  /* ---------- Zustand ---------- */
  let view = { x: 40, y: 40, z: 0.6 };
  let sel = { ids: new Set(), cable: null };
  let mode = 'select', drawTool = null, tab = 'sel';
  let undoS = [], redoS = [];
  let calib = null, measure = null, drag = null, hlType = null;
  let fastRoute = false;
  const routeCache = new Map();
  let presenceList = [];

  const itemById = (id) => S.items.find(i => i.id === id);
  const shapeById = (id) => S.shapes.find(s => s.id === id);
  const cableById = (id) => S.cables.find(c => c.id === id);
  const floorById = (id) => S.floors.find(f => f.id === id);
  const portOf = (it, pid) => it && it.ports.find(p => p.id === pid);

  /* ---------- Speichern ---------- */
  let dirty = false, saving = false, saveAgain = false, conflict = false, lastThumb = 0, retryT = null, changeSeq = 0;
  const setSaveState = (txt, cls = '') => { const el = $('#saveState', E); if (el) { el.textContent = txt; el.className = 'savestate ' + cls; } };
  const scheduleSave = debounce(() => save(), 700);
  function markDirty() {
    if (readonly) return;
    dirty = true; changeSeq++;
    if (!conflict) { setSaveState('Ungespeichert …'); scheduleSave(); }
  }
  async function save(force) {
    if (readonly || destroyed && !force) return;
    if (conflict && !force) return;
    if (saving) { saveAgain = true; return; }
    if (!dirty) return;
    saving = true; const seq = changeSeq; setSaveState('Speichert …');
    try {
      const r = await api.put(`/api/plans/${planId}`, { version, data: S });
      version = r.version; meta.version = version;
      if (seq === changeSeq) dirty = false;
      setSaveState('Gespeichert', 'ok');
      if (Date.now() - lastThumb > 45000) { lastThumb = Date.now(); makeThumb(); }
    } catch (e) {
      if (e.status === 409) { conflict = true; showConflict(e.body); setSaveState('Konflikt', 'bad'); }
      else if (e.status === 0 || e.status >= 500) { setSaveState('Offline – neuer Versuch …', 'bad'); clearTimeout(retryT); retryT = setTimeout(() => save(), 5000); }
      else { setSaveState('Nicht gespeichert', 'bad'); toast(e.message, 5000, 'bad'); }
    } finally {
      saving = false;
      if (saveAgain) { saveAgain = false; if (dirty) save(); }
      else if (dirty && !conflict) scheduleSave();
    }
  }
  function showConflict(body) {
    const b = $('#banner', E);
    b.hidden = false;
    b.innerHTML = `<b>${esc(body?.by || 'Jemand')} hat den Plan gerade geändert.</b><span>Deine letzten Änderungen sind noch nicht gespeichert.</span>
      <button class="btn sm" data-c="reload">Neu laden und meine verwerfen</button><button class="btn sm pri" data-c="mine">Meine Version speichern</button>`;
  }
  on($('#banner', E), 'click', async (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return;
    $('#banner', E).hidden = true;
    if (c === 'reload') { conflict = false; dirty = false; await reloadFromServer(); }
    if (c === 'mine') { try { const cur = await api.get(`/api/plans/${planId}`); version = cur.version; conflict = false; dirty = true; save(); } catch (er) { toast(er.message); } }
    if (c === 'refresh') { await reloadFromServer(); }
  });
  async function reloadFromServer(by) {
    try {
      const cur = await api.get(`/api/plans/${planId}`);
      S = normalize(cur.data); version = cur.version; checks = cur.checks || {};
      (cur.assets || []).forEach(a => assets.set(a.id, a));
      Object.assign(meta, { name: cur.name, job_id: cur.job_id, venue: cur.venue, rig_date: cur.rig_date, event_date: cur.event_date, project_id: cur.project_id, team_id: cur.team_id });
      undoS = []; redoS = []; cleanSel(); clearLayoutCache(); routeCache.clear();
      changed(false); setSaveState('Gespeichert', 'ok');
      if (by) toast(`Aktualisiert – Änderung von ${by}.`);
    } catch (e) { toast(e.message); }
  }
  async function makeThumb() {
    if (readonly || !S.items.length && !S.floors.length) return;
    try {
      const cv = await exportCanvas({ scale: 1, maxDim: 520, bg: '#f4f5f6', floors: true });
      const url = cv.toDataURL('image/jpeg', 0.72);
      await api.put(`/api/plans/${planId}/thumb`, { thumb: url });
    } catch { /* egal */ }
  }
  let pendingMeta = {};
  const flushMeta = debounce(async () => {
    const f = pendingMeta; pendingMeta = {};
    try { await api.put(`/api/plans/${planId}`, f); if (!dirty) setSaveState('Gespeichert', 'ok'); }
    catch (e) { toast(e.message, 4000, 'bad'); }
  }, 450);
  function setMeta(k, v) { meta[k] = v; pendingMeta[k] = v; setSaveState('Speichert …'); flushMeta(); }

  /* ---------- Undo ---------- */
  const snapshot = () => JSON.stringify(S);
  function pushUndo() { if (readonly) return; undoS.push(snapshot()); if (undoS.length > 100) undoS.shift(); redoS = []; updUndo(); }
  function doUndo() { if (!undoS.length) return; redoS.push(snapshot()); S = JSON.parse(undoS.pop()); cleanSel(); clearLayoutCache(); changed(); }
  function doRedo() { if (!redoS.length) return; undoS.push(snapshot()); S = JSON.parse(redoS.pop()); cleanSel(); clearLayoutCache(); changed(); }
  function updUndo() { const u = $('#bUndo', E), r = $('#bRedo', E); if (u) u.disabled = !undoS.length; if (r) r.disabled = !redoS.length; }
  function cleanSel() { for (const id of [...sel.ids]) if (!itemById(id) && !shapeById(id)) sel.ids.delete(id); if (sel.cable && !cableById(sel.cable)) sel.cable = null; }

  /* ---------- Geometrie ---------- */
  const lay = (it) => layout(it, S.orient);
  function itemBox(it) { const g = lay(it); return { x: it.x, y: it.y, w: g.w * S.ds, h: g.h * S.ds }; }
  function center(it) { const b = itemBox(it); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  const anchor = (it, pid, toward, side) => anchorOf(it, pid, S.orient, S.ds, toward, side);
  const stubOf = (A) => { const v = SIDE_V[A.side]; return { x: A.x + v[0] * STUB, y: A.y + v[1] * STUB, side: A.side }; };
  function simpleOrtho(A2, B2) {
    const hA = A2.side === 'L' || A2.side === 'R', hB = B2.side === 'L' || B2.side === 'R';
    if (hA && hB) { const mx = (A2.x + B2.x) / 2; return [A2, { x: mx, y: A2.y }, { x: mx, y: B2.y }, B2]; }
    if (!hA && !hB) { const my = (A2.y + B2.y) / 2; return [A2, { x: A2.x, y: my }, { x: B2.x, y: my }, B2]; }
    return hA ? [A2, { x: B2.x, y: A2.y }, B2] : [A2, { x: A2.x, y: B2.y }, B2];
  }
  function obstaclesFor(A2, B2) {
    const r = Math.max(160, dist(A2, B2) * 0.6);
    const bx = { x: Math.min(A2.x, B2.x) - r, y: Math.min(A2.y, B2.y) - r, x2: Math.max(A2.x, B2.x) + r, y2: Math.max(A2.y, B2.y) + r };
    const out = [];
    for (const it of S.items) {
      const b = itemBox(it);
      if (b.x + b.w < bx.x || b.x > bx.x2 || b.y + b.h < bx.y || b.y > bx.y2) continue;
      out.push({ x: b.x - MARGIN, y: b.y - MARGIN, w: b.w + 2 * MARGIN, h: b.h + 2 * MARGIN });
    }
    return out;
  }
  function cablePts(c) {
    const a = itemById(c.from.item), b = itemById(c.to.item); if (!a || !b) return null;
    const wps = c.wps || [];
    const A = anchor(a, c.from.port, wps[0] || center(b)), B = anchor(b, c.to.port, wps[wps.length - 1] || center(a));
    if (!A || !B) return null;
    const A2 = stubOf(A), B2 = stubOf(B);
    if (wps.length) return [A, A2, ...wps, B2, B];
    const rmode = c.route || S.settings.route;
    if (rmode === 'direct') return [A, A2, B2, B];
    if (rmode === 'ortho') return [A, ...simpleOrtho(A2, B2), B];
    const obs = obstaclesFor(A2, B2);
    const key = `${A2.x.toFixed(1)},${A2.y.toFixed(1)},${A2.side}|${B2.x.toFixed(1)},${B2.y.toFixed(1)},${B2.side}|` + obs.map(o => `${o.x.toFixed(0)},${o.y.toFixed(0)},${o.w.toFixed(0)},${o.h.toFixed(0)}`).join(';');
    let r = routeCache.get(c.id);
    if ((!r || r.key !== key) && fastRoute) return [A, ...simpleOrtho(A2, B2), B];
    if (!r || r.key !== key) {
      let route = null;
      try { route = routeOrtho(A2, A2.side, B2, B2.side, obs); } catch { route = null; }
      r = { key, pts: route ? [A, ...route, B] : [A, ...simpleOrtho(A2, B2), B] };
      routeCache.set(c.id, r);
    }
    return r.pts.map((p, i) => (i === 0 ? A : i === r.pts.length - 1 ? B : p));
  }
  function packLen(type, m) {
    const s = S.settings;
    if (typeOf(type).nocable) return { len: 0, std: false, drum: false };
    if (units.mode === 'ft') {
      const ft = m / M_PER_FT;
      if (!s.roundUp) return { len: Math.ceil(ft - 1e-9) * M_PER_FT, std: false, drum: false };
      const f = FT_LENS.find(x => x >= ft - 1e-9);
      return f != null ? { len: f * M_PER_FT, std: true, drum: false } : { len: Math.ceil(ft / 50) * 50 * M_PER_FT, std: false, drum: true };
    }
    if (!s.roundUp) return { len: Math.ceil(m - 1e-9), std: false, drum: false };
    const L = typeOf(type).lens; const f = L.find(x => x >= m - 1e-9);
    if (f != null) return { len: f, std: true, drum: false };
    return { len: Math.ceil(m / 10) * 10, std: false, drum: true };
  }
  function calc(c, pts) {
    pts = pts || cablePts(c); if (!pts) return null; const s = S.settings;
    if (typeOf(c.type).nocable) return { pts, geo: polyLen(pts) / U, slack: 0, height: 0, extra: 0, reserve: 0, total: 0, final: 0, pack: { len: 0 }, nocable: true };
    const geo = polyLen(pts) / U, slack = 2 * (+s.endSlack || 0), height = +s.heightAdd || 0, extra = +c.extra || 0;
    const sub = geo + slack + height + extra, reserve = sub * ((+s.reserve || 0) / 100), total = sub + reserve;
    const final = c.override > 0 ? +c.override : total;
    return { pts, geo, slack, height, extra, reserve, total, final, pack: packLen(c.type, final) };
  }
  function cableIds() { const cnt = {}, ids = {}; S.cables.forEach(c => { const t = typeOf(c.type); cnt[c.type] = (cnt[c.type] || 0) + 1; ids[c.id] = c.label || (t.short + ' ' + String(cnt[c.type]).padStart(2, '0')); }); return ids; }
  function adaptersOf(c) {
    const out = []; const a = portOf(itemById(c.from.item), c.from.port), b = portOf(itemById(c.to.item), c.to.port);
    [a, b].forEach(p => { if (p && p.type !== c.type && !typeOf(c.type).nocable) out.push([c.type, p.type].sort().map(t => typeOf(t).name).join(' ↔ ')); });
    return out;
  }
  function isBi(c) { const a = portOf(itemById(c.from.item), c.from.port), b = portOf(itemById(c.to.item), c.to.port); return typeOf(c.type).bi || (a && b && a.dir === 'io' && b.dir === 'io'); }
  function connMap() { const m = new Map(); S.cables.forEach(c => { m.set(c.from.item + '/' + c.from.port, c); m.set(c.to.item + '/' + c.to.port, c); }); return m; }
  function zoneOf(p) { for (let i = S.shapes.length - 1; i >= 0; i--) { const z = S.shapes[i]; if (z.kind === 'zone' && p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) return z; } return null; }
  const itemName = (it) => it.label || it.name;

  /* ---------- Rendern ---------- */
  let raf = 0;
  const render = () => { if (raf || destroyed) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function draw() {
    const z = view.z;
    world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${z})`);
    svg.setAttribute('class', `mode-${drawTool ? 'draw' : mode}${hlType ? ' hl' : ''}${drag && drag.kind === 'pan' ? ' panning' : ''}`);
    // Grundrisse
    $('#lFloors', E).innerHTML = S.floors.filter(f => f.visible !== false).map(f => {
      const a = assets.get(f.asset); if (!a) return '';
      return `<image class="floorimg${f.invert ? ' inv' : ''}${f.locked === false && !readonly ? ' unlocked' : ''}" data-floor="${f.id}" href="${assetUrl(f.asset)}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" opacity="${f.opacity ?? 0.9}" preserveAspectRatio="none"/>` +
        (sel.floor === f.id ? `<rect class="selrect" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}"/>` : '');
    }).join('');
    // Raster
    const r = svg.getBoundingClientRect(), x0 = -view.x / z, y0 = -view.y / z, w = r.width / z, h = r.height / z;
    const minor = z > 0.9 ? 10 : U;
    const gm = $('#gMin', E); gm.setAttribute('width', minor); gm.setAttribute('height', minor);
    $('#gMinP', E).setAttribute('d', `M${minor} 0V${minor}H0`); $('#gMinP', E).setAttribute('stroke-width', 1 / z);
    $('#gMajP', E).setAttribute('d', 'M250 0V250H0'); $('#gMajP', E).setAttribute('stroke-width', 1.2 / z);
    ['gridA', 'gridB'].forEach(id => { const g = $('#' + id, E); g.setAttribute('x', x0); g.setAttribute('y', y0); g.setAttribute('width', w); g.setAttribute('height', h); g.style.display = S.grid ? '' : 'none'; });
    $('#lZones', E).innerHTML = S.shapes.filter(s => s.kind === 'zone').map(shapeSVG).join('');
    $('#lShapes', E).innerHTML = S.shapes.filter(s => s.kind !== 'zone' && s.kind !== 'text').map(shapeSVG).join('');
    $('#lText', E).innerHTML = S.shapes.filter(s => s.kind === 'text').map(shapeSVG).join('');
    // Kabel
    const ids = cableIds();
    const polys = S.cables.map(c => ({ c, pts: cablePts(c) }));
    const earlier = [];
    let co = '';
    for (const { c, pts } of polys) {
      if (!pts) continue;
      co += cableSVG(c, pts, ids, S.hops ? earlier : []);
      if (S.hops) earlier.push(...segmentsOf(pts));
    }
    $('#lCables', E).innerHTML = co;
    const cm = connMap();
    $('#lItems', E).innerHTML = S.items.map(it => {
      const inner = itemInner(it, S.orient, (p) => cm.has(it.id + '/' + p.id));
      return `<g class="item${sel.ids.has(it.id) ? ' sel' : ''}" data-item="${it.id}" transform="translate(${it.x} ${it.y}) scale(${S.ds})">${inner.svg}</g>`;
    }).join('');
    $('#lOver', E).innerHTML = overlaySVG();
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const unitM = units.mode === 'ft' ? M_PER_FT : 1;
    const m = nice.find(n => n * unitM * U * z >= 70) || 200;
    $('#scalebar', E).innerHTML = `${m.toLocaleString('de-DE')} ${uName()}<div style="width:${m * unitM * U * z}px"></div>`;
    $('#zoomlbl', E).textContent = Math.round(z * 100) + ' %';
    renderLegend(); renderHud();
  }
  function cableSVG(c, pts, ids, earlier) {
    const r = calc(c, pts); const t = typeOf(c.type), z = view.z;
    const d = pathWithHops(pts, earlier, 5 / z);
    const ad = adaptersOf(c).length;
    let o = `<g class="cable${sel.cable === c.id ? ' sel' : ''}${hlType === c.type ? ' hl' : ''}" data-cable="${c.id}"><path class="hit" d="${d}"/><path class="wire${ad ? ' adapt' : ''}${t.nocable ? ' radio' : ''}" d="${d}" stroke="${t.color}"/>`;
    let bi = 1, bl = -1; for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); if (l > bl) { bl = l; bi = i; } }
    const a = pts[bi - 1], b = pts[bi], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (!isBi(c) && bl * z > 70) {
      const off = Math.min(bl * 0.3, 60 / z); const ax = mx + Math.cos(ang) * off, ay = my + Math.sin(ang) * off, s = 5 / z;
      o += `<path class="arrow" d="M${-s} ${-s} L${s} 0 L${-s} ${s}" stroke="${t.color}" transform="translate(${ax} ${ay}) rotate(${ang * 180 / Math.PI})"/>`;
    }
    if (S.labels && bl * z > 26) {
      const txt = t.nocable ? `${ids[c.id]} · Funk` : `${ids[c.id]} · ${fmtLen(r.pack.len)}${ad ? ' ⚠' : ''}${c.override > 0 ? ' ✎' : ''}`;
      const fs = 10.5 / z, tw = txt.length * fs * 0.6 + 10 / z, th = fs + 7 / z;
      o += `<g class="pillg" transform="translate(${mx} ${my})"><rect class="pill" x="${-tw / 2}" y="${-th / 2}" width="${tw}" height="${th}" rx="${th / 2}" stroke="${t.color}"/><text class="t-pill" font-size="${fs}" text-anchor="middle" y="${fs * 0.36}">${esc(txt)}</text></g>`;
    }
    if (sel.cable === c.id && !readonly) (c.wps || []).forEach((w, i) => { o += `<circle class="wp" data-wp="${i}" cx="${w.x}" cy="${w.y}" r="${6 / z}"><title>Pin – ziehen zum Verschieben, Doppelklick entfernt ihn</title></circle>`; });
    return o + '</g>';
  }
  function shapeBox(s) {
    if (s.kind === 'line' || s.kind === 'arrow') return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
    if (s.kind === 'text') { const L = richLines(s); const fs = s.size || 18; const wMax = Math.max(1, ...L.map(l => l.text.length * l.fs * 0.55 + (l.bullet ? fs : 0))); const pad = s.fill !== 'none' ? 10 : 0; return { x: s.x - pad, y: s.y - pad, w: wMax + pad * 2, h: L.reduce((a, l) => a + l.fs * 1.3, 0) + pad * 2 }; }
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  }
  function richLines(s) {
    const fs = s.size || 18;
    return String(s.text || '').split('\n').map(raw => {
      if (raw.startsWith('## ')) return { text: raw.slice(3), fs: fs * 1.15, bold: true };
      if (raw.startsWith('# ')) return { text: raw.slice(2), fs: fs * 1.4, bold: true };
      if (/^[-*] /.test(raw)) return { text: raw.slice(2), fs, bullet: true };
      return { text: raw, fs, bold: !!s.bold };
    });
  }
  function richTspans(text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map(p => (p.startsWith('**') && p.endsWith('**') ? `<tspan font-weight="700">${esc(p.slice(2, -2))}</tspan>` : esc(p))).join('');
  }
  function shapeSVG(s) {
    const col = COLORS[s.color] || s.color || COLORS.gray, sw = ({ 1: 1.2, 2: 2.2, 3: 3.8 })[s.weight || 2];
    const fill = s.fill === 'none' ? 'none' : col, fo = s.fill === 'tint' ? 0.16 : s.fill === 'solid' ? 0.92 : 0;
    const st = `stroke="${col}" stroke-width="${sw}" fill="${fill}" fill-opacity="${fo}"`;
    const { x, y, w, h } = s, b = shapeBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2, isSel = sel.ids.has(s.id);
    const rot = s.rot ? ` transform="rotate(${s.rot} ${cx} ${cy})"` : '';
    let o = '';
    if (s.kind === 'zone') {
      const fs = 15, tw = Math.max(60, (s.label || 'Zone').length * fs * 0.62 + 16);
      o = `<g class="shape zone${isSel ? ' sel' : ''}" data-shape="${s.id}"><rect class="zfill" x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" fill-opacity="${s.fill === 'none' ? 0 : s.fill === 'solid' ? 0.3 : 0.1}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="10 6" rx="4"/>` +
        `<rect class="zedge" x="${x}" y="${y}" width="${w}" height="${h}"/><rect class="ztab" x="${x}" y="${y - fs - 10}" width="${tw}" height="${fs + 10}" rx="4" fill="${col}"/><text class="t-zone" x="${x + 8}" y="${y - 7}">${esc(s.label || 'Zone')}</text>`;
      if (isSel) o += `<rect class="selrect" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      return o + '</g>';
    }
    o = `<g class="shape${isSel ? ' sel' : ''}" data-shape="${s.id}"${rot}>`;
    switch (s.kind) {
      case 'rect': o += `<rect class="s" x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ${st}/>`; break;
      case 'circle': o += `<ellipse class="s" cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${st}/>`; break;
      case 'tri': o += `<polygon class="s" points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${st}/>`; break;
      case 'half': o += `<path class="s" d="M${x} ${y + h} A${w / 2} ${h} 0 0 1 ${x + w} ${y + h} Z" ${st}/>`; break;
      case 'trap': o += `<polygon class="s" points="${x + w * 0.22},${y} ${x + w * 0.78},${y} ${x + w},${y + h} ${x},${y + h}" ${st}/>`; break;
      case 'line': case 'arrow': {
        const x2 = x + w, y2 = y + h;
        o += `<line class="s" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}"/><line class="hit" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/>`;
        if (s.kind === 'arrow') { const a = Math.atan2(h, w), L = Math.max(10, sw * 5) / view.z; const p1 = [x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45)], p2 = [x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45)];
          o += `<polygon class="s" points="${x2},${y2} ${p1} ${p2}" fill="${col}" stroke="${col}" stroke-width="${sw}"/>`; }
        break;
      }
      case 'sym': {
        const S2 = SYMS[s.sym] || SYMS.person;
        const sf = s.fill === 'none' ? 'none' : col, sfo = s.fill === 'solid' ? 0.9 : s.fill === 'none' ? 0 : 0.18;
        o += `<g transform="translate(${x} ${y}) scale(${w / 100} ${h / 100})" stroke="${col}" stroke-width="${sw}" fill="none" class="symg" style="--sf:${sf};--sfo:${sfo};--col:${col}">${S2.d}</g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>`;
        break;
      }
      case 'text': {
        const L = richLines(s); const fs = s.size || 18; const pad = s.fill !== 'none' ? 10 : 0;
        if (s.fill !== 'none') o += `<rect class="s" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${col}" fill-opacity="${s.fill === 'solid' ? 0.95 : 0.12}" stroke="${col}" stroke-width="${s.fill === 'solid' ? 0 : 1.2}"/>`;
        const tc = s.fill === 'solid' ? '#ffffff' : (s.color && s.color !== 'gray' ? col : null);
        let yy = s.y; let t = '';
        for (const l of L) {
          yy += l.fs * 1.05;
          const tx = s.x + (l.bullet ? fs : 0);
          if (l.bullet) t += `<text class="t-free" x="${s.x + 2}" y="${yy}" font-size="${l.fs}"${tc ? ` style="fill:${tc}"` : ''}>•</text>`;
          t += `<text class="t-free" x="${tx}" y="${yy}" font-size="${l.fs}" font-weight="${l.bold ? 700 : 400}"${tc ? ` style="fill:${tc}"` : ''}>${richTspans(l.text) || ' '}</text>`;
          yy += l.fs * 0.25;
        }
        o += t + `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="transparent"/>`;
        void pad; break;
      }
    }
    if (s.label && s.kind !== 'text') {
      const fs = 14, inside = ['rect', 'circle', 'trap', 'half', 'tri'].includes(s.kind) && b.h > 28;
      const ly = inside ? cy + fs * 0.35 : (s.kind === 'line' || s.kind === 'arrow' ? cy - 8 : b.y + b.h + fs + 2);
      const fc = inside && s.fill === 'solid' ? '#fff' : col;
      o += `<text class="t-shape" x="${cx}" y="${ly}" text-anchor="middle" style="fill:${fc}">${esc(s.label)}</text>`;
    }
    if (isSel) o += `<rect class="selrect" x="${b.x - 4 / view.z}" y="${b.y - 4 / view.z}" width="${b.w + 8 / view.z}" height="${b.h + 8 / view.z}"/>`;
    return o + '</g>';
  }
  function overlaySVG() {
    const z = view.z; let o = '';
    if (sel.ids.size === 1 && mode === 'select' && !readonly) {
      const s = shapeById([...sel.ids][0]);
      if (s) {
        const r = 6 / z;
        if (s.kind === 'line' || s.kind === 'arrow') o += `<circle class="handle" data-h="p1" cx="${s.x}" cy="${s.y}" r="${r}"/><circle class="handle" data-h="p2" cx="${s.x + s.w}" cy="${s.y + s.h}" r="${r}"/>`;
        else if (s.kind !== 'text') {
          const b = shapeBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = (s.rot || 0) * Math.PI / 180;
          const rp = (px, py) => ({ x: cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), y: cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a) });
          const se = rp(b.x + b.w, b.y + b.h); o += `<rect class="handle" data-h="se" x="${se.x - r}" y="${se.y - r}" width="${2 * r}" height="${2 * r}"><title>Größe ändern (Shift = proportional)</title></rect>`;
          if (s.kind !== 'zone') { const top = rp(cx, b.y - 26 / z), t0 = rp(cx, b.y); o += `<line class="rotline" x1="${t0.x}" y1="${t0.y}" x2="${top.x}" y2="${top.y}"/><circle class="handle" data-h="rot" cx="${top.x}" cy="${top.y}" r="${r}"><title>Drehen (Shift = 15°-Schritte)</title></circle>`; }
        }
      }
    }
    if (drag && drag.kind === 'link' && drag.cur) o += `<line class="templink" x1="${drag.a.x}" y1="${drag.a.y}" x2="${drag.cur.x}" y2="${drag.cur.y}"/>`;
    if (drag && drag.kind === 'box' && drag.cur) { const b = normBox(drag.p0, drag.cur); o += `<rect class="selbox" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`; }
    if (drag && drag.kind === 'draw' && drag.preview) o += shapeSVG(drag.preview);
    const ms = mode === 'calib' ? calib : mode === 'measure' ? measure : null;
    if (ms && ms.p1) {
      const p2 = ms.p2 || ms.hover; const r = 5 / z;
      if (p2) o += `<line class="measure" x1="${ms.p1.x}" y1="${ms.p1.y}" x2="${p2.x}" y2="${p2.y}"/>`;
      o += `<circle class="mdot" cx="${ms.p1.x}" cy="${ms.p1.y}" r="${r}"/>`;
      if (p2) o += `<circle class="mdot" cx="${p2.x}" cy="${p2.y}" r="${r}"/>`;
      if (mode === 'measure' && p2) { const fs = 12 / z; o += `<text x="${(ms.p1.x + p2.x) / 2}" y="${(ms.p1.y + p2.y) / 2 - 8 / z}" font-size="${fs}" text-anchor="middle" class="t-pill halo" style="stroke-width:${4 / z}">${fmtLen(dist(ms.p1, p2) / U, 2)}</text>`; }
    }
    return o;
  }
  function renderLegend() {
    const L = $('#legend', E);
    if (!S.legend || !S.cables.length) { L.hidden = true; return; }
    const cnt = {}, len = {};
    S.cables.forEach(c => { cnt[c.type] = (cnt[c.type] || 0) + 1; });
    L.hidden = false;
    L.innerHTML = '<h5>Kabel</h5>' + Object.keys(cnt).map(t => `<div class="li" data-hl="${t}"><span class="sw" style="background:${typeOf(t).color}"></span>${esc(typeOf(t).name)}${typeOf(t).bi ? ' <span class="muted small" title="bidirektional">⇄</span>' : ''}<span class="ct">${cnt[t]}</span></div>`).join('');
    void len;
  }
  on($('#legend', E), 'pointerover', e => { const t = e.target.closest('[data-hl]'); const v = t ? t.dataset.hl : null; if (v !== hlType) { hlType = v; render(); } });
  on($('#legend', E), 'pointerleave', () => { hlType = null; render(); });

  /* ---------- HUD ---------- */
  function renderHud() {
    const h = $('#hud', E);
    if (mode === 'calib') {
      h.hidden = false;
      if (!S.floors.length) { h.innerHTML = `<b>Maßstab</b><span>Lade zuerst einen Grundriss.</span><button class="btn sm pri" data-act="addFloor">Grundriss laden</button><button class="btn sm" data-act="cancelMode">Abbrechen</button>`; return; }
      const fl = floorById(calib?.floor) || S.floors[0];
      if (!calib || !calib.p2) {
        h.innerHTML = `<b>Maßstab</b>${S.floors.length > 1 ? `<select class="inp sm" id="calFloor">${S.floors.map(f => `<option value="${f.id}"${f.id === fl.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}<span>${calib && calib.p1 ? 'Zweiten Punkt anklicken.' : 'Klicke zwei Punkte mit bekanntem Abstand, z. B. die Enden einer Bemaßung.'}</span><button class="btn sm" data-act="cancelMode">Abbrechen</button>`;
        return;
      }
      if (!h.querySelector('#calM')) {
        h.innerHTML = `<b>Abstand</b><input class="inp sm" id="calM" type="text" inputmode="decimal" placeholder="z. B. 12,5" autocomplete="off"><span>${uName()}</span><button class="btn sm pri" data-act="applyCalib">Übernehmen</button><button class="btn sm" data-act="cancelMode">Abbrechen</button>`;
        setTimeout(() => $('#calM', E)?.focus(), 20);
      }
      return;
    }
    if (mode === 'measure') {
      h.hidden = false;
      const m = measure && measure.p1 && (measure.p2 || measure.hover) ? dist(measure.p1, measure.p2 || measure.hover) / U : null;
      h.innerHTML = `<b>Messen</b>${m != null ? `<span class="big">${fmtLen(m, 2)}</span>` : '<span>Startpunkt anklicken.</span>'}${S.floors.length && !S.floors.some(f => f.calibrated) ? '<span class="chip warn">Grundriss nicht kalibriert</span>' : ''}<button class="btn sm" data-act="cancelMode">Fertig</button>`;
      return;
    }
    if (drawTool) { h.hidden = false; h.innerHTML = `<b>${esc(drawLabel(drawTool))}</b><span>${['sym', 'text'].includes(drawTool.split(':')[0]) ? 'Zum Platzieren klicken' : 'Aufziehen oder klicken'}. Alt gedrückt halten für mehrere.</span><button class="btn sm" data-act="cancelMode">Fertig</button>`; return; }
    if (drag && drag.kind === 'floor') { h.hidden = false; h.innerHTML = '<b>Grundriss</b><span>Wird verschoben …</span>'; return; }
    h.hidden = true; h.innerHTML = '';
  }
  on($('#hud', E), 'keydown', e => { if (e.key === 'Enter' && e.target.id === 'calM') act('applyCalib'); });
  on($('#hud', E), 'change', e => { if (e.target.id === 'calFloor') { calib = { floor: e.target.value }; } });

  /* ---------- Ansicht ---------- */
  function setZoom(z, cx, cy) {
    const r = svg.getBoundingClientRect(); if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    z = clamp(z, 0.04, 6); const wx = (cx - view.x) / view.z, wy = (cy - view.y) / view.z; view.z = z; view.x = cx - wx * z; view.y = cy - wy * z; render();
  }
  function contentBounds(withFloors = true) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (b) => { x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); };
    if (withFloors) S.floors.filter(f => f.visible !== false).forEach(f => add(f));
    S.items.forEach(it => add(itemBox(it)));
    S.shapes.forEach(s => { const b = shapeBox(s); add(s.kind === 'zone' ? { x: b.x, y: b.y - 26, w: b.w, h: b.h + 26 } : b); });
    S.cables.forEach(c => { const p = cablePts(c); if (p) p.forEach(w => add({ x: w.x, y: w.y, w: 0, h: 0 })); });
    if (x1 === Infinity) return { x: 0, y: 0, w: 20 * U, h: 12 * U };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function fit(b) {
    b = b || contentBounds(); const r = svg.getBoundingClientRect(); if (!r.width) return;
    const z = clamp(Math.min(r.width / (b.w + 80), r.height / (b.h + 80)), 0.04, 3);
    view.z = z; view.x = (r.width - b.w * z) / 2 - b.x * z; view.y = (r.height - b.h * z) / 2 - b.y * z; render();
  }
  function toWorld(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z }; }
  function viewCenter() { const r = svg.getBoundingClientRect(); return { x: (r.width / 2 - view.x) / view.z, y: (r.height / 2 - view.y) / view.z }; }
  const snapV = (v) => (S.grid ? Math.round(v / 10) * 10 : v);
  const snapP = (p) => ({ x: snapV(p.x), y: snapV(p.y) });

  /* ---------- Änderungen ---------- */
  function changed(dirtyIt = true) {
    render(); renderPane();
    if (dirtyIt) markDirty();
    updUndo();
    const n = $('#edName', E); if (n && document.activeElement !== n) n.value = meta.name || '';
    $('#bGrid', E)?.classList.toggle('on', S.grid);
    const bo = $('#bOrient', E); if (bo) { bo.textContent = S.orient === 'tb' ? 'Oben → Unten' : 'Links → Rechts'; bo.title = 'Ausrichtung der Geräte umschalten (L)'; }
  }
  function newItemFromGear(g, x, y) {
    return { id: uid(), gear: g.builtin ? null : (g.id || null), src: g.id || null, name: g.name, label: '', inv: g.gear_id || '', notes: '', color: g.color || CATCOL[g.category] || CATCOL.Eigene,
      elements: [...(g.elements || [])], x: snapV(x), y: snapV(y), ports: (g.ports || []).map(p => ({ id: uid(), name: p.name, dir: p.dir, type: p.type })) };
  }
  function addGear(g, at) {
    pushUndo(); const p = at || viewCenter();
    const it = newItemFromGear(g, p.x, p.y);
    const b = itemBox(it); it.x = snapV(p.x - b.w / 2); it.y = snapV(p.y - 20);
    if (!at) {
      // Nicht auf ein vorhandenes Gerät legen: nach rechts unten ausweichen
      const hits = () => { const b2 = itemBox(it); return S.items.some(o => { const ob = itemBox(o); return b2.x < ob.x + ob.w + 10 && b2.x + b2.w + 10 > ob.x && b2.y < ob.y + ob.h + 10 && b2.y + b2.h + 10 > ob.y; }); };
      for (let i = 0; i < 60 && hits(); i++) { it.x = snapV(it.x + 40); if (i % 6 === 5) { it.x = snapV(p.x - b.w / 2); it.y = snapV(it.y + 60); } }
    }
    S.items.push(it); sel = { ids: new Set([it.id]), cable: null }; tab = 'sel'; changed();
    if (g.id && !String(g.id).startsWith('local')) api.post(`/api/gear/${g.id}/use`).catch(() => {});
  }
  function connect(a, b) {
    if (a.item === b.item) { toast('Ein Gerät kann nicht mit sich selbst verbunden werden.'); return; }
    const pa = portOf(itemById(a.item), a.port), pb = portOf(itemById(b.item), b.port);
    const d = pa.dir + '>' + pb.dir; let from, to;
    if (['out>in', 'out>io', 'io>in', 'io>io'].includes(d)) { from = a; to = b; }
    else if (['in>out', 'io>out', 'in>io'].includes(d)) { from = b; to = a; }
    else { toast(pa.dir === 'in' ? 'Zwei Eingänge lassen sich nicht verbinden. Nimm einen Ausgang oder I/O-Port.' : 'Zwei Ausgänge lassen sich nicht verbinden. Nimm einen Eingang oder I/O-Port.', 3600); return; }
    const pf = portOf(itemById(from.item), from.port), pt = portOf(itemById(to.item), to.port);
    if (S.strict && pf.type !== pt.type) { toast(`${typeOf(pf.type).name} passt nicht auf ${typeOf(pt.type).name}. „Nur gleiche Typen“ ist im Plan-Tab aktiv.`, 4000); return; }
    const cm = connMap();
    if (cm.has(from.item + '/' + from.port) || cm.has(to.item + '/' + to.port)) { toast('Dieser Port ist schon belegt. Lösche zuerst das vorhandene Kabel.'); return; }
    pushUndo();
    const type = pf.type === 'wireless' || pt.type === 'wireless' ? 'wireless' : pf.type;
    const c = { id: uid(), from: { item: from.item, port: from.port }, to: { item: to.item, port: to.port }, type, label: '', wps: [], route: null, override: null, extra: 0, notes: '' };
    S.cables.push(c); sel = { ids: new Set(), cable: c.id }; tab = 'sel';
    if (pf.type !== pt.type && type !== 'wireless') toast(`Adapter nötig: ${typeOf(pf.type).name} ↔ ${typeOf(pt.type).name}. Er steht in der Packliste.`, 3600);
    changed();
  }
  function deleteSelection() {
    if (readonly) return;
    if (sel.floor) { removeFloor(sel.floor); return; }
    if (!sel.cable && !sel.ids.size) return; pushUndo();
    if (sel.cable) S.cables = S.cables.filter(c => c.id !== sel.cable);
    S.items = S.items.filter(i => !sel.ids.has(i.id));
    S.shapes = S.shapes.filter(s => !sel.ids.has(s.id));
    S.cables = S.cables.filter(c => itemById(c.from.item) && itemById(c.to.item));
    sel = { ids: new Set(), cable: null }; changed();
  }
  function duplicateSelection() {
    if (readonly || !sel.ids.size) return; pushUndo(); const off = U, nids = new Set(), map = {};
    S.items.filter(i => sel.ids.has(i.id)).forEach(it => { const n = JSON.parse(JSON.stringify(it)); n.id = uid(); map[it.id] = { id: n.id, ports: {} }; n.x += off; n.y += off; n.ports.forEach(p => { const nid = uid(); map[it.id].ports[p.id] = nid; p.id = nid; }); if (n.label) n.label = bumpLabel(n.label); S.items.push(n); nids.add(n.id); });
    // Kabel zwischen duplizierten Geräten mitkopieren
    S.cables.filter(c => map[c.from.item] && map[c.to.item]).forEach(c => { const n = JSON.parse(JSON.stringify(c)); n.id = uid(); n.label = ''; n.from = { item: map[c.from.item].id, port: map[c.from.item].ports[c.from.port] }; n.to = { item: map[c.to.item].id, port: map[c.to.item].ports[c.to.port] }; n.wps = n.wps.map(w => ({ x: w.x + off, y: w.y + off })); S.cables.push(n); });
    S.shapes.filter(s => sel.ids.has(s.id)).forEach(s => { const n = JSON.parse(JSON.stringify(s)); n.id = uid(); n.x += off; n.y += off; S.shapes.push(n); nids.add(n.id); });
    sel = { ids: nids, cable: null }; changed();
  }
  const bumpLabel = (l) => { const m = l.match(/^(.*?)(\d+)$/); return m ? m[1] + (+m[2] + 1) : l + ' 2'; };

  /* ---------- Clipboard (Strg C / V innerhalb des Editors) ---------- */
  let clip = null;
  function copySelection() {
    if (!sel.ids.size) return;
    clip = { items: S.items.filter(i => sel.ids.has(i.id)).map(i => JSON.parse(JSON.stringify(i))), shapes: S.shapes.filter(s => sel.ids.has(s.id)).map(s => JSON.parse(JSON.stringify(s))) };
    try { localStorage.setItem('pp.clip', JSON.stringify(clip)); } catch { /* egal */ }
    toast(`${sel.ids.size} Element(e) kopiert.`);
  }
  function pasteClip() {
    if (readonly) return;
    let c = clip; try { c = c || JSON.parse(localStorage.getItem('pp.clip') || 'null'); } catch { /* egal */ }
    if (!c) return;
    pushUndo(); const nids = new Set();
    const all = [...c.items.map(i => ({ x: i.x, y: i.y })), ...c.shapes.map(s => ({ x: s.x, y: s.y }))];
    const minX = Math.min(...all.map(p => p.x)), minY = Math.min(...all.map(p => p.y)); const vc = viewCenter();
    c.items.forEach(i => { const n = JSON.parse(JSON.stringify(i)); n.id = uid(); n.ports.forEach(p => { p.id = uid(); }); n.x = snapV(vc.x + i.x - minX); n.y = snapV(vc.y + i.y - minY); S.items.push(n); nids.add(n.id); });
    c.shapes.forEach(s => { const n = JSON.parse(JSON.stringify(s)); n.id = uid(); n.x = snapV(vc.x + s.x - minX); n.y = snapV(vc.y + s.y - minY); S.shapes.push(n); nids.add(n.id); });
    sel = { ids: nids, cable: null }; changed();
  }

  /* ---------- Grundrisse ---------- */
  function scaleFloor(f, factor) {
    // Gibt es keinen anderen kalibrierten Grundriss, wird der ganze Plan mitskaliert; sonst nur der Inhalt dieses Grundrisses.
    const alone = !S.floors.some(o => o !== f && o.calibrated);
    const ox = f.x, oy = f.y, inF = (p) => alone || (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);
    const sc = (p) => ({ x: ox + (p.x - ox) * factor, y: oy + (p.y - oy) * factor });
    S.items.forEach(it => { const c = center(it); if (inF(c)) { const nc = sc(c); it.x += nc.x - c.x; it.y += nc.y - c.y; } });
    S.shapes.forEach(s => { const b = shapeBox(s); const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; if (!inF(c)) return; const p = sc({ x: s.x, y: s.y }); s.x = p.x; s.y = p.y; if (s.kind !== 'text' && s.kind !== 'sym') { s.w *= factor; s.h *= factor; } });
    S.cables.forEach(c => { c.wps = (c.wps || []).map(w => (inF(w) ? sc(w) : w)); });
    S.floors.forEach(o => { if (o !== f && !o.calibrated && inF({ x: o.x, y: o.y })) { const p = sc(o); o.x = p.x; o.y = p.y; } });
    f.w *= factor; f.h *= factor;
  }
  async function uploadFloor(file) {
    if (readonly) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    toast(isPdf ? 'PDF wird umgewandelt …' : 'Grundriss wird hochgeladen …', 15000);
    try {
      let res;
      if (isPdf && config && config.pdfServer) res = await api.upload(`/api/plans/${planId}/assets`, file, 'application/pdf', file.name);
      else if (isPdf) { const r = await pdfToPngBrowser(file); res = await api.upload(`/api/plans/${planId}/assets`, r.blob, 'image/png', file.name.replace(/\.pdf$/i, '.png'), { ptPerPx: r.ptPerPx }); }
      else res = await api.upload(`/api/plans/${planId}/assets`, file, file.type || 'image/png', file.name);
      assets.set(res.id, res);
      pushUndo();
      const k = 1600 / Math.max(res.w, res.h);
      const b = S.floors.length ? contentBounds() : { x: 0, y: 0, w: 0, h: 0 };
      const f = { id: uid(), asset: res.id, name: file.name.replace(/\.[^.]+$/, '') || 'Grundriss', x: S.floors.length ? snapV(b.x + b.w + 2 * U) : 0, y: S.floors.length ? snapV(b.y) : 0,
        w: res.w * k, h: res.h * k, w0: res.w, opacity: 0.9, visible: true, invert: true, calibrated: false, locked: true, pdf: res.meta && res.meta.ptPerPx ? { ptPerPx: res.meta.ptPerPx } : null };
      S.floors.push(f); changed(); fit(f);
      tab = 'plan'; renderPane();
      if (f.pdf) toast('PDF geladen. Gib im Plan-Tab den Zeichnungsmaßstab ein (z. B. 1:100) oder setze den Maßstab mit zwei Punkten.', 6000);
      else { setMode('calib'); calib = { floor: f.id }; toast('Grundriss geladen. Klicke jetzt zwei Punkte mit bekanntem Abstand.', 5000); }
    } catch (e) { toast(e.message || 'Der Grundriss konnte nicht geladen werden.', 6000, 'bad'); }
  }
  function removeFloor(id) { pushUndo(); S.floors = S.floors.filter(f => f.id !== id); sel.floor = null; changed(); }

  /* ---------- Zeiger ---------- */
  const pointers = new Map();
  let longPress = null;
  on(svg, 'pointerdown', (e) => {
    hideCtx();
    if (e.button === 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { clearTimeout(longPress?.t); longPress = null; const [p1, p2] = [...pointers.values()]; drag = { kind: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), z0: view.z, c: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, v0: { ...view } }; return; }
    if (e.pointerType === 'touch') { const sx = e.clientX, sy = e.clientY, tgt = e.target; longPress = { sx, sy, t: setTimeout(() => { drag = null; longPress = null; openCtx(sx, sy, tgt); }, 550) }; }
    const w = toWorld(e);
    try { svg.setPointerCapture(e.pointerId); } catch { /* egal */ }
    if (mode === 'calib' || mode === 'measure') {
      if (mode === 'calib' && readonly) return;
      const st = mode === 'calib' ? (calib = calib && !calib.p2 ? calib : { floor: calib?.floor }) : (measure = measure && !measure.p2 ? measure : {});
      if (!st.p1) st.p1 = w; else st.p2 = w;
      render(); return;
    }
    if (readonly) { // nur Auswahl und Verschieben der Ansicht
      const cab = e.target.closest('[data-cable]'), it = e.target.closest('[data-item]'), sh = e.target.closest('[data-shape]');
      if (cab) { sel = { ids: new Set(), cable: cab.dataset.cable }; tab = 'sel'; renderPane(); render(); return; }
      if (it || sh) { sel = { ids: new Set([(it || sh).dataset.item || (it || sh).dataset.shape]), cable: null }; tab = 'sel'; renderPane(); render(); return; }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; render(); return;
    }
    if (drawTool) {
      const p = snapP(w);
      if (['sym', 'text'].includes(drawTool.split(':')[0])) { placeAt(p, e.altKey); return; }
      drag = { kind: 'draw', p0: p, cur: p, preview: null }; return;
    }
    const h = e.target.closest('[data-h]');
    if (h) { const s = shapeById([...sel.ids][0]); pushUndo(); drag = { kind: 'handle', h: h.dataset.h, id: s.id }; return; }
    const port = e.target.closest('[data-port]');
    if (port) {
      const it = itemById(port.closest('[data-item]').dataset.item), pid = port.dataset.port, pr = portOf(it, pid);
      let side = port.dataset.side;
      if (side === 'LR') side = w.x > center(it).x ? 'R' : 'L';
      drag = { kind: 'link', from: { item: it.id, port: pid, dir: pr.dir }, a: anchor(it, pid, null, side), cur: null }; return;
    }
    const wp = e.target.closest('[data-wp]');
    if (wp && sel.cable) { pushUndo(); drag = { kind: 'wp', i: +wp.dataset.wp, c: sel.cable }; return; }
    const cab = e.target.closest('[data-cable]');
    if (cab) { sel = { ids: new Set(), cable: cab.dataset.cable }; tab = 'sel'; render(); renderPane(); return; }
    const el = e.target.closest('[data-item]') || e.target.closest('[data-shape]');
    if (el) {
      const id = el.dataset.item || el.dataset.shape;
      if (e.shiftKey || e.metaKey || e.ctrlKey) { sel.ids.has(id) ? sel.ids.delete(id) : sel.ids.add(id); }
      else if (!sel.ids.has(id)) sel = { ids: new Set([id]), cable: null };
      sel.cable = null; sel.floor = null; tab = 'sel';
      const start = {}; for (const sid of sel.ids) { const o = itemById(sid) || shapeById(sid); if (o) start[sid] = { x: o.x, y: o.y }; }
      // Zone verschiebt ihren Inhalt mit
      const zone = shapeById(id); if (zone && zone.kind === 'zone' && sel.ids.size === 1 && !e.altKey) {
        S.items.forEach(it => { const c = center(it); if (c.x >= zone.x && c.x <= zone.x + zone.w && c.y >= zone.y && c.y <= zone.y + zone.h) start[it.id] = { x: it.x, y: it.y }; });
        S.shapes.forEach(s => { if (s.id !== zone.id && s.kind !== 'zone' && s.x >= zone.x && s.x <= zone.x + zone.w && s.y >= zone.y && s.y <= zone.y + zone.h) start[s.id] = { x: s.x, y: s.y }; });
      }
      const wps = {}; S.cables.forEach(c => { if (start[c.from.item] && start[c.to.item] && c.wps.length) wps[c.id] = c.wps.map(p => ({ ...p })); });
      drag = { kind: 'move', p0: w, start, wps, moved: false }; render(); renderPane(); return;
    }
    const fl = e.target.closest('[data-floor]');
    if (fl && fl.classList.contains('unlocked')) { const f = floorById(fl.dataset.floor); pushUndo(); sel = { ids: new Set(), cable: null, floor: f.id }; drag = { kind: 'floor', id: f.id, p0: w, x0: f.x, y0: f.y }; render(); return; }
    if (e.shiftKey) { drag = { kind: 'box', p0: w, cur: w }; return; }
    if (sel.ids.size || sel.cable || sel.floor) { sel = { ids: new Set(), cable: null }; renderPane(); }
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; render();
  });
  on(svg, 'pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (longPress && Math.hypot(e.clientX - longPress.sx, e.clientY - longPress.sy) > 8) { clearTimeout(longPress.t); longPress = null; }
    const w = toWorld(e);
    const ms = mode === 'calib' ? calib : mode === 'measure' ? measure : null;
    if (ms && ms.p1 && !ms.p2) { ms.hover = e.shiftKey ? axisSnap(ms.p1, w) : w; render(); return; }
    if (!drag) return;
    switch (drag.kind) {
      case 'pinch': { const [p1, p2] = [...pointers.values()]; if (!p2) return; const d = Math.hypot(p1.x - p2.x, p1.y - p2.y); const r = svg.getBoundingClientRect(); view = { ...drag.v0 }; setZoom(drag.z0 * d / drag.d0, drag.c.x - r.left, drag.c.y - r.top); break; }
      case 'pan': view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; render(); break;
      case 'move': {
        const dx = w.x - drag.p0.x, dy = w.y - drag.p0.y;
        if (!drag.moved) { if (Math.hypot(dx, dy) * view.z < 3) return; pushUndo(); drag.moved = true; fastRoute = true; }
        for (const id in drag.start) { const o = itemById(id) || shapeById(id); if (o) { o.x = snapV(drag.start[id].x + dx); o.y = snapV(drag.start[id].y + dy); } }
        const f = Object.keys(drag.start)[0], o = itemById(f) || shapeById(f), rdx = o.x - drag.start[f].x, rdy = o.y - drag.start[f].y;
        for (const cid in drag.wps) { const c = cableById(cid); if (c) c.wps = drag.wps[cid].map(p => ({ x: p.x + rdx, y: p.y + rdy })); }
        render(); break;
      }
      case 'floor': { const f = floorById(drag.id); f.x = snapV(drag.x0 + w.x - drag.p0.x); f.y = snapV(drag.y0 + w.y - drag.p0.y); drag.moved = true; render(); break; }
      case 'wp': { const c = cableById(drag.c); if (c) { c.wps[drag.i] = snapP(w); render(); } break; }
      case 'link': drag.cur = w; render(); break;
      case 'box': drag.cur = w; render(); break;
      case 'draw': drag.cur = snapP(w); drag.preview = makeShape(drawTool, drag.p0, drag.cur, e.shiftKey); render(); break;
      case 'handle': {
        const s = shapeById(drag.id); if (!s) return; drag.moved = true;
        if (drag.h === 'p1') { const p = snapP(w); const x2 = s.x + s.w, y2 = s.y + s.h; s.x = p.x; s.y = p.y; s.w = x2 - p.x; s.h = y2 - p.y; }
        else if (drag.h === 'p2') { const p = e.shiftKey ? axisSnap({ x: s.x, y: s.y }, snapP(w)) : snapP(w); s.w = p.x - s.x; s.h = p.y - s.y; }
        else if (drag.h === 'se') {
          const b = shapeBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = -(s.rot || 0) * Math.PI / 180;
          const lx = cx + (w.x - cx) * Math.cos(a) - (w.y - cy) * Math.sin(a), ly = cy + (w.x - cx) * Math.sin(a) + (w.y - cy) * Math.cos(a);
          s.w = Math.max(10, snapV(lx - s.x)); s.h = Math.max(10, snapV(ly - s.y)); if (e.shiftKey || s.kind === 'sym') { const m = Math.max(s.w, s.h); s.w = s.h = m; }
        } else if (drag.h === 'rot') {
          const b = shapeBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2; let a = Math.atan2(w.y - cy, w.x - cx) * 180 / Math.PI + 90;
          a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a); s.rot = ((a % 360) + 360) % 360;
        }
        render(); break;
      }
    }
  });
  function nearestPort(w, exceptItem) {
    let best = null, bd = 22 / view.z;
    for (const it of S.items) {
      if (it.id === exceptItem) continue;
      const g = lay(it);
      for (const t of g.tabs) {
        // Abstand zum Tab-Rechteck (0, wenn der Zeiger darauf liegt)
        const x1 = it.x + t.x * S.ds, y1 = it.y + t.y * S.ds, x2 = x1 + t.w * S.ds, y2 = y1 + 20 * S.ds;
        const d = Math.hypot(Math.max(x1 - w.x, 0, w.x - x2), Math.max(y1 - w.y, 0, w.y - y2));
        if (d < bd) { bd = d; best = { item: it.id, port: t.p.id }; }
      }
    }
    return best;
  }
  const axisSnap = (p1, w) => (Math.abs(w.x - p1.x) > Math.abs(w.y - p1.y) ? { x: w.x, y: p1.y } : { x: p1.x, y: w.y });
  function endPointer(e) {
    pointers.delete(e.pointerId); if (longPress) clearTimeout(longPress.t); longPress = null;
    if (!drag) return;
    const d = drag; drag = null; fastRoute = false;
    if (d.kind === 'link') {
      const el = document.elementFromPoint(e.clientX, e.clientY), port = el && el.closest && el.closest('[data-port]');
      if (port && port.closest('[data-item]')) { const it = port.closest('[data-item]').dataset.item, pid = port.dataset.port; connect(d.from, { item: it, port: pid }); }
      else { const n = nearestPort(toWorld(e), d.from.item); if (n) connect(d.from, n); }
      render(); return;
    }
    if (d.kind === 'box') {
      const b = normBox(d.p0, d.cur);
      S.items.forEach(it => { const ib = itemBox(it); if (ib.x >= b.x && ib.y >= b.y && ib.x + ib.w <= b.x + b.w && ib.y + ib.h <= b.y + b.h) sel.ids.add(it.id); });
      S.shapes.forEach(s => { const sb = shapeBox(s); if (sb.x >= b.x && sb.y >= b.y && sb.x + sb.w <= b.x + b.w && sb.y + sb.h <= b.y + b.h) sel.ids.add(s.id); });
      render(); renderPane(); return;
    }
    if (d.kind === 'draw') {
      const small = dist(d.p0, d.cur || d.p0) * view.z < 6;
      const s = small ? makeShape(drawTool, d.p0, null) : makeShape(drawTool, d.p0, d.cur, e.shiftKey);
      if (s) { pushUndo(); S.shapes.push(s); sel = { ids: new Set([s.id]), cable: null }; tab = 'sel'; if (!e.altKey) { drawTool = null; renderDtb(); } changed(); }
      return;
    }
    if ((d.kind === 'move' && d.moved) || d.kind === 'wp' || (d.kind === 'handle' && d.moved) || (d.kind === 'floor' && d.moved)) { changed(); return; }
    render();
  }
  on(svg, 'pointerup', endPointer);
  on(svg, 'pointercancel', endPointer);
  on(svg, 'wheel', (e) => {
    e.preventDefault(); const r = svg.getBoundingClientRect();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey) setZoom(view.z * Math.exp(-e.deltaY * k * 0.01), e.clientX - r.left, e.clientY - r.top);
    else if (e.shiftKey) { view.x -= (e.deltaY || e.deltaX) * k; render(); }
    else if (Math.abs(e.deltaX) > 0.5) { view.x -= e.deltaX * k; view.y -= e.deltaY * k; render(); }
    else setZoom(view.z * Math.exp(-e.deltaY * k * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  on(svg, 'dblclick', (e) => {
    if (readonly || mode !== 'select' || drawTool) return;
    const wp = e.target.closest('[data-wp]');
    if (wp && sel.cable) { const c = cableById(sel.cable); pushUndo(); c.wps.splice(+wp.dataset.wp, 1); changed(); return; }
    const cab = e.target.closest('[data-cable]');
    if (cab) { addPin(cab.dataset.cable, toWorld(e)); return; }
    const it = e.target.closest('[data-item]');
    if (it) { editItemPorts(it.dataset.item); return; }
    const sh = e.target.closest('[data-shape]');
    if (sh) { const s = shapeById(sh.dataset.shape); if (s) { sel = { ids: new Set([s.id]), cable: null }; tab = 'sel'; renderPane(); setTimeout(() => { const f = $('#shText', E) || $('#shLabel', E); f && f.focus(); }, 30); } }
  });
  function addPin(cid, w) {
    const c = cableById(cid); const pts0 = cablePts(c); if (!pts0) return; pushUndo();
    if (!c.wps.length) c.wps = pts0.slice(2, -2).map(p => ({ x: p.x, y: p.y }));
    const pts = cablePts(c);
    let best = 1, bd = Infinity; for (let i = 1; i < pts.length; i++) { const d = segDist(w, pts[i - 1], pts[i]); if (d < bd) { bd = d; best = i; } }
    const idx = clamp(best - 2, 0, c.wps.length); c.wps.splice(idx, 0, snapP(w)); sel = { ids: new Set(), cable: c.id }; changed();
    toast('Pin gesetzt. Ziehen verlegt das Kabel, Doppelklick entfernt den Pin.');
  }
  on(svg, 'dragover', e => { if (!readonly) e.preventDefault(); });
  on(svg, 'drop', e => {
    e.preventDefault(); if (readonly) return;
    const raw = e.dataTransfer.getData('application/x-pp-gear');
    if (raw) { try { addGear(JSON.parse(raw), toWorld(e)); } catch { /* egal */ } return; }
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && (/^image\//.test(f.type) || /\.pdf$/i.test(f.name))) uploadFloor(f);
  });

  /* ---------- Zeichenwerkzeuge ---------- */
  const drawLabel = (t) => { const [k, s] = t.split(':'); return k === 'sym' ? SYMS[s].n : SHAPES[k]; };
  function makeShape(tool, p0, p1, shift) {
    const [k, sym] = tool.split(':');
    const base = { id: uid(), kind: k, color: 'gray', fill: 'tint', weight: 2, label: '', rot: 0 };
    if (k === 'sym') return { ...base, sym, x: p0.x - 0.6 * U, y: p0.y - 0.6 * U, w: 1.2 * U, h: 1.2 * U, color: sym === 'power' ? 'red' : sym === 'camera' ? 'blue' : sym === 'light' ? 'yellow' : 'gray' };
    if (k === 'text') return { ...base, fill: 'none', x: p0.x, y: p0.y, text: 'Text', size: 18, bold: false };
    if (k === 'line' || k === 'arrow') { const q = p1 || { x: p0.x + 3 * U, y: p0.y }; let w = q.x - p0.x, h = q.y - p0.y; if (shift) { if (Math.abs(w) > Math.abs(h)) h = 0; else w = 0; } return { ...base, fill: 'none', x: p0.x, y: p0.y, w, h, color: k === 'arrow' ? 'orange' : 'gray' }; }
    if (!p1) { const dw = { zone: 8 * U, rect: 4 * U, circle: 3 * U, tri: 3 * U, half: 6 * U, trap: 5 * U }[k], dh = { zone: 5 * U, rect: 2 * U, circle: 3 * U, tri: 3 * U, half: 3 * U, trap: 2.5 * U }[k]; return { ...base, x: p0.x, y: p0.y, w: dw, h: dh, color: k === 'zone' ? 'blue' : 'gray', label: k === 'zone' ? 'Zone' : '' }; }
    const b = normBox(p0, p1); if (shift) { const m = Math.max(b.w, b.h); b.w = b.h = m; }
    return { ...base, x: b.x, y: b.y, w: Math.max(10, b.w), h: Math.max(10, b.h), color: k === 'zone' ? 'blue' : 'gray', label: k === 'zone' ? 'Zone' : '' };
  }
  function placeAt(p, keep) {
    const s = makeShape(drawTool, p, null); pushUndo(); S.shapes.push(s); sel = { ids: new Set([s.id]), cable: null }; tab = 'sel';
    if (s.kind === 'text' || !keep) { drawTool = null; renderDtb(); }
    changed();
    if (s.kind === 'text') setTimeout(() => { const f = $('#shText', E); if (f) { f.focus(); f.select(); } }, 40);
  }
  const ICON = {
    rect: '<rect x="3" y="6" width="18" height="12" rx="1.5"/>', circle: '<circle cx="12" cy="12" r="8"/>', tri: '<path d="M12 4 L21 20 H3Z"/>',
    half: '<path d="M3 17 A9 9 0 0 1 21 17Z"/>', trap: '<path d="M7 6 H17 L21 18 H3Z"/>', line: '<path d="M4 19 L20 5"/>', arrow: '<path d="M4 19 L19 6 M11 6 H19 V14"/>',
    zone: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><path d="M3 9 H11"/>', text: '<path d="M5 6 H19 M12 6 V19"/>',
  };
  function renderDtb() {
    const d = $('#dtb', E);
    d.innerHTML = '<div class="sep">Formen</div>' + Object.keys(ICON).map(k => `<button data-tool="${k}" class="${drawTool === k ? 'on' : ''}" title="${SHAPES[k]}" aria-label="${SHAPES[k]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICON[k]}</svg></button>`).join('') +
      '<div class="sep">Symbole</div>' + Object.keys(SYMS).map(k => `<button data-tool="sym:${k}" class="${drawTool === 'sym:' + k ? 'on' : ''}" title="${SYMS[k].n}" aria-label="${SYMS[k].n}"><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.5" style="--sf:currentColor;--sfo:.15;--col:currentColor" class="symg">${SYMS[k].d}</svg></button>`).join('');
    renderHud();
  }
  if (!readonly) on($('#dtb', E), 'click', e => { const b = e.target.closest('[data-tool]'); if (!b) return; drawTool = drawTool === b.dataset.tool ? null : b.dataset.tool; setMode('select', true); renderDtb(); render(); });
  function toggleDtb(force) { const d = $('#dtb', E); d.hidden = force != null ? !force : !d.hidden; $('#bDraw', E)?.classList.toggle('on', !d.hidden); if (d.hidden) drawTool = null; renderDtb(); render(); try { localStorage.setItem('pp.dtb', d.hidden ? '0' : '1'); } catch { /* egal */ } }

  function setMode(m, keepTool) {
    mode = m; if (!keepTool) drawTool = null; calib = m === 'calib' ? { floor: calib?.floor } : null; measure = null;
    $$('[data-mode]', E).forEach(b => b.classList.toggle('on', b.dataset.mode === m)); renderDtb(); render();
  }
  $$('[data-mode]', E).forEach(b => on(b, 'click', () => setMode(b.dataset.mode)));

  /* ---------- Kontextmenü ---------- */
  on(svg, 'contextmenu', e => { e.preventDefault(); openCtx(e.clientX, e.clientY, e.target); });
  function openCtx(cx, cy, target) {
    const r = svg.getBoundingClientRect();
    const w = { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
    const cab = target.closest('[data-cable]'), it = target.closest('[data-item]'), sh = target.closest('[data-shape]'), fl = target.closest('[data-floor]');
    let h = '';
    if (readonly) {
      h = `<button data-c="fit">Alles einpassen <kbd>F</kbd></button>`;
    } else if (cab) {
      sel = { ids: new Set(), cable: cab.dataset.cable }; const c = cableById(cab.dataset.cable);
      h = `<button data-c="pin">Pin hinzufügen</button>${c.wps.length ? '<button data-c="clearpins">Pins entfernen (automatisch verlegen)</button>' : ''}
        <div class="ctx-sub">Verlegung</div><div class="seg">${[['auto', 'Auto'], ['ortho', 'Winkel'], ['direct', 'Direkt']].map(([k, n]) => `<button data-route="${k}" class="${(c.route || S.settings.route) === k && !c.wps.length ? 'on' : ''}">${n}</button>`).join('')}</div>
        <hr><button data-c="del">Kabel löschen <kbd>Entf</kbd></button>`;
      ctxEl._pin = { cid: c.id, w };
    } else if (it) {
      const id = it.dataset.item; if (!sel.ids.has(id)) sel = { ids: new Set([id]), cable: null };
      const item = itemById(id);
      h = `<button data-c="edit">Ports bearbeiten …</button><button data-c="dup">Duplizieren <kbd>Strg D</kbd></button><button data-c="copy">Kopieren <kbd>Strg C</kbd></button>
        <button data-c="savegear">In meinen Geräten speichern</button>${item.gear ? '<button data-c="syncgear">Aus Bibliothek aktualisieren</button>' : ''}
        <hr><button data-c="front">Nach vorne</button><button data-c="back">Nach hinten</button><hr><button data-c="del">Löschen <kbd>Entf</kbd></button>`;
    } else if (sh) {
      const id = sh.dataset.shape; if (!sel.ids.has(id)) sel = { ids: new Set([id]), cable: null }; const s = shapeById(id);
      h = `<div class="swatches">${Object.keys(COLORS).map(k => `<button data-col="${k}" title="${COLNAMES[k]}" aria-label="${COLNAMES[k]}" class="${s.color === k ? 'on' : ''}" style="background:${COLORS[k]}"></button>`).join('')}</div>` +
        (s.kind !== 'line' && s.kind !== 'arrow' ? `<div class="seg">${[['none', 'Keine'], ['tint', 'Getönt'], ['solid', 'Voll']].map(([k, n]) => `<button data-fill="${k}" class="${s.fill === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : '') +
        (s.kind !== 'text' ? `<div class="seg">${[[1, 'Dünn'], [2, 'Normal'], [3, 'Fett']].map(([k, n]) => `<button data-wt="${k}" class="${(s.weight || 2) == k ? 'on' : ''}">${n}</button>`).join('')}</div>` : '') +
        `<hr><button data-c="label">${s.kind === 'text' ? 'Text bearbeiten' : 'Beschriften'}</button>${s.kind === 'zone' ? '<button data-c="zoomzone">Auf Zone zoomen</button>' : ''}<button data-c="dup">Duplizieren <kbd>Strg D</kbd></button><button data-c="front">Nach vorne</button><button data-c="back">Nach hinten</button><hr><button data-c="del">Löschen <kbd>Entf</kbd></button>`;
    } else if (fl) {
      const f = floorById(fl.dataset.floor); sel = { ids: new Set(), cable: null, floor: f.id };
      h = `<button data-c="floorlock">${f.locked === false ? 'Grundriss fixieren' : 'Grundriss verschieben'}</button><button data-c="calibfloor">Maßstab setzen</button><button data-c="floorback">Nach hinten</button><hr><button data-c="floordel">Grundriss entfernen</button>`;
      ctxEl._floor = f.id;
    } else {
      h = `<button data-c="center">Hier zentrieren</button><button data-c="fit">Alles einpassen <kbd>F</kbd></button><button data-c="paste">Einfügen <kbd>Strg V</kbd></button><button data-c="toolbar">Zeichenwerkzeuge <kbd>Shift D</kbd></button><button data-c="addfloor">Grundriss laden …</button>`;
    }
    ctxEl._at = w;
    render(); renderPane();
    ctxEl.innerHTML = h; ctxEl.hidden = false;
    const rr = ctxEl.getBoundingClientRect();
    ctxEl.style.left = Math.max(8, Math.min(cx, innerWidth - rr.width - 8)) + 'px'; ctxEl.style.top = Math.max(8, Math.min(cy, innerHeight - rr.height - 8)) + 'px';
  }
  function hideCtx() { ctxEl.hidden = true; }
  on(document, 'pointerdown', e => { if (!ctxEl.contains(e.target)) hideCtx(); });
  on(ctxEl, 'click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const one = [...sel.ids][0];
    const shapesSel = () => [...sel.ids].map(shapeById).filter(Boolean);
    if (b.dataset.col) { pushUndo(); shapesSel().forEach(o => { o.color = b.dataset.col; }); changed(); hideCtx(); return; }
    if (b.dataset.fill) { pushUndo(); shapesSel().forEach(o => { o.fill = b.dataset.fill; }); changed(); hideCtx(); return; }
    if (b.dataset.wt) { pushUndo(); shapesSel().forEach(o => { o.weight = +b.dataset.wt; }); changed(); hideCtx(); return; }
    if (b.dataset.route) { pushUndo(); const c = cableById(sel.cable); c.route = b.dataset.route; c.wps = []; changed(); hideCtx(); return; }
    const c = b.dataset.c; hideCtx();
    const map = {
      pin: () => addPin(ctxEl._pin.cid, ctxEl._pin.w),
      clearpins: () => { pushUndo(); cableById(sel.cable).wps = []; changed(); },
      del: deleteSelection, dup: duplicateSelection, copy: copySelection, paste: pasteClip,
      edit: () => editItemPorts(one), savegear: () => saveItemAsGear(itemById(one)), syncgear: () => syncItemFromGear(itemById(one)),
      front: () => act('front'), back: () => act('back'),
      label: () => { tab = 'sel'; renderPane(); setTimeout(() => { const f = $('#shText', E) || $('#shLabel', E); f && f.focus(); }, 30); },
      zoomzone: () => { const zz = shapeById(one); fit({ x: zz.x, y: zz.y - 30, w: zz.w, h: zz.h + 30 }); },
      fit: () => fit(), toolbar: () => toggleDtb(), addfloor: () => $('#fFloor', E).click(),
      center: () => { const r = svg.getBoundingClientRect(); view.x = r.width / 2 - ctxEl._at.x * view.z; view.y = r.height / 2 - ctxEl._at.y * view.z; render(); },
      floorlock: () => { pushUndo(); const f = floorById(ctxEl._floor); f.locked = f.locked === false; changed(); toast(f.locked ? 'Grundriss fixiert.' : 'Grundriss lässt sich jetzt verschieben.'); },
      calibfloor: () => { setMode('calib'); calib = { floor: ctxEl._floor }; render(); },
      floorback: () => { pushUndo(); const f = floorById(ctxEl._floor); S.floors = [f, ...S.floors.filter(x => x !== f)]; changed(); },
      floordel: () => removeFloor(ctxEl._floor),
    };
    map[c] && map[c]();
  });

  /* ---------- Tastatur ---------- */
  on(document, 'keydown', (e) => {
    if (destroyed) return;
    const t = e.target; if (t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    if (document.querySelector('.ov')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === '?' || (e.shiftKey && k === 'ß')) { showHelp(); return; }
    if (k === 'f' && !mod) { fit(); return; }
    if ((k === '+' || k === '=') && !mod) { setZoom(view.z * 1.25); return; }
    if (k === '-' && !mod) { setZoom(view.z / 1.25); return; }
    if (k === 'm' && !mod) { setMode('measure'); return; }
    if (e.key === 'Escape') { hideCtx(); if (drawTool || mode !== 'select') setMode('select'); else { sel = { ids: new Set(), cable: null }; render(); renderPane(); } return; }
    if (readonly) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && k === 'c') { copySelection(); return; }
    if (mod && k === 'v') { e.preventDefault(); pasteClip(); return; }
    if (mod && k === 's') { e.preventDefault(); scheduleSave.flush(); return; }
    if (mod && k === 'a') { e.preventDefault(); sel = { ids: new Set([...S.items.map(i => i.id), ...S.shapes.map(s => s.id)]), cable: null }; render(); renderPane(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.shiftKey && k === 'd') { toggleDtb(); return; }
    if (mod) return;
    if (k === 'v') setMode('select'); else if (k === 'k') setMode('calib');
    else if (k === 'g') { S.grid = !S.grid; changed(); }
    else if (k === 'l') act('orient');
    else if (k === 't') { toggleDtb(true); drawTool = 'text'; renderDtb(); render(); }
    else if (k === 'z') { toggleDtb(true); drawTool = 'zone'; renderDtb(); render(); }
    else if (e.key.startsWith('Arrow') && sel.ids.size) {
      e.preventDefault(); const st = e.shiftKey ? U : 10;
      const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      pushUndo(); sel.ids.forEach(id => { const o = itemById(id) || shapeById(id); if (o) { o.x += dx; o.y += dy; } }); changed();
    }
  });

  /* ---------- Bibliothek ---------- */
  let libTab = 'mine', myGear = null, community = null;
  async function loadMyGear(first) {
    try { myGear = await api.get('/api/gear'); } catch { myGear = []; }
    if (first && !myGear.length && libTab === 'mine') { libTab = 'community'; $$('[data-ltab]', E).forEach(b => b.classList.toggle('on', b.dataset.ltab === libTab)); loadCommunity(); }
    renderLib();
  }
  const loadCommunity = debounce(async () => {
    try { const q = $('#libSearch', E).value.trim(); const r = await api.get('/api/community?limit=200&q=' + encodeURIComponent(q)); community = r.items; } catch { community = []; }
    renderLib();
  }, 250);
  function renderLib() {
    const list = $('#libList', E); if (!list) return;
    const q = $('#libSearch', E).value.trim().toLowerCase();
    let items = libTab === 'mine' ? (myGear || []) : (community || []);
    if (libTab === 'mine' && q) items = items.filter(g => (g.name + ' ' + (g.manufacturer || '') + ' ' + (g.model || '')).toLowerCase().includes(q) || g.ports.some(p => typeOf(p.type).name.toLowerCase().includes(q)));
    if ((libTab === 'mine' && !myGear) || (libTab === 'community' && !community)) { list.innerHTML = '<p class="hint">Lade …</p>'; return; }
    if (!items.length) {
      list.innerHTML = libTab === 'mine'
        ? `<div class="empty-sm"><p>${q ? 'Nichts gefunden.' : 'Du hast noch keine eigenen Geräte.'}</p><p class="hint">Übernimm Geräte aus der Community oder bau dein eigenes.</p><button class="btn sm" data-ltab2="community">Community öffnen</button></div>`
        : '<p class="hint">Nichts gefunden. Bau das Gerät mit „+ Gerät bauen“.</p>';
      return;
    }
    const cats = {}; items.forEach(g => (cats[g.category] = cats[g.category] || []).push(g));
    list.innerHTML = Object.keys(cats).sort().map(c => `<div class="cat"><h4><span style="background:${CATCOL[c] || CATCOL.Eigene}"></span>${esc(c)}</h4>${cats[c].map(g => `
      <div class="card" draggable="true" data-gear="${esc(g.id)}" title="Klicken oder auf den Plan ziehen">
        <span class="n">${esc(g.name)}</span><span class="m">${esc(portSummary(g.ports))}${g.team_name ? ' · ' + esc(g.team_name) : ''}${libTab === 'community' && !g.builtin ? ' · ' + esc(g.author) : ''}</span>
      </div>`).join('')}</div>`).join('');
  }
  const gearById = (id) => (myGear || []).find(g => g.id === id) || (community || []).find(g => g.id === id);
  if (!readonly) {
    on($('#lib', E), 'click', e => {
      const lt = e.target.closest('[data-ltab],[data-ltab2]');
      if (lt) { libTab = lt.dataset.ltab || lt.dataset.ltab2; $$('[data-ltab]', E).forEach(b => b.classList.toggle('on', b.dataset.ltab === libTab)); if (libTab === 'community' && !community) loadCommunity(); renderLib(); return; }
      const c = e.target.closest('[data-gear]'); if (c) { const g = gearById(c.dataset.gear); if (g) addGear(g); }
    });
    on($('#lib', E), 'dragstart', e => { const c = e.target.closest('[data-gear]'); if (c) { const g = gearById(c.dataset.gear); e.dataTransfer.setData('application/x-pp-gear', JSON.stringify(g)); e.dataTransfer.effectAllowed = 'copy'; } });
    on($('#libSearch', E), 'input', () => { if (libTab === 'community') loadCommunity(); else renderLib(); });
    loadMyGear(true);
  }

  /* ---------- Gerät im Plan bearbeiten ---------- */
  function editItemPorts(id) {
    const it = itemById(id); if (!it || readonly) return;
    const ports = it.ports.map(p => ({ ...p }));
    const els = [...(it.elements || [])];
    const m = modal(`<header><h2>Gerät im Plan bearbeiten</h2><button class="btn sm" data-x>Schließen</button></header>
      <div class="mb two">
        <div class="col">
          <div class="row2"><label class="fld"><span>Gerät</span><input class="inp" id="gName" value="${esc(it.name)}"></label><label class="fld"><span>Farbe</span><input type="color" id="gColor" value="${esc(it.color)}"></label></div>
          <label class="fld"><span>Beschreibungszeilen <em>(eine pro Zeile, erscheinen auf dem Gerät)</em></span><textarea class="inp" id="gEls" rows="2">${esc(els.join('\n'))}</textarea></label>
          <h3 class="h3">Ports</h3><div id="gPorts"></div>
        </div>
        <div class="col preview"><h3 class="h3">Vorschau</h3><div id="gPrev"></div><p class="hint small">Änderungen gelten nur für dieses Gerät in diesem Plan.</p></div>
      </div>
      <footer><button class="btn" data-x>Abbrechen</button><button class="btn pri" id="gSave">Übernehmen</button></footer>`, { wide: true });
    const prev = () => { m.el.querySelector('#gPrev').innerHTML = itemPreviewSVG({ id: 'edit' + id, name: m.el.querySelector('#gName').value, color: m.el.querySelector('#gColor').value, elements: m.el.querySelector('#gEls').value.split('\n').filter(Boolean), ports }, S.orient, 340); };
    mountPortEditor(m.el.querySelector('#gPorts'), ports, prev); prev();
    m.el.addEventListener('input', e => { if (['gName', 'gColor', 'gEls'].includes(e.target.id)) prev(); });
    m.el.querySelector('#gSave').onclick = () => {
      pushUndo();
      it.name = m.el.querySelector('#gName').value.trim() || it.name; it.color = m.el.querySelector('#gColor').value;
      it.elements = m.el.querySelector('#gEls').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
      it.ports = ports.map(p => ({ id: p.id || uid(), name: p.name, dir: p.dir, type: p.type }));
      const before = S.cables.length;
      S.cables = S.cables.filter(c => { const a = portOf(itemById(c.from.item), c.from.port), z = portOf(itemById(c.to.item), c.to.port); return a && z && a.dir !== 'in' && z.dir !== 'out'; });
      clearLayoutCache(); m.close(); changed();
      if (S.cables.length < before) toast(`${before - S.cables.length} Kabel an entfernten oder geänderten Ports gelöscht.`, 4000);
    };
  }
  async function saveItemAsGear(it) {
    try {
      const g = await api.post('/api/gear', { name: it.name, category: 'Eigene', color: it.color, ports: it.ports, elements: it.elements, gear_id: it.inv || null });
      pushUndo(); it.gear = g.id; changed(); myGear = null; loadMyGear(); toast(`„${it.name}“ ist jetzt in deinen Geräten.`);
    } catch (e) { toast(e.message, 4000, 'bad'); }
  }
  async function syncItemFromGear(it) {
    try {
      const g = await api.get(`/api/gear/${it.gear}`);
      pushUndo();
      const old = it.ports;
      it.ports = g.ports.map(p => { const m = old.find(o => o.name === p.name && o.dir === p.dir) || old.find(o => o.name === p.name); return { id: m ? m.id : uid(), name: p.name, dir: p.dir, type: p.type }; });
      it.name = g.name; it.color = g.color; it.elements = g.elements || [];
      S.cables = S.cables.filter(c => { const a = portOf(itemById(c.from.item), c.from.port), z = portOf(itemById(c.to.item), c.to.port); return a && z; });
      clearLayoutCache(); changed(); toast('Gerät aus der Bibliothek aktualisiert.');
    } catch (e) { toast(e.message, 4000, 'bad'); }
  }

  /* ---------- Inspektor ---------- */
  $$('[data-tab]', E).forEach(b => on(b, 'click', () => { tab = b.dataset.tab; renderPane(); }));
  let paneDown = false, panePending = false;
  on(pane, 'pointerdown', () => { paneDown = true; });
  on(window, 'pointerup', () => { if (paneDown) { paneDown = false; if (panePending) { panePending = false; setTimeout(renderPane, 0); } } });
  function renderPane() {
    if (paneDown) { panePending = true; return; }
    $$('[data-tab]', E).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const ae = document.activeElement, keep = ae && pane.contains(ae) && ae.id ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const st = pane.scrollTop;
    pane.innerHTML = tab === 'sel' ? paneSel() : tab === 'plan' ? panePlan() : tab === 'pack' ? panePack() : panePatch();
    pane.scrollTop = st;
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { /* egal */ } } }
    if (readonly) pane.querySelectorAll('input,select,textarea').forEach(i => { if (!i.dataset.ro) i.disabled = true; });
  }
  const field = (id, label, val, type = 'text', extra = '') => `<label class="row"><span>${label}</span><input class="inp" id="${id}" type="${type}" value="${esc(val ?? '')}" ${extra}></label>`;
  function paneSel() {
    const ids = [...sel.ids];
    if (sel.cable) return paneCable(cableById(sel.cable));
    if (sel.floor) { const f = floorById(sel.floor); if (f) return paneFloorSel(f); }
    if (ids.length > 1) return `<div class="sec"><h3>${ids.length} Elemente ausgewählt</h3><p class="hint">Gemeinsam verschieben, mit <b>Strg D</b> duplizieren, mit <b>Strg C/V</b> kopieren oder mit <b>Entf</b> löschen. Formen lassen sich über das Kontextmenü gemeinsam einfärben.</p>${readonly ? '' : '<div class="btnrow"><button class="btn" data-a="dup">Duplizieren</button><button class="btn bad" data-a="del">Löschen</button></div>'}</div>`;
    if (ids.length === 1) { const it = itemById(ids[0]); if (it) return paneItem(it); const s = shapeById(ids[0]); if (s) return paneShape(s); }
    const d = packData();
    return `<div class="stats"><div class="stat"><b>${S.items.length}</b><span>Geräte</span></div><div class="stat"><b>${S.cables.length}</b><span>Kabel</span></div><div class="stat"><b>${fmtLen(d.total).replace(/ .*/, '')}</b><span>${uName()} Kabel</span></div></div>
    ${readonly ? `<div class="sec"><h3>Plan</h3><div class="box small">${meta.job_id ? `<div><span class="muted">Job</span> ${esc(meta.job_id)}</div>` : ''}${meta.venue ? `<div><span class="muted">Ort</span> ${esc(meta.venue)}</div>` : ''}${meta.rig_date ? `<div><span class="muted">Aufbau</span> ${fmtDate(meta.rig_date)}</div>` : ''}${meta.event_date ? `<div><span class="muted">Veranstaltung</span> ${fmtDate(meta.event_date)}</div>` : ''}<div><span class="muted">Zuletzt geändert</span> ${relTime(meta.updated)}</div></div><p class="hint">Klicke ein Gerät oder Kabel an, um Details zu sehen.</p></div>` : `
    <div class="sec"><h3>So geht's</h3>
    <p class="hint"><b>Geräte</b> links anklicken oder auf den Plan ziehen.<br><b>Kabel</b> von Port-Tab zu Port-Tab ziehen: Ausgang auf Eingang oder I/O (⇄). I/O-Ports haben auf beiden Seiten einen Anschluss und verbinden sich auch untereinander. Belegte Ports sind voll eingefärbt.<br><b>Pins</b>: Doppelklick aufs Kabel, dann ziehen. So folgt das Kabel der echten Trasse, und die Länge wird aus dem Grundriss berechnet.<br><b>Grundriss</b> im Tab „Plan“ laden (oder Datei auf die Fläche ziehen) und mit „Maßstab“ kalibrieren.<br><b>Zeichnen</b> (Shift D): Formen, Zonen, Text und Symbole.</p></div>`}
    <div class="sec"><h3>Anschlusstypen</h3><div class="portlist">${Object.entries(TYPES).map(([k, t]) => `<div><span class="dot" style="background:${t.color}"></span><span class="dir">${t.short}</span><span>${esc(t.name)}${t.bi ? ' <span class="muted">⇄</span>' : ''}</span><span class="muted small">${t.nocable ? 'ohne Kabel' : `${t.lens[0].toLocaleString('de-DE')}–${t.lens[t.lens.length - 1]} m`}</span></div>`).join('')}</div></div>`;
  }
  function paneItem(it) {
    const cm = connMap(), ids = cableIds();
    const rows = it.ports.map(p => {
      const c = cm.get(it.id + '/' + p.id); let peer = '';
      if (c) { const other = c.from.item === it.id ? c.to : c.from; const oi = itemById(other.item); peer = `${esc(itemName(oi))} · ${esc(portOf(oi, other.port).name)}`; }
      return `<div ${c ? `data-selc="${c.id}" class="link"` : ''}><span class="dot" style="background:${typeOf(p.type).color}"></span><span class="dir">${p.dir === 'io' ? 'I/O' : p.dir === 'in' ? 'IN' : 'OUT'}</span><span>${esc(p.name)}${c ? `<br><span class="muted small">${p.dir === 'in' ? '← ' : p.dir === 'out' ? '→ ' : '⇄ '}${peer}</span>` : ''}</span><span class="muted small">${c ? esc(ids[c.id]) : 'frei'}</span></div>`;
    }).join('');
    const z = zoneOf(center(it));
    return `<div class="sec"><h3>Gerät ${z ? `<span class="chip">${esc(z.label || 'Zone')}</span>` : ''}</h3>
      ${field('iLabel', 'Bezeichnung', it.label, 'text', 'placeholder="z. B. CAM 1" maxlength="60"')}
      ${field('iName', 'Gerät', it.name, 'text', 'maxlength="120"')}
      ${field('iInv', 'Geräte-ID', it.inv, 'text', 'placeholder="Inventar-Nr., optional" maxlength="60"')}
      <label class="row"><span>Farbe</span><input type="color" id="iColor" value="${esc(it.color)}"></label>
      <label class="row"><span>Notiz</span><input class="inp" id="iNotes" value="${esc(it.notes || '')}" placeholder="z. B. auf Stativ, 1,80 m"></label>
      ${readonly ? '' : `<div class="btnrow"><button class="btn" data-a="edit">Ports bearbeiten</button><button class="btn" data-a="dup">Duplizieren</button><button class="btn" data-a="savegear">${it.gear ? 'Als neues Gerät speichern' : 'In meinen Geräten speichern'}</button>${it.gear ? '<button class="btn" data-a="syncgear">Aus Bibliothek aktualisieren</button>' : ''}<button class="btn bad" data-a="del">Löschen</button></div>`}
    </div>
    <div class="sec"><h3>Ports <span class="muted small">${esc(portSummary(it.ports))}</span></h3><div class="portlist">${rows || '<p class="hint">Keine Ports.</p>'}</div></div>`;
  }
  function paneShape(s) {
    const sw = `<div class="swatches">${Object.keys(COLORS).map(k => `<button data-scol="${k}" title="${COLNAMES[k]}" aria-label="${COLNAMES[k]}" class="${s.color === k ? 'on' : ''}" style="background:${COLORS[k]}"></button>`).join('')}</div>`;
    const name = s.kind === 'sym' ? SYMS[s.sym].n : SHAPES[s.kind];
    return `<div class="sec"><h3>${esc(name)}</h3>
      ${s.kind === 'text' ? `<label class="fld"><span>Text <em># Überschrift · - Liste · **fett**</em></span><textarea class="inp" id="shText" rows="5">${esc(s.text)}</textarea></label>
        <label class="row"><span>Größe</span><input type="range" id="shSize" min="10" max="72" value="${s.size || 18}"></label><label class="chk"><input type="checkbox" id="shBold"${s.bold ? ' checked' : ''}> Alles fett</label>`
      : field('shLabel', s.kind === 'zone' ? 'Name' : 'Beschriftung', s.label || '', 'text', s.kind === 'zone' ? 'placeholder="z. B. Bühne"' : 'placeholder="z. B. Tisch 4"')}
      <div class="row"><span>Farbe</span>${sw}</div>
      ${s.kind !== 'line' && s.kind !== 'arrow' ? `<div class="row"><span>${s.kind === 'text' ? 'Hintergrund' : 'Füllung'}</span><div class="seg">${[['none', 'Keine'], ['tint', 'Getönt'], ['solid', 'Voll']].map(([k, n]) => `<button data-sfill="${k}" class="${s.fill === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
      ${s.kind !== 'text' ? `<div class="row"><span>Linie</span><div class="seg">${[[1, 'Dünn'], [2, 'Normal'], [3, 'Fett']].map(([k, n]) => `<button data-swt="${k}" class="${(s.weight || 2) == k ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
      ${!['zone', 'line', 'arrow', 'text'].includes(s.kind) ? `<label class="row"><span>Drehung</span><span class="inline"><input type="range" id="shRot" min="0" max="359" value="${s.rot || 0}"><span class="mono small" style="width:4ch">${s.rot || 0}°</span></span></label>` : ''}
      ${s.kind === 'line' || s.kind === 'arrow' ? `<p class="hint">Länge: <b>${fmtLen(Math.hypot(s.w, s.h) / U, 2)}</b></p>` : !['text', 'sym'].includes(s.kind) ? `<p class="hint">Maße: <b>${fmtNum(toUser(s.w / U), 2)} × ${fmtLen(s.h / U, 2)}</b>${s.kind === 'zone' || s.kind === 'rect' ? ` · Fläche ${fmtNum(toUser(s.w / U) * toUser(s.h / U), 1)} ${uName()}²` : ''}</p>` : ''}
      ${readonly ? '' : `<div class="btnrow">${s.kind === 'zone' ? '<button class="btn" data-a="zoomzone">Auf Zone zoomen</button>' : ''}<button class="btn" data-a="dup">Duplizieren</button><button class="btn" data-a="front">Nach vorne</button><button class="btn" data-a="back">Nach hinten</button><button class="btn bad" data-a="del">Löschen</button></div>`}
    </div>`;
  }
  function paneFloorSel(f) {
    return `<div class="sec"><h3>Grundriss</h3><p class="hint"><b>${esc(f.name)}</b>${f.locked === false ? ' lässt sich verschieben. Fixiere ihn, wenn er sitzt.' : ''}</p>
      <div class="btnrow"><button class="btn" data-fa="lock" data-f="${f.id}">${f.locked === false ? 'Fixieren' : 'Verschieben'}</button><button class="btn" data-fa="calib" data-f="${f.id}">Maßstab setzen</button><button class="btn bad" data-fa="del" data-f="${f.id}">Entfernen</button></div></div>`;
  }
  function paneCable(c) {
    const r = calc(c), ids = cableIds(), a = itemById(c.from.item), b = itemById(c.to.item), pa = portOf(a, c.from.port), pb = portOf(b, c.to.port), s = S.settings, ad = adaptersOf(c);
    const route = c.wps.length ? 'pins' : (c.route || s.route);
    const uncal = S.floors.length && !S.floors.some(f => f.calibrated);
    return `<div class="sec"><h3>Kabel <span class="chip"><span class="dot" style="background:${typeOf(c.type).color}"></span>${esc(ids[c.id])}</span></h3>
      <div class="box small"><div><span class="muted">Von</span> <b>${esc(itemName(a))}</b> · ${esc(pa.name)} <span class="muted">(${DIRS[pa.dir]})</span></div><div><span class="muted">${isBi(c) ? '⇄' : '→'} Nach</span> <b>${esc(itemName(b))}</b> · ${esc(pb.name)} <span class="muted">(${DIRS[pb.dir]})</span></div></div>
      ${ad.length ? `<div class="warnbox">Adapter nötig: <b>${ad.map(esc).join(', ')}</b>. Er steht automatisch in der Packliste.</div>` : ''}
      <label class="row"><span>Kabeltyp</span><select class="inp" id="cType">${typeOptions(c.type)}</select></label>
      ${field('cLabel', 'Kabel-ID', c.label || '', 'text', `placeholder="${esc(ids[c.id])}" maxlength="40"`)}
      ${field('cNotes', 'Notiz', c.notes || '', 'text', 'placeholder="z. B. über Traverse"')}
      ${readonly ? '' : `<div class="row"><span>Verlegung</span><div class="seg"><button data-route="auto" class="${route === 'auto' ? 'on' : ''}" title="Automatisch um Geräte herum">Auto</button><button data-route="ortho" class="${route === 'ortho' ? 'on' : ''}" title="Einfacher Winkel">Winkel</button><button data-route="direct" class="${route === 'direct' ? 'on' : ''}">Direkt</button><button class="${route === 'pins' ? 'on' : ''}" data-a="pinhint">Pins${c.wps.length ? ' (' + c.wps.length + ')' : ''}</button></div></div>
      ${c.wps.length ? '<button class="btn sm" data-a="clearpins">Pins entfernen, automatisch verlegen</button>' : '<p class="hint small">Doppelklick aufs Kabel setzt einen Pin. Danach bleibt die Führung manuell.</p>'}`}
    </div>
    ${r.nocable ? '<div class="sec"><h3>Länge</h3><p class="hint">Funkverbindung – es wird kein Kabel gepackt.</p></div>' : `
    <div class="sec"><h3>Länge</h3>
      <div class="box"><table class="calc">
        <tr><td>Weg auf dem Plan</td><td>${fmtLen(r.geo, 2)}</td></tr>
        <tr><td>Zuschlag Enden (2 × ${fmtLen(s.endSlack, 1)})</td><td>+ ${fmtLen(r.slack, 2)}</td></tr>
        ${r.height ? `<tr><td>Höhenzuschlag</td><td>+ ${fmtLen(r.height, 2)}</td></tr>` : ''}
        ${r.extra ? `<tr><td>Zusatzlänge dieses Kabels</td><td>+ ${fmtLen(r.extra, 2)}</td></tr>` : ''}
        <tr><td>Reserve ${(+s.reserve).toLocaleString('de-DE')} %</td><td>+ ${fmtLen(r.reserve, 2)}</td></tr>
        <tr class="tot"><td>Berechnet</td><td>${fmtLen(r.total, 2)}</td></tr>
        ${c.override > 0 ? `<tr><td>Feste Länge (manuell)</td><td>${fmtLen(c.override, 2)}</td></tr>` : ''}
        <tr class="pack"><td>In der Packliste</td><td>${fmtLen(r.pack.len)}</td></tr>
      </table>
      <p class="hint small">${r.pack.drum ? 'Länger als das längste Standardkabel – als Trommel/Meterware gerundet.' : r.pack.std ? 'Auf die nächste Standardlänge aufgerundet.' : 'Auf ganze Einheiten aufgerundet.'}${uncal ? ' <b class="warn-t">Der Grundriss ist noch nicht kalibriert – die Länge stimmt erst nach „Maßstab“.</b>' : ''}</p></div>
      ${field('cExtra', `Zusatzlänge (${uName()})`, c.extra ? +toUser(c.extra).toFixed(2) : '', 'text', 'inputmode="decimal" placeholder="z. B. Steigleitung zwischen Etagen"')}
      ${field('cOverride', `Feste Länge (${uName()})`, c.override > 0 ? +toUser(c.override).toFixed(2) : '', 'text', 'inputmode="decimal" placeholder="leer = berechnen"')}
      ${readonly ? '' : '<button class="btn bad" data-a="del">Kabel löschen</button>'}
    </div>`}`;
  }
  function panePlan() {
    const s = S.settings;
    const zones = S.shapes.filter(z => z.kind === 'zone');
    const canTeam = !readonly && me && (meta.access === 'owner' || (meta.team_id && (opts.teams || []).find(t => t.id === meta.team_id)?.role === 'admin'));
    return `${readonly ? '' : `<div class="sec"><h3>Plandetails</h3>
      ${field('mJob', 'Job-ID', meta.job_id, 'text', 'placeholder="z. B. 2026-118" maxlength="60"')}
      ${field('mVenue', 'Ort', meta.venue, 'text', 'placeholder="z. B. Gemeindezentrum" maxlength="160"')}
      <div class="row2"><label class="fld"><span>Aufbau</span><input class="inp" type="date" id="mRig" value="${esc(meta.rig_date || '')}"></label><label class="fld"><span>Veranstaltung</span><input class="inp" type="date" id="mShow" value="${esc(meta.event_date || '')}"></label></div>
      <label class="row"><span>Projekt</span><select class="inp" id="mProject"><option value="">Kein Projekt</option>${(opts.projects || []).map(p => `<option value="${p.id}"${p.id === meta.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      ${canTeam ? `<label class="row"><span>Team</span><select class="inp" id="mTeam"><option value="">Nur ich</option>${(opts.teams || []).map(t => `<option value="${t.id}"${t.id === meta.team_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : meta.team_name ? `<p class="hint">Team: <b>${esc(meta.team_name)}</b></p>` : ''}
      <label class="chk"><input type="checkbox" id="mTpl"${meta.is_template ? ' checked' : ''}> Als Vorlage verwenden</label>
    </div>`}
    <div class="sec"><h3>Grundrisse ${readonly ? '' : '<button class="btn sm pri" data-a="addFloor">+ Laden</button>'}</h3>
      ${S.floors.length ? S.floors.map(f => `<div class="floorrow">
        <div class="fr-head"><input class="inp sm" data-fname="${f.id}" value="${esc(f.name)}" aria-label="Name des Grundrisses"> ${f.calibrated ? '<span class="chip ok">kalibriert</span>' : '<span class="chip warn">nicht kalibriert</span>'}</div>
        <div class="small muted">${fmtNum(toUser(f.w / U), 1)} × ${fmtLen(f.h / U, 1)}</div>
        ${readonly ? '' : `<div class="btnrow"><button class="btn sm pri" data-fa="calib" data-f="${f.id}">Maßstab</button><button class="btn sm" data-fa="lock" data-f="${f.id}">${f.locked === false ? 'Fixieren' : 'Verschieben'}</button><button class="btn sm" data-fa="zoom" data-f="${f.id}">Zeigen</button><button class="btn sm bad" data-fa="del" data-f="${f.id}">Entfernen</button></div>
        ${f.pdf ? `<label class="row"><span>PDF-Maßstab 1:</span><span class="inline"><input class="inp sm" data-pdfscale="${f.id}" type="number" min="1" placeholder="100"><button class="btn sm" data-fa="pdf" data-f="${f.id}">Anwenden</button></span></label>` : ''}
        <label class="row"><span>Deckkraft</span><input type="range" data-fop="${f.id}" min="0.1" max="1" step="0.05" value="${f.opacity ?? 0.9}"></label>
        <div class="chkrow"><label class="chk"><input type="checkbox" data-fvis="${f.id}"${f.visible !== false ? ' checked' : ''}> Anzeigen</label><label class="chk"><input type="checkbox" data-finv="${f.id}"${f.invert ? ' checked' : ''}> Im Dark Mode invertieren</label></div>`}
      </div>`).join('') : `<p class="hint">Lade Grundrisse als Bild (PNG, JPG, SVG, WebP) oder PDF – auch mehrere, z. B. für jede Etage. Danach zwei Punkte mit bekanntem Abstand anklicken; ab dann rechnet PatchPlaner die Kabelwege in ${units.mode === 'ft' ? 'Fuß' : 'Metern'}.</p>`}
    </div>
    <div class="sec"><h3>Kabelberechnung</h3>
      <label class="row"><span>Zuschlag je Ende</span><span class="inline"><input class="inp" id="sSlack" inputmode="decimal" value="${+toUser(s.endSlack).toFixed(2)}"><span class="small muted">${uName()}</span></span></label>
      <label class="row"><span>Höhenzuschlag</span><span class="inline"><input class="inp" id="sHeight" inputmode="decimal" value="${+toUser(s.heightAdd).toFixed(2)}"><span class="small muted">${uName()}/Kabel</span></span></label>
      <label class="row"><span>Reserve</span><span class="inline"><input class="inp" id="sRes" inputmode="decimal" value="${s.reserve}"><span class="small muted">%</span></span></label>
      <label class="chk"><input type="checkbox" id="sRound"${s.roundUp ? ' checked' : ''}> Auf Standardlängen aufrunden</label>
      <div class="row"><span>Verlegung</span><div class="seg"><button data-sroute="auto" class="${s.route === 'auto' ? 'on' : ''}">Auto</button><button data-sroute="ortho" class="${s.route === 'ortho' ? 'on' : ''}">Winkel</button><button data-sroute="direct" class="${s.route === 'direct' ? 'on' : ''}">Direkt</button></div></div>
      <p class="hint small">Länge = Weg auf dem Plan (inkl. Pins) + 2 × Endzuschlag + Höhenzuschlag (z. B. Decke hoch und wieder runter) + Zusatzlänge des Kabels + Reserve. Danach auf die nächste lieferbare Länge des Kabeltyps aufgerundet.</p>
    </div>
    <div class="sec"><h3>Darstellung</h3>
      <div class="row"><span>Ausrichtung</span><div class="seg"><button data-orient="tb" class="${S.orient === 'tb' ? 'on' : ''}">Oben → Unten</button><button data-orient="ltr" class="${S.orient === 'ltr' ? 'on' : ''}">Links → Rechts</button></div></div>
      <label class="row"><span>Gerätegröße</span><input type="range" id="pDs" min="0.25" max="1.5" step="0.05" value="${S.ds}"></label>
      <label class="chk"><input type="checkbox" id="pLbl"${S.labels ? ' checked' : ''} data-ro="1"> Kabel-IDs und Längen am Kabel</label>
      <label class="chk"><input type="checkbox" id="pLeg"${S.legend ? ' checked' : ''} data-ro="1"> Kabel-Legende</label>
      <label class="chk"><input type="checkbox" id="pHops"${S.hops ? ' checked' : ''}> Sprünge an Kabelkreuzungen</label>
      <label class="chk"><input type="checkbox" id="pStrict"${S.strict ? ' checked' : ''}> Nur gleiche Anschlusstypen verbinden</label>
    </div>
    ${zones.length ? `<div class="sec"><h3>Zonen</h3><div class="plist">${zones.map(z => `<div class="prow" data-zone="${z.id}"><span class="dot" style="background:${COLORS[z.color] || z.color}"></span><span class="pn">${esc(z.label || 'Zone')}<small>${fmtNum(toUser(z.w / U), 1)} × ${fmtLen(z.h / U, 1)}</small></span><span class="small muted">zoomen</span></div>`).join('')}</div></div>` : ''}`;
  }
  function packData() {
    const devs = new Map(), ids = cableIds(), cab = new Map(), adapters = new Map(); let total = 0;
    const zk = (p) => (S.packZones ? (zoneOf(p)?.label || 'Ohne Zone') + '|' : '');
    S.items.forEach(it => {
      const z = zk(center(it)); const k = 'd|' + z + it.name;
      const d = devs.get(k) || { key: k, zone: z.slice(0, -1), name: it.name, qty: 0, labels: [], color: it.color }; d.qty++; if (it.label || it.inv) d.labels.push([it.label, it.inv].filter(Boolean).join(' / ')); devs.set(k, d);
    });
    S.cables.forEach(c => {
      const r = calc(c); if (!r || r.nocable) return; total += r.pack.len;
      const mid = r.pts[Math.floor(r.pts.length / 2)]; const z = zk(mid);
      const k = 'c|' + z + c.type + '|' + r.pack.len.toFixed(2);
      const d = cab.get(k) || { key: k, zone: z.slice(0, -1), type: c.type, len: r.pack.len, drum: r.pack.drum, qty: 0, ids: [] }; d.qty++; d.ids.push(ids[c.id]); cab.set(k, d);
      adaptersOf(c).forEach(a => { const ak = 'a|' + a; const x = adapters.get(ak) || { key: ak, name: a, qty: 0 }; x.qty++; adapters.set(ak, x); });
    });
    const order = Object.keys(TYPES);
    const cabs = [...cab.values()].sort((a, b) => (a.zone || '').localeCompare(b.zone || '') || order.indexOf(a.type) - order.indexOf(b.type) || a.len - b.len);
    const devList = [...devs.values()].sort((a, b) => (a.zone || '').localeCompare(b.zone || '') || a.name.localeCompare(b.name));
    const all = [...devList, ...cabs, ...adapters.values(), ...S.extras.map(e => ({ key: 'e|' + e.id }))];
    const done = all.filter(x => checks[x.key]).length;
    return { devs: devList, cabs, adapters: [...adapters.values()], total, all, done };
  }
  function panePack() {
    const d = packData(), pct = d.all.length ? Math.round(d.done / d.all.length * 100) : 0;
    const row = (key, name, sub, q, col) => { const ch = checks[key]; return `<div class="prow${ch ? ' done' : ''}${readonly ? ' ro' : ''}" data-pk="${esc(key)}" role="checkbox" aria-checked="${!!ch}" tabindex="0"><span class="box2">${ch ? '✓' : ''}</span><span class="pn">${col ? `<span class="dot" style="background:${col}"></span> ` : ''}${name}${sub || ch ? `<small>${sub || ''}${ch && ch.by ? `${sub ? ' · ' : ''}gepackt von ${esc(ch.by)}` : ''}</small>` : ''}</span><span class="q">${q}×</span></div>`; };
    const groupBy = (arr, f) => { const g = {}; arr.forEach(x => (g[f(x)] = g[f(x)] || []).push(x)); return g; };
    const devG = groupBy(d.devs, x => x.zone || ''), cabG = groupBy(d.cabs, x => x.zone || '');
    const zoneHead = (z) => (S.packZones && z ? `<div class="zonehead">${esc(z)}</div>` : '');
    return `<div class="stats"><div class="stat"><b>${d.devs.reduce((a, b) => a + b.qty, 0)}</b><span>Geräte</span></div><div class="stat"><b>${S.cables.filter(c => !typeOf(c.type).nocable).length}</b><span>Kabel</span></div><div class="stat"><b>${fmtLen(d.total).replace(/ .*/, '')}</b><span>${uName()} Kabel</span></div></div>
      <div class="sec"><h3>Gepackt <span class="chip ${pct === 100 ? 'ok' : ''}">${pct} %</span></h3><div class="progress"><div style="width:${pct}%"></div></div>
      ${S.shapes.some(s => s.kind === 'zone') ? `<label class="chk"><input type="checkbox" id="pkZones"${S.packZones ? ' checked' : ''}> Nach Zonen gruppieren</label>` : ''}</div>
      <div class="sec"><h3>Geräte</h3>${Object.keys(devG).map(z => zoneHead(z) + `<div class="plist">${devG[z].map(x => row(x.key, esc(x.name), esc(x.labels.join(', ')), x.qty)).join('')}</div>`).join('') || '<p class="hint">Noch keine Geräte im Plan.</p>'}</div>
      <div class="sec"><h3>Kabel <span class="muted small">Längen aus dem Plan</span></h3>${Object.keys(cabG).map(z => zoneHead(z) + `<div class="plist">${cabG[z].map(x => row(x.key, `${esc(typeOf(x.type).name)} ${fmtLen(x.len)}${x.drum ? ' <span class="chip warn">Trommel</span>' : ''}`, esc(x.ids.join(', ')), x.qty, typeOf(x.type).color)).join('')}</div>`).join('') || '<p class="hint">Noch keine Kabel.</p>'}</div>
      ${d.adapters.length ? `<div class="sec"><h3>Adapter und Wandler</h3><div class="plist">${d.adapters.map(x => row(x.key, esc(x.name), '', x.qty)).join('')}</div></div>` : ''}
      <div class="sec"><h3>Extras</h3><div class="plist">${S.extras.map(e => { const ch = checks['e|' + e.id]; return `<div class="prow${ch ? ' done' : ''}${readonly ? ' ro' : ''}" data-pk="e|${e.id}" role="checkbox" aria-checked="${!!ch}" tabindex="0"><span class="box2">${ch ? '✓' : ''}</span><span class="pn">${esc(e.name)}${ch && ch.by ? `<small>gepackt von ${esc(ch.by)}</small>` : ''}</span><span class="inline"><span class="q">${e.qty || 1}×</span>${readonly ? '' : `<button class="rm" data-rmx="${e.id}" title="Entfernen" aria-label="Entfernen">✕</button>`}</span></div>`; }).join('')}</div>
        ${readonly ? '' : '<div class="inline"><input class="inp" id="exQty" type="number" min="1" value="1" style="width:68px" aria-label="Anzahl"><input class="inp" id="exName" placeholder="z. B. Gaffa-Tape, Kabelbrücke … Enter"></div>'}</div>
      <div class="btnrow"><button class="btn" data-a="csvPack" data-ro="1">CSV</button><button class="btn" data-a="pdfPack" data-ro="1">PDF</button><button class="btn" data-a="copyPack" data-ro="1">Als Text kopieren</button>${readonly ? '' : '<button class="btn" data-a="resetPack">Häkchen zurücksetzen</button>'}</div>`;
  }
  function patchRows() {
    const ids = cableIds();
    return S.cables.map(c => {
      const r = calc(c); const a = itemById(c.from.item), b = itemById(c.to.item); if (!r || !a || !b) return null;
      const za = zoneOf(center(a)), zb = zoneOf(center(b));
      return { c, id: ids[c.id], type: typeOf(c.type).name, from: `${itemName(a)} · ${portOf(a, c.from.port).name}`, to: `${itemName(b)} · ${portOf(b, c.to.port).name}`,
        fromZone: za?.label || '', toZone: zb?.label || '', geo: r.geo, calc: r.total, pack: r.pack.len, nocable: r.nocable, bi: isBi(c), ad: adaptersOf(c).join(', '), notes: c.notes || '' };
    }).filter(Boolean);
  }
  function panePatch() {
    const rows = patchRows(); const zones = rows.some(r => r.fromZone || r.toZone);
    return `<div class="sec"><h3>Patchliste <span class="muted small">${rows.length} Verbindungen</span></h3>
      ${rows.length ? `<div class="tscroll"><table class="patch"><thead><tr><th>ID</th><th>Quelle</th><th></th><th>Ziel</th>${zones ? '<th>Zonen</th>' : ''}<th class="num">Weg</th><th class="num">Pack</th></tr></thead><tbody>${rows.map(r => `<tr data-sc="${r.c.id}"><td><span class="dot" style="background:${typeOf(r.c.type).color}"></span> <b>${esc(r.id)}</b></td><td>${esc(r.from)}</td><td>${r.bi ? '⇄' : '→'}</td><td>${esc(r.to)}${r.ad ? `<br><span class="small warn-t">Adapter: ${esc(r.ad)}</span>` : ''}${r.notes ? `<br><span class="small muted">${esc(r.notes)}</span>` : ''}</td>${zones ? `<td class="small">${esc(r.fromZone)}${r.fromZone !== r.toZone ? ' → ' + esc(r.toZone) : ''}</td>` : ''}<td class="num">${fmtLen(r.geo, 1)}</td><td class="num"><b>${r.nocable ? 'Funk' : fmtLen(r.pack)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Noch keine Verbindungen. Ziehe ein Kabel von Port zu Port.</p>'}
      <div class="btnrow"><button class="btn" data-a="csvPatch" data-ro="1">CSV</button><button class="btn" data-a="pdfPatch" data-ro="1">PDF</button></div></div>`;
  }

  /* Inspektor-Ereignisse */
  let editSnap = false;
  const editStart = () => { if (!editSnap) { pushUndo(); editSnap = true; } };
  on(pane, 'focusout', () => { editSnap = false; setTimeout(() => { if (!pane.contains(document.activeElement)) renderPane(); }, 0); });
  on(pane, 'input', (e) => {
    if (readonly) return;
    const t = e.target, id = t.id, one = [...sel.ids][0], it = itemById(one), s = shapeById(one), c = cableById(sel.cable);
    const set = (o, k, v) => { editStart(); o[k] = v; render(); markDirty(); };
    if (it) { if (id === 'iLabel') set(it, 'label', t.value); if (id === 'iName') set(it, 'name', t.value); if (id === 'iInv') set(it, 'inv', t.value); if (id === 'iNotes') set(it, 'notes', t.value); if (id === 'iColor') set(it, 'color', t.value); }
    if (s) { if (id === 'shLabel') set(s, 'label', t.value); if (id === 'shText') set(s, 'text', t.value); if (id === 'shSize') set(s, 'size', +t.value); if (id === 'shRot') { set(s, 'rot', +t.value); t.nextElementSibling.textContent = t.value + '°'; } }
    if (c) { if (id === 'cLabel') set(c, 'label', t.value.trim()); if (id === 'cNotes') set(c, 'notes', t.value); if (id === 'cOverride') set(c, 'override', t.value.trim() ? fromUser(num(t.value)) : null); if (id === 'cExtra') set(c, 'extra', t.value.trim() ? fromUser(num(t.value)) : 0); }
    if (id === 'mJob') setMeta('job_id', t.value); if (id === 'mVenue') setMeta('venue', t.value);
    if (t.dataset.fname) { const f = floorById(t.dataset.fname); set(f, 'name', t.value); }
    if (t.dataset.fop) { const f = floorById(t.dataset.fop); set(f, 'opacity', +t.value); }
    if (id === 'pDs') { editStart(); S.ds = +t.value; clearLayoutCache(); render(); markDirty(); }
    const st = S.settings;
    if (id === 'sSlack') set(st, 'endSlack', Math.max(0, fromUser(num(t.value)))); if (id === 'sHeight') set(st, 'heightAdd', Math.max(0, fromUser(num(t.value)))); if (id === 'sRes') set(st, 'reserve', clamp(num(t.value), 0, 200));
  });
  on(pane, 'change', (e) => {
    const t = e.target, id = t.id, c = cableById(sel.cable), s = shapeById([...sel.ids][0]);
    if (id === 'pLbl') { S.labels = t.checked; render(); if (!readonly) markDirty(); return; }
    if (id === 'pLeg') { S.legend = t.checked; render(); if (!readonly) markDirty(); return; }
    if (readonly) return;
    if (id === 'cType' && c) { pushUndo(); c.type = t.value; changed(); }
    if (id === 'mRig') setMeta('rig_date', t.value || null); if (id === 'mShow') setMeta('event_date', t.value || null);
    if (id === 'mProject') setMeta('project_id', t.value || null);
    if (id === 'mTeam') { setMeta('team_id', t.value || null); toast(t.value ? 'Plan mit dem Team geteilt.' : 'Plan ist jetzt nur für dich.'); }
    if (id === 'mTpl') setMeta('is_template', t.checked);
    if (t.dataset.fvis) { pushUndo(); floorById(t.dataset.fvis).visible = t.checked; changed(); }
    if (t.dataset.finv) { pushUndo(); floorById(t.dataset.finv).invert = t.checked; changed(); }
    if (id === 'sRound') { pushUndo(); S.settings.roundUp = t.checked; changed(); }
    if (id === 'pHops') { S.hops = t.checked; changed(); }
    if (id === 'pStrict') { S.strict = t.checked; changed(); }
    if (id === 'pkZones') { S.packZones = t.checked; changed(); }
    if (id === 'shBold' && s) { pushUndo(); s.bold = t.checked; changed(); }
    if (['sSlack', 'sHeight', 'sRes', 'cOverride', 'cExtra', 'pDs'].includes(id) || t.dataset.fop) renderPane();
  });
  on(pane, 'keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'exName') { const v = e.target.value.trim(); if (!v) return; pushUndo(); S.extras.push({ id: uid(), name: v, qty: Math.max(1, +$('#exQty', E).value || 1) }); changed(); setTimeout(() => $('#exName', E)?.focus(), 0); }
    if (e.key === 'Enter' && e.target.dataset.pdfscale) applyPdfScale(e.target.dataset.pdfscale);
    if ((e.key === ' ' || e.key === 'Enter') && e.target.dataset.pk) { e.preventDefault(); togglePack(e.target.dataset.pk); }
  });
  on(pane, 'click', (e) => {
    const t = e.target;
    if (t.closest('[data-rmx]')) { pushUndo(); const id = t.closest('[data-rmx]').dataset.rmx; S.extras = S.extras.filter(x => x.id !== id); changed(); return; }
    const pk = t.closest('[data-pk]'); if (pk) { togglePack(pk.dataset.pk); return; }
    const sc = t.closest('[data-sc]'); if (sc) { const cid = sc.dataset.sc; sel = { ids: new Set(), cable: cid }; zoomTo(cablePts(cableById(cid))); tab = 'sel'; renderPane(); return; }
    const selc = t.closest('[data-selc]'); if (selc) { sel = { ids: new Set(), cable: selc.dataset.selc }; render(); renderPane(); return; }
    const zr = t.closest('[data-zone]'); if (zr) { const z = shapeById(zr.dataset.zone); fit({ x: z.x, y: z.y - 30, w: z.w, h: z.h + 30 }); return; }
    const b = t.closest('button'); if (!b) return;
    const one = [...sel.ids][0], s = shapeById(one), c = cableById(sel.cable);
    if (b.dataset.fa) { floorAction(b.dataset.fa, b.dataset.f); return; }
    if (readonly && !b.dataset.ro) return;
    if (b.dataset.scol && s) { pushUndo(); s.color = b.dataset.scol; changed(); }
    if (b.dataset.sfill && s) { pushUndo(); s.fill = b.dataset.sfill; changed(); }
    if (b.dataset.swt && s) { pushUndo(); s.weight = +b.dataset.swt; changed(); }
    if (b.dataset.route && c) { pushUndo(); c.route = b.dataset.route; c.wps = []; changed(); }
    if (b.dataset.sroute) { pushUndo(); S.settings.route = b.dataset.sroute; changed(); }
    if (b.dataset.orient && b.dataset.orient !== S.orient) act('orient');
    if (b.dataset.a) act(b.dataset.a);
  });
  async function togglePack(key) {
    if (readonly) return;
    const now = !checks[key];
    if (now) checks[key] = { by: me?.name, at: Date.now() }; else delete checks[key];
    renderPane();
    try { await api.put(`/api/plans/${planId}/pack`, { key, checked: now }); } catch (e) { toast(e.message, 4000, 'bad'); }
  }
  function floorAction(a, id) {
    const f = floorById(id); if (!f) return;
    if (a === 'zoom') { fit(f); return; }
    if (readonly) return;
    if (a === 'calib') { setMode('calib'); calib = { floor: id }; fit(f); }
    if (a === 'lock') { pushUndo(); f.locked = f.locked === false; changed(); toast(f.locked ? 'Grundriss fixiert.' : 'Ziehe den Grundriss jetzt an die richtige Stelle.'); }
    if (a === 'del') { const btn = pane.querySelector(`[data-fa="del"][data-f="${id}"]`); if (btn && !armButton(btn, 'Wirklich entfernen?')) return; removeFloor(id); }
    if (a === 'pdf') applyPdfScale(id);
  }
  function applyPdfScale(id) {
    const f = floorById(id); const N = num(pane.querySelector(`[data-pdfscale="${id}"]`)?.value);
    const a = assets.get(f.asset);
    if (!(N > 0) || !f.pdf || !a) { toast('Gib den Zeichnungsmaßstab ein, z. B. 100 für 1:100.'); return; }
    const mPerPx = f.pdf.ptPerPx * 0.000352778 * N;
    const factor = (mPerPx * U) / (f.w / a.w);
    pushUndo(); scaleFloor(f, factor); f.calibrated = true; routeCache.clear(); changed(); fit(f); toast('PDF-Maßstab 1:' + N + ' übernommen. Alle Kabellängen sind aktualisiert.');
  }
  function zoomTo(pts) { if (!pts) return; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; pts.forEach(p => { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }); fit({ x: x1, y: y1, w: Math.max(x2 - x1, 4 * U), h: Math.max(y2 - y1, 3 * U) }); }

  /* ---------- Aktionen ---------- */
  function act(a) {
    const one = [...sel.ids][0];
    switch (a) {
      case 'exit': leave(); break;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'draw': toggleDtb(); break;
      case 'grid': S.grid = !S.grid; changed(); break;
      case 'orient': pushUndo(); S.orient = S.orient === 'tb' ? 'ltr' : 'tb'; clearLayoutCache(); routeCache.clear(); changed(); break;
      case 'fit': fit(); break;
      case 'zoomin': setZoom(view.z * 1.25); break;
      case 'zoomout': setZoom(view.z / 1.25); break;
      case 'share': openShare(); break;
      case 'export': openExport(); break;
      case 'help': showHelp(); break;
      case 'newgear': navigate('/gear/new?back=' + encodeURIComponent(location.pathname)); break;
      case 'del': deleteSelection(); break;
      case 'dup': duplicateSelection(); break;
      case 'edit': editItemPorts(one); break;
      case 'savegear': saveItemAsGear(itemById(one)); break;
      case 'syncgear': syncItemFromGear(itemById(one)); break;
      case 'zoomzone': { const z = shapeById(one); fit({ x: z.x, y: z.y - 30, w: z.w, h: z.h + 30 }); break; }
      case 'clearpins': pushUndo(); cableById(sel.cable).wps = []; changed(); break;
      case 'pinhint': toast('Doppelklick auf das Kabel setzt einen Pin. Rechtsklick → „Pin hinzufügen“ geht auch.'); break;
      case 'cancelMode': setMode('select'); break;
      case 'addFloor': $('#fFloor', E).click(); break;
      case 'applyCalib': {
        const v = num($('#calM', E)?.value);
        if (!(v > 0)) { toast('Gib den echten Abstand ein, z. B. 12,5.'); return; }
        const d = dist(calib.p1, calib.p2); if (d < 1) { toast('Die Punkte liegen zu nah beieinander.'); return; }
        const f = floorById(calib.floor) || S.floors.find(fl => calib.p1.x >= fl.x && calib.p1.x <= fl.x + fl.w && calib.p1.y >= fl.y && calib.p1.y <= fl.y + fl.h) || S.floors[0];
        pushUndo(); scaleFloor(f, fromUser(v) * U / d); f.calibrated = true; routeCache.clear(); setMode('select'); changed(); fit(f);
        toast(`Maßstab gesetzt: ${v.toLocaleString('de-DE')} ${uName()}. Alle Kabellängen sind aktualisiert.`, 4000);
        break;
      }
      case 'copyPack': copyText(packText(), 'Packliste'); break;
      case 'csvPack': download(toCSV(packRows()), fileBase() + '-packliste.csv', 'text/csv'); break;
      case 'csvPatch': download(toCSV(patchCsvRows()), fileBase() + '-patchliste.csv', 'text/csv'); break;
      case 'pdfPack': exportPdf({ plan: false, pack: true, patch: false }); break;
      case 'pdfPatch': exportPdf({ plan: false, pack: false, patch: true }); break;
      case 'resetPack': {
        const btn = pane.querySelector('[data-a="resetPack"]'); if (btn && !armButton(btn, 'Alle Häkchen löschen?')) return;
        checks = {}; renderPane(); api.del(`/api/plans/${planId}/pack`).catch(er => toast(er.message)); break;
      }
    }
    if (a === 'front' || a === 'back') {
      pushUndo(); ['items', 'shapes'].forEach(k => { const x = S[k].filter(o => sel.ids.has(o.id)), r = S[k].filter(o => !sel.ids.has(o.id)); S[k] = a === 'front' ? [...r, ...x] : [...x, ...r]; }); changed();
    }
  }
  E.querySelector('.ed-top').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  on($('#hud', E), 'click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  on($('#fFloor', E), 'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadFloor(f); });
  const nameEl = $('#edName', E); nameEl.value = meta.name || '';
  on(nameEl, 'input', () => { if (!readonly) setMeta('name', nameEl.value.trim() || 'Ohne Namen'); });
  on(nameEl, 'keydown', e => { if (e.key === 'Enter') nameEl.blur(); });

  /* ---------- Teilen ---------- */
  async function openShare() {
    const m = modal(`<header><h2>Plan teilen</h2><button class="btn sm" data-x>Schließen</button></header>
      <div class="mb">
        <div class="sec"><h3>Link zum Ansehen</h3>
          <p class="hint">Jeder mit dem Link kann den Plan, die Packliste und die Patchliste ansehen, aber nichts ändern. Ein Konto braucht man dafür nicht.</p>
          <label class="chk big"><input type="checkbox" id="shOn"${meta.share_enabled ? ' checked' : ''}> Freigabe-Link aktiv</label>
          <div id="shLink"></div>
        </div>
        ${(opts.teams || []).length ? `<div class="sec"><h3>Mit dem Team</h3><p class="hint">Team-Mitglieder können den Plan öffnen und bearbeiten. Das stellst du im Plan-Tab unter „Team“ ein.</p></div>` : '<div class="sec"><h3>Gemeinsam bearbeiten</h3><p class="hint">Leg unter „Team“ ein Team an und lade Leute ein, um Pläne gemeinsam zu bearbeiten.</p></div>'}
      </div>`);
    const renderLink = () => {
      const box = m.el.querySelector('#shLink');
      if (!meta.share_enabled || !meta.share_token) { box.innerHTML = ''; return; }
      const url = `${location.origin}/share/${meta.share_token}`;
      box.innerHTML = `<div class="inline"><input class="inp mono" readonly value="${esc(url)}" id="shUrl"><button class="btn pri" id="shCopy">Kopieren</button></div><div class="btnrow"><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">Öffnen</a><button class="btn sm" id="shRegen">Neuen Link erzeugen</button></div><p class="hint small">Ein neuer Link macht den alten ungültig.</p>`;
      box.querySelector('#shCopy').onclick = () => copyText(url, 'Link');
      box.querySelector('#shUrl').onclick = (e) => e.target.select();
      box.querySelector('#shRegen').onclick = async (e) => { if (!armButton(e.target, 'Alten Link ungültig machen?')) return; await setShare(true, true); renderLink(); toast('Neuer Link erzeugt.'); };
    };
    const setShare = async (enabled, regenerate) => { try { const r = await api.post(`/api/plans/${planId}/share`, { enabled, regenerate }); meta.share_enabled = r.share_enabled; meta.share_token = r.share_token; } catch (e) { toast(e.message); } };
    m.el.querySelector('#shOn').onchange = async (e) => { await setShare(e.target.checked, false); renderLink(); };
    renderLink();
  }

  /* ---------- Export ---------- */
  const fileBase = () => (meta.name || 'plan').replace(/[^\wäöüÄÖÜß.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plan';
  async function exportCanvas({ scale = 2, bg = '#ffffff', floors = true, maxDim = 9000 } = {}) {
    const saved = { ...view }, savedSel = sel; sel = { ids: new Set(), cable: null };
    const b = contentBounds(floors);
    view = { x: 0, y: 0, z: 1 }; draw();
    try { return await renderPlanCanvas(svg, b, { scale, bg, floors, maxDim }); }
    finally { view = saved; sel = savedSel; draw(); }
  }
  function openExport() {
    const m = modal(`<header><h2>Export</h2><button class="btn sm" data-x>Schließen</button></header>
      <div class="mb">
        <div class="sec"><h3>Plan als Bild oder PDF</h3>
          <div class="row2">
            <label class="fld"><span>Format</span><select class="inp" id="xFmt"><option value="pdf">PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
            <label class="fld"><span>Auflösung</span><select class="inp" id="xScale"><option value="1">Normal</option><option value="2" selected>Hoch</option><option value="3">Sehr hoch</option></select></label>
          </div>
          <div class="row2" id="xPdfOpts">
            <label class="fld"><span>Papier</span><select class="inp" id="xPaper"><option>A4</option><option selected>A3</option><option>A2</option><option>Letter</option></select></label>
            <label class="fld"><span>Ausrichtung</span><select class="inp" id="xLand"><option value="1">Quer</option><option value="0">Hoch</option></select></label>
          </div>
          <div class="chkrow"><label class="chk"><input type="checkbox" id="xFloors" checked> Grundrisse</label><label class="chk"><input type="checkbox" id="xWhite" checked> Weißer Hintergrund</label></div>
          <div class="chkrow" id="xPdfLists"><label class="chk"><input type="checkbox" id="xPack" checked> Packliste anhängen</label><label class="chk"><input type="checkbox" id="xPatch" checked> Patchliste anhängen</label></div>
          <button class="btn pri" id="xGo">Exportieren</button>
        </div>
        <div class="sec"><h3>Listen</h3><div class="btnrow"><button class="btn" id="xCsvPack">Packliste (CSV)</button><button class="btn" id="xCsvPatch">Patchliste (CSV)</button><button class="btn" id="xTxt">Packliste als Text</button></div></div>
        ${readonly ? '' : `<div class="sec"><h3>Plandatei</h3><p class="hint">Der Plan als JSON-Datei, z. B. zum Sichern oder für eine andere PatchPlaner-Installation. Grundrisse sind nicht enthalten.</p><div class="btnrow"><button class="btn" id="xJson">Plan exportieren (JSON)</button></div></div>`}
      </div>`);
    const q = (s) => m.el.querySelector(s);
    const upd = () => { const pdf = q('#xFmt').value === 'pdf'; q('#xPdfOpts').hidden = !pdf; q('#xPdfLists').hidden = !pdf; q('#xWhite').closest('label').hidden = q('#xFmt').value === 'jpg'; };
    q('#xFmt').onchange = upd; upd();
    q('#xGo').onclick = async () => {
      const fmt = q('#xFmt').value, scale = +q('#xScale').value, floors = q('#xFloors').checked;
      const bg = fmt === 'png' && !q('#xWhite').checked ? null : '#ffffff';
      q('#xGo').disabled = true; q('#xGo').textContent = 'Wird erstellt …';
      try {
        if (fmt === 'pdf') await exportPdf({ plan: true, pack: q('#xPack').checked, patch: q('#xPatch').checked, scale, floors, paper: q('#xPaper').value, landscape: q('#xLand').value === '1' });
        else { const cv = await exportCanvas({ scale, bg, floors }); download(await canvasBlob(cv, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92), `${fileBase()}.${fmt}`); }
        m.close();
      } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 5000, 'bad'); q('#xGo').disabled = false; q('#xGo').textContent = 'Exportieren'; }
    };
    q('#xCsvPack').onclick = () => download(toCSV(packRows()), fileBase() + '-packliste.csv', 'text/csv');
    q('#xCsvPatch').onclick = () => download(toCSV(patchCsvRows()), fileBase() + '-patchliste.csv', 'text/csv');
    q('#xTxt').onclick = () => copyText(packText(), 'Packliste');
    const j = q('#xJson'); if (j) j.onclick = () => download(JSON.stringify({ app: 'PatchPlaner', v: 3, name: meta.name, meta: { job_id: meta.job_id, venue: meta.venue, rig_date: meta.rig_date, event_date: meta.event_date }, data: { ...S, floors: [] } }, null, 1), fileBase() + '.patchplaner.json', 'application/json');
  }
  function subtitle() { return [meta.job_id && 'Job ' + meta.job_id, meta.venue, meta.rig_date && 'Aufbau ' + fmtDate(meta.rig_date), meta.event_date && 'Veranstaltung ' + fmtDate(meta.event_date)].filter(Boolean).join('  ·  '); }
  async function exportPdf({ plan = true, pack = true, patch = true, scale = 2, floors = true, paper = 'A3', landscape = true }) {
    const pages = [];
    if (plan) {
      const cv = await exportCanvas({ scale, bg: '#ffffff', floors, maxDim: 7000 });
      const blob = await canvasBlob(cv, 'image/jpeg', 0.9);
      pages.push({ kind: 'image', jpeg: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height, title: 'Plan' });
    }
    if (pack) {
      const d = packData(); const rows = [];
      const sec = (t) => rows.push({ group: t });
      const chk = (k) => (checks[k] ? '✓' : '');
      sec('Geräte'); d.devs.forEach(x => rows.push({ cells: [chk(x.key), x.qty + '×', x.name, (S.packZones && x.zone ? x.zone + ' · ' : '') + x.labels.join(', ')] }));
      sec('Kabel'); d.cabs.forEach(x => rows.push({ cells: [chk(x.key), x.qty + '×', `${typeOf(x.type).name} ${fmtLen(x.len)}${x.drum ? ' (Trommel)' : ''}`, (S.packZones && x.zone ? x.zone + ' · ' : '') + x.ids.join(', ')] }));
      if (d.adapters.length) { sec('Adapter und Wandler'); d.adapters.forEach(x => rows.push({ cells: [chk(x.key), x.qty + '×', x.name, ''] })); }
      if (S.extras.length) { sec('Extras'); S.extras.forEach(e => rows.push({ cells: [chk('e|' + e.id), (e.qty || 1) + '×', e.name, ''] })); }
      pages.push({ kind: 'table', title: 'Packliste', columns: [{ label: 'OK', w: 30 }, { label: 'Anz.', w: 45, align: 'right' }, { label: 'Artikel', w: 300, bold: true }, { label: 'Details', w: 420 }], rows, footer: `Gesamt: ${fmtLen(d.total)} Kabel` });
    }
    if (patch) {
      const rows = patchRows().map(r => ({ cells: [r.id, r.type, r.from, r.bi ? '<->' : '->', r.to + (r.ad ? ` (Adapter: ${r.ad})` : ''), r.nocable ? '–' : fmtLen(r.geo, 1), r.nocable ? 'Funk' : fmtLen(r.pack)] }));
      pages.push({ kind: 'table', title: 'Patchliste', columns: [{ label: 'ID', w: 70, bold: true }, { label: 'Typ', w: 90 }, { label: 'Quelle', w: 230 }, { label: '', w: 28 }, { label: 'Ziel', w: 260 }, { label: 'Weg', w: 60, align: 'right' }, { label: 'Pack', w: 60, align: 'right' }], rows });
    }
    const blob = buildPdf({ title: meta.name || 'Plan', subtitle: subtitle(), format: paper, landscape, pages });
    download(blob, `${fileBase()}${plan ? '' : pack && !patch ? '-packliste' : !pack && patch ? '-patchliste' : ''}.pdf`, 'application/pdf');
  }
  function packRows() {
    const d = packData(); const rows = [['Bereich', 'Zone', 'Artikel', 'Anzahl', 'Länge (' + uName() + ')', 'Details', 'Gepackt']];
    d.devs.forEach(x => rows.push(['Gerät', x.zone || '', x.name, x.qty, '', x.labels.join(', '), checks[x.key] ? 'ja' : 'nein']));
    d.cabs.forEach(x => rows.push(['Kabel', x.zone || '', typeOf(x.type).name, x.qty, fmtNum(toUser(x.len), 1), x.ids.join(', '), checks[x.key] ? 'ja' : 'nein']));
    d.adapters.forEach(x => rows.push(['Adapter', '', x.name, x.qty, '', '', checks[x.key] ? 'ja' : 'nein']));
    S.extras.forEach(e => rows.push(['Extra', '', e.name, e.qty || 1, '', '', checks['e|' + e.id] ? 'ja' : 'nein']));
    return rows;
  }
  function patchCsvRows() {
    const rows = [['ID', 'Typ', 'Quelle', 'Quell-Zone', 'Ziel', 'Ziel-Zone', 'Richtung', `Weg (${uName()})`, `Berechnet (${uName()})`, `Packlänge (${uName()})`, 'Adapter', 'Notiz']];
    patchRows().forEach(r => rows.push([r.id, r.type, r.from, r.fromZone, r.to, r.toZone, r.bi ? 'bidirektional' : '→', fmtNum(toUser(r.geo), 2), r.nocable ? '' : fmtNum(toUser(r.calc), 2), r.nocable ? 'Funk' : fmtNum(toUser(r.pack), 1), r.ad, r.notes]));
    return rows;
  }
  function packText() {
    const d = packData(); let t = `PACKLISTE – ${meta.name}${meta.job_id ? ' (' + meta.job_id + ')' : ''}\n${subtitle()}\n\nGERÄTE\n`;
    d.devs.forEach(x => { t += `[${checks[x.key] ? 'x' : ' '}] ${x.qty}× ${x.name}${x.labels.length ? ' – ' + x.labels.join(', ') : ''}\n`; });
    t += '\nKABEL\n'; d.cabs.forEach(x => { t += `[${checks[x.key] ? 'x' : ' '}] ${x.qty}× ${typeOf(x.type).name} ${fmtLen(x.len)} – ${x.ids.join(', ')}\n`; });
    if (d.adapters.length) { t += '\nADAPTER\n'; d.adapters.forEach(x => { t += `[${checks[x.key] ? 'x' : ' '}] ${x.qty}× ${x.name}\n`; }); }
    if (S.extras.length) { t += '\nEXTRAS\n'; S.extras.forEach(e => { t += `[${checks['e|' + e.id] ? 'x' : ' '}] ${e.qty || 1}× ${e.name}\n`; }); }
    return t + `\nGesamt: ${fmtLen(d.total)} Kabel`;
  }

  /* ---------- Hilfe ---------- */
  function showHelp() {
    modal(`<header><h2>Tastenkürzel</h2><button class="btn sm" data-x>Schließen</button></header><div class="mb"><table class="keys">
      ${[['V', 'Auswählen'], ['K', 'Maßstab am Grundriss setzen'], ['M', 'Strecke messen'], ['Shift D', 'Zeichenwerkzeuge ein/aus'], ['T / Z', 'Text / Zone zeichnen'], ['L', 'Ausrichtung Oben→Unten / Links→Rechts'],
         ['F', 'Alles einpassen'], ['+ / −', 'Zoomen'], ['G', 'Raster ein/aus'], ['Strg Z / Strg Shift Z', 'Rückgängig / Wiederholen'], ['Strg D', 'Duplizieren'], ['Strg C / V', 'Kopieren / Einfügen'],
         ['Strg A', 'Alles auswählen'], ['Entf', 'Löschen'], ['Pfeiltasten', 'Verschieben (Shift = 1 m)'], ['Shift + Ziehen', 'Rahmenauswahl'], ['Doppelklick Kabel', 'Pin setzen'], ['Doppelklick Gerät', 'Ports bearbeiten'],
         ['Alt + Zone ziehen', 'Zone ohne Inhalt verschieben'], ['Rechtsklick / lange drücken', 'Kontextmenü'], ['Strg S', 'Sofort speichern'], ['Esc', 'Abbrechen']].map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}
    </table></div>`);
  }

  /* ---------- Live-Abgleich ---------- */
  let es = null;
  function connectLive() {
    if (destroyed) return;
    es = new EventSource(`/api/plans/${loaded.id}/events?client=${clientId}${shareToken ? '&s=' + encodeURIComponent(shareToken) : ''}`);
    es.addEventListener('presence', (ev) => { presenceList = JSON.parse(ev.data).filter(p => p.clientId !== clientId); renderPresence(); });
    es.addEventListener('plan', async (ev) => {
      const d = JSON.parse(ev.data);
      if (d.version <= version) return;
      if (readonly) { await reloadShared(); return; }
      if (dirty || saving) { conflict = true; showConflict({ by: d.by }); setSaveState('Konflikt', 'bad'); return; }
      await reloadFromServer(d.by);
    });
    es.addEventListener('meta', (ev) => {
      const d = JSON.parse(ev.data);
      for (const k of ['name', 'job_id', 'venue', 'rig_date', 'event_date', 'project_id', 'team_id']) if (k in d) meta[k] = d[k];
      const n = $('#edName', E); if (n && document.activeElement !== n) n.value = meta.name || '';
      if (tab === 'plan' || readonly) renderPane();
    });
    es.addEventListener('pack', (ev) => { const d = JSON.parse(ev.data); if (d.checked) checks[d.key] = { by: d.by, at: d.at }; else delete checks[d.key]; if (tab === 'pack') renderPane(); });
    es.addEventListener('packreset', () => { checks = {}; if (tab === 'pack') renderPane(); });
    es.addEventListener('deleted', () => { toast('Dieser Plan wurde gelöscht.', 6000, 'bad'); if (!shareToken) setTimeout(() => navigate('/plans'), 1500); });
  }
  async function reloadShared() {
    try { const cur = await api.get(`/api/share/${encodeURIComponent(shareToken)}`, { noAuthRedirect: true }); S = normalize(cur.data); version = cur.version; checks = cur.checks || {}; (cur.assets || []).forEach(a => assets.set(a.id, a)); clearLayoutCache(); routeCache.clear(); render(); renderPane(); } catch { /* egal */ }
  }
  function renderPresence() {
    const el = $('#presence', E); if (!el) return;
    const uniq = []; const seen = new Set();
    for (const p of presenceList) { const k = p.userId || p.clientId; if (seen.has(k)) continue; seen.add(k); uniq.push(p); }
    el.innerHTML = uniq.slice(0, 5).map(p => `<span class="av" style="background:${avatarColor(p.name)}" title="${esc(p.name)}${p.viewer ? ' (Ansicht über Link)' : ''} ist auch hier">${esc(initials(p.name))}</span>`).join('') + (uniq.length > 5 ? `<span class="av more">+${uniq.length - 5}</span>` : '');
  }
  connectLive();

  /* ---------- Verlassen ---------- */
  async function leave() {
    if (dirty && !conflict) { scheduleSave.cancel(); await save(true); }
    if (!readonly && Date.now() - lastThumb > 5000) makeThumb();
    navigate('/plans');
  }
  on(window, 'beforeunload', (e) => { if (dirty && !readonly) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Start ---------- */
  new ResizeObserver(() => render()).observe($('#stage', E));
  renderDtb();
  try { if (!readonly && localStorage.getItem('pp.dtb') === '1') toggleDtb(true); } catch { /* egal */ }
  changed(false);
  if (readonly) setSaveState(''); else setSaveState('Gespeichert', 'ok');
  requestAnimationFrame(() => fit());
  if (!readonly && !meta.thumb && (S.items.length || S.floors.length)) setTimeout(() => { lastThumb = Date.now(); makeThumb(); }, 1500);
  if (!readonly && !S.items.length && !S.floors.length) setTimeout(() => toast('Leerer Plan: Zieh Geräte von links auf die Fläche oder lade im Plan-Tab einen Grundriss.', 6000), 400);

  return {
    canLeave: () => !dirty || conflict,
    async flush() { if (dirty && !conflict) { scheduleSave.cancel(); await save(true); } },
    destroy() {
      destroyed = true; listeners.forEach(f => f()); es && es.close(); clearTimeout(retryT); scheduleSave.cancel();
      if (dirty && !conflict && !readonly) { try { fetch(`/api/plans/${planId}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-pp': '1', 'x-client-id': clientId }, body: JSON.stringify({ version, data: S }), keepalive: JSON.stringify(S).length < 60000, credentials: 'same-origin' }); } catch { /* egal */ } }
    },
  };
}
