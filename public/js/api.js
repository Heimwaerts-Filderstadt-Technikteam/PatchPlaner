// API-Client
export class ApiError extends Error { constructor(status, msg, body) { super(msg); this.status = status; this.body = body; } }
export const clientId = Math.random().toString(36).slice(2, 12);
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function req(method, url, body, opts = {}) {
  const headers = { 'x-pp': '1', 'x-client-id': clientId, ...(opts.headers || {}) };
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', keepalive: opts.keepalive }); }
  catch { throw new ApiError(0, 'Keine Verbindung zum Server. Prüfe dein Netzwerk.'); }
  let data = null;
  const text = await r.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    if (r.status === 401 && onUnauthorized && !opts.noAuthRedirect) onUnauthorized();
    throw new ApiError(r.status, (data && data.error) || `Fehler ${r.status}`, data);
  }
  return data;
}
export const api = {
  get: (u, o) => req('GET', u, undefined, o),
  post: (u, b, o) => req('POST', u, b ?? {}, o),
  put: (u, b, o) => req('PUT', u, b ?? {}, o),
  del: (u, b, o) => req('DELETE', u, b, o),
  upload: (u, file, mime, filename, meta) => req('POST', u, file, { headers: { 'content-type': mime, 'x-filename': encodeURIComponent(filename || 'datei'), ...(meta ? { 'x-meta': encodeURIComponent(JSON.stringify(meta)) } : {}) } }),
};
