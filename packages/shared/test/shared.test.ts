import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, checkStep, decodeClient, WALK_SPEED, WORLD_HALF, LAKE, WATER_LEVEL } from '../src/index.js';

test('terrain is deterministic', () => {
  for (const [x, z] of [[0, 0], [12.5, -40], [-90, 77]]) {
    assert.equal(heightAt(x, z), heightAt(x, z));
  }
});

test('spawn clearing is flat and above water', () => {
  for (const [x, z] of [[0, 0], [5, 5], [-8, 3]]) {
    assert.ok(Math.abs(heightAt(x, z) - 2.2) < 0.01, `height at ${x},${z} = ${heightAt(x, z)}`);
  }
});

test('lake centre is below water level', () => {
  assert.ok(heightAt(LAKE.x, LAKE.z) < WATER_LEVEL);
});

test('walking speed step is accepted, teleport is rejected', () => {
  const a = { x: 0, y: heightAt(0, 0), z: 0 };
  const walk = { x: WALK_SPEED * 0.1, y: heightAt(WALK_SPEED * 0.1, 0), z: 0 };
  assert.ok(checkStep(a, walk, 0.1).ok);
  const tele = { x: 30, y: heightAt(30, 0), z: 0 };
  assert.equal(checkStep(a, tele, 0.1).reason, 'too_fast');
});

test('flying and leaving the world are rejected', () => {
  const a = { x: 0, y: heightAt(0, 0), z: 0 };
  assert.equal(checkStep(a, { x: 0, y: a.y + 20, z: 0 }, 0.1).reason, 'flying');
  assert.equal(checkStep(a, { x: WORLD_HALF + 5, y: 0, z: 0 }, 10).reason, 'out_of_bounds');
});

test('decodeClient drops malformed input', () => {
  assert.equal(decodeClient('not json'), null);
  assert.equal(decodeClient(JSON.stringify({ t: 'input', x: 'a' })), null);
  assert.equal(decodeClient(JSON.stringify({ t: 'nope' })), null);
  assert.deepEqual(decodeClient(JSON.stringify({ t: 'chat', text: 'hei' })), { t: 'chat', text: 'hei' });
});

import { defaultBuild, validateBuild, derive, freePoints, maxSpeed } from '../src/index.js';

test('a fresh build has 5 in every stat and is valid', () => {
  const b = defaultBuild();
  assert.deepEqual(b.attrs, { str: 5, dex: 5, int: 5, sta: 5 });
  assert.equal(freePoints(b.attrs), 0);
  assert.equal(validateBuild(b), null);
});

test('moving points keeps the build valid; adding points does not', () => {
  const b = defaultBuild();
  b.attrs.int = 2; b.attrs.str = 8;
  assert.equal(validateBuild(b), null);
  b.attrs.dex = 6;
  assert.equal(validateBuild(b), 'attr_total');
  assert.equal(validateBuild({ ...defaultBuild(), attrs: { str: 11, dex: 3, int: 3, sta: 3 } }), 'attr_str');
  assert.equal(validateBuild({ ...defaultBuild(), major: 'nope' }), 'major');
  assert.equal(validateBuild({ ...defaultBuild(), race: 'dragon' }), 'race');
});

test('perks change derived stats', () => {
  const base = derive(defaultBuild());
  assert.equal(base.maxHp, 25);
  assert.equal(base.carryKg, 40);
  const mule = derive({ ...defaultBuild(), major: 'pack_mule' });
  assert.equal(mule.carryKg, 52);
  assert.ok(maxSpeed(1, mule.speedBonus) < maxSpeed());
  const gifted = derive({ ...defaultBuild(), major: 'gifted' });
  assert.equal(gifted.attrs.str, 6);
  const tough = derive({ ...defaultBuild(), minor: 'thick_skin' });
  assert.equal(tough.maxHp, 30);
});
