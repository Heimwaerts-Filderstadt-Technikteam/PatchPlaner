// Projekte: Pläne bündeln
import { api } from '../api.js';
import { $, esc, toast, modal, armButton, relTime } from '../ui.js';
import { app, navigate, refreshProjects } from '../main.js';

const PCOL = ['#3577d4', '#3b9a56', '#e07a2a', '#8457c9', '#cf5596', '#d4ab17', '#17695a', '#7c8690'];

export async function page(main) {
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Projekte</h1><p>Projekte bündeln zusammengehörige Pläne, z. B. alle Räume einer Veranstaltung oder eine Tour.</p></div><button class="btn pri lg" id="new">+ Neues Projekt</button></div>
    <div id="list"></div></div>`;
  const load = async () => {
    await refreshProjects();
    const list = $('#list', main);
    if (!app.projects.length) { list.innerHTML = '<div class="empty"><h2>Noch keine Projekte</h2><p>Lege ein Projekt an und ordne ihm in der Planübersicht Pläne zu.</p><button class="btn pri" data-new>+ Neues Projekt</button></div>'; list.querySelector('[data-new]').onclick = () => edit(); return; }
    list.innerHTML = `<div class="list">${app.projects.map(p => `<div class="lrow" data-id="${p.id}">
      <div><div class="t"><span class="dot" style="background:${esc(p.color || '#8893a0')}"></span> <a href="/plans?project=${p.id}">${esc(p.name)}</a> ${p.team_name ? `<span class="chip">${esc(p.team_name)}</span>` : ''}</div>
      <div class="s">${p.plan_count} aktive${p.plan_count === 1 ? 'r Plan' : ' Pläne'} · geändert ${relTime(p.updated)}${p.notes ? ' · ' + esc(p.notes.slice(0, 80)) : ''}</div></div>
      <div class="btnrow"><a class="btn sm" href="/plans?project=${p.id}">Pläne</a><button class="btn sm" data-edit>Bearbeiten</button>${p.owner || app.teams.find(t => t.id === p.team_id)?.role === 'admin' ? '<button class="btn sm bad" data-del>Löschen</button>' : ''}</div></div>`).join('')}</div>`;
  };
  function edit(p) {
    const md = modal(`<header><h2>${p ? 'Projekt bearbeiten' : 'Neues Projekt'}</h2><button class="btn sm" data-x>Schließen</button></header>
      <form class="mb" id="pf">
        <label class="fld"><span>Name</span><input class="inp" name="name" value="${esc(p?.name || '')}" required autofocus maxlength="120"></label>
        <div class="fld"><span>Farbe</span><div class="swatches">${PCOL.map(c => `<button type="button" data-c="${c}" class="${(p?.color || PCOL[0]) === c ? 'on' : ''}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join('')}</div></div>
        ${app.teams.length ? `<label class="fld"><span>Team</span><select class="inp" name="team_id"><option value="">Nur ich</option>${app.teams.map(t => `<option value="${t.id}"${t.id === p?.team_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
        <label class="fld"><span>Notizen</span><textarea class="inp" name="notes" rows="3">${esc(p?.notes || '')}</textarea></label>
      </form>
      <footer><button class="btn" data-x>Abbrechen</button><button class="btn pri" id="go">Speichern</button></footer>`);
    let color = p?.color || PCOL[0];
    md.el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { color = b.dataset.c; md.el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
    const go = async (e) => {
      e && e.preventDefault();
      const d = Object.fromEntries(new FormData(md.el.querySelector('#pf'))); d.color = color;
      if (!d.name.trim()) return;
      try { if (p) await api.put(`/api/projects/${p.id}`, d); else await api.post('/api/projects', d); md.close(); toast('Gespeichert.'); load(); } catch (er) { toast(er.message, 4000, 'bad'); }
    };
    md.el.querySelector('#pf').onsubmit = go; md.el.querySelector('#go').onclick = go;
  }
  main.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]'); const p = row && app.projects.find(x => x.id === row.dataset.id);
    if (e.target.closest('[data-edit]')) edit(p);
    if (e.target.closest('[data-del]')) { if (!armButton(e.target.closest('[data-del]'), 'Löschen? Pläne bleiben erhalten')) return; try { await api.del(`/api/projects/${p.id}`); toast('Projekt gelöscht.'); load(); } catch (er) { toast(er.message); } }
  });
  $('#new', main).onclick = () => edit();
  void navigate;
  await load();
}
