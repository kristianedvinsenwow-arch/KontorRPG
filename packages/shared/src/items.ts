/**
 * Items, equipment slots and the bag (design doc §6, plus M1 decisions):
 *  - the bag has 16 slots to start; a bag worn in the back slot adds more
 *  - ores and bars stack to 10, gems to 5, gear doesn't stack
 *  - the pickaxe lives in its own tool slot, so a weapon can stay equipped
 */

export type Slot =
  | 'head' | 'shoulders' | 'chest' | 'legs' | 'hands' | 'feet' | 'back'
  | 'mainHand' | 'offHand' | 'ring' | 'neck' | 'tool' | 'rod' | 'ammo';

export type ItemKind = 'ore' | 'gem' | 'material' | 'bar' | 'tool' | 'weapon' | 'armour' | 'bag';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  stack: number;
  tier?: 'stone' | 'iron';
  slot?: Slot;
  /** Pickaxe power: a vein needs at least its power. */
  toolPower?: number;
  /** Seconds per pickaxe swing at Mining 1. */
  swingSec?: number;
  dps?: number;
  armour?: number;
  /** Extra bag slots while worn in the back slot. */
  bagSlots?: number;
  /** What the trading post pays (0 = it won't buy it). */
  sellValue: number;
  /** What the trading post charges, if it sells this. */
  buyPrice?: number;
  blurb: string;
}

const I = (d: ItemDef) => d;
export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  I({ id: 'stone', name: 'Stone', kind: 'ore', stack: 10, tier: 'stone', sellValue: 0, blurb: 'Mined from stone veins. Shape it at the anvil.' }),
  I({ id: 'iron_ore', name: 'Iron ore', kind: 'ore', stack: 10, tier: 'iron', sellValue: 0, blurb: 'Rusty ore from iron veins. Smelt two into a bar.' }),
  I({ id: 'quartz', name: 'Mofjell quartz', kind: 'gem', stack: 5, sellValue: 2, blurb: 'A rare find in stone veins.' }),
  I({ id: 'sapphire', name: 'Sapphire', kind: 'gem', stack: 5, sellValue: 8, blurb: 'A rare find in iron veins. Used in iron-tier recipes later.' }),
  I({ id: 'shaped_stone', name: 'Shaped stone', kind: 'material', stack: 10, tier: 'stone', sellValue: 0, blurb: 'Two stones knapped into a usable block.' }),
  I({ id: 'iron_bar', name: 'Iron bar', kind: 'bar', stack: 10, tier: 'iron', sellValue: 1, blurb: 'Smelted from two iron ore.' }),
  I({ id: 'stone_pickaxe', name: 'Stone pickaxe', kind: 'tool', stack: 1, tier: 'stone', slot: 'tool', toolPower: 1, swingSec: 2.6, sellValue: 2, buyPrice: 10, blurb: 'Mines stone and iron veins.' }),
  I({ id: 'iron_pickaxe', name: 'Iron pickaxe', kind: 'tool', stack: 1, tier: 'iron', slot: 'tool', toolPower: 2, swingSec: 1.9, sellValue: 6, blurb: 'Swings about a third faster than stone.' }),
  I({ id: 'stone_sword', name: 'Stone sword', kind: 'weapon', stack: 1, tier: 'stone', slot: 'mainHand', dps: 7, sellValue: 1, blurb: 'Tier 1 sword, 6–8 damage per second.' }),
  I({ id: 'iron_sword', name: 'Iron sword', kind: 'weapon', stack: 1, tier: 'iron', slot: 'mainHand', dps: 11, sellValue: 5, blurb: 'Tier 2 sword, 9–13 damage per second.' }),
  I({ id: 'stone_pauldrons', name: 'Stone pauldrons', kind: 'armour', stack: 1, tier: 'stone', slot: 'shoulders', armour: 1, sellValue: 1, blurb: 'Heavy slabs strapped to the shoulders.' }),
  I({ id: 'iron_pauldrons', name: 'Iron pauldrons', kind: 'armour', stack: 1, tier: 'iron', slot: 'shoulders', armour: 2, sellValue: 6, blurb: 'Riveted iron shoulder plates.' }),
  I({ id: 'small_rucksack', name: 'Small rucksack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 4, sellValue: 10, buyPrice: 40, blurb: '+4 bag slots.' }),
  I({ id: 'leather_backpack', name: 'Leather backpack', kind: 'bag', stack: 1, slot: 'back', bagSlots: 8, sellValue: 30, buyPrice: 120, blurb: '+8 bag slots.' }),
].map((d) => [d.id, d]));

