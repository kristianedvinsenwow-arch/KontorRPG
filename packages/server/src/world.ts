/**
 * The authoritative world. Owns every player's accepted position, bag, equipment, gold and skills,
 * the state of every ore vein, and crafting queues. It never touches sockets directly: each player
 * has a `send` function, so tests can drive the world without a network.
 *
 * Everything a client asks for (mine this vein, craft this, buy that) is a request; the server
 * checks distance, levels, tools, cooldowns and bag space, rolls any random drops itself, and
 * replies with the new state.
 */
import {
  CHUNK_SIZE, AOI_CHUNKS, MAX_CHAT_LEN, MAX_NAME_LEN, PLAYER_COLORS, PROTOCOL_VERSION, TICK_HZ,
  ITEMS, RECIPE_BY_ID, START_GOLD, STATIONS, TRADING_POST, USE_RANGE, MINE_RANGE, VEIN_BY_ID, VEIN_TYPES, VEINS,
  addItem, bagCapacity, faceOf, checkStep, countItem, derive, emptyBag, heightAt, levelFromXp, maxSpeed, r2, r3,
  removeItem, resizeBag, roomFor, swingSeconds, validateBuild,
  type Bag, type CharacterBuild, type ClientMsg, type Equipment, type PlayerState, type ServerMsg, type SkillId, type Slot,
} from '@kontor/shared';

import type { CharacterStore, StoredCharacter } from './persistence.js';

export interface Client {
  send(msg: ServerMsg): void;
  close(reason: string): void;
}

interface CraftJob { recipe: string; total: number; done: number; nextAt: number }

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
  /** Bag, equipment, gold and skill XP — the things worth saving. */
  bag: Bag;
  equip: Equipment;
  gold: number;
  xp: Partial<Record<SkillId, number>>;
  dirty: boolean;
  lastMineAt: number;
  job: CraftJob | null;
}

export interface WorldOptions {
  build: string;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** Where characters are kept. Without one, everyone plays as a guest. */
  store?: CharacterStore;
  /** When true, a valid login token is required to join. */
  requireLogin?: boolean;
  /** Random source for drops; injectable so tests are deterministic. */
  random?: () => number;
}

type Joining = Pick<StoredCharacter, 'name' | 'color' | 'build' | 'pos'> & Partial<Pick<StoredCharacter, 'bag' | 'equip' | 'gold' | 'xp'>> & { userId: string | null };

let nextId = 1;

export class World {
  readonly players = new Map<string, ServerPlayer>();
  /** Veins being mined or depleted: swings left, and when a depleted vein comes back. */
  readonly veins = new Map<string, { left: number; until: number }>();
  private pending = new Map<Client, true>();
  tick = 0;
  private readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;
  private readonly rand: () => number;

  constructor(private readonly opts: WorldOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.rand = opts.random ?? Math.random;
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
    switch (msg.t) {
      case 'input': return this.input(p, msg);
      case 'chat': return this.chat(p, msg.text);
      case 'mine': return this.mine(p, msg.node);
      case 'craft': return this.craft(p, msg.recipe, msg.count);
      case 'cancelCraft': p.job = null; return this.sendJob(p);
      case 'equip': return this.equipFromBag(p, msg.index);
      case 'unequip': return this.unequip(p, msg.slot);
      case 'buy': return this.buy(p, msg.item);
      case 'sell': return this.sell(p, msg.index, msg.qty);
    }
  }

  private byClient(client: Client): ServerPlayer | undefined {
    for (const p of this.players.values()) if (p.client === client) return p;
    return undefined;
  }

