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
import { SupabaseStore, type CharacterStore } from './persistence.js';
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
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const store: CharacterStore | undefined = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY
  ? new SupabaseStore(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY) : undefined;
/** Guests are allowed unless REQUIRE_LOGIN=true (recommended once everyone has an account). */
const requireLogin = !!store && process.env.REQUIRE_LOGIN === 'true';
const world = new World({ build: BUILD, log, store, requireLogin });
void world.loadLeases().catch((e) => log('could not load inn leases', e));
const statics = serveStatic(CLIENT_DIST);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: world.players.size, tick: world.tick }));
    return;
  }
  if (path === '/config') {
    // Public client configuration. The publishable key is safe to expose; the secret key never leaves the server.
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ accounts: !!store, requireLogin, supabaseUrl: store ? SUPABASE_URL : null, supabaseKey: store ? SUPABASE_PUBLISHABLE_KEY : null }));
    return;
  }
  if (path === '/version') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ v: BUILD }));
    return;
  }
  if (statics(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

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

server.listen(PORT, () => log(`KontorRPG server ${BUILD} on :${PORT} (client from ${CLIENT_DIST}); accounts: ${store ? 'Supabase' : 'off (guests only)'}`));

function shutdown(signal: string) {
  log(`${signal}: shutting down`);
  clearInterval(tick);
  clearInterval(heartbeat);
  clearInterval(autosave);
  void world.shutdown().finally(() => {
    for (const ws of wss.clients) ws.close(1012, 'restart');
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
