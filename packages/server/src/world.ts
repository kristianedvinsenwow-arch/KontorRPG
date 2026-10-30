/**
 * The authoritative world. Owns every player's accepted position and decides who sees whom.
 * It never touches sockets directly: each player has a `send` function, so tests can drive the
 * world without a network and the transport can change later without touching game rules.
 */
import {
  CHUNK_SIZE, AOI_CHUNKS, MAX_CHAT_LEN, MAX_NAME_LEN, PLAYER_COLORS, PROTOCOL_VERSION, TICK_HZ,
  checkStep, heightAt, r2, r3, validateBuild, derive, maxSpeed,
  type CharacterBuild,
  type ClientMsg, type PlayerState, type ServerMsg,
} from '@kontor/shared';

import type { CharacterStore, StoredCharacter } from './persistence.js';

export interface Client {
  send(msg: ServerMsg): void;
  close(reason: string): void;
}

interface ServerPlayer {
  state: PlayerState;
  client: Client;
  /** Last position the server accepted, and when. Every new step is checked against it. */
  lastValid: { x: number; y: number; z: number; at: number };
  lastSeq: number;
  strikes: number;
  lastChatAt: number;
  actUntil: number;
  build: CharacterBuild;
  /** Fastest this character may move, from perks (e.g. Pack Mule −10%, Small Frame +10%). */
  speedCap: number;
  /** Account id when logged in; null for guests (nothing is saved). */
  userId: string | null;
  savedAt: number;
}

export interface WorldOptions {
  build: string;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** Where characters are kept. Without one, everyone plays as a guest. */
  store?: CharacterStore;
  /** When true, a valid login token is required to join. */
  requireLogin?: boolean;
}

let nextId = 1;

export class World {
  readonly players = new Map<string, ServerPlayer>();
  private pending = new Map<Client, true>();
  tick = 0;
  private readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;