  // ---------------------------------------------------------------- joining

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
        const build = msg.build;
        saved = {
          userId, name: sanitizeName(msg.name), color: Math.abs(Math.floor(msg.color)) % PLAYER_COLORS.length, build, pos: null,
          gold: START_GOLD, bag: emptyBag(bagCapacity(derive(build).bagBonus, {})), equip: {}, xp: {},
        };
        await store.create(saved);
      }
      // Same account in a second tab or on another computer: the newest session wins.
      for (const p of this.players.values()) {
        if (p.userId === userId) { p.client.send({ t: 'system', text: 'You logged in somewhere else.' }); p.client.close('replaced'); this.disconnect(p.client); }
      }
      this.join(client, { ...saved, userId }, !isNew);
    })().catch((e) => { this.log('login failed', e); reject('server_error'); });
  }

  private join(client: Client, c: Joining, wasSaved: boolean): void {
    const build = c.build;
    const id = `p${nextId++}`;
    const name = c.name;
    const color = Math.abs(Math.floor(c.color)) % PLAYER_COLORS.length;
    let x: number, z: number, yaw: number;
    if (c.pos && checkStep(c.pos, c.pos, 0.1).ok) {
      x = c.pos.x; z = c.pos.z; yaw = c.pos.yaw; // back where you logged out
    } else {
      // Spawn in the camp clearing, spread out a little so players don't stack.
      const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 4;
      x = Math.cos(a) * d; z = Math.sin(a) * d; yaw = -a + Math.PI / 2;
    }
    const y = heightAt(x, z);
    const equip = c.equip ?? {};
    const cap = bagCapacity(derive(build).bagBonus, equip);
    const bag = resizeBag(c.bag ?? [], cap) ?? (c.bag ?? emptyBag(cap)); // never lose items if rules changed
    const state: PlayerState = { id, name, color, race: build.race, face: faceOf(build), x: r2(x), y: r2(y), z: r2(z), yaw: r3(yaw), pitch: 0, spd: 0, gear: gearOf(equip) };
    const now = this.now();
    const p: ServerPlayer = {
      state, client, lastValid: { x, y, z, at: now }, lastSeq: -1, strikes: 0, lastChatAt: 0, actUntil: 0,
      build, speedCap: maxSpeed(1, derive(build).speedBonus), userId: c.userId, savedAt: now,
      bag, equip, gold: c.gold ?? START_GOLD, xp: c.xp ?? {}, dirty: false, lastMineAt: 0, job: null,
    };
    this.players.set(id, p);
    client.send({ t: 'welcome', id, build: this.opts.build, proto: PROTOCOL_VERSION, tickHz: TICK_HZ, you: state, character: { name, color, build }, saved: wasSaved });
    this.sendInv(p);
    client.send({ t: 'skills', xp: p.xp });
    client.send({ t: 'nodes', depleted: this.depletedList(now) });
    if (!wasSaved && !p.equip.tool) client.send({ t: 'notice', kind: 'info', text: 'Welcome! Buy your first pickaxe at the trading post by the camp (press E there).' });
    this.broadcast({ t: 'system', text: `${name} logged in` });
    this.broadcastRoster();
    this.log(`join ${name} (${id}); online ${this.players.size}`);
  }

  private broadcastRoster(): void {
    const players = [...this.players.values()].map((p) => ({ id: p.state.id, name: p.state.name, color: p.state.color, race: p.state.race, face: p.state.face }));
    this.broadcast({ t: 'roster', players });
  }

  // ---------------------------------------------------------------- movement & chat

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

  // ---------------------------------------------------------------- mining

  private mine(p: ServerPlayer, nodeId: string): void {
    const vein = VEIN_BY_ID.get(nodeId);
    if (!vein) return;
    const type = VEIN_TYPES[vein.type];
    const now = this.now();
    const err = (text: string) => p.client.send({ t: 'notice', kind: 'error', text });
    if (Math.hypot(p.state.x - vein.x, p.state.z - vein.z) > MINE_RANGE + vein.r + 0.5 || Math.abs(p.state.y - vein.y) > 3) return err('Too far away.');
    const tool = p.equip.tool ? ITEMS[p.equip.tool] : null;
    if (!tool?.toolPower) return err('You need a pickaxe. The trading post at camp sells one.');
    if (tool.toolPower < type.power) return err(`You need a stronger pickaxe for ${type.name.toLowerCase()}s.`);
    const mining = levelFromXp(p.xp.mining ?? 0);
    if (mining < type.level) return err(`${type.name}s need Mining ${type.level} (you have ${mining}).`);
    // Swing cooldown, with a little slack for network jitter.
    const swing = swingSeconds(tool.swingSec ?? 2.6, mining, derive(p.build).miningSpeed) * 1000;
    if (now - p.lastMineAt < swing * 0.8) return;
    const st = this.veins.get(nodeId) ?? { left: 0, until: 0 };
    if (st.until > now) return err('This vein is depleted.');
    if (roomFor(p.bag, type.item) < 1) return err('Your bag is full.');
    p.lastMineAt = now;
    p.actUntil = now + 450;
    if (st.left <= 0) st.left = type.swings[0] + Math.floor(this.rand() * (type.swings[1] - type.swings[0] + 1));
    st.left--;
    addItem(p.bag, type.item, 1);
    this.addXp(p, 'mining', type.xp);
    p.client.send({ t: 'gain', skill: 'mining', xp: type.xp, item: type.item, qty: 1 });
    if (this.rand() < type.gem.chance && roomFor(p.bag, type.gem.item) > 0) {
      addItem(p.bag, type.gem.item, 1);
      p.client.send({ t: 'gain', item: type.gem.item, qty: 1, rare: true });
      this.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} found ${ITEMS[type.gem.item].name}!` });
    }
    if (st.left <= 0) {
      // Shared depletion: empty for everyone until it respawns.
      const [lo, hi] = type.respawnSec;
      st.until = now + (lo + this.rand() * (hi - lo)) * 1000;
      this.broadcast({ t: 'nodes', depleted: [[nodeId, 1]] });
    }
    this.veins.set(nodeId, st);
    p.dirty = true;
    this.sendInv(p);
  }

  private depletedList(now: number): [string, 0 | 1][] {
    const out: [string, 0 | 1][] = [];
    for (const [id, st] of this.veins) if (st.until > now) out.push([id, 1]);
    return out;
  }

  private addXp(p: ServerPlayer, skill: SkillId, amount: number): void {
    const before = levelFromXp(p.xp[skill] ?? 0);
    p.xp[skill] = (p.xp[skill] ?? 0) + amount;
    const after = levelFromXp(p.xp[skill]!);
    p.client.send({ t: 'skills', xp: p.xp });
    if (after > before) {
      const name = skill[0].toUpperCase() + skill.slice(1);
      p.client.send({ t: 'notice', kind: 'info', text: `${name} level ${after}!` });
      if (after % 5 === 0) this.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} reached ${name} ${after}.` });
    }
  }

  // ---------------------------------------------------------------- crafting

  private near(p: ServerPlayer, place: { x: number; z: number }, extra = 0): boolean {
    return Math.hypot(p.state.x - place.x, p.state.z - place.z) <= USE_RANGE + extra;
  }

  private craft(p: ServerPlayer, recipeId: string, count: number): void {
    const r = RECIPE_BY_ID.get(recipeId);
    if (!r) return;
    const err = (text: string) => p.client.send({ t: 'notice', kind: 'error', text });
    if (!this.near(p, STATIONS[r.station])) return err(`Stand next to the ${STATIONS[r.station].name.toLowerCase()}.`);
    const lvl = levelFromXp(p.xp.smithing ?? 0);
    if (lvl < r.level) return err(`Needs Smithing ${r.level} (you have ${lvl}).`);
    if (!r.inputs.every((i) => countItem(p.bag, i.item) >= i.qty)) return err('You don’t have the materials.');
    p.job = { recipe: r.id, total: count, done: 0, nextAt: this.now() + r.seconds * 1000 };
    this.sendJob(p);
  }

  /** Make the next item of a queued job, if it's due. */
  private stepCraft(p: ServerPlayer, now: number): void {
    const job = p.job;
    if (!job || now < job.nextAt) return;
    const r = RECIPE_BY_ID.get(job.recipe)!;
    const stop = (text: string) => { p.job = null; this.sendJob(p); p.client.send({ t: 'notice', kind: 'info', text }); };
    if (!this.near(p, STATIONS[r.station], 1.5)) return stop(`You walked away from the ${STATIONS[r.station].name.toLowerCase()}.`);
    if (!r.inputs.every((i) => countItem(p.bag, i.item) >= i.qty)) return stop(`Out of materials after ${job.done}.`);
    const trial = p.bag.map((s) => (s ? { ...s } : null));
    for (const i of r.inputs) removeItem(trial, i.item, i.qty);
    if (addItem(trial, r.output.item, r.output.qty) > 0) return stop('Your bag is full.');
    p.bag = trial;
    p.actUntil = now + 450;
    this.addXp(p, 'smithing', r.xp);
    p.client.send({ t: 'gain', skill: 'smithing', xp: r.xp, item: r.output.item, qty: r.output.qty });
    job.done++;
    p.dirty = true;
    this.sendInv(p);
    if (job.done >= job.total) { p.job = null; this.sendJob(p); return; }
    job.nextAt = now + r.seconds * 1000;
    this.sendJob(p);
  }

  private sendJob(p: ServerPlayer): void {
    const j = p.job;
    p.client.send(j
      ? { t: 'job', recipe: j.recipe, done: j.done, total: j.total, seconds: Math.max(0, (j.nextAt - this.now()) / 1000) }
      : { t: 'job', recipe: null, done: 0, total: 0, seconds: 0 });
  }

  // ---------------------------------------------------------------- equipment & trading

  private capacity(p: ServerPlayer, equip = p.equip): number {
    return bagCapacity(derive(p.build).bagBonus, equip);
  }

  private equipFromBag(p: ServerPlayer, index: number): void {
    const s = p.bag[index];
    if (!s) return;
    const def = ITEMS[s.id];
    if (!def?.slot) return;
    const err = (text: string) => p.client.send({ t: 'notice', kind: 'error', text });
    const nextEquip: Equipment = { ...p.equip, [def.slot]: s.id };
    const bag = p.bag.map((x) => (x ? { ...x } : null));
    bag[index] = p.equip[def.slot] ? { id: p.equip[def.slot]!, qty: 1 } : null; // swap with what was worn
    const resized = resizeBag(bag, this.capacity(p, nextEquip));
    if (!resized) return err('Empty a few bag slots first — the smaller bag can’t hold everything.');
    p.bag = resized;
    p.equip = nextEquip;
    this.afterEquip(p);
  }

  private unequip(p: ServerPlayer, slot: Slot): void {
    const id = p.equip[slot];
    if (!id) return;
    const nextEquip: Equipment = { ...p.equip };
    delete nextEquip[slot];
    const resized = resizeBag(p.bag, this.capacity(p, nextEquip));
    if (!resized || addItem(resized, id, 1) > 0) return p.client.send({ t: 'notice', kind: 'error', text: 'No room in your bag.' });
    p.bag = resized;
    p.equip = nextEquip;
    this.afterEquip(p);
  }

  private afterEquip(p: ServerPlayer): void {
    p.state.gear = gearOf(p.equip);
    p.dirty = true;
    this.sendInv(p);
  }

  private buy(p: ServerPlayer, itemId: string): void {
    const def = ITEMS[itemId];
    const err = (text: string) => p.client.send({ t: 'notice', kind: 'error', text });
    if (!def?.buyPrice || !TRADING_POST.sells.includes(itemId)) return;
    if (!this.near(p, TRADING_POST)) return err('Stand at the trading post to buy.');
    if (p.gold < def.buyPrice) return err(`Not enough gold (${def.buyPrice} needed).`);
    if (roomFor(p.bag, itemId) < 1) return err('Your bag is full.');
    p.gold -= def.buyPrice;
    addItem(p.bag, itemId, 1);
    p.dirty = true;
    p.client.send({ t: 'gain', item: itemId, qty: 1 });
    this.sendInv(p);
  }

  private sell(p: ServerPlayer, index: number, qty: number): void {
    const s = p.bag[index];
    if (!s) return;
    const def = ITEMS[s.id];
    const err = (text: string) => p.client.send({ t: 'notice', kind: 'error', text });
    if (!this.near(p, TRADING_POST)) return err('Stand at the trading post to sell.');
    if (!def || def.sellValue <= 0) return err('The trader isn’t interested in that.');
    const n = Math.min(qty, s.qty);
    s.qty -= n;
    if (s.qty <= 0) p.bag[index] = null;
    p.gold += n * def.sellValue;
    p.dirty = true;
    this.sendInv(p);
  }

  private sendInv(p: ServerPlayer): void {
    p.client.send({ t: 'inv', bag: p.bag, equip: p.equip, gold: p.gold });
  }

  // ---------------------------------------------------------------- tick

  /** Called TICK_HZ times a second. Crafting, vein respawns, and snapshots inside each area of interest. */
  step(): void {
    this.tick++;
    const now = this.now();
    const list = [...this.players.values()];
    for (const p of list) {
      // Players who stopped sending input are idle, not moving.
      if (now - p.lastValid.at > 400) p.state.spd = r2(p.state.spd * 0.5);
      this.stepCraft(p, now);
      p.state.act = now < p.actUntil ? 'swing' : undefined;
    }
    const restored: [string, 0 | 1][] = [];
    for (const [id, st] of this.veins) if (st.until && st.until <= now) { this.veins.delete(id); restored.push([id, 0]); }
    if (restored.length) this.broadcast({ t: 'nodes', depleted: restored });

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

  // ---------------------------------------------------------------- saving

  /** Persist one player (logged-in players only). Errors are logged, never thrown. */
  async save(p: ServerPlayer): Promise<void> {
    if (!p.userId || !this.opts.store) return;
    p.savedAt = this.now();
    p.dirty = false;
    const s = p.state;
    try {
      await this.opts.store.save(p.userId, { pos: { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, bag: p.bag, equip: p.equip, gold: p.gold, xp: p.xp });
    } catch (e) { this.log('save failed', p.userId, e); }
  }

  /** Save everyone who moved or changed since their last save. Called every 30 s and on shutdown. */
  async saveAll(): Promise<void> {
    await Promise.all([...this.players.values()].filter((p) => p.dirty || p.lastValid.at > p.savedAt).map((p) => this.save(p)));
  }

  /** On shutdown: tell everyone so clients show "server restarting" instead of an error. */
  async shutdown(): Promise<void> {
    this.broadcast({ t: 'system', text: 'Server restarting — you will reconnect in a moment.' });
    await this.saveAll();
  }

  /** Test helper: a player's server-side state by id. */
  inspect(id: string): ServerPlayer | undefined { return this.players.get(id); }
}

export const chunkOf = (v: number) => Math.floor(v / CHUNK_SIZE);

function gearOf(e: Equipment): PlayerState['gear'] {
  return { t: e.tool, m: e.mainHand, s: e.shoulders, b: e.back };
}

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return s || 'Adventurer';
}

export { VEINS };
