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
