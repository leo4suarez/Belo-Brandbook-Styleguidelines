// An in-memory stand-in for the Supabase project, served through Playwright routes so the real supabase-js
// (installed as a dev dependency) runs against it: Auth (Google PKCE round trip), the Data API (docs, save_doc,
// can_edit), Storage (assets bucket) and Realtime (postgres_changes on docs, presence) over a mocked WebSocket.
// The rules mirror supabase/migrations: anyone reads, only confirmed @paisanoscreando.com accounts write,
// and save_doc refuses a stale version with PT409.
const crypto = require('crypto');

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

class FakeSupabase {
  constructor(url) {
    this.url = url.replace(/\/+$/, '');
    this.ref = new URL(this.url).hostname.split('.')[0];
    this.users = new Map();      // id -> { id, email, name, confirmed }
    this.revoked = new Set();    // user ids that lost edit rights
    this.docs = new Map();       // path -> { data, version, updated_at, updated_by, updated_by_name }
    this.files = new Map();      // name -> { body, type }
    this.codes = new Map();      // PKCE code -> user id
    this.nextLogin = null;       // user id that "chooses" their Google account on the next sign-in
    this.down = 0;               // the next N Data API writes fail as if the network dropped
    this.uploadBytes = null;     // contents of the file the test is about to upload
    this.sockets = new Set();
    this.held = new Set();       // sockets whose realtime events are held back (simulates a slow connection)
    this.log = [];
  }

  addUser({ id, email, name, confirmed = true }) {
    const u = { id: id || crypto.randomUUID(), email, name, confirmed };
    this.users.set(u.id, u);
    return u;
  }
  isEditor(u) { return !!(u && u.confirmed && !this.revoked.has(u.id) && /@paisanoscreando\.com$/i.test(u.email)); }

