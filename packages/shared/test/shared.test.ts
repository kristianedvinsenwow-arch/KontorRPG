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

test('four races; ogres are the biggest, gnomes the smallest', () => {
  assert.deepEqual(Object.keys(RACES), ['human', 'dwarf', 'gnome', 'ogre']);
  assert.ok(RACES.ogre.height > RACES.human.height && RACES.ogre.belly > RACES.dwarf.belly);
  assert.ok(RACES.human.height > RACES.dwarf.height && RACES.dwarf.height > RACES.gnome.height);
  assert.ok(RACES.dwarf.width > RACES.human.width);
});

import { EQUIP_SLOTS, BARS_PER_ITEM } from '../src/index.js';

test('shoulders are an equipment slot and full armour costs 48 bars', () => {
  assert.ok(EQUIP_SLOTS.some((s) => s.slot === 'shoulders'));
  const armour = ['helm', 'pauldrons', 'breastplate', 'greaves', 'gauntlets', 'boots'].reduce((n, k) => n + BARS_PER_ITEM[k], 0);
  assert.equal(armour, 48);
});

import { addItem, removeItem, countItem, emptyBag, roomFor, resizeBag, levelFromXp, xpForLevel, VEINS, VEIN_TYPES, RECIPES, ITEMS, swingSeconds, sanitiseBag } from '../src/index.js';
import { PORTALS, PORTAL_BY_ID, regionAt, GRUBEN, groundAt, SPAWNS, RECIPE_BY_ID, recipeGroup , walkable, TREE_BY_ID } from '../src/index.js';

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
  const over = VEINS.filter((v) => !v.id.startsWith('c-') && !v.id.startsWith('g-'));
  assert.ok(over.filter((v) => v.type === 'stone').length >= 10);
  assert.ok(over.filter((v) => v.type === 'iron').length >= 6);
  assert.ok(over.length < 45, `fewer veins than M1 (${over.length})`);
  assert.ok(VEINS.some((v) => v.id.startsWith('camp-')));
  assert.ok(VEINS.some((v) => v.type === 'silver'));
  for (const v of over) assert.ok(v.y > 0.5);
  for (const t of Object.values(VEIN_TYPES)) assert.ok(ITEMS[t.item] && (!t.gem || ITEMS[t.gem.item]));
  // Coal: some in the home valley's far hotspots, more in the mine and in Gruben.
  assert.ok(over.some((v) => v.type === 'coal'));
  assert.ok(VEINS.filter((v) => v.id.startsWith('g-') && v.type === 'coal').length >= 8);
});

test('Gruben: its own walkable valley with portals both ways, veins, trees and monsters', () => {
  for (const p of PORTALS) { assert.ok(walkable(p.to.x, p.to.z), p.id); if (regionAt(p.to.x, p.to.z) !== 'cave') assert.ok(groundAt(p.to.x, p.to.z) > 0, p.id); }
  assert.equal(regionAt(PORTAL_BY_ID.get('gruben')!.to.x, PORTAL_BY_ID.get('gruben')!.to.z), 'gruben');
  assert.equal(regionAt(PORTAL_BY_ID.get('gruben_out')!.to.x, PORTAL_BY_ID.get('gruben_out')!.to.z), 'valley');
  assert.ok(!walkable(GRUBEN.x + GRUBEN.half + 1, GRUBEN.z));
  assert.ok([...TREE_BY_ID.values()].some((t) => regionAt(t.x, t.z) === 'gruben'));
  for (const k of ['lynx', 'draug', 'wisp', 'hill_troll', 'mine_king']) assert.ok(SPAWNS.some((s) => s.kind === k && regionAt(s.x, s.z) === 'gruben'), k);
  for (const v of VEINS.filter((x) => x.id.startsWith('g-'))) assert.equal(regionAt(v.x, v.z), 'gruben');
});

test('metal tiers: steel from iron + coal, silversteel from steel + silver, jewellery from silver', () => {
  assert.deepEqual(RECIPE_BY_ID.get('steel_bar')!.inputs.map((i) => i.item).sort(), ['coal', 'iron_ore']);
  assert.deepEqual(RECIPE_BY_ID.get('silversteel_bar')!.inputs.map((i) => i.item).sort(), ['silver_bar', 'steel_bar']);
  for (const t of ['steel', 'silversteel']) for (const k of ['sword', 'longsword', 'battleaxe', 'pickaxe', 'hatchet', 'skinning_knife', 'helm', 'breastplate', 'kite_shield']) assert.ok(RECIPE_BY_ID.get(`${t}_${k}`), `${t}_${k}`);
  assert.ok(ITEMS.steel_sword.dps! > ITEMS.iron_sword.dps! && ITEMS.silversteel_sword.dps! > ITEMS.steel_sword.dps!);
  assert.ok(ITEMS.silversteel_breastplate.armour! > ITEMS.steel_breastplate.armour! && ITEMS.silversteel_breastplate.ward! > 0);
  for (const id of ['silver_ring', 'garnet_necklace', 'sapphire_ring']) { assert.ok(RECIPE_BY_ID.get(id)!.inputs.some((i) => i.item === 'silver_bar')); assert.equal(recipeGroup(RECIPE_BY_ID.get(id)!), 'Jewellery'); }
  assert.equal(recipeGroup(RECIPE_BY_ID.get('silversteel_sword')!), 'Silversteel');
});

