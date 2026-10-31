/**
 * Talent trees. Each skill level above 1 gives one point in that skill's tree; each player level
 * above 1 gives one point shared by the four combat trees.
 *
 * Shape: every tree starts with a 3-rank root. A node unlocks once ANY of its parents is fully
 * ranked. 3-rank nodes are steady bonuses; 1-rank nodes ("notables") are bigger single bonuses.
 * Gathering and crafting talents only apply to their own skill.
 */
import type { SkillId } from './skills.js';
import { levelFromXp, type SkillXp } from './skills.js';
import type { Stats } from './stats.js';

export type TreeId = 'mining' | 'woodcutting' | 'fishing' | 'smithing' | 'carpentry' | 'leatherworking' | 'tailoring' | 'herbalism' | 'alchemy' | 'cooking' | 'melee' | 'ranged' | 'magic' | 'defence';

export interface TalentNode {
  id: string;
  name: string;
  ranks: 1 | 3;
  /** Grid position for the UI: column −2..2, row 0..4. */
  x: number;
  y: number;
  /** Unlocks when any of these is fully ranked. Empty = the root. */
  req: string[];
  /** Bonus per rank. */
  fx: Partial<Stats>;
}

export interface TalentTree { id: TreeId; name: string; skill: SkillId; nodes: TalentNode[] }

const n = (id: string, name: string, ranks: 1 | 3, x: number, y: number, req: string[], fx: Partial<Stats>): TalentNode => ({ id, name, ranks, x, y, req, fx });

