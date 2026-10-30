/**
 * The authoritative world. Owns every player's position, bag, gear, gold, skills, talents, quests
 * and inn room; every node, mob and item on the ground. Clients only ever *ask*; the server checks
 * distance, levels, tools, cooldowns and space, rolls every random thing, and replies with state.
 * It never touches sockets: each player has a `send` function, so tests drive it without a network.
 */
import {
  AOI_CHUNKS, CAVE_ENTRANCE, CAVE_EXIT, CAVE_EXIT_OUT, CAVE_START, CHUNK_SIZE, IMBUE, INN, ITEMS, MAX_CHAT_LEN, MAX_NAME_LEN,
  NPC_BY_ID, PLAYER_COLORS, PROTOCOL_VERSION, QUEST_BY_ID, RECIPE_BY_ID, START_GOLD, STATION_BY_ID, TICK_HZ, USE_RANGE,
  EAT_LOCK_MS, addStack, burnChance, knifeRepair, knifeUses, STATIONS, canLearn, checkStep, computeStats, countItem, emptyBag, faceOf, groundAt, levelOf, periodKey,
  questAvailable, r2, r3, recipeAt, removeItem, resizeBag, respecCost, rollCraftRarity, rollEffects, rollsRarity,
  validateBuild, xpMult, COMBAT_TREES, TALENT_TREE,
  type Buff, type ClientMsg, type HoldSlot, type MobKind, type PlayerState, type ServerMsg, type SkillId, type Slot,
  type Stack, type TreeId,
} from '@kontor/shared';
import { STORAGE_SLOTS, type CharacterStore, type StoredCharacter } from './persistence.js';
import { cast, gather, reel, stepFishing, stopFishing } from './gather.js';
import { attack, createMobs, mobState, skin, stepMobs } from './combat.js';
import type { Client, Ground, Lease, Mob, NodeState, ServerPlayer } from './types.js';

export type { Client } from './types.js';

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

type Joining = Omit<StoredCharacter, 'userId'> & { userId: string | null };

const RESPAWN = { x: 0, z: 3 };
const GROUND_SECONDS = 300;

let nextId = 1;
let nextGround = 1;

export class World {
  readonly players = new Map<string, ServerPlayer>();
  /** Veins and trees being used or depleted, by id. */
  readonly nodes = new Map<string, NodeState>();
  readonly mobs: Map<string, Mob>;
  readonly ground = new Map<number, Ground>();
  /** Inn rooms: who holds each (by user id or, for guests, player id) and until when. */
  readonly rooms: ({ key: string; name: string; until: number } | null)[] = Array.from({ length: INN.rooms }, () => null);
  private pending = new Map<Client, true>();
  private timers: { at: number; fn: () => void }[] = [];
  tick = 0;
  readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;
  private readonly random: () => number;

  constructor(private readonly opts: WorldOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.random = opts.random ?? Math.random;
    this.mobs = createMobs(this);
  }

  rand(): number { return this.random(); }

  /** Load who rents which inn room (offline players keep theirs). */
  async loadLeases(): Promise<void> {
    if (!this.opts.store) return;
    for (const l of await this.opts.store.leases()) if (l.lease.until > this.now()) this.rooms[l.lease.room] = { key: l.userId, name: l.name, until: l.lease.until };
  }

  connect(client: Client): void { this.pending.set(client, true); }

  disconnect(client: Client): void {
    this.pending.delete(client);
    for (const [id, p] of this.players) {
      if (p.client !== client) continue;
      this.players.delete(id);
      void this.save(p);
      this.broadcast({ t: 'leave', id });
      this.broadcast({ t: 'system', text: `${p.state.name} logged out` });
      this.broadcastRoster();
      this.log(`leave ${p.state.name} (${id}); online ${this.players.size}`);
    }
  }

  /** Returns a promise only for hello with a store; everything else is synchronous. */
  handle(client: Client, msg: ClientMsg): void | Promise<void> {
    if (msg.t === 'ping') return client.send({ t: 'pong', at: msg.at });
    if (msg.t === 'hello') return this.hello(client, msg);
    const p = this.byClient(client);
    if (!p) return;
    if (p.dead && msg.t !== 'respawn' && msg.t !== 'input' && msg.t !== 'chat') return;
    switch (msg.t) {
      case 'input': return this.input(p, msg);
      case 'chat': return this.chat(p, msg.text);
      case 'mine': return gather(this, p, 'mine', msg.node);
      case 'chop': return gather(this, p, 'chop', msg.node);
      case 'cast': return cast(this, p, msg.x, msg.z);
      case 'reel': return reel(this, p, msg.ok);
      case 'craft': return this.craft(p, msg.recipe, msg.count, msg.station);
      case 'cancelCraft': p.job = null; return this.sendJob(p);
      case 'equip': return this.equipFromBag(p, msg.index);
      case 'unequip': return this.unequip(p, msg.slot);
      case 'hold': return this.hold(p, msg.slot);
      case 'buy': return this.buy(p, msg.npc, msg.item);
      case 'sell': return this.sell(p, msg.npc, msg.index, msg.qty);
      case 'drop': return this.drop(p, msg.index, msg.qty);
      case 'pickup': return this.pickup(p, msg.id);
      case 'attack': return attack(this, p, msg.target, msg.special);
      case 'eat': return this.eat(p, msg.index);
      case 'talent': return this.learn(p, msg.tree, msg.node);
      case 'respec': return this.respec(p, msg.tree);
      case 'rent': return this.rent(p, msg.weeks);
      case 'storage': return this.storageMove(p, msg.op, msg.index, msg.qty);
      case 'quest': return this.quest(p, msg.quest, msg.op);
      case 'imbue': return this.imbue(p, msg.index, msg.element);
      case 'travel': return this.travel(p, msg.to);
      case 'respawn': return this.respawn(p);
      case 'skin': return skin(this, p, msg.target);
      case 'repair': return this.repair(p, msg.slot);
    }
  }

