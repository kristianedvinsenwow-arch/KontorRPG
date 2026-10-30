/** Equipment slots and crafting costs (design doc §6). */

export type Slot =
  | 'head' | 'shoulders' | 'chest' | 'legs' | 'hands' | 'feet'
  | 'mainHand' | 'offHand' | 'ring' | 'neck' | 'tool' | 'rod' | 'ammo';

/** Order and labels for the character panel. */
export const EQUIP_SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'head', label: 'Head' },
  { slot: 'shoulders', label: 'Shoulders' },
  { slot: 'chest', label: 'Body' },
  { slot: 'hands', label: 'Hands' },
  { slot: 'legs', label: 'Legs' },
  { slot: 'feet', label: 'Feet' },
  { slot: 'mainHand', label: 'Main hand' },
  { slot: 'offHand', label: 'Off hand' },
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
