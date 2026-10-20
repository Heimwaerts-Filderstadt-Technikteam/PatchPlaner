#!/usr/bin/env node
// PatchPlaner – Server ohne externe Abhängigkeiten (Node >= 22.13)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './lib/db.js';
import { seed } from './lib/seed.js';
import { sendMail, smtpConfigured } from './lib/mail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) { console.error(`PatchPlaner braucht Node.js 22.13 oder neuer (installiert: ${process.version}).`); process.exit(1); }
}
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

/* ---------- Konfiguration ---------- */
loadEnvFile(path.join(__dirname, '.env'));
const cfg = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(__dirname, process.env.DATA_DIR || './data'),
  baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''),
  cookieSecure: (process.env.COOKIE_SECURE || 'auto').toLowerCase(),
  appName: process.env.APP_NAME || 'PatchPlaner',
  smtp: {
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE,
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM,
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED,
  },
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 40),
};
function loadEnvFile(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const db = openDb(cfg.dataDir);
seed(db, cfg.dataDir);
const UPLOADS = path.join(cfg.dataDir, 'uploads');
let hasPdftoppm = false;
execFile('pdftoppm', ['-v'], (e) => { hasPdftoppm = !e || e.code !== 'ENOENT'; });

/* ---------- Kommandozeile ---------- */
const [, , cmd, a1, a2] = process.argv;
if (cmd === 'backup') {
  const target = path.resolve(a1 || `patchplaner-backup-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(target)) { console.error('Zieldatei existiert schon: ' + target); process.exit(1); }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log('Datenbank gesichert nach ' + target + '\nVergiss den Ordner ' + UPLOADS + ' (Grundrisse) nicht.');
  process.exit(0);
}
if (cmd === 'reset-password' || cmd === 'make-admin' || cmd === 'list-users') {
  if (cmd === 'list-users') {
    for (const u of db.prepare('SELECT email, name, is_admin FROM users ORDER BY created').all()) console.log(`${u.is_admin ? '[admin] ' : ''}${u.email}  (${u.name})`);
  } else {
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(a1 || '');
    if (!u) { console.error('Kein Benutzer mit dieser E-Mail.'); process.exit(1); }
    if (cmd === 'reset-password') {
      if (!a2 || a2.length < 8) { console.error('Neues Passwort fehlt (mindestens 8 Zeichen).'); process.exit(1); }
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(a2), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      console.log('Passwort geändert.');
    } else { db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id); console.log('Ist jetzt Admin.'); }
  }
  process.exit(0);
}

/* ---------- Helfer ---------- */
const now = () => Date.now();
const uid = (n = 9) => crypto.randomBytes(n).toString('base64url').slice(0, Math.ceil(n * 4 / 3));
const token = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const bad = (msg) => new HttpError(400, msg);
const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const optStr = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const isDate = (v) => v == null || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, N, r, p, salt, hash] = stored.split('$');
    const h = Buffer.from(hash, 'base64');
    const test = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), h.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(h, test);
  } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function clientIp(req) {
  if (cfg.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function isHttps(req) {
  if (req.socket.encrypted) return true;
  return cfg.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function baseUrl(req) {
  if (cfg.baseUrl) return cfg.baseUrl;
  const host = (cfg.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || `localhost:${cfg.port}`;
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}
const getSetting = (k, d) => { const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k); return r ? J(r.value, d) : d; };
const setSetting = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));

/* Rate-Limit */
const buckets = new Map();
function rateLimit(req, key, max, windowMs) {
  const k = key + '|' + clientIp(req), t = now();
  let b = buckets.get(k);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(k, b); }
  if (++b.n > max) throw new HttpError(429, 'Zu viele Versuche. Bitte warte ein paar Minuten.');
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();

/* ---------- Sitzungen ---------- */
const SESSION_DAYS = 30;
function createSession(req, res, userId) {
  const t = token();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires, ua) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(t), userId, now(), now() + SESSION_DAYS * 864e5, str(req.headers['user-agent'], 200));
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), userId);
  setCookie(req, res, t, SESSION_DAYS * 86400);
}
function setCookie(req, res, value, maxAge) {
  const secure = cfg.cookieSecure === 'true' || (cfg.cookieSecure === 'auto' && isHttps(req));
  res.setHeader('Set-Cookie', `pp_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
function currentUser(req) {
  const t = parseCookies(req).pp_session;
  if (!t) return null;
  const h = sha256(t);
  const row = db.prepare(`SELECT u.*, s.expires AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!row) return null;
  if (row.s_expires < now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (row.s_expires - now() < (SESSION_DAYS - 1) * 864e5) db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?').run(now() + SESSION_DAYS * 864e5, h);
  row.session_hash = h;
  return row;
}
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now());
  db.prepare('DELETE FROM password_resets WHERE expires < ?').run(now());
  db.prepare('DELETE FROM team_invites WHERE expires < ?').run(now());
}, 3600e3).unref();

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, is_admin: !!u.is_admin, settings: J(u.settings, {}), created: u.created });

/* ---------- Zugriffsrechte ---------- */
const myTeamIds = (userId) => db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(userId).map(r => r.team_id);
const teamRole = (userId, teamId) => (teamId ? db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId)?.role || null : null);
function planAccess(user, plan) {
  if (!plan) return null;
  if (!user) return null;
  if (plan.owner_id === user.id) return 'owner';
  if (plan.team_id && teamRole(user.id, plan.team_id)) return 'edit';
  if (plan.owner_id === null && plan.is_template) return 'view';
  return null;
}
function loadPlan(id, user, need = 'view') {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  const acc = planAccess(user, plan);
  if (!plan || !acc) throw new HttpError(404, 'Plan nicht gefunden.');
  if (need === 'edit' && acc === 'view') throw new HttpError(403, 'Diesen Plan kannst du nur ansehen.');
  if (need === 'owner' && acc !== 'owner' && !(plan.team_id && teamRole(user.id, plan.team_id) === 'admin')) throw new HttpError(403, 'Das darf nur der Besitzer oder ein Team-Admin.');
  plan._access = acc;
  return plan;
}
function gearAccess(user, g) {
  if (!g) return null;
  if (g.owner_id === user.id) return 'owner';
  if (g.team_id && teamRole(user.id, g.team_id)) return 'edit';
  if (g.is_public) return 'view';
  return null;
}

/* ---------- Body ---------- */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, `Datei zu groß (max. ${Math.round(limit / 1048576)} MB).`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function jsonBody(req, limit = 20 * 1048576) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Ungültiges JSON.'); }
}

/* ---------- Bildgröße ---------- */
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (mime === 'image/webp') {
      const f = buf.toString('ascii', 12, 16);
      if (f === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (f === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
    if (mime === 'image/svg+xml') {
      const s = buf.toString('utf8', 0, Math.min(buf.length, 4000));
      const tag = (s.match(/<svg[^>]*>/i) || [''])[0];
      const num = (a) => { const m = tag.match(new RegExp(`\\s${a}=["']\\s*([\\d.]+)(px)?\\s*["']`)); return m ? parseFloat(m[1]) : null; };
      let w = num('width'), h = num('height');
      const vb = tag.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      if ((!w || !h) && vb) { w = parseFloat(vb[1]); h = parseFloat(vb[2]); }
      if (w && h) return { w, h };
      return { w: 1600, h: 1000 };
    }
  } catch { /* weiter */ }
  return null;
}
function run(cmd, args, timeout = 60000) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 4 * 1048576 }, (e, out) => (e ? reject(e) : resolve(out))));
}
async function pdfToPng(buf) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pp-'));
  try {
    const inp = path.join(dir, 'in.pdf');
    await fsp.writeFile(inp, buf);
    let ptW = null;
    try { const info = await run('pdfinfo', ['-f', '1', '-l', '1', inp]); const m = info.match(/Page\s+1?\s*size:\s*([\d.]+)\s*x\s*([\d.]+)/i) || info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/i); if (m) ptW = parseFloat(m[1]); } catch { /* optional */ }
    await run('pdftoppm', ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', '4000', inp, path.join(dir, 'out')]);
    const png = await fsp.readFile(path.join(dir, 'out.png'));
    const sz = imageSize(png, 'image/png');
    return { png, ...sz, ptPerPx: ptW ? ptW / sz.w : null };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/* ---------- Live-Updates (SSE) ---------- */
const channels = new Map(); // planId -> Set<client>
function broadcast(planId, event, data, exceptClient) {
  const set = channels.get(planId); if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) if (c.clientId !== exceptClient) c.res.write(payload);
}
function presence(planId) {
  const set = channels.get(planId); if (!set) return;
  const list = [...set].map(c => ({ clientId: c.clientId, userId: c.userId, name: c.name, viewer: c.viewer }));
  broadcast(planId, 'presence', list);
}
setInterval(() => { for (const set of channels.values()) for (const c of set) c.res.write(': ping\n\n'); }, 25000).unref();

