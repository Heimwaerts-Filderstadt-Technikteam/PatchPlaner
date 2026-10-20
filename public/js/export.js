// Export: Bild (PNG/JPG), PDF (eigener Writer), CSV
const dataUrlCache = new Map();
async function toDataURL(url) {
  if (url.startsWith('data:')) return url;
  if (dataUrlCache.has(url)) return dataUrlCache.get(url);
  const r = await fetch(url, { credentials: 'same-origin' });
  const b = await r.blob();
  const d = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  dataUrlCache.set(url, d);
  return d;
}

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight',
  'letter-spacing', 'text-transform', 'filter', 'display', 'paint-order', 'text-anchor', 'dominant-baseline'];

// svg: das Live-SVG; world: Selektor der Weltgruppe; bounds: Weltkoordinaten
export async function renderPlanCanvas(svg, bounds, { scale = 2, bg = '#ffffff', floors = true, maxDim = 9000 } = {}) {
  const pad = 30;
  let k = scale;
  const Wd = (bounds.w + pad * 2), Hd = (bounds.h + pad * 2);
  if (Math.max(Wd, Hd) * k > maxDim) k = maxDim / Math.max(Wd, Hd);
  const W = Math.max(1, Math.round(Wd * k)), H = Math.max(1, Math.round(Hd * k));
  const clone = svg.cloneNode(true);
  const src = [...svg.querySelectorAll('#world *')], dst = [...clone.querySelectorAll('#world *')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el); let st = '';
    for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) st += `${p}:${v};`; }
    // vector-effect: non-scaling-stroke wird beim Export in echte Breiten umgerechnet
    if (cs.getPropertyValue('vector-effect') === 'non-scaling-stroke') {
      const sw = parseFloat(cs.getPropertyValue('stroke-width')) || 1;
      const ctm = el.getCTM && el.getCTM(); const sc = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
      const worldCtm = svg.querySelector('#world').getCTM(); const wz = worldCtm ? Math.hypot(worldCtm.a, worldCtm.b) : 1;
      st += `stroke-width:${(sw / (sc / wz)) * 1}px;vector-effect:none;`;
    }
    dst[i].setAttribute('style', st);
  });
  clone.querySelector('#lOver')?.replaceChildren();
  clone.querySelectorAll('.gridrect').forEach(g => g.remove());
  clone.querySelectorAll('.hit').forEach(g => g.remove());
  if (!floors) clone.querySelectorAll('.floorimg').forEach(g => g.remove());
  for (const im of clone.querySelectorAll('image')) {
    const href = im.getAttribute('href'); if (!href) continue;
    try { im.setAttribute('href', await toDataURL(href)); } catch { im.remove(); }
  }
  clone.querySelector('#world').setAttribute('transform', `scale(${k}) translate(${-bounds.x + pad} ${-bounds.y + pad})`);
  clone.setAttribute('width', W); clone.setAttribute('height', H); clone.setAttribute('viewBox', `0 0 ${W} ${H}`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  const fontCss = '<style>text{font-family:"Barlow Condensed","IBM Plex Sans",Arial,sans-serif}</style>';
  clone.insertAdjacentHTML('afterbegin', fontCss + (bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''));
  const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Rendern fehlgeschlagen')); img.src = data; });
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  if (bg) { c.fillStyle = bg; c.fillRect(0, 0, W, H); }
  c.drawImage(img, 0, 0);
  return cv;
}
export const canvasBlob = (cv, mime, q = 0.92) => new Promise((res) => cv.toBlob(res, mime, q));

/* ---------- PDF ---------- */
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
const REPL = { '→': '->', '←': '<-', '⇄': '<->', '↔': '<->', '✓': 'x', '✕': 'x', '⚠': '!', '✎': '*', '≥': '>=', '≤': '<=' };
function pdfStr(s) {
  let out = '';
  for (const ch of String(s)) {
    const r = REPL[ch]; if (r) { out += pdfStr(r).slice(1, -1); continue; }
    let code = ch.codePointAt(0);
    if (WIN[ch]) code = WIN[ch]; else if (code > 255) code = 63;
    const c = String.fromCharCode(code);
    out += c === '(' || c === ')' || c === '\\' ? '\\' + c : c;
  }
  return '(' + out + ')';
}
const textW = (s, size, bold) => String(s).length * size * (bold ? 0.56 : 0.52);
const fitText = (s, maxW, size, bold) => { s = String(s ?? ''); if (textW(s, size, bold) <= maxW) return s; let n = Math.floor(maxW / (size * (bold ? 0.56 : 0.52))) - 1; return n > 0 ? s.slice(0, n) + '…' : ''; };

const PAGE = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A2: [1190.55, 1683.78], Letter: [612, 792] };