export const TREES: TalentTree[] = [
  { id: 'mining', name: 'Mining', skill: 'mining', nodes: [
    n('prospector', 'Prospector', 3, 0, 0, [], { miningSpeed: 0.03 }),
    n('steady_swing', 'Steady Swing', 3, -1, 1, ['prospector'], { miningSpeed: 0.03 }),
    n('keen_eye', 'Keen Eye', 3, 1, 1, ['prospector'], { gemChance: 0.1 }),
    n('ore_hauler', 'Ore Hauler', 3, -2, 2, ['steady_swing'], { doubleYield: 0.03 }),
    n('rhythm', 'Rhythm', 1, -0.7, 2, ['steady_swing'], { miningSpeed: 0.08 }),
    n('gemcutter', "Gemcutter's Eye", 1, 0.7, 2, ['keen_eye'], { gemChance: 0.3 }),
    n('fortune', 'Fortune', 3, 2, 2, ['keen_eye'], { luck: 1 }),
    n('deep_veins', 'Deep Veins', 3, -2, 3, ['ore_hauler'], { skillXp: 0.04 }),
    n('second_wind', 'Second Wind', 1, -1, 3, ['ore_hauler', 'rhythm'], { nodeSave: 0.1 }),
    n('momentum', 'Momentum', 3, 0, 3, ['rhythm', 'gemcutter'], { miningSpeed: 0.03 }),
    n('jeweller', 'Jeweller', 3, 1, 3, ['gemcutter'], { gemChance: 0.15 }),
    n('serendipity', 'Serendipity', 3, 2, 3, ['fortune'], { luck: 2 }),
    n('mountains_favour', "Mountain's Favour", 1, -1, 4, ['deep_veins', 'momentum'], { miningSpeed: 0.1, doubleYield: 0.05 }),
    n('motherlode', 'Motherlode', 1, 1, 4, ['jeweller', 'serendipity'], { luck: 5, gemChance: 0.5 }),
  ] },
  { id: 'woodcutting', name: 'Woodcutting', skill: 'woodcutting', nodes: [
    n('lumberjack', 'Lumberjack', 3, 0, 0, [], { woodSpeed: 0.03 }),
    n('sharp_edge', 'Sharp Edge', 3, -1, 1, ['lumberjack'], { woodSpeed: 0.03 }),
    n('forester', 'Forester', 3, 1, 1, ['lumberjack'], { doubleYield: 0.03 }),
    n('clean_cut', 'Clean Cut', 1, -2, 2, ['sharp_edge'], { woodSpeed: 0.08 }),
    n('timber', 'Timber!', 3, -0.7, 2, ['sharp_edge'], { skillXp: 0.04 }),
    n('woodsense', 'Woodsense', 1, 0.7, 2, ['forester'], { luck: 4 }),
    n('stack_em', "Stack 'em", 3, 2, 2, ['forester'], { doubleYield: 0.03 }),
    n('heartwood', 'Heartwood', 3, -1.5, 3, ['clean_cut', 'timber'], { woodSpeed: 0.03 }),
    n('old_growth', 'Old Growth', 1, 0, 3, ['timber', 'woodsense'], { nodeSave: 0.12 }),
    n('bundles', 'Bundles', 3, 1.5, 3, ['stack_em'], { doubleYield: 0.03 }),
    n('feller', 'The Feller', 1, -1, 4, ['heartwood', 'old_growth'], { woodSpeed: 0.12 }),
    n('green_thumb', 'Green Thumb', 1, 1, 4, ['old_growth', 'bundles'], { luck: 6, doubleYield: 0.05 }),
  ] },
  { id: 'fishing', name: 'Fishing', skill: 'fishing', nodes: [
    n('patience', 'Patience', 3, 0, 0, [], { fishSpeed: 0.03 }),
    n('light_touch', 'Light Touch', 3, -1, 1, ['patience'], { fishEase: 0.04 }),
    n('lure_maker', 'Lure Maker', 3, 1, 1, ['patience'], { rareFish: 0.08 }),
    n('steady_line', 'Steady Line', 1, -2, 2, ['light_touch'], { fishEase: 0.12 }),
    n('quick_bite', 'Quick Bite', 3, -0.7, 2, ['light_touch'], { fishSpeed: 0.04 }),
    n('golden_hook', 'Golden Hook', 1, 0.7, 2, ['lure_maker'], { rareFish: 0.25 }),
    n('double_hook', 'Double Hook', 3, 2, 2, ['lure_maker'], { doubleYield: 0.03 }),
    n('angler', 'Angler', 3, -1.5, 3, ['steady_line', 'quick_bite'], { skillXp: 0.04 }),
    n('lake_lore', 'Lake Lore', 1, 0, 3, ['quick_bite', 'golden_hook'], { luck: 5 }),
    n('net_caster', 'Net Caster', 3, 1.5, 3, ['double_hook'], { doubleYield: 0.03 }),
    n('master_angler', 'Master Angler', 1, -1, 4, ['angler', 'lake_lore'], { fishEase: 0.15, fishSpeed: 0.1 }),
    n('trophy_hunter', 'Trophy Hunter', 1, 1, 4, ['lake_lore', 'net_caster'], { rareFish: 0.4 }),
  ] },
  { id: 'smithing', name: 'Smithing', skill: 'smithing', nodes: [
    n('apprentice', 'Apprentice', 3, 0, 0, [], { craftSpeed: 0.04 }),
    n('steady_hammer', 'Steady Hammer', 3, -1, 1, ['apprentice'], { craftSpeed: 0.04 }),
    n('masterwork', 'Masterwork', 3, 1, 1, ['apprentice'], { luck: 2 }),
    n('forgemaster', 'Forgemaster', 1, -1, 2, ['steady_hammer'], { craftSpeed: 0.12 }),
    n('artisan', 'Artisan', 1, 1, 2, ['masterwork'], { luck: 6 }),
  ] },
  { id: 'carpentry', name: 'Carpentry', skill: 'carpentry', nodes: [
    n('whittler', 'Whittler', 3, 0, 0, [], { craftSpeed: 0.04 }),
    n('fine_grain', 'Fine Grain', 3, 1, 1, ['whittler'], { luck: 2 }),
    n('quick_hands', 'Quick Hands', 3, -1, 1, ['whittler'], { craftSpeed: 0.04 }),
    n('bowyer', 'Bowyer', 1, 1, 2, ['fine_grain'], { luck: 6 }),
  ] },
  { id: 'leatherworking', name: 'Leatherworking', skill: 'leatherworking', nodes: [
    n('tanner', 'Tanner', 3, 0, 0, [], { craftSpeed: 0.04 }),
    n('supple', 'Supple Hides', 3, 1, 1, ['tanner'], { luck: 2 }),
    n('quick_stitch', 'Quick Stitch', 3, -1, 1, ['tanner'], { craftSpeed: 0.04 }),
    n('master_tanner', 'Master Tanner', 1, 1, 2, ['supple'], { luck: 6 }),
  ] },
  { id: 'tailoring', name: 'Tailoring', skill: 'tailoring', nodes: [
    n('nimble_fingers', 'Nimble Fingers', 3, 0, 0, [], { craftSpeed: 0.04 }),
    n('green_thumb', 'Green Thumb', 3, -1, 1, ['nimble_fingers'], { doubleYield: 0.05 }),
    n('fine_weave', 'Fine Weave', 3, 1, 1, ['nimble_fingers'], { luck: 2 }),
    n('master_weaver', 'Master Weaver', 1, 0, 2, ['green_thumb', 'fine_weave'], { luck: 6, craftSpeed: 0.1 }),
  ] },
  { id: 'herbalism', name: 'Herbalism', skill: 'herbalism', nodes: [
    n('forager', 'Forager', 3, 0, 0, [], { doubleYield: 0.04 }),
    n('herb_lore', 'Herb Lore', 3, -1, 1, ['forager'], { skillXp: 0.04 }),
    n('keen_eye', 'Keen Eye', 3, 1, 1, ['forager'], { doubleYield: 0.04 }),
    n('wise_woman', 'Wise Woman', 1, 0, 2, ['herb_lore', 'keen_eye'], { doubleYield: 0.1, luck: 4 }),
  ] },
  { id: 'alchemy', name: 'Alchemy', skill: 'alchemy', nodes: [
    n('steady_hand', 'Steady Hand', 3, 0, 0, [], { craftSpeed: 0.04 }),
    n('potent_brews', 'Potent Brews', 3, -1, 1, ['steady_hand'], { potionPower: 0.05 }),
    n('long_brews', 'Long Brews', 3, 1, 1, ['steady_hand'], { potionTime: 0.1 }),
    n('master_alchemist', 'Master Alchemist', 1, 0, 2, ['potent_brews', 'long_brews'], { potionPower: 0.15, potionTime: 0.2 }),
  ] },
  { id: 'cooking', name: 'Cooking', skill: 'cooking', nodes: [
    n('kitchen_hand', 'Kitchen Hand', 3, 0, 0, [], { burnChance: 0.03 }),
    n('slow_roast', 'Slow Roast', 3, -1, 1, ['kitchen_hand'], { burnChance: 0.03 }),
    n('busy_cook', 'Busy Cook', 3, 1, 1, ['kitchen_hand'], { craftSpeed: 0.05 }),
    n('chef', 'Chef', 1, 0, 2, ['slow_roast', 'busy_cook'], { burnChance: 0.1, craftSpeed: 0.1 }),
  ] },
  // combat: one shared pool of points from player level
  { id: 'melee', name: 'Melee', skill: 'combat', nodes: [
    n('brawler', 'Brawler', 3, 0, 0, [], { meleeDmg: 0.03 }),
    n('weapon_master', 'Weapon Master', 3, -1, 1, ['brawler'], { meleeDmg: 0.03 }),
    n('heavy_blows', 'Heavy Blows', 3, 1, 1, ['brawler'], { specialDmg: 0.06 }),
    n('bloodlust', 'Bloodlust', 1, -1, 2, ['weapon_master'], { crit: 0.05 }),
    n('battle_rhythm', 'Battle Rhythm', 1, 1, 2, ['heavy_blows'], { cdr: 0.12 }),
    n('warlord', 'Warlord', 1, 0, 3, ['bloodlust', 'battle_rhythm'], { meleeDmg: 0.1, specialDmg: 0.1 }),
  ] },
  { id: 'ranged', name: 'Ranged', skill: 'combat', nodes: [
    n('marksman', 'Marksman', 3, 0, 0, [], { rangedDmg: 0.03 }),
    n('eagle_eye', 'Eagle Eye', 3, -1, 1, ['marksman'], { crit: 0.015 }),
    n('quiver', 'Deep Quiver', 3, 1, 1, ['marksman'], { arrowSave: 0.06 }),
    n('power_draw', 'Power Draw', 1, -1, 2, ['eagle_eye'], { specialDmg: 0.15 }),
    n('light_feet', 'Light Feet', 1, 1, 2, ['quiver'], { moveSpeed: 0.04, dodge: 0.03 }),
    n('deadeye', 'Deadeye', 1, 0, 3, ['power_draw', 'light_feet'], { rangedDmg: 0.1, crit: 0.03 }),
  ] },
  { id: 'magic', name: 'Magic', skill: 'combat', nodes: [
    n('adept', 'Adept', 3, 0, 0, [], { magicDmg: 0.03 }),
    n('pyromancer', 'Pyromancer', 3, -1, 1, ['adept'], { burnDmg: 0.08 }),
    n('cryomancer', 'Cryomancer', 3, 1, 1, ['adept'], { frostPower: 0.1 }),
    n('wildfire', 'Wildfire', 1, -1, 2, ['pyromancer'], { burnDmg: 0.2 }),
    n('permafrost', 'Permafrost', 1, 1, 2, ['cryomancer'], { frostPower: 0.25 }),
    n('archmage', 'Archmage', 1, 0, 3, ['wildfire', 'permafrost'], { magicDmg: 0.1, cdr: 0.1 }),
  ] },
  { id: 'defence', name: 'Defence', skill: 'combat', nodes: [
    n('toughness', 'Toughness', 3, 0, 0, [], { maxHp: 3 }),
    n('iron_skin', 'Iron Skin', 3, -1, 1, ['toughness'], { armour: 1 }),
    n('spell_ward', 'Spell Ward', 3, 1, 1, ['toughness'], { ward: 1 }),
    n('shield_wall', 'Shield Wall', 1, -1, 2, ['iron_skin'], { block: 0.08 }),
    n('second_breath', 'Second Breath', 1, 1, 2, ['spell_ward'], { regen: 3 }),
    n('bulwark', 'Bulwark', 1, 0, 3, ['shield_wall', 'second_breath'], { physRed: 0.05, magicRed: 0.05, thorns: 2 }),
  ] },
];

