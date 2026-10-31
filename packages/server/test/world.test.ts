import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, PROTOCOL_VERSION, CHUNK_SIZE, defaultBuild, type ServerMsg } from '@kontor/shared';
import { World, sanitizeName, type Client } from '../src/world.js';

function fakeClient() {
  const inbox: ServerMsg[] = [];
  const client: Client & { inbox: ServerMsg[]; closed?: string } = {
    inbox,
    send: (m) => inbox.push(m),
    close(reason) { this.closed = reason; },
  };
  return client;
}

function setup() {
  let t = 1_000_000;
  const world = new World({ build: 'test', now: () => t });
  const join = (name: string) => {
    const c = fakeClient();
    world.connect(c);
    world.handle(c, { t: 'hello', name, color: 1, proto: PROTOCOL_VERSION, build: defaultBuild() });
    const welcome = c.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    return { c, id: welcome.id, you: welcome.you };
  };
  return { world, join, advance: (ms: number) => (t += ms) };
}

test('two players see each other after a tick', () => {
  const { world, join } = setup();
  const a = join('Anna'), b = join('Bjørn');
  world.step();
  const snapA = a.c.inbox.filter((m) => m.t === 'snap').at(-1) as Extract<ServerMsg, { t: 'snap' }>;
  const snapB = b.c.inbox.filter((m) => m.t === 'snap').at(-1) as Extract<ServerMsg, { t: 'snap' }>;
  assert.deepEqual(snapA.players.map((p) => p.name), ['Bjørn']);
  assert.deepEqual(snapB.players.map((p) => p.name), ['Anna']);
});

test('valid walking is accepted and broadcast', () => {
  const { world, join, advance } = setup();
  const a = join('Anna'), b = join('Bjørn');
  advance(100);
  const x = a.you.x + 0.45, z = a.you.z;
  world.handle(a.c, { t: 'input', seq: 1, x, y: heightAt(x, z), z, yaw: 0.5, pitch: 0 });
  world.step();
  const snap = b.c.inbox.filter((m) => m.t === 'snap').at(-1) as Extract<ServerMsg, { t: 'snap' }>;
  assert.equal(snap.players[0].x, Math.round(x * 100) / 100);
  assert.ok(!a.c.inbox.some((m) => m.t === 'correct'));
});

test('teleporting is corrected back to the last valid position', () => {
  const { world, join, advance } = setup();
  const a = join('Anna');
  advance(100);
  world.handle(a.c, { t: 'input', seq: 1, x: 60, y: heightAt(60, 0), z: 0, yaw: 0, pitch: 0 });
  const corr = a.c.inbox.find((m) => m.t === 'correct') as Extract<ServerMsg, { t: 'correct' }>;
  assert.ok(corr, 'expected a correction');
  assert.equal(corr.reason, 'too_fast');
  assert.equal(corr.x, a.you.x);
});

test('replayed sequence numbers are ignored', () => {
  const { world, join, advance } = setup();
  const a = join('Anna');
  advance(100);
  const x = a.you.x + 0.3;
  world.handle(a.c, { t: 'input', seq: 5, x, y: heightAt(x, a.you.z), z: a.you.z, yaw: 0, pitch: 0 });
  advance(100);
  world.handle(a.c, { t: 'input', seq: 5, x: x + 0.3, y: heightAt(x + 0.3, a.you.z), z: a.you.z, yaw: 0, pitch: 0 });
  assert.equal(world.players.get(a.id)!.state.x, Math.round(x * 100) / 100);
});

test('players far apart are outside each other’s area of interest', () => {
  const { world, join, advance } = setup();
  const a = join('Anna'), b = join('Bjørn');
  // Walk A west and B east in legal 0.5 m steps until they are three chunks apart.
  const walk = (p: { c: any; you: { x: number; z: number } }, toX: number) => {
    let x = p.you.x, seq = 0;
    while (Math.abs(toX - x) > 0.5) {
      advance(100);
      x += Math.sign(toX - x) * 0.5;
      world.handle(p.c, { t: 'input', seq: ++seq, x, y: heightAt(x, p.you.z), z: p.you.z, yaw: 0, pitch: 0 });
    }
    return x;
  };
  const ax = walk(a, -80), bx = walk(b, 90);
  assert.ok(Math.floor(bx / CHUNK_SIZE) - Math.floor(ax / CHUNK_SIZE) >= 2, `ax=${ax} bx=${bx}`);
  world.step();
  const snap = a.c.inbox.filter((m) => m.t === 'snap').at(-1) as Extract<ServerMsg, { t: 'snap' }>;
  assert.equal(snap.players.length, 0);
});

