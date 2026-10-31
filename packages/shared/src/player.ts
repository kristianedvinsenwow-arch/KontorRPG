/**
 * Everything that adds up to a character's numbers: attributes, race, perks, worn gear, talents,
 * player level and food buffs. Gathering tools and gathering/crafting talents only count for their
 * own skill ("scoped"), so a lucky pickaxe doesn't make you better at fishing.
 */
import { RACES, PERKS, type CharacterBuild } from './character.js';
import { ITEMS, itemStats, bagCapacity, type Equipment, type Slot } from './items.js';
import { addStats, emptyStats, type Stats } from './stats.js';
import { levelFromXp, type SkillId, type SkillXp } from './skills.js';
import { COMBAT_TREES, talentStats, type TalentAlloc, type TreeId } from './talents.js';
import { maxSpeed } from './movement.js';

export type GatherSkill = 'mining' | 'woodcutting' | 'fishing' | 'smithing' | 'carpentry' | 'leatherworking' | 'tailoring' | 'cooking';
export const TOOL_SKILL: Partial<Record<Slot, GatherSkill>> = { pickaxe: 'mining', hatchet: 'woodcutting', rod: 'fishing' };

export interface Buff { name: string; stats: Partial<Stats>; until: number }

export interface PlayerStats {
  all: Stats;
  scoped: Record<GatherSkill, Stats>;
  maxHp: number;
  /** For movement validation (capped by maxSpeed). */
  speedCap: number;
  bagSlots: number;
  combatLevel: number;
}

/** Old perk modifiers mapped onto stats. */
function perkStats(id: string): Partial<Stats> {
  const m = PERKS[id]?.mods ?? {};
  return {
    hpPct: m.hpPct ?? 0, maxHp: m.hpFlat ?? 0, bagSlots: m.bagSlots ?? 0, moveSpeed: m.speedPct ?? 0, xp: m.xpPct ?? 0,
    allDmg: m.dmgPct ?? 0, meleeDmg: m.meleePct ?? 0, magicDmg: m.spellPct ?? 0, miningSpeed: m.miningSpeedPct ?? 0,
    rareFish: m.rareCatchPct ?? 0, fishSpeed: m.biteSpeedPct ?? 0, sell: m.sellPct ?? 0, luck: (m.masterworkPct ?? 0) * 100,
  };
}

export function computeStats(build: CharacterBuild, equip: Equipment, talents: TalentAlloc, xp: SkillXp, buffs: Buff[] = [], now = Date.now()): PlayerStats {
  const all = emptyStats();
  const plus = PERKS[build.major]?.mods.allAttrs ?? 0;
  const a = { str: build.attrs.str + plus, dex: build.attrs.dex + plus, int: build.attrs.int + plus, sta: build.attrs.sta + plus };
  // Attributes (design doc §3).
  addStats(all, { meleeDmg: 0.02 * (a.str - 5), rangedDmg: 0.02 * (a.dex - 5), magicDmg: 0.02 * (a.int - 5), crit: 0.05 + 0.005 * (a.dex - 5), miningSpeed: 0.01 * (a.dex - 5), fishSpeed: 0.01 * (a.dex - 5), luck: Math.max(0, a.int - 5) });
  addStats(all, { bagSlots: (a.str >= 8 ? 1 : 0) + (a.str >= 10 ? 1 : 0) });
  addStats(all, RACES[build.race]?.bonus);
  addStats(all, perkStats(build.major));
  addStats(all, perkStats(build.minor));
  if (PERKS[build.major]?.mods.critMult) all.crit *= PERKS[build.major].mods.critMult!;
  for (const t of COMBAT_TREES) addStats(all, talentStats(talents, t));
  for (const b of buffs) if (b.until > now) addStats(all, b.stats);
  const scopedExtra: Record<GatherSkill, Stats> = { mining: emptyStats(), woodcutting: emptyStats(), fishing: emptyStats(), smithing: emptyStats(), carpentry: emptyStats(), leatherworking: emptyStats(), tailoring: emptyStats(), cooking: emptyStats() };
  for (const [slot, st] of Object.entries(equip) as [Slot, NonNullable<Equipment[Slot]>][]) {
    if (!st || !ITEMS[st.id]) continue;
    const skill = TOOL_SKILL[slot];
    addStats(skill ? scopedExtra[skill] : all, itemStats(st));
  }
  for (const s of Object.keys(scopedExtra) as GatherSkill[]) addStats(scopedExtra[s], talentStats(talents, s as TreeId));
  const scoped = Object.fromEntries(Object.entries(scopedExtra).map(([k, v]) => [k, addStats(addStats(emptyStats(), all), v)])) as Record<GatherSkill, Stats>;
  const combatLevel = levelFromXp(xp.combat ?? 0);
  const maxHp = Math.max(5, Math.round((10 + 3 * a.sta + 3 * (combatLevel - 1) + all.maxHp) * (1 + all.hpPct)));
  return {
    all, scoped, maxHp, combatLevel,
    speedCap: maxSpeed(1, all.moveSpeed),
    bagSlots: bagCapacity(Math.round(all.bagSlots), equip),
  };
}

/** XP multiplier for a skill: perks, gear XP and, for gathering, the tool's skill XP. */
export function xpMult(ps: PlayerStats, skill: SkillId): number {
  const scoped = (ps.scoped as Record<string, Stats>)[skill];
  return 1 + ps.all.xp + (scoped ? scoped.skillXp : 0);
}