  constructor(private readonly opts: WorldOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** A socket connected; it becomes a player after a valid hello. */
  connect(client: Client): void {
    this.pending.set(client, true);
  }

  disconnect(client: Client): void {
    this.pending.delete(client);
    for (const [id, p] of this.players) {
      if (p.client === client) {
        this.players.delete(id);
        void this.save(p);
        this.broadcast({ t: 'leave', id });
        this.broadcast({ t: 'system', text: `${p.state.name} logged out` });
        this.broadcastRoster();
        this.log(`leave ${p.state.name} (${id}); online ${this.players.size}`);
      }
    }
  }

  /** Returns a promise only for hello with a store (login + database lookups); everything else is synchronous. */
  handle(client: Client, msg: ClientMsg): void | Promise<void> {
    if (msg.t === 'ping') return client.send({ t: 'pong', at: msg.at });
    if (msg.t === 'hello') return this.hello(client, msg);
    const p = this.byClient(client);
    if (!p) return; // inputs before hello are ignored
    if (msg.t === 'input') return this.input(p, msg);
    if (msg.t === 'chat') return this.chat(p, msg.text);
  }

  private byClient(client: Client): ServerPlayer | undefined {
    for (const p of this.players.values()) if (p.client === client) return p;
    return undefined;
  }

  private hello(client: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void | Promise<void> {
    if (!this.pending.has(client)) return; // only one hello per connection
    const reject = (reason: string) => { client.send({ t: 'reject', reason }); client.close(reason.split(':')[0]); };
    if (msg.proto !== PROTOCOL_VERSION) return reject('outdated_client');
    this.pending.delete(client);
    const store = this.opts.store;
    if (!store || (!msg.token && !this.opts.requireLogin)) {
      // Guest: nothing is saved.
      const bad = validateBuild(msg.build);
      if (bad) return reject(`invalid_character:${bad}`);
      this.join(client, { name: sanitizeName(msg.name), color: msg.color, build: msg.build, pos: null, userId: null }, false);
      return;
    }
    return (async () => {
      const userId = msg.token ? await store.verify(msg.token) : null;
      if (!userId) return reject('login_required');
      let saved = await store.load(userId);
      const isNew = !saved;
      if (!saved) {
        // First login: the character from the creator becomes the saved one.
        const bad = validateBuild(msg.build);
        if (bad) return reject(`invalid_character:${bad}`);
        saved = { userId, name: sanitizeName(msg.name), color: Math.abs(Math.floor(msg.color)) % PLAYER_COLORS.length, build: msg.build, pos: null, gold: 0 };
        await store.create(saved);
      }
      // Same account in a second tab or on another computer: the newest session wins.
      for (const p of this.players.values()) {
        if (p.userId === userId) { p.client.send({ t: 'system', text: 'You logged in somewhere else.' }); p.client.close('replaced'); this.disconnect(p.client); }
      }
      this.join(client, { ...saved, userId }, !isNew);
    })().catch((e) => { this.log('login failed', e); reject('server_error'); });
  }

  private join(client: Client, c: Omit<StoredCharacter, 'gold' | 'userId'> & { userId: string | null }, wasSaved: boolean): void {
    const build = c.build;
    const id = `p${nextId++}`;
    const name = c.name;
    const color = Math.abs(Math.floor(c.color)) % PLAYER_COLORS.length;
    let x: number, z: number, yaw: number;
    if (c.pos && checkStep(c.pos, c.pos, 0.1).ok) {
      x = c.pos.x; z = c.pos.z; yaw = c.pos.yaw; // back where you logged out
    } else {
      // Spawn in the clearing, spread out a little so players don't stack.
      const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 5;
      x = Math.cos(a) * d; z = Math.sin(a) * d; yaw = -a + Math.PI / 2;
    }
    const y = heightAt(x, z);
    const state: PlayerState = { id, name, color, race: build.race, x: r2(x), y: r2(y), z: r2(z), yaw: r3(yaw), pitch: 0, spd: 0 };
    const now = this.now();
    this.players.set(id, { state, client, lastValid: { x, y, z, at: now }, lastSeq: -1, strikes: 0, lastChatAt: 0, actUntil: 0,
      build, speedCap: maxSpeed(1, derive(build).speedBonus), userId: c.userId, savedAt: now });
    client.send({ t: 'welcome', id, build: this.opts.build, proto: PROTOCOL_VERSION, tickHz: TICK_HZ, you: state, character: { name, color, build }, saved: wasSaved });
    this.broadcast({ t: 'system', text: `${name} logged in` });
    this.broadcastRoster();
    this.log(`join ${name} (${id}); online ${this.players.size}`);
  }

  private broadcastRoster(): void {
    const players = [...this.players.values()].map((p) => ({ id: p.state.id, name: p.state.name, color: p.state.color, race: p.state.race }));
    this.broadcast({ t: 'roster', players });
  }

  private input(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'input' }>): void {
    if (msg.seq <= p.lastSeq) return; // stale or replayed packet
    p.lastSeq = msg.seq;
    const now = this.now();
    const dt = (now - p.lastValid.at) / 1000;
    const next = { x: msg.x, y: msg.y, z: msg.z };
    const check = checkStep(p.lastValid, next, dt, p.speedCap);
    if (!check.ok) {
      p.strikes++;
      const lv = p.lastValid;
      p.client.send({ t: 'correct', seq: msg.seq, x: r2(lv.x), y: r2(lv.y), z: r2(lv.z), reason: check.reason ?? 'invalid' });
      if (p.strikes > 40) p.client.close('too_many_invalid_moves');
      return;
    }
    p.strikes = Math.max(0, p.strikes - 1);
    const horiz = Math.hypot(next.x - p.lastValid.x, next.z - p.lastValid.z);
    const spd = dt > 0 ? horiz / Math.max(dt, 0.05) : 0;
    p.lastValid = { ...next, at: now };
    const s = p.state;
    s.x = r2(next.x); s.y = r2(next.y); s.z = r2(next.z);
    s.yaw = r3(msg.yaw);
    s.pitch = r3(Math.max(-1.55, Math.min(1.55, msg.pitch)));
    s.spd = r2(s.spd * 0.4 + spd * 0.6);
    if (msg.act === 'swing') p.actUntil = now + 450;
  }

  private chat(p: ServerPlayer, raw: string): void {
    const now = this.now();
    if (now - p.lastChatAt < 700) return; // simple flood guard
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;
    p.lastChatAt = now;
    this.broadcast({ t: 'chat', from: p.state.id, name: p.state.name, text, at: now });
  }

  /** Called TICK_HZ times a second. Sends every player the others inside their area of interest. */
  step(): void {
    this.tick++;
    const now = this.now();
    const list = [...this.players.values()];
    for (const p of list) {
      // Players who stopped sending input are idle, not moving.
      if (now - p.lastValid.at > 400) p.state.spd = r2(p.state.spd * 0.5);
      p.state.act = now < p.actUntil ? 'swing' : undefined;
    }
    for (const viewer of list) {
      const vcx = chunkOf(viewer.state.x), vcz = chunkOf(viewer.state.z);
      const visible: PlayerState[] = [];
      for (const other of list) {
        if (other === viewer) continue;
        if (Math.abs(chunkOf(other.state.x) - vcx) <= AOI_CHUNKS && Math.abs(chunkOf(other.state.z) - vcz) <= AOI_CHUNKS) {
          visible.push(other.state);
        }
      }
      viewer.client.send({ t: 'snap', tick: this.tick, at: now, players: visible });
    }
  }

  broadcast(msg: ServerMsg): void {
    for (const p of this.players.values()) p.client.send(msg);
  }

  /** Persist one player's position (logged-in players only). Errors are logged, never thrown. */
  async save(p: ServerPlayer): Promise<void> {
    if (!p.userId || !this.opts.store) return;
    p.savedAt = this.now();
    const s = p.state;
    try { await this.opts.store.savePosition(p.userId, { x: s.x, y: s.y, z: s.z, yaw: s.yaw }); }
    catch (e) { this.log('save failed', p.userId, e); }
  }

  /** Save everyone who moved since their last save. Called every 30 s and on shutdown. */
  async saveAll(): Promise<void> {
    await Promise.all([...this.players.values()].filter((p) => p.lastValid.at > p.savedAt).map((p) => this.save(p)));
  }

  /** On shutdown: tell everyone so clients show "server restarting" instead of an error. */
  async shutdown(): Promise<void> {
    this.broadcast({ t: 'system', text: 'Server restarting — you will reconnect in a moment.' });
    await this.saveAll();
  }
}

export const chunkOf = (v: number) => Math.floor(v / CHUNK_SIZE);

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return s || 'Adventurer';
}
