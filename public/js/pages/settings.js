// Eigene Einstellungen
import { api } from '../api.js';
import { $, esc, toast, armButton } from '../ui.js';
import { TYPES, DEFAULT_COLORS } from '../consts.js';
import { app, navigate, applyUserPrefs } from '../main.js';

export async function page(main) {
  const me = app.me, s = me.settings || {};
  const colors = { ...DEFAULT_COLORS, ...(s.cableColors || {}) };
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Einstellungen</h1><p>Dein Konto und wie PatchPlaner für dich aussieht und rechnet.</p></div></div>
    <div class="settings-grid">
      <form class="card-panel" id="fProfile"><h2>Profil</h2>
        <label class="fld"><span>Name</span><input class="inp" name="name" value="${esc(me.name)}" required maxlength="80"></label>
        <label class="fld"><span>E-Mail</span><input class="inp" name="email" type="email" value="${esc(me.email)}" required></label>
        <button class="btn pri" type="submit">Profil speichern</button></form>
      <form class="card-panel" id="fPw"><h2>Passwort</h2>
        <label class="fld"><span>Aktuelles Passwort</span><input class="inp" name="current" type="password" autocomplete="current-password" required></label>
        <label class="fld"><span>Neues Passwort <em>(mindestens 8 Zeichen)</em></span><input class="inp" name="next" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="hint">Andere Geräte werden danach abgemeldet.</p>
        <button class="btn pri" type="submit">Passwort ändern</button></form>
      <div class="card-panel"><h2>Darstellung</h2>
        <div class="fld"><span>Design</span><div class="seg" data-set="theme">${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, n]) => `<button data-v="${k}" class="${(s.theme || 'system') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="fld"><span>Einheiten</span><div class="seg" data-set="units">${[['m', 'Meter'], ['ft', 'Fuß']].map(([k, n]) => `<button data-v="${k}" class="${(s.units || 'm') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="fld"><span>Ausrichtung neuer Pläne</span><div class="seg" data-set="orient">${[['tb', 'Oben → Unten'], ['ltr', 'Links → Rechts']].map(([k, n]) => `<button data-v="${k}" class="${(s.orient || 'tb') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      </div>
      <div class="card-panel"><h2>Kabelberechnung (Standard)</h2>
        <p class="hint">Gilt für neue Pläne. Jeder Plan kann eigene Werte im Plan-Tab haben.</p>
        <div class="row2"><label class="fld"><span>Zuschlag je Ende (m)</span><input class="inp" id="dSlack" inputmode="decimal" value="${s.endSlack ?? 1}"></label><label class="fld"><span>Reserve (%)</span><input class="inp" id="dRes" inputmode="decimal" value="${s.reserve ?? 10}"></label></div>
        <label class="chk"><input type="checkbox" id="dRound"${s.roundUp !== false ? ' checked' : ''}> Auf Standardlängen aufrunden</label>
        <button class="btn pri" id="saveCalc">Speichern</button>
      </div>
    </div>
    <div class="card-panel"><h2>Kabelfarben</h2><p class="hint">Deine Farben für jeden Kabeltyp – im Plan, in der Legende und im Export.</p>
      <div class="colors">${Object.entries(TYPES).map(([k, t]) => `<label><input type="color" data-col="${k}" value="${colors[k]}"> ${esc(t.name)}</label>`).join('')}</div>
      <div class="btnrow"><button class="btn pri" id="saveCol">Farben speichern</button><button class="btn" id="resetCol">Standardfarben</button></div></div>
    <div class="card-panel"><h2>Konto löschen</h2><p class="hint">Löscht dein Konto mit allen eigenen Plänen, Projekten und Geräten. Team-Pläne, die dir gehören, werden ebenfalls gelöscht.</p>
      <form class="inline" id="fDel"><input class="inp" name="password" type="password" placeholder="Passwort zur Bestätigung" required style="max-width:280px"><button class="btn bad" type="submit">Konto löschen</button></form></div>
  </div>`;
  const saveSettings = async (patch, msg = 'Gespeichert.') => {
    try { const r = await api.put('/api/me', { settings: patch }); app.me = r.user; applyUserPrefs(); toast(msg); } catch (e) { toast(e.message, 4000, 'bad'); }
  };
  $('#fProfile', main).onsubmit = async (e) => { e.preventDefault(); try { const r = await api.put('/api/me', Object.fromEntries(new FormData(e.target))); app.me = r.user; toast('Profil gespeichert.'); } catch (er) { toast(er.message, 4000, 'bad'); } };
  $('#fPw', main).onsubmit = async (e) => { e.preventDefault(); try { await api.put('/api/me/password', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Passwort geändert.'); } catch (er) { toast(er.message, 4000, 'bad'); } };
  main.querySelectorAll('[data-set]').forEach(seg => seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    seg.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
    saveSettings({ [seg.dataset.set]: b.dataset.v });
  }));
  const n = (v) => parseFloat(String(v).replace(',', '.')) || 0;
  $('#saveCalc', main).onclick = () => saveSettings({ endSlack: Math.max(0, n($('#dSlack', main).value)), reserve: Math.max(0, n($('#dRes', main).value)), roundUp: $('#dRound', main).checked });
  $('#saveCol', main).onclick = () => { const map = {}; main.querySelectorAll('[data-col]').forEach(i => { if (i.value.toLowerCase() !== DEFAULT_COLORS[i.dataset.col].toLowerCase()) map[i.dataset.col] = i.value; }); saveSettings({ cableColors: map }, 'Kabelfarben gespeichert.'); };
  $('#resetCol', main).onclick = () => { main.querySelectorAll('[data-col]').forEach(i => { i.value = DEFAULT_COLORS[i.dataset.col]; }); saveSettings({ cableColors: {} }, 'Standardfarben wiederhergestellt.'); };
  $('#fDel', main).onsubmit = async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button');
    if (!armButton(btn, 'Endgültig löschen?')) return;
    try { await api.del('/api/me', { password: e.target.password.value }); app.me = null; toast('Dein Konto wurde gelöscht.'); navigate('/login'); } catch (er) { toast(er.message, 4000, 'bad'); }
  };
}
