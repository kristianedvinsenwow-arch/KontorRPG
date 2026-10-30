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
  assert.equal(base.bagBonus, 0);
  const mule = derive({ ...defaultBuild(), major: 'pack_mule' });
  assert.equal(mule.bagBonus, 4);
  assert.ok(maxSpeed(1, mule.speedBonus) < maxSpeed());
  const gifted = derive({ ...defaultBuild(), major: 'gifted' });
  assert.equal(gifted.attrs.str, 6);
  const tough = derive({ ...defaultBuild(), minor: 'thick_skin' });
  assert.equal(tough.maxHp, 30);
});

import { clockXpMult, RACES } from '../src/index.js';

test('clock perks use the agreed hours', () => {
  assert.equal(clockXpMult('morning_person', 7), 1.1);
  assert.equal(clockXpMult('morning_person', 15.9), 1.1);
  assert.equal(clockXpMult('morning_person', 16), 0.95);
  assert.equal(clockXpMult('morning_person', 21), 1);
  assert.equal(clockXpMult('overtime', 16), 1.1);
  assert.equal(clockXpMult('overtime', 0.5), 1.1); // wraps past midnight
  assert.equal(clockXpMult('overtime', 1), 1);
  assert.equal(clockXpMult('overtime', 9), 0.95);
});

test('three races, from tallest to smallest', () => {
  assert.deepEqual(Object.keys(RACES), ['human', 'dwarf', 'gnome']);
  assert.ok(RACES.human.height > RACES.dwarf.height && RACES.dwarf.height > RACES.gnome.height);
  assert.ok(RACES.dwarf.width > RACES.human.width);
});

import { EQUIP_SLOTS, BARS_PER_ITEM } from '../src/index.js';

test('shoulders are an equipment slot and full armour costs 48 bars', () => {
  assert.ok(EQUIP_SLOTS.some((s) => s.slot === 'shoulders'));
  const armour = ['helmet', 'shoulders', 'chestplate', 'legs', 'gloves', 'boots'].reduce((n, k) => n + BARS_PER_ITEM[k], 0);
  assert.equal(armour, 48);
});

import { addItem, removeItem, countItem, emptyBag, roomFor, resizeBag, levelFromXp, xpForLevel, VEINS, VEIN_TYPES, RECIPES, ITEMS, swingSeconds, sanitiseBag } from '../src/index.js';

test('bag stacks ores to 10 and gems to 5', () => {
  const bag = emptyBag(16);
  assert.equal(addItem(bag, 'stone', 25), 0);
  assert.deepEqual(bag.slice(0, 3).map((s) => s?.qty), [10, 10, 5]);
  addItem(bag, 'quartz', 7);
  assert.equal(bag.filter((s) => s?.id === 'quartz').length, 2);
  assert.equal(countItem(bag, 'stone'), 25);
  assert.ok(removeItem(bag, 'stone', 12));
  assert.equal(countItem(bag, 'stone'), 13);
  assert.equal(removeItem(bag, 'stone', 99), false);
  assert.equal(countItem(bag, 'stone'), 13);
});

test('a full bag rejects the overflow', () => {
  const bag = emptyBag(2);
  assert.equal(addItem(bag, 'stone', 25), 5);
  assert.equal(roomFor(bag, 'stone'), 0);
  assert.equal(resizeBag(bag, 1), null);
  assert.equal(resizeBag(bag, 4)?.length, 4);
});

test('XP curve: 10 × L² per level', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(9), 1);
  assert.equal(levelFromXp(10), 2);
  assert.equal(xpForLevel(10), 2850);
  assert.equal(levelFromXp(2850), 10);
});

test('veins exist, are on land, and include a starter cluster near camp', () => {
  assert.ok(VEINS.filter((v) => v.type === 'stone').length >= 15);
  assert.ok(VEINS.filter((v) => v.type === 'iron').length >= 6);
  assert.ok(VEINS.some((v) => v.id.startsWith('camp-')));
  for (const v of VEINS) assert.ok(v.y > 0.5);
  for (const t of Object.values(VEIN_TYPES)) assert.ok(ITEMS[t.item] && ITEMS[t.gem.item]);
});

test('every recipe uses real items; iron recipes need a lower-tier part', () => {
  for (const r of RECIPES) for (const i of [...r.inputs, r.output]) assert.ok(ITEMS[i.item], i.item);
  for (const r of RECIPES.filter((x) => x.id.startsWith('iron_') && x.id !== 'iron_bar')) assert.ok(r.inputs.some((i) => i.item === 'shaped_stone'));
});

test('swings get faster with level and Hardrock', () => {
  assert.ok(swingSeconds(2.6, 20, 0) < swingSeconds(2.6, 1, 0));
  assert.ok(swingSeconds(2.6, 1, 0.2) < swingSeconds(2.6, 1, 0));
});

test('stored bags are sanitised', () => {
  const bag = sanitiseBag([{ id: 'stone', qty: 3 }, { id: 'nope', qty: 1 }, { id: 'quartz', qty: -2 }], 16);
  assert.equal(countItem(bag, 'stone'), 3);
  assert.equal(bag.filter(Boolean).length, 1);
});