  token(u) {
    const now = Math.floor(Date.now() / 1000);
    return b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: now + 86400, iat: now, user_metadata: { full_name: u.name } }) + '.sig';
  }
  userJSON(u) {
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null, user_metadata: { full_name: u.name, name: u.name }, app_metadata: { provider: 'google', providers: ['google'] }, created_at: new Date().toISOString() };
  }
  session(u) {
    const now = Math.floor(Date.now() / 1000);
    return { access_token: this.token(u), token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'refresh-' + u.id, user: this.userJSON(u) };
  }
  storageKey() { return `sb-${this.ref}-auth-token`; }
  // Signs a browser context in, as if Google had already sent the person back.
  async signInContext(ctx, u) {
    const key = this.storageKey(), value = JSON.stringify(this.session(u));
    await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem('fake.seeded')) { localStorage.setItem(k, v); localStorage.setItem('fake.seeded', '1'); } } catch {} }, [key, value]);
  }
  userFrom(headers) {
    const h = headers['authorization'] || '';
    const tok = h.replace(/^Bearer\s+/i, '');
    const parts = tok.split('.');
    if (parts.length !== 3) return null;
    try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return this.users.get(p.sub) || null; } catch { return null; }
  }

  seed(path, data, by) {
    const u = by && this.users.get(by);
    this.docs.set(path, { data, version: 1, updated_at: new Date(Date.now() - 3 * 3600e3).toISOString(), updated_by: u ? u.id : null, updated_by_name: u ? u.name : null });
  }

  // ---------- Data API ----------
  saveDoc(u, { p_path, p_data, p_expected }) {
    if (!this.isEditor(u)) return [403, { code: 'PT403', message: 'forbidden', details: null, hint: null }];
    if (!/^(catalog\/tree|pages\/[A-Za-z0-9_-]{1,64})$/.test(p_path)) return [400, { code: '23514', message: 'new row violates check constraint', details: null, hint: null }];
    const cur = this.docs.get(p_path);
    const conflict = [409, { code: 'PT409', message: 'conflict', details: null, hint: null }];
    if (p_data === null) {
      if (cur && cur.version !== p_expected) return conflict;
      if (cur) { this.docs.delete(p_path); this.emit('DELETE', p_path, cur.version); }
      return [200, { version: 0 }];
    }
    const at = new Date().toISOString();
    let row;
    if (!p_expected) {
      if (cur) return conflict;
      row = { data: p_data, version: 1, updated_at: at, updated_by: u.id, updated_by_name: u.name };
    } else {
      if (!cur || cur.version !== p_expected) return conflict;
      row = { data: p_data, version: cur.version + 1, updated_at: at, updated_by: u.id, updated_by_name: u.name };
    }
    this.docs.set(p_path, row);
    this.log.push({ path: p_path, version: row.version, by: u.name });
    this.emit(cur ? 'UPDATE' : 'INSERT', p_path, row.version);
    return [200, { version: row.version, updated_at: row.updated_at, updated_by: row.updated_by, updated_by_name: row.updated_by_name }];
  }

  async handle(route) {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const headers = req.headers();
    const json = (status, body, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    // Auth
    if (p === '/auth/v1/authorize') {
      const to = u.searchParams.get('redirect_to');
      const who = this.users.get(this.nextLogin);
      if (!who) return route.fulfill({ status: 302, headers: { location: to + '?error=access_denied&error_description=cancelled' } });
      const code = crypto.randomUUID();
      this.codes.set(code, who.id);
      return route.fulfill({ status: 302, headers: { location: to + (to.includes('?') ? '&' : '?') + 'code=' + code } });
    }
    if (p === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}');
      const grant = u.searchParams.get('grant_type');
      let who = null;
      if (grant === 'pkce') { who = this.users.get(this.codes.get(body.auth_code)); this.codes.delete(body.auth_code); }
      if (grant === 'refresh_token') who = this.users.get(String(body.refresh_token || '').replace('refresh-', ''));
      if (!who) return json(400, { error: 'invalid_grant', error_description: 'Invalid code' });
      return json(200, this.session(who));
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (p === '/auth/v1/user') { const who = this.userFrom(headers); return who ? json(200, this.userJSON(who)) : json(401, { message: 'invalid' }); }

    // Data API
    if (p === '/rest/v1/docs' && req.method() === 'GET') {
      const want = (u.searchParams.get('path') || '').replace(/^eq\./, '');
      const row = this.docs.get(want);
      const out = row ? [{ data: row.data, version: row.version, updated_at: row.updated_at, updated_by: row.updated_by, updated_by_name: row.updated_by_name }] : [];
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return out.length ? json(200, out[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, out);
    }
    if (p === '/rest/v1/rpc/can_edit') return json(200, this.isEditor(this.userFrom(headers)));
    if (p === '/rest/v1/rpc/save_doc') {
      if (this.down > 0) { this.down--; return route.abort('connectionreset'); }
      const [status, body] = this.saveDoc(this.userFrom(headers), JSON.parse(req.postData() || '{}'));
      return json(status, body);
    }

    // Storage
    const pub = /^\/storage\/v1\/object\/public\/assets\/(.+)$/.exec(p);
    if (pub && req.method() === 'GET') {
      const f = this.files.get(decodeURIComponent(pub[1]));
      return f ? route.fulfill({ status: 200, contentType: f.type, body: f.body, headers: { 'access-control-allow-origin': '*' } }) : route.fulfill({ status: 404, body: 'not found' });
    }
    const up = /^\/storage\/v1\/object\/assets\/(.+)$/.exec(p);
    if (up && req.method() === 'POST') {
      if (!this.isEditor(this.userFrom(headers))) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const name = decodeURIComponent(up[1]);
      if (this.files.has(name)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      const f = fileFrom(req);
      // Chromium does not hand File contents to request interception, so the test supplies the bytes it uploads.
      this.files.set(name, { body: f.body.length ? f.body : (this.uploadBytes || f.body), type: f.type });
      return json(200, { Key: 'assets/' + name, Id: crypto.randomUUID() });
    }
    if (p === '/storage/v1/object/assets' && req.method() === 'DELETE') {
      if (!this.isEditor(this.userFrom(headers))) return json(200, []);
      const { prefixes = [] } = JSON.parse(req.postData() || '{}');
      const gone = prefixes.filter(n => this.files.delete(n)).map(name => ({ name }));
      return json(200, gone);
    }
    return json(404, { message: 'fake supabase: no route for ' + req.method() + ' ' + p });
  }

  // ---------- Realtime ----------
  socket(ws, label) {
    const conn = { ws, label, channels: new Map(), queue: [] };
    this.sockets.add(conn);
    const send = (m) => { try { ws.send(JSON.stringify(m)); } catch {} };
    conn.send = send;
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      const [joinRef, ref, topic, event, payload] = m;
      const reply = (response = {}, status = 'ok') => send([joinRef, ref, topic, 'phx_reply', { status, response }]);
      if (topic === 'phoenix' && event === 'heartbeat') return reply();
      if (event === 'phx_join') {
        const cfg = (payload && payload.config) || {};
        const pg = (cfg.postgres_changes || []).map((b, i) => ({ id: 1000 + i, event: b.event, schema: b.schema, table: b.table, filter: b.filter }));
        const ch = { joinRef, topic, pg, presenceKey: cfg.presence && cfg.presence.key, meta: null };
        conn.channels.set(topic, ch);
        reply(pg.length ? { postgres_changes: pg } : {});
        if (cfg.presence && cfg.presence.enabled) send([joinRef, null, topic, 'presence_state', this.presenceState(topic)]);
        return;
      }
      if (event === 'phx_leave') { this.leave(conn, topic); return reply(); }
      if (event === 'access_token') return reply();
      if (event === 'presence' && payload && payload.event === 'track') {
        const ch = conn.channels.get(topic); if (!ch) return reply({}, 'error');
        const before = ch.meta;
        ch.meta = { ...payload.payload, phx_ref: crypto.randomUUID() };
        reply();
        this.presenceBroadcast(topic, { joins: { [ch.presenceKey]: { metas: [ch.meta] } }, leaves: before ? { [ch.presenceKey]: { metas: [before] } } : {} });
        return;
      }
      reply();
    });
    ws.onClose(() => { [...conn.channels.keys()].forEach(t => this.leave(conn, t)); this.sockets.delete(conn); this.held.delete(conn); });
  }
  leave(conn, topic) {
    const ch = conn.channels.get(topic); if (!ch) return;
    conn.channels.delete(topic);
    if (ch.meta) this.presenceBroadcast(topic, { joins: {}, leaves: { [ch.presenceKey]: { metas: [ch.meta] } } });
  }
  presenceState(topic) {
    const out = {};
    this.sockets.forEach(c => { const ch = c.channels.get(topic); if (ch && ch.meta) out[ch.presenceKey] = { metas: [ch.meta] }; });
    return out;
  }
  presenceBroadcast(topic, diff) {
    this.sockets.forEach(c => { const ch = c.channels.get(topic); if (ch) c.send([ch.joinRef, null, topic, 'presence_diff', diff]); });
  }
  emit(type, path, version) {
    const data = { schema: 'public', table: 'docs', commit_timestamp: new Date().toISOString(), type, errors: null,
      columns: [{ name: 'path', type: 'text' }, { name: 'version', type: 'int4' }],
      record: type === 'DELETE' ? {} : { path, version }, old_record: { path } };
    this.sockets.forEach(c => c.channels.forEach(ch => {
      const b = ch.pg.find(x => x.table === 'docs' && (x.event === '*' || x.event === type));
      if (!b) return;
      const msg = [ch.joinRef, null, ch.topic, 'postgres_changes', { ids: [b.id], data }];
      if (this.held.has(c)) c.queue.push(msg); else c.send(msg);
    }));
  }
  // Holds back live updates for one browser context, as if its connection were slow.
  hold(label) { this.sockets.forEach(c => { if (c.label === label) this.held.add(c); }); }
  release() { this.held.forEach(c => { c.queue.splice(0).forEach(m => c.send(m)); }); this.held.clear(); }

  async attach(ctx, label) {
    await ctx.route(this.url + '/**', (r) => this.handle(r));
    await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => this.socket(ws, label));
  }
}

// Storage uploads arrive as multipart form data (cacheControl + the file) or as a raw body.
function fileFrom(req) {
  const type = req.headers()['content-type'] || '';
  const buf = req.postDataBuffer() || Buffer.alloc(0);
  const m = /boundary=(.+)$/.exec(type);
  if (!m) return { body: buf, type: type || 'application/octet-stream' };
  const boundary = Buffer.from('--' + m[1]);
  let start = 0, out = null;
  while (true) {
    const i = buf.indexOf(boundary, start); if (i < 0) break;
    const j = buf.indexOf(boundary, i + boundary.length); if (j < 0) break;
    const part = buf.subarray(i + boundary.length + 2, j - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, sep).toString();
    if (/filename=|content-type:/i.test(head) && !/name="cacheControl"/.test(head)) {
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      out = { body: part.subarray(sep + 4), type: ct ? ct[1].trim() : 'application/octet-stream' };
    }
    start = j;
  }
  return out || { body: buf, type: 'application/octet-stream' };
}

module.exports = { FakeSupabase };
