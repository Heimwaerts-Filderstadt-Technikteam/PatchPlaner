// Port-Editor (Geräte-Builder) – genutzt auf der Geräteseite und im Plan
import { TYPES, DIRS } from './consts.js';
import { esc, clamp } from './ui.js';

export const typeOptions = (v) => Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
export const dirOptions = (v) => Object.entries(DIRS).map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('');

export function mountPortEditor(el, ports, onChange = () => {}) {
  const render = () => {
    el.innerHTML = `
      <div class="prows">${ports.map((p, i) => `
        <div class="pr" data-i="${i}">
          <span class="ord"><button type="button" class="icon-btn" data-up="${i}" title="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-btn" data-down="${i}" title="Nach unten" ${i === ports.length - 1 ? 'disabled' : ''}>↓</button></span>
          <input class="inp" data-f="name" value="${esc(p.name)}" aria-label="Portname" maxlength="60">
          <select class="inp" data-f="dir" aria-label="Richtung">${dirOptions(p.dir)}</select>
          <select class="inp" data-f="type" aria-label="Anschlusstyp">${typeOptions(p.type)}</select>
          <button type="button" class="icon-btn" data-dup="${i}" title="Port duplizieren">⧉</button>
          <button type="button" class="icon-btn" data-rm="${i}" title="Port entfernen">✕</button>
        </div>`).join('') || '<p class="hint">Noch keine Ports. Füge unten welche hinzu.</p>'}</div>
      <div class="bulk">
        <span class="small">Hinzufügen:</span>
        <input class="inp" data-b="n" type="number" min="1" max="128" value="1" style="width:70px" aria-label="Anzahl">
        <span>×</span>
        <input class="inp" data-b="name" value="Port" style="width:120px" aria-label="Name oder Präfix">
        <select class="inp" data-b="dir">${dirOptions('in')}</select>
        <select class="inp" data-b="type">${typeOptions('sdi')}</select>
        <button type="button" class="btn sm pri" data-add>Hinzufügen</button>
      </div>
      <p class="hint small">Eingänge sitzen oben bzw. links, Ausgänge unten bzw. rechts. I/O-Ports sind Ein- und Ausgang in einem und haben auf beiden Seiten einen Anschluss.</p>`;
  };
  render();
  el.addEventListener('input', (e) => {
    const r = e.target.closest('[data-i]'); if (!r || !e.target.dataset.f) return;
    ports[+r.dataset.i][e.target.dataset.f] = e.target.value; onChange();
  });
  el.addEventListener('change', (e) => {
    const r = e.target.closest('[data-i]'); if (!r || !e.target.dataset.f) return;
    ports[+r.dataset.i][e.target.dataset.f] = e.target.value; onChange();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rm != null) ports.splice(+b.dataset.rm, 1);
    else if (b.dataset.dup != null) { const p = ports[+b.dataset.dup]; ports.splice(+b.dataset.dup + 1, 0, { ...p, id: undefined, name: bump(p.name) }); }
    else if (b.dataset.up != null) { const i = +b.dataset.up; [ports[i - 1], ports[i]] = [ports[i], ports[i - 1]]; }
    else if (b.dataset.down != null) { const i = +b.dataset.down; [ports[i + 1], ports[i]] = [ports[i], ports[i + 1]]; }
    else if (b.dataset.add != null) {
      const q = (k) => el.querySelector(`[data-b="${k}"]`).value;
      const n = clamp(+q('n') || 1, 1, 128), pre = q('name').trim() || 'Port';
      for (let i = 1; i <= n; i++) ports.push({ name: n > 1 ? `${pre} ${i}` : pre, dir: q('dir'), type: q('type') });
    } else return;
    render(); onChange();
  });
  return { render };
}
const bump = (l) => { const m = String(l).match(/^(.*?)(\d+)$/); return m ? m[1] + (+m[2] + 1) : l + ' 2'; };
export function portSummary(ports) {
  const c = { in: 0, out: 0, io: 0 }; (ports || []).forEach(p => c[p.dir]++);
  return [c.in && c.in + ' In', c.out && c.out + ' Out', c.io && c.io + ' I/O'].filter(Boolean).join(' · ') || 'keine Ports';
}