test('outdated clients are rejected', () => {
  const { world } = setup();
  const c = fakeClient();
  world.connect(c);
  world.handle(c, { t: 'hello', name: 'Old', color: 0, proto: PROTOCOL_VERSION - 1, build: defaultBuild() });
  assert.equal(c.inbox[0].t, 'reject');
  assert.equal(c.closed, 'outdated_client');
});

test('leaving is announced and chat is sanitised', () => {
  const { world, join, advance } = setup();
  const a = join('Anna'), b = join('Bjørn');
  advance(1000);
  world.handle(a.c, { t: 'chat', text: '  hei\u0007 alle  ' });
  const chat = b.c.inbox.find((m) => m.t === 'chat') as Extract<ServerMsg, { t: 'chat' }>;
  assert.equal(chat.text, 'hei alle');
  world.disconnect(a.c);
  assert.ok(b.c.inbox.some((m) => m.t === 'leave' && m.id === a.id));
});

test('names are sanitised', () => {
  assert.equal(sanitizeName('  <script>  '), 'script');
  assert.equal(sanitizeName(''), 'Adventurer');
  assert.equal(sanitizeName('a'.repeat(40)).length, 16);
});

test('hand-edited characters are rejected', () => {
  const { world } = setup();
  const c = fakeClient();
  world.connect(c);
  const build = defaultBuild();
  build.attrs.str = 10; // 25 points total instead of 20
  world.handle(c, { t: 'hello', name: 'Cheat', color: 0, proto: PROTOCOL_VERSION, build });
  assert.equal(c.inbox[0].t, 'reject');
  assert.equal(world.players.size, 0);
});

test('race is shared with other players', () => {
  const { world } = setup();
  const c = fakeClient();
  world.connect(c);
  world.handle(c, { t: 'hello', name: 'Gnomey', color: 2, proto: PROTOCOL_VERSION, build: { ...defaultBuild(), race: 'gnome' } });
  const roster = c.inbox.find((m) => m.t === 'roster') as Extract<ServerMsg, { t: 'roster' }>;
  assert.equal(roster.players[0].race, 'gnome');
});

import { MemoryStore } from '../src/persistence.js';