/* ---------- Plan-Hilfen ---------- */
function planStats(data) {
  const d = typeof data === 'string' ? J(data, {}) : data;
  return { items: (d.items || []).length, cables: (d.cables || []).length, floors: (d.floors || []).length };
}
function planMeta(p, user) {
  const owner = p.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(p.owner_id) : null;
  const team = p.team_id ? db.prepare('SELECT name FROM teams WHERE id = ?').get(p.team_id) : null;
  const by = p.updated_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(p.updated_by) : null;
  const project = p.project_id ? db.prepare('SELECT name, color FROM projects WHERE id = ?').get(p.project_id) : null;
  return {
    id: p.id, name: p.name, job_id: p.job_id, venue: p.venue, rig_date: p.rig_date, event_date: p.event_date,
    archived: !!p.archived, is_template: !!p.is_template, builtin: p.owner_id === null,
    owner_id: p.owner_id, owner_name: owner?.name || 'PatchPlaner', team_id: p.team_id, team_name: team?.name || null,
    project_id: p.project_id, project_name: project?.name || null, project_color: project?.color || null,
    share_enabled: !!p.share_enabled, share_token: user && planAccess(user, p) !== 'view' ? p.share_token : undefined,
    thumb: p.thumb, stats: J(p.stats, null) || planStats(p.data), version: p.version,
    created: p.created, updated: p.updated, updated_by_name: by?.name || null,
    access: user ? planAccess(user, p) : 'view',
  };
}
function packChecks(planId) {
  const out = {};
  for (const r of db.prepare('SELECT c.key, c.at, u.name FROM pack_checks c LEFT JOIN users u ON u.id = c.user_id WHERE plan_id = ?').all(planId)) out[r.key] = { by: r.name, at: r.at };
  return out;
}
function copyPlan(src, user, overrides = {}) {
  const id = uid();
  const data = J(src.data, {});
  const assets = db.prepare('SELECT * FROM plan_assets WHERE plan_id = ?').all(src.id);
  const map = {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : src[k]);
  return tx(db, () => {
    const t = now();
    db.prepare(`INSERT INTO plans (id, owner_id, team_id, project_id, name, job_id, venue, rig_date, event_date, archived, is_template, data, version, thumb, stats, created, updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '{}', 1, ?, ?, ?, ?, ?)`)
      .run(id, user.id, overrides.team_id ?? null, overrides.project_id ?? null, overrides.name ?? src.name, pick('job_id'), pick('venue'), pick('rig_date'), pick('event_date'),
        overrides.is_template ? 1 : 0, src.thumb, src.stats, t, t, user.id);
    for (const a of assets) {
      const nid = uid(); const ext = path.extname(a.file); const file = nid + ext;
      fs.copyFileSync(path.join(UPLOADS, a.file), path.join(UPLOADS, file));
      db.prepare('INSERT INTO plan_assets (id, plan_id, kind, mime, filename, file, w, h, meta, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nid, id, a.kind, a.mime, a.filename, file, a.w, a.h, a.meta, t);
      map[a.id] = nid;
    }
    for (const f of data.floors || []) if (map[f.asset]) f.asset = map[f.asset];
    db.prepare('UPDATE plans SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
    return id;
  });
}
function cleanupAssets() {
  // Nicht mehr referenzierte Grundrisse nach 24 h löschen
  const cutoff = now() - 864e5;
  const rows = db.prepare('SELECT a.id, a.file, a.plan_id, p.data FROM plan_assets a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.created < ?').all(cutoff);
  for (const r of rows) {
    if (r.data && r.data.includes(r.id)) continue;
    db.prepare('DELETE FROM plan_assets WHERE id = ?').run(r.id);
    fs.rm(path.join(UPLOADS, r.file), { force: true }, () => {});
  }
}
setInterval(cleanupAssets, 3600e3).unref();
function deletePlanFiles(planId) {
  for (const a of db.prepare('SELECT file FROM plan_assets WHERE plan_id = ?').all(planId)) fs.rm(path.join(UPLOADS, a.file), { force: true }, () => {});
}

/* ---------- Gerät-Validierung ---------- */
function cleanPorts(ports) {
  if (!Array.isArray(ports)) throw bad('Ports fehlen.');
  if (ports.length > 512) throw bad('Höchstens 512 Ports pro Gerät.');
  return ports.map(p => ({ name: str(p.name, 60) || 'Port', dir: ['in', 'out', 'io'].includes(p.dir) ? p.dir : 'in', type: str(p.type, 24) || 'sdi' }));
}
function cleanImage(img) {
  if (!img) return null;
  if (typeof img !== 'string' || !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(img)) throw bad('Bild muss PNG, JPG, WebP, GIF oder SVG sein.');
  if (img.length > 600000) throw bad('Das Bild ist zu groß (max. ca. 400 KB).');
  return img;
}
function gearOut(g, user) {
  const owner = g.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(g.owner_id) : null;
  const team = g.team_id ? db.prepare('SELECT name FROM teams WHERE id = ?').get(g.team_id) : null;
  return {
    id: g.id, name: g.name, manufacturer: g.manufacturer, model: g.model, category: g.category, color: g.color,
    ports: J(g.ports, []), elements: J(g.elements, []), image: g.image, gear_id: g.gear_id, notes: g.notes,
    is_public: !!g.is_public, builtin: !!g.is_builtin, uses: g.uses, team_id: g.team_id, team_name: team?.name || null,
    author: g.is_builtin ? 'PatchPlaner' : owner?.name || 'Unbekannt', source_id: g.source_id,
    access: user ? gearAccess(user, g) : 'view', created: g.created, updated: g.updated,
  };
}

/* ---------- Router ---------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};
function need(ctx) { if (!ctx.user) throw new HttpError(401, 'Bitte melde dich an.'); return ctx.user; }
function needAdmin(ctx) { const u = need(ctx); if (!u.is_admin) throw new HttpError(403, 'Nur für Admins.'); return u; }

/* Öffentliche Konfiguration */
route('GET', '/api/config', async () => ({
  appName: cfg.appName, version: VERSION, registration: getSetting('registration', true) || userCount() === 0,
  firstRun: userCount() === 0, smtp: smtpConfigured(cfg.smtp), pdfServer: hasPdftoppm,
}));
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

/* Auth */
route('POST', '/api/auth/signup', async (ctx) => {
  rateLimit(ctx.req, 'signup', 10, 600e3);
  const b = await jsonBody(ctx.req);
  const first = userCount() === 0;
  const inv = b.invite ? db.prepare('SELECT * FROM team_invites WHERE token = ? AND expires > ?').get(String(b.invite), now()) : null;
  if (!first && !inv && !getSetting('registration', true)) throw new HttpError(403, 'Die Registrierung ist geschlossen. Frag deinen Admin nach einem Zugang oder einer Team-Einladung.');
  const email = str(b.email, 200).toLowerCase(), name = str(b.name, 80), pw = String(b.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Bitte gib eine gültige E-Mail-Adresse ein.');
  if (!name) throw bad('Bitte gib deinen Namen ein.');
  if (pw.length < 8) throw bad('Das Passwort braucht mindestens 8 Zeichen.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.');
  const id = uid();
  db.prepare('INSERT INTO users (id, email, name, pass_hash, is_admin, settings, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, email, name, hashPassword(pw), first ? 1 : 0, '{}', now());
  createSession(ctx.req, ctx.res, id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
});
route('POST', '/api/auth/login', async (ctx) => {
  rateLimit(ctx.req, 'login', 20, 600e3);
  const b = await jsonBody(ctx.req);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(b.email, 200).toLowerCase());
  if (!u || !verifyPassword(String(b.password || ''), u.pass_hash)) throw new HttpError(401, 'E-Mail oder Passwort stimmt nicht.');
  createSession(ctx.req, ctx.res, u.id);
  return { user: publicUser(u) };
});
route('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.user) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.user.session_hash);
  setCookie(ctx.req, ctx.res, '', 0);
  return { ok: true };
});
route('GET', '/api/auth/me', async (ctx) => {
  if (!ctx.user) return { user: null, teams: [] };
  const u = ctx.user;
  const teams = db.prepare('SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name').all(u.id);
  return { user: publicUser(u), teams };
});
route('POST', '/api/auth/forgot', async (ctx) => {
  rateLimit(ctx.req, 'forgot', 5, 600e3);
  const b = await jsonBody(ctx.req);
  if (!smtpConfigured(cfg.smtp)) throw new HttpError(503, 'Auf diesem Server ist kein E-Mail-Versand eingerichtet. Ein Admin kann dein Passwort zurücksetzen.');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(b.email, 200).toLowerCase());
  if (u) {
    const t = token();
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires) VALUES (?, ?, ?)').run(sha256(t), u.id, now() + 3600e3);
    const link = `${baseUrl(ctx.req)}/reset/${t}`;
    sendMail(cfg.smtp, { to: u.email, subject: `${cfg.appName}: Passwort zurücksetzen`,
      text: `Hallo ${u.name},\n\nüber diesen Link kannst du ein neues Passwort setzen. Er ist eine Stunde gültig:\n\n${link}\n\nWenn du das nicht angefordert hast, ignoriere diese E-Mail.\n` })
      .catch(e => console.error('Mail-Fehler:', e.message));
  }
  return { ok: true };
});
route('POST', '/api/auth/reset', async (ctx) => {
  rateLimit(ctx.req, 'reset', 10, 600e3);
  const b = await jsonBody(ctx.req);
  const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(b.token || '')));
  if (!r || r.expires < now()) throw bad('Der Link ist abgelaufen oder ungültig. Fordere einen neuen an.');
  if (String(b.password || '').length < 8) throw bad('Das Passwort braucht mindestens 8 Zeichen.');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.password), r.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(r.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.user_id);
  createSession(ctx.req, ctx.res, r.user_id);
  return { ok: true };
});