  private byClient(client: Client): ServerPlayer | undefined {
    for (const p of this.players.values()) if (p.client === client) return p;
    return undefined;
  }

  // ---------------------------------------------------------------- joining

  private hello(client: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void | Promise<void> {
    if (!this.pending.has(client)) return;
    const reject = (reason: string) => { client.send({ t: 'reject', reason }); client.close(reason.split(':')[0]); };
    if (msg.proto !== PROTOCOL_VERSION) return reject('outdated_client');
    this.pending.delete(client);
    const store = this.opts.store;
    const fresh = (build: Extract<ClientMsg, { t: 'hello' }>['build'], userId: string | null): Joining => ({
      userId, name: sanitizeName(msg.name), color: Math.abs(Math.floor(msg.color)) % PLAYER_COLORS.length, build, pos: null, gold: START_GOLD,
      bag: emptyBag(computeStats(build, {}, {}, {}).bagSlots), equip: {}, xp: {}, talents: {}, respecs: 0, quests: {}, lease: null, storage: emptyBag(STORAGE_SLOTS),
    });
    if (!store || (!msg.token && !this.opts.requireLogin)) {
      const bad = validateBuild(msg.build);
      if (bad) return reject(`invalid_character:${bad}`);
      this.join(client, fresh(msg.build, null), false);
      return;
    }
    return (async () => {
      const userId = msg.token ? await store.verify(msg.token) : null;
      if (!userId) return reject('login_required');
      let saved = await store.load(userId);
      const isNew = !saved;
      if (!saved) {
        const bad = validateBuild(msg.build);
        if (bad) return reject(`invalid_character:${bad}`);
        saved = { ...fresh(msg.build, userId), userId };
        await store.create(saved);
      }
      for (const p of this.players.values()) {
        if (p.userId === userId) { p.client.send({ t: 'system', text: 'You logged in somewhere else.' }); p.client.close('replaced'); this.disconnect(p.client); }
      }
      this.join(client, saved, !isNew);
    })().catch((e) => { this.log('login failed', e); reject('server_error'); });
  }

  private join(client: Client, c: Joining, wasSaved: boolean): void {
    const id = `p${nextId++}`;
    const now = this.now();
    let x: number, z: number, yaw: number;
    if (c.pos && checkStep(c.pos, c.pos, 0.1).ok) { x = c.pos.x; z = c.pos.z; yaw = c.pos.yaw; }
    else { const a = this.rand() * Math.PI * 2, d = 2 + this.rand() * 4; x = Math.cos(a) * d; z = Math.sin(a) * d; yaw = -a + Math.PI / 2; }
    const y = groundAt(x, z);
    const stats = computeStats(c.build, c.equip, c.talents, c.xp);
    const bag = resizeBag(c.bag, stats.bagSlots) ?? c.bag;
    const state: PlayerState = { id, name: c.name, color: c.color, race: c.build.race, face: faceOf(c.build), x: r2(x), y: r2(y), z: r2(z), yaw: r3(yaw), pitch: 0, spd: 0 };
    const p: ServerPlayer = {
      state, client, lastValid: { x, y, z, at: now }, lastSeq: -1, strikes: 0, lastChatAt: 0, actUntil: 0, act: undefined,
      build: c.build, userId: c.userId, savedAt: now, dirty: false,
      bag, equip: c.equip, gold: c.gold, xp: c.xp, talents: c.talents, respecs: c.respecs, quests: c.quests, lease: c.lease, storage: c.storage,
      held: c.equip.mainHand ? 'mainHand' : c.equip.pickaxe ? 'pickaxe' : 'mainHand', stats, buffs: [], hp: stats.maxHp, lastHurtAt: 0, dead: false,
      lastGatherAt: 0, job: null, nextAttackAt: 0, nextSpecialAt: 0, fishing: null,
    };
    // A guest's or expired lease doesn't hold a room.
    if (p.lease && p.lease.until > now && !this.rooms[p.lease.room]) this.rooms[p.lease.room] = { key: this.roomKey(p), name: p.state.name, until: p.lease.until };
    this.refreshGear(p, false);
    this.players.set(id, p);
    client.send({ t: 'welcome', id, build: this.opts.build, proto: PROTOCOL_VERSION, tickHz: TICK_HZ, you: state, character: { name: c.name, color: c.color, build: c.build }, saved: wasSaved });
    this.sendInv(p);
    client.send({ t: 'skills', xp: p.xp });
    client.send({ t: 'talents', alloc: p.talents, respecs: p.respecs });
    client.send({ t: 'quests', state: p.quests });
    this.sendLease(p);
    client.send({ t: 'rooms', taken: this.roomNames() });
    this.sendHp(p);
    const dep: [string, 0 | 1][] = [];
    for (const [nid, st] of this.nodes) if (st.until > now) dep.push([nid, 1]);
    client.send({ t: 'nodes', depleted: dep });
    for (const [nid, st] of this.nodes) if (st.until <= now && st.left > 0 && st.left < st.total) client.send({ t: 'node', id: nid, left: st.left, total: st.total });
    client.send({ t: 'ground', add: [...this.ground.values()].map(groundView) });
    if (!wasSaved && !p.equip.pickaxe) client.send({ t: 'notice', kind: 'info', text: 'Welcome! You have 30 gold — Ingrid at the trading post sells your first pickaxe, hatchet and fishing rod (10 g each).' });
    this.broadcast({ t: 'system', text: `${c.name} logged in` });
    this.broadcastRoster();
    this.log(`join ${c.name} (${id}); online ${this.players.size}`);
  }

  private broadcastRoster(): void {
    const players = [...this.players.values()].map((p) => ({ id: p.state.id, name: p.state.name, color: p.state.color, race: p.state.race, face: p.state.face }));
    this.broadcast({ t: 'roster', players });
  }

  // ---------------------------------------------------------------- helpers used by systems

  notice(p: ServerPlayer, text: string, kind: 'error' | 'info' | 'rare' = 'info'): void { p.client.send({ t: 'notice', text, kind }); }

  /** Put a stack in the bag; returns how many did not fit. */
  give(p: ServerPlayer, st: Stack): number { p.dirty = true; return addStack(p.bag, st); }

  /** Give if possible, otherwise drop at the player's feet (owned by them). */
  giveOrDrop(p: ServerPlayer, st: Stack): void {
    const left = this.give(p, { ...st });
    if (left > 0) { this.spawnGround({ ...st, qty: left }, p.state.x, p.state.z, p.state.id, GROUND_SECONDS); this.notice(p, 'Bag full — dropped at your feet.', 'info'); }
  }

  /** Add XP (with multipliers); returns the XP actually given. Level-ups recompute stats. */
  addXp(p: ServerPlayer, skill: SkillId, base: number): number {
    const amount = Math.max(1, Math.round(base * xpMult(p.stats, skill)));
    const before = levelOf(p.xp, skill);
    p.xp[skill] = (p.xp[skill] ?? 0) + amount;
    const after = levelOf(p.xp, skill);
    p.client.send({ t: 'skills', xp: p.xp });
    if (after > before) {
      const name = skill === 'combat' ? 'Player level' : skill[0].toUpperCase() + skill.slice(1);
      this.notice(p, `${name} ${after}! +${after - before} talent point${after - before > 1 ? 's' : ''} (T).`, 'info');
      if (after % 5 === 0) this.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} reached ${name} ${after}.` });
      this.recompute(p);
    }
    p.dirty = true;
    return amount;
  }

  /** Recompute stats after gear, talents, levels or buffs change. */
  recompute(p: ServerPlayer): void {
    const now = this.now();
    p.buffs = p.buffs.filter((b) => b.until > now);
    const before = p.stats.maxHp;
    p.stats = computeStats(p.build, p.equip, p.talents, p.xp, p.buffs, now);
    if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
    p.hp = Math.min(p.hp, p.stats.maxHp);
    this.sendHp(p);
  }

  /** Visible gear changed (equip, held item). */
  refreshGear(p: ServerPlayer, recompute = true): void {
    if (!p.equip[p.held]) p.held = p.equip.mainHand ? 'mainHand' : (['pickaxe', 'hatchet', 'rod'] as HoldSlot[]).find((s) => p.equip[s]) ?? 'mainHand';
    const e = p.equip;
    p.state.gear = { h: e[p.held]?.id, s: e.shoulders?.id, b: e.back?.id, hd: e.head?.id, c: e.chest?.id, l: e.legs?.id, o: p.held === 'mainHand' ? e.offHand?.id : undefined };
    if (recompute) this.recompute(p);
  }

  sendInv(p: ServerPlayer): void { p.client.send({ t: 'inv', bag: p.bag, equip: p.equip, gold: p.gold, held: p.held }); }
  sendHp(p: ServerPlayer): void { p.state.hp = Math.ceil(p.hp); p.state.mhp = p.stats.maxHp; p.client.send({ t: 'hp', hp: Math.max(0, Math.ceil(p.hp * 10) / 10), max: p.stats.maxHp }); }
  private sendLease(p: ServerPlayer): void { p.client.send({ t: 'lease', room: p.lease && p.lease.until > this.now() ? p.lease.room : null, until: p.lease?.until ?? null, storage: p.storage }); }
  private sendJob(p: ServerPlayer): void {
    const j = p.job;
    p.client.send(j ? { t: 'job', recipe: j.recipe, done: j.done, total: j.total, seconds: Math.max(0, (j.nextAt - this.now()) / 1000) } : { t: 'job', recipe: null, done: 0, total: 0, seconds: 0 });
  }

  /** Run fn at a later server time (projectile flight). */
  later(at: number, fn: () => void): void { this.timers.push({ at, fn }); }

  broadcast(msg: ServerMsg): void { for (const p of this.players.values()) p.client.send(msg); }

  /** Send to players whose area of interest includes this point. */
  broadcastNear(pos: { x: number; z: number }, msg: ServerMsg): void {
    const cx = chunkOf(pos.x), cz = chunkOf(pos.z);
    for (const p of this.players.values()) {
      if (Math.abs(chunkOf(p.state.x) - cx) <= AOI_CHUNKS + 1 && Math.abs(chunkOf(p.state.z) - cz) <= AOI_CHUNKS + 1) p.client.send(msg);
    }
  }

  spawnGround(item: Stack, x: number, z: number, owner: string | undefined, seconds: number): void {
    const now = this.now();
    const g: Ground = { id: nextGround++, item, x: r2(x), y: r2(groundAt(x, z)), z: r2(z), owner, ownedFor: owner ? 60 : 0, expires: now + seconds * 1000, ownedUntil: owner ? now + 60_000 : 0 };
    this.ground.set(g.id, g);
    this.broadcast({ t: 'ground', add: [groundView(g)] });
  }

  kill(p: ServerPlayer, by: string): void {
    p.hp = 0;
    p.dead = true;
    p.job = null;
    stopFishing(this, p, 'cancel');
    this.sendHp(p);
    p.client.send({ t: 'dead', by });
    this.broadcast({ t: 'system', text: `${p.state.name} was knocked out by ${by}.` });
    for (const m of this.mobs.values()) if (m.target === p.state.id) { m.target = null; m.returning = true; }
  }

  private respawn(p: ServerPlayer): void {
    if (!p.dead) return;
    p.dead = false;
    p.buffs = p.buffs.filter((b) => b.name !== 'Weakened');
    p.buffs.push({ name: 'Weakened', stats: { allDmg: -0.2, moveSpeed: -0.2 }, until: this.now() + 120_000 });
    this.recompute(p);
    p.hp = Math.round(p.stats.maxHp * 0.6);
    this.teleport(p, RESPAWN.x + (this.rand() - 0.5) * 3, RESPAWN.z + (this.rand() - 0.5) * 3);
    p.client.send({ t: 'buffs', list: p.buffs });
    this.sendHp(p);
    this.notice(p, 'You come to at camp. Weakened for 2 minutes (−20% damage and speed).', 'info');
  }

  private teleport(p: ServerPlayer, x: number, z: number): void {
    const y = groundAt(x, z);
    Object.assign(p.state, { x: r2(x), y: r2(y), z: r2(z) });
    p.lastValid = { x, y, z, at: this.now() };
    stopFishing(this, p, 'cancel');
    p.client.send({ t: 'correct', seq: p.lastSeq, x: r2(x), y: r2(y), z: r2(z), reason: 'teleport' });
  }

  private near(p: ServerPlayer, place: { x: number; z: number }, extra = 0): boolean {
    return Math.hypot(p.state.x - place.x, p.state.z - place.z) <= USE_RANGE + extra;
  }

  // ---------------------------------------------------------------- movement & chat

  private input(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'input' }>): void {
    if (msg.seq <= p.lastSeq) return;
    p.lastSeq = msg.seq;
    const now = this.now();
    if (p.dead) return;
    const dt = (now - p.lastValid.at) / 1000;
    const next = { x: msg.x, y: msg.y, z: msg.z };
    const check = checkStep(p.lastValid, next, dt, p.stats.speedCap);
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
    if (msg.act && msg.act !== 'fish') { p.act = msg.act; p.actUntil = now + 450; }
  }

  private chat(p: ServerPlayer, raw: string): void {
    const now = this.now();
    if (now - p.lastChatAt < 700) return;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;
    p.lastChatAt = now;
    this.broadcast({ t: 'chat', from: p.state.id, name: p.state.name, text, at: now });
  }

  // ---------------------------------------------------------------- crafting

  private craft(p: ServerPlayer, recipeId: string, count: number, stationId: string): void {
    const r = RECIPE_BY_ID.get(recipeId);
    const st = STATION_BY_ID.get(stationId);
    if (!r || !st) return;
    if (!recipeAt(r, st.kind)) return;
    if (!this.near(p, st)) return this.notice(p, `Stand next to the ${st.name.toLowerCase()}.`, 'error');
    const lvl = levelOf(p.xp, r.skill);
    if (lvl < r.level) return this.notice(p, `Needs ${r.skill[0].toUpperCase()}${r.skill.slice(1)} ${r.level} (you have ${lvl}).`, 'error');
    if (!r.inputs.every((i) => countItem(p.bag, i.item) >= i.qty)) return this.notice(p, 'You don’t have the materials.', 'error');
    const speed = 1 + Math.max(0, (p.stats.scoped as any)[r.skill]?.craftSpeed ?? 0);
    const seconds = r.seconds / speed;
    p.job = { recipe: r.id, station: st.id, total: count, done: 0, nextAt: this.now() + seconds * 1000, seconds };
    stopFishing(this, p, 'cancel');
    this.sendJob(p);
  }

  private stepCraft(p: ServerPlayer, now: number): void {
    const job = p.job;
    if (!job || now < job.nextAt) return;
    const r = RECIPE_BY_ID.get(job.recipe)!;
    const st = STATION_BY_ID.get(job.station)!;
    const stop = (text: string) => { p.job = null; this.sendJob(p); this.notice(p, text); };
    if (!this.near(p, st, 1.5)) return stop(`You walked away from the ${st.name.toLowerCase()}.`);
    if (!r.inputs.every((i) => countItem(p.bag, i.item) >= i.qty)) return stop(`Out of materials after ${job.done}.`);
    const trial = p.bag.map((s) => (s ? { ...s } : null));
    for (const i of r.inputs) removeItem(trial, i.item, i.qty);
    const sc = (p.stats.scoped as any)[r.skill] ?? p.stats.all;
    let out: Stack = { id: r.output.item, qty: r.output.qty };
    if (r.burns && this.rand() < burnChance(levelOf(p.xp, 'cooking'), r.level, st.kind === 'stove', sc.burnChance)) out = { id: 'burnt_fish', qty: 1 };
    else if (rollsRarity(r)) {
      const rar = rollCraftRarity(sc.luck, () => this.rand());
      if (rar) { out.r = rar; out.fx = rollEffects(ITEMS[out.id], rar, () => this.rand()); }
    }
    if (ITEMS[out.id]?.knife) out.d = knifeUses(out);
    if (addStack(trial, out) > 0) return stop('Your bag is full.');
    p.bag = trial;
    p.act = 'swing'; p.actUntil = now + 450;
    const xp = this.addXp(p, r.skill, out.id === 'burnt_fish' ? Math.ceil(r.xp / 4) : r.xp);
    p.client.send({ t: 'gain', skill: r.skill, xp, item: out.id, qty: out.qty, r: out.r, rare: (out.r ?? 0) >= 2 });
    if ((out.r ?? 0) >= 2) this.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} crafted a ${['', '', 'rare', 'epic'][out.r!]} ${ITEMS[out.id].name}!` });
    job.done++;
    p.dirty = true;
    this.sendInv(p);
    if (job.done >= job.total) { p.job = null; this.sendJob(p); return; }
    job.nextAt = now + job.seconds * 1000;
    this.sendJob(p);
  }

  // ---------------------------------------------------------------- bag and gear

  private equipFromBag(p: ServerPlayer, index: number): void {
    const s = p.bag[index];
    if (!s) return;
    const def = ITEMS[s.id];
    if (!def?.slot) return;
    const err = (text: string) => this.notice(p, text, 'error');
    const bag = p.bag.map((x) => (x ? { ...x } : null));
    const equip = { ...p.equip };
    const back: Stack[] = [];
    // Ammo stacks onto worn ammo of the same kind.
    if (def.slot === 'ammo' && equip.ammo && equip.ammo.id === s.id) {
      equip.ammo = { ...equip.ammo, qty: equip.ammo.qty + s.qty };
      bag[index] = null;
    } else {
      if (equip[def.slot]) back.push(equip[def.slot]!);
      equip[def.slot] = { ...s };
      bag[index] = null;
      // Two-handed weapons and shields don't mix.
      if (def.slot === 'mainHand' && def.twoHanded && equip.offHand) { back.push(equip.offHand); delete equip.offHand; }
      if (def.slot === 'offHand' && equip.mainHand && ITEMS[equip.mainHand.id]?.twoHanded) return err('You can’t use a shield with a two-handed weapon.');
    }
    for (const b of back) if (addStack(bag, b) > 0) return err('No room in your bag for what you’re taking off.');
    const resized = resizeBag(bag, computeStats(p.build, equip, p.talents, p.xp).bagSlots);
    if (!resized) return err('Empty a few bag slots first — the smaller bag can’t hold everything.');
    p.bag = resized;
    p.equip = equip;
    if (def.slot === 'mainHand' || def.slot === 'pickaxe' || def.slot === 'hatchet' || def.slot === 'rod') p.held = def.slot as HoldSlot;
    this.afterEquip(p);
  }

  private unequip(p: ServerPlayer, slot: Slot): void {
    const st = p.equip[slot];
    if (!st) return;
    const equip = { ...p.equip };
    delete equip[slot];
    const resized = resizeBag(p.bag, computeStats(p.build, equip, p.talents, p.xp).bagSlots);
    if (!resized || addStack(resized, { ...st }) > 0) return this.notice(p, 'No room in your bag.', 'error');
    p.bag = resized;
    p.equip = equip;
    this.afterEquip(p);
  }

  private afterEquip(p: ServerPlayer): void {
    p.dirty = true;
    p.nextAttackAt = Math.max(p.nextAttackAt, this.now() + 400);
    this.refreshGear(p);
    this.sendInv(p);
  }

  /** Repair a worn knife (equipped or in the bag) at an anvil for a shaped stone or an iron bar. */
  private repair(p: ServerPlayer, slot: Slot | string): void {
    const anvil = STATIONS.find((s) => s.kind === 'anvil' && this.near(p, s));
    if (!anvil) return this.notice(p, 'Repairs are done at an anvil.', 'error');
    const st = slot === 'knife' ? p.equip.knife : p.bag[Number(slot)] ?? undefined;
    if (!st || !ITEMS[st.id]?.knife) return;
    const max = knifeUses(st);
    if ((st.d ?? 0) >= max) return this.notice(p, 'It doesn’t need repairing.', 'info');
    const cost = knifeRepair(st.id);
    if (!removeItem(p.bag, cost.item, cost.qty)) return this.notice(p, `Repairing needs ${cost.qty} × ${ITEMS[cost.item].name}.`, 'error');
    st.d = max;
    this.notice(p, `Repaired: ${max} uses.`, 'info');
    p.dirty = true;
    this.sendInv(p);
  }

  private hold(p: ServerPlayer, slot: HoldSlot): void {
    if (!p.equip[slot] && slot !== 'mainHand') return;
    p.held = slot;
    if (slot !== 'rod') stopFishing(this, p, 'cancel');
    this.refreshGear(p, false);
    this.sendInv(p);
  }

  private drop(p: ServerPlayer, index: number, qty: number): void {
    const s = p.bag[index];
    if (!s) return;
    const n = Math.min(qty, s.qty);
    const dropped: Stack = { ...s, qty: n };
    s.qty -= n;
    if (s.qty <= 0) p.bag[index] = null;
    const a = this.rand() * 6.28;
    this.spawnGround(dropped, p.state.x + Math.cos(a) * 0.7, p.state.z + Math.sin(a) * 0.7, undefined, GROUND_SECONDS);
    p.dirty = true;
    this.sendInv(p);
  }

  private pickup(p: ServerPlayer, id: number): void {
    const g = this.ground.get(id);
    if (!g) return;
    const now = this.now();
    if (Math.hypot(g.x - p.state.x, g.z - p.state.z) > 3 || Math.abs(g.y - p.state.y) > 3) return this.notice(p, 'Too far away.', 'error');
    if (g.owner && g.owner !== p.state.id && now < g.ownedUntil) return this.notice(p, `That’s someone else’s loot for another ${Math.ceil((g.ownedUntil - now) / 1000)} s.`, 'error');
    if (g.item.id === 'coins') {
      p.gold += g.item.qty;
      p.client.send({ t: 'gain', item: 'coins', qty: g.item.qty });
    } else {
      const left = this.give(p, { ...g.item });
      if (left === g.item.qty) return this.notice(p, 'Your bag is full.', 'error');
      p.client.send({ t: 'gain', item: g.item.id, qty: g.item.qty - left, r: g.item.r, rare: (g.item.r ?? 0) >= 2 });
      if (left > 0) { g.item = { ...g.item, qty: left }; this.broadcast({ t: 'ground', remove: [g.id], add: [groundView(g)] }); this.sendInv(p); return; }
    }
    this.ground.delete(id);
    this.broadcast({ t: 'ground', remove: [id] });
    p.dirty = true;
    this.sendInv(p);
  }

  private eat(p: ServerPlayer, index: number): void {
    const s = p.bag[index];
    const food = s ? ITEMS[s.id]?.food : undefined;
    if (!s || !food) return;
    const lock = p.lastHurtAt + EAT_LOCK_MS - this.now();
    if (lock > 0) return this.notice(p, `You can’t eat in a fight — wait ${Math.ceil(lock / 1000)} s after the last hit.`, 'error');
    if (p.hp >= p.stats.maxHp && !food.buff) return this.notice(p, 'You’re not hungry.', 'info');
    s.qty--;
    if (s.qty <= 0) p.bag[index] = null;
    p.hp = Math.min(p.stats.maxHp, p.hp + food.heal);
    if (food.buff) {
      // One food buff at a time; eating again replaces it.
      p.buffs = p.buffs.filter((b) => !b.name.startsWith('Well fed'));
      p.buffs.push({ name: food.buff.name, stats: food.buff.stats, until: this.now() + food.buff.sec * 1000 });
      this.recompute(p);
      p.client.send({ t: 'buffs', list: p.buffs });
    }
    p.client.send({ t: 'hit', to: p.state.id, dmg: food.heal, kind: 'heal' });
    p.dirty = true;
    this.sendHp(p);
    this.sendInv(p);
  }

  // ---------------------------------------------------------------- shops and the imbuer

  private npcNear(p: ServerPlayer, npcId: string) {
    const n = NPC_BY_ID.get(npcId);
    return n && this.near(p, n, 1) ? n : null;
  }

  private buy(p: ServerPlayer, npcId: string, itemId: string): void {
    const n = this.npcNear(p, npcId);
    const def = ITEMS[itemId];
    if (!n || !n.sells?.includes(itemId) || !def?.buyPrice) return this.notice(p, 'Stand by the trader to buy.', 'error');
    if (p.gold < def.buyPrice) return this.notice(p, `Not enough gold (${def.buyPrice} needed).`, 'error');
    if (this.give(p, { id: itemId, qty: 1 }) > 0) return this.notice(p, 'Your bag is full.', 'error');
    p.gold -= def.buyPrice;
    p.client.send({ t: 'gain', item: itemId, qty: 1 });
    this.sendInv(p);
  }

  private sell(p: ServerPlayer, npcId: string, index: number, qty: number): void {
    const n = this.npcNear(p, npcId);
    const s = p.bag[index];
    if (!n || !n.roles.includes('shop')) return this.notice(p, 'Stand by the trader to sell.', 'error');
    if (!s) return;
    const def = ITEMS[s.id];
    if (!def || def.sellValue <= 0) return this.notice(p, 'The trader isn’t interested in that.', 'error');
    const k = Math.min(qty, s.qty);
    const each = Math.max(1, Math.round(def.sellValue * (1 + (s.r ?? 0) * 0.5) * (1 + p.stats.all.sell)));
    s.qty -= k;
    if (s.qty <= 0) p.bag[index] = null;
    p.gold += k * each;
    p.dirty = true;
    this.sendInv(p);
  }

  private imbue(p: ServerPlayer, index: number, element: 'fire' | 'frost'): void {
    const n = [...NPC_BY_ID.values()].find((x) => x.roles.includes('imbuer') && this.near(p, x, 1));
    if (!n) return this.notice(p, 'Bring your staff to Ragna the Imbuer in Bjørkvik.', 'error');
    const s = p.bag[index];
    const rule = s ? IMBUE[s.id] : undefined;
    if (!s || !rule) return this.notice(p, 'Ragna can only imbue plain birch or pine staffs.', 'error');
    if (countItem(p.bag, rule.gem) < 1) return this.notice(p, `You need a ${ITEMS[rule.gem].name}.`, 'error');
    if (p.gold < rule.gold) return this.notice(p, `It costs ${rule.gold} gold.`, 'error');
    removeItem(p.bag, rule.gem, 1);
    p.gold -= rule.gold;
    s.id = element === 'fire' ? rule.fire : rule.frost; // rarity and rolled effects carry over
    p.client.send({ t: 'gain', item: s.id, qty: 1, r: s.r, rare: true });
    this.notice(p, `Ragna hums, and your staff crackles with ${element}.`, 'info');
    p.dirty = true;
    this.sendInv(p);
  }

  // ---------------------------------------------------------------- talents

  private learn(p: ServerPlayer, tree: TreeId, node: string): void {
    if (!TALENT_TREE[tree]) return;
    const why = canLearn(p.talents, p.xp, tree, node);
    if (why) return this.notice(p, why, 'error');
    (p.talents[tree] ??= {})[node] = (p.talents[tree]![node] ?? 0) + 1;
    p.dirty = true;
    this.recompute(p);
    p.client.send({ t: 'talents', alloc: p.talents, respecs: p.respecs });
  }

  private respec(p: ServerPlayer, tree: TreeId): void {
    if (!TALENT_TREE[tree] || !Object.keys(p.talents[tree] ?? {}).length) return;
    const cost = respecCost(p.respecs);
    if (p.gold < cost) return this.notice(p, `Resetting a tree costs ${cost} gold.`, 'error');
    p.gold -= cost;
    p.respecs++;
    delete p.talents[tree];
    p.dirty = true;
    this.recompute(p);
    this.sendInv(p);
    p.client.send({ t: 'talents', alloc: p.talents, respecs: p.respecs });
    this.notice(p, `${TALENT_TREE[tree].name} talents reset for ${cost} gold. Next reset: ${respecCost(p.respecs)} gold.`);
  }

  // ---------------------------------------------------------------- quests

  private quest(p: ServerPlayer, id: string, op: 'accept' | 'turnin' | 'abandon'): void {
    const q = QUEST_BY_ID.get(id);
    if (!q) return;
    const st = (p.quests[id] ??= {});
    const now = this.now();
    if (op === 'abandon') { st.active = undefined; st.progress = undefined; }
    else {
      if (!this.npcNear(p, q.npc)) return this.notice(p, `Talk to ${NPC_BY_ID.get(q.npc)?.name} for that.`, 'error');
      if (op === 'accept') {
        if (!questAvailable(q, p.quests, now)) return this.notice(p, 'Done for now — this one resets later.', 'error');
        st.active = true; st.progress = 0;
      } else {
        if (!st.active) return;
        if ('item' in q.need) {
          if (!removeItem(p.bag, q.need.item, q.need.qty)) return this.notice(p, `You need ${q.need.qty} × ${ITEMS[q.need.item].name}.`, 'error');
        } else if ((st.progress ?? 0) < q.need.qty) return this.notice(p, `${st.progress ?? 0} of ${q.need.qty} so far.`, 'error');
        st.active = undefined; st.progress = undefined; st.done = periodKey(q.period, now);
        p.gold += q.reward.gold;
        const xp = this.addXp(p, q.reward.xp[0], q.reward.xp[1]);
        p.client.send({ t: 'gain', skill: q.reward.xp[0], xp, item: 'coins', qty: q.reward.gold });
        this.notice(p, `Quest complete: ${q.name}.`, 'info');
        this.sendInv(p);
      }
    }
    p.dirty = true;
    p.client.send({ t: 'quests', state: p.quests });
  }

  questKill(p: ServerPlayer, kind: MobKind): void {
    let changed = false;
    for (const [id, st] of Object.entries(p.quests)) {
      const q = QUEST_BY_ID.get(id);
      if (!q || !st.active || !('kill' in q.need) || q.need.kill !== kind) continue;
      st.progress = Math.min(q.need.qty, (st.progress ?? 0) + 1);
      changed = true;
    }
    if (changed) { p.dirty = true; p.client.send({ t: 'quests', state: p.quests }); }
  }

  // ---------------------------------------------------------------- the inn

  private roomKey(p: ServerPlayer): string { return p.userId ?? `guest:${p.state.id}`; }
  private roomNames(): (string | null)[] { const now = this.now(); return this.rooms.map((r) => (r && r.until > now ? r.name : null)); }

  /**
   * Rent (or extend) a room. One home at a time: a new lease replaces the old one and your stored
   * items go with you (they belong to the character, not the room). Up to 4 weeks paid ahead.
   * Coming back after a lease ran out with items still in storage costs 20% extra (reclaim fee).
   */
  private rent(p: ServerPlayer, weeks: number): void {
    const inn = [...NPC_BY_ID.values()].find((n) => n.roles.includes('inn'));
    if (!inn || !this.near(p, inn, 1)) return this.notice(p, 'Talk to Hilde at Bjørkvik Lodge to rent a room.', 'error');
    const now = this.now(), WEEK = 7 * 86400_000;
    const key = this.roomKey(p);
    let room = p.lease && p.lease.until > now && this.rooms[p.lease.room]?.key === key ? p.lease.room : -1;
    const start = room >= 0 ? p.lease!.until : now;
    const until = Math.min(start + weeks * WEEK, now + INN.maxWeeks * WEEK);
    const paidWeeks = Math.round((until - start) / WEEK);
    if (paidWeeks <= 0) return this.notice(p, `You can pay at most ${INN.maxWeeks} weeks ahead.`, 'error');
    const reclaim = room < 0 && p.storage.some(Boolean) && p.lease ? 1.2 : 1;
    const cost = Math.ceil(paidWeeks * INN.pricePerWeek * reclaim);
    if (p.gold < cost) return this.notice(p, `That’s ${cost} gold.`, 'error');
    if (room < 0) {
      room = this.rooms.findIndex((r) => !r || r.until <= now);
      if (room < 0) return this.notice(p, 'All eight rooms are taken. Try again when a lease runs out.', 'error');
    }
    p.gold -= cost;
    p.lease = { room, until };
    this.rooms[room] = { key, name: p.state.name, until };
    p.dirty = true;
    this.sendInv(p);
    this.sendLease(p);
    this.broadcast({ t: 'rooms', taken: this.roomNames() });
    this.notice(p, `Room ${room + 1} is yours until ${new Date(until).toLocaleDateString('en-GB', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'short' })}. Your chest is by its door.`);
  }

  private storageMove(p: ServerPlayer, op: 'put' | 'take', index: number, qty: number): void {
    const now = this.now();
    if (!p.lease || p.lease.until <= now) return this.notice(p, 'Rent a room at the lodge to use a storage chest.', 'error');
    const inn = [...NPC_BY_ID.values()].find((n) => n.roles.includes('inn'))!;
    if (!this.near(p, { x: INN.x, z: INN.z + INN.d / 2 }, INN.w / 2) && !this.near(p, inn, 1)) return this.notice(p, 'Your chest is at Bjørkvik Lodge.', 'error');
    const [from, to] = op === 'put' ? [p.bag, p.storage] : [p.storage, p.bag];
    const s = from[index];
    if (!s) return;
    const k = Math.min(qty, s.qty);
    const left = addStack(to, { ...s, qty: k });
    const moved = k - left;
    if (moved <= 0) return this.notice(p, op === 'put' ? 'Your chest is full.' : 'Your bag is full.', 'error');
    s.qty -= moved;
    if (s.qty <= 0) from[index] = null;
    p.dirty = true;
    this.sendInv(p);
    this.sendLease(p);
  }

  // ---------------------------------------------------------------- the cave

  private travel(p: ServerPlayer, to: 'cave' | 'out'): void {
    if (to === 'cave') {
      if (Math.hypot(p.state.x - CAVE_ENTRANCE.x, p.state.z - CAVE_ENTRANCE.z) > CAVE_ENTRANCE.r + 3) return this.notice(p, 'Walk into the mine entrance.', 'error');
      this.teleport(p, CAVE_START.x, CAVE_START.z);
      this.notice(p, 'The Old Mine. It’s cold, and something is breathing down here.');
    } else {
      if (Math.hypot(p.state.x - CAVE_EXIT.x, p.state.z - CAVE_EXIT.z) > CAVE_EXIT.r + 3) return;
      this.teleport(p, CAVE_EXIT_OUT.x, CAVE_EXIT_OUT.z);
    }
    p.job = null;
  }

  // ---------------------------------------------------------------- tick

  /** Called TICK_HZ times a second. */
  step(): void {
    this.tick++;
    const now = this.now();
    const dt = 1 / TICK_HZ;
    const due = this.timers.filter((t) => t.at <= now);
    if (due.length) { this.timers = this.timers.filter((t) => t.at > now); for (const t of due) t.fn(); }
    stepMobs(this, dt, now);
    const list = [...this.players.values()];
    for (const p of list) {
      if (now - p.lastValid.at > 400) p.state.spd = r2(p.state.spd * 0.5);
      this.stepCraft(p, now);
      stepFishing(this, p, now);
      if (p.buffs.some((b) => b.until <= now)) { this.recompute(p); p.client.send({ t: 'buffs', list: p.buffs }); }
      // Out of combat for 8 s: regenerate (1 HP/s + regen stat per 10 s).
      if (!p.dead && p.hp < p.stats.maxHp && now - p.lastHurtAt > 8000 && this.tick % TICK_HZ === 0) {
        p.hp = Math.min(p.stats.maxHp, p.hp + 1 + p.stats.all.regen / 10 + p.stats.maxHp * 0.01);
        this.sendHp(p);
      }
      p.state.act = now < p.actUntil ? p.act : undefined;
    }
    // Nodes come back; ground items expire.
    const restored: [string, 0 | 1][] = [];
    for (const [id, st] of this.nodes) if (st.until && st.until <= now) { this.nodes.delete(id); restored.push([id, 0]); }
    if (restored.length) this.broadcast({ t: 'nodes', depleted: restored });
    const gone: number[] = [];
    for (const [id, g] of this.ground) if (g.expires <= now) { this.ground.delete(id); gone.push(id); }
    if (gone.length) this.broadcast({ t: 'ground', remove: gone });

    for (const viewer of list) {
      const vcx = chunkOf(viewer.state.x), vcz = chunkOf(viewer.state.z);
      const inAoi = (x: number, z: number) => Math.abs(chunkOf(x) - vcx) <= AOI_CHUNKS && Math.abs(chunkOf(z) - vcz) <= AOI_CHUNKS;
      const players = list.filter((o) => o !== viewer && inAoi(o.state.x, o.state.z)).map((o) => o.state);
      const mobs = [...this.mobs.values()].filter((m) => inAoi(m.x, m.z)).map((m) => mobState(m, now));
      viewer.client.send({ t: 'snap', tick: this.tick, at: now, players, mobs });
    }
  }

  // ---------------------------------------------------------------- saving

  async save(p: ServerPlayer): Promise<void> {
    if (!p.userId || !this.opts.store) return;
    p.savedAt = this.now();
    p.dirty = false;
    const s = p.state;
    try {
      await this.opts.store.save(p.userId, {
        pos: { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, bag: p.bag, equip: p.equip, gold: p.gold, xp: p.xp,
        talents: p.talents, respecs: p.respecs, quests: p.quests, lease: p.lease, storage: p.storage,
      });
    } catch (e) { this.log('save failed', p.userId, e); }
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.players.values()].filter((p) => p.dirty || p.lastValid.at > p.savedAt).map((p) => this.save(p)));
  }

  async shutdown(): Promise<void> {
    this.broadcast({ t: 'system', text: 'Server restarting — you will reconnect in a moment.' });
    await this.saveAll();
  }

  inspect(id: string): ServerPlayer | undefined { return this.players.get(id); }
}

function groundView(g: Ground) {
  return { id: g.id, item: g.item, x: g.x, y: g.y, z: g.z, owner: g.owner, ownedFor: Math.max(0, Math.ceil((g.ownedUntil - Date.now()) / 1000)) };
}

export const chunkOf = (v: number) => Math.floor(v / CHUNK_SIZE);

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return s || 'Adventurer';
}

// Re-exported for tests.
export type { Buff, Lease };
export { COMBAT_TREES };
