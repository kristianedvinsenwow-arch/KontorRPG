/**
 * Items, equipment slots, rarity and rolled effects, and the bag.
 *  - Bag: 16 slots to start (+STR, perks, a worn bag). Ores/bars stack to 10, gems to 5.
 *  - Gear can roll a rarity when crafted (normal → epic); legendary only drops from bosses.
 *    Higher rarity = better base stats and 1–4 rolled effects from the item's effect groups.
 *  - Three armour types: metal (best vs physical, a little slower, takes more magic damage),
 *    leather (middle, a little faster) and cloth (best vs magic).
 */
import { addStats, emptyStats, type StatKey, type Stats } from './stats.js';

export type Slot =
  | 'head' | 'shoulders' | 'chest' | 'legs' | 'hands' | 'feet' | 'back'
  | 'mainHand' | 'offHand' | 'ring' | 'neck' | 'pickaxe' | 'hatchet' | 'rod' | 'ammo';

export type ItemKind = 'ore' | 'gem' | 'material' | 'bar' | 'log' | 'ammo' | 'fish' | 'food' | 'junk' | 'tool' | 'weapon' | 'armour' | 'bag' | 'coins' | 'trinket';
export type WeaponClass = 'sword' | 'longsword' | 'battleaxe' | 'bow' | 'staff' | 'fireStaff' | 'frostStaff';
export type ArmourType = 'cloth' | 'leather' | 'metal';
export type ToolKind = 'pickaxe' | 'hatchet' | 'rod';
/** Visual material for models and icons. */
export type Look = 'stone' | 'iron' | 'silver' | 'birch' | 'pine' | 'leather' | 'cloth' | 'bone';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  stack: number;
  /** 1 = stone/birch, 2 = iron/pine, 3 = silver. */
  tier?: number;
  look?: Look;
  slot?: Slot;
  tool?: ToolKind;
  /** Gathering power: a vein/tree needs at least this. */
  power?: number;
  /** Seconds per swing at level 1 (pickaxes and hatchets). */
  swingSec?: number;
  weapon?: WeaponClass;
  dps?: number;
  /** Seconds between basic attacks. */
  interval?: number;
  twoHanded?: boolean;
  /** Attack reach in metres. */
  range?: number;
  armourType?: ArmourType;
  armour?: number;
  ward?: number;
  bagSlots?: number;
  /** Arrows: extra damage per shot. */
  ammoDmg?: number;
  food?: { heal: number; buff?: { name: string; stats: Partial<Stats>; sec: number } };
  /** Fixed bonuses every copy has (e.g. rods make the catch bar bigger). */
  mods?: Partial<Stats>;
  /** What the trading post pays (0 = it won't buy it). */
  sellValue: number;
  buyPrice?: number;
  /** Only ever exists at this rarity (boss uniques). */
  fixedRarity?: Rarity;
  blurb: string;
}

// ------------------------------------------------------------------ rarity

export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY: { name: string; color: string; mult: number; effects: number }[] = [
  { name: 'Normal', color: '#d8d4c8', mult: 1, effects: 0 },
  { name: 'Uncommon', color: '#6fcf5f', mult: 1.1, effects: 1 },
  { name: 'Rare', color: '#4ea1e8', mult: 1.2, effects: 2 },
  { name: 'Epic', color: '#b77be8', mult: 1.35, effects: 3 },
  { name: 'Legendary', color: '#f2a23a', mult: 1.5, effects: 4 },
];

/**
 * Rarity when crafting. Luck (points) scales the chances: 10 luck = +20%.
 * Base: uncommon 10%, rare 2.5%, epic 0.5%. Legendary never comes from crafting.
 */
export function rollCraftRarity(luck: number, rand: () => number): Rarity {
  const k = 1 + Math.max(0, luck) * 0.02;
  const r = rand();
  if (r < 0.005 * k) return 3;
  if (r < 0.03 * k) return 2;
  if (r < 0.13 * k) return 1;
  return 0;
}

// ------------------------------------------------------------------ rolled effects

