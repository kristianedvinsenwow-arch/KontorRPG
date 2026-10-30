/**
 * Repeatable quests from NPCs. Daily quests reset at midnight, twice-weekly ones on Monday and
 * Thursday, weekly ones on Monday — all in server time (Europe/Oslo).
 */
import type { SkillId } from './skills.js';
import type { MobKind } from './mobs.js';

export type Period = 'daily' | 'twice-weekly' | 'weekly';

export interface QuestDef {
  id: string;
  npc: string;
  name: string;
  text: string;
  period: Period;
  need: { item: string; qty: number } | { kill: MobKind; qty: number };
  reward: { gold: number; xp: [SkillId, number] };
}

export const QUESTS: QuestDef[] = [
  { id: 'mats_stone', npc: 'mats', name: 'Stone for the walls', period: 'daily', text: 'The camp walls need patching. Bring me 10 stone.', need: { item: 'stone', qty: 10 }, reward: { gold: 8, xp: ['mining', 80] } },
  { id: 'mats_iron', npc: 'mats', name: 'Iron for the smith', period: 'twice-weekly', text: 'Sigrid’s out of ore again. 10 iron ore, if you can.', need: { item: 'iron_ore', qty: 10 }, reward: { gold: 25, xp: ['mining', 300] } },
  { id: 'sigrid_shaped', npc: 'sigrid', name: 'Building blocks', period: 'daily', text: 'Shape me 10 blocks of stone for the forge wall.', need: { item: 'shaped_stone', qty: 10 }, reward: { gold: 10, xp: ['smithing', 100] } },
  { id: 'sigrid_bars', npc: 'sigrid', name: 'Bars, bars, bars', period: 'weekly', text: 'An order from the coast: 10 iron bars.', need: { item: 'iron_bar', qty: 10 }, reward: { gold: 60, xp: ['smithing', 700] } },
  { id: 'sigrid_silver', npc: 'sigrid', name: 'Silver from the deep', period: 'weekly', text: 'They say there’s silver in the Old Mine. Bring me 5 bars.', need: { item: 'silver_bar', qty: 5 }, reward: { gold: 90, xp: ['smithing', 900] } },
  { id: 'hilde_supper', npc: 'hilde', name: 'Supper for the guests', period: 'daily', text: 'Five cooked trout for tonight’s guests, please.', need: { item: 'cooked_trout', qty: 5 }, reward: { gold: 15, xp: ['cooking', 160] } },
  { id: 'frida_perch', npc: 'frida', name: 'Perch for the smokehouse', period: 'daily', text: 'Eight raw perch and I’ll pay you fair.', need: { item: 'raw_perch', qty: 8 }, reward: { gold: 10, xp: ['fishing', 120] } },
  { id: 'frida_golden', npc: 'frida', name: 'The golden one', period: 'weekly', text: 'Legend says a golden perch swims in this lake. Bring me one.', need: { item: 'golden_perch', qty: 1 }, reward: { gold: 80, xp: ['fishing', 600] } },
  { id: 'halvard_wolves', npc: 'halvard', name: 'Wolf trouble', period: 'twice-weekly', text: 'The pack east of camp keeps taking sheep. Thin it out: 6 wolves.', need: { kill: 'wolf', qty: 6 }, reward: { gold: 30, xp: ['combat', 400] } },
  { id: 'halvard_goblins', npc: 'halvard', name: 'Goblin trinkets', period: 'daily', text: 'Bring me 5 goblin trinkets so I know you’ve been busy.', need: { item: 'goblin_trinket', qty: 5 }, reward: { gold: 20, xp: ['combat', 250] } },
  { id: 'halvard_knut', npc: 'halvard', name: 'Old Knut', period: 'weekly', text: 'A troll called Old Knut sits in the deepest hall of the Old Mine. Put him down.', need: { kill: 'troll', qty: 1 }, reward: { gold: 100, xp: ['combat', 1500] } },
  { id: 'halvard_pelts', npc: 'halvard', name: 'Pelts for winter', period: 'daily', text: 'Bring me 4 wolf pelts — skin them yourself, mind. A good knife helps.', need: { item: 'wolf_pelt', qty: 4 }, reward: { gold: 18, xp: ['leatherworking', 180] } },
  { id: 'hilde_steaks', npc: 'hilde', name: 'Steak night', period: 'twice-weekly', text: 'The guests are tired of fish. Six wolf steaks, please.', need: { item: 'cooked_wolf_meat', qty: 6 }, reward: { gold: 24, xp: ['cooking', 260] } },
  { id: 'tor_birch', npc: 'tor', name: 'Firewood', period: 'daily', text: 'Ten birch logs for the lodge’s fires.', need: { item: 'birch_log', qty: 10 }, reward: { gold: 10, xp: ['woodcutting', 120] } },
  { id: 'tor_pine', npc: 'tor', name: 'Roof beams', period: 'weekly', text: 'The lodge roof needs new beams: 10 pine logs.', need: { item: 'pine_log', qty: 10 }, reward: { gold: 45, xp: ['woodcutting', 600] } },
];
export const QUEST_BY_ID: Map<string, QuestDef> = new Map(QUESTS.map((q) => [q.id, q]));

/** Oslo calendar parts for a moment. */
export function osloParts(ms: number): { y: number; m: number; d: number; dow: number; hour: number } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday); // 0 = Monday
  return { y: +p.year, m: +p.month, d: +p.day, dow, hour: +p.hour };
}

/** Identifies the current reset window; a quest done in this window can't be done again. */
export function periodKey(period: Period, ms: number): string {
  const { y, m, d, dow } = osloParts(ms);
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (period === 'daily') return day;
  // Monday of this week (calendar maths on UTC dates is fine for a key).
  const monday = new Date(Date.UTC(y, m - 1, d - dow));
  const wk = monday.toISOString().slice(0, 10);
  if (period === 'weekly') return wk;
  return `${wk}${dow >= 3 ? 'b' : 'a'}`; // Mon–Wed, Thu–Sun
}

/** Per-character quest state. `done` = period key it was last completed in. */
export type QuestState = Record<string, { active?: boolean; progress?: number; done?: string }>;

export const questAvailable = (q: QuestDef, st: QuestState, now: number) => st[q.id]?.done !== periodKey(q.period, now);
