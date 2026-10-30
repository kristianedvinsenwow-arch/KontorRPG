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