export type EffectGroup = 'general' | 'cloth' | 'leather' | 'metal' | 'mining' | 'woodcutting' | 'fishing';

/** Effect pool. Values are per roll at tier 1, normal multiplier; tier and rarity scale them up. */
export const EFFECTS: { key: StatKey; groups: EffectGroup[]; min: number; max: number; flat?: boolean }[] = [
  // general: any gear except profession tools
  { key: 'moveSpeed', groups: ['general'], min: 0.01, max: 0.03 },
  { key: 'physRed', groups: ['general'], min: 0.01, max: 0.04 },
  { key: 'magicRed', groups: ['general'], min: 0.01, max: 0.04 },
  { key: 'cdr', groups: ['general'], min: 0.03, max: 0.08 },
  { key: 'maxHp', groups: ['general'], min: 2, max: 8, flat: true },
  { key: 'regen', groups: ['general'], min: 1, max: 3, flat: true },
  { key: 'crit', groups: ['general'], min: 0.01, max: 0.03 },
  // cloth
  { key: 'magicDmg', groups: ['cloth'], min: 0.03, max: 0.08 },
  { key: 'burnDmg', groups: ['cloth'], min: 0.05, max: 0.15 },
  { key: 'frostPower', groups: ['cloth'], min: 0.1, max: 0.25 },
  { key: 'ward', groups: ['cloth'], min: 1, max: 3, flat: true },
  // leather
  { key: 'rangedDmg', groups: ['leather'], min: 0.03, max: 0.08 },
  { key: 'dodge', groups: ['leather'], min: 0.02, max: 0.05 },
  { key: 'arrowSave', groups: ['leather'], min: 0.05, max: 0.15 },
  { key: 'specialDmg', groups: ['leather', 'metal'], min: 0.05, max: 0.12 },
  // metal
  { key: 'meleeDmg', groups: ['metal'], min: 0.03, max: 0.08 },
  { key: 'block', groups: ['metal'], min: 0.03, max: 0.08 },
  { key: 'thorns', groups: ['metal'], min: 1, max: 3, flat: true },
  { key: 'armour', groups: ['metal'], min: 1, max: 3, flat: true },
  // profession tools
  { key: 'miningSpeed', groups: ['mining'], min: 0.03, max: 0.1 },
  { key: 'gemChance', groups: ['mining'], min: 0.1, max: 0.4 },
  { key: 'woodSpeed', groups: ['woodcutting'], min: 0.03, max: 0.1 },
  { key: 'fishSpeed', groups: ['fishing'], min: 0.03, max: 0.1 },
  { key: 'rareFish', groups: ['fishing'], min: 0.1, max: 0.3 },
  { key: 'fishEase', groups: ['fishing'], min: 0.05, max: 0.12 },
  { key: 'luck', groups: ['mining', 'woodcutting', 'fishing'], min: 2, max: 6, flat: true },
  { key: 'doubleYield', groups: ['mining', 'woodcutting', 'fishing'], min: 0.03, max: 0.1 },
  { key: 'skillXp', groups: ['mining', 'woodcutting', 'fishing'], min: 0.03, max: 0.08 },
];

/** Which effect groups an item can roll from. */
export function effectGroups(d: ItemDef): EffectGroup[] {
  if (d.tool === 'pickaxe') return ['mining'];
  if (d.tool === 'hatchet') return ['woodcutting'];
  if (d.tool === 'rod') return ['fishing'];
  if (d.armourType) return ['general', d.armourType];
  if (d.weapon) return ['general', d.weapon === 'bow' ? 'leather' : d.weapon.endsWith('taff') || d.weapon === 'staff' ? 'cloth' : 'metal'];
  if (d.slot) return ['general'];
  return [];
}

export type Effect = [StatKey, number];