// pages: [{kind:'image', jpeg:Uint8Array, w, h}, {kind:'table', title, columns:[{label,w,align}], rows:[[...]], groups?}]
export function buildPdf({ title, subtitle, format = 'A4', landscape = true, pages }) {
  let [PW, PH] = PAGE[format] || PAGE.A4; if (landscape) [PW, PH] = [PH, PW];
  const M = 36;
  const objs = []; // [content string or Uint8Array parts]
  const add = (parts) => { objs.push(parts); return objs.length; };
  const fontR = add(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
  const fontB = add(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
  const pageIds = [];
  const pagesId = objs.length + 1; objs.push(null); // Platzhalter
  const date = new Date().toLocaleDateString('de-DE');
  const header = (ops, pageTitle) => {
    ops.push(`BT /F2 15 Tf ${M} ${PH - M - 12} Td ${pdfStr(fitText(title, PW - 2 * M - 160, 15, true))} Tj ET`);
    if (subtitle) ops.push(`BT /F1 9 Tf 0.35 0.39 0.43 rg ${M} ${PH - M - 26} Td ${pdfStr(fitText(subtitle, PW - 2 * M, 9))} Tj ET 0 0 0 rg`);
    if (pageTitle) ops.push(`BT /F2 11 Tf ${PW - M - textW(pageTitle, 11, true)} ${PH - M - 12} Td ${pdfStr(pageTitle)} Tj ET`);
    ops.push(`0.8 0.82 0.85 RG 0.6 w ${M} ${PH - M - 34} m ${PW - M} ${PH - M - 34} l S 0 0 0 RG`);
  };
  const footerOps = (ops, n) => ops.push(`BT /F1 8 Tf 0.45 0.48 0.52 rg ${M} ${M - 14} Td ${pdfStr(`PatchPlaner · ${date}`)} Tj ET BT /F1 8 Tf ${PW - M - 40} ${M - 14} Td ${pdfStr('Seite ' + n)} Tj ET 0 0 0 rg`);
  const finishPage = (ops, xobjs = {}) => {
    const content = latin1(ops.join('\n'));
    const cid = add([`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    const xo = Object.entries(xobjs).map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
    const pid = add([`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> >>`]);
    pageIds.push(pid);
  };
  let n = 0;
  for (const pg of pages) {
    if (pg.kind === 'image') {
      n++;
      const img = add([`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`, pg.jpeg, '\nendstream']);
      const ops = []; header(ops, pg.title || 'Plan');
      const top = PH - M - 44, availW = PW - 2 * M, availH = top - M;
      const k = Math.min(availW / pg.w, availH / pg.h);
      const w = pg.w * k, h = pg.h * k, x = M + (availW - w) / 2, y = M + (availH - h) / 2;
      ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`);
      footerOps(ops, n); finishPage(ops, { Im1: img });
    } else if (pg.kind === 'table') {
      const totalW = pg.columns.reduce((a, c) => a + c.w, 0);
      const scale = (PW - 2 * M) / totalW;
      const cols = pg.columns.map(c => ({ ...c, w: c.w * scale }));
      const fs = 8.5, lh = 13;
      let ops = null, y = 0;
      const newPage = () => {
        if (ops) { footerOps(ops, n); finishPage(ops); }
        n++; ops = []; header(ops, pg.title); y = PH - M - 52;
        let x = M;
        ops.push('0.35 0.39 0.43 rg');
        for (const c of cols) { const t = fitText(c.label.toUpperCase(), c.w - 6, 7.5, true); const tx = c.align === 'right' ? x + c.w - 4 - textW(t, 7.5, true) : x + 2; ops.push(`BT /F2 7.5 Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td ${pdfStr(t)} Tj ET`); x += c.w; }
        ops.push('0 0 0 rg'); y -= 6;
        ops.push(`0.6 0.63 0.67 RG 0.8 w ${M} ${y.toFixed(1)} m ${PW - M} ${y.toFixed(1)} l S`); y -= lh - 2;
      };
      newPage();
      for (const row of pg.rows) {
        if (row.group) {
          if (y < M + lh * 3) newPage();
          y -= 4; ops.push(`BT /F2 10 Tf ${M} ${y.toFixed(1)} Td ${pdfStr(row.group)} Tj ET`); y -= lh; continue;
        }
        if (y < M + lh) newPage();
        let x = M;
        row.cells.forEach((v, i) => {
          const c = cols[i]; const bold = c.bold || (row.bold && i === 0);
          const t = fitText(v, c.w - 6, fs, bold);
          const tx = c.align === 'right' ? x + c.w - 4 - textW(t, fs, bold) : x + 2;
          if (t) ops.push(`BT /${bold ? 'F2' : 'F1'} ${fs} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td ${pdfStr(t)} Tj ET`);
          x += c.w;
        });
        ops.push(`0.88 0.9 0.92 RG 0.4 w ${M} ${(y - 4).toFixed(1)} m ${PW - M} ${(y - 4).toFixed(1)} l S`);
        y -= lh;
      }
      if (pg.footer) { if (y < M + lh * 2) newPage(); y -= 4; ops.push(`BT /F2 9.5 Tf ${M} ${y.toFixed(1)} Td ${pdfStr(pg.footer)} Tj ET`); }
      footerOps(ops, n); finishPage(ops);
    }
  }
  objs[pagesId - 1] = [`<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`];
  const catalog = add([`<< /Type /Catalog /Pages ${pagesId} 0 R >>`]);
  const info = add([`<< /Title ${pdfStr(title)} /Producer (PatchPlaner) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`]);
  // Serialisieren
  const chunks = []; let offset = 0; const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? latin1(x) : x; chunks.push(b); offset += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  objs.forEach((parts, i) => { offsets[i] = offset; push(`${i + 1} 0 obj\n`); for (const p of parts) push(p); push('\nendobj\n'); });
  const xref = offset;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(String(o).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
function latin1(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }

/* ---------- CSV ---------- */
export function toCSV(rows) {
  const cell = (v) => { v = String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

/* ---------- PDF-Import im Browser (Fallback ohne poppler) ---------- */
export async function pdfToPngBrowser(file) {
  if (!window.pdfjsLib) {
    const tryLoad = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    try { await tryLoad('/vendor/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; }
    catch { await tryLoad('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; }
  }
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(6, 4000 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: c, viewport: vp }).promise;
  return { blob: await canvasBlob(cv, 'image/png'), ptPerPx: 1 / scale };
}
