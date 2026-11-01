/**
 * Achievements: counters the server keeps per character, and goals on them. Most goals give a
 * title you can show under your name. Counters are plain numbers by key, e.g. `fish`, `oreHits`,
 * `treeHits`, `kill:wolf`, `craft:smithing`.
 */
export type Counters = Record<string, number>;

export interface Achievement {
  id: string;
  name: string;
  text: string;
  /** Counter key and how many. */
  key: string; goal: number;
  /** Title it unlocks (shown under your name), if any. */
  title?: string;
  group: 'Gathering' | 'Crafting' | 'Combat' | 'Life';
}

const A: Achievement[] = [];
const add = (a: Achievement) => A.push(a);

// Gathering: the big three titles asked for (1000 fish, 2000 pickaxe hits, 2000 axe chops), with
// smaller steps on the way.
for (const [n, t] of [[100, 'Rock Knocker'], [500, 'Quarryhand'], [2000, 'Mountain Breaker']] as const)
  add({ id: `ore_${n}`, name: t, text: `Swing a pickaxe into ore ${n} times.`, key: 'oreHits', goal: n, title: t, group: 'Gathering' });
for (const [n, t] of [[100, 'Splinter'], [500, 'Logger'], [2000, 'Timberwolf']] as const)
  add({ id: `tree_${n}`, name: t, text: `Chop at trees ${n} times.`, key: 'treeHits', goal: n, title: t, group: 'Gathering' });
for (const [n, t] of [[50, 'Bait Thief'], [250, 'Angler'], [1000, 'Master of the Lake']] as const)
  add({ id: `fish_${n}`, name: t, text: `Land ${n} catches.`, key: 'fish', goal: n, title: t, group: 'Gathering' });
add({ id: 'golden', name: 'Golden Hook', text: 'Land a golden perch.', key: 'golden', goal: 1, title: 'Golden Hook', group: 'Gathering' });
add({ id: 'gems_10', name: 'Glitter Eye', text: 'Find 10 gems while mining.', key: 'gems', goal: 10, title: 'Glitter Eye', group: 'Gathering' });
add({ id: 'herbs_500', name: 'Herbalist', text: 'Pick 500 herbs.', key: 'herbs', goal: 500, title: 'the Herbalist', group: 'Gathering' });
add({ id: 'fibre_500', name: 'Flax Fingers', text: 'Pick flax, jute, ramie, cotton or bamboo 500 times.', key: 'fibre', goal: 500, title: 'Flax Fingers', group: 'Gathering' });
add({ id: 'pelts_100', name: 'Skinner', text: 'Skin 100 hides without ruining them.', key: 'pelts', goal: 100, title: 'Skinner', group: 'Gathering' });

// Crafting.
add({ id: 'smith_500', name: 'Anvil Heart', text: 'Make 500 things at the furnace and anvil.', key: 'craft:smithing', goal: 500, title: 'Anvil Heart', group: 'Crafting' });
add({ id: 'carp_300', name: 'Whittler', text: 'Make 300 things at a workbench.', key: 'craft:carpentry', goal: 300, title: 'Whittler', group: 'Crafting' });
add({ id: 'cook_300', name: 'Camp Cook', text: 'Cook 300 meals (burnt ones don’t count).', key: 'craft:cooking', goal: 300, title: 'Camp Cook', group: 'Crafting' });
add({ id: 'leather_200', name: 'Tanner', text: 'Make 200 things at a tanning rack.', key: 'craft:leatherworking', goal: 200, title: 'Tanner', group: 'Crafting' });
add({ id: 'tailor_200', name: 'Weaver', text: 'Make 200 things at a loom.', key: 'craft:tailoring', goal: 200, title: 'Weaver', group: 'Crafting' });
add({ id: 'alch_200', name: 'Brewmaster', text: 'Brew 200 potions.', key: 'craft:alchemy', goal: 200, title: 'Brewmaster', group: 'Crafting' });
add({ id: 'epic', name: 'Masterwork', text: 'Craft an epic item.', key: 'epicCraft', goal: 1, title: 'the Masterful', group: 'Crafting' });

