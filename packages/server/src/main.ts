/**
 * KontorRPG server entry. One process serves the built client, a /version endpoint for the
 * client's deploy check, /health for Render, and the game WebSocket on /ws.
 */
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_HZ, decodeClient, encode, type ServerMsg } from '@kontor/shared';
import { World, type Client } from './world.js';
import { MemoryStore, SupabaseStore, type CharacterStore } from './persistence.js';
import { Accounts } from './accounts.js';
import { createHash } from 'node:crypto';
import { serveStatic } from './static.js';

const PORT = Number(process.env.PORT ?? 8787);
/** Render sets RENDER_GIT_COMMIT on every deploy; locally we fall back to the start time. */
const BUILD = (process.env.RENDER_GIT_COMMIT ?? `dev-${Date.now().toString(36)}`).slice(0, 12);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = process.env.CLIENT_DIST ?? resolve(here, '../../client/dist');

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Accounts and storage: on when the three Supabase variables are set (see README), otherwise
// everyone plays as a guest and nothing is saved.
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const supa = SUPABASE_URL && SUPABASE_SECRET_KEY ? new SupabaseStore(SUPABASE_URL, SUPABASE_SECRET_KEY) : undefined;
// Local testing: DEV_ACCOUNTS=memory gives working accounts and saves that last until restart.
const mem = !supa && process.env.DEV_ACCOUNTS === 'memory' ? new MemoryStore() : undefined;
const store: CharacterStore | undefined = supa ?? mem;
// Login tokens are signed with a key derived from the server secret (never sent anywhere).
const accounts = store ? new Accounts(store, createHash('sha256').update(`kontor-session:${process.env.SESSION_SECRET ?? (SUPABASE_SECRET_KEY || 'dev')}`).digest('hex')) : null;
if (supa) supa.auth = accounts;
if (mem) mem.auth = accounts;
/** Guests are allowed unless REQUIRE_LOGIN=true (recommended once everyone has an account). */
const requireLogin = !!store && process.env.REQUIRE_LOGIN === 'true';
const world = new World({ build: BUILD, log, store, requireLogin });
void world.loadLeases().catch((e) => log('could not load inn leases', e));
void world.loadWorld().catch((e) => log('could not load world state', e));
const statics = serveStatic(CLIENT_DIST);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: world.players.size, tick: world.tick }));
    return;
  }
  if (path === '/config') {
    // Public client configuration: are accounts on, and is a login required?
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ accounts: !!store, requireLogin }));
    return;
  }
  if (path === '/version') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ v: BUILD }));
    return;
  }
  if (path === '/api/login' && req.method === 'POST') { void login(req, res); return; }
  if (path === '/api/reset' && req.method === 'POST') { void reset(req, res); return; }
  if (statics(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

/** POST /api/login {user, pin, create}: username + PIN → login token and the saved character, if any. */
async function login(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!accounts || !store) return reply(404, { error: 'Accounts are off on this server.' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) return reply(413, { error: 'Too long.' }); }
  let b: { user?: unknown; pin?: unknown; create?: unknown };
  try { b = JSON.parse(raw); } catch { return reply(400, { error: 'Bad request.' }); }
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  try {
    const r = await accounts.login(String(b.user ?? ''), String(b.pin ?? ''), b.create === true, ip);
    if ('error' in r) return reply(r.error.startsWith('Too many') ? 429 : 400, r);
    const c = await store.load(r.accountId);
    log(`${b.create ? 'new account' : 'login'} ${r.username}`);
    reply(200, { token: r.token, username: r.username, character: c ? { name: c.name, color: c.color, build: c.build, gold: c.gold, equip: c.equip, xp: c.xp, title: c.achievements?.title ?? null } : null });
  } catch (e) {
    log('login failed', e);
    reply(500, { error: 'Something went wrong. Try again.' });
  }
}

/** POST /api/reset {token, user, pin}: delete your character (after the PIN again) so you can make a new one. */
async function reset(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!accounts || !store) return reply(404, { error: 'Accounts are off on this server.' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) return reply(413, { error: 'Too long.' }); }
  let b: { token?: unknown; user?: unknown; pin?: unknown };
  try { b = JSON.parse(raw); } catch { return reply(400, { error: 'Bad request.' }); }
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  try {
    const r = await accounts.confirm(String(b.token ?? ''), String(b.user ?? ''), String(b.pin ?? ''), ip);
    if ('error' in r) return reply(r.error.startsWith('Too many') ? 429 : 400, r);
    world.forget(r.accountId);
    await store.remove(r.accountId);
    log(`character reset for ${String(b.user)}`);
    reply(200, { ok: true });
  } catch (e) {
    log('reset failed', e);
    reply(500, { error: 'Something went wrong. Try again.' });
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  const client: Client = {
    send: (msg: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(encode(msg)); },
    close: (reason: string) => ws.close(4000, reason),
  };
  world.connect(client);
  // Per-connection rate limit: a well-behaved client sends ~12 messages/s.
  let budget = 40;
  const refill = setInterval(() => (budget = Math.min(40, budget + 20)), 1000);
  ws.on('message', (data) => {
    if (--budget < 0) return;
    const msg = decodeClient(data.toString());
    if (msg) void world.handle(client, msg);
  });
  ws.on('close', () => { clearInterval(refill); world.disconnect(client); });
  ws.on('error', () => ws.terminate());
});

// Drop dead sockets (laptop lid closed, Wi-Fi gone) so their character doesn't linger.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
    if (ws.alive === false) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

const tick = setInterval(() => world.step(), 1000 / TICK_HZ);
const autosave = setInterval(() => void world.saveAll(), 30_000);
const worldSave = setInterval(() => void world.saveWorld(), 60_000);

server.listen(PORT, () => log(`KontorRPG server ${BUILD} on :${PORT} (client from ${CLIENT_DIST}); accounts: ${supa ? 'Supabase' : mem ? 'memory (dev)' : 'off (guests only)'}`));

function shutdown(signal: string) {
  log(`${signal}: shutting down`);
  clearInterval(tick);
  clearInterval(heartbeat);
  clearInterval(autosave);
  clearInterval(worldSave);
  void world.shutdown().finally(() => {
    for (const ws of wss.clients) ws.close(1012, 'restart');
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
