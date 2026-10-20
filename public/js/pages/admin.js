// Server-Administration
import { api } from '../api.js';
import { $, esc, toast, armButton, copyText, relTime } from '../ui.js';
import { app } from '../main.js';

export async function page(main) {
  const load = async () => {
    let s, users;
    try { [s, users] = await Promise.all([api.get('/api/admin/settings'), api.get('/api/admin/users')]); }
    catch (e) { main.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`; return; }
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>Admin</h1><p>PatchPlaner ${esc(s.version)} · Node ${esc(s.node)} · Daten in <span class="mono">${esc(s.dataDir)}</span></p></div></div>
      <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">${[['users', 'Benutzer'], ['plans', 'Pläne'], ['gear', 'Geräte'], ['teams', 'Teams']].map(([k, n]) => `<div class="stat"><b>${s.stats[k]}</b><span>${n}</span></div>`).join('')}</div>
      <div class="settings-grid">
        <div class="card-panel"><h2>Registrierung</h2>
          <label class="chk big"><input type="checkbox" id="reg"${s.registration ? ' checked' : ''}> Jeder kann sich ein Konto erstellen</label>
          <p class="hint">Ist sie aus, kommen neue Leute nur noch über eine Team-Einladung an ein Konto.</p></div>
        <div class="card-panel"><h2>E-Mail</h2>
          ${s.smtp ? `<p>Versand aktiv als <span class="mono">${esc(s.smtpFrom)}</span>.</p><button class="btn" id="test">Test-E-Mail an mich</button>` : '<p class="hint">Nicht eingerichtet. Setze SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS und SMTP_FROM in der .env-Datei und starte den Dienst neu. Ohne E-Mail funktionieren Einladungslinks trotzdem; Passwörter setzt du dann hier zurück.</p>'}</div>
        <div class="card-panel"><h2>PDF-Grundrisse</h2>
          <p class="hint">${s.pdfServer ? 'Der Server wandelt PDF-Grundrisse selbst um (poppler-utils ist installiert).' : 'poppler-utils fehlt. PDFs werden im Browser mit pdf.js umgewandelt. Für die Umwandlung auf dem Server: <span class="mono">sudo apt install poppler-utils</span>.'}</p></div>
      </div>
      <div class="card-panel"><h2>Benutzer</h2>
        <div class="tscroll"><table class="tbl"><thead><tr><th>Name</th><th>E-Mail</th><th class="num">Pläne</th><th class="num">Geräte</th><th>Zuletzt angemeldet</th><th>Admin</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr data-uid="${u.id}"><td>${esc(u.name)}${u.id === app.me.id ? ' <span class="muted">(du)</span>' : ''}</td><td>${esc(u.email)}</td><td class="num">${u.plans}</td><td class="num">${u.gear}</td><td class="small muted">${u.last_login ? relTime(u.last_login) : 'nie'}</td>
          <td><input type="checkbox" data-admin${u.is_admin ? ' checked' : ''} aria-label="Admin"></td>
          <td><div class="btnrow"><button class="btn sm" data-pw>Passwort zurücksetzen</button>${u.id !== app.me.id ? '<button class="btn sm bad" data-del>Löschen</button>' : ''}</div></td></tr>`).join('')}
        </tbody></table></div><div id="pwout"></div></div>
    </div>`;
    $('#reg', main).onchange = async (e) => { try { await api.put('/api/admin/settings', { registration: e.target.checked }); app.config.registration = e.target.checked; toast(e.target.checked ? 'Registrierung offen.' : 'Registrierung geschlossen.'); } catch (er) { toast(er.message); } };
    const t = $('#test', main); if (t) t.onclick = async () => { t.disabled = true; try { const r = await api.post('/api/admin/test-mail'); toast('Test-E-Mail an ' + r.to + ' verschickt.'); } catch (er) { toast(er.message, 6000, 'bad'); } t.disabled = false; };
    main.querySelector('tbody').addEventListener('change', async (e) => {
      if (!e.target.matches('[data-admin]')) return;
      try { await api.put(`/api/admin/users/${e.target.closest('[data-uid]').dataset.uid}`, { is_admin: e.target.checked }); toast('Gespeichert.'); } catch (er) { toast(er.message, 4000, 'bad'); load(); }
    });
    main.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return; const uid = b.closest('[data-uid]').dataset.uid; const u = users.find(x => x.id === uid);
      try {
        if (b.matches('[data-pw]')) {
          if (!armButton(b, 'Neues Passwort erzeugen?')) return;
          const r = await api.put(`/api/admin/users/${uid}`, { reset_password: true });
          $('#pwout', main).innerHTML = `<div class="box">Neues Passwort für <b>${esc(u.email)}</b>: <div class="inline"><input class="inp mono" readonly value="${esc(r.temp_password)}"><button class="btn pri" type="button" id="cpw">Kopieren</button></div><span class="small muted">Gib es der Person weiter. Sie sollte es danach in den Einstellungen ändern.</span></div>`;
          $('#cpw', main).onclick = () => copyText(r.temp_password, 'Passwort');
        }
        if (b.matches('[data-del]')) { if (!armButton(b, 'Mit allen Plänen löschen?')) return; await api.del(`/api/admin/users/${uid}`); toast('Benutzer gelöscht.'); load(); }
      } catch (er) { toast(er.message, 4000, 'bad'); }
    });
  };
  await load();
}