// Combat.
add({ id: 'wolves_100', name: 'Wolfbane', text: 'Defeat 100 wolves.', key: 'kill:wolf', goal: 100, title: 'Wolfbane', group: 'Combat' });
add({ id: 'goblins_100', name: 'Goblin Bane', text: 'Defeat 100 goblins of any kind.', key: 'kill:goblins', goal: 100, title: 'Goblin Bane', group: 'Combat' });
add({ id: 'draugs_100', name: 'Grave Warden', text: 'Put 100 draugs to rest.', key: 'kill:draug', goal: 100, title: 'Grave Warden', group: 'Combat' });
add({ id: 'knut', name: 'Trollbane', text: 'Defeat Old Knut.', key: 'kill:troll', goal: 1, title: 'Trollbane', group: 'Combat' });
add({ id: 'knut_10', name: 'Knut’s Nightmare', text: 'Defeat Old Knut 10 times.', key: 'kill:troll', goal: 10, title: 'Knut’s Nightmare', group: 'Combat' });
add({ id: 'king', name: 'Kingslayer', text: 'Defeat the Mine King.', key: 'kill:mine_king', goal: 1, title: 'Kingslayer', group: 'Combat' });
add({ id: 'kills_1000', name: 'Veteran', text: 'Defeat 1000 monsters.', key: 'kills', goal: 1000, title: 'the Veteran', group: 'Combat' });

// Life in Bjørkvik.
add({ id: 'quests_50', name: 'Helping Hand', text: 'Finish 50 quests.', key: 'quests', goal: 50, title: 'Helping Hand', group: 'Life' });
add({ id: 'quests_250', name: 'Pillar of Bjørkvik', text: 'Finish 250 quests.', key: 'quests', goal: 250, title: 'Pillar of Bjørkvik', group: 'Life' });
add({ id: 'potions_100', name: 'Iron Stomach', text: 'Drink 100 potions.', key: 'drunk', goal: 100, group: 'Life' });
add({ id: 'fjord', name: 'Salt Air', text: 'Take the coast road to Saltfjorden.', key: 'fjord', goal: 1, group: 'Life' });
add({ id: 'deeps', name: 'Deep Water', text: 'Fish up a weapon or a beast from Saltfjorden’s deeps.', key: 'deeps', goal: 1, title: 'of the Deep', group: 'Gathering' });
add({ id: 'captain', name: 'Shipbreaker', text: 'Put the Drowned Captain to rest.', key: 'kill:drowned_captain', goal: 1, title: 'Shipbreaker', group: 'Combat' });
add({ id: 'gruben', name: 'Over the Pass', text: 'Walk through the pass to Gruben.', key: 'gruben', goal: 1, group: 'Life' });
add({ id: 'ride', name: 'Rider', text: 'Mount up for the first time.', key: 'rides', goal: 1, group: 'Life' });
add({ id: 'home', name: 'Homebody', text: 'Rent a cottage or a miners’ hut.', key: 'house', goal: 1, title: 'Homebody', group: 'Life' });
add({ id: 'deaths_10', name: 'Bruised', text: 'Get knocked out 10 times.', key: 'deaths', goal: 10, title: 'the Bruised', group: 'Life' });

export const ACHIEVEMENTS: Achievement[] = A;
export const ACHIEVEMENT_BY_ID: Map<string, Achievement> = new Map(A.map((a) => [a.id, a]));
/** Titles anyone can pick once they've earned the achievement. */
export const titleOf = (id: string | null | undefined) => (id ? ACHIEVEMENT_BY_ID.get(id)?.title : undefined);

/** Stored per character. */
export interface AchievementState { c: Counters; done: string[]; title: string | null }

export function sanitiseAchievements(raw: any): AchievementState {
  const c: Counters = {};
  if (raw?.c && typeof raw.c === 'object') for (const [k, v] of Object.entries(raw.c)) if (typeof v === 'number' && Number.isFinite(v) && v > 0 && k.length < 40) c[k] = Math.floor(v);
  const done = Array.isArray(raw?.done) ? raw.done.filter((id: unknown) => typeof id === 'string' && ACHIEVEMENT_BY_ID.has(id)) : [];
  const title = typeof raw?.title === 'string' && done.includes(raw.title) && titleOf(raw.title) ? raw.title : null;
  return { c, done, title };
}