test('logged-in characters are created once, then loaded with their saved position', async () => {
  const store = new MemoryStore();
  let t = 5_000_000;
  const world = new World({ build: 'test', now: () => t, store });
  const c1 = fakeClient();
  world.connect(c1);
  await world.handle(c1, { t: 'hello', name: 'Durin', color: 3, proto: PROTOCOL_VERSION, build: { ...defaultBuild(), race: 'dwarf' }, token: 'dev:user-1' });
  const w1 = c1.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
  assert.equal(w1.saved, false);
  assert.equal(store.rows.get('user-1')?.build.race, 'dwarf');
  // Walk a bit, log out → position saved.
  t += 100;
  const x = w1.you.x + 0.4;
  world.handle(c1, { t: 'input', seq: 1, x, y: heightAt(x, w1.you.z), z: w1.you.z, yaw: 1, pitch: 0 });
  world.disconnect(c1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.rows.get('user-1')?.pos?.x, Math.round(x * 100) / 100);
  // Log in again from another "computer" sending a different build: the saved one wins.
  const c2 = fakeClient();
  world.connect(c2);
  await world.handle(c2, { t: 'hello', name: 'Someone', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:user-1' });
  const w2 = c2.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
  assert.equal(w2.saved, true);
  assert.equal(w2.character.name, 'Durin');
  assert.equal(w2.you.race, 'dwarf');
  assert.equal(w2.you.x, Math.round(x * 100) / 100);
});

test('bad tokens are rejected and a second login replaces the first', async () => {
  const store = new MemoryStore();
  const world = new World({ build: 'test', store, requireLogin: true });
  const bad = fakeClient();
  world.connect(bad);
  await world.handle(bad, { t: 'hello', name: 'X', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'nope' });
  assert.equal(bad.inbox[0].t, 'reject');
  const guest = fakeClient();
  world.connect(guest);
  await world.handle(guest, { t: 'hello', name: 'G', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild() });
  assert.equal(guest.inbox[0].t, 'reject'); // login required
  const a = fakeClient(), b = fakeClient();
  world.connect(a); world.connect(b);
  await world.handle(a, { t: 'hello', name: 'Anna', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:u2' });
  await world.handle(b, { t: 'hello', name: 'Anna', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:u2' });
  assert.equal(a.closed, 'replaced');
  assert.equal(world.players.size, 1);
});

// ------------------------------------------------------------------ gameplay systems
import { ITEMS, NPC_BY_ID, STATION_BY_ID, VEIN_BY_ID, VEIN_TYPES, TREE_BY_ID, MOBS, INN, CAVE_ENTRANCE, CAVE_START, QUEST_BY_ID, countItem, xpForLevel, isFishable, LAKE, heightAt as h } from '@kontor/shared';
import { PORTAL_BY_ID, regionAt, STATIONS, HOMES, innDoor, innRoomAt } from '@kontor/shared';
import { damageMob } from '../src/combat.js';

function game(random: () => number = () => 0.5, store?: MemoryStore) {
  let t = 2_000_000;
  const world = new World({ build: 'test', now: () => t, random, store });
  const c = fakeClient();
  world.connect(c);
  world.handle(c, { t: 'hello', name: 'Tester', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild() });
  const id = (c.inbox.find((m) => m.t === 'welcome') as any).id as string;
  const p = world.inspect(id)!;
  const place = (x: number, z: number) => { const y = h(x, z); Object.assign(p.state, { x, y, z }); p.lastValid = { x, y, z, at: t }; };
  const last = <T extends ServerMsg['t']>(k: T) => c.inbox.filter((m) => m.t === k).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
  const at = (npc: string) => { const n = NPC_BY_ID.get(npc)!; place(n.x + 1.2, n.z + 1.2); };
  return { world, c, p, place, last, at, advance: (ms: number) => (t += ms), now: () => t };
}

test('new characters start with 16 empty slots, 30 gold and no tools', () => {
  const { last } = game();
  const inv = last('inv')!;
  assert.equal(inv.bag.length, 16);
  assert.equal(inv.gold, 30);
  assert.deepEqual(inv.equip, {});
});

test('buy a pickaxe from Ingrid, equip it, mine; vein wear is shared and it depletes', () => {
  const { world, c, p, place, last, at, advance } = game();
  at('ingrid');
  world.handle(c, { t: 'buy', npc: 'ingrid', item: 'stone_pickaxe' });
  assert.equal(p.gold, 20);
  world.handle(c, { t: 'equip', index: p.bag.findIndex((s) => s?.id === 'stone_pickaxe') });
  assert.equal(p.equip.pickaxe?.id, 'stone_pickaxe');
  const vein = VEIN_BY_ID.get('camp-0')!;
  place(vein.x + 1.5, vein.z);
  world.handle(c, { t: 'mine', node: vein.id });
  const n = last('node')!;
  assert.equal(n.id, vein.id);
  assert.equal(n.left, n.total - 1);
  for (let i = 0; i < 10 && !world.nodes.get(vein.id)?.until; i++) { advance(3000); world.handle(c, { t: 'mine', node: vein.id }); }
  assert.deepEqual(last('nodes')!.depleted, [[vein.id, 1]]);
  assert.equal(countItem(p.bag, 'stone'), n.total);
  advance(VEIN_TYPES.stone.respawnSec[1] * 1000 + 1000); world.step();
  assert.deepEqual(last('nodes')!.depleted, [[vein.id, 0]]);
});

test('trees are chopped with a hatchet and fall when depleted', () => {
  const { world, c, p, place, last, advance } = game();
  p.equip.hatchet = { id: 'stone_hatchet', qty: 1 };
  world.recompute(p);
  const tree = [...TREE_BY_ID.values()].find((x) => x.kind === 'birch')!;
  place(tree.x + 1.2, tree.z);
  for (let i = 0; i < 10 && !world.nodes.get(tree.id)?.until; i++) { advance(3000); world.handle(c, { t: 'chop', node: tree.id }); }
  assert.ok(countItem(p.bag, 'birch_log') >= 3);
  assert.deepEqual(last('nodes')!.depleted, [[tree.id, 1]]);
});

test('drop and pick up: items go to the ground and back', () => {
  const { world, c, p, last } = game();
  p.bag[0] = { id: 'stone', qty: 7 };
  world.handle(c, { t: 'drop', index: 0, qty: 7 });
  assert.equal(p.bag[0], null);
  const g = last('ground')!.add![0];
  assert.equal(g.item.qty, 7);
  world.handle(c, { t: 'pickup', id: g.id });
  assert.equal(countItem(p.bag, 'stone'), 7);
  assert.deepEqual(last('ground')!.remove, [g.id]);
});

test('crafting gear can roll a rarity with effects', () => {
  const { world, c, p, place, advance } = game(() => 0.001);
  const anvil = STATION_BY_ID.get('camp_anvil')!;
  place(anvil.x + 1.5, anvil.z);
  p.xp.smithing = xpForLevel(3);
  p.bag[0] = { id: 'shaped_stone', qty: 4 };
  world.handle(c, { t: 'craft', recipe: 'stone_sword', count: 1, station: anvil.id });
  advance(4000); world.step();
  const sword = p.bag.find((s) => s?.id === 'stone_sword')!;
  assert.equal(sword.r, 3); // 0.001 < epic threshold
  assert.equal(sword.fx!.length, 3);
});

test('cooking can burn; stations must match the recipe', () => {
  const { world, c, p, place, last, advance } = game(() => 0.01);
  const anvil = STATION_BY_ID.get('camp_anvil')!;
  p.bag[0] = { id: 'raw_perch', qty: 2 };
  place(anvil.x + 1, anvil.z);
  world.handle(c, { t: 'craft', recipe: 'cooked_perch', count: 1, station: anvil.id });
  assert.equal(last('job'), undefined);
  const fire = STATION_BY_ID.get('camp_fire')!;
  place(fire.x + 1.2, fire.z);
  world.handle(c, { t: 'craft', recipe: 'cooked_perch', count: 2, station: fire.id });
  advance(2500); world.step(); advance(2500); world.step();
  assert.equal(countItem(p.bag, 'burnt_fish'), 2); // rand 0.01 < 40% burn chance
});

test('fishing: cast, wait for a bite, reel in', () => {
  const { world, c, p, place, last, advance } = game();
  p.equip.rod = { id: 'basic_rod', qty: 1 };
  world.recompute(p);
  // Stand on the shore, cast into deep water.
  let sx = LAKE.x, sz = LAKE.z;
  for (let d = 0; d < 60; d += 0.5) { if (h(LAKE.x + d, LAKE.z) > 0.4) { sx = LAKE.x + d; break; } }
  place(sx, sz);
  let cx = sx - 6; while (!isFishable(cx, sz)) cx -= 1;
  world.handle(c, { t: 'cast', x: cx, z: sz });
  assert.equal((last('fish') as any).state, 'cast');
  world.handle(c, { t: 'reel', ok: true }); // too early: scares the fish
  assert.equal((last('fish') as any).state, 'lost');
  world.handle(c, { t: 'cast', x: cx, z: sz });
  advance(20_000); world.step();
  assert.equal((last('fish') as any).state, 'bite');
  advance(3000);
  world.handle(c, { t: 'reel', ok: true });
  assert.equal((last('fish') as any).state, 'caught');
  assert.ok(countItem(p.bag, 'raw_perch') >= 1);
});

test('combat: kill a wolf, get XP and loot on the ground; wolves fight back', () => {
  const { world, c, p, place, last, advance } = game(() => 0.3);
  p.equip.mainHand = { id: 'stone_sword', qty: 1 };
  world.recompute(p);
  const wolf = [...world.mobs.values()].find((m) => m.def.kind === 'wolf')!;
  place(wolf.x + 1.5, wolf.z);
  for (let i = 0; i < 40 && !wolf.dead; i++) {
    world.handle(c, { t: 'attack', target: wolf.id, special: false });
    advance(1700); world.step();
    place(wolf.x + 1.2, wolf.z);
  }
  assert.ok(wolf.dead);
  assert.equal(p.xp.combat, MOBS.wolf.xp);
  assert.ok(c.inbox.some((m) => m.t === 'hit' && m.to === p.state.id), 'the wolf hit back');
  void last;
});

test('dying knocks you out; respawn at camp, weakened', () => {
  const { world, c, p } = game();
  world.kill(p, 'a test');
  assert.ok(p.dead);
  world.handle(c, { t: 'mine', node: 'camp-0' }); // ignored while dead
  world.handle(c, { t: 'respawn' });
  assert.ok(!p.dead && p.hp > 0);
  assert.ok(Math.hypot(p.state.x, p.state.z) < 6);
  assert.ok(p.buffs.some((b) => b.name === 'Weakened'));
});

test('a fire staff burns and Ignite needs burning targets', () => {
  const { world, c, p, place, advance } = game(() => 0.9);
  p.equip.mainHand = { id: 'birch_fire_staff', qty: 1 };
  world.recompute(p);
  const wolf = [...world.mobs.values()].find((m) => m.def.kind === 'wolf')!;
  place(wolf.x + 8, wolf.z);
  world.handle(c, { t: 'attack', target: wolf.id, special: true });
  assert.match((c.inbox.filter((m) => m.t === 'notice').at(-1) as any).text, /burning/);
  world.handle(c, { t: 'attack', target: wolf.id, special: false });
  advance(500); world.step();
  assert.equal(wolf.burn?.stacks, 1);
});

test('quests: accept, deliver, reward, then locked until the reset', () => {
  const { world, c, p, at, last } = game();
  const q = QUEST_BY_ID.get('mats_stone')!;
  at('mats');
  world.handle(c, { t: 'quest', quest: q.id, op: 'accept' });
  p.bag[0] = { id: 'stone', qty: 10 };
  world.handle(c, { t: 'quest', quest: q.id, op: 'turnin' });
  assert.equal(p.gold, 30 + q.reward.gold);
  assert.ok((p.xp.mining ?? 0) >= q.reward.xp[1]);
  world.handle(c, { t: 'quest', quest: q.id, op: 'accept' });
  assert.match(last('notice')!.text, /resets/);
});

test('the inn: rent one room, extend it, store items', () => {
  const { world, c, p, at, last, place } = game();
  p.gold = 200;
  at('hilde');
  world.handle(c, { t: 'rent', weeks: 1 });
  assert.equal(p.lease?.room, 0);
  assert.equal(p.gold, 200 - INN.pricePerWeek);
  world.handle(c, { t: 'rent', weeks: 1 });
  assert.equal(p.lease?.room, 0, 'extending keeps the same room');
  world.handle(c, { t: 'rent', weeks: 4 });
  world.handle(c, { t: 'rent', weeks: 1 });
  assert.match(last('notice')!.text, /at most 4/);
  p.bag[0] = { id: 'iron_bar', qty: 5 };
  place(HOMES[0].chest.x, HOMES[0].chest.z);
  world.handle(c, { t: 'storage', op: 'put', index: 0, qty: 5 });
  assert.equal(countItem(p.storage, 'iron_bar'), 5);
  assert.deepEqual(last('rooms')!.taken[0], 'Tester');
});

test('talents need levels; the root needs 3 ranks first', () => {
  const { world, c, p, last } = game();
  world.handle(c, { t: 'talent', tree: 'mining', node: 'prospector' });
  assert.match(last('notice')!.text, /level up/);
  p.xp.mining = xpForLevel(6);
  for (let i = 0; i < 3; i++) world.handle(c, { t: 'talent', tree: 'mining', node: 'prospector' });
  world.handle(c, { t: 'talent', tree: 'mining', node: 'steady_swing' });
  assert.deepEqual(p.talents.mining, { prospector: 3, steady_swing: 1 });
  assert.ok(p.stats.scoped.mining.miningSpeed > p.stats.all.miningSpeed);
});

test('the cave: walk into the entrance to travel', () => {
  const { world, c, p, place } = game();
  place(CAVE_ENTRANCE.x, CAVE_ENTRANCE.z + 1);
  world.handle(c, { t: 'travel', portal: 'cave' });
  assert.ok(Math.hypot(p.state.x - CAVE_START.x, p.state.z - CAVE_START.z) < 0.1);
});

test('imbuing turns a plain staff into a fire staff for a gem and gold', () => {
  const { world, c, p, at } = game();
  p.gold = 100;
  p.bag[0] = { id: 'birch_staff', qty: 1, r: 1, fx: [['magicDmg', 0.05]] };
  p.bag[1] = { id: 'quartz', qty: 1 };
  at('ragna');
  world.handle(c, { t: 'imbue', index: 0, element: 'fire' });
  assert.equal(p.bag[0]?.id, 'birch_fire_staff');
  assert.equal(p.bag[0]?.r, 1);
  assert.equal(p.gold, 75);
});

test('two-handers take the shield off', () => {
  const { world, c, p } = game();
  p.equip.offHand = { id: 'stone_kite_shield', qty: 1 };
  p.bag[0] = { id: 'stone_longsword', qty: 1 };
  world.handle(c, { t: 'equip', index: 0 });
  assert.equal(p.equip.mainHand?.id, 'stone_longsword');
  assert.equal(p.equip.offHand, undefined);
  assert.equal(countItem(p.bag, 'stone_kite_shield'), 1);
});

test('everything is saved and loaded', async () => {
  const store = new MemoryStore();
  const world = new World({ build: 'test', store });
  const c = fakeClient();
  world.connect(c);
  await world.handle(c, { t: 'hello', name: 'Saver', color: 0, proto: PROTOCOL_VERSION, build: { ...defaultBuild(), race: 'ogre' }, token: 'dev:s1' });
  const p = world.inspect((c.inbox.find((m) => m.t === 'welcome') as any).id)!;
  p.bag[3] = { id: 'iron_bar', qty: 7 }; p.equip.pickaxe = { id: 'iron_pickaxe', qty: 1, r: 2, fx: [['luck', 4]] }; p.gold = 42; p.xp.mining = xpForLevel(5);
  p.talents = { mining: { prospector: 3 } }; p.quests = { mats_stone: { done: 'x' } }; p.storage[0] = { id: 'quartz', qty: 2 };
  world.disconnect(c);
  await new Promise((r) => setTimeout(r, 0));
  const c2 = fakeClient();
  world.connect(c2);
  await world.handle(c2, { t: 'hello', name: 'Saver', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:s1' });
  const q = world.inspect((c2.inbox.find((m) => m.t === 'welcome') as any).id)!;
  assert.equal(q.build.race, 'ogre');
  assert.equal(countItem(q.bag, 'iron_bar'), 7);
  assert.deepEqual(q.equip.pickaxe, { id: 'iron_pickaxe', qty: 1, r: 2, fx: [['luck', 4]] });
  assert.equal(q.gold, 42);
  assert.deepEqual(q.talents, { mining: { prospector: 3 } });
  assert.equal(q.quests.mats_stone.done, 'x');
  assert.equal(countItem(q.storage, 'quartz'), 2);
});

void ITEMS;

test('skinning: needs a knife, can ruin the hide, the body goes away, the knife wears out and can be repaired', () => {
  let r = 0.95;
  const { world, c, p, place, last, advance } = game(() => r);
  const wolf = [...world.mobs.values()].find((m) => m.def.kind === 'wolf')!;
  world.kill; // (players can die; here the wolf does)
  wolf.hp = 1;
  p.equip.mainHand = { id: 'stone_sword', qty: 1 };
  world.recompute(p);
  place(wolf.x + 1.2, wolf.z);
  world.handle(c, { t: 'attack', target: wolf.id, special: false });
  assert.ok(wolf.dead);
  world.step();
  const snap = last('snap')!;
  assert.equal(snap.mobs.find((m) => m.id === wolf.id)?.sk, 1, 'the body can be skinned');
  assert.ok(!last('ground')?.add?.some((g) => g.item.id === 'wolf_pelt'), 'no pelts without skinning');
  world.handle(c, { t: 'skin', target: wolf.id });
  assert.match(last('notice')!.text, /skinning knife/);
  p.equip.knife = { id: 'stone_skinning_knife', qty: 1, d: 1 };
  r = 0.5; // > 35% fail chance: success
  world.handle(c, { t: 'skin', target: wolf.id });
  assert.ok(countItem(p.bag, 'wolf_pelt') >= 1);
  assert.equal(p.equip.knife.d, 0);
  world.handle(c, { t: 'skin', target: wolf.id });
  assert.match(last('notice')!.text, /nothing left/);
  world.step();
  assert.equal(last('snap')!.mobs.find((m) => m.id === wolf.id)?.sk, undefined, 'gone once skinned');
  // Repair at the anvil for a shaped stone.
  const anvil = STATION_BY_ID.get('camp_anvil')!;
  place(anvil.x + 1.2, anvil.z);
  p.bag[5] = { id: 'shaped_stone', qty: 1 };
  world.handle(c, { t: 'repair', slot: 'knife' });
  assert.equal(p.equip.knife.d, 12);
  void advance;
});

test('a ruined hide gives nothing; bodies vanish after 30 s', () => {
  let r = 0.95;
  const { world, c, p, place, last, advance } = game(() => r);
  const wolf = [...world.mobs.values()].find((m) => m.def.kind === 'wolf')!;
  wolf.hp = 1;
  place(wolf.x + 1.2, wolf.z);
  world.handle(c, { t: 'attack', target: wolf.id, special: false });
  p.equip.knife = { id: 'stone_skinning_knife', qty: 1, d: 5 };
  r = 0.1; // < 35%: ruined
  world.handle(c, { t: 'skin', target: wolf.id });
  assert.equal(countItem(p.bag, 'wolf_pelt'), 0);
  assert.match(last('notice')!.text, /ruined/);
  const wolf2 = [...world.mobs.values()].filter((m) => m.def.kind === 'wolf')[1];
  wolf2.hp = 1;
  place(wolf2.x + 1.2, wolf2.z);
  world.handle(c, { t: 'attack', target: wolf2.id, special: false });
  advance(31_000); world.step();
  assert.equal(last('snap')!.mobs.find((m) => m.id === wolf2.id)?.sk, undefined);
});

test('leather: tan pelts at the tanning rack, then make armour; Ingrid no longer sells leather', () => {
  const { world, c, p, place, advance } = game();
  assert.ok(!NPC_BY_ID.get('ingrid')!.sells!.some((i) => i.startsWith('leather_') && i !== 'leather_backpack'));
  const rack = STATION_BY_ID.get('camp_tanning')!;
  place(rack.x + 1.3, rack.z);
  p.bag[0] = { id: 'wolf_pelt', qty: 2 };
  world.handle(c, { t: 'craft', recipe: 'leather', count: 2, station: rack.id });
  advance(3000); world.step(); advance(3000); world.step();
  assert.equal(countItem(p.bag, 'leather'), 2);
  world.handle(c, { t: 'craft', recipe: 'leather_gauntlets', count: 1, station: rack.id });
  advance(4000); world.step();
  assert.equal(countItem(p.bag, 'leather_gauntlets'), 1);
});

test('the pier is walkable ground', async () => {
  const { PIER, checkStep, groundAt } = await import('@kontor/shared');
  const end = { x: PIER.x + PIER.ux * (PIER.length - 1), z: PIER.z + PIER.uz * (PIER.length - 1) };
  assert.equal(groundAt(end.x, end.z), PIER.deck);
  assert.ok(checkStep({ ...end, y: PIER.deck }, { ...end, y: PIER.deck }, 0.1).ok);
});

test('no eating to heal for 10 s after taking damage', () => {
  const { world, c, p, last, advance } = game();
  p.bag[0] = { id: 'cooked_wolf_meat', qty: 2 };
  p.hp = 5;
  p.lastHurtAt = world.now();
  world.handle(c, { t: 'eat', index: 0 });
  assert.match(last('notice')!.text, /fight/);
  assert.equal(p.hp, 5);
  advance(10_500);
  world.handle(c, { t: 'eat', index: 0 });
  assert.ok(p.hp > 5);
});

test('loot is free for all: another player can pick up a monster drop straight away', () => {
  const { world, c, p, place } = game();
  const wolf = [...world.mobs.values()].find((m) => m.def.kind === 'wolf')!;
  place(wolf.x + 1, wolf.z);
  damageMob(world, wolf, 9999, p.state.id, world.now());
  const c2 = fakeClient();
  world.connect(c2);
  world.handle(c2, { t: 'hello', name: 'Other', color: 1, proto: PROTOCOL_VERSION, build: defaultBuild() });
  const q = world.inspect((c2.inbox.find((m) => m.t === 'welcome') as any).id)!;
  const g = [...world.ground.values()][0];
  assert.ok(g, 'the wolf dropped something');
  Object.assign(q.state, { x: g.x, z: g.z, y: g.y });
  const gold = q.gold, bagBefore = q.bag.filter(Boolean).length;
  world.handle(c2, { t: 'pickup', id: g.id });
  assert.ok(!world.ground.has(g.id));
  assert.ok(q.gold > gold || q.bag.filter(Boolean).length > bagBefore);
});

test('world state survives a restart: depleted nodes, boss timers, ground items', async () => {
  const store = new MemoryStore();
  const { world, p } = game(() => 0.5, store);
  world.nodes.set('camp-0', { left: 0, total: 5, until: world.now() + 3_600_000 });
  const knut = world.mobs.get('knut')!;
  damageMob(world, knut, 99999, p.state.id, world.now());
  world.spawnGround({ id: 'stone', qty: 3 }, 1, 2, 300);
  await world.saveWorld();
  const fresh = new World({ build: 'test', store, now: () => world.now() + 1000 });
  await fresh.loadWorld();
  assert.equal(fresh.nodes.get('camp-0')?.left, 0);
  assert.ok(fresh.mobs.get('knut')!.dead);
  assert.equal(fresh.mobs.get('knut')!.respawnAt, knut.respawnAt);
  assert.ok([...fresh.ground.values()].some((g) => g.item.id === 'stone' && g.item.qty === 3));
});

test('Gruben: the pass needs level 12, then takes you there and back', () => {
  const { world, c, p, place, last } = game();
  const pass = PORTAL_BY_ID.get('gruben')!;
  place(pass.at.x, pass.at.z);
  world.handle(c, { t: 'travel', portal: 'gruben' });
  assert.match(last('notice')!.text, /level 12/);
  p.xp.combat = xpForLevel(12);
  world.handle(c, { t: 'travel', portal: 'gruben' });
  assert.equal(regionAt(p.state.x, p.state.z), 'gruben');
  const back = PORTAL_BY_ID.get('gruben_out')!;
  place(back.at.x, back.at.z);
  world.handle(c, { t: 'travel', portal: 'gruben_out' });
  assert.equal(regionAt(p.state.x, p.state.z), 'valley');
});

test('steel: smelt iron ore with coal', () => {
  const { world, c, p, place, advance } = game();
  p.xp.smithing = xpForLevel(16);
  p.bag[0] = { id: 'iron_ore', qty: 2 }; p.bag[1] = { id: 'coal', qty: 2 };
  const f = STATIONS.find((s) => s.kind === 'furnace')!;
  place(f.x + 1.5, f.z);
  world.handle(c, { t: 'craft', recipe: 'steel_bar', count: 1, station: f.id });
  for (let i = 0; i < 40; i++) { advance(100); world.step(); }
  assert.equal(countItem(p.bag, 'steel_bar'), 1);
});

test('housing: rent a cottage at its door, move your chest from the lodge, rest for a buff', () => {
  const { world, c, p, at, place, last } = game();
  p.gold = 500;
  at('hilde');
  world.handle(c, { t: 'rent', weeks: 1 });
  assert.equal(HOMES[p.lease!.room].kind, 'room');
  p.bag[0] = { id: 'stone', qty: 5 };
  // The chest is inside the room, at the foot of the bed — not at Hilde's counter.
  world.handle(c, { t: 'storage', op: 'put', index: 0, qty: 5 });
  assert.equal(countItem(p.storage, 'stone'), 0);
  const chest = HOMES[p.lease!.room].chest;
  place(chest.x, chest.z);
  world.handle(c, { t: 'storage', op: 'put', index: 0, qty: 5 });
  assert.equal(countItem(p.storage, 'stone'), 5);
  const cot = HOMES.find((h) => h.kind === 'cottage')!;
  // Must be at the cottage, and pay its price.
  world.handle(c, { t: 'rent', weeks: 1, home: cot.id });
  assert.match(last('notice')!.text, /Go to the/);
  place(cot.door.x, cot.door.z);
  const gold = p.gold;
  world.handle(c, { t: 'rent', weeks: 1, home: cot.id });
  assert.equal(p.lease!.room, cot.id);
  assert.equal(gold - p.gold, cot.price);
  assert.equal(countItem(p.storage, 'stone'), 5, 'the chest moved too');
  assert.equal(world.rooms.filter(Boolean).length, 1, 'the lodge room was given up');
  // Cottage chests hold more than lodge rooms.
  for (let i = 0; i < 30; i++) { p.bag[0] = { id: 'iron_sword', qty: 1, r: 1 }; world.handle(c, { t: 'storage', op: 'put', index: 0, qty: 1 }); }
  assert.ok(p.storage.filter(Boolean).length > 24);
  world.handle(c, { t: 'rest' });
  assert.ok(p.buffs.some((b) => b.name === 'Rested' && b.stats.xp === cot.rest.xp));
  // Someone else can't take it.
  const c2 = fakeClient(); world.connect(c2);
  world.handle(c2, { t: 'hello', name: 'Other', color: 1, proto: PROTOCOL_VERSION, build: defaultBuild() });
  const q = world.inspect((c2.inbox.find((m) => m.t === 'welcome') as any).id)!;
  q.gold = 500; Object.assign(q.state, { x: cot.door.x, z: cot.door.z });
  world.handle(c2, { t: 'rent', weeks: 1, home: cot.id });
  assert.notEqual(q.lease?.room, cot.id);
});

test('lodge rooms: only the tenant opens the door; nobody else walks into a closed room', () => {
  const { world, c, p, at, place, advance } = game();
  p.gold = 100;
  at('hilde');
  world.handle(c, { t: 'rent', weeks: 1 });
  const n = p.lease!.room;
  const door = innDoor(n);
  const c2 = fakeClient(); world.connect(c2);
  world.handle(c2, { t: 'hello', name: 'Nosy', color: 1, proto: PROTOCOL_VERSION, build: defaultBuild() });
  const q = world.inspect((c2.inbox.find((m) => m.t === 'welcome') as any).id)!;
  const outside = { x: door.x, z: door.z + 0.8 };
  Object.assign(q.state, { x: outside.x, z: outside.z, y: h(outside.x, outside.z) });
  q.lastValid = { x: outside.x, y: h(outside.x, outside.z), z: outside.z, at: world.now() };
  // The other player can't open it, and can't step in while it's closed.
  world.handle(c2, { t: 'door', home: n });
  assert.equal(world.doorsOpen.has(n), false);
  advance(400);
  const inside = { x: door.x, z: door.z - 1.2 };
  world.handle(c2, { t: 'input', seq: 1, x: inside.x, y: h(inside.x, inside.z), z: inside.z, yaw: 0, pitch: 0 });
  assert.ok(c2.inbox.some((m) => m.t === 'correct' && m.reason === 'locked'));
  // The tenant opens it; now it's passable.
  place(door.x, door.z + 0.5);
  world.handle(c, { t: 'door', home: n });
  assert.equal(world.doorsOpen.has(n), true);
  advance(400);
  world.handle(c2, { t: 'input', seq: 2, x: inside.x, y: h(inside.x, inside.z), z: inside.z, yaw: 0, pitch: 0 });
  assert.equal(innRoomAt(q.state.x, q.state.z), n);
  // But only the tenant can use the chest.
  q.bag[0] = { id: 'stone', qty: 1 };
  world.handle(c2, { t: 'storage', op: 'put', index: 0, qty: 1 });
  assert.equal(countItem(p.storage, 'stone'), 0);
});
