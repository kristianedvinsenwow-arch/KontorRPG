/**
 * Monsters and where they live. The server runs their AI; clients draw them from snapshots.
 * Small-number scale (design doc §5): a level-1 player hits for ~11 with a stone sword.
 */
import { caveRoomCentre, grottoRoomCentre, CAVE, GROTTO } from './cave.js';
import { heightAt, GRUBEN, GRUBEN_SPOTS, FJORD, SHIPWRECK } from './terrain.js';

export type MobKind = 'wolf' | 'goblin' | 'bat' | 'cave_goblin' | 'cave_shaman' | 'troll' | 'lynx' | 'draug' | 'wisp' | 'hill_troll' | 'mine_king' | 'naga' | 'naga_siren' | 'giant_crab' | 'drowned' | 'drowned_captain' | 'grotto_crab' | 'deep_naga' | 'tide_wraith' | 'kraken';

export type Drop =
  | { item: string; chance: number; qty: [number, number] }
  /** Random gear of a tier (rolled rarity; `legendary` = chance it's legendary instead). */
  | { gear: 1 | 2 | 3 | 4; chance: number; legendary?: number };

export interface MobDef {
  kind: MobKind;
  name: string;
  level: number;
  hp: number;
  dmg: number;
  interval: number;
  range: number;
  speed: number;
  aggro: number;
  armour: number;
  ward: number;
  magic?: boolean;
  xp: number;
  gold: [number, number];
  drops: Drop[];
  respawnSec: [number, number];
  boss?: boolean;
  /** Can be skinned (with a skinning knife) for this, during the 30 s the body stays. */
  skin?: { item: string; qty: [number, number] };
  /** Boss slam: every n seconds, hit everyone within r metres for mult × damage. */
  slam?: { every: number; r: number; mult: number };
  /** Below this share of HP it enrages: attacks 30% faster and 20% harder. */
  enrage?: number;
  /** Below this share of HP it calls helpers (summoned spawns, `summonedBy` this mob), who go for the healer. */
  adds?: number;
  scale: number;
  flying?: boolean;
  /** Never moves from its spawn (the Kraken in its pool). */
  rooted?: boolean;
  /** Boss: every n seconds, tentacles burst up under up to `count` fighters (a ring warns first). */
  erupt?: { every: number; r: number; mult: number; count: number };
  /** Boss: on enraging, a cloud of ink blinds everyone close for a few seconds. */
  ink?: boolean;
}

