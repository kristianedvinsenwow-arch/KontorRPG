/**
 * Stats: one flat bag of numbers that race, perks, gear (base stats + rolled effects), talents and
 * food buffs all add into. Server uses it for every rule; the client shows the same numbers.
 * Percentages are fractions (0.1 = +10%) unless the key says otherwise.
 */

export interface Stats {
  // movement and survival
  moveSpeed: number;      // fraction; capped at +30% (MAX_SPEED_BONUS) by movement rules
  maxHp: number;          // flat
  hpPct: number;          // fraction of max HP
  regen: number;          // HP per 10 s out of combat
  armour: number;         // physical armour points (gear)
  ward: number;           // magical armour points (gear)
  physRed: number;        // extra physical damage reduction (fraction)
  magicRed: number;       // extra magical damage reduction
  magicTaken: number;     // extra magic damage taken (metal armour), fraction
  dodge: number;          // chance to avoid a physical hit
  block: number;          // chance to block with a shield (halves the hit)
  thorns: number;         // flat damage back to melee attackers
  // offence
  meleeDmg: number;
  rangedDmg: number;
  magicDmg: number;
  allDmg: number;
  crit: number;           // crit chance fraction
  cdr: number;            // right-click cooldown reduction
  specialDmg: number;     // right-click damage
  burnDmg: number;        // fire burn ticks and Ignite
  frostPower: number;     // slow/freeze duration
  arrowSave: number;      // chance not to use an arrow
  // gathering
  miningSpeed: number;
  woodSpeed: number;
  fishSpeed: number;      // bite comes sooner
  luck: number;           // points: better crafting rarity, gems, double yields
  gemChance: number;      // relative bonus to gem rolls
  doubleYield: number;    // chance of a second ore/log/fish
  rareFish: number;       // relative bonus to rare catches
  fishEase: number;       // fishing minigame: bigger catch bar (fraction)
  burnChance: number;     // cooking: less burnt food (fraction subtracted)
  craftSpeed: number;     // smithing/carpentry/cooking speed
  nodeSave: number;       // chance a swing doesn't use up the vein/tree
  potionPower: number;    // alchemy: potions heal more and elixirs are stronger (for whoever drinks them)
  potionTime: number;     // alchemy: elixirs last longer
  // progression and economy
  xp: number;
  skillXp: number;        // extra XP for the skill the tool belongs to (applied per tool)
  sell: number;           // better vendor prices
  bagSlots: number;
}

export type StatKey = keyof Stats;

export function emptyStats(): Stats {
  return {
    moveSpeed: 0, maxHp: 0, hpPct: 0, regen: 0, armour: 0, ward: 0, physRed: 0, magicRed: 0, magicTaken: 0, dodge: 0, block: 0, thorns: 0,
    meleeDmg: 0, rangedDmg: 0, magicDmg: 0, allDmg: 0, crit: 0, cdr: 0, specialDmg: 0, burnDmg: 0, frostPower: 0, arrowSave: 0,
    miningSpeed: 0, woodSpeed: 0, fishSpeed: 0, luck: 0, gemChance: 0, doubleYield: 0, rareFish: 0, fishEase: 0, burnChance: 0, craftSpeed: 0, nodeSave: 0, potionPower: 0, potionTime: 0,
    xp: 0, skillXp: 0, sell: 0, bagSlots: 0,
  };
}

export function addStats(into: Stats, mods: Partial<Stats> | undefined, times = 1): Stats {
  if (!mods) return into;
  for (const [k, v] of Object.entries(mods)) into[k as StatKey] += (v as number) * times;
  return into;
}

/** Damage reduction from armour points: A / (A + 20), so 20 armour halves physical damage. */
export const reduction = (points: number) => (points <= 0 ? 0 : points / (points + 20));

/** How each stat reads in tooltips: [label, format]. */
export const STAT_LABEL: Record<StatKey, [string, 'pct' | 'flat' | 'pts']> = {
  moveSpeed: ['movement speed', 'pct'], maxHp: ['max HP', 'flat'], hpPct: ['max HP', 'pct'], regen: ['HP per 10 s', 'flat'],
  armour: ['armour', 'flat'], ward: ['ward (magic armour)', 'flat'], physRed: ['physical damage reduction', 'pct'],
  magicRed: ['magic damage reduction', 'pct'], magicTaken: ['magic damage taken', 'pct'], dodge: ['dodge chance', 'pct'],
  block: ['block chance', 'pct'], thorns: ['thorns damage', 'flat'],
  meleeDmg: ['melee damage', 'pct'], rangedDmg: ['ranged damage', 'pct'], magicDmg: ['magic damage', 'pct'], allDmg: ['all damage', 'pct'],
  crit: ['critical chance', 'pct'], cdr: ['right-click cooldown reduction', 'pct'], specialDmg: ['right-click damage', 'pct'],
  burnDmg: ['burn and Ignite damage', 'pct'], frostPower: ['frost slow/freeze duration', 'pct'], arrowSave: ['chance to save an arrow', 'pct'],
  miningSpeed: ['mining speed', 'pct'], woodSpeed: ['woodcutting speed', 'pct'], fishSpeed: ['bite speed', 'pct'],
  luck: ['luck', 'pts'], gemChance: ['gem find chance', 'pct'], doubleYield: ['double yield chance', 'pct'], rareFish: ['rare catch chance', 'pct'],
  fishEase: ['catch bar size', 'pct'], burnChance: ['less burnt food', 'pct'], craftSpeed: ['crafting speed', 'pct'], nodeSave: ['chance a hit doesn’t deplete', 'pct'],
  potionPower: ['potion strength', 'pct'], potionTime: ['elixir duration', 'pct'],
  xp: ['XP', 'pct'], skillXp: ['skill XP', 'pct'], sell: ['vendor prices', 'pct'], bagSlots: ['bag slots', 'flat'],
};

export function formatStat(k: StatKey, v: number): string {
  const [label, f] = STAT_LABEL[k];
  const sign = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  if (f === 'pct') return `${sign}${Math.round(a * 1000) / 10}% ${label}`;
  return `${sign}${Math.round(a * 10) / 10} ${label}`;
}