export const TALENT_TREE: Record<TreeId, TalentTree> = Object.fromEntries(TREES.map((t) => [t.id, t])) as Record<TreeId, TalentTree>;
export const COMBAT_TREES: TreeId[] = ['melee', 'ranged', 'magic', 'defence'];

/** Ranks spent: tree → node → ranks. */
export type TalentAlloc = Partial<Record<TreeId, Record<string, number>>>;

export const spentIn = (a: TalentAlloc, t: TreeId) => Object.values(a[t] ?? {}).reduce((s, v) => s + v, 0);

/** Unspent points for a tree (combat trees share one pool). */
export function pointsLeft(a: TalentAlloc, xp: SkillXp, t: TreeId): number {
  const tree = TALENT_TREE[t];
  const total = levelFromXp(xp[tree.skill] ?? 0) - 1;
  const spent = tree.skill === 'combat' ? COMBAT_TREES.reduce((s, c) => s + spentIn(a, c), 0) : spentIn(a, t);
  return total - spent;
}

/** null if the node can take another rank, else why not. */
export function canLearn(a: TalentAlloc, xp: SkillXp, t: TreeId, nodeId: string): string | null {
  const tree = TALENT_TREE[t];
  const node = tree?.nodes.find((x) => x.id === nodeId);
  if (!node) return 'No such talent.';
  const have = a[t]?.[nodeId] ?? 0;
  if (have >= node.ranks) return 'Already maxed.';
  if (node.req.length && !node.req.some((r) => (a[t]?.[r] ?? 0) >= (tree.nodes.find((x) => x.id === r)?.ranks ?? 99))) return 'Max out a connected talent first.';
  if (pointsLeft(a, xp, t) <= 0) return 'No points left — level up.';
  return null;
}

