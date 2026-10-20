// Planübersicht mit Datumsfilter, Projekten, Teams und Vorlagen
import { api } from '../api.js';
import { $, esc, toast, modal, armButton, relTime, fmtDate } from '../ui.js';
import { app, navigate, refreshProjects } from '../main.js';

const FILTERS = [['upcoming', 'Bevorstehend'], ['past', 'Vergangen'], ['all', 'Alle'], ['archived', 'Archiv'], ['templates', 'Vorlagen']];

export async function page(main, q) {
  await refreshProjects();
  let filter = q.get('filter') || (localStorage.getItem('pp.planFilter') || 'all');
  let search = '', project = q.get('project') || '', teamF = q.get('team') || '', sort = localStorage.getItem('pp.planSort') || 'updated';
  const proj = app.projects.find(p => p.id === project);
  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>${proj ? esc(proj.name) : 'Pläne'}</h1><p>${proj ? 'Pläne in diesem Projekt' : 'Deine Pläne und die deiner Teams.'}</p></div>
      <div class="btnrow"><button class="btn" id="imp">Plan importieren</button><button class="btn pri lg" id="new">+ Neuer Plan</button></div>
    </div>
    <div class="toolbar">
      <div class="seg" role="tablist">${FILTERS.map(([k, n]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <input class="inp search" id="q" placeholder="Name, Job-ID oder Ort suchen …" aria-label="Pläne suchen">
      <select class="inp" id="proj" aria-label="Projekt"><option value="">Alle Projekte</option>${app.projects.map(p => `<option value="${p.id}"${p.id === project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      ${app.teams.length ? `<select class="inp" id="team" aria-label="Team"><option value="">Alle</option>${app.teams.map(t => `<option value="${t.id}"${t.id === teamF ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
      <select class="inp" id="sort" aria-label="Sortierung"><option value="updated">Zuletzt geändert</option><option value="date">Nach Datum</option><option value="name">Nach Name</option></select>
    </div>
    <div id="list"><div class="ed-loading"><div class="spinner"></div></div></div>
    <input type="file" id="fImp" accept=".json,application/json" hidden>
  </div>`;
  $('#sort', main).value = sort;
  const load = async () => {
    const list = $('#list', main);
    try {
      const params = new URLSearchParams();
      if (filter === 'templates') params.set('templates', '1'); else params.set('filter', filter);
      if (search) params.set('q', search); if (project) params.set('project', project); if (teamF) params.set('team', teamF); params.set('sort', sort);
      const rows = await api.get('/api/plans?' + params);
      renderList(list, rows);
    } catch (e) { list.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
  };
  function renderList(list, rows) {
    if (!rows.length) {
      const msg = filter === 'templates' ? ['Keine Vorlagen', 'Markiere einen Plan im Plan-Tab als Vorlage, um ihn hier wiederzuverwenden.']
        : filter === 'upcoming' ? ['Nichts geplant', 'Pläne mit einem Datum in der Zukunft (oder ohne Datum) erscheinen hier.']
        : filter === 'archived' ? ['Archiv ist leer', 'Archivierte Pläne zählen nicht als aktiv und lassen sich jederzeit wiederherstellen.']
        : search ? ['Nichts gefunden', 'Versuch einen anderen Suchbegriff.'] : ['Noch keine Pläne', 'Leg deinen ersten Plan an – leer oder aus einer Vorlage mit Grundriss.'];
      list.innerHTML = `<div class="empty"><h2>${msg[0]}</h2><p>${msg[1]}</p>${filter !== 'templates' ? '<button class="btn pri" data-new>+ Neuer Plan</button>' : ''}</div>`;
      list.querySelector('[data-new]')?.addEventListener('click', () => newPlan());
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    list.innerHTML = `<div class="grid-cards">${rows.map(p => `
      <article class="pcard" data-id="${p.id}">
        <div class="thumb" data-open>${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : '<span class="ph">Kein Vorschaubild</span>'}</div>
        <div class="badges">${p.builtin ? '<span class="chip acc">Beispiel</span>' : ''}${p.is_template && !p.builtin ? '<span class="chip acc">Vorlage</span>' : ''}${p.team_name ? `<span class="chip">${esc(p.team_name)}</span>` : ''}${p.share_enabled ? '<span class="chip" title="Freigabe-Link aktiv">Geteilt</span>' : ''}</div>
        <button class="menu-btn" data-menu aria-label="Aktionen für ${esc(p.name)}">⋯</button>
        <div class="body">
          <div class="title" data-open>${esc(p.name)}</div>
          <div class="meta">${p.job_id ? `<span class="mono">${esc(p.job_id)}</span>` : ''}${p.venue ? `<span>${esc(p.venue)}</span>` : ''}${p.project_name ? `<span><span class="dot" style="background:${esc(p.project_color || '#8893a0')}"></span> ${esc(p.project_name)}</span>` : ''}</div>
          ${p.rig_date || p.event_date ? `<div class="dates">${p.rig_date ? `<span class="${p.rig_date >= today && p.rig_date <= soon ? 'soon' : ''}">Aufbau ${fmtDate(p.rig_date)}</span>` : ''}${p.event_date ? `<span class="${p.event_date >= today && p.event_date <= soon ? 'soon' : ''}">Event ${fmtDate(p.event_date)}</span>` : ''}</div>` : ''}
          <div class="foot"><span>${p.stats.items} Geräte · ${p.stats.cables} Kabel${p.stats.floors ? ` · ${p.stats.floors} Grundriss${p.stats.floors > 1 ? 'e' : ''}` : ''}</span><span>${p.builtin ? '' : relTime(p.updated)}${p.updated_by_name && p.team_name ? ' · ' + esc(p.updated_by_name) : ''}</span></div>
        </div>
      </article>`).join('')}</div>`;
    list.onclick = (e) => {
      const card = e.target.closest('.pcard'); if (!card) return;
      const p = rows.find(r => r.id === card.dataset.id);
      if (e.target.closest('[data-menu]')) { openMenu(e.target.closest('[data-menu]'), p); return; }
      if (e.target.closest('[data-open]')) { if (p.is_template && filter === 'templates') newPlan(p.id); else navigate('/plans/' + p.id); }
    };
  }
  function openMenu(btn, p) {
    document.querySelectorAll('.menu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'menu';
    const own = p.access === 'owner';
    const canEdit = p.access !== 'view';
    m.innerHTML = `
      ${p.is_template ? '<button data-a="fromtpl">Plan aus Vorlage erstellen</button>' : ''}
      <button data-a="open">${canEdit ? 'Öffnen' : 'Ansehen'}</button>
      <button data-a="dup">Duplizieren</button>
      ${canEdit ? `<button data-a="tpl">${p.is_template ? 'Nicht mehr als Vorlage' : 'Als Vorlage markieren'}</button>` : ''}
      ${canEdit && !p.is_template ? `<button data-a="arch">${p.archived ? 'Wiederherstellen' : 'Archivieren'}</button>` : ''}
      ${canEdit ? '<button data-a="move">Projekt und Team …</button>' : ''}
      ${own || (p.team_id && app.teams.find(t => t.id === p.team_id)?.role === 'admin') ? '<hr><button class="bad" data-a="del">Löschen</button>' : ''}`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(); const mr = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.right - mr.width, innerWidth - mr.width - 8)) + 'px';
    m.style.top = (r.bottom + mr.height + 8 > innerHeight ? r.top - mr.height - 4 : r.bottom + 4) + 'px';
    const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
    m.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      try {
        if (a === 'open') navigate('/plans/' + p.id);
        if (a === 'fromtpl') { m.remove(); newPlan(p.id); return; }
        if (a === 'dup') { const r2 = await api.post(`/api/plans/${p.id}/duplicate`, {}); toast('Kopie erstellt.'); navigate('/plans/' + r2.id); }
        if (a === 'tpl') { await api.put(`/api/plans/${p.id}`, { is_template: !p.is_template }); toast(p.is_template ? 'Ist keine Vorlage mehr.' : 'Als Vorlage markiert.'); load(); }
        if (a === 'arch') { await api.put(`/api/plans/${p.id}`, { archived: !p.archived }); toast(p.archived ? 'Wiederhergestellt.' : 'Archiviert.'); load(); }
        if (a === 'move') { m.remove(); movePlan(p); return; }
        if (a === 'del') { if (!armButton(e.target, 'Endgültig löschen?')) return; await api.del(`/api/plans/${p.id}`); toast('Plan gelöscht.'); load(); }
        m.remove();
      } catch (er) { toast(er.message, 4000, 'bad'); }
    };
  }
  function movePlan(p) {
    const canTeam = p.access === 'owner' || app.teams.find(t => t.id === p.team_id)?.role === 'admin';
    const md = modal(`<header><h2>Projekt und Team</h2><button class="btn sm" data-x>Schließen</button></header>
      <div class="mb">
        <label class="fld"><span>Projekt</span><select class="inp" id="mvP"><option value="">Kein Projekt</option>${app.projects.map(x => `<option value="${x.id}"${x.id === p.project_id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        ${canTeam && app.teams.length ? `<label class="fld"><span>Team</span><select class="inp" id="mvT"><option value="">Nur ich</option>${app.teams.map(t => `<option value="${t.id}"${t.id === p.team_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label><p class="hint">Alle Team-Mitglieder können Team-Pläne öffnen und bearbeiten.</p>` : ''}
      </div>
      <footer><button class="btn" data-x>Abbrechen</button><button class="btn pri" id="mvGo">Speichern</button></footer>`);
    md.el.querySelector('#mvGo').onclick = async () => {
      const body = { project_id: md.el.querySelector('#mvP').value || null };
      const t = md.el.querySelector('#mvT'); if (t) body.team_id = t.value || null;
      try { await api.put(`/api/plans/${p.id}`, body); md.close(); toast('Gespeichert.'); load(); } catch (e) { toast(e.message, 4000, 'bad'); }
    };
  }
  async function newPlan(templateId) {
    let templates = [];
    try { templates = await api.get('/api/plans?templates=1'); } catch { /* egal */ }
    const md = modal(`<header><h2>Neuer Plan</h2><button class="btn sm" data-x>Schließen</button></header>
      <form class="mb" id="npForm">
        <label class="fld"><span>Name</span><input class="inp" name="name" required autofocus placeholder="z. B. Sommerfest Hauptbühne" maxlength="160"></label>
        <div class="row2"><label class="fld"><span>Job-ID</span><input class="inp" name="job_id" maxlength="60"></label><label class="fld"><span>Ort</span><input class="inp" name="venue" maxlength="160"></label></div>
        <div class="row2"><label class="fld"><span>Aufbau</span><input class="inp" type="date" name="rig_date"></label><label class="fld"><span>Veranstaltung</span><input class="inp" type="date" name="event_date"></label></div>
        <div class="row2"><label class="fld"><span>Projekt</span><select class="inp" name="project_id"><option value="">Kein Projekt</option>${app.projects.map(x => `<option value="${x.id}"${x.id === project ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        ${app.teams.length ? `<label class="fld"><span>Team</span><select class="inp" name="team_id"><option value="">Nur ich</option>${app.teams.map(t => `<option value="${t.id}"${t.id === teamF ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : '<span></span>'}</div>
        <label class="fld"><span>Start</span><select class="inp" name="template_id"><option value="">Leerer Plan</option>${templates.map(t => `<option value="${t.id}"${t.id === templateId ? ' selected' : ''}>Vorlage: ${esc(t.name)}${t.builtin ? ' (Beispiel)' : ''}</option>`).join('')}</select></label>
        <div class="errbox" hidden></div>
      </form>
      <footer><button class="btn" data-x>Abbrechen</button><button class="btn pri" id="npGo">Plan anlegen</button></footer>`);
    const f = md.el.querySelector('#npForm');
    if (templateId) { const t = templates.find(x => x.id === templateId); if (t) f.name.value = t.builtin ? t.name : ''; }
    const go = async (e) => {
      e && e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.name.trim()) { f.name.focus(); return; }
      try { const r = await api.post('/api/plans', d); md.close(); navigate('/plans/' + r.id); }
      catch (er) { const b = md.el.querySelector('.errbox'); b.textContent = er.message; b.hidden = false; }
    };
    f.addEventListener('submit', go); md.el.querySelector('#npGo').onclick = go;
  }
  // Ereignisse
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; try { localStorage.setItem('pp.planFilter', filter); } catch { /* egal */ } main.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); load(); });
  let t; $('#q', main).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim(); load(); }, 250); };
  $('#proj', main).onchange = (e) => { project = e.target.value; navigate('/plans' + (project ? '?project=' + project : ''), { replace: true }); };
  const ts = $('#team', main); if (ts) ts.onchange = (e) => { teamF = e.target.value; load(); };
  $('#sort', main).onchange = (e) => { sort = e.target.value; try { localStorage.setItem('pp.planSort', sort); } catch { /* egal */ } load(); };
  $('#new', main).onclick = () => newPlan();
  $('#imp', main).onclick = () => $('#fImp', main).click();
  $('#fImp', main).onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const o = JSON.parse(await file.text());
      const data = o.data || o.project || o;
      if (!Array.isArray(data.items)) throw new Error('Die Datei ist kein PatchPlaner-Plan.');
      // Altes Einzeldatei-Format (v2) umwandeln
      if (data.plan && !data.floors) delete data.plan;
      const r = await api.post('/api/plans', { name: o.name || data.name || file.name.replace(/\.(patchplaner\.)?json$/i, ''), ...(o.meta || {}), project_id: project || null, data });
      toast('Plan importiert. Grundrisse lädst du im Plan-Tab neu hoch.', 5000); navigate('/plans/' + r.id);
    } catch (er) { toast(er.message || 'Import fehlgeschlagen.', 5000, 'bad'); }
  };
  if (q.get('new') === '1') newPlan();
  await load();
}
