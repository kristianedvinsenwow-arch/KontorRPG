/**
 * Character creation rules: races, attributes, perks and the stats derived from them.
 * Shared so the creator UI, the character panel and the server all compute the same numbers,
 * and the server can reject a hand-edited character.
 */

export type Race = 'human' | 'dwarf' | 'gnome';
export type AttrKey = 'str' | 'dex' | 'int' | 'sta';
export type Attrs = Record<AttrKey, number>;

/**
 * Body shape per race. Cosmetic only (same stats). `legs` shortens thighs and shins, `width` makes
 * the body stockier, `head` enlarges the head, `scale` sizes the whole figure. `eye` is the
 * first-person camera height in metres; `height` is the approximate standing height.
 */
export interface RaceDef { name: string; blurb: string; scale: number; legs: number; width: number; head: number; eye: number; height: number }
export const RACES: Record<Race, RaceDef> = {
  human: { name: 'Human', blurb: 'The standard adventurer. About 1.85 m.', scale: 1, legs: 1, width: 1, head: 1, eye: 1.62, height: 1.85 },
  dwarf: { name: 'Dwarf', blurb: 'Thick, broad and bearded on short legs. About 1.3 m.', scale: 0.88, legs: 0.55, width: 1.38, head: 1.1, eye: 1.16, height: 1.3 },
  gnome: { name: 'Gnome', blurb: 'Even smaller: tiny legs and a big head. About 0.95 m.', scale: 0.66, legs: 0.48, width: 1.05, head: 1.22, eye: 0.84, height: 0.95 },
};

export const ATTRS: { key: AttrKey; short: string; name: string; desc: string }[] = [
  { key: 'str', short: 'STR', name: 'Strength', desc: 'Melee damage and carry weight. Governs Mining, Smithing, Woodcutting.' },
  { key: 'dex', short: 'DEX', name: 'Dexterity', desc: 'Ranged damage, critical hits, gathering speed. Governs Fishing, Fletching.' },
  { key: 'int', short: 'INT', name: 'Intellect', desc: 'Spell damage, mana, rare crafting procs. Governs Cooking, Alchemy.' },
  { key: 'sta', short: 'STA', name: 'Stamina', desc: 'Health and ability stamina. Governs Defence, Herbalism.' },
];

/** Every attribute starts at 5; points can be moved between attributes, keeping the total at 20. */
export const ATTR_START = 5;
export const ATTR_MIN = 1;
export const ATTR_MAX = 10;
export const ATTR_TOTAL = ATTR_START * 4;

/** Modifiers a perk applies. Percentages are fractions: 0.1 = +10%. */
export interface Mods {
  allAttrs?: number;
  hpPct?: number;
  hpFlat?: number;
  carryPct?: number;
  speedPct?: number;
  xpPct?: number;
  dmgPct?: number;
  meleePct?: number;
  spellPct?: number;
  critMult?: number;
  miningSpeedPct?: number;
  oreYieldPct?: number;
  rareCatchPct?: number;
  biteSpeedPct?: number;
  foodDurationPct?: number;
  potionPct?: number;
  masterworkPct?: number;
  restedPct?: number;
  sellPct?: number;
  scalesPct?: number;
}

export interface Perk {
  id: string;
  name: string;
  kind: 'major' | 'minor';
  plus: string;
  minus: string;
  mods: Mods;
}

export const MAJOR_PERKS: Perk[] = [
  { id: 'hardrock', name: 'Hardrock', kind: 'major', plus: '+20% mining speed', minus: '−10% spell damage', mods: { miningSpeedPct: 0.2, spellPct: -0.1 } },
  { id: 'pack_mule', name: 'Pack Mule', kind: 'major', plus: '+30% carry weight', minus: '−10% move speed', mods: { carryPct: 0.3, speedPct: -0.1 } },
  { id: 'small_frame', name: 'Small Frame', kind: 'major', plus: '+10% move speed', minus: '−20% carry weight', mods: { speedPct: 0.1, carryPct: -0.2 } },
  { id: 'glass_cannon', name: 'Glass Cannon', kind: 'major', plus: '+20% all damage', minus: '−20% max HP', mods: { dmgPct: 0.2, hpPct: -0.2 } },
  { id: 'heavy_handed', name: 'Heavy Handed', kind: 'major', plus: '+15% melee damage', minus: 'Half the critical-hit chance', mods: { meleePct: 0.15, critMult: 0.5 } },
  { id: 'bookworm', name: 'Bookworm', kind: 'major', plus: '+10% XP in every skill', minus: '−10% max HP', mods: { xpPct: 0.1, hpPct: -0.1 } },
  { id: 'gifted', name: 'Gifted', kind: 'major', plus: '+1 to every attribute', minus: '−10% XP in every skill', mods: { allAttrs: 1, xpPct: -0.1 } },
  { id: 'anglers_luck', name: "Angler's Luck", kind: 'major', plus: '+25% rare-catch chance', minus: '−10% ore yield', mods: { rareCatchPct: 0.25, oreYieldPct: -0.1 } },
  { id: 'iron_stomach', name: 'Iron Stomach', kind: 'major', plus: 'Food buffs last 50% longer', minus: 'Potions 25% weaker', mods: { foodDurationPct: 0.5, potionPct: -0.25 } },
  { id: 'lone_wolf', name: 'Lone Wolf', kind: 'major', plus: '+10% damage when not in a party', minus: 'No shared party XP', mods: {} },
];

