// Meine Geräte, Geräte-Builder, Community-Bibliothek
import { api } from '../api.js';
import { $, esc, toast, armButton, shrinkImage } from '../ui.js';
import { CATS, CATCOL } from '../consts.js';
import { itemPreviewSVG } from '../itemsvg.js';
import { mountPortEditor, portSummary } from '../builder.js';
import { app, navigate } from '../main.js';

function gearCard(g, actions) {
  return `<article class="gcard" data-id="${esc(g.id)}">
    <div class="gprev">${itemPreviewSVG(g, 'ltr', 240)}</div>
    <div class="gbody">
      <div class="inline">${g.image ? `<img class="gimg" src="${esc(g.image)}" alt="">` : ''}<div style="min-width:0"><div class="gname">${esc(g.name)}</div>${g.manufacturer || g.model ? `<div class="small muted">${esc([g.manufacturer, g.model].filter(Boolean).join(' · '))}</div>` : ''}</div></div>
      <div class="gmeta"><span><span class="dot" style="background:${CATCOL[g.category] || CATCOL.Eigene}"></span> ${esc(g.category)}</span><span>${esc(portSummary(g.ports))}</span>${actions.meta || ''}</div>
      <div class="btnrow">${actions.buttons}</div>
    </div></article>`;
}

export async function list(main) {
  let all = [], cat = '', q = '';
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Meine Geräte</h1><p>Deine eigenen Geräte und die deiner Teams. Im Plan ziehst du sie einfach aus der Bibliothek auf die Fläche.</p></div>
      <div class="btnrow"><a class="btn" href="/community">Aus der Community übernehmen</a><a class="btn pri lg" href="/gear/new">+ Gerät bauen</a></div></div>
    <div class="toolbar"><input class="inp search" id="q" placeholder="Geräte suchen …" aria-label="Geräte suchen"><div class="catchips" id="cats"></div></div>
    <div id="list"><div class="ed-loading"><div class="spinner"></div></div></div></div>`;
  const render = () => {
    const items = all.filter(g => (!cat || g.category === cat) && (!q || (g.name + ' ' + (g.manufacturer || '') + ' ' + (g.model || '')).toLowerCase().includes(q)));
    const cats = [...new Set(all.map(g => g.category))].sort();
    $('#cats', main).innerHTML = cats.length > 1 ? `<button data-cat="" class="${!cat ? 'on' : ''}">Alle</button>` + cats.map(c => `<button data-cat="${esc(c)}" class="${cat === c ? 'on' : ''}">${esc(c)}</button>`).join('') : '';
    const L = $('#list', main);
    if (!all.length) { L.innerHTML = '<div class="empty"><h2>Noch keine eigenen Geräte</h2><p>Übernimm fertige Geräte aus der Community oder bau dein eigenes mit Eingängen, Ausgängen und I/O-Ports.</p><div class="btnrow"><a class="btn" href="/community">Community öffnen</a><a class="btn pri" href="/gear/new">+ Gerät bauen</a></div></div>'; return; }
    L.innerHTML = items.length ? `<div class="grid-cards">${items.map(g => gearCard(g, {
      meta: `${g.team_name ? `<span class="chip">${esc(g.team_name)}</span>` : ''}${g.is_public ? '<span class="chip ok">Veröffentlicht</span>' : ''}${g.gear_id ? `<span class="mono">${esc(g.gear_id)}</span>` : ''}`,
      buttons: `<a class="btn sm" href="/gear/${g.id}">Bearbeiten</a><button class="btn sm" data-dup>Duplizieren</button>${g.access === 'owner' ? `<button class="btn sm" data-pub>${g.is_public ? 'Nicht mehr teilen' : 'In Community teilen'}</button>` : ''}<button class="btn sm bad" data-del>Löschen</button>`,
    })).join('')}</div>` : '<p class="hint">Nichts gefunden.</p>';
  };
  const load = async () => { try { all = await api.get('/api/gear'); } catch (e) { $('#list', main).innerHTML = `<div class="errbox">${esc(e.message)}</div>`; return; } render(); };
  main.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; render(); return; }
    const card = e.target.closest('[data-id]'); if (!card) return; const g = all.find(x => x.id === card.dataset.id);
    try {
      if (e.target.closest('[data-del]')) { if (!armButton(e.target.closest('[data-del]'), 'Wirklich löschen?')) return; await api.del(`/api/gear/${g.id}`); toast('Gerät gelöscht. Pläne behalten ihre Kopie.'); load(); }
      if (e.target.closest('[data-dup]')) { const { id, access, builtin, author, uses, created, updated, team_name, ...rest } = g; void id; void access; void builtin; void author; void uses; void created; void updated; void team_name; await api.post('/api/gear', { ...rest, name: g.name + ' (Kopie)' }); toast('Kopie erstellt.'); load(); }
      if (e.target.closest('[data-pub]')) { await api.post(`/api/gear/${g.id}/publish`, { public: !g.is_public }); toast(g.is_public ? 'Nicht mehr in der Community.' : 'In der Community veröffentlicht. Danke!'); load(); }
    } catch (er) { toast(er.message, 4000, 'bad'); }
  });
  let t; $('#q', main).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); render(); }, 150); };
  await load();
}

export async function builder(main, id, query) {
  let g = { name: '', manufacturer: '', model: '', category: 'Eigene', color: CATCOL.Eigene, ports: [{ name: 'SDI In', dir: 'in', type: 'sdi' }, { name: 'Strom', dir: 'in', type: 'power' }, { name: 'SDI Out', dir: 'out', type: 'sdi' }, { name: 'LAN', dir: 'io', type: 'eth' }], elements: [], image: null, gear_id: '', notes: '', team_id: null, is_public: false };
  if (id) { try { g = await api.get(`/api/gear/${id}`); } catch (e) { main.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`; return; } }
  const readonly = id && g.access === 'view';
  const back = query.get('back');
  const ports = g.ports.map(p => ({ ...p }));
  let orient = 'ltr';
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>${id ? 'Gerät bearbeiten' : 'Gerät bauen'}</h1><p>Bau dein Gerät so, wie es echt aussieht: Eingänge, Ausgänge und kombinierte I/O-Ports.</p></div>
      <div class="btnrow"><a class="btn" href="${esc(back || '/gear')}">${back ? 'Zurück zum Plan' : 'Abbrechen'}</a>${readonly ? '' : '<button class="btn pri lg" id="save">Speichern</button>'}</div></div>
    <div class="builder">
      <div class="card-panel">
        <div class="form-grid">
          <label class="fld"><span>Gerätename</span><input class="inp" id="bName" value="${esc(g.name)}" placeholder="z. B. Studiokamera 4K" maxlength="120" autofocus></label>
          <label class="fld"><span>Hersteller</span><input class="inp" id="bMan" value="${esc(g.manufacturer || '')}" maxlength="80"></label>
          <label class="fld"><span>Modell</span><input class="inp" id="bModel" value="${esc(g.model || '')}" maxlength="80"></label>
          <label class="fld"><span>Kategorie</span><select class="inp" id="bCat">${CATS.map(c => `<option${c === g.category ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="fld"><span>Geräte-ID / Inventar</span><input class="inp" id="bGid" value="${esc(g.gear_id || '')}" placeholder="optional, z. B. CAM-03" maxlength="60"></label>
          <label class="fld"><span>Farbe</span><span class="inline"><input type="color" id="bColor" value="${esc(g.color || '#4a5560')}"><button type="button" class="btn sm" id="bCatColor">Farbe der Kategorie</button></span></label>
        </div>
        ${app.teams.length ? `<label class="fld"><span>Gehört zu</span><select class="inp" id="bTeam"><option value="">Nur mir</option>${app.teams.map(t => `<option value="${t.id}"${t.id === g.team_id ? ' selected' : ''}>Team ${esc(t.name)}</option>`).join('')}</select></label>` : ''}
        <label class="fld"><span>Beschreibungszeilen <em>(erscheinen klein auf dem Gerät, eine pro Zeile)</em></span><textarea class="inp" id="bEls" rows="2" placeholder="z. B. 12G-SDI, Tally">${esc((g.elements || []).join('\n'))}</textarea></label>
        <div class="fld"><span>Bild <em>(optional, für Bibliothek und Community)</em></span><span class="inline"><span id="bImgPrev">${g.image ? `<img class="gimg" src="${esc(g.image)}" alt="">` : ''}</span><input type="file" id="bImg" accept="image/*"><button type="button" class="btn sm" id="bImgRm" ${g.image ? '' : 'hidden'}>Entfernen</button></span></div>
        <label class="fld"><span>Notizen</span><textarea class="inp" id="bNotes" rows="2">${esc(g.notes || '')}</textarea></label>
        <h3 class="h3">Ports</h3>
        <div id="bPorts"></div>
        ${id && g.access === 'owner' ? `<label class="chk"><input type="checkbox" id="bPub"${g.is_public ? ' checked' : ''}> In der Community veröffentlichen</label>` : ''}
      </div>
      <div class="card-panel preview-panel">
        <h2>Vorschau</h2>
        <div class="seg"><button data-o="ltr" class="on">Links → Rechts</button><button data-o="tb">Oben → Unten</button></div>
        <div id="prev"></div>
        <p class="hint small" id="sum"></p>
      </div>
    </div></div>`;
  const val = (s) => $(s, main)?.value;
  const cur = () => ({ id: id || 'new', name: val('#bName') || 'Gerät', color: val('#bColor'), elements: val('#bEls').split('\n').map(s => s.trim()).filter(Boolean), ports, gear_id: val('#bGid') });
  const prev = () => { $('#prev', main).innerHTML = itemPreviewSVG(cur(), orient, 380); $('#sum', main).textContent = portSummary(ports); };
  mountPortEditor($('#bPorts', main), ports, prev);
  prev();
  main.addEventListener('input', (e) => { if (['bName', 'bColor', 'bEls', 'bGid'].includes(e.target.id)) prev(); });
  main.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { orient = b.dataset.o; main.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x === b)); prev(); });
  $('#bCatColor', main).onclick = () => { $('#bColor', main).value = CATCOL[val('#bCat')] || CATCOL.Eigene; prev(); };
  $('#bImg', main).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { g.image = await shrinkImage(f, 320); $('#bImgPrev', main).innerHTML = `<img class="gimg" src="${g.image}" alt="">`; $('#bImgRm', main).hidden = false; } catch { toast('Das Bild konnte nicht gelesen werden.'); }
  };
  $('#bImgRm', main).onclick = () => { g.image = null; $('#bImgPrev', main).innerHTML = ''; $('#bImgRm', main).hidden = true; $('#bImg', main).value = ''; };
  const sv = $('#save', main);
  if (sv) sv.onclick = async () => {
    const body = { name: val('#bName').trim(), manufacturer: val('#bMan'), model: val('#bModel'), category: val('#bCat'), color: val('#bColor'), gear_id: val('#bGid'), notes: val('#bNotes'),
      elements: cur().elements, image: g.image, ports: ports.map(p => ({ name: p.name, dir: p.dir, type: p.type })), team_id: $('#bTeam', main)?.value || null };
    if (!body.name) { toast('Gib dem Gerät einen Namen.'); $('#bName', main).focus(); return; }
    sv.disabled = true;
    try {
      const r = id ? await api.put(`/api/gear/${id}`, body) : await api.post('/api/gear', body);
      const pub = $('#bPub', main); if (pub && pub.checked !== g.is_public) await api.post(`/api/gear/${r.id}/publish`, { public: pub.checked });
      toast('Gerät gespeichert.'); navigate(back || '/gear');
    } catch (e) { toast(e.message, 4000, 'bad'); sv.disabled = false; }
  };
}