export const BASE_BAG_SLOTS = 16;
export const START_GOLD = 15;

/** Order and labels for the character and inventory panels. */
export const EQUIP_SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'tool', label: 'Tool' },
  { slot: 'mainHand', label: 'Main hand' },
  { slot: 'offHand', label: 'Off hand' },
  { slot: 'head', label: 'Head' },
  { slot: 'shoulders', label: 'Shoulders' },
  { slot: 'chest', label: 'Body' },
  { slot: 'hands', label: 'Hands' },
  { slot: 'legs', label: 'Legs' },
  { slot: 'feet', label: 'Feet' },
  { slot: 'back', label: 'Back (bag)' },
  { slot: 'neck', label: 'Neck' },
  { slot: 'ring', label: 'Ring' },
];

/** Bars needed to smith one item, at every tier. Full armour = 48 bars. */
export const BARS_PER_ITEM: Record<string, number> = {
  dagger: 2, oneHand: 4, pickaxe: 4, hatchet: 4,
  helmet: 6, shoulders: 6, gloves: 6, boots: 6,
  twoHand: 8, chestplate: 12, legs: 12, kiteShield: 12,
  arrowheads15: 1,
};

// ------------------------------------------------------------------ bag logic (server-authoritative; shared for previews)

export interface Stack { id: string; qty: number }
export type Bag = (Stack | null)[];
export type Equipment = Partial<Record<Slot, string>>;

export function emptyBag(slots: number): Bag { return Array.from({ length: slots }, () => null); }

export function countItem(bag: Bag, id: string): number {
  return bag.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
}

/** How many of `id` would fit. */
export function roomFor(bag: Bag, id: string): number {
  const max = ITEMS[id]?.stack ?? 1;
  return bag.reduce((n, s) => n + (!s ? max : s.id === id ? max - s.qty : 0), 0);
}

/** Add up to qty; returns how many did NOT fit. Tops up existing stacks first. */
export function addItem(bag: Bag, id: string, qty: number): number {
  const max = ITEMS[id]?.stack ?? 1;
  for (const s of bag) {
    if (qty <= 0) break;
    if (s && s.id === id && s.qty < max) { const k = Math.min(qty, max - s.qty); s.qty += k; qty -= k; }
  }
  for (let i = 0; i < bag.length && qty > 0; i++) {
    if (!bag[i]) { const k = Math.min(qty, max); bag[i] = { id, qty: k }; qty -= k; }
  }
  return qty;
}

/** Remove qty of id (from the last stacks first); returns false and changes nothing if there isn't enough. */
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
  const worn = equip.back ? ITEMS[equip.back]?.bagSlots ?? 0 : 0;
  return BASE_BAG_SLOTS + bonusSlots + worn;
}

/** Resize a bag (e.g. after swapping rucksacks). Returns null if the items wouldn't fit. */
export function resizeBag(bag: Bag, slots: number): Bag | null {
  const items = bag.filter((s): s is Stack => !!s);
  if (items.length > slots) return null;
  return [...items, ...emptyBag(slots - items.length)];
}

/** Drop unknown items and bad quantities from stored data (e.g. after content changes). */
export function sanitiseBag(raw: unknown, slots: number): Bag {
  const bag = emptyBag(slots);
  if (!Array.isArray(raw)) return bag;
  for (const s of raw) {
    if (s && typeof s === 'object' && typeof s.id === 'string' && ITEMS[s.id] && Number.isInteger(s.qty) && s.qty > 0) addItem(bag, s.id, s.qty);
  }
  return bag;
}

export function sanitiseEquipment(raw: unknown): Equipment {
  const e: Equipment = {};
  if (!raw || typeof raw !== 'object') return e;
  for (const [slot, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && ITEMS[id]?.slot === slot) e[slot as Slot] = id;
  }
  return e;
}
