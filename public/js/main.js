// App-Shell und Router
import { api, setUnauthorizedHandler } from './api.js';
import { $, esc, toast, initials, avatarColor } from './ui.js';
import { applyCableColors, units } from './consts.js';
import { openEditor } from './editor.js';
import * as auth from './pages/auth.js';
import * as plans from './pages/plans.js';
import * as projects from './pages/projects.js';
import * as gear from './pages/gear.js';
import * as team from './pages/team.js';
import * as settings from './pages/settings.js';
import * as admin from './pages/admin.js';

export const app = { config: null, me: null, teams: [], projects: [] };
const root = $('#app');
let current = null; // { destroy, canLeave, flush }

export function applyUserPrefs() {
  const s = (app.me && app.me.settings) || {};
  const theme = s.theme || 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pp.theme', theme); } catch { /* egal */ }
  units.mode = s.units === 'ft' ? 'ft' : 'm';
  applyCableColors(s.cableColors || {});
}
export async function refreshMe() {
  try { const r = await api.get('/api/auth/me', { noAuthRedirect: true }); app.me = r.user || null; app.teams = r.teams || []; }
  catch { app.me = null; app.teams = []; }
  applyUserPrefs();
}
export async function refreshProjects() { try { app.projects = await api.get('/api/projects'); } catch { app.projects = []; } }

const ICONS = {
  plans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4v4H7zM13 13h4v4M11 11h2v2"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="1.6"/><circle cx="13" cy="12" r="1.6"/><path d="M17 10v4"/></svg>',
  community: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M15 15c2.6-.4 4.8.8 6 3.6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
};

function shell(active) {
  const me = app.me;
  const items = [['plans', '/plans', 'Pläne'], ['projects', '/projects', 'Projekte'], ['gear', '/gear', 'Meine Geräte'], ['community', '/community', 'Community'], ['team', '/team', 'Team'], ['settings', '/settings', 'Einstellungen']];
  if (me.is_admin) items.push(['admin', '/admin', 'Admin']);
  root.innerHTML = `<div class="shell">
    <div class="mobile-bar"><a class="brand-mini" href="/plans" style="color:#fff">Patch<i>Planer</i></a><button id="navToggle" aria-label="Menü">Menü</button></div>
    <nav class="nav" id="nav">
      <a class="brand" href="/plans"><b>Patch<i>Planer</i></b><span class="tape" aria-hidden="true"></span></a>
      ${items.map(([k, href, label]) => `<a class="ni${active === k ? ' on' : ''}" href="${href}">${ICONS[k]}<span>${label}</span></a>`).join('')}
      <div class="grow"></div>
      <div class="me"><span class="av" style="background:${avatarColor(me.name)}">${esc(initials(me.name))}</span><span class="who">${esc(me.name)}<small>${esc(me.email)}</small></span><button id="logout" title="Abmelden">Abmelden</button></div>
    </nav>
    <main class="main-area" id="main"></main>
  </div>`;
  $('#logout').onclick = async () => { await api.post('/api/auth/logout').catch(() => {}); app.me = null; navigate('/login'); };
  $('#navToggle').onclick = () => $('#nav').classList.toggle('open');
  return $('#main');
}

const ROUTES = [
  { re: /^\/login$/, guest: true, run: (m, q) => auth.login(root, q) },
  { re: /^\/signup$/, guest: true, run: (m, q) => auth.signup(root, q) },
  { re: /^\/forgot$/, guest: true, run: () => auth.forgot(root) },
  { re: /^\/reset\/([\w-]+)$/, public: true, run: (m) => auth.reset(root, m[1]) },
  { re: /^\/invite\/([\w-]+)$/, public: true, run: (m) => auth.invite(root, m[1]) },
  { re: /^\/share\/([\w-]+)$/, public: true, run: async (m) => openEditor(root, { shareToken: m[1], me: app.me, config: app.config, navigate }) },
  { re: /^\/plans\/([\w-]+)$/, run: async (m) => { await refreshProjects(); return openEditor(root, { planId: m[1], me: app.me, teams: app.teams, projects: app.projects, config: app.config, navigate }); } },
  { re: /^\/(plans)?$/, nav: 'plans', run: (m, q, main) => plans.page(main, q) },
  { re: /^\/projects$/, nav: 'projects', run: (m, q, main) => projects.page(main) },
  { re: /^\/gear$/, nav: 'gear', run: (m, q, main) => gear.list(main) },
  { re: /^\/gear\/new$/, nav: 'gear', run: (m, q, main) => gear.builder(main, null, q) },
  { re: /^\/gear\/([\w-]+)$/, nav: 'gear', run: (m, q, main) => gear.builder(main, m[1], q) },
  { re: /^\/community$/, nav: 'community', run: (m, q, main) => gear.community(main) },
  { re: /^\/team$/, nav: 'team', run: (m, q, main) => team.page(main) },
  { re: /^\/settings$/, nav: 'settings', run: (m, q, main) => settings.page(main) },
  { re: /^\/admin$/, nav: 'admin', run: (m, q, main) => admin.page(main) },
];

let routing = Promise.resolve();
export function navigate(to, { replace = false } = {}) {
  routing = routing.then(async () => {
    if (current && current.flush) { try { await current.flush(); } catch { /* egal */ } }
    if (replace) history.replaceState({}, '', to); else if (location.pathname + location.search !== to) history.pushState({}, '', to);
    await route();
  });
  return routing;
}
async function route() {
  if (current && current.destroy) { try { current.destroy(); } catch { /* egal */ } }
  current = null;
  document.querySelectorAll('.menu,.ov').forEach(el => el.remove());
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(location.search);
  const r = ROUTES.find(x => x.re.test(path));
  if (!r) { history.replaceState({}, '', '/plans'); return route(); }
  const m = path.match(r.re);
  if (!r.public) {
    if (r.guest && app.me) { history.replaceState({}, '', q.get('next') || '/plans'); return route(); }
    if (!r.guest && !app.me) { history.replaceState({}, '', '/login' + (path !== '/' && path !== '/plans' ? '?next=' + encodeURIComponent(path + location.search) : '')); return route(); }
  }
  const main = r.nav ? shell(r.nav) : null;
  document.title = 'PatchPlaner';
  try { current = (await r.run(m, q, main)) || null; }
  catch (e) { console.error(e); (main || root).innerHTML = `<div class="page"><div class="errbox">${esc(e.message || 'Fehler beim Laden.')}</div></div>`; }
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('/api/')) return;
  e.preventDefault(); navigate(href);
});
window.addEventListener('popstate', () => { routing = routing.then(async () => { if (current && current.flush) await current.flush().catch(() => {}); await route(); }); });
setUnauthorizedHandler(() => { if (app.me) { app.me = null; toast('Deine Sitzung ist abgelaufen. Bitte melde dich neu an.', 4000); } navigate('/login?next=' + encodeURIComponent(location.pathname)); });

(async function boot() {
  try { app.config = await api.get('/api/config'); } catch { app.config = { registration: true }; }
  await refreshMe();
  if (app.config.firstRun && !app.me && !location.pathname.startsWith('/share/')) history.replaceState({}, '', '/signup');
  await route();
})();
