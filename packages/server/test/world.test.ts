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

// ------------------------------------------------------------------ M1: mining, smithing, trading
import { ITEMS, STATIONS, TRADING_POST, VEIN_BY_ID, VEIN_TYPES, countItem, xpForLevel } from '@kontor/shared';

function m1() {
  let t = 2_000_000;
  const world = new World({ build: 'test', now: () => t, random: () => 0.5 });
  const c = fakeClient();
  world.connect(c);
  world.handle(c, { t: 'hello', name: 'Miner', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild() });
  const id = (c.inbox.find((m) => m.t === 'welcome') as any).id as string;
  const p = world.inspect(id)!;
  const place = (x: number, z: number) => { const y = heightAt(x, z); Object.assign(p.state, { x, y, z }); p.lastValid = { x, y, z, at: t }; };
  const last = <T extends ServerMsg['t']>(k: T) => c.inbox.filter((m) => m.t === k).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
  return { world, c, p, place, last, advance: (ms: number) => (t += ms) };
}

test('new characters start with 16 empty slots, 15 gold and no pickaxe', () => {
  const { last } = m1();
  const inv = last('inv')!;
  assert.equal(inv.bag.length, 16);
  assert.equal(inv.gold, 15);
  assert.equal(inv.equip.tool, undefined);
});

test('you cannot mine without a pickaxe; buy one at the trading post and equip it', () => {
  const { world, c, p, place, last } = m1();
  const vein = VEIN_BY_ID.get('camp-0')!;
  place(vein.x + 1.5, vein.z);
  world.handle(c, { t: 'mine', node: vein.id });
  assert.match(last('notice')!.text, /pickaxe/);
  world.handle(c, { t: 'buy', item: 'stone_pickaxe' });
  assert.match(last('notice')!.text, /trading post/); // too far away
  place(TRADING_POST.x + 1, TRADING_POST.z);
  world.handle(c, { t: 'buy', item: 'stone_pickaxe' });
  assert.equal(last('inv')!.gold, 5);
  world.handle(c, { t: 'equip', index: p.bag.findIndex((s) => s?.id === 'stone_pickaxe') });
  assert.equal(p.equip.tool, 'stone_pickaxe');
  assert.equal(p.state.gear?.t, 'stone_pickaxe');
  assert.equal(countItem(p.bag, 'stone_pickaxe'), 0);
});

test('mining respects the swing timer, gives stone and XP, and depletes the vein for everyone', () => {
  const { world, c, p, place, last, advance } = m1();
  p.equip.tool = 'stone_pickaxe';
  const vein = VEIN_BY_ID.get('camp-0')!;
  place(vein.x + 1.5, vein.z);
  world.handle(c, { t: 'mine', node: vein.id });
  world.handle(c, { t: 'mine', node: vein.id }); // too soon: ignored
  assert.equal(countItem(p.bag, 'stone'), 1);
  assert.equal(p.xp.mining, VEIN_TYPES.stone.xp);
  let swings = 1;
  while (!last('nodes')?.depleted.some(([id, s]) => id === vein.id && s > 0)) { advance(3000); world.handle(c, { t: 'mine', node: vein.id }); swings++; assert.ok(swings < 10); }
  assert.equal(countItem(p.bag, 'stone'), swings);
  advance(3000);
  world.handle(c, { t: 'mine', node: vein.id });
  assert.match(last('notice')!.text, /depleted/);
  advance(VEIN_TYPES.stone.respawnSec * 1000);
  world.step();
  assert.deepEqual(last('nodes')!.depleted, [[vein.id, 0]]);
});

test('iron veins need Mining 8, and mining from far away is refused', () => {
  const { world, c, p, place, last } = m1();
  p.equip.tool = 'stone_pickaxe';
  const iron = [...VEIN_BY_ID.values()].find((v) => v.type === 'iron')!;
  place(iron.x + 10, iron.z);
  world.handle(c, { t: 'mine', node: iron.id });
  assert.match(last('notice')!.text, /far/);
  place(iron.x + 1.2, iron.z);
  world.handle(c, { t: 'mine', node: iron.id });
  assert.match(last('notice')!.text, /Mining 8/);
  p.xp.mining = xpForLevel(8);
  world.handle(c, { t: 'mine', node: iron.id });
  assert.equal(countItem(p.bag, 'iron_ore'), 1);
});

test('ores stack to 10 and a full bag stops mining', () => {
  const { world, c, p, place, last } = m1();
  p.equip.tool = 'stone_pickaxe';
  p.bag = p.bag.map(() => ({ id: 'stone', qty: 10 }));
  const vein = VEIN_BY_ID.get('camp-1')!;
  place(vein.x + 1.5, vein.z);
  world.handle(c, { t: 'mine', node: vein.id });
  assert.match(last('notice')!.text, /full/);
});

