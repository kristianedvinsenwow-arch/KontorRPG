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
  { id: 'mats_stone', npc: 'mats', name: 'Stone for the walls', period: 'daily', text: 'Bjørkvik’s walls need patching. Bring me 10 stone — you’ll find it up in the mountains.', need: { item: 'stone', qty: 10 }, reward: { gold: 4, xp: ['mining', 80] } },
  { id: 'mats_iron', npc: 'mats', name: 'Iron for the smith', period: 'twice-weekly', text: 'Sigrid’s out of ore again. 10 iron ore, if you can.', need: { item: 'iron_ore', qty: 10 }, reward: { gold: 13, xp: ['mining', 300] } },
  { id: 'sigrid_shaped', npc: 'sigrid', name: 'Building blocks', period: 'daily', text: 'Shape me 10 blocks of stone for the forge wall.', need: { item: 'shaped_stone', qty: 10 }, reward: { gold: 5, xp: ['smithing', 100] } },
  { id: 'sigrid_bars', npc: 'sigrid', name: 'Bars, bars, bars', period: 'weekly', text: 'An order from the coast: 10 iron bars.', need: { item: 'iron_bar', qty: 10 }, reward: { gold: 25, xp: ['smithing', 700] } },
  { id: 'sigrid_silver', npc: 'sigrid', name: 'Silver from the deep', period: 'weekly', text: 'They say there’s silver in the Old Mine. Bring me 5 bars.', need: { item: 'silver_bar', qty: 5 }, reward: { gold: 35, xp: ['smithing', 900] } },
  { id: 'hilde_supper', npc: 'hilde', name: 'Supper for the guests', period: 'daily', text: 'Five cooked trout for tonight’s guests, please.', need: { item: 'cooked_trout', qty: 5 }, reward: { gold: 8, xp: ['cooking', 160] } },
  { id: 'frida_perch', npc: 'frida', name: 'Perch for the smokehouse', period: 'daily', text: 'Eight raw perch and I’ll pay you fair.', need: { item: 'raw_perch', qty: 8 }, reward: { gold: 5, xp: ['fishing', 120] } },
  { id: 'frida_golden', npc: 'frida', name: 'The golden one', period: 'weekly', text: 'Legend says a golden perch swims in this lake. Bring me one.', need: { item: 'golden_perch', qty: 1 }, reward: { gold: 32, xp: ['fishing', 600] } },
  { id: 'halvard_wolves', npc: 'halvard', name: 'Wolf trouble', period: 'twice-weekly', text: 'The pack east of the crossroads keeps taking sheep. Thin it out: 6 wolves.', need: { kill: 'wolf', qty: 6 }, reward: { gold: 15, xp: ['combat', 400] } },
  { id: 'halvard_goblins', npc: 'halvard', name: 'Goblin trinkets', period: 'daily', text: 'Bring me 5 goblin trinkets so I know you’ve been busy.', need: { item: 'goblin_trinket', qty: 5 }, reward: { gold: 10, xp: ['combat', 250] } },
  { id: 'halvard_knut', npc: 'halvard', name: 'Old Knut', period: 'weekly', text: 'A troll called Old Knut sits in the deepest hall of the Old Mine. Put him down.', need: { kill: 'troll', qty: 1 }, reward: { gold: 38, xp: ['combat', 1500] } },
  { id: 'halvard_pelts', npc: 'halvard', name: 'Pelts for winter', period: 'daily', text: 'Bring me 4 wolf pelts — skin them yourself, mind. A good knife helps.', need: { item: 'wolf_pelt', qty: 4 }, reward: { gold: 9, xp: ['leatherworking', 180] } },
  { id: 'hilde_linen', npc: 'hilde', name: 'Fresh sheets', period: 'daily', text: 'The guests have worn the sheets thin. Six bolts of linen, please.', need: { item: 'linen', qty: 6 }, reward: { gold: 8, xp: ['tailoring', 220] } },
  { id: 'hilde_steaks', npc: 'hilde', name: 'Steak night', period: 'twice-weekly', text: 'The guests are tired of fish. Six wolf steaks, please.', need: { item: 'cooked_wolf_meat', qty: 6 }, reward: { gold: 12, xp: ['cooking', 260] } },
  { id: 'sigrid_steel', npc: 'sigrid', name: 'Proper steel', period: 'weekly', text: 'Coal from Gruben and good iron: smelt me 8 steel bars.', need: { item: 'steel_bar', qty: 8 }, reward: { gold: 41, xp: ['smithing', 1400] } },
  { id: 'johan_coal', npc: 'johan', name: 'Keep the fire going', period: 'daily', text: 'The forge here eats coal. Bring me 12 and I’ll pay what I can.', need: { item: 'coal', qty: 12 }, reward: { gold: 10, xp: ['mining', 400] } },
  { id: 'johan_draugs', npc: 'johan', name: 'Rest, lads', period: 'twice-weekly', text: 'My old crew walks the row up the valley. Put 8 of them to rest.', need: { kill: 'draug', qty: 8 }, reward: { gold: 25, xp: ['combat', 1600] } },
  { id: 'johan_lynx', npc: 'johan', name: 'Lynx furs', period: 'daily', text: 'Nights are cold up here. Three lynx pelts, please.', need: { item: 'lynx_pelt', qty: 3 }, reward: { gold: 15, xp: ['leatherworking', 500] } },
  { id: 'johan_wisps', npc: 'johan', name: 'Lanterns in the bog', period: 'daily', text: 'Those lights lead folk into the bog. Bring me 4 wisp essences.', need: { item: 'wisp_essence', qty: 4 }, reward: { gold: 14, xp: ['combat', 700] } },
  { id: 'johan_king', npc: 'johan', name: 'The Mine King', period: 'weekly', text: 'The old foreman never left the pit. He’s the Mine King now. End it.', need: { kill: 'mine_king', qty: 1 }, reward: { gold: 78, xp: ['combat', 4000] } },
  { id: 'ragna_angelica', npc: 'ragna', name: 'Kvann for the pot', period: 'daily', text: 'Pick me 10 angelica from the meadows. Mind the wolves.', need: { item: 'angelica', qty: 10 }, reward: { gold: 7, xp: ['herbalism', 260] } },
  { id: 'ragna_draughts', npc: 'ragna', name: 'Draughts for the lodge', period: 'twice-weekly', text: 'Hilde wants healing draughts for her guests. Brew me 5.', need: { item: 'healing_draught', qty: 5 }, reward: { gold: 15, xp: ['alchemy', 500] } },
  { id: 'ragna_moss', npc: 'ragna', name: 'Moss from the dead', period: 'weekly', text: 'Grave moss grows where the draugs walk in Gruben. Bring me 6.', need: { item: 'grave_moss', qty: 6 }, reward: { gold: 28, xp: ['herbalism', 1500] } },
  { id: 'solvi_herring', npc: 'solvi', name: 'Herring for the barrels', period: 'daily', text: 'The salting barrels are empty. Ten raw herring, love.', need: { item: 'raw_herring', qty: 10 }, reward: { gold: 8, xp: ['fishing', 300] } },
  { id: 'solvi_cod', npc: 'solvi', name: 'Stockfish', period: 'twice-weekly', text: 'Cod for the drying racks — eight of them.', need: { item: 'raw_cod', qty: 8 }, reward: { gold: 16, xp: ['fishing', 700] } },
  { id: 'solvi_supper', npc: 'solvi', name: 'Halibut supper', period: 'weekly', text: 'The fishermen deserve a feast. Five cooked halibut.', need: { item: 'cooked_halibut', qty: 5 }, reward: { gold: 30, xp: ['cooking', 1400] } },
  { id: 'ulrik_scales', npc: 'ulrik', name: 'Shiny scales', period: 'daily', text: 'Naga scales fetch a good price in the city. Bring me eight.', need: { item: 'naga_scale', qty: 8 }, reward: { gold: 9, xp: ['combat', 400] } },
  { id: 'ulrik_nagas', npc: 'ulrik', name: 'Snakes on the shore', period: 'twice-weekly', text: 'The nagas have taken the west shore. Drive them back: six of them.', need: { kill: 'naga', qty: 6 }, reward: { gold: 14, xp: ['combat', 700] } },
  { id: 'ulrik_captain', npc: 'ulrik', name: 'The Drowned Captain', period: 'weekly', text: 'My old captain never left the wreck. Over the ford and down the west shore. Give him rest.', need: { kill: 'drowned_captain', qty: 1 }, reward: { gold: 32, xp: ['combat', 1800] } },
  { id: 'solvi_crabs', npc: 'solvi', name: 'Crab supper', period: 'daily', text: 'Six crab meat from the beach to the south, mind the claws.', need: { item: 'raw_crab', qty: 6 }, reward: { gold: 7, xp: ['cooking', 300] } },
  { id: 'tor_birch', npc: 'tor', name: 'Firewood', period: 'daily', text: 'Ten birch logs for the lodge’s fires.', need: { item: 'birch_log', qty: 10 }, reward: { gold: 5, xp: ['woodcutting', 120] } },
  { id: 'tor_pine', npc: 'tor', name: 'Roof beams', period: 'weekly', text: 'The lodge roof needs new beams: 10 pine logs.', need: { item: 'pine_log', qty: 10 }, reward: { gold: 20, xp: ['woodcutting', 600] } },
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