export async function community(main) {
  let q = '', cat = '', source = '', sort = 'popular';
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Community</h1><p>Fertige Geräte von PatchPlaner und anderen Nutzern dieses Servers. Übernimm sie in deine Geräte und pass sie an.</p></div><a class="btn pri lg" href="/gear/new">+ Gerät bauen</a></div>
    <div class="toolbar">
      <input class="inp search" id="q" placeholder="Gerät, Hersteller oder Modell …" aria-label="Community durchsuchen">
      <select class="inp" id="src" aria-label="Quelle"><option value="">Alle Quellen</option><option value="builtin">PatchPlaner-Standard</option><option value="users">Von Nutzern</option></select>
      <select class="inp" id="sort" aria-label="Sortierung"><option value="popular">Beliebt</option><option value="new">Neu</option><option value="name">Name</option></select>
    </div>
    <div class="catchips" id="cats"></div>
    <div id="list"><div class="ed-loading"><div class="spinner"></div></div></div></div>`;
  let data = { items: [], categories: [], total: 0 };
  const load = async () => {
    try { data = await api.get(`/api/community?limit=200&q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}&source=${source}&sort=${sort}`); }
    catch (e) { $('#list', main).innerHTML = `<div class="errbox">${esc(e.message)}</div>`; return; }
    $('#cats', main).innerHTML = `<button data-cat="" class="${!cat ? 'on' : ''}">Alle</button>` + data.categories.map(c => `<button data-cat="${esc(c.category)}" class="${cat === c.category ? 'on' : ''}">${esc(c.category)} <span class="muted">${c.n}</span></button>`).join('');
    $('#list', main).innerHTML = data.items.length ? `<p class="hint">${data.total} Geräte</p><div class="grid-cards">${data.items.map(g => gearCard(g, {
      meta: `<span>von ${esc(g.author)}</span><span>${g.uses}× genutzt</span>`,
      buttons: '<button class="btn sm pri" data-copy>Zu meinen Geräten</button>',
    })).join('')}</div>` : '<div class="empty"><h2>Nichts gefunden</h2><p>Bau das Gerät selbst und teile es danach mit der Community.</p><a class="btn pri" href="/gear/new">+ Gerät bauen</a></div>';
  };
  main.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; load(); return; }
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id; b.disabled = true;
    try { const g = await api.post(`/api/community/${id}/copy`); b.textContent = 'Übernommen ✓'; toast(`„${g.name}“ ist jetzt in deinen Geräten.`); } catch (er) { toast(er.message, 4000, 'bad'); b.disabled = false; }
  });
  let t; $('#q', main).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); };
  $('#src', main).onchange = (e) => { source = e.target.value; load(); };
  $('#sort', main).onchange = (e) => { sort = e.target.value; load(); };
  await load();
}
