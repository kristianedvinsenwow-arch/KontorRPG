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
  | 'mainHand' | 'offHand' | 'ring' | 'neck' | 'pickaxe' | 'hatchet' | 'rod' | 'knife' | 'ammo' | 'mount';

export type ItemKind = 'ore' | 'gem' | 'material' | 'bar' | 'log' | 'ammo' | 'fish' | 'meat' | 'food' | 'herb' | 'potion' | 'mount' | 'junk' | 'tool' | 'weapon' | 'armour' | 'bag' | 'coins' | 'trinket' | 'plans';
export type WeaponClass = 'sword' | 'mace' | 'longsword' | 'battleaxe' | 'warhammer' | 'halberd' | 'spear' | 'bow' | 'staff' | 'fireStaff' | 'frostStaff' | 'lifeStaff';
export type ArmourType = 'cloth' | 'leather' | 'metal';
export type ToolKind = 'pickaxe' | 'hatchet' | 'rod' | 'knife';
/** Visual material for models and icons. */
export type Look = 'stone' | 'iron' | 'steel' | 'silversteel' | 'silver' | 'coal' | 'gold' | 'birch' | 'pine' | 'leather' | 'goblin' | 'lynx' | 'cloth' | 'linen' | 'jute' | 'ramie' | 'cotton' | 'bamboo' | 'silk' | 'bone';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  stack: number;
  /** 1 = stone/birch, 2 = iron/pine, 3 = steel, 4 = silversteel (steel with silver worked in). */
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
  /** Potions: heal `heal` HP over `sec` seconds (usable mid-fight), and/or an elixir buff. */
  potion?: { heal?: number; sec?: number; buff?: { name: string; stats: Partial<Stats>; sec: number } };
  /** Fixed bonuses every copy has (e.g. rods make the catch bar bigger). */
  mods?: Partial<Stats>;
  /** What the trading post pays (0 = it won't buy it). */
  sellValue: number;
  buyPrice?: number;
  /** Skinning knives: chance a skinning attempt ruins the hide, and uses before it breaks. */
  knife?: { fail: number; uses: number };
  /** Mounts: speed multiplier while riding, and coat colours for the model. */
  mount?: { mult: number; coat: number; mane: number; board?: boolean };
  /** Only ever exists at this rarity (boss uniques). */
  fixedRarity?: Rarity;
  /** Extra move-speed penalty on heavy plate (monster-dropped uniques that hit harder in return). */
  heavy?: number;
  /** Plans: reading them teaches this weapon's recipes for good. */
  teaches?: string;
  /** Does more damage the bigger the monster (great on giants and bosses, poor on goblins). */
  giantslayer?: boolean;
  blurb: string;
}

// ------------------------------------------------------------------ rarity

export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY: { name: string; color: string; mult: number; effects: number }[] = [
  { name: 'Normal', color: '#d8d4c8', mult: 1, effects: 0 },
  // Each metal tier is 1.25× the one before, so an epic (1.5×) lands between the next tier's
  // uncommon (1.15 × 1.25 ≈ 1.44) and rare (1.3 × 1.25 ≈ 1.63).
  { name: 'Uncommon', color: '#6fcf5f', mult: 1.15, effects: 1 },
  { name: 'Rare', color: '#4ea1e8', mult: 1.3, effects: 2 },
  { name: 'Epic', color: '#b77be8', mult: 1.5, effects: 3 },
  { name: 'Legendary', color: '#f2a23a', mult: 1.7, effects: 4 },
];

/**
 * Rarity when crafting (and for gear dropped by monsters). Luck (points) scales the chances:
 * 10 luck = +20%. Base: uncommon 12%, rare 3%, epic 0.6% — but epics only when `epic` is true
 * (the crafting skill's Masterpiece talent, or gear found on tougher monsters); otherwise that
 * roll comes out rare. Legendary never comes from crafting.
 */