export function rollEffects(d: ItemDef, rarity: Rarity, rand: () => number): Effect[] {
  const pool = EFFECTS.filter((e) => e.groups.some((g) => effectGroups(d).includes(g)));
  const out: Effect[] = [];
  const n = Math.min(RARITY[rarity].effects, pool.length);
  const scale = (1 + 0.25 * ((d.tier ?? 1) - 1)) * RARITY[rarity].mult;
  for (let i = 0; i < n; i++) {
    // Draw without replacement, so a poor random source can never loop.
    const e = pool.splice(Math.min(pool.length - 1, Math.floor(rand() * pool.length)), 1)[0];
    const v = (e.min + rand() * (e.max - e.min)) * scale;
    out.push([e.key, e.flat ? Math.max(1, Math.round(v)) : Math.round(v * 1000) / 1000]);
  }
  return out;
}

// ------------------------------------------------------------------ item list

const defs: ItemDef[] = [];
const add = (d: ItemDef) => { defs.push(d); return d; };

// raw materials
add({ id: 'stone', name: 'Stone', kind: 'ore', stack: 10, tier: 1, look: 'stone', sellValue: 0, blurb: 'Mined from stone veins. Shape it at the anvil.' });
add({ id: 'iron_ore', name: 'Iron ore', kind: 'ore', stack: 10, tier: 2, look: 'iron', sellValue: 0, blurb: 'Rusty ore from iron veins. Smelt two into a bar.' });
add({ id: 'silver_ore', name: 'Silver ore', kind: 'ore', stack: 10, tier: 3, look: 'silver', sellValue: 1, blurb: 'Found deep in the cave. Smelt two into a bar.' });
add({ id: 'quartz', name: 'Mofjell quartz', kind: 'gem', stack: 5, sellValue: 3, blurb: 'A rare find in stone veins. Imbues birch staffs.' });
add({ id: 'sapphire', name: 'Sapphire', kind: 'gem', stack: 5, sellValue: 8, blurb: 'A rare find in iron veins. Imbues pine staffs.' });
add({ id: 'garnet', name: 'Garnet', kind: 'gem', stack: 5, sellValue: 15, blurb: 'A deep red gem from silver veins.' });
add({ id: 'shaped_stone', name: 'Shaped stone', kind: 'material', stack: 10, tier: 1, look: 'stone', sellValue: 0, blurb: 'Two stones knapped into a usable block.' });
add({ id: 'iron_bar', name: 'Iron bar', kind: 'bar', stack: 10, tier: 2, look: 'iron', sellValue: 1, blurb: 'Smelted from two iron ore.' });
add({ id: 'silver_bar', name: 'Silver bar', kind: 'bar', stack: 10, tier: 3, look: 'silver', sellValue: 4, blurb: 'Smelted from two silver ore. Silver gear comes later; the smith pays well for it.' });
add({ id: 'birch_log', name: 'Birch log', kind: 'log', stack: 10, tier: 1, look: 'birch', sellValue: 0, blurb: 'Pale, light wood. Shafts, shortbows, staffs.' });
add({ id: 'pine_log', name: 'Pine log', kind: 'log', stack: 10, tier: 2, look: 'pine', sellValue: 1, blurb: 'Tough, resinous wood for better bows and staffs.' });
add({ id: 'arrow_shaft', name: 'Arrow shafts', kind: 'material', stack: 100, look: 'birch', sellValue: 0, blurb: 'Fit arrowheads to them at the workbench.' });
add({ id: 'stone_arrowheads', name: 'Stone arrowheads', kind: 'material', stack: 100, tier: 1, look: 'stone', sellValue: 0, blurb: 'Knapped at the anvil, fitted at the workbench.' });
add({ id: 'iron_arrowheads', name: 'Iron arrowheads', kind: 'material', stack: 100, tier: 2, look: 'iron', sellValue: 0, blurb: 'Forged at the anvil, fitted at the workbench.' });
add({ id: 'stone_arrow', name: 'Stone arrows', kind: 'ammo', stack: 200, tier: 1, look: 'stone', slot: 'ammo', ammoDmg: 1, sellValue: 0, blurb: 'Wear them in the ammo slot. +1 damage per shot.' });
add({ id: 'iron_arrow', name: 'Iron arrows', kind: 'ammo', stack: 200, tier: 2, look: 'iron', slot: 'ammo', ammoDmg: 3, sellValue: 0, blurb: 'Wear them in the ammo slot. +3 damage per shot.' });