export const MOBS: Record<MobKind, MobDef> = {
  wolf: { kind: 'wolf', name: 'Grey wolf', level: 2, hp: 36, dmg: 2, interval: 2, range: 1.8, speed: 4.2, aggro: 7, armour: 2, ward: 2, xp: 25, gold: [0, 0],
    drops: [{ item: 'raw_wolf_meat', chance: 0.7, qty: [1, 1] }], skin: { item: 'wolf_pelt', qty: [1, 2] }, respawnSec: [60, 120], scale: 1 },
  goblin: { kind: 'goblin', name: 'Goblin scout', level: 4, hp: 52, dmg: 3, interval: 1.8, range: 1.8, speed: 3.8, aggro: 10, armour: 4, ward: 2, xp: 40, gold: [0, 2],
    drops: [{ item: 'goblin_trinket', chance: 0.4, qty: [1, 1] }, { item: 'stone_arrowheads', chance: 0.2, qty: [5, 10] }, { gear: 1, chance: 0.06 }], skin: { item: 'goblin_skin', qty: [1, 1] }, respawnSec: [90, 150], scale: 1 },
  bat: { kind: 'bat', name: 'Cave bat', level: 5, hp: 28, dmg: 2.2, interval: 1.2, range: 1.6, speed: 5.5, aggro: 12, armour: 1, ward: 3, xp: 30, gold: [0, 0],
    drops: [{ item: 'bat_wing', chance: 0.5, qty: [1, 2] }], respawnSec: [60, 120], scale: 1, flying: true },
  cave_goblin: { kind: 'cave_goblin', name: 'Cave goblin', level: 7, hp: 75, dmg: 4.5, interval: 1.8, range: 1.9, speed: 3.8, aggro: 10, armour: 8, ward: 3, xp: 70, gold: [1, 3],
    drops: [{ item: 'goblin_trinket', chance: 0.5, qty: [1, 2] }, { item: 'iron_arrowheads', chance: 0.15, qty: [5, 10] }, { gear: 1, chance: 0.06 }, { gear: 2, chance: 0.03 }, { item: 'spear_plans', chance: 0.012, qty: [1, 1] }], skin: { item: 'goblin_skin', qty: [1, 2] }, respawnSec: [120, 200], scale: 1.1 },
  cave_shaman: { kind: 'cave_shaman', name: 'Goblin shaman', level: 8, hp: 60, dmg: 5, interval: 2.2, range: 14, speed: 3.4, aggro: 14, armour: 3, ward: 8, magic: true, xp: 85, gold: [1, 4],
    drops: [{ item: 'quartz', chance: 0.1, qty: [1, 1] }, { gear: 2, chance: 0.05 }, { item: 'spear_plans', chance: 0.02, qty: [1, 1] }], respawnSec: [150, 240], scale: 1 },
  troll: { kind: 'troll', name: 'Old Knut', level: 12, hp: 500, dmg: 17, interval: 2.6, range: 3.6, speed: 3.2, aggro: 16, armour: 15, ward: 5, xp: 800, gold: [15, 30],
    drops: [{ item: 'troll_tooth', chance: 1, qty: [1, 2] }, { gear: 2, chance: 0.6, legendary: 0.04 }, { item: 'trolltooth_necklace', chance: 0.03, qty: [1, 1] }, { item: 'knuts_bellyplate', chance: 0.04, qty: [1, 1] }, { item: 'trollshaman_helm', chance: 0.05, qty: [1, 1] }, { item: 'warhammer_plans', chance: 0.2, qty: [1, 1] }, { item: 'jotunbane', chance: 0.015, qty: [1, 1] }, { item: 'garnet', chance: 0.25, qty: [1, 1] }],
    respawnSec: [90 * 60, 150 * 60], boss: true, slam: { every: 11, r: 5, mult: 1.8 }, enrage: 0.25, scale: 2.3 },
  // Saltfjorden (levels 8–14)
  naga: { kind: 'naga', name: 'Naga warrior', level: 10, hp: 92, dmg: 5.5, interval: 1.9, range: 2.2, speed: 3.8, aggro: 11, armour: 8, ward: 5, xp: 95, gold: [1, 3],
    drops: [{ item: 'naga_scale', chance: 0.5, qty: [1, 2] }, { gear: 2, chance: 0.05 }, { item: 'sea_glass', chance: 0.05, qty: [1, 1] }], skin: { item: 'naga_hide', qty: [1, 2] }, respawnSec: [100, 170], scale: 0.88 },
  naga_siren: { kind: 'naga_siren', name: 'Naga siren', level: 12, hp: 70, dmg: 6.5, interval: 2.3, range: 14, speed: 3.4, aggro: 14, armour: 4, ward: 10, magic: true, xp: 120, gold: [2, 4],
    drops: [{ item: 'naga_scale', chance: 0.6, qty: [1, 3] }, { item: 'pearl', chance: 0.04, qty: [1, 1] }, { gear: 2, chance: 0.05 }], skin: { item: 'naga_hide', qty: [1, 1] }, respawnSec: [140, 220], scale: 0.85 },
  giant_crab: { kind: 'giant_crab', name: 'Giant crab', level: 9, hp: 105, dmg: 5.5, interval: 2.4, range: 2, speed: 2.6, aggro: 7, armour: 14, ward: 3, xp: 85, gold: [0, 0],
    drops: [{ item: 'raw_crab', chance: 0.8, qty: [1, 2] }, { item: 'crab_shell', chance: 0.5, qty: [1, 2] }, { item: 'coral', chance: 0.1, qty: [1, 1] }], respawnSec: [90, 150], scale: 1 },
  drowned: { kind: 'drowned', name: 'Drowned sailor', level: 12, hp: 110, dmg: 6.5, interval: 2, range: 2, speed: 3.3, aggro: 10, armour: 10, ward: 4, xp: 120, gold: [2, 5],
    drops: [{ item: 'grave_dust', chance: 0.3, qty: [1, 2] }, { item: 'pearl', chance: 0.03, qty: [1, 1] }, { gear: 2, chance: 0.06 }, { item: 'halberd_plans', chance: 0.006, qty: [1, 1] }], respawnSec: [150, 240], scale: 1 },
  drowned_captain: { kind: 'drowned_captain', name: 'The Drowned Captain', level: 15, hp: 650, dmg: 11, interval: 2.4, range: 2.8, speed: 3.3, aggro: 16, armour: 14, ward: 8, xp: 1000, gold: [20, 40],
    drops: [{ item: 'pearl', chance: 0.6, qty: [1, 2] }, { gear: 2, chance: 0.5, legendary: 0.03 }, { gear: 3, chance: 0.2 }, { item: 'captains_cutlass', chance: 0.05, qty: [1, 1] }, { item: 'captains_hat', chance: 0.06, qty: [1, 1] }, { item: 'chaplains_breastplate', chance: 0.05, qty: [1, 1] }, { item: 'spear_plans', chance: 0.12, qty: [1, 1] }],
    respawnSec: [60 * 60, 100 * 60], boss: true, slam: { every: 11, r: 4.5, mult: 1.7 }, enrage: 0.25, adds: 0.5, scale: 1.25 },
  // Sjøgrotta, the Sea Grotto (levels 14–18)
  grotto_crab: { kind: 'grotto_crab', name: 'Grotto crab', level: 14, hp: 150, dmg: 8, interval: 2.3, range: 2.1, speed: 2.8, aggro: 8, armour: 20, ward: 5, xp: 150, gold: [0, 0],
    drops: [{ item: 'raw_crab', chance: 0.8, qty: [1, 3] }, { item: 'crab_shell', chance: 0.6, qty: [1, 3] }, { item: 'sea_glass', chance: 0.12, qty: [1, 1] }, { item: 'coral', chance: 0.15, qty: [1, 2] }], respawnSec: [100, 160], scale: 1.2 },
  deep_naga: { kind: 'deep_naga', name: 'Deep naga', level: 16, hp: 165, dmg: 9.5, interval: 1.9, range: 2.3, speed: 3.9, aggro: 12, armour: 13, ward: 9, xp: 200, gold: [2, 6],
    drops: [{ item: 'naga_scale', chance: 0.6, qty: [1, 3] }, { item: 'sea_glass', chance: 0.1, qty: [1, 1] }, { gear: 3, chance: 0.06 }, { item: 'pearl', chance: 0.03, qty: [1, 1] }], skin: { item: 'naga_hide', qty: [2, 3] }, respawnSec: [120, 200], scale: 0.95 },
  tide_wraith: { kind: 'tide_wraith', name: 'Tide wraith', level: 17, hp: 120, dmg: 10, interval: 2.3, range: 14, speed: 3.6, aggro: 15, armour: 4, ward: 16, magic: true, xp: 210, gold: [1, 4],
    drops: [{ item: 'grave_dust', chance: 0.5, qty: [1, 3] }, { item: 'wisp_essence', chance: 0.2, qty: [1, 1] }, { gear: 3, chance: 0.06 }], respawnSec: [140, 220], scale: 1 },
  kraken: { kind: 'kraken', name: 'The Kraken', level: 18, hp: 1800, dmg: 15, interval: 2.2, range: 6.5, speed: 0, aggro: 18, armour: 18, ward: 14, xp: 2600, gold: [40, 80],
    drops: [{ item: 'pearl', chance: 1, qty: [2, 4] }, { gear: 3, chance: 0.7, legendary: 0.05 }, { gear: 4, chance: 0.2 }, { item: 'krakens_eye', chance: 0.08, qty: [1, 1] }, { item: 'kraken_ink', chance: 1, qty: [2, 4] }],
    respawnSec: [90 * 60, 150 * 60], boss: true, rooted: true, slam: { every: 13, r: 7.5, mult: 1.6 }, erupt: { every: 7, r: 2.6, mult: 1.5, count: 3 }, ink: true, enrage: 0.3, adds: 0.6, scale: 3.4 },
  // Gruben (levels 13–22)
  lynx: { kind: 'lynx', name: 'Lynx', level: 13, hp: 95, dmg: 6.5, interval: 1.5, range: 1.8, speed: 5, aggro: 9, armour: 8, ward: 6, xp: 130, gold: [0, 0],
    drops: [{ item: 'raw_wolf_meat', chance: 0.4, qty: [1, 2] }], skin: { item: 'lynx_pelt', qty: [1, 2] }, respawnSec: [90, 160], scale: 0.9 },
  draug: { kind: 'draug', name: 'Draug miner', level: 15, hp: 130, dmg: 8.5, interval: 2, range: 2, speed: 3.4, aggro: 11, armour: 16, ward: 6, xp: 180, gold: [2, 5],
    drops: [{ item: 'grave_dust', chance: 0.6, qty: [1, 3] }, { item: 'coal', chance: 0.3, qty: [1, 3] }, { gear: 2, chance: 0.06 }, { gear: 3, chance: 0.04 }, { item: 'barrow_helm', chance: 0.012, qty: [1, 1] }, { item: 'halberd_plans', chance: 0.01, qty: [1, 1] }], respawnSec: [120, 200], scale: 1.05 },
  wisp: { kind: 'wisp', name: 'Lyktemann', level: 14, hp: 75, dmg: 8, interval: 2.4, range: 15, speed: 3.8, aggro: 15, armour: 2, ward: 14, magic: true, xp: 150, gold: [0, 0],
    drops: [{ item: 'wisp_essence', chance: 0.5, qty: [1, 1] }, { item: 'sapphire', chance: 0.05, qty: [1, 1] }, { item: 'wisplit_greaves', chance: 0.008, qty: [1, 1] }], respawnSec: [120, 200], scale: 1, flying: true },
  hill_troll: { kind: 'hill_troll', name: 'Scree troll', level: 18, hp: 320, dmg: 12.5, interval: 2.8, range: 3, speed: 3, aggro: 10, armour: 20, ward: 6, xp: 420, gold: [4, 9],
    drops: [{ item: 'silver_ore', chance: 0.5, qty: [2, 4] }, { item: 'coal', chance: 0.5, qty: [2, 5] }, { item: 'garnet', chance: 0.1, qty: [1, 1] }, { gear: 3, chance: 0.12 }, { item: 'trolliron_greaves', chance: 0.03, qty: [1, 1] }, { item: 'halberd_plans', chance: 0.05, qty: [1, 1] }],
    respawnSec: [240, 360], slam: { every: 12, r: 4, mult: 1.6 }, scale: 1.7 },
  mine_king: { kind: 'mine_king', name: 'The Mine King', level: 22, hp: 1200, dmg: 19, interval: 2.4, range: 3.4, speed: 3.4, aggro: 18, armour: 26, ward: 14, xp: 2500, gold: [40, 80],
    drops: [{ item: 'kings_crown', chance: 1, qty: [1, 1] }, { gear: 3, chance: 0.6, legendary: 0.05 }, { gear: 4, chance: 0.25, legendary: 0.05 }, { item: 'mine_kings_ring', chance: 0.04, qty: [1, 1] }, { item: 'mine_kings_pauldrons', chance: 0.08, qty: [1, 1] }, { item: 'mine_kings_runegauntlets', chance: 0.06, qty: [1, 1] }, { item: 'jotunbane', chance: 0.04, qty: [1, 1] }, { item: 'dovre_stallion', chance: 0.02, qty: [1, 1] }, { item: 'garnet', chance: 0.4, qty: [1, 2] }],
    respawnSec: [120 * 60, 180 * 60], boss: true, slam: { every: 10, r: 5.5, mult: 2 }, enrage: 0.25, adds: 0.5, scale: 1.6 },
};

