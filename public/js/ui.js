// Kleine UI-Helfer
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(1, n - 1)) + '…' : String(s));
export const uid = () => Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function toast(msg, ms = 2800, kind = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

let modalStack = [];
export function modal(html, { wide = false, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); modalStack = modalStack.filter(m => m !== api); onClose && onClose(); };
  const api = { el: ov.querySelector('.modal'), close };
  modalStack.push(api);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
  setTimeout(() => { const f = ov.querySelector('[autofocus]') || ov.querySelector('input,select,textarea'); f && f.focus(); }, 30);
  return api;
}
export const topModal = () => modalStack[modalStack.length - 1];
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalStack.length) { e.stopPropagation(); topModal().close(); } }, true);

// Zweistufige Bestätigung im Button selbst (kein confirm())
export function armButton(btn, label = 'Wirklich?') {
  if (btn.dataset.armed) return true;
  const orig = btn.innerHTML;
  btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.classList.remove('armed'); btn.innerHTML = orig; } }, 3500);
  return false;
}

export function copyText(text, what = 'Text') {
  const fallback = () => {
    const m = modal(`<header><h2>${esc(what)}</h2><button class="btn sm" data-x>Schließen</button></header><div class="mb"><p class="hint">Mit Strg C / ⌘ C kopieren.</p><textarea class="inp mono" rows="8" readonly>${esc(text)}</textarea></div>`);
    const ta = m.el.querySelector('textarea'); ta.focus(); ta.select();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => toast(what + ' kopiert.'), fallback);
  else fallback();
}

export function download(data, name, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function relTime(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 50) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  if (s < 86400 * 7) return `vor ${Math.round(s / 86400)} Tagen`;
  return new Date(ts).toLocaleDateString('de-DE');
}
export const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const initials = (n) => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export function avatarColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 45%)`; }

export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }
export const readFileAsDataURL = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });

// Bild verkleinern (für Gerätebilder)
export async function shrinkImage(file, max = 320) {
  const url = await readFileAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}