// fish and food
const FISH: [string, string, number, number, number, ItemDef['food']][] = [
  // id, name, sell raw, sell cooked, tier, food
  ['perch', 'Perch', 0, 1, 1, { heal: 6 }],
  ['trout', 'Trout', 1, 2, 1, { heal: 10, buff: { name: 'Well fed (trout)', stats: { miningSpeed: 0.05, woodSpeed: 0.05 }, sec: 600 } }],
  ['char', 'Arctic char', 1, 3, 2, { heal: 14, buff: { name: 'Well fed (char)', stats: { allDmg: 0.05 }, sec: 600 } }],
  ['pike', 'Pike', 2, 4, 2, { heal: 18, buff: { name: 'Well fed (pike)', stats: { maxHp: 10, regen: 1 }, sec: 600 } }],
];
for (const [id, name, raw, cooked, tier, food] of FISH) {
  add({ id: `raw_${id}`, name: `Raw ${name.toLowerCase()}`, kind: 'fish', stack: 10, tier, sellValue: raw, blurb: 'Cook it at a campfire or the inn’s stove.' });
  add({ id: `cooked_${id}`, name: `Cooked ${name.toLowerCase()}`, kind: 'food', stack: 10, tier, food, sellValue: cooked, blurb: `Eat it (hotbar) to heal ${food!.heal} HP${food!.buff ? ' and get a 10-minute buff' : ''}.` });
}
add({ id: 'burnt_fish', name: 'Burnt fish', kind: 'junk', stack: 10, sellValue: 0, blurb: 'Charcoal with fins. Drop it.' });
add({ id: 'old_boot', name: 'Old boot', kind: 'junk', stack: 5, sellValue: 0, blurb: 'Someone lost this in the lake. Smells like it.' });
add({ id: 'golden_perch', name: 'Golden perch', kind: 'fish', stack: 5, tier: 2, sellValue: 20, blurb: 'A rare, shimmering perch. Traders love it.' });

// mob drops
add({ id: 'coins', name: 'Coins', kind: 'coins', stack: 9999, sellValue: 0, blurb: 'Picked up straight into your purse.' });
add({ id: 'wolf_pelt', name: 'Wolf pelt', kind: 'material', stack: 10, sellValue: 3, blurb: 'Leatherworking will use these. For now, the trader buys them.' });
add({ id: 'goblin_trinket', name: 'Goblin trinket', kind: 'junk', stack: 10, sellValue: 4, blurb: 'Shiny junk goblins hoard.' });
add({ id: 'bat_wing', name: 'Bat wing', kind: 'material', stack: 10, sellValue: 1, blurb: 'Leathery. Alchemy will want these.' });
add({ id: 'troll_tooth', name: 'Troll tooth', kind: 'trinket', stack: 5, sellValue: 25, blurb: 'Proof you beat Old Knut.' });