export interface Spawn { id: string; kind: MobKind; x: number; z: number; leash: number; /** Only appears when this boss calls for help. */ summonedBy?: string }

export const MOB_AREAS = [
  { name: 'Wolf pack', x: 74, z: 36, kind: 'wolf' as MobKind, n: 4, r: 10 },
  { name: 'Northern wolves', x: -6, z: 96, kind: 'wolf' as MobKind, n: 3, r: 9 },
  { name: 'Goblin camp', x: -62, z: -60, kind: 'goblin' as MobKind, n: 5, r: 10 },
  // Saltfjorden
  { name: 'Naga camp', x: FJORD.x - 52, z: FJORD.z - 30, kind: 'naga' as MobKind, n: 5, r: 10 },
  { name: 'Sirens’ rocks', x: FJORD.x - 50, z: FJORD.z - 44, kind: 'naga_siren' as MobKind, n: 2, r: 6 },
  { name: 'Crab beach', x: FJORD.x + 38, z: FJORD.z + 60, kind: 'giant_crab' as MobKind, n: 4, r: 8 },
  { name: 'West crab beach', x: FJORD.x - 34, z: FJORD.z + 60, kind: 'giant_crab' as MobKind, n: 3, r: 7 },
  { name: 'Ulvedalen pack', x: -86, z: -8, kind: 'wolf' as MobKind, n: 4, r: 9 },
  // Gruben
  { name: 'Lynx slopes', x: GRUBEN.x - 46, z: GRUBEN.z + 30, kind: 'lynx' as MobKind, n: 4, r: 12 },
  { name: 'Lynx hollow', x: GRUBEN.x - 34, z: GRUBEN.z - 14, kind: 'lynx' as MobKind, n: 3, r: 10 },
  { name: 'Dead miners’ row', x: GRUBEN.x + GRUBEN_SPOTS.village.x, z: GRUBEN.z + GRUBEN_SPOTS.village.z, kind: 'draug' as MobKind, n: 5, r: 11 },
  { name: 'Lantern bog', x: GRUBEN.x - 42, z: GRUBEN.z - 46, kind: 'wisp' as MobKind, n: 4, r: 10 },
  { name: 'Troll scree', x: GRUBEN.x + 50, z: GRUBEN.z - 44, kind: 'hill_troll' as MobKind, n: 2, r: 8 },
];