/* Eigenes Konto */
route('PUT', '/api/me', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  const name = b.name != null ? str(b.name, 80) : u.name;
  const email = b.email != null ? str(b.email, 200).toLowerCase() : u.email;
  if (!name) throw bad('Der Name darf nicht leer sein.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Bitte gib eine gültige E-Mail-Adresse ein.');
  if (email !== u.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, u.id)) throw bad('Diese E-Mail wird schon verwendet.');
  const settings = b.settings && typeof b.settings === 'object' ? { ...J(u.settings, {}), ...b.settings } : J(u.settings, {});
  if (JSON.stringify(settings).length > 20000) throw bad('Einstellungen zu groß.');
  db.prepare('UPDATE users SET name = ?, email = ?, settings = ? WHERE id = ?').run(name, email, JSON.stringify(settings), u.id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
});
route('PUT', '/api/me/password', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  rateLimit(ctx.req, 'pw', 10, 600e3);
  if (!verifyPassword(String(b.current || ''), u.pass_hash)) throw bad('Das aktuelle Passwort stimmt nicht.');
  if (String(b.next || '').length < 8) throw bad('Das neue Passwort braucht mindestens 8 Zeichen.');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.next), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, u.session_hash);
  return { ok: true };
});
route('DELETE', '/api/me', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  if (!verifyPassword(String(b.password || ''), u.pass_hash)) throw bad('Das Passwort stimmt nicht.');
  if (u.is_admin && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 1 && userCount() > 1) throw bad('Du bist der einzige Admin. Mach zuerst jemand anderen zum Admin.');
  for (const p of db.prepare('SELECT id FROM plans WHERE owner_id = ?').all(u.id)) deletePlanFiles(p.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  setCookie(ctx.req, ctx.res, '', 0);
  return { ok: true };
});