// tools
add({ id: 'stone_pickaxe', name: 'Stone pickaxe', kind: 'tool', stack: 1, tier: 1, look: 'stone', slot: 'pickaxe', tool: 'pickaxe', power: 1, swingSec: 2.6, sellValue: 2, buyPrice: 10, blurb: 'Mines stone and iron.' });
add({ id: 'iron_pickaxe', name: 'Iron pickaxe', kind: 'tool', stack: 1, tier: 2, look: 'iron', slot: 'pickaxe', tool: 'pickaxe', power: 2, swingSec: 1.9, sellValue: 6, blurb: 'Faster, and strong enough for silver.' });
add({ id: 'stone_hatchet', name: 'Stone hatchet', kind: 'tool', stack: 1, tier: 1, look: 'stone', slot: 'hatchet', tool: 'hatchet', power: 1, swingSec: 2.4, sellValue: 2, buyPrice: 10, blurb: 'Fells birch and pine.' });
add({ id: 'iron_hatchet', name: 'Iron hatchet', kind: 'tool', stack: 1, tier: 2, look: 'iron', slot: 'hatchet', tool: 'hatchet', power: 2, swingSec: 1.8, sellValue: 6, blurb: 'Bites deeper; fells trees a third faster.' });
add({ id: 'basic_rod', name: 'Basic fishing rod', kind: 'tool', stack: 1, tier: 1, look: 'birch', slot: 'rod', tool: 'rod', power: 1, sellValue: 2, buyPrice: 10, blurb: 'A stick, a line and hope.' });
add({ id: 'birch_rod', name: 'Birch fishing rod', kind: 'tool', stack: 1, tier: 1, look: 'birch', slot: 'rod', tool: 'rod', power: 1, mods: { fishEase: 0.1 }, sellValue: 4, blurb: 'Springy birch: a bigger catch bar.' });
add({ id: 'pine_rod', name: 'Pine fishing rod', kind: 'tool', stack: 1, tier: 2, look: 'pine', slot: 'rod', tool: 'rod', power: 2, mods: { fishEase: 0.2, fishSpeed: 0.1 }, sellValue: 10, blurb: 'Lands the big ones: pike and char bite sooner.' });