export const MINOR_PERKS: Perk[] = [
  { id: 'morning_person', name: 'Morning Person', kind: 'minor', plus: '+10% XP 07:00–16:00', minus: '−5% XP 16:00–20:00', mods: {} },
  { id: 'overtime', name: 'Overtime', kind: 'minor', plus: '+10% XP 16:00–01:00', minus: '−5% XP 08:00–12:00', mods: {} },
  { id: 'coffee_addict', name: 'Coffee Addict', kind: 'minor', plus: '+10% speed for 10 min after a drink', minus: '−3% all stats without a drink buff', mods: {} },
  { id: 'thick_skin', name: 'Thick Skin', kind: 'minor', plus: '+5 max HP', minus: '−3% move speed', mods: { hpFlat: 5, speedPct: -0.03 } },
  { id: 'steady_hands', name: 'Steady Hands', kind: 'minor', plus: '+5% masterwork chance when smithing', minus: '−5% smithing speed', mods: { masterworkPct: 0.05 } },
  { id: 'early_bite', name: 'Early Bite', kind: 'minor', plus: '+10% bite speed', minus: '−5% fishing XP', mods: { biteSpeedPct: 0.1 } },
  { id: 'haggler', name: 'Haggler', kind: 'minor', plus: '+5% gold from vendors', minus: '−5% Scales from the fishmonger', mods: { sellPct: 0.05, scalesPct: -0.05 } },
  { id: 'light_sleeper', name: 'Light Sleeper', kind: 'minor', plus: '+25% rested XP', minus: 'Rested bonus builds 25% slower', mods: { restedPct: 0.25 } },
];

/**
 * XP time windows for the clock perks, in server time (Europe/Oslo). [from, to) hours; a window may
 * wrap past midnight (16 → 1 means 16:00–01:00). Used by the XP system from M1.
 */
export const XP_WINDOWS: Record<string, { bonus: [number, number]; malus: [number, number] }> = {
  morning_person: { bonus: [7, 16], malus: [16, 20] },
  overtime: { bonus: [16, 1], malus: [8, 12] },
};

/** XP multiplier from clock perks at a given server hour (0–23.99). */
export function clockXpMult(perkId: string, hour: number): number {
  const w = XP_WINDOWS[perkId];
  if (!w) return 1;
  const inside = ([a, b]: [number, number]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b);
  if (inside(w.bonus)) return 1.1;
  if (inside(w.malus)) return 0.95;
  return 1;
}

export const PERKS: Record<string, Perk> = Object.fromEntries([...MAJOR_PERKS, ...MINOR_PERKS].map((p) => [p.id, p]));

export interface CharacterBuild {
  race: Race;
  attrs: Attrs;
  major: string;
  minor: string;
}

export function defaultBuild(): CharacterBuild {
  return { race: 'human', attrs: { str: 5, dex: 5, int: 5, sta: 5 }, major: MAJOR_PERKS[0].id, minor: MINOR_PERKS[0].id };
}

/** Points freed by lowering attributes and not yet spent elsewhere. */
export function freePoints(a: Attrs): number {
  return ATTR_TOTAL - (a.str + a.dex + a.int + a.sta);
}

/** Returns null if the build is legal, otherwise a short reason. */
export function validateBuild(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'missing';
  const c = b as CharacterBuild;
  if (!(c.race in RACES)) return 'race';
  if (!c.attrs || typeof c.attrs !== 'object') return 'attrs';
  for (const { key } of ATTRS) {
    const v = c.attrs[key];
    if (!Number.isInteger(v) || v < ATTR_MIN || v > ATTR_MAX) return `attr_${key}`;
  }
  if (freePoints(c.attrs) !== 0) return 'attr_total';
  if (!MAJOR_PERKS.some((p) => p.id === c.major)) return 'major';
  if (!MINOR_PERKS.some((p) => p.id === c.minor)) return 'minor';
  return null;
}

export interface Derived {
  attrs: Attrs; // after perks such as Gifted
  maxHp: number;
  carryKg: number;
  speedBonus: number; // fraction, e.g. -0.1
  meleePct: number; // percent bonus vs. a 5-STR character
  rangedPct: number;
  spellPct: number;
  critPct: number;
  mana: number;
  gatherPct: number;
  xpPct: number;
}

/** Stats derived from a build (design doc §3, small number scale from §5). */
export function derive(b: CharacterBuild): Derived {
  const m: Mods = { ...PERKS[b.major]?.mods };
  for (const [k, v] of Object.entries(PERKS[b.minor]?.mods ?? {})) {
    const key = k as keyof Mods;
    m[key] = key === 'critMult' ? (m[key] ?? 1) * (v as number) : (m[key] ?? 0) + (v as number);
  }
  const plus = m.allAttrs ?? 0;
  const a: Attrs = { str: b.attrs.str + plus, dex: b.attrs.dex + plus, int: b.attrs.int + plus, sta: b.attrs.sta + plus };
  const dmg = m.dmgPct ?? 0;
  const pct = (x: number) => Math.round(x * 100);
  return {
    attrs: a,
    maxHp: Math.round((10 + 3 * a.sta) * (1 + (m.hpPct ?? 0))) + (m.hpFlat ?? 0),
    carryKg: Math.round((20 + 4 * a.str) * (1 + (m.carryPct ?? 0))),
    speedBonus: m.speedPct ?? 0,
    meleePct: pct(0.02 * (a.str - 5) + dmg + (m.meleePct ?? 0)),
    rangedPct: pct(0.02 * (a.dex - 5) + dmg),
    spellPct: pct(0.02 * (a.int - 5) + dmg + (m.spellPct ?? 0)),
    critPct: Math.round((5 + 0.5 * (a.dex - 5)) * (m.critMult ?? 1) * 10) / 10,
    mana: 10 + 5 * a.int,
    gatherPct: a.dex - 5,
    xpPct: pct(m.xpPct ?? 0),
  };
}