/** Talent bonuses per tree (so gathering ones can be scoped to their skill). */
export function talentStats(a: TalentAlloc, t: TreeId): Partial<Stats> {
  const out: Partial<Stats> = {};
  for (const node of TALENT_TREE[t].nodes) {
    const r = a[t]?.[node.id] ?? 0;
    if (!r) continue;
    for (const [k, v] of Object.entries(node.fx)) out[k as keyof Stats] = (out[k as keyof Stats] ?? 0) + (v as number) * r;
  }
  return out;
}

/** Drop anything invalid from stored data (talents removed in a content update, over-spending). */
export function sanitiseTalents(raw: unknown, xp: SkillXp): TalentAlloc {
  const out: TalentAlloc = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const tree of TREES) {
    const r = (raw as any)[tree.id];
    if (!r || typeof r !== 'object') continue;
    // Re-learn in tree order so requirements and point limits are respected.
    for (let pass = 0; pass < 5; pass++) for (const node of tree.nodes) {
      const want = Math.min(node.ranks, Math.max(0, Math.floor(Number(r[node.id]) || 0)));
      while ((out[tree.id]?.[node.id] ?? 0) < want && !canLearn(out, xp, tree.id, node.id)) {
        (out[tree.id] ??= {})[node.id] = (out[tree.id]![node.id] ?? 0) + 1;
      }
    }
  }
  return out;
}

/** Gold to reset a tree: 10, then doubling each time (design doc: respec cost doubles). */
export const respecCost = (respecs: number) => 10 * 2 ** Math.min(respecs, 10);
