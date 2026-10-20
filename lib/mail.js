// Minimaler SMTP-Client ohne Abhängigkeiten (SMTPS auf 465 oder STARTTLS).
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';

export function smtpConfigured(cfg) { return !!(cfg && cfg.host && cfg.from); }

export async function sendMail(cfg, { to, subject, text }) {
  if (!smtpConfigured(cfg)) throw new Error('SMTP ist nicht konfiguriert');
  const port = Number(cfg.port || (cfg.secure ? 465 : 587));
  const secure = cfg.secure === true || cfg.secure === 'true' || port === 465;
  let sock = secure
    ? tls.connect({ host: cfg.host, port, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== 'false' })
    : net.connect({ host: cfg.host, port });
  sock.setTimeout(20000);
  let buf = '';
  let waiter = null;
  const onData = (d) => { buf += d.toString('utf8'); check(); };
  function check() {
    if (!waiter) return;
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const resp = lines.slice(0, i + 1).join('\n');
        buf = lines.slice(i + 1).join('\r\n');
        const w = waiter; waiter = null; w.resolve(resp); return;
      }
    }
  }
  const read = () => new Promise((resolve, reject) => { waiter = { resolve, reject }; check(); });
  const attach = (s) => { s.on('data', onData); s.on('error', (e) => waiter && waiter.reject(e)); s.on('timeout', () => { waiter && waiter.reject(new Error('SMTP-Timeout')); s.destroy(); }); };
  attach(sock);
  async function cmd(line, expect) {
    if (line != null) sock.write(line + '\r\n');
    const r = await read();
    const code = Number(r.slice(0, 3));
    if (expect && !expect.includes(code)) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'Begrüßung'}: ${r}`);
    return r;
  }
  if (!secure) await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
  await cmd(null, [220]);
  const host = os.hostname() || 'patchplaner';
  let ehlo = await cmd('EHLO ' + host, [250]);
  if (!secure && /STARTTLS/i.test(ehlo)) {
    await cmd('STARTTLS', [220]);
    sock.removeListener('data', onData);
    sock = tls.connect({ socket: sock, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== 'false' });
    await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
    attach(sock);
    ehlo = await cmd('EHLO ' + host, [250]);
  }
  if (cfg.user) {
    await cmd('AUTH LOGIN', [334]);
    await cmd(Buffer.from(cfg.user).toString('base64'), [334]);
    await cmd(Buffer.from(cfg.pass || '').toString('base64'), [235]);
  }
  const fromAddr = (cfg.from.match(/<([^>]+)>/) || [null, cfg.from])[1];
  await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
  await cmd(`RCPT TO:<${to}>`, [250, 251]);
  await cmd('DATA', [354]);
  const enc = (s) => '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const msg = [
    `From: ${cfg.from}`, `To: <${to}>`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${host}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body, '.',
  ].join('\r\n');
  await cmd(msg, [250]);
  try { await cmd('QUIT'); } catch { /* egal */ }
  sock.end();
}
