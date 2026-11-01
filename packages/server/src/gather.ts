/**
 * Gathering: mining veins, chopping trees (both are "nodes" with shared, visible wear), and fishing
 * (cast → bite → the client's reel minigame → catch). All rolls happen here.
 */
import {
  FISH_TABLE, SEA_FISH_TABLE, SEA_RARE, SEA_TREASURE, LAKE_TREASURE, ITEMS, MINE_RANGE, RARE_FISH, TREE_BY_ID, TREE_TYPES, VEIN_BY_ID, VEIN_TYPES, CAST_RANGE,
  PICK_SEC, PLANT_BY_ID, regionAt, weatherAt, PLANT_TYPES, isFishable, levelOf, skillLevel, roomFor, swingSeconds, type NodeTypeDef, type Stack,
} from '@kontor/shared';
import type { ServerPlayer } from './types.js';
import { rollGear } from './combat.js';
import type { World } from './world.js';

const SLOT_FOR = { mining: 'pickaxe', woodcutting: 'hatchet', tailoring: 'pickaxe', herbalism: 'pickaxe', cooking: 'pickaxe' } as const;

export function gather(w: World, p: ServerPlayer, kind: 'mine' | 'chop' | 'pick', nodeId: string): void {
  if (kind === 'pick') return pick(w, p, nodeId);
  const node = kind === 'mine' ? VEIN_BY_ID.get(nodeId) : TREE_BY_ID.get(nodeId);
  if (!node) return;
  const type: NodeTypeDef = kind === 'mine' ? VEIN_TYPES[(node as any).type as keyof typeof VEIN_TYPES] : TREE_TYPES[(node as any).kind as keyof typeof TREE_TYPES];
  const skill = type.skill;
  const now = w.now();
  const err = (text: string) => w.notice(p, text, 'error');
  if (p.dead) return;
  const r = (node as any).r ?? 0.5;
  if (Math.hypot(p.state.x - node.x, p.state.z - node.z) > MINE_RANGE + r + 0.6 || Math.abs(p.state.y - node.y) > 3.5) return err('Too far away.');
  const slot = SLOT_FOR[skill];
  const tool = p.equip[slot];
  const def = tool ? ITEMS[tool.id] : null;
  if (!def) return err(skill === 'mining' ? 'You need a pickaxe. Ingrid at the trading post sells one.' : 'You need a hatchet. Ingrid at the trading post sells one.');
  if ((def.power ?? 0) < type.power) return err(`You need a stronger ${slot}.`);
  const lvl = skillLevel(p.xp, skill, p.stats.all.skillLvl);
  if (lvl < type.level) return err(`${type.name} needs ${skill === 'mining' ? 'Mining' : 'Woodcutting'} ${type.level} (you have ${lvl}).`);
  const st = (p.stats.scoped as Record<string, typeof p.stats.all>)[skill] ?? p.stats.all;
  const swing = swingSeconds(def.swingSec ?? 2.6, lvl, skill === 'mining' ? st.miningSpeed : st.woodSpeed) * 1000;
  if (now - p.lastGatherAt < swing * 0.8) return;
  const ns = w.nodes.get(nodeId);
  if (ns && ns.until > now) return err(skill === 'mining' ? 'This vein is mined out.' : 'Only a stump left.');
  if (roomFor(p.bag, type.item) < 1) return err('Your bag is full. Drop something (right-click it in your bag).');
  p.lastGatherAt = now;
  p.act = 'swing'; p.actUntil = now + 650;
  if (p.held !== slot) { p.held = slot; w.refreshGear(p); }
  const state = ns ?? { left: 0, total: 0, until: 0 };
  if (state.left <= 0) { state.total = state.left = type.hits[0] + Math.floor(w.rand() * (type.hits[1] - type.hits[0] + 1)); state.until = 0; }
  if (w.rand() >= st.nodeSave) state.left--;
  let qty = 1;
  if (w.rand() < st.doubleYield + st.luck * 0.002 && roomFor(p.bag, type.item) >= 2) qty = 2;
  w.give(p, { id: type.item, qty });
  const xp = w.addXp(p, skill, type.xp);
  p.client.send({ t: 'gain', skill, xp, item: type.item, qty });
  w.count(p, skill === 'mining' ? 'oreHits' : 'treeHits');
  if (type.gem) {
    const chance = type.gem.chance * (1 + st.gemChance) * (1 + st.luck * 0.01);
    if (w.rand() < chance && roomFor(p.bag, type.gem.item) > 0) {
      w.give(p, { id: type.gem.item, qty: 1 });
      w.count(p, 'gems');
      p.client.send({ t: 'gain', item: type.gem.item, qty: 1, rare: true });
      w.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} found ${ITEMS[type.gem.item].name}!` });
    }
  }
  if (state.left <= 0) {
    const [lo, hi] = type.respawnSec;
    state.until = now + (lo + w.rand() * (hi - lo)) * 1000;
    w.broadcast({ t: 'nodes', depleted: [[nodeId, 1]] });
  }
  w.nodes.set(nodeId, state);
  w.broadcast({ t: 'node', id: nodeId, left: Math.max(0, state.left), total: state.total });
  p.dirty = true;
  w.sendInv(p);
}

/** Pick flax, bog cotton (Tailoring) or herbs (Herbalism) by hand. Plants share the node wear / regrowth rules. */
function pick(w: World, p: ServerPlayer, nodeId: string): void {
  const plant = PLANT_BY_ID.get(nodeId);
  if (!plant || p.dead) return;
  const type = PLANT_TYPES[plant.kind];
  const now = w.now();
  const err = (text: string) => w.notice(p, text, 'error');
  if (Math.hypot(p.state.x - plant.x, p.state.z - plant.z) > 3 || Math.abs(p.state.y - plant.y) > 3) return err('Too far away.');
  const skill = type.skill as 'tailoring' | 'herbalism' | 'cooking';
  const skillName = skill[0].toUpperCase() + skill.slice(1);
  const lvl = skillLevel(p.xp, skill, p.stats.all.skillLvl);
  if (lvl < type.level) return err(`${type.name} needs ${skillName} ${type.level} (you have ${lvl}).`);
  if (now - p.lastGatherAt < PICK_SEC * (1 - 0.01 * (lvl - 1)) * 1000 * 0.8) return;
  const ns = w.nodes.get(nodeId);
  if (ns && ns.until > now) return err('Nothing left to pick here yet.');
  if (roomFor(p.bag, type.item) < 1) return err('Your bag is full.');
  p.lastGatherAt = now;
  p.act = 'swing'; p.actUntil = now + 500;
  const st = p.stats.scoped[skill];
  const state = ns ?? { left: 0, total: 0, until: 0 };
  if (state.left <= 0) { state.total = state.left = type.hits[0] + Math.floor(w.rand() * (type.hits[1] - type.hits[0] + 1)); state.until = 0; }
  state.left--;
  const qty = w.rand() < st.doubleYield + st.luck * 0.002 && roomFor(p.bag, type.item) >= 2 ? 2 : 1;
  w.give(p, { id: type.item, qty });
  const xp = w.addXp(p, skill, type.xp);
  p.client.send({ t: 'gain', skill, xp, item: type.item, qty });
  if (skill !== 'cooking') w.count(p, skill === 'herbalism' ? 'herbs' : 'fibre');
  if (state.left <= 0) {
    const [lo, hi] = type.respawnSec;
    state.until = now + (lo + w.rand() * (hi - lo)) * 1000;
    w.broadcast({ t: 'nodes', depleted: [[nodeId, 1]] });
  }
  w.nodes.set(nodeId, state);
  w.broadcast({ t: 'node', id: nodeId, left: Math.max(0, state.left), total: state.total });
  p.dirty = true;
  w.sendInv(p);
}

// ------------------------------------------------------------------ fishing

export function cast(w: World, p: ServerPlayer, x: number, z: number): void {
  if (p.dead) return;
  const rod = p.equip.rod;
  if (!rod) return w.notice(p, 'You need a fishing rod. Ingrid sells a basic one.', 'error');
  if (Math.hypot(x - p.state.x, z - p.state.z) > CAST_RANGE + 1) return w.notice(p, 'Too far to cast — get closer to the water.', 'error');
  if (!isFishable(x, z)) return w.notice(p, 'Cast into deeper water.', 'error');
  if (roomFor(p.bag, 'raw_perch') < 1 && p.bag.every((s) => s)) return w.notice(p, 'Your bag is full.', 'error');
  const st = p.stats.scoped.fishing;
  // Fish bite better in the rain.
  const rainy = weatherAt(regionAt(p.state.x, p.state.z), w.now()).rain > 0.5 ? 1.25 : 1;
  const wait = (4 + w.rand() * 9) / (1 + Math.max(0, st.fishSpeed)) / rainy;
  // Decide the fish now; the client only learns what it was if the catch succeeds.
  const lvl = skillLevel(p.xp, 'fishing', p.stats.all.skillLvl);
  let pick: { item: string; xp: number; difficulty: number; rare: boolean; stack?: Stack } = { item: FISH_TABLE[0].item, xp: FISH_TABLE[0].xp, difficulty: FISH_TABLE[0].difficulty, rare: false };
  const luckK = (1 + st.rareFish) * (1 + st.luck * 0.01);
  const sea = regionAt(x, z) === 'fjord';
  if (sea && lvl < SEA_FISH_TABLE[0].level) return w.notice(p, `Sea fish won’t bite for a beginner — you need Fishing ${SEA_FISH_TABLE[0].level}.`, 'error');
  const deep = sea ? SEA_TREASURE.find((t) => lvl >= t.level && w.rand() < t.chance * luckK) : undefined;
  const treasure = deep ? undefined : LAKE_TREASURE.find((t) => lvl >= t.level && w.rand() < t.chance * luckK);
  const rare = sea ? SEA_RARE : RARE_FISH;
  if (deep) {
    const def = ITEMS[deep.item];
    pick = { item: deep.item, xp: deep.xp, difficulty: deep.difficulty, rare: true, stack: { id: deep.item, qty: 1, ...(def.fixedRarity ? { r: def.fixedRarity } : {}) } };
  } else if (treasure) {
    let stack: Stack;
    let diff = treasure.difficulty;
    if (treasure.what === 'gem') { const gems = ['quartz', 'quartz', 'sapphire', 'garnet']; stack = { id: gems[Math.floor(w.rand() * gems.length)], qty: 1 }; if (stack.id !== 'quartz') diff += 0.07; }
    else if (treasure.what === 'gear') {
      const tier = lvl >= 18 && w.rand() < 0.35 ? 2 : 1;
      stack = rollGear(w, tier, st.luck);
      diff += (tier - 1) * 0.06 + (stack.r ?? 0) * 0.04; // a rare iron helm fights harder than a plain stone one
    }
    else if (treasure.what === 'plans') stack = { id: ['spear_plans', 'halberd_plans', 'warhammer_plans'][Math.floor(w.rand() * 3)], qty: 1 };
    else stack = { id: 'fjord_horse', qty: 1 };
    pick = { item: stack.id, xp: treasure.xp, difficulty: Math.min(1.25, diff), rare: true, stack };
  } else if (w.rand() < rare.chance * (1 + st.rareFish) * (1 + st.luck * 0.01)) pick = { item: rare.item, xp: rare.xp, difficulty: rare.difficulty, rare: true };
  else {
    const table = (sea ? SEA_FISH_TABLE : FISH_TABLE).filter((f) => f.level <= lvl);
    let roll = w.rand() * table.reduce((s, f) => s + f.weight, 0);
    for (const f of table) { roll -= f.weight; if (roll <= 0) { pick = { item: f.item, xp: f.xp, difficulty: f.difficulty, rare: false }; break; } }
  }
  if (p.held !== 'rod') { p.held = 'rod'; w.refreshGear(p); }
  p.fishing = { x, z, fromX: p.state.x, fromZ: p.state.z, phase: 'wait', biteAt: w.now() + wait * 1000, ...pick };
  p.act = 'fish'; p.actUntil = w.now() + 1e9;
  p.client.send({ t: 'fish', state: 'cast' });
}

/** How long the minigame may last before the fish gets away. */
const REEL_WINDOW = 25_000;

export function stepFishing(w: World, p: ServerPlayer, now: number): void {
  const f = p.fishing;
  if (!f) return;
  if (Math.hypot(p.state.x - f.fromX, p.state.z - f.fromZ) > 2.5 || p.dead) return stopFishing(w, p, 'cancel');
  if (f.phase === 'wait' && now >= f.biteAt) {
    f.phase = 'bite';
    f.biteAt = now;
    p.client.send({ t: 'fish', state: 'bite', difficulty: f.difficulty, seconds: REEL_WINDOW / 1000 });
  } else if (f.phase === 'bite' && now - f.biteAt > REEL_WINDOW + 2000) stopFishing(w, p, 'lost');
}

export function reel(w: World, p: ServerPlayer, ok: boolean): void {
  const f = p.fishing;
  if (!f) return;
  const now = w.now();
  if (f.phase !== 'bite') return stopFishing(w, p, 'lost'); // reeled before a bite: scares the fish
  // A real minigame takes a moment; an instant "ok" is a bot.
  if (!ok || now - f.biteAt < 2500 || now - f.biteAt > REEL_WINDOW + 2000) return stopFishing(w, p, 'lost');
  const st = p.stats.scoped.fishing;
  const qty = f.stack ? f.stack.qty : w.rand() < st.doubleYield + st.luck * 0.002 && !f.rare ? 2 : 1;
  const left = w.give(p, f.stack ? { ...f.stack } : { id: f.item, qty });
  if (left === qty) return stopFishing(w, p, 'lost');
  const xp = w.addXp(p, 'fishing', f.xp);
  p.client.send({ t: 'gain', skill: 'fishing', xp, item: f.item, qty: qty - left, rare: f.rare });
  w.count(p, 'fish');
  if (f.item === 'golden_perch') w.count(p, 'golden');
  if (SEA_TREASURE.some((t) => t.item === f.item)) w.count(p, 'deeps');
  if (f.rare) w.broadcast({ t: 'notice', kind: 'rare', text: `${p.state.name} fished up ${f.stack?.r ? ['', 'an uncommon ', 'a rare ', 'an epic ', 'a legendary '][f.stack.r] : 'a '}${ITEMS[f.item].name}${f.item === 'fjord_horse' ? ' — dripping wet!' : '!'}` });
  p.dirty = true;
  w.sendInv(p);
  stopFishing(w, p, 'caught');
}

export function stopFishing(w: World, p: ServerPlayer, state: 'lost' | 'caught' | 'cancel'): void {
  if (!p.fishing) return;
  p.fishing = null;
  p.act = undefined; p.actUntil = 0;
  p.client.send({ t: 'fish', state });
}