/* Projekte */
route('GET', '/api/projects', async (ctx) => {
  const u = need(ctx); const teams = myTeamIds(u.id);
  const rows = db.prepare(`SELECT p.*, t.name AS team_name, (SELECT COUNT(*) FROM plans WHERE project_id = p.id AND archived = 0) AS plan_count
    FROM projects p LEFT JOIN teams t ON t.id = p.team_id WHERE p.owner_id = ? ${teams.length ? `OR p.team_id IN (${teams.map(() => '?').join(',')})` : ''} ORDER BY p.updated DESC`).all(u.id, ...teams);
  return rows.map(r => ({ id: r.id, name: r.name, color: r.color, notes: r.notes, team_id: r.team_id, team_name: r.team_name, plan_count: r.plan_count, owner: r.owner_id === u.id, updated: r.updated }));
});
function loadProject(id, u) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p || !(p.owner_id === u.id || (p.team_id && teamRole(u.id, p.team_id)))) throw new HttpError(404, 'Projekt nicht gefunden.');
  return p;
}
route('POST', '/api/projects', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  const name = str(b.name, 120); if (!name) throw bad('Gib dem Projekt einen Namen.');
  const team = optStr(b.team_id); if (team && !teamRole(u.id, team)) throw bad('Du bist nicht in diesem Team.');
  const id = uid();
  db.prepare('INSERT INTO projects (id, owner_id, team_id, name, color, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, u.id, team, name, optStr(b.color, 20), optStr(b.notes, 2000), now(), now());
  return { id };
});
route('PUT', '/api/projects/:id', async (ctx, { id }) => {
  const u = need(ctx); const p = loadProject(id, u); const b = await jsonBody(ctx.req);
  const team = b.team_id === undefined ? p.team_id : optStr(b.team_id);
  if (team && !teamRole(u.id, team)) throw bad('Du bist nicht in diesem Team.');
  db.prepare('UPDATE projects SET name = ?, color = ?, notes = ?, team_id = ?, updated = ? WHERE id = ?')
    .run(b.name != null ? str(b.name, 120) || p.name : p.name, b.color !== undefined ? optStr(b.color, 20) : p.color, b.notes !== undefined ? optStr(b.notes, 2000) : p.notes, team, now(), id);
  return { ok: true };
});
route('DELETE', '/api/projects/:id', async (ctx, { id }) => {
  const u = need(ctx); const p = loadProject(id, u);
  if (p.owner_id !== u.id && teamRole(u.id, p.team_id) !== 'admin') throw new HttpError(403, 'Nur der Besitzer oder ein Team-Admin kann das Projekt löschen.');
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return { ok: true };
});

