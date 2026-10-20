// Anmelden, Registrieren, Passwort, Einladung
import { api } from '../api.js';
import { esc, toast } from '../ui.js';
import { app, navigate, refreshMe } from '../main.js';

const card = (inner) => `<div class="auth"><div class="auth-card"><a class="brand" href="/"><b>Patch<i>Planer</i></b></a>${inner}</div></div>`;
function bindForm(root, fn) {
  const f = root.querySelector('form'), err = root.querySelector('.errbox'), btn = f.querySelector('button[type=submit]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(f))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
}

export function login(root, q) {
  root.innerHTML = card(`
    <h1>Anmelden</h1>
    <form novalidate>
      <label class="fld"><span>E-Mail</span><input class="inp" name="email" id="lEmail" type="email" autocomplete="email" required autofocus></label>
      <label class="fld"><span>Passwort</span><input class="inp" name="password" id="lPw" type="password" autocomplete="current-password" required></label>
      <div class="errbox" hidden></div>
      <button class="btn pri lg" type="submit">Anmelden</button>
    </form>
    <div class="links"><a href="/forgot">Passwort vergessen?</a>${app.config.registration ? `<a href="/signup${q.get('next') ? '?next=' + encodeURIComponent(q.get('next')) : ''}">Konto erstellen</a>` : ''}</div>`);
  setTimeout(() => root.querySelector('#lEmail')?.focus(), 20);
  bindForm(root, async (d) => { await api.post('/api/auth/login', d, { noAuthRedirect: true }); await refreshMe(); navigate(q.get('next') || '/plans', { replace: true }); });
}

export function signup(root, q) {
  const first = app.config.firstRun;
  const invite = (String(q.get('next') || '').match(/^\/invite\/([\w-]+)$/) || [])[1];
  if (!app.config.registration && !first && !invite) {
    root.innerHTML = card(`<h1>Registrierung geschlossen</h1><p>Auf diesem Server legt ein Admin neue Konten an oder öffnet die Registrierung. Frag deinen Admin nach einem Zugang.</p><a class="btn" href="/login">Zur Anmeldung</a>`);
    return;
  }
  root.innerHTML = card(`
    <h1>${first ? 'Willkommen' : 'Konto erstellen'}</h1>
    ${first ? '<p>Das ist der erste Start. Das Konto, das du jetzt anlegst, wird Administrator dieses Servers.</p>' : ''}
    <form novalidate>
      <label class="fld"><span>Name</span><input class="inp" name="name" autocomplete="name" required autofocus></label>
      <label class="fld"><span>E-Mail</span><input class="inp" name="email" type="email" autocomplete="email" required></label>
      <label class="fld"><span>Passwort <em>(mindestens 8 Zeichen)</em></span><input class="inp" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="errbox" hidden></div>
      <button class="btn pri lg" type="submit">${first ? 'Admin-Konto anlegen' : 'Konto erstellen'}</button>
    </form>
    ${first ? '' : '<div class="links"><a href="/login">Schon ein Konto? Anmelden</a></div>'}`);
  bindForm(root, async (d) => { await api.post('/api/auth/signup', { ...d, invite }, { noAuthRedirect: true }); app.config.firstRun = false; await refreshMe(); navigate(q.get('next') || '/plans', { replace: true }); });
}

export function forgot(root) {
  root.innerHTML = card(`
    <h1>Passwort vergessen</h1>
    ${app.config.smtp ? '<p>Gib deine E-Mail ein. Du bekommst einen Link, mit dem du ein neues Passwort setzt.</p>' : '<div class="warnbox">Auf diesem Server ist kein E-Mail-Versand eingerichtet. Bitte deinen Admin, dein Passwort zurückzusetzen.</div>'}
    <form novalidate ${app.config.smtp ? '' : 'hidden'}>
      <label class="fld"><span>E-Mail</span><input class="inp" name="email" type="email" required autofocus></label>
      <div class="errbox" hidden></div>
      <button class="btn pri lg" type="submit">Link senden</button>
    </form>
    <div class="links"><a href="/login">Zur Anmeldung</a></div>`);
  bindForm(root, async (d) => {
    await api.post('/api/auth/forgot', d, { noAuthRedirect: true });
    root.querySelector('form').outerHTML = '<div class="box">Wenn es ein Konto mit dieser E-Mail gibt, ist der Link unterwegs. Schau auch im Spam-Ordner nach.</div>';
  });
}

export function reset(root, token) {
  root.innerHTML = card(`
    <h1>Neues Passwort</h1>
    <form novalidate>
      <label class="fld"><span>Neues Passwort <em>(mindestens 8 Zeichen)</em></span><input class="inp" name="password" type="password" autocomplete="new-password" minlength="8" required autofocus></label>
      <div class="errbox" hidden></div>
      <button class="btn pri lg" type="submit">Passwort speichern</button>
    </form>`);
  bindForm(root, async (d) => { await api.post('/api/auth/reset', { token, password: d.password }, { noAuthRedirect: true }); await refreshMe(); toast('Passwort geändert. Du bist angemeldet.'); navigate('/plans', { replace: true }); });
}

export async function invite(root, token) {
  let inv;
  try { inv = await api.get(`/api/invites/${token}`, { noAuthRedirect: true }); }
  catch (e) { root.innerHTML = card(`<h1>Einladung</h1><div class="errbox">${esc(e.message)}</div><a class="btn" href="/">Zu PatchPlaner</a>`); return; }
  const next = encodeURIComponent(location.pathname);
  root.innerHTML = card(`
    <h1>Team-Einladung</h1>
    <p>${esc(inv.invited_by || 'Jemand')} lädt dich in das Team <b>${esc(inv.team_name)}</b> ein. Im Team bearbeitet ihr Pläne und Geräte gemeinsam.</p>
    ${inv.email ? `<p class="hint">Die Einladung gilt für <b>${esc(inv.email)}</b>.</p>` : ''}
    <div class="errbox" hidden></div>
    ${app.me ? `<p class="hint">Angemeldet als ${esc(app.me.email)}.</p><button class="btn pri lg" id="acc">Einladung annehmen</button>`
      : `<div class="btnrow"><a class="btn pri lg" href="/login?next=${next}">Anmelden</a><a class="btn lg" href="/signup?next=${next}">Konto erstellen</a></div>`}`);
  const b = root.querySelector('#acc');
  if (b) b.onclick = async () => {
    b.disabled = true;
    try { await api.post(`/api/invites/${token}/accept`); await refreshMe(); toast(`Willkommen im Team „${inv.team_name}“.`); navigate('/team', { replace: true }); }
    catch (e) { const er = root.querySelector('.errbox'); er.textContent = e.message; er.hidden = false; b.disabled = false; }
  };
}