test('every recipe uses real items; iron recipes need a lower-tier part', () => {
  for (const r of RECIPES) for (const i of [...r.inputs, r.output]) assert.ok(ITEMS[i.item], i.item);
  for (const r of RECIPES.filter((x) => x.id.startsWith('iron_') && x.skill === 'smithing' && ITEMS[x.output.item].slot)) assert.ok(r.inputs.length >= 2, r.id);
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

import { rollCraftRarity, rollEffects, itemStats, computeStats, canLearn, sanitiseTalents, periodKey, caveClearance, CAVE_START, outgoing, incoming, emptyStats, isFishable } from '../src/index.js';

test('crafted gear rolls rarity; luck raises the odds; effects come from the right groups', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const count = (luck: number) => { let n = 0; for (let i = 0; i < 20000; i++) if (rollCraftRarity(luck, rand) > 0) n++; return n / 20000; };
  const base = count(0), lucky = count(25);
  assert.ok(base > 0.1 && base < 0.17, String(base));
  assert.ok(lucky > base * 1.3);
  const fx = rollEffects(ITEMS.iron_pickaxe, 3, rand);
  assert.equal(fx.length, 3);
  for (const [k] of fx) assert.ok(['miningSpeed', 'gemChance', 'luck', 'doubleYield', 'skillXp'].includes(k), k);
});

test('metal armour slows a little and lets magic in; leather speeds up', () => {
  const metal = itemStats({ id: 'iron_breastplate', qty: 1 });
  assert.ok((metal.moveSpeed ?? 0) < 0 && (metal.magicTaken ?? 0) > 0 && (metal.armour ?? 0) > 0);
  assert.ok((itemStats({ id: 'leather_breastplate', qty: 1 }).moveSpeed ?? 0) > 0);
  assert.ok((itemStats({ id: 'cloth_breastplate', qty: 1 }).ward ?? 0) > (itemStats({ id: 'cloth_breastplate', qty: 1 }).armour ?? 0));
});

test('racial bonuses reach the stats; a pickaxe only helps mining', () => {
  const ogre = computeStats({ ...defaultBuild(), race: 'ogre' }, {}, {}, {});
  assert.ok(ogre.all.meleeDmg >= 0.15 && ogre.speedCap < computeStats(defaultBuild(), {}, {}, {}).speedCap);
  const p = computeStats(defaultBuild(), { pickaxe: { id: 'iron_pickaxe', qty: 1, r: 1, fx: [['luck', 5]] } }, {}, {});
  assert.equal(p.scoped.mining.luck - p.all.luck, 5);
  assert.equal(p.scoped.fishing.luck, p.all.luck);
});

test('talents: root needs 3 ranks before its children, points come from levels', () => {
  const xp = { mining: xpForLevel(6) };
  const a: any = {};
  assert.ok(canLearn(a, xp, 'mining', 'steady_swing'));
  for (let i = 0; i < 3; i++) { assert.equal(canLearn(a, xp, 'mining', 'prospector'), null); (a.mining ??= {}).prospector = i + 1; }
  assert.equal(canLearn(a, xp, 'mining', 'steady_swing'), null);
  assert.deepEqual(sanitiseTalents({ mining: { prospector: 3, steady_swing: 3 } }, xp).mining, { prospector: 3, steady_swing: 2 });
});

test('quest periods reset daily, Mon/Thu and weekly (Oslo time)', () => {
  const mon = Date.UTC(2026, 10, 2, 10), thu = Date.UTC(2026, 10, 5, 10);
  assert.notEqual(periodKey('daily', mon), periodKey('daily', mon + 86400000));
  assert.notEqual(periodKey('twice-weekly', mon), periodKey('twice-weekly', thu));
  assert.equal(periodKey('weekly', mon), periodKey('weekly', thu));
});

test('the cave is walkable inside and walled outside', () => {
  assert.ok(caveClearance(CAVE_START.x, CAVE_START.z) > 1);
  assert.ok(walkable(CAVE_START.x, CAVE_START.z));
  assert.ok(!walkable(CAVE_START.x + 40, CAVE_START.z));
});

test('combat maths: armour reduces, specials multiply', () => {
  const s = emptyStats();
  const hit = outgoing({ id: 'iron_sword', qty: 1 }, undefined, s, 1);
  assert.ok(Math.abs(outgoing({ id: 'iron_sword', qty: 1 }, undefined, s, 2.5) - hit * 2.5) < 1e-9);
  assert.ok(incoming(10, false, { ...s, armour: 20 }) === 5);
  assert.ok(incoming(10, true, { ...s, magicTaken: 0.1 }) > 10);
});

test('trees exist and the lake is fishable', () => {
  assert.ok(TREE_BY_ID.size > 100);
  assert.ok(isFishable(LAKE.x, LAKE.z));
});

import { sunAt as sunAt2, daylight as daylight2, weatherAt as weatherAt2 } from '../src/index.js';
test('sky: the sun is high at noon and down at night in Oslo; weather is the same for everyone and snowless in the valley', () => {
  const noon = Date.parse('2026-06-21T11:20:00Z'), midnight = Date.parse('2026-12-21T23:00:00Z');
  assert.ok(sunAt2(noon).y > 0.7 && sunAt2(noon).z > 0, 'high and to the south');
  assert.equal(daylight2(midnight), 0);
  assert.equal(daylight2(noon), 1);
  for (let i = 0; i < 200; i++) {
    const ms = 1_800_000_000_000 + i * 1_000_000;
    assert.deepEqual(weatherAt2('valley', ms), weatherAt2('valley', ms));
    assert.notEqual(weatherAt2('valley', ms).kind, 'snow');
    assert.notEqual(weatherAt2('gruben', ms).kind, 'rain');
  }
  assert.equal(weatherAt2('cave', 0).rain, 0);
});