/* Pläne */
route('GET', '/api/plans', async (ctx) => {
  const u = need(ctx); const q = ctx.query; const teams = myTeamIds(u.id);
  const where = []; const args = [];
  if (q.get('templates') === '1') {
    where.push(`is_template = 1 AND (owner_id IS NULL OR owner_id = ? ${teams.length ? `OR team_id IN (${teams.map(() => '?').join(',')})` : ''})`); args.push(u.id, ...teams);
  } else {
    where.push(`is_template = 0 AND (owner_id = ? ${teams.length ? `OR team_id IN (${teams.map(() => '?').join(',')})` : ''})`); args.push(u.id, ...teams);
    const today = new Date().toISOString().slice(0, 10);
    const f = q.get('filter') || 'all';
    if (f === 'archived') where.push('archived = 1'); else where.push('archived = 0');
    if (f === 'upcoming') { where.push('(COALESCE(event_date, rig_date) >= ? OR (event_date IS NULL AND rig_date IS NULL))'); args.push(today); }
    if (f === 'past') { where.push('COALESCE(event_date, rig_date) < ?'); args.push(today); }
    if (q.get('project')) { where.push('project_id = ?'); args.push(q.get('project')); }
    if (q.get('team')) { where.push('team_id = ?'); args.push(q.get('team')); }
  }
  if (q.get('q')) { where.push('(name LIKE ? OR job_id LIKE ? OR venue LIKE ?)'); const s = `%${q.get('q')}%`; args.push(s, s, s); }
  const sort = q.get('sort') === 'date' ? 'COALESCE(event_date, rig_date, \'9999\') ASC' : q.get('sort') === 'name' ? 'name COLLATE NOCASE ASC' : 'updated DESC';
  const rows = db.prepare(`SELECT * FROM plans WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT 500`).all(...args);
  return rows.map(p => planMeta(p, u));
});
route('POST', '/api/plans', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  const team = optStr(b.team_id); if (team && !teamRole(u.id, team)) throw bad('Du bist nicht in diesem Team.');
  const project = optStr(b.project_id); if (project) loadProject(project, u);
  if (!isDate(b.rig_date) || !isDate(b.event_date)) throw bad('Ungültiges Datum.');
  const meta = { name: str(b.name, 160) || 'Neuer Plan', job_id: optStr(b.job_id, 60), venue: optStr(b.venue, 160), rig_date: optStr(b.rig_date, 10), event_date: optStr(b.event_date, 10), team_id: team, project_id: project, is_template: !!b.is_template };
  if (b.template_id || b.copy_of) {
    const src = loadPlan(b.template_id || b.copy_of, u, 'view');
    const id = copyPlan(src, u, meta);
    return { id };
  }
  const data = b.data && typeof b.data === 'object' ? b.data : { v: 3, orient: J(u.settings, {}).orient || 'tb', items: [], cables: [], shapes: [], floors: [], extras: [] };
  if (b.data && Array.isArray(b.data.floors)) b.data.floors = []; // importierte Grundrisse müssen neu hochgeladen werden
  const id = uid(); const t = now();
  db.prepare(`INSERT INTO plans (id, owner_id, team_id, project_id, name, job_id, venue, rig_date, event_date, is_template, data, stats, created, updated, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, u.id, team, project, meta.name, meta.job_id, meta.venue, meta.rig_date, meta.event_date, meta.is_template ? 1 : 0, JSON.stringify(data), JSON.stringify(planStats(data)), t, t, u.id);
  return { id };
});
route('GET', '/api/plans/:id', async (ctx, { id }) => {
  const u = need(ctx); const p = loadPlan(id, u, 'view');
  return { ...planMeta(p, u), data: J(p.data, {}), checks: packChecks(id), assets: assetList(id) };
});
const assetList = (planId) => db.prepare('SELECT id, kind, mime, filename, w, h, meta FROM plan_assets WHERE plan_id = ?').all(planId).map(a => ({ ...a, meta: J(a.meta, null) }));
route('PUT', '/api/plans/:id', async (ctx, { id }) => {
  const u = need(ctx); const p = loadPlan(id, u, 'edit'); const b = await jsonBody(ctx.req);
  const sets = []; const args = []; const meta = {};
  const setF = (col, val) => { sets.push(`${col} = ?`); args.push(val); meta[col] = val; };
  if (b.name !== undefined) setF('name', str(b.name, 160) || p.name);
  for (const k of ['job_id', 'venue']) if (b[k] !== undefined) setF(k, optStr(b[k], 160));
  for (const k of ['rig_date', 'event_date']) if (b[k] !== undefined) { if (!isDate(b[k])) throw bad('Ungültiges Datum.'); setF(k, optStr(b[k], 10)); }
  if (b.archived !== undefined) setF('archived', b.archived ? 1 : 0);
  if (b.is_template !== undefined) setF('is_template', b.is_template ? 1 : 0);
  if (b.project_id !== undefined) { const pr = optStr(b.project_id); if (pr) loadProject(pr, u); setF('project_id', pr); }
  if (b.team_id !== undefined) {
    const t = optStr(b.team_id);
    if (p._access !== 'owner' && teamRole(u.id, p.team_id) !== 'admin') throw new HttpError(403, 'Nur der Besitzer oder ein Team-Admin kann das Team ändern.');
    if (t && !teamRole(u.id, t)) throw bad('Du bist nicht in diesem Team.');
    setF('team_id', t);
  }
  let version = p.version;
  if (b.data !== undefined) {
    if (typeof b.data !== 'object' || !b.data) throw bad('Plandaten fehlen.');
    if (Number(b.version) !== p.version) {
      const by = p.updated_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(p.updated_by)?.name : null;
      throw new HttpError(409, 'Der Plan wurde inzwischen geändert.', { version: p.version, by });
    }
    version = p.version + 1;
    sets.push('data = ?', 'version = ?', 'stats = ?'); args.push(JSON.stringify(b.data), version, JSON.stringify(planStats(b.data)));
  }
  if (!sets.length) return { version };
  sets.push('updated = ?', 'updated_by = ?'); args.push(now(), u.id);
  db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ? AND version = ?`).run(...args, id, p.version);
  const clientId = ctx.req.headers['x-client-id'];
  if (b.data !== undefined) broadcast(id, 'plan', { version, by: u.name }, clientId);
  if (Object.keys(meta).length) broadcast(id, 'meta', { ...meta, by: u.name }, clientId);
  return { version, updated: now() };
});
route('DELETE', '/api/plans/:id', async (ctx, { id }) => {
  const u = need(ctx); loadPlan(id, u, 'owner');
  deletePlanFiles(id);
  db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  broadcast(id, 'deleted', {});
  return { ok: true };
});
route('POST', '/api/plans/:id/duplicate', async (ctx, { id }) => {
  const u = need(ctx); const src = loadPlan(id, u, 'view'); const b = await jsonBody(ctx.req);
  const nid = copyPlan(src, u, { name: str(b.name, 160) || `${src.name} (Kopie)`, team_id: src.owner_id === null ? null : src.team_id, project_id: src.owner_id === null ? null : src.project_id, is_template: !!b.is_template });
  return { id: nid };
});
route('PUT', '/api/plans/:id/thumb', async (ctx, { id }) => {
  const u = need(ctx); loadPlan(id, u, 'edit'); const b = await jsonBody(ctx.req, 1048576);
  if (b.thumb && (!/^data:image\/(png|jpeg|webp);base64,/.test(b.thumb) || b.thumb.length > 500000)) throw bad('Ungültiges Vorschaubild.');
  db.prepare('UPDATE plans SET thumb = ? WHERE id = ?').run(b.thumb || null, id);
  return { ok: true };
});
route('POST', '/api/plans/:id/share', async (ctx, { id }) => {
  const u = need(ctx); const p = loadPlan(id, u, 'edit'); const b = await jsonBody(ctx.req);
  let t = p.share_token;
  if (!t || b.regenerate) t = token().slice(0, 22);
  const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);
  db.prepare('UPDATE plans SET share_token = ?, share_enabled = ? WHERE id = ?').run(t, enabled, id);
  return { share_enabled: !!enabled, share_token: t, url: `${baseUrl(ctx.req)}/share/${t}` };
});
route('PUT', '/api/plans/:id/pack', async (ctx, { id }) => {
  const u = need(ctx); loadPlan(id, u, 'edit'); const b = await jsonBody(ctx.req);
  const key = str(b.key, 300); if (!key) throw bad('Eintrag fehlt.');
  if (b.checked) db.prepare('INSERT INTO pack_checks (plan_id, key, user_id, at) VALUES (?, ?, ?, ?) ON CONFLICT(plan_id, key) DO UPDATE SET user_id = excluded.user_id, at = excluded.at').run(id, key, u.id, now());
  else db.prepare('DELETE FROM pack_checks WHERE plan_id = ? AND key = ?').run(id, key);
  broadcast(id, 'pack', { key, checked: !!b.checked, by: u.name, at: now() }, ctx.req.headers['x-client-id']);
  return { ok: true };
});
route('DELETE', '/api/plans/:id/pack', async (ctx, { id }) => {
  const u = need(ctx); loadPlan(id, u, 'edit');
  db.prepare('DELETE FROM pack_checks WHERE plan_id = ?').run(id);
  broadcast(id, 'packreset', { by: u.name }, ctx.req.headers['x-client-id']);
  return { ok: true };
});
route('POST', '/api/plans/:id/assets', async (ctx, { id }) => {
  const u = need(ctx); loadPlan(id, u, 'edit');
  let mime = String(ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const okTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];
  if (!okTypes.includes(mime)) throw bad('Bitte lade ein Bild (PNG, JPG, WebP, GIF, SVG) oder ein PDF hoch.');
  let buf = await readBody(ctx.req, cfg.maxUploadMb * 1048576);
  if (!buf.length) throw bad('Die Datei ist leer.');
  const filename = str(decodeURIComponent(String(ctx.req.headers['x-filename'] || 'grundriss')), 200);
  let meta = null;
  if (mime === 'application/pdf') {
    if (!hasPdftoppm) throw new HttpError(415, 'PDF-Umwandlung ist auf dem Server nicht verfügbar (poppler-utils fehlt).');
    const r = await pdfToPng(buf);
    buf = r.png; mime = 'image/png'; meta = { pdf: true, ptPerPx: r.ptPerPx };
  } else if (ctx.req.headers['x-meta']) {
    const m = J(decodeURIComponent(String(ctx.req.headers['x-meta'])), null);
    if (m && typeof m.ptPerPx === 'number' && m.ptPerPx > 0) meta = { pdf: true, ptPerPx: m.ptPerPx };
  }
  if (mime === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(buf.toString('utf8'))) throw bad('Die SVG-Datei enthält Skripte und wird aus Sicherheitsgründen abgelehnt.');
  const size = imageSize(buf, mime);
  if (!size) throw bad('Das Bild konnte nicht gelesen werden.');
  const aid = uid();
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' }[mime];
  await fsp.writeFile(path.join(UPLOADS, aid + ext), buf);
  db.prepare('INSERT INTO plan_assets (id, plan_id, kind, mime, filename, file, w, h, meta, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(aid, id, 'floor', mime, filename, aid + ext, Math.round(size.w), Math.round(size.h), meta ? JSON.stringify(meta) : null, now());
  return { id: aid, mime, w: Math.round(size.w), h: Math.round(size.h), meta, filename };
});
route('GET', '/api/assets/:id', async (ctx, { id }) => {
  const a = db.prepare('SELECT a.*, p.owner_id, p.team_id, p.is_template, p.share_token, p.share_enabled FROM plan_assets a JOIN plans p ON p.id = a.plan_id WHERE a.id = ?').get(id);
  if (!a) throw new HttpError(404, 'Datei nicht gefunden.');
  const s = ctx.query.get('s');
  const viaShare = s && a.share_enabled && a.share_token === s;
  if (!viaShare && !planAccess(ctx.user, { owner_id: a.owner_id, team_id: a.team_id, is_template: a.is_template })) throw new HttpError(404, 'Datei nicht gefunden.');
  const fp = path.join(UPLOADS, a.file);
  if (!fs.existsSync(fp)) throw new HttpError(404, 'Datei fehlt auf dem Server.');
  ctx.res.writeHead(200, {
    'Content-Type': a.mime, 'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    'Content-Length': fs.statSync(fp).size,
  });
  fs.createReadStream(fp).pipe(ctx.res);
  return undefined;
}, { raw: true });

/* Live-Kanal */
route('GET', '/api/plans/:id/events', async (ctx, { id }) => {
  let viewer = false, name = 'Gast', userId = null;
  const s = ctx.query.get('s');
  if (s) {
    const p = db.prepare('SELECT id FROM plans WHERE id = ? AND share_enabled = 1 AND share_token = ?').get(id, s);
    if (!p) throw new HttpError(404, 'Plan nicht gefunden.');
    viewer = true;
  } else { const u = need(ctx); loadPlan(id, u, 'view'); name = u.name; userId = u.id; }
  const res = ctx.res;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const client = { res, clientId: str(ctx.query.get('client'), 40) || uid(), userId, name, viewer };
  if (!channels.has(id)) channels.set(id, new Set());
  channels.get(id).add(client);
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ clientId: client.clientId })}\n\n`);
  presence(id);
  ctx.req.on('close', () => { const set = channels.get(id); if (set) { set.delete(client); if (!set.size) channels.delete(id); else presence(id); } });
  return undefined;
}, { raw: true });

/* Freigabe (öffentlich) */
route('GET', '/api/share/:token', async (ctx, { token: t }) => {
  const p = db.prepare('SELECT * FROM plans WHERE share_token = ? AND share_enabled = 1').get(t);
  if (!p) throw new HttpError(404, 'Dieser Freigabe-Link ist ungültig oder wurde deaktiviert.');
  const m = planMeta(p, null);
  delete m.share_token;
  return { ...m, access: 'view', data: J(p.data, {}), checks: packChecks(p.id), assets: assetList(p.id) };
});

/* Geräte */
route('GET', '/api/gear', async (ctx) => {
  const u = need(ctx); const teams = myTeamIds(u.id);
  const rows = db.prepare(`SELECT * FROM gear WHERE owner_id = ? ${teams.length ? `OR team_id IN (${teams.map(() => '?').join(',')})` : ''} ORDER BY category, name COLLATE NOCASE`).all(u.id, ...teams);
  return rows.map(g => gearOut(g, u));
});
route('GET', '/api/gear/:id', async (ctx, { id }) => {
  const u = need(ctx); const g = db.prepare('SELECT * FROM gear WHERE id = ?').get(id);
  if (!gearAccess(u, g)) throw new HttpError(404, 'Gerät nicht gefunden.');
  return gearOut(g, u);
});
function gearFields(b, u) {
  const name = str(b.name, 120); if (!name) throw bad('Gib dem Gerät einen Namen.');
  const team = optStr(b.team_id); if (team && !teamRole(u.id, team)) throw bad('Du bist nicht in diesem Team.');
  const elements = Array.isArray(b.elements) ? b.elements.slice(0, 12).map(e => str(e, 120)).filter(Boolean) : [];
  return { name, manufacturer: optStr(b.manufacturer, 80), model: optStr(b.model, 80), category: str(b.category, 40) || 'Eigene', color: optStr(b.color, 20) || '#4a5560',
    ports: JSON.stringify(cleanPorts(b.ports || [])), elements: JSON.stringify(elements), image: cleanImage(b.image), gear_id: optStr(b.gear_id, 60), notes: optStr(b.notes, 2000), team_id: team };
}
route('POST', '/api/gear', async (ctx) => {
  const u = need(ctx); const f = gearFields(await jsonBody(ctx.req), u); const id = uid();
  db.prepare(`INSERT INTO gear (id, owner_id, team_id, name, manufacturer, model, category, color, ports, elements, image, gear_id, notes, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, u.id, f.team_id, f.name, f.manufacturer, f.model, f.category, f.color, f.ports, f.elements, f.image, f.gear_id, f.notes, now(), now());
  return gearOut(db.prepare('SELECT * FROM gear WHERE id = ?').get(id), u);
});
route('PUT', '/api/gear/:id', async (ctx, { id }) => {
  const u = need(ctx); const g = db.prepare('SELECT * FROM gear WHERE id = ?').get(id);
  const acc = gearAccess(u, g); if (!acc || acc === 'view') throw new HttpError(404, 'Gerät nicht gefunden.');
  const f = gearFields(await jsonBody(ctx.req), u);
  db.prepare(`UPDATE gear SET team_id = ?, name = ?, manufacturer = ?, model = ?, category = ?, color = ?, ports = ?, elements = ?, image = ?, gear_id = ?, notes = ?, updated = ? WHERE id = ?`)
    .run(f.team_id, f.name, f.manufacturer, f.model, f.category, f.color, f.ports, f.elements, f.image, f.gear_id, f.notes, now(), id);
  return gearOut(db.prepare('SELECT * FROM gear WHERE id = ?').get(id), u);
});
route('DELETE', '/api/gear/:id', async (ctx, { id }) => {
  const u = need(ctx); const g = db.prepare('SELECT * FROM gear WHERE id = ?').get(id);
  const acc = gearAccess(u, g); if (!acc || acc === 'view') throw new HttpError(404, 'Gerät nicht gefunden.');
  db.prepare('DELETE FROM gear WHERE id = ?').run(id);
  return { ok: true };
});
route('POST', '/api/gear/:id/publish', async (ctx, { id }) => {
  const u = need(ctx); const g = db.prepare('SELECT * FROM gear WHERE id = ?').get(id);
  if (gearAccess(u, g) !== 'owner') throw new HttpError(403, 'Nur eigene Geräte kannst du veröffentlichen.');
  const b = await jsonBody(ctx.req);
  db.prepare('UPDATE gear SET is_public = ?, updated = ? WHERE id = ?').run(b.public ? 1 : 0, now(), id);
  return { is_public: !!b.public };
});
route('POST', '/api/gear/:id/use', async (ctx, { id }) => {
  need(ctx); db.prepare('UPDATE gear SET uses = uses + 1 WHERE id = ?').run(id); return { ok: true };
});
route('GET', '/api/community', async (ctx) => {
  const u = need(ctx); const q = ctx.query;
  const where = ['is_public = 1']; const args = [];
  if (q.get('q')) { where.push('(name LIKE ? OR manufacturer LIKE ? OR model LIKE ?)'); const s = `%${q.get('q')}%`; args.push(s, s, s); }
  if (q.get('cat')) { where.push('category = ?'); args.push(q.get('cat')); }
  if (q.get('source') === 'builtin') where.push('is_builtin = 1');
  if (q.get('source') === 'users') where.push('is_builtin = 0');
  const order = q.get('sort') === 'new' ? 'created DESC' : q.get('sort') === 'name' ? 'name COLLATE NOCASE' : 'uses DESC, name COLLATE NOCASE';
  const limit = Math.min(200, Number(q.get('limit') || 120)), offset = Number(q.get('offset') || 0);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM gear WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM gear WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const cats = db.prepare('SELECT category, COUNT(*) AS n FROM gear WHERE is_public = 1 GROUP BY category ORDER BY category').all();
  return { total, items: rows.map(g => gearOut(g, u)), categories: cats };
});
route('POST', '/api/community/:id/copy', async (ctx, { id }) => {
  const u = need(ctx); const g = db.prepare('SELECT * FROM gear WHERE id = ? AND is_public = 1').get(id);
  if (!g) throw new HttpError(404, 'Gerät nicht gefunden.');
  const nid = uid();
  db.prepare(`INSERT INTO gear (id, owner_id, name, manufacturer, model, category, color, ports, elements, image, notes, source_id, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nid, u.id, g.name, g.manufacturer, g.model, g.category, g.color, g.ports, g.elements, g.image, g.notes, g.id, now(), now());
  db.prepare('UPDATE gear SET uses = uses + 1 WHERE id = ?').run(id);
  return gearOut(db.prepare('SELECT * FROM gear WHERE id = ?').get(nid), u);
});

/* Teams */
function teamOut(t, u) {
  const role = teamRole(u.id, t.id);
  const members = db.prepare('SELECT u.id, u.name, u.email, m.role, m.created FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role, u.name').all(t.id);
  const invites = role === 'admin' ? db.prepare('SELECT token, email, created, expires FROM team_invites WHERE team_id = ? ORDER BY created DESC').all(t.id) : [];
  const plans = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE team_id = ? AND is_template = 0').get(t.id).n;
  return { id: t.id, name: t.name, role, members, invites, plan_count: plans, created: t.created };
}
const loadTeam = (id, u, admin) => {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  const r = t && teamRole(u.id, id);
  if (!r) throw new HttpError(404, 'Team nicht gefunden.');
  if (admin && r !== 'admin') throw new HttpError(403, 'Das darf nur ein Team-Admin.');
  return t;
};
route('GET', '/api/teams', async (ctx) => {
  const u = need(ctx);
  return db.prepare('SELECT t.* FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.name').all(u.id).map(t => teamOut(t, u));
});
route('POST', '/api/teams', async (ctx) => {
  const u = need(ctx); const b = await jsonBody(ctx.req);
  const name = str(b.name, 80); if (!name) throw bad('Gib dem Team einen Namen.');
  const id = uid();
  tx(db, () => {
    db.prepare('INSERT INTO teams (id, name, created) VALUES (?, ?, ?)').run(id, name, now());
    db.prepare("INSERT INTO team_members (team_id, user_id, role, created) VALUES (?, ?, 'admin', ?)").run(id, u.id, now());
  });
  return teamOut(db.prepare('SELECT * FROM teams WHERE id = ?').get(id), u);
});
route('PUT', '/api/teams/:id', async (ctx, { id }) => {
  const u = need(ctx); loadTeam(id, u, true); const b = await jsonBody(ctx.req);
  const name = str(b.name, 80); if (!name) throw bad('Gib dem Team einen Namen.');
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, id);
  return { ok: true };
});
route('DELETE', '/api/teams/:id', async (ctx, { id }) => {
  const u = need(ctx); loadTeam(id, u, true);
  tx(db, () => {
    db.prepare('UPDATE gear SET team_id = NULL WHERE team_id = ?').run(id);
    db.prepare('UPDATE plans SET team_id = NULL WHERE team_id = ?').run(id);
    db.prepare('UPDATE projects SET team_id = NULL WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  });
  return { ok: true };
});
route('POST', '/api/teams/:id/invites', async (ctx, { id }) => {
  const u = need(ctx); const t = loadTeam(id, u, true); const b = await jsonBody(ctx.req);
  const email = optStr(b.email, 200)?.toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Bitte gib eine gültige E-Mail-Adresse ein.');
  if (email) {
    const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (ex && teamRole(ex.id, id)) throw bad('Diese Person ist schon im Team.');
  }
  const tk = token().slice(0, 24);
  db.prepare('INSERT INTO team_invites (token, team_id, email, invited_by, created, expires) VALUES (?, ?, ?, ?, ?, ?)').run(tk, id, email, u.id, now(), now() + 14 * 864e5);
  const link = `${baseUrl(ctx.req)}/invite/${tk}`;
  let mailed = false;
  if (email && smtpConfigured(cfg.smtp)) {
    try {
      await sendMail(cfg.smtp, { to: email, subject: `${u.name} lädt dich ins Team „${t.name}“ ein`,
        text: `Hallo,\n\n${u.name} hat dich in das Team „${t.name}“ bei ${cfg.appName} eingeladen.\n\nEinladung annehmen:\n${link}\n\nDer Link ist 14 Tage gültig.\n` });
      mailed = true;
    } catch (e) { console.error('Mail-Fehler:', e.message); }
  }
  return { token: tk, link, mailed };
});
route('DELETE', '/api/teams/:id/invites/:token', async (ctx, { id, token: tk }) => {
  const u = need(ctx); loadTeam(id, u, true);
  db.prepare('DELETE FROM team_invites WHERE token = ? AND team_id = ?').run(tk, id);
  return { ok: true };
});
route('GET', '/api/invites/:token', async (ctx, { token: tk }) => {
  const i = db.prepare('SELECT i.*, t.name AS team_name, u.name AS by_name FROM team_invites i JOIN teams t ON t.id = i.team_id LEFT JOIN users u ON u.id = i.invited_by WHERE token = ?').get(tk);
  if (!i || i.expires < now()) throw new HttpError(404, 'Diese Einladung ist abgelaufen oder ungültig.');
  return { team_name: i.team_name, invited_by: i.by_name, email: i.email };
});
route('POST', '/api/invites/:token/accept', async (ctx, { token: tk }) => {
  const u = need(ctx);
  const i = db.prepare('SELECT * FROM team_invites WHERE token = ?').get(tk);
  if (!i || i.expires < now()) throw new HttpError(404, 'Diese Einladung ist abgelaufen oder ungültig.');
  if (i.email && i.email !== u.email.toLowerCase()) throw new HttpError(403, `Diese Einladung gilt für ${i.email}. Melde dich mit dieser E-Mail an.`);
  if (!teamRole(u.id, i.team_id)) db.prepare("INSERT INTO team_members (team_id, user_id, role, created) VALUES (?, ?, 'member', ?)").run(i.team_id, u.id, now());
  if (i.email) db.prepare('DELETE FROM team_invites WHERE token = ?').run(tk);
  return { team_id: i.team_id };
});
route('PUT', '/api/teams/:id/members/:uid', async (ctx, { id, uid: mid }) => {
  const u = need(ctx); loadTeam(id, u, true); const b = await jsonBody(ctx.req);
  const role = b.role === 'admin' ? 'admin' : 'member';
  if (role === 'member' && db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'admin' AND user_id != ?").get(id, mid).n === 0) throw bad('Ein Team braucht mindestens einen Admin.');
  db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, id, mid);
  return { ok: true };
});
route('DELETE', '/api/teams/:id/members/:uid', async (ctx, { id, uid: mid }) => {
  const u = need(ctx); loadTeam(id, u, mid !== u.id);
  if (db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'admin' AND user_id != ?").get(id, mid).n === 0) throw bad('Du bist der letzte Admin. Ernenne zuerst einen anderen Admin oder lösche das Team.');
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(id, mid);
  return { ok: true };
});

/* Admin */
route('GET', '/api/admin/users', async (ctx) => {
  needAdmin(ctx);
  return db.prepare(`SELECT u.id, u.email, u.name, u.is_admin, u.created, u.last_login,
    (SELECT COUNT(*) FROM plans WHERE owner_id = u.id) AS plans, (SELECT COUNT(*) FROM gear WHERE owner_id = u.id) AS gear
    FROM users u ORDER BY u.created`).all().map(r => ({ ...r, is_admin: !!r.is_admin }));
});
route('PUT', '/api/admin/users/:id', async (ctx, { id }) => {
  const me = needAdmin(ctx); const b = await jsonBody(ctx.req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id); if (!u) throw new HttpError(404, 'Benutzer nicht gefunden.');
  if (b.is_admin !== undefined) {
    if (!b.is_admin && id === me.id && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 1) throw bad('Du bist der einzige Admin.');
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.is_admin ? 1 : 0, id);
  }
  let temp = null;
  if (b.reset_password) {
    temp = crypto.randomBytes(9).toString('base64url');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(temp), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  return { ok: true, temp_password: temp };
});
route('DELETE', '/api/admin/users/:id', async (ctx, { id }) => {
  const me = needAdmin(ctx);
  if (id === me.id) throw bad('Dein eigenes Konto löschst du in den Einstellungen.');
  for (const p of db.prepare('SELECT id FROM plans WHERE owner_id = ?').all(id)) deletePlanFiles(p.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
});
route('GET', '/api/admin/settings', async (ctx) => {
  needAdmin(ctx);
  const c = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return { registration: getSetting('registration', true), smtp: smtpConfigured(cfg.smtp), smtpFrom: cfg.smtp.from || null, pdfServer: hasPdftoppm,
    stats: { users: c('users'), plans: c('plans'), gear: c('gear'), teams: c('teams') }, version: VERSION, node: process.version, dataDir: cfg.dataDir };
});
route('PUT', '/api/admin/settings', async (ctx) => {
  needAdmin(ctx); const b = await jsonBody(ctx.req);
  if (b.registration !== undefined) setSetting('registration', !!b.registration);
  return { ok: true };
});
route('POST', '/api/admin/test-mail', async (ctx) => {
  const u = needAdmin(ctx);
  try { await sendMail(cfg.smtp, { to: u.email, subject: `${cfg.appName}: Test-E-Mail`, text: 'Der E-Mail-Versand funktioniert.' }); }
  catch (e) { throw bad('Versand fehlgeschlagen: ' + e.message); }
  return { ok: true, to: u.email };
});

/* ---------- Statische Dateien ---------- */
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; " +
  "script-src 'self' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.includes('\0')) return notFound(res);
  let fp = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(PUBLIC)) return notFound(res);
  let st = fs.existsSync(fp) && fs.statSync(fp);
  if (!st || st.isDirectory()) {
    if (path.extname(rel)) return notFound(res);
    fp = path.join(PUBLIC, 'index.html'); st = fs.statSync(fp);
  }
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const headers = { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache' };
  if (fp.endsWith('.html')) headers['Content-Security-Policy'] = CSP;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(fp).pipe(res);
}
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Nicht gefunden'); }

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    return serveStatic(req, res, url.pathname);
  }
  const ctx = { req, res, query: url.searchParams, user: null };
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-pp'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.');
    ctx.user = currentUser(req);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re); if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const out = await r.handler(ctx, params);
      if (r.opts.raw) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(out ?? {}));
    }
    throw new HttpError(404, 'Unbekannter Endpunkt.');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: status === 500 ? 'Interner Fehler. Details stehen im Server-Log.' : e.message, ...(e.extra || {}) }));
  }
});
server.requestTimeout = 0; // SSE
server.headersTimeout = 60000;
server.listen(cfg.port, cfg.host, () => {
  console.log(`${cfg.appName} ${VERSION} läuft auf http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}  (Daten: ${cfg.dataDir})`);
  if (!smtpConfigured(cfg.smtp)) console.log('Hinweis: SMTP ist nicht eingerichtet. Passwort-Mails und Team-Einladungen per Mail sind aus; Einladungslinks funktionieren trotzdem.');
});
const shutdown = () => { server.close(); try { db.close(); } catch { /* egal */ } process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
