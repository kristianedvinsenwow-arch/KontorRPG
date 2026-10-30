/** Skill levels (design doc §4): XP to the next level = 10 × L², cap 60. */

export type SkillId = 'mining' | 'smithing' | 'fishing' | 'cooking' | 'woodcutting' | 'fletching' | 'melee' | 'ranged' | 'magic' | 'defence';

export const SKILLS: { id: SkillId; name: string; live: boolean; blurb: string }[] = [
  { id: 'mining', name: 'Mining', live: true, blurb: 'Mine stone and iron veins. Higher levels swing faster and open new veins.' },
  { id: 'smithing', name: 'Smithing', live: true, blurb: 'Shape stone, smelt bars at the furnace and smith gear at the anvil.' },
  { id: 'fishing', name: 'Fishing', live: false, blurb: 'Coming soon: fish anywhere, frenzies and the docks.' },
  { id: 'cooking', name: 'Cooking', live: false, blurb: 'Coming soon: food buffs.' },
  { id: 'woodcutting', name: 'Woodcutting', live: false, blurb: 'Coming soon.' },
  { id: 'melee', name: 'Melee', live: false, blurb: 'Coming soon: combat.' },
  { id: 'defence', name: 'Defence', live: false, blurb: 'Coming soon: combat.' },
];

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