export const CRAFT_ODDS = { uncommon: 0.12, rare: 0.03, epic: 0.006 };
export function rollCraftRarity(luck: number, rand: () => number, epic = false): Rarity {
  const k = 1 + Math.max(0, luck) * 0.02;
  const r = rand();
  if (r < CRAFT_ODDS.epic * k) return epic ? 3 : 2;
  if (r < (CRAFT_ODDS.epic + CRAFT_ODDS.rare) * k) return 2;
  if (r < (CRAFT_ODDS.epic + CRAFT_ODDS.rare + CRAFT_ODDS.uncommon) * k) return 1;
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
  { key: 'maxHp', groups: ['general'], min: 1, max: 5, flat: true },
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
  if (d.tool === 'knife') return []; // knives get better by rarity alone: more pelts, more uses
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
const ITEM_GEM_NAME: Record<string, string> = { quartz: 'a Mofjell quartz', sapphire: 'a sapphire', garnet: 'a garnet' };
const add = (d: ItemDef) => { defs.push(d); return d; };

// raw materials
add({ id: 'stone', name: 'Stone', kind: 'ore', stack: 10, tier: 1, look: 'stone', sellValue: 0, blurb: 'Mined from stone veins. Shape it at the anvil.' });
add({ id: 'iron_ore', name: 'Iron ore', kind: 'ore', stack: 10, tier: 2, look: 'iron', sellValue: 0, blurb: 'Rusty ore from iron veins. Smelt two into a bar.' });
add({ id: 'coal', name: 'Coal', kind: 'ore', stack: 20, tier: 3, look: 'coal', sellValue: 0, blurb: 'Black, crumbly and warm to the touch. Smelt it with iron ore into steel.' });
add({ id: 'silver_ore', name: 'Silver ore', kind: 'ore', stack: 10, tier: 3, look: 'silver', sellValue: 1, blurb: 'Found deep in the cave. Smelt two into a bar.' });
add({ id: 'quartz', name: 'Mofjell quartz', kind: 'gem', stack: 5, sellValue: 3, blurb: 'A rare find in stone veins. Imbues birch staffs.' });
add({ id: 'sapphire', name: 'Sapphire', kind: 'gem', stack: 5, sellValue: 8, blurb: 'A rare find in iron veins. Imbues pine staffs.' });
add({ id: 'garnet', name: 'Garnet', kind: 'gem', stack: 5, sellValue: 15, blurb: 'A deep red gem from silver veins.' });
add({ id: 'shaped_stone', name: 'Shaped stone', kind: 'material', stack: 10, tier: 1, look: 'stone', sellValue: 0, blurb: 'Two stones knapped into a usable block.' });
add({ id: 'iron_bar', name: 'Iron bar', kind: 'bar', stack: 10, tier: 2, look: 'iron', sellValue: 1, blurb: 'Smelted from two iron ore.' });
add({ id: 'silver_bar', name: 'Silver bar', kind: 'bar', stack: 10, tier: 3, look: 'silver', sellValue: 4, blurb: 'Smelted from two silver ore. For jewellery, and worked into steel for silversteel gear.' });
add({ id: 'steel_bar', name: 'Steel bar', kind: 'bar', stack: 10, tier: 3, look: 'steel', sellValue: 2, blurb: 'Iron ore smelted with coal: harder and lighter than iron.' });
add({ id: 'silversteel_bar', name: 'Silversteel bar', kind: 'bar', stack: 10, tier: 4, look: 'silversteel', sellValue: 6, blurb: 'Steel folded with silver. Takes an edge like nothing else, and turns spells.' });
add({ id: 'birch_log', name: 'Birch log', kind: 'log', stack: 10, tier: 1, look: 'birch', sellValue: 0, blurb: 'Pale, light wood. Shafts, shortbows, staffs.' });
add({ id: 'pine_log', name: 'Pine log', kind: 'log', stack: 10, tier: 2, look: 'pine', sellValue: 1, blurb: 'Tough, resinous wood for better bows and staffs.' });
add({ id: 'arrow_shaft', name: 'Arrow shafts', kind: 'material', stack: 100, look: 'birch', sellValue: 0, blurb: 'Fit arrowheads to them at the workbench.' });
add({ id: 'stone_arrowheads', name: 'Stone arrowheads', kind: 'material', stack: 100, tier: 1, look: 'stone', sellValue: 0, blurb: 'Knapped at the anvil, fitted at the workbench.' });
add({ id: 'iron_arrowheads', name: 'Iron arrowheads', kind: 'material', stack: 100, tier: 2, look: 'iron', sellValue: 0, blurb: 'Forged at the anvil, fitted at the workbench.' });
add({ id: 'stone_arrow', name: 'Stone arrows', kind: 'ammo', stack: 200, tier: 1, look: 'stone', slot: 'ammo', ammoDmg: 1, sellValue: 0, blurb: 'Wear them in the ammo slot. +1 damage per shot.' });
add({ id: 'steel_arrowheads', name: 'Steel arrowheads', kind: 'material', stack: 100, tier: 3, look: 'steel', sellValue: 0, blurb: 'Forged at the anvil, fitted at the workbench.' });
add({ id: 'steel_arrow', name: 'Steel arrows', kind: 'ammo', stack: 200, tier: 3, look: 'steel', slot: 'ammo', ammoDmg: 3, sellValue: 0, blurb: 'Wear them in the ammo slot. +3 damage per shot.' });
add({ id: 'iron_arrow', name: 'Iron arrows', kind: 'ammo', stack: 200, tier: 2, look: 'iron', slot: 'ammo', ammoDmg: 2, sellValue: 0, blurb: 'Wear them in the ammo slot. +2 damage per shot.' });

// fish and food
const FISH: [string, string, number, number, number, ItemDef['food']][] = [
  // id, name, sell raw, sell cooked, tier, food
  ['perch', 'Perch', 0, 1, 1, { heal: 6 }],
  ['trout', 'Trout', 1, 2, 1, { heal: 10, buff: { name: 'Well fed (trout)', stats: { miningSpeed: 0.05, woodSpeed: 0.05 }, sec: 600 } }],
  ['char', 'Arctic char', 1, 3, 2, { heal: 14, buff: { name: 'Well fed (char)', stats: { allDmg: 0.05 }, sec: 600 } }],
  ['pike', 'Pike', 2, 4, 2, { heal: 18, buff: { name: 'Well fed (pike)', stats: { maxHp: 6, regen: 1 }, sec: 600 } }],
];
for (const [id, name, raw, cooked, tier, food] of FISH) {
  add({ id: `raw_${id}`, name: `Raw ${name.toLowerCase()}`, kind: 'fish', stack: 10, tier, sellValue: raw, blurb: 'Cook it at a campfire or the inn’s stove.' });
  add({ id: `cooked_${id}`, name: `Cooked ${name.toLowerCase()}`, kind: 'food', stack: 10, tier, food, sellValue: cooked, blurb: `Eat it (hotbar) to heal ${food!.heal} HP${food!.buff ? ' and get a 10-minute buff' : ''}.` });
}
add({ id: 'raw_wolf_meat', name: 'Raw wolf meat', kind: 'meat', stack: 10, tier: 1, sellValue: 1, blurb: 'Tough and gamey. Cook it at a campfire or the inn’s stove.' });
add({ id: 'cooked_wolf_meat', name: 'Wolf steak', kind: 'food', stack: 10, tier: 1, food: { heal: 12, buff: { name: 'Well fed (wolf)', stats: { meleeDmg: 0.05, maxHp: 4 }, sec: 600 } }, sellValue: 2, blurb: 'Eat it (hotbar) to heal 12 HP and get a 10-minute buff. Not mid-fight.' });
add({ id: 'burnt_fish', name: 'Burnt food', kind: 'junk', stack: 10, sellValue: 0, blurb: 'Charcoal. Drop it.' });
add({ id: 'old_boot', name: 'Old boot', kind: 'junk', stack: 5, sellValue: 0, blurb: 'Someone lost this in the lake. Smells like it.' });
add({ id: 'golden_perch', name: 'Golden perch', kind: 'fish', stack: 5, tier: 2, sellValue: 20, blurb: 'A rare, shimmering perch. Traders love it.' });

// mob drops
add({ id: 'coins', name: 'Coins', kind: 'coins', stack: 9999, sellValue: 0, blurb: 'Picked up straight into your purse.' });
add({ id: 'wolf_pelt', name: 'Wolf pelt', kind: 'material', stack: 10, look: 'leather', sellValue: 2, blurb: 'Skinned from a wolf. Tan it into leather at a tanning rack.' });
add({ id: 'goblin_skin', name: 'Goblin skin', kind: 'material', stack: 10, look: 'goblin', sellValue: 3, blurb: 'Tough, greenish hide from goblins. Tan it at a tanning rack.' });
add({ id: 'leather', name: 'Leather', kind: 'material', stack: 10, tier: 1, look: 'leather', sellValue: 3, blurb: 'Tanned wolf pelt. Leather armour is made from it.' });
add({ id: 'goblin_leather', name: 'Goblin leather', kind: 'material', stack: 10, tier: 2, look: 'goblin', sellValue: 6, blurb: 'Tanned goblin skin. Tougher than wolf leather.' });
add({ id: 'lynx_pelt', name: 'Lynx pelt', kind: 'material', stack: 10, look: 'lynx', sellValue: 6, blurb: 'Soft, spotted and warm. Skinned from Gruben’s lynxes. Tan it at a tanning rack.' });
add({ id: 'lynx_leather', name: 'Lynx leather', kind: 'material', stack: 10, tier: 3, look: 'lynx', sellValue: 10, blurb: 'Tanned lynx pelt: supple and strong. Tier 3 leather.' });
add({ id: 'grave_dust', name: 'Grave dust', kind: 'material', stack: 20, sellValue: 2, blurb: 'What’s left of a draug. Alchemy will want it.' });
add({ id: 'wisp_essence', name: 'Wisp essence', kind: 'material', stack: 10, sellValue: 6, blurb: 'A cold, faintly glowing mote. Enchanting will want it.' });
add({ id: 'kings_crown', name: 'Rusted crown', kind: 'trinket', stack: 5, sellValue: 60, blurb: 'Proof you put the Mine King back to rest.' });
// Fibres for tailoring, picked by hand, each spun into thread and woven into cloth:
// flax → linen, jute → hessian, ramie, cotton, bamboo. (Cotton keeps its old ids so saves still work.)
add({ id: 'flax', name: 'Flax', kind: 'material', stack: 20, tier: 1, look: 'linen', sellValue: 0, blurb: 'Pulled from the flax fields in the meadows. Spin it at a loom.' });
add({ id: 'jute', name: 'Jute stalks', kind: 'material', stack: 20, tier: 1, look: 'jute', sellValue: 1, blurb: 'Tall jute from the wet ground around the lake. Coarse, strong fibre.' });
add({ id: 'ramie', name: 'Ramie stems', kind: 'material', stack: 20, tier: 2, look: 'ramie', sellValue: 1, blurb: 'Ramie, a nettle without the sting. Its bark gives a glossy fibre stronger than linen.' });
add({ id: 'bog_cotton', name: 'Cotton bolls', kind: 'material', stack: 20, tier: 2, look: 'cotton', sellValue: 2, blurb: 'Fluffy white cotton from the sheltered terraces at Gruben.' });
add({ id: 'bamboo', name: 'Bamboo canes', kind: 'material', stack: 20, tier: 3, look: 'bamboo', sellValue: 3, blurb: 'From the bamboo grove in Gruben’s warm bog. Pulped and spun, it makes a cool, silky fibre.' });
add({ id: 'linen_thread', name: 'Linen thread', kind: 'material', stack: 20, tier: 1, look: 'linen', sellValue: 0, blurb: 'Spun flax. Weave it into linen.' });
add({ id: 'linen', name: 'Linen', kind: 'material', stack: 10, tier: 1, look: 'linen', sellValue: 2, blurb: 'Woven linen cloth. Linen garments are made from it.' });
add({ id: 'jute_thread', name: 'Jute twine', kind: 'material', stack: 20, tier: 1, look: 'jute', sellValue: 1, blurb: 'Spun jute. Weave it into hessian.' });
add({ id: 'hessian', name: 'Hessian', kind: 'material', stack: 10, tier: 1, look: 'jute', sellValue: 3, blurb: 'Rough, sturdy jute cloth.' });
add({ id: 'ramie_thread', name: 'Ramie thread', kind: 'material', stack: 20, tier: 2, look: 'ramie', sellValue: 1, blurb: 'Spun ramie, with a faint sheen. Weave it into ramie cloth.' });
add({ id: 'ramie_cloth', name: 'Ramie cloth', kind: 'material', stack: 10, tier: 2, look: 'ramie', sellValue: 4, blurb: 'Crisp and strong, and it keeps its shape.' });
add({ id: 'cotton_thread', name: 'Cotton thread', kind: 'material', stack: 20, tier: 2, look: 'cotton', sellValue: 2, blurb: 'Spun cotton. Weave it into cotton cloth.' });
add({ id: 'cotton_cloth', name: 'Cotton cloth', kind: 'material', stack: 10, tier: 2, look: 'cotton', sellValue: 6, blurb: 'Soft, light and warm.' });
add({ id: 'bamboo_thread', name: 'Bamboo thread', kind: 'material', stack: 20, tier: 3, look: 'bamboo', sellValue: 3, blurb: 'Bamboo pulp spun into a smooth thread. Weave it into bamboo cloth.' });
add({ id: 'bamboo_cloth', name: 'Bamboo cloth', kind: 'material', stack: 10, tier: 3, look: 'bamboo', sellValue: 8, blurb: 'Silky, cool and tough. The finest everyday cloth.' });
add({ id: 'spirit_silk', name: 'Spirit silk', kind: 'material', stack: 10, tier: 3, look: 'silk', sellValue: 12, blurb: 'Bamboo cloth woven through with wisp essence. It hums faintly.' });
// herbs (herbalism) and potions (alchemy)
add({ id: 'angelica', name: 'Angelica', kind: 'herb', stack: 20, tier: 1, sellValue: 0, blurb: 'Kvann: a tall, sweet-smelling herb from the meadows and stream banks. Brews healing draughts.' });
add({ id: 'cloudberry', name: 'Cloudberries', kind: 'herb', stack: 20, tier: 1, sellValue: 1, blurb: 'Multe: amber berries from the wet ground by the lake and in the bog.' });
add({ id: 'roseroot', name: 'Roseroot', kind: 'herb', stack: 20, tier: 2, sellValue: 2, blurb: 'Rosenrot: a hardy root from rocky high ground. Old folk swear it gives strength.' });
add({ id: 'grave_moss', name: 'Grave moss', kind: 'herb', stack: 20, tier: 3, sellValue: 3, blurb: 'Pale moss that only grows where the dead walk. Gruben.' });
add({ id: 'vial', name: 'Empty vial', kind: 'material', stack: 20, sellValue: 0, buyPrice: 2, blurb: 'Ragna sells them. Every potion needs one.' });
export const POTION_CD_MS = 20_000;
const POTIONS: [string, string, NonNullable<ItemDef['potion']>, number, string][] = [
  ['healing_draught', 'Healing draught', { heal: 20, sec: 10 }, 3, 'Heals 20 HP over 10 s. Works mid-fight.'],
  ['cloudberry_tonic', 'Cloudberry tonic', { heal: 38, sec: 10 }, 6, 'Heals 38 HP over 10 s. Works mid-fight.'],
  ['grave_draught', 'Grave draught', { heal: 70, sec: 12 }, 12, 'Heals 70 HP over 12 s. Works mid-fight. Tastes like a cellar.'],
  ['strength_elixir', 'Roseroot elixir', { buff: { name: 'Elixir: roseroot', stats: { meleeDmg: 0.08, rangedDmg: 0.08 }, sec: 900 } }, 8, '+8% melee and ranged damage for 15 min.'],
  ['mind_elixir', 'Lantern elixir', { buff: { name: 'Elixir: lantern', stats: { magicDmg: 0.1, ward: 2 }, sec: 900 } }, 10, '+10% magic damage and +2 ward for 15 min.'],
  ['warding_elixir', 'Warding elixir', { buff: { name: 'Elixir: warding', stats: { magicRed: 0.08, armour: 3 }, sec: 900 } }, 10, '+8% magic damage reduction and +3 armour for 15 min.'],
];
for (const [id, name, potion, sell, blurb] of POTIONS) add({ id, name, kind: 'potion', stack: 10, potion, sellValue: sell, blurb: `${blurb} Potions share a 20 s cooldown; one elixir at a time.` });
add({ id: 'goblin_trinket', name: 'Goblin trinket', kind: 'junk', stack: 10, sellValue: 4, blurb: 'Shiny junk goblins hoard.' });
add({ id: 'bat_wing', name: 'Bat wing', kind: 'material', stack: 10, sellValue: 1, blurb: 'Leathery. Alchemy will want these.' });
add({ id: 'troll_tooth', name: 'Troll tooth', kind: 'trinket', stack: 5, sellValue: 25, blurb: 'Proof you beat Old Knut.' });

// tools
add({ id: 'stone_pickaxe', name: 'Stone pickaxe', kind: 'tool', stack: 1, tier: 1, look: 'stone', slot: 'pickaxe', tool: 'pickaxe', power: 1, swingSec: 2.6, sellValue: 2, buyPrice: 10, blurb: 'Mines stone and iron.' });
add({ id: 'iron_pickaxe', name: 'Iron pickaxe', kind: 'tool', stack: 1, tier: 2, look: 'iron', slot: 'pickaxe', tool: 'pickaxe', power: 2, swingSec: 1.9, sellValue: 6, blurb: 'Faster, and strong enough for silver.' });
add({ id: 'steel_pickaxe', name: 'Steel pickaxe', kind: 'tool', stack: 1, tier: 3, look: 'steel', slot: 'pickaxe', tool: 'pickaxe', power: 3, swingSec: 1.5, sellValue: 12, blurb: 'Light and hard. Swings fast.' });
add({ id: 'silversteel_pickaxe', name: 'Silversteel pickaxe', kind: 'tool', stack: 1, tier: 4, look: 'silversteel', slot: 'pickaxe', tool: 'pickaxe', power: 4, swingSec: 1.25, mods: { gemChance: 0.25 }, sellValue: 25, blurb: 'Rings like a bell on stone. Gems seem to find it (+25% gem chance).' });
add({ id: 'stone_hatchet', name: 'Stone hatchet', kind: 'tool', stack: 1, tier: 1, look: 'stone', slot: 'hatchet', tool: 'hatchet', power: 1, swingSec: 2.4, sellValue: 2, buyPrice: 10, blurb: 'Fells birch and pine.' });
add({ id: 'iron_hatchet', name: 'Iron hatchet', kind: 'tool', stack: 1, tier: 2, look: 'iron', slot: 'hatchet', tool: 'hatchet', power: 2, swingSec: 1.8, sellValue: 6, blurb: 'Bites deeper; fells trees a third faster.' });
add({ id: 'steel_hatchet', name: 'Steel hatchet', kind: 'tool', stack: 1, tier: 3, look: 'steel', slot: 'hatchet', tool: 'hatchet', power: 3, swingSec: 1.4, sellValue: 12, blurb: 'Holds an edge all day.' });
add({ id: 'silversteel_hatchet', name: 'Silversteel hatchet', kind: 'tool', stack: 1, tier: 4, look: 'silversteel', slot: 'hatchet', tool: 'hatchet', power: 4, swingSec: 1.2, mods: { doubleYield: 0.08 }, sellValue: 25, blurb: 'Splits clean: sometimes two logs from one cut (+8%).' });
add({ id: 'stone_skinning_knife', name: 'Stone skinning knife', kind: 'tool', stack: 1, tier: 1, look: 'stone', slot: 'knife', tool: 'knife', power: 1, knife: { fail: 0.35, uses: 12 }, sellValue: 1, blurb: 'Wear it to skin wolves and goblins (E on the body). Wears out; repair it at an anvil.' });
add({ id: 'iron_skinning_knife', name: 'Iron skinning knife', kind: 'tool', stack: 1, tier: 2, look: 'iron', slot: 'knife', tool: 'knife', power: 2, knife: { fail: 0.18, uses: 25 }, sellValue: 4, blurb: 'Ruins far fewer hides and lasts twice as long. Repair it at an anvil.' });
add({ id: 'steel_skinning_knife', name: 'Steel skinning knife', kind: 'tool', stack: 1, tier: 3, look: 'steel', slot: 'knife', tool: 'knife', power: 3, knife: { fail: 0.1, uses: 40 }, sellValue: 8, blurb: 'Rarely ruins a hide. Repair it at an anvil.' });
add({ id: 'silversteel_skinning_knife', name: 'Silversteel skinning knife', kind: 'tool', stack: 1, tier: 4, look: 'silversteel', slot: 'knife', tool: 'knife', power: 4, knife: { fail: 0.05, uses: 60 }, sellValue: 16, blurb: 'Almost never ruins a hide, and lasts and lasts. Repair it at an anvil.' });
add({ id: 'basic_rod', name: 'Basic fishing rod', kind: 'tool', stack: 1, tier: 1, look: 'birch', slot: 'rod', tool: 'rod', power: 1, sellValue: 2, buyPrice: 10, blurb: 'A stick, a line and hope.' });
add({ id: 'birch_rod', name: 'Birch fishing rod', kind: 'tool', stack: 1, tier: 1, look: 'birch', slot: 'rod', tool: 'rod', power: 1, mods: { fishEase: 0.1 }, sellValue: 4, blurb: 'Springy birch: a bigger catch bar.' });
add({ id: 'pine_rod', name: 'Pine fishing rod', kind: 'tool', stack: 1, tier: 2, look: 'pine', slot: 'rod', tool: 'rod', power: 2, mods: { fishEase: 0.2, fishSpeed: 0.1 }, sellValue: 10, blurb: 'Lands the big ones: pike and char bite sooner.' });

/** Smithed metal tiers, in order. Silver itself is for jewellery and silversteel. */
export const METALS = ['stone', 'iron', 'steel', 'silversteel'] as const;
const metalName = (t: string) => (t === 'silversteel' ? 'Silversteel' : t[0].toUpperCase() + t.slice(1));
const ARMOUR_MULT = [1, 1.8, 2.6, 3.4];

// weapons: [class, dps per tier, interval, range, twoHanded]
// Melee weapons. DPS per tier: tier 1 × 1.25 each step. One-handers do less, but with a shield
// in the off hand their right click becomes a defensive move (see SHIELD_SPECIALS in combat.ts).
// Warhammer, halberd and spear are smithed only after you find their plans.
export const TIER_STEP = 1.25;
export const PLANS_WEAPONS = ['warhammer', 'halberd', 'spear'] as const;
const W: Record<'sword' | 'mace' | 'longsword' | 'battleaxe' | 'warhammer' | 'halberd' | 'spear', { name: string; dps: number; interval: number; range: number; two: boolean; blurb: string }> = {
  sword: { name: 'sword', dps: 4.2, interval: 1.6, range: 2.6, two: false, blurb: 'One-handed. Right click: Heavy Strike (2.5×, 8 s). With a shield: Parry — the next melee hit on you within 4 s does 80% less, and you strike back (6 s).' },
  mace: { name: 'mace', dps: 4.2, interval: 2.0, range: 2.5, two: false, blurb: 'One-handed. Right click: Crush (2×, stuns 1 s, 9 s). With a shield: Shield Bash — stun 1.2 s and make it fight you for 6 s; your next hit taken is halved (8 s).' },
  longsword: { name: 'longsword', dps: 5.5, interval: 2.3, range: 3.5, two: true, blurb: 'Two-handed. Right click: Whirlwind — 1.6× to everything within 3.8 m (12 s).' },
  battleaxe: { name: 'battleaxe', dps: 4.4, interval: 2.5, range: 3.3, two: true, blurb: 'Two-handed. Right click: Executioner (4×, 18 s).' },
  warhammer: { name: 'warhammer', dps: 5.9, interval: 2.9, range: 3.2, two: true, blurb: 'Two-handed. Heavy blows. Right click: Quake — 1.2× to everything within 4.5 m and stuns them 1.2 s (15 s).' },
  halberd: { name: 'halberd', dps: 5.3, interval: 2.4, range: 4.3, two: true, blurb: 'Two-handed, long reach. Right click: Sweep — 1.7× to everything in front of you within 4.5 m (10 s).' },
  spear: { name: 'spear', dps: 5.4, interval: 1.8, range: 4.7, two: true, blurb: 'Two-handed, the longest reach. Quick jabs, a weak right click: Lunge (1.6×, 8 s).' },
};
for (const [cls, w] of Object.entries(W) as [keyof typeof W, typeof W.sword][]) {
  METALS.forEach((t, i) => add({
    id: `${t}_${cls}`, name: `${metalName(t)} ${w.name}`, kind: 'weapon', stack: 1, tier: i + 1, look: t as Look,
    slot: 'mainHand', weapon: cls, dps: Math.round(w.dps * TIER_STEP ** i * 100) / 100, interval: w.interval, range: w.range, twoHanded: w.two, sellValue: [1, 2, 4, 8][i] * (w.two ? 3 : 2), blurb: w.blurb,
    ...(t === 'silversteel' ? { mods: { allDmg: 0.04, crit: 0.02 } } : {}),
  }));
}
for (const wpn of PLANS_WEAPONS) add({ id: `${wpn}_plans`, name: `${wpn[0].toUpperCase()}${wpn.slice(1)} plans`, kind: 'plans', stack: 1, sellValue: 6, teaches: wpn, blurb: `A smith’s drawings for a ${wpn}. Use it (E in the bag, or right click → Use) to learn to smith ${wpn}s at the anvil, in every metal.` });
add({ id: 'jotunbane', name: 'Jotunbane', kind: 'weapon', stack: 1, tier: 4, look: 'silversteel', slot: 'mainHand', weapon: 'battleaxe', dps: 8, interval: 2.6, range: 3.4, twoHanded: true, fixedRarity: 4, giantslayer: true, mods: { crit: 0.03 }, sellValue: 120, blurb: 'Giantslayer: the bigger the foe, the deeper it bites — up to +60% on the largest trolls, but goblins and bats barely notice it. Right click: Executioner (4×, 18 s).' });
add({ id: 'birch_shortbow', name: 'Birch shortbow', kind: 'weapon', stack: 1, tier: 1, look: 'birch', slot: 'mainHand', weapon: 'bow', dps: 4.5, interval: 2.0, range: 28, twoHanded: true, sellValue: 3, blurb: 'Needs arrows in the ammo slot. Right click: Power Shot (3×, 10 s).' });
add({ id: 'pine_longbow', name: 'Pine longbow', kind: 'weapon', stack: 1, tier: 2, look: 'pine', slot: 'mainHand', weapon: 'bow', dps: 5.6, interval: 2.2, range: 34, twoHanded: true, sellValue: 7, blurb: 'Needs arrows in the ammo slot. Right click: Power Shot (3×, 10 s).' });
for (const [wood, tier, dps] of [['birch', 1, 2.5], ['pine', 2, 3.5]] as const) {
  const W2 = wood[0].toUpperCase() + wood.slice(1);
  add({ id: `${wood}_staff`, name: `${W2} staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'staff', dps, interval: 1.8, range: 2.6, twoHanded: true, sellValue: tier * 2, blurb: 'A clumsy club until the Imbuer in Bjørkvik makes it magical.' });
  add({ id: `${wood}_fire_staff`, name: `${W2} fire staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'fireStaff', dps: tier === 1 ? 3 : 3.75, interval: 1.8, range: 26, twoHanded: true, sellValue: tier * 8, blurb: 'Light firebolts that set a burn (stacks to 3, most of the damage is in the burn). Right click: Ignite — every burning enemy nearby takes 45% of a firebolt per burn stack (12 s).' });
  add({ id: `${wood}_life_staff`, name: `${W2} life staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'lifeStaff', dps: tier === 1 ? 2.5 : 3.1, interval: 2.0, range: 26, twoHanded: true, sellValue: tier * 8, blurb: 'A healer’s staff. Click a player to heal them (or no one, to heal yourself); on monsters it only stings. Right click: Mending Circle — heal everyone within 8 m (14 s).' });
  add({ id: `${wood}_frost_staff`, name: `${W2} frost staff`, kind: 'weapon', stack: 1, tier, look: wood, slot: 'mainHand', weapon: 'frostStaff', dps: tier === 1 ? 5 : 6.25, interval: 2.6, range: 26, twoHanded: true, sellValue: tier * 8, blurb: 'Slow, heavy frostbolts. Right click: Frost Nova — freeze everything within 6 m for 2.5 s (15 s).' });
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
/** Cloth armour tiers, weakest first. `step` is how many Tailoring levels above linen each one sits. */
export const CLOTHS: { prefix: string; name: string; look: Look; cloth: string; tier: number; step: number; armour: number; ward: number; minWard: number; sell: number; mods?: Partial<Stats>; blurb: string }[] = [
  { prefix: 'cloth', name: 'Linen', look: 'linen', cloth: 'linen', tier: 1, step: 0, armour: 1, ward: 1, minWard: 0, sell: 2, blurb: 'Light woven linen. Turns spells well, but won’t stop much of a blade. Made at a loom.' },
  { prefix: 'jute', name: 'Hessian', look: 'jute', cloth: 'hessian', tier: 1, step: 6, armour: 1.6, ward: 1.3, minWard: 1, sell: 3, blurb: 'Coarse jute cloth, doubled up. Scratchy, but it stops a bit more than linen. Made at a loom.' },
  { prefix: 'ramie', name: 'Ramie', look: 'ramie', cloth: 'ramie_cloth', tier: 2, step: 12, armour: 1.6, ward: 1.7, minWard: 1, sell: 5, blurb: 'Strong, glossy ramie that holds its shape. Made at a loom.' },
  { prefix: 'cotton', name: 'Cotton', look: 'cotton', cloth: 'cotton_cloth', tier: 2, step: 18, armour: 1.6, ward: 2.2, minWard: 1, sell: 7, blurb: 'Soft quilted cotton. Good against spells. Made at a loom.' },
  { prefix: 'bamboo', name: 'Bamboo', look: 'bamboo', cloth: 'bamboo_cloth', tier: 3, step: 24, armour: 1.8, ward: 2.6, minWard: 2, sell: 10, blurb: 'Silky bamboo cloth, cool and tough. Made at a loom.' },
  { prefix: 'silk', name: 'Spirit-silk', look: 'silk', cloth: 'spirit_silk', tier: 3, step: 30, armour: 2, ward: 3.2, minWard: 2, sell: 14, mods: { magicDmg: 0.03 }, blurb: 'Woven with wisp essence; it drinks in spells. Made at a loom.' },
];
for (const p of ARMOUR_PIECES) {
  METALS.forEach((t, i) => add({
    id: `${t}_${p.piece}`, name: `${metalName(t)} ${p.name.metal}`, kind: 'armour', stack: 1, tier: i + 1, look: t as Look,
    slot: p.slot, armourType: 'metal', armour: Math.round(p.metal * ARMOUR_MULT[i]), ward: t === 'silversteel' ? Math.max(1, Math.round(p.metal * 0.6)) : 0, sellValue: Math.ceil(p.bars / 6) * [1, 2, 4, 8][i],
    blurb: (p.slot === 'offHand' ? 'A sturdy shield for blocking blows. Goes with one-handed weapons.' : 'Heavy plate that blades struggle through. Slows you a touch, and spells bite a little harder.')
      + (t === 'silversteel' ? ' The silver worked into it turns some magic, too.' : ''),
  }));
  if (p.slot === 'offHand') continue;
  add({ id: `leather_${p.piece}`, name: `Leather ${p.name.leather}`, kind: 'armour', stack: 1, tier: 1, look: 'leather', slot: p.slot, armourType: 'leather', armour: p.leather[0], ward: p.leather[1], sellValue: 2, blurb: 'Supple wolf leather. Fair against blades and spells alike, and light on the feet.' });
  add({ id: `goblinhide_${p.piece}`, name: `Goblinhide ${p.name.leather}`, kind: 'armour', stack: 1, tier: 2, look: 'goblin', slot: p.slot, armourType: 'leather', armour: Math.max(1, Math.round(p.leather[0] * 1.8)), ward: Math.round(p.leather[1] * 1.8), sellValue: 5, blurb: 'Tough goblin hide, tanned and stitched. Sturdier than wolf leather.' });
  add({ id: `lynxhide_${p.piece}`, name: `Lynxhide ${p.name.leather}`, kind: 'armour', stack: 1, tier: 3, look: 'lynx', slot: p.slot, armourType: 'leather', armour: Math.max(1, Math.round(p.leather[0] * 2.6)), ward: Math.round(p.leather[1] * 2.6), sellValue: 10, blurb: 'Soft, spotted lynx hide. The finest leather this side of the mountains.' });
  // Cloth (tailoring), weakest to best: linen (ids kept as cloth_*), jute, ramie, cotton, bamboo, spirit silk.
  for (const c of CLOTHS) add({
    id: `${c.prefix}_${p.piece}`, name: `${c.name} ${p.name.cloth}`, kind: 'armour', stack: 1, tier: c.tier, look: c.look, slot: p.slot, armourType: 'cloth',
    armour: Math.round(p.cloth[0] * c.armour), ward: Math.max(c.minWard, Math.round(p.cloth[1] * c.ward)), mods: c.mods, sellValue: c.sell, blurb: c.blurb,
  });
}

// jewellery: silver with a gem set in it (crafted at the anvil, rolls rarity like other gear)
export const JEWELS: { gem: string; name: string; ring: Partial<Stats>; neck: Partial<Stats> }[] = [
  { gem: '', name: 'Silver', ring: { maxHp: 4 }, neck: { maxHp: 6 } },
  { gem: 'quartz', name: 'Quartz', ring: { luck: 4, xp: 0.03 }, neck: { luck: 6, xp: 0.05 } },
  { gem: 'sapphire', name: 'Sapphire', ring: { magicDmg: 0.05, ward: 1 }, neck: { magicDmg: 0.08, ward: 2 } },
  { gem: 'garnet', name: 'Garnet', ring: { meleeDmg: 0.04, rangedDmg: 0.04 }, neck: { allDmg: 0.06, maxHp: 4 } },
];
for (const j of JEWELS) {
  const base = j.gem ? `${j.gem}_` : 'silver_';
  add({ id: `${base}ring`, name: `${j.name} ring`, kind: 'trinket', stack: 1, tier: 3, look: 'silver', slot: 'ring', mods: j.ring, sellValue: j.gem ? 20 : 8, blurb: j.gem ? `Silver set with ${ITEM_GEM_NAME[j.gem]}.` : 'A plain silver band.' });
  add({ id: `${base}necklace`, name: `${j.name} necklace`, kind: 'trinket', stack: 1, tier: 3, look: 'silver', slot: 'neck', mods: j.neck, sellValue: j.gem ? 30 : 12, blurb: j.gem ? `A silver chain with ${ITEM_GEM_NAME[j.gem]}.` : 'A fine silver chain.' });
}

// bags and boss uniques
add({ id: 'small_rucksack', name: 'Small rucksack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 4, sellValue: 10, buyPrice: 40, blurb: '+4 bag slots.' });
add({ id: 'leather_backpack', name: 'Leather backpack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 8, sellValue: 30, buyPrice: 120, blurb: '+8 bag slots.' });
// mounts (wear one in the mount slot, press R to ride)
add({ id: 'skateboard', name: 'Skateboard', kind: 'mount', stack: 1, slot: 'mount', mount: { mult: 1.4, coat: 0xd8a040, mane: 0xe8e4da, board: true }, sellValue: 15, buyPrice: 60, blurb: 'Four wheels and a plank. Roll at 140% speed — gravel paths and all. Not in the mine or indoors.' });
add({ id: 'fjord_horse', name: 'Fjord horse', kind: 'mount', stack: 1, slot: 'mount', mount: { mult: 1.6, coat: 0xc8a878, mane: 0x3a2a1c }, sellValue: 60, buyPrice: 250, blurb: 'A sturdy dun Fjord horse with a striped mane. Ride at 160% speed. Not in the mine or indoors.' });
add({ id: 'black_fjord_horse', name: 'Black Fjord horse', kind: 'mount', stack: 1, slot: 'mount', mount: { mult: 1.75, coat: 0x2a2624, mane: 0xd8d0c0 }, sellValue: 120, buyPrice: 600, blurb: 'Rare, dark and quick. Ride at 175% speed.' });
add({ id: 'dovre_stallion', name: 'Dovre stallion', kind: 'mount', stack: 1, slot: 'mount', fixedRarity: 4, mount: { mult: 2.0, coat: 0x8a9298, mane: 0xeef2f6 }, sellValue: 300, blurb: 'A grey giant of a horse that walked out of the Mine King’s pit. Ride at 200% speed.' });
// Heavy plate: rare monster drops. They slow you down, and pay for it with big stats.
add({ id: 'knuts_bellyplate', name: 'Old Knut’s belly plate', kind: 'armour', stack: 1, tier: 2, look: 'iron', slot: 'chest', armourType: 'metal', armour: 9, fixedRarity: 3, heavy: 0.04, mods: { maxHp: 15, thorns: 4 }, sellValue: 40, blurb: 'A cauldron lid Knut beat into a breastplate. Heavy as sin. Anything that hits you gets hurt back.' });
add({ id: 'barrow_helm', name: 'Barrow-king’s helm', kind: 'armour', stack: 1, tier: 3, look: 'steel', slot: 'head', armourType: 'metal', armour: 5, ward: 2, fixedRarity: 3, heavy: 0.02, mods: { maxHp: 8, physRed: 0.04 }, sellValue: 45, blurb: 'Dug up with a draug still inside. Cold, heavy, and very hard to dent.' });
add({ id: 'trolliron_greaves', name: 'Troll-iron greaves', kind: 'armour', stack: 1, tier: 3, look: 'steel', slot: 'legs', armourType: 'metal', armour: 8, fixedRarity: 3, heavy: 0.03, mods: { meleeDmg: 0.08, maxHp: 10 }, sellValue: 50, blurb: 'Hammered by hill trolls for hill trolls. You plod — but you kick like one.' });
add({ id: 'mine_kings_pauldrons', name: 'Mine King’s pauldrons', kind: 'armour', stack: 1, tier: 4, look: 'silversteel', slot: 'shoulders', armourType: 'metal', armour: 7, ward: 3, fixedRarity: 4, heavy: 0.03, mods: { allDmg: 0.06, physRed: 0.05 }, sellValue: 90, blurb: 'Silversteel the size of cart wheels. They weigh you down, and nothing much gets through.' });
add({ id: 'mine_kings_ring', name: 'Mine King’s signet', kind: 'trinket', stack: 1, slot: 'ring', fixedRarity: 4, mods: { maxHp: 8, allDmg: 0.06, miningSpeed: 0.1, gemChance: 0.3 }, sellValue: 90, blurb: 'Heavy, cold silver. The Mine King wore it for three hundred years.' });
add({ id: 'trolltooth_necklace', name: 'Trolltooth necklace', kind: 'trinket', stack: 1, slot: 'neck', fixedRarity: 4, mods: { maxHp: 10, meleeDmg: 0.06, luck: 5 }, sellValue: 60, blurb: 'Old Knut’s own. Rarely, he drops it.' });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export const BASE_BAG_SLOTS = 16;
export const START_GOLD = 6;
/** Everyone starts with these tools worn. */
export const START_TOOLS = ['stone_pickaxe', 'stone_hatchet', 'basic_rod', 'stone_skinning_knife'];
/** Traders pay half an item's value (more for rarer copies). Fractions add up when you sell a stack. */
export const SELL_RATE = 0.5;
export const sellEach = (s: Pick<Stack, 'id' | 'r'>, sellMult = 1) => { const d = ITEMS[s.id]; return d && d.sellValue > 0 ? d.sellValue * SELL_RATE * (1 + (s.r ?? 0) * 0.5) * sellMult : 0; };

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
  { slot: 'knife', label: 'Skinning knife' },
  { slot: 'mount', label: 'Mount' },
];

export const KIND_LABEL: Record<ItemKind, string> = {
  ore: 'Ore', gem: 'Gem', material: 'Material', bar: 'Bar', log: 'Log', ammo: 'Ammunition', fish: 'Raw fish', meat: 'Raw meat', food: 'Food', herb: 'Herb', potion: 'Potion', mount: 'Mount', junk: 'Junk',
  tool: 'Tool', weapon: 'Weapon', armour: 'Armour', bag: 'Bag', coins: 'Coins', trinket: 'Trinket', plans: 'Plans',
};

// ------------------------------------------------------------------ stacks, bag and equipment

/** A stack in the bag or a worn item. Gear with a rarity or effects is unique and never stacks. */
export interface Stack { id: string; qty: number; r?: Rarity; fx?: Effect[]; /** Uses left (skinning knives). */ d?: number }
export type Bag = (Stack | null)[];
export type Equipment = Partial<Record<Slot, Stack>>;

export const isPlain = (s: Stack) => !s.r && !s.fx?.length && s.d == null;
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
  if (Number.isInteger(s.d) && s.d >= 0) out.d = s.d;
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
  // Plate barely slows you (−0.5% a piece); heavy uniques slow you more but give a lot more back.
  if (d.armourType === 'metal' && d.slot !== 'offHand') { out.moveSpeed -= 0.005 + (d.heavy ?? 0); out.magicTaken += 0.03; }
  if (d.armourType === 'leather') out.moveSpeed += 0.01;
  if (d.slot === 'offHand' && d.armourType === 'metal') out.block += 0.2;
  addStats(out, d.mods);
  for (const [k, v] of s.fx ?? []) out[k] += v;
  const clean: Partial<Stats> = {};
  for (const [k, v] of Object.entries(out)) if (v) clean[k as keyof Stats] = v;
  return clean;
}

/** Weapon damage per basic hit for this copy (dps × interval × rarity). */
export function weaponHit(s: Stack | undefined): number {
  const d = s ? ITEMS[s.id] : undefined;
  if (!d?.dps) return 1.5; // fists
  return d.dps * (d.interval ?? 1.6) * RARITY[s!.r ?? 0].mult;
}

export const BARS_PER_ITEM: Record<string, number> = Object.fromEntries(ARMOUR_PIECES.map((p) => [p.piece, p.bars]));

/** Most uses a skinning knife can have (tier, then +30% per rarity step). */
export const knifeUses = (s: Pick<Stack, 'id' | 'r'>) => Math.round((ITEMS[s.id]?.knife?.uses ?? 0) * (1 + 0.3 * (s.r ?? 0)));
/** Extra pelt chance from a knife's rarity: +10% per step. */
export const knifeBonus = (s: Pick<Stack, 'r'>) => 0.1 * (s.r ?? 0);
/** What a repair at the anvil costs. */
export const knifeRepair = (id: string) => ({ item: ['shaped_stone', 'iron_bar', 'steel_bar', 'silversteel_bar'][(ITEMS[id]?.tier ?? 1) - 1] ?? 'shaped_stone', qty: 1 });