test('crafting is a timed queue at the station and stops when materials run out', () => {
  const { world, c, p, place, last, advance } = m1();
  p.bag[0] = { id: 'stone', qty: 5 };
  world.handle(c, { t: 'craft', recipe: 'shaped_stone', count: 5 });
  assert.match(last('notice')!.text, /anvil/);
  place(STATIONS.anvil.x + 1.5, STATIONS.anvil.z);
  world.handle(c, { t: 'craft', recipe: 'shaped_stone', count: 5 });
  assert.equal(last('job')!.total, 5);
  world.step();
  assert.equal(countItem(p.bag, 'shaped_stone'), 0); // not yet done
  for (let i = 0; i < 4; i++) { advance(1700); world.step(); }
  assert.equal(countItem(p.bag, 'shaped_stone'), 2);
  assert.equal(countItem(p.bag, 'stone'), 1);
  assert.equal(last('job')!.recipe, null);
  assert.match(last('notice')!.text, /Out of materials/);
  assert.equal(p.xp.smithing, 12);
});

test('recipes check Smithing level; walking away cancels the queue', () => {
  const { world, c, p, place, last, advance } = m1();
  place(STATIONS.furnace.x + 1, STATIONS.furnace.z);
  p.bag[0] = { id: 'iron_ore', qty: 10 };
  world.handle(c, { t: 'craft', recipe: 'iron_bar', count: 5 });
  assert.match(last('notice')!.text, /Smithing 8/);
  p.xp.smithing = xpForLevel(8);
  world.handle(c, { t: 'craft', recipe: 'iron_bar', count: 5 });
  advance(2100); world.step();
  assert.equal(countItem(p.bag, 'iron_bar'), 1);
  place(STATIONS.furnace.x + 20, STATIONS.furnace.z);
  advance(2100); world.step();
  assert.equal(countItem(p.bag, 'iron_bar'), 1);
  assert.equal(last('job')!.recipe, null);
});

test('a rucksack in the back slot adds bag slots; it can’t come off while those slots are full', () => {
  const { world, c, p, place } = m1();
  p.gold = 100;
  place(TRADING_POST.x + 1, TRADING_POST.z);
  world.handle(c, { t: 'buy', item: 'small_rucksack' });
  world.handle(c, { t: 'equip', index: p.bag.findIndex((s) => s?.id === 'small_rucksack') });
  assert.equal(p.bag.length, 20);
  p.bag = p.bag.map(() => ({ id: 'stone', qty: 1 }));
  world.handle(c, { t: 'unequip', slot: 'back' });
  assert.equal(p.equip.back, 'small_rucksack');
  p.bag = p.bag.map((s, i) => (i < 5 ? s : null));
  world.handle(c, { t: 'unequip', slot: 'back' });
  assert.equal(p.equip.back, undefined);
  assert.equal(p.bag.length, 16);
  assert.equal(countItem(p.bag, 'small_rucksack'), 1);
});

test('selling pays the item’s value; worthless items are refused', () => {
  const { world, c, p, place, last } = m1();
  place(TRADING_POST.x + 1, TRADING_POST.z);
  p.bag[0] = { id: 'sapphire', qty: 3 };
  p.bag[1] = { id: 'stone', qty: 4 };
  world.handle(c, { t: 'sell', index: 0, qty: 2 });
  assert.equal(p.gold, 15 + 2 * ITEMS.sapphire.sellValue);
  assert.equal(p.bag[0]?.qty, 1);
  world.handle(c, { t: 'sell', index: 1, qty: 4 });
  assert.match(last('notice')!.text, /interested/);
});

test('bag, equipment, gold and XP are saved and loaded', async () => {
  const store = new MemoryStore();
  const world = new World({ build: 'test', store });
  const c = fakeClient();
  world.connect(c);
  await world.handle(c, { t: 'hello', name: 'Saver', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:s1' });
  const id = (c.inbox.find((m) => m.t === 'welcome') as any).id;
  const p = world.inspect(id)!;
  p.bag[3] = { id: 'iron_bar', qty: 7 }; p.equip.tool = 'iron_pickaxe'; p.gold = 42; p.xp.mining = 1234;
  world.disconnect(c);
  await new Promise((r) => setTimeout(r, 0));
  const c2 = fakeClient();
  world.connect(c2);
  await world.handle(c2, { t: 'hello', name: 'Saver', color: 0, proto: PROTOCOL_VERSION, build: defaultBuild(), token: 'dev:s1' });
  const inv = c2.inbox.find((m) => m.t === 'inv') as Extract<ServerMsg, { t: 'inv' }>;
  assert.equal(countItem(inv.bag, 'iron_bar'), 7);
  assert.equal(inv.equip.tool, 'iron_pickaxe');
  assert.equal(inv.gold, 42);
  assert.equal((c2.inbox.find((m) => m.t === 'skills') as any).xp.mining, 1234);
});
