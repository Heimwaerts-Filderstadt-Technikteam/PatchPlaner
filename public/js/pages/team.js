// Teams: Mitglieder, Rollen, Einladungen
import { api } from '../api.js';
import { $, esc, toast, armButton, copyText, relTime, initials, avatarColor } from '../ui.js';
import { app, refreshMe } from '../main.js';

export async function page(main) {
  const load = async () => {
    let teams = [];
    try { teams = await api.get('/api/teams'); } catch (e) { main.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`; return; }
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>Team</h1><p>Im Team seht und bearbeitet ihr gemeinsame Pläne, Projekte und Geräte. Änderungen erscheinen bei allen live.</p></div></div>
      ${teams.map(teamPanel).join('')}
      <div class="card-panel"><h2>${teams.length ? 'Weiteres Team anlegen' : 'Team anlegen'}</h2>
        <form class="inline" id="newTeam"><input class="inp" name="name" placeholder="z. B. Technik-Crew" maxlength="80" required><button class="btn pri" type="submit">Team anlegen</button></form>
        ${teams.length ? '' : '<p class="hint">Du wirst Admin des Teams und kannst danach Leute per Link oder E-Mail einladen.</p>'}
      </div></div>`;
    $('#newTeam', main).onsubmit = async (e) => {
      e.preventDefault(); const name = e.target.name.value.trim(); if (!name) return;
      try { await api.post('/api/teams', { name }); await refreshMe(); toast('Team angelegt.'); load(); } catch (er) { toast(er.message, 4000, 'bad'); }
    };
    main.querySelectorAll('[data-team]').forEach(el => bindTeam(el, teams.find(t => t.id === el.dataset.team), load));
  };
  await load();
}

function teamPanel(t) {
  const admin = t.role === 'admin';
  return `<section class="card-panel" data-team="${t.id}">
    <div class="page-head" style="align-items:center"><div style="min-width:0">
      ${admin ? `<input class="inp ed-name" data-rename value="${esc(t.name)}" aria-label="Teamname" style="font:700 22px var(--f-display);text-transform:uppercase;letter-spacing:.04em;max-width:none">` : `<h2 style="margin:0;font:700 22px var(--f-display);text-transform:uppercase">${esc(t.name)}</h2>`}
      <p class="hint">${t.members.length} Mitglied${t.members.length === 1 ? '' : 'er'} · <a href="/plans?team=${t.id}">${t.plan_count} Team-Pl${t.plan_count === 1 ? 'an' : 'äne'}</a> · deine Rolle: ${admin ? 'Admin' : 'Mitglied'}</p></div>
      <div class="btnrow">${admin ? '<button class="btn bad" data-delteam>Team löschen</button>' : '<button class="btn" data-leave>Team verlassen</button>'}</div></div>
    <div class="tscroll"><table class="tbl"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Dabei seit</th><th></th></tr></thead><tbody>
      ${t.members.map(m => `<tr data-uid="${m.id}"><td><span class="inline"><span class="av" style="background:${avatarColor(m.name)};width:26px;height:26px;font-size:11px">${esc(initials(m.name))}</span>${esc(m.name)}${m.id === app.me.id ? ' <span class="muted">(du)</span>' : ''}</span></td><td>${esc(m.email)}</td>
        <td>${admin ? `<select class="inp sm" data-role style="width:auto"><option value="member"${m.role === 'member' ? ' selected' : ''}>Mitglied</option><option value="admin"${m.role === 'admin' ? ' selected' : ''}>Admin</option></select>` : (m.role === 'admin' ? 'Admin' : 'Mitglied')}</td>
        <td class="small muted">${relTime(m.created)}</td><td>${admin && m.id !== app.me.id ? '<button class="btn sm bad" data-rm>Entfernen</button>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${admin ? `<div class="sec"><h3>Einladen</h3>
      <form class="inline" data-invite><input class="inp" name="email" type="email" placeholder="E-Mail (optional)" aria-label="E-Mail der eingeladenen Person"><button class="btn pri" type="submit">Einladungslink erstellen</button></form>
      <p class="hint">${app.config.smtp ? 'Mit E-Mail wird die Einladung verschickt und gilt nur für diese Adresse. Ohne E-Mail bekommst du einen Link, den mehrere Leute nutzen können.' : 'Auf diesem Server ist kein E-Mail-Versand eingerichtet. Kopiere den Link und schick ihn selbst. Mit E-Mail gilt er nur für diese Adresse.'}</p>
      <div data-newlink></div>
      ${t.invites.length ? `<div class="list">${t.invites.map(i => `<div class="lrow" data-tok="${esc(i.token)}"><div><div class="t">${i.email ? esc(i.email) : 'Offener Link'}</div><div class="s">erstellt ${relTime(i.created)} · gültig bis ${new Date(i.expires).toLocaleDateString('de-DE')}</div></div><div class="btnrow"><button class="btn sm" data-copyinv>Link kopieren</button><button class="btn sm bad" data-revoke>Zurückziehen</button></div></div>`).join('')}</div>` : ''}
    </div>` : ''}
  </section>`;
}

function bindTeam(el, t, reload) {
  const inviteUrl = (tok) => `${location.origin}/invite/${tok}`;
  el.addEventListener('change', async (e) => {
    try {
      if (e.target.matches('[data-rename]')) { const n = e.target.value.trim(); if (n) { await api.put(`/api/teams/${t.id}`, { name: n }); await refreshMe(); toast('Team umbenannt.'); } }
      if (e.target.matches('[data-role]')) { const uid = e.target.closest('[data-uid]').dataset.uid; await api.put(`/api/teams/${t.id}/members/${uid}`, { role: e.target.value }); toast('Rolle geändert.'); reload(); }
    } catch (er) { toast(er.message, 4000, 'bad'); reload(); }
  });
  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-invite]')) return; e.preventDefault();
    try {
      const r = await api.post(`/api/teams/${t.id}/invites`, { email: e.target.email.value.trim() || null });
      el.querySelector('[data-newlink]').innerHTML = `<div class="box"><div class="inline"><input class="inp mono" readonly value="${esc(r.link)}"><button class="btn pri" type="button" data-copylink>Kopieren</button></div><span class="small ${r.mailed ? '' : 'muted'}">${r.mailed ? 'Die Einladung wurde per E-Mail verschickt.' : 'Schick diesen Link an die Person. Er ist 14 Tage gültig.'}</span></div>`;
      el.querySelector('[data-copylink]').onclick = () => copyText(r.link, 'Einladungslink');
      e.target.reset();
    } catch (er) { toast(er.message, 4000, 'bad'); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.matches('[data-rm]')) { if (!armButton(b, 'Wirklich entfernen?')) return; await api.del(`/api/teams/${t.id}/members/${b.closest('[data-uid]').dataset.uid}`); toast('Mitglied entfernt.'); reload(); }
      if (b.matches('[data-leave]')) { if (!armButton(b, 'Wirklich verlassen?')) return; await api.del(`/api/teams/${t.id}/members/${app.me.id}`); await refreshMe(); toast('Du hast das Team verlassen.'); reload(); }
      if (b.matches('[data-delteam]')) { if (!armButton(b, 'Team endgültig löschen?')) return; await api.del(`/api/teams/${t.id}`); await refreshMe(); toast('Team gelöscht. Pläne und Geräte gehören wieder ihren Erstellern.', 5000); reload(); }
      if (b.matches('[data-copyinv]')) copyText(inviteUrl(b.closest('[data-tok]').dataset.tok), 'Einladungslink');
      if (b.matches('[data-revoke]')) { await api.del(`/api/teams/${t.id}/invites/${b.closest('[data-tok]').dataset.tok}`); toast('Einladung zurückgezogen.'); reload(); }
    } catch (er) { toast(er.message, 4000, 'bad'); }
  });
}