// weapons: [class, dps per tier, interval, range, twoHanded]
const W: Record<'sword' | 'longsword' | 'battleaxe', { name: string; dps: [number, number]; interval: number; range: number; two: boolean; blurb: string }> = {
  sword: { name: 'sword', dps: [7, 11], interval: 1.6, range: 2.6, two: false, blurb: 'One-handed. Right click: Heavy Strike (2.5× damage, 8 s).' },
  longsword: { name: 'longsword', dps: [9, 14], interval: 2.3, range: 3.0, two: true, blurb: 'Two-handed. Right click: Whirlwind — spin and hit everything around you (12 s).' },
  battleaxe: { name: 'battleaxe', dps: [9.5, 15], interval: 2.5, range: 2.8, two: true, blurb: 'Two-handed. Right click: Executioner (4× damage, 18 s).' },
};
for (const [cls, w] of Object.entries(W) as [keyof typeof W, typeof W.sword][]) {
  ['stone', 'iron'].forEach((t, i) => add({
    id: `${t}_${cls}`, name: `${t[0].toUpperCase()}${t.slice(1)} ${w.name}`, kind: 'weapon', stack: 1, tier: i + 1, look: t as Look,
    slot: 'mainHand', weapon: cls, dps: w.dps[i], interval: w.interval, range: w.range, twoHanded: w.two, sellValue: (i + 1) * (w.two ? 3 : 2), blurb: w.blurb,
  }));
}
add({ id: 'birch_shortbow', name: 'Birch shortbow', kind: 'weapon', stack: 1, tier: 1, look: 'birch', slot: 'mainHand', weapon: 'bow', dps: 6, interval: 2.0, range: 28, twoHanded: true, sellValue: 3, blurb: 'Needs arrows in the ammo slot. Right click: Power Shot (3×, 10 s).' });
add({ id: 'pine_longbow', name: 'Pine longbow', kind: 'weapon', stack: 1, tier: 2, look: 'pine', slot: 'mainHand', weapon: 'bow', dps: 10, interval: 2.2, range: 34, twoHanded: true, sellValue: 7, blurb: 'Needs arrows in the ammo slot. Right click: Power Shot (3×, 10 s).' });
for (const [wood, tier, dps] of [['birch', 1, 3], ['pine', 2, 5]] as const) {
  const W2 = wood[0].toUpperCase() + wood.slice(1);
  add({ id: `${wood}_staff`, name: `${W2} staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'staff', dps, interval: 1.8, range: 2.6, twoHanded: true, sellValue: tier * 2, blurb: 'A clumsy club until the Imbuer in Bjørkvik makes it magical.' });
  add({ id: `${wood}_fire_staff`, name: `${W2} fire staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'fireStaff', dps: tier === 1 ? 8 : 12, interval: 1.8, range: 26, twoHanded: true, sellValue: tier * 8, blurb: 'Firebolts add a burn (stacks to 3). Right click: Ignite — every burning enemy nearby takes damage, +33/66/100% by stacks (12 s).' });
  add({ id: `${wood}_frost_staff`, name: `${W2} frost staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'frostStaff', dps: tier === 1 ? 7 : 11, interval: 1.8, range: 26, twoHanded: true, sellValue: tier * 8, blurb: 'Frostbolts slow by 25%. Right click: Frost Nova — freeze everything within 6 m for 2.5 s (15 s).' });
}

// armour. Metal is smithed (stone uses shaped stone, iron uses bars); leather and cloth are sold for now.
export const ARMOUR_PIECES: { piece: string; slot: Slot; name: Record<ArmourType, string>; bars: number; metal: number; leather: [number, number]; cloth: [number, number] }[] = [
  { piece: 'helm', slot: 'head', name: { metal: 'helm', leather: 'cap', cloth: 'hood' }, bars: 6, metal: 2, leather: [1, 1], cloth: [0, 2] },
  { piece: 'pauldrons', slot: 'shoulders', name: { metal: 'pauldrons', leather: 'shoulderpads', cloth: 'mantle' }, bars: 6, metal: 1, leather: [1, 0], cloth: [0, 1] },
  { piece: 'breastplate', slot: 'chest', name: { metal: 'breastplate', leather: 'jerkin', cloth: 'robe' }, bars: 12, metal: 4, leather: [2, 2], cloth: [1, 4] },
  { piece: 'greaves', slot: 'legs', name: { metal: 'greaves', leather: 'trousers', cloth: 'leggings' }, bars: 12, metal: 3, leather: [2, 1], cloth: [0, 3] },
  { piece: 'gauntlets', slot: 'hands', name: { metal: 'gauntlets', leather: 'gloves', cloth: 'wraps' }, bars: 6, metal: 1, leather: [1, 0], cloth: [0, 1] },
  { piece: 'boots', slot: 'feet', name: { metal: 'sabatons', leather: 'boots', cloth: 'shoes' }, bars: 6, metal: 1, leather: [1, 0], cloth: [0, 1] },
  { piece: 'kite_shield', slot: 'offHand', name: { metal: 'kite shield', leather: '', cloth: '' }, bars: 12, metal: 3, leather: [0, 0], cloth: [0, 0] },
];
for (const p of ARMOUR_PIECES) {
  ['stone', 'iron'].forEach((t, i) => add({
    id: `${t}_${p.piece}`, name: `${t[0].toUpperCase()}${t.slice(1)} ${p.name.metal}`, kind: 'armour', stack: 1, tier: i + 1, look: t as Look,
    slot: p.slot, armourType: 'metal', armour: i === 0 ? p.metal : Math.round(p.metal * 1.8), ward: 0, sellValue: Math.ceil(p.bars / 6) * (i + 1),
    blurb: p.slot === 'offHand' ? 'Metal shield: lets you block (see block chance). One-handed weapons only.' : 'Metal armour: strong vs physical damage, a little slower, and magic hurts a bit more.',
  }));
  if (p.slot === 'offHand') continue;
  add({ id: `leather_${p.piece}`, name: `Leather ${p.name.leather}`, kind: 'armour', stack: 1, tier: 1, look: 'leather', slot: p.slot, armourType: 'leather', armour: p.leather[0], ward: p.leather[1], sellValue: 2, buyPrice: 8 + p.bars, blurb: 'Leather armour: medium protection vs both, and a little faster.' });
  add({ id: `cloth_${p.piece}`, name: `Cloth ${p.name.cloth}`, kind: 'armour', stack: 1, tier: 1, look: 'cloth', slot: p.slot, armourType: 'cloth', armour: p.cloth[0], ward: p.cloth[1], sellValue: 2, buyPrice: 6 + p.bars, blurb: 'Cloth armour: strong vs magic, little vs blades.' });
}

// bags and boss uniques
add({ id: 'small_rucksack', name: 'Small rucksack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 4, sellValue: 10, buyPrice: 40, blurb: '+4 bag slots.' });
add({ id: 'leather_backpack', name: 'Leather backpack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 8, sellValue: 30, buyPrice: 120, blurb: '+8 bag slots.' });
add({ id: 'trolltooth_necklace', name: 'Trolltooth necklace', kind: 'trinket', stack: 1, slot: 'neck', fixedRarity: 4, mods: { maxHp: 10, meleeDmg: 0.06, luck: 5 }, sellValue: 60, blurb: 'Old Knut’s own. Rarely, he drops it.' });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export const BASE_BAG_SLOTS = 16;
export const START_GOLD = 15;

/** Order and labels for the character sheet. */
export const EQUIP_SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'mainHand', label: 'Main hand' },
  { slot: 'offHand', label: 'Off hand' },
  { slot: 'ammo', label: 'Ammo' },
  { slot: 'head', label: 'Head' },
  { slot: 'shoulders', label: 'Shoulders' },
  { slot: 'chest', label: 'Body' },
  { slot: 'hands', label: 'Hands' },
  { slot: 'legs', label: 'Legs' },
  { slot: 'feet', label: 'Feet' },
  { slot: 'back', label: 'Back (bag)' },
  { slot: 'neck', label: 'Neck' },
  { slot: 'ring', label: 'Ring' },
  { slot: 'pickaxe', label: 'Pickaxe' },
  { slot: 'hatchet', label: 'Hatchet' },
  { slot: 'rod', label: 'Rod' },
];

export const KIND_LABEL: Record<ItemKind, string> = {
  ore: 'Ore', gem: 'Gem', material: 'Material', bar: 'Bar', log: 'Log', ammo: 'Ammunition', fish: 'Raw fish', food: 'Food', junk: 'Junk',
  tool: 'Tool', weapon: 'Weapon', armour: 'Armour', bag: 'Bag', coins: 'Coins', trinket: 'Trinket',
};

// ------------------------------------------------------------------ stacks, bag and equipment

/** A stack in the bag or a worn item. Gear with a rarity or effects is unique and never stacks. */
export interface Stack { id: string; qty: number; r?: Rarity; fx?: Effect[] }
export type Bag = (Stack | null)[];
export type Equipment = Partial<Record<Slot, Stack>>;

export const isPlain = (s: Stack) => !s.r && !s.fx?.length;
export const canMerge = (a: Stack, b: Stack) => a.id === b.id && isPlain(a) && isPlain(b);
export const stackMax = (s: Stack) => (isPlain(s) ? ITEMS[s.id]?.stack ?? 1 : 1);

export function emptyBag(slots: number): Bag { return Array.from({ length: slots }, () => null); }

export function countItem(bag: Bag, id: string): number {
  return bag.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
}

/** How many plain copies of `id` would fit. */
export function roomFor(bag: Bag, id: string): number {
  const max = ITEMS[id]?.stack ?? 1;
  return bag.reduce((n, s) => n + (!s ? max : s.id === id && isPlain(s) ? max - s.qty : 0), 0);
}

/** Add a stack (plain or unique); returns how many did NOT fit. */
export function addStack(bag: Bag, st: Stack): number {
  let qty = st.qty;
  const max = stackMax(st);
  if (isPlain(st)) {
    for (const s of bag) {
      if (qty <= 0) break;
      if (s && canMerge(s, st) && s.qty < max) { const k = Math.min(qty, max - s.qty); s.qty += k; qty -= k; }
    }
  }
  for (let i = 0; i < bag.length && qty > 0; i++) {
    if (!bag[i]) { const k = Math.min(qty, max); bag[i] = { ...st, qty: k }; qty -= k; }
  }
  return qty;
}

export function addItem(bag: Bag, id: string, qty: number): number { return addStack(bag, { id, qty }); }

/** Remove qty plain copies of id (last stacks first); false and no change if there aren't enough. */
export function removeItem(bag: Bag, id: string, qty: number): boolean {
  if (countItem(bag, id) < qty) return false;
  for (let i = bag.length - 1; i >= 0 && qty > 0; i--) {
    const s = bag[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(qty, s.qty);
    s.qty -= k; qty -= k;
    if (s.qty === 0) bag[i] = null;
  }
  return true;
}

/** Bag size from attributes, perks and the worn bag. */
export function bagCapacity(bonusSlots: number, equip: Equipment): number {
  const worn = equip.back ? ITEMS[equip.back.id]?.bagSlots ?? 0 : 0;
  return BASE_BAG_SLOTS + bonusSlots + worn;
}

/** Resize a bag (e.g. after swapping rucksacks). Returns null if the items wouldn't fit. */
export function resizeBag(bag: Bag, slots: number): Bag | null {
  const items = bag.filter((s): s is Stack => !!s);
  if (items.length > slots) return null;
  return [...items, ...emptyBag(slots - items.length)];
}

function cleanStack(s: any): Stack | null {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !ITEMS[s.id]) return null;
  if (!Number.isInteger(s.qty) || s.qty <= 0) return null;
  const out: Stack = { id: s.id, qty: s.qty };
  if (Number.isInteger(s.r) && s.r > 0 && s.r <= 4) out.r = s.r;
  if (Array.isArray(s.fx)) {
    const fx = s.fx.filter((e: any) => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1]) && EFFECTS.some((x) => x.key === e[0]));
    if (fx.length) out.fx = fx;
  }
  return out;
}

/** Drop unknown items and bad quantities from stored data (e.g. after content changes). */
export function sanitiseBag(raw: unknown, slots: number): Bag {
  const bag = emptyBag(slots);
  if (!Array.isArray(raw)) return bag;
  for (const s of raw) { const c = cleanStack(s); if (c) addStack(bag, c); }
  return bag;
}

/** Stored equipment; also migrates the M1 format (ids as strings, a single 'tool' slot). */
export function sanitiseEquipment(raw: unknown): Equipment {
  const e: Equipment = {};
  if (!raw || typeof raw !== 'object') return e;
  for (const [slot0, v] of Object.entries(raw as Record<string, unknown>)) {
    const st = typeof v === 'string' ? cleanStack({ id: v, qty: 1 }) : cleanStack(v);
    if (!st) continue;
    const slot = (slot0 === 'tool' ? ITEMS[st.id].slot : slot0) as Slot;
    if (ITEMS[st.id].slot === slot) e[slot] = st;
  }
  return e;
}

// ------------------------------------------------------------------ item stats

/** Everything one item adds: base armour/ward × rarity, armour-type side effects, fixed mods, rolled effects. */
export function itemStats(s: Stack): Partial<Stats> {
  const d = ITEMS[s.id];
  if (!d) return {};
  const m = RARITY[s.r ?? d.fixedRarity ?? 0].mult;
  const out = emptyStats();
  if (d.armour) out.armour += Math.round(d.armour * m * 10) / 10;
  if (d.ward) out.ward += Math.round(d.ward * m * 10) / 10;
  if (d.armourType === 'metal' && d.slot !== 'offHand') { out.moveSpeed -= 0.015; out.magicTaken += 0.03; }
  if (d.armourType === 'leather') out.moveSpeed += 0.01;
  if (d.slot === 'offHand' && d.armourType === 'metal') out.block += 0.1;
  addStats(out, d.mods);
  for (const [k, v] of s.fx ?? []) out[k] += v;
  const clean: Partial<Stats> = {};
  for (const [k, v] of Object.entries(out)) if (v) clean[k as keyof Stats] = v;
  return clean;
}

/** Weapon damage per basic hit for this copy (dps × interval × rarity). */
export function weaponHit(s: Stack | undefined): number {
  const d = s ? ITEMS[s.id] : undefined;
  if (!d?.dps) return 2; // fists
  return d.dps * (d.interval ?? 1.6) * RARITY[s!.r ?? 0].mult;
}

export const BARS_PER_ITEM: Record<string, number> = Object.fromEntries(ARMOUR_PIECES.map((p) => [p.piece, p.bars]));
