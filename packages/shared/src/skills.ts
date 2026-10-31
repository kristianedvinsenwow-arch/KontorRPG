/**
 * Skills (design doc §4): XP to the next level = 10 × L², cap 60. Every level above 1 gives one
 * talent point in that skill's tree. Combat has no skill of its own: kills give player-level XP, and
 * each player level gives a talent point to spend in the melee, ranged, magic or defence trees.
 */

export type SkillId = 'mining' | 'smithing' | 'woodcutting' | 'carpentry' | 'leatherworking' | 'tailoring' | 'fishing' | 'cooking' | 'combat';

export const SKILLS: { id: SkillId; name: string; live: boolean; blurb: string }[] = [
  { id: 'combat', name: 'Player level', live: true, blurb: 'From fighting. Each level gives a talent point for melee, ranged, magic or defence, and +3 max HP.' },
  { id: 'mining', name: 'Mining', live: true, blurb: 'Stone, iron and (in the cave) silver. Higher levels swing faster.' },
  { id: 'smithing', name: 'Smithing', live: true, blurb: 'Furnace and anvil: bars, weapons, metal armour, arrowheads.' },
  { id: 'woodcutting', name: 'Woodcutting', live: true, blurb: 'Fell birch and pine with a hatchet.' },
  { id: 'carpentry', name: 'Carpentry', live: true, blurb: 'Workbench: bows, staffs, rods, arrow shafts and arrows.' },
  { id: 'leatherworking', name: 'Leatherworking', live: true, blurb: 'Tanning rack: tan pelts and goblin skins, make leather armour. Skin wolves and goblins with a skinning knife.' },
  { id: 'tailoring', name: 'Tailoring', live: true, blurb: 'Pick flax and bog cotton, spin and weave at a loom, and make cloth armour (strong against magic).' },
  { id: 'fishing', name: 'Fishing', live: true, blurb: 'Cast at the lake, then keep the fish in the bar.' },
  { id: 'cooking', name: 'Cooking', live: true, blurb: 'Campfires and the inn stove. Food heals and gives buffs.' },
];

export const COMING_SKILLS = ['Herbalism', 'Alchemy', 'Hunting', 'Enchanting'];

export const MAX_LEVEL = 60;

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) total += 10 * l * l;
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1, total = 0;
  while (level < MAX_LEVEL) {
    const need = 10 * level * level;
    if (total + need > xp) break;
    total += need;
    level++;
  }
  return level;
}

/** Progress inside the current level, 0..1. */
export function levelProgress(xp: number): number {
  const l = levelFromXp(xp);
  if (l >= MAX_LEVEL) return 1;
  const a = xpForLevel(l), b = xpForLevel(l + 1);
  return (xp - a) / (b - a);
}

export type SkillXp = Partial<Record<SkillId, number>>;
export const levelOf = (xp: SkillXp, s: SkillId) => levelFromXp(xp[s] ?? 0);