function spawns(): Spawn[] {
  const out: Spawn[] = [];
  for (const a of MOB_AREAS) {
    for (let i = 0; i < a.n; i++) {
      const ang = (i / a.n) * Math.PI * 2 + 0.7, d = a.r * (0.35 + 0.5 * ((i * 37) % 10) / 10);
      const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
      if (heightAt(x, z) < 0.5) continue;
      out.push({ id: `${a.kind}-${a.name.length}-${i}`, kind: a.kind, x, z, leash: a.r + 16 });
    }
  }
  const gal = caveRoomCentre(1), roost = caveRoomCentre(2), hall = caveRoomCentre(3);
  out.push({ id: 'bat-0', kind: 'bat', x: CAVE.x, z: CAVE.z - 14, leash: 14 });
  out.push({ id: 'bat-1', kind: 'bat', x: roost.x - 2, z: roost.z, leash: 12 });
  out.push({ id: 'bat-2', kind: 'bat', x: roost.x + 2, z: roost.z + 2, leash: 12 });
  out.push({ id: 'cgob-0', kind: 'cave_goblin', x: gal.x - 3, z: gal.z, leash: 14 });
  out.push({ id: 'cgob-1', kind: 'cave_goblin', x: gal.x + 3, z: gal.z + 1, leash: 14 });
  out.push({ id: 'cgob-2', kind: 'cave_goblin', x: hall.x + 6, z: hall.z + 8, leash: 12 });
  out.push({ id: 'shaman-0', kind: 'cave_shaman', x: gal.x, z: gal.z - 5, leash: 14 });
  out.push({ id: 'knut', kind: 'troll', x: hall.x, z: hall.z - 2, leash: 26 });
  const pit = { x: GRUBEN.x + GRUBEN_SPOTS.pit.x, z: GRUBEN.z + GRUBEN_SPOTS.pit.z };
  out.push({ id: 'mine-king', kind: 'mine_king', x: pit.x, z: pit.z - 4, leash: 32 });
  out.push({ id: 'pit-draug-0', kind: 'draug', x: pit.x - 7, z: pit.z + 3, leash: 14 });
  out.push({ id: 'pit-draug-1', kind: 'draug', x: pit.x + 7, z: pit.z + 3, leash: 14 });
  // The shipwreck: drowned sailors on and around the deck, the captain at the stern.
  const S = SHIPWRECK;
  [[0, -7], [1.2, -2], [-1.2, 3], [0, 6]].forEach(([dx, dz], i) => out.push({ id: `drowned-${i}`, kind: 'drowned', x: S.x + dx, z: S.z + dz, leash: 16 }));
  out.push({ id: 'drowned-beach', kind: 'drowned', x: S.plankFrom - 3, z: S.z + 4, leash: 14 });
  out.push({ id: 'drowned-captain', kind: 'drowned_captain', x: S.x, z: S.z + S.length / 2 - 2, leash: 30 });
  out.push({ id: 'captain-crew-0', kind: 'drowned', x: S.x - 1, z: S.z + 4, leash: 30, summonedBy: 'drowned-captain' });
  out.push({ id: 'captain-crew-1', kind: 'drowned', x: S.x + 1, z: S.z + 4, leash: 30, summonedBy: 'drowned-captain' });
  // Sjøgrotta: crabs at the mouth and in their hollow, deep nagas in the gallery, wraiths in the
  // dark, and the Kraken in the pool at the bottom (its brood of crabs scuttles out at 60%).
  const G = (i: number) => grottoRoomCentre(i);
  const gp: [MobKind, number, number, number][] = [
    ['grotto_crab', 1, 3, -4], ['grotto_crab', 2, -4, 2], ['grotto_crab', 2, 4, 4], ['grotto_crab', 2, 0, -5],
    ['deep_naga', 1, 5, 4], ['deep_naga', 3, -4, 2], ['deep_naga', 3, 4, -2], ['deep_naga', 3, 0, 5],
    ['tide_wraith', 1, -2, 6], ['tide_wraith', 3, -6, -4], ['tide_wraith', 2, -6, -4],
  ];
  gp.forEach(([kind, room, dx, dz], i) => { const c = G(room); out.push({ id: `grotto-${i}`, kind, x: c.x + dx, z: c.z + dz, leash: 18 }); });
  const lair = G(4);
  out.push({ id: 'kraken', kind: 'kraken', x: GROTTO.x, z: GROTTO.z - 88, leash: 40 });
  [[-8, 4], [8, 4], [0, 9]].forEach(([dx, dz], i) => out.push({ id: `kraken-brood-${i}`, kind: 'grotto_crab', x: lair.x + dx, z: lair.z + dz, leash: 30, summonedBy: 'kraken' }));
  // The Mine King's honour guard: they rise when he's down to half.
  out.push({ id: 'king-guard-0', kind: 'draug', x: pit.x - 4, z: pit.z - 8, leash: 32, summonedBy: 'mine-king' });
  out.push({ id: 'king-guard-1', kind: 'draug', x: pit.x + 4, z: pit.z - 8, leash: 32, summonedBy: 'mine-king' });
  return out;
}
export const SPAWNS: Spawn[] = spawns();
/** How long a skinnable body stays after death. */
export const CORPSE_SEC = 30;
