/**
 * Monsters and where they live. The server runs their AI; clients draw them from snapshots.
 * Small-number scale (design doc §5): a level-1 player hits for ~11 with a stone sword.
 */
import { caveRoomCentre, CAVE } from './cave.js';
import { heightAt, GRUBEN, GRUBEN_SPOTS } from './terrain.js';

export type MobKind = 'wolf' | 'goblin' | 'bat' | 'cave_goblin' | 'cave_shaman' | 'troll' | 'lynx' | 'draug' | 'wisp' | 'hill_troll' | 'mine_king';

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
  scale: number;
  flying?: boolean;
}

export const MOBS: Record<MobKind, MobDef> = {
  wolf: { kind: 'wolf', name: 'Grey wolf', level: 2, hp: 30, dmg: 2.5, interval: 2, range: 1.8, speed: 4.2, aggro: 7, armour: 2, ward: 2, xp: 25, gold: [0, 2],
    drops: [{ item: 'raw_wolf_meat', chance: 0.7, qty: [1, 1] }], skin: { item: 'wolf_pelt', qty: [1, 2] }, respawnSec: [60, 120], scale: 1 },
  goblin: { kind: 'goblin', name: 'Goblin scout', level: 4, hp: 45, dmg: 4, interval: 1.8, range: 1.8, speed: 3.8, aggro: 10, armour: 4, ward: 2, xp: 40, gold: [1, 4],
    drops: [{ item: 'goblin_trinket', chance: 0.4, qty: [1, 1] }, { item: 'stone_arrowheads', chance: 0.2, qty: [5, 10] }, { gear: 1, chance: 0.06 }], skin: { item: 'goblin_skin', qty: [1, 1] }, respawnSec: [90, 150], scale: 1 },
  bat: { kind: 'bat', name: 'Cave bat', level: 5, hp: 25, dmg: 3, interval: 1.2, range: 1.6, speed: 5.5, aggro: 12, armour: 1, ward: 3, xp: 30, gold: [0, 1],
    drops: [{ item: 'bat_wing', chance: 0.5, qty: [1, 2] }], respawnSec: [60, 120], scale: 1, flying: true },
  cave_goblin: { kind: 'cave_goblin', name: 'Cave goblin', level: 7, hp: 70, dmg: 6, interval: 1.8, range: 1.9, speed: 3.8, aggro: 10, armour: 8, ward: 3, xp: 70, gold: [3, 8],
    drops: [{ item: 'goblin_trinket', chance: 0.5, qty: [1, 2] }, { item: 'iron_arrowheads', chance: 0.15, qty: [5, 10] }, { gear: 1, chance: 0.06 }, { gear: 2, chance: 0.03 }], skin: { item: 'goblin_skin', qty: [1, 2] }, respawnSec: [120, 200], scale: 1.1 },
  cave_shaman: { kind: 'cave_shaman', name: 'Goblin shaman', level: 8, hp: 55, dmg: 7, interval: 2.2, range: 14, speed: 3.4, aggro: 14, armour: 3, ward: 8, magic: true, xp: 85, gold: [4, 10],
    drops: [{ item: 'quartz', chance: 0.1, qty: [1, 1] }, { gear: 2, chance: 0.05 }], respawnSec: [150, 240], scale: 1 },
  troll: { kind: 'troll', name: 'Old Knut', level: 12, hp: 600, dmg: 14, interval: 2.6, range: 3.6, speed: 3.2, aggro: 12, armour: 15, ward: 5, xp: 800, gold: [40, 80],
    drops: [{ item: 'troll_tooth', chance: 1, qty: [1, 2] }, { gear: 2, chance: 0.6, legendary: 0.04 }, { item: 'trolltooth_necklace', chance: 0.03, qty: [1, 1] }, { item: 'garnet', chance: 0.25, qty: [1, 1] }],
    respawnSec: [90 * 60, 150 * 60], boss: true, slam: { every: 10, r: 5, mult: 2 }, scale: 2.3 },
  // Gruben (levels 13–22)
  lynx: { kind: 'lynx', name: 'Lynx', level: 13, hp: 110, dmg: 9, interval: 1.5, range: 1.8, speed: 5, aggro: 9, armour: 8, ward: 6, xp: 130, gold: [1, 4],
    drops: [{ item: 'raw_wolf_meat', chance: 0.4, qty: [1, 2] }], skin: { item: 'lynx_pelt', qty: [1, 2] }, respawnSec: [90, 160], scale: 0.9 },
  draug: { kind: 'draug', name: 'Draug miner', level: 15, hp: 170, dmg: 12, interval: 2, range: 2, speed: 3.4, aggro: 11, armour: 16, ward: 6, xp: 180, gold: [5, 12],
    drops: [{ item: 'grave_dust', chance: 0.6, qty: [1, 3] }, { item: 'coal', chance: 0.3, qty: [1, 3] }, { gear: 2, chance: 0.06 }, { gear: 3, chance: 0.04 }], respawnSec: [120, 200], scale: 1.05 },
  wisp: { kind: 'wisp', name: 'Lyktemann', level: 14, hp: 90, dmg: 11, interval: 2.4, range: 15, speed: 3.8, aggro: 15, armour: 2, ward: 14, magic: true, xp: 150, gold: [1, 4],
    drops: [{ item: 'wisp_essence', chance: 0.5, qty: [1, 1] }, { item: 'sapphire', chance: 0.05, qty: [1, 1] }], respawnSec: [120, 200], scale: 1, flying: true },
  hill_troll: { kind: 'hill_troll', name: 'Scree troll', level: 18, hp: 420, dmg: 18, interval: 2.8, range: 3, speed: 3, aggro: 10, armour: 20, ward: 6, xp: 420, gold: [10, 25],
    drops: [{ item: 'silver_ore', chance: 0.5, qty: [2, 4] }, { item: 'coal', chance: 0.5, qty: [2, 5] }, { item: 'garnet', chance: 0.1, qty: [1, 1] }, { gear: 3, chance: 0.12 }],
    respawnSec: [240, 360], slam: { every: 12, r: 4, mult: 1.6 }, scale: 1.7 },
  mine_king: { kind: 'mine_king', name: 'The Mine King', level: 22, hp: 1600, dmg: 22, interval: 2.4, range: 3.4, speed: 3.4, aggro: 14, armour: 26, ward: 14, xp: 2500, gold: [100, 200],
    drops: [{ item: 'kings_crown', chance: 1, qty: [1, 1] }, { gear: 3, chance: 0.6, legendary: 0.05 }, { gear: 4, chance: 0.25, legendary: 0.05 }, { item: 'mine_kings_ring', chance: 0.04, qty: [1, 1] }, { item: 'garnet', chance: 0.4, qty: [1, 2] }],
    respawnSec: [120 * 60, 180 * 60], boss: true, slam: { every: 9, r: 5.5, mult: 2.2 }, scale: 1.6 },
};

export interface Spawn { id: string; kind: MobKind; x: number; z: number; leash: number }

export const MOB_AREAS = [
  { name: 'Wolf pack', x: 74, z: 36, kind: 'wolf' as MobKind, n: 4, r: 10 },
  { name: 'Northern wolves', x: -6, z: 96, kind: 'wolf' as MobKind, n: 3, r: 9 },
  { name: 'Goblin camp', x: -62, z: -60, kind: 'goblin' as MobKind, n: 5, r: 10 },
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
  out.push({ id: 'knut', kind: 'troll', x: hall.x, z: hall.z - 2, leash: 13 });
  const pit = { x: GRUBEN.x + GRUBEN_SPOTS.pit.x, z: GRUBEN.z + GRUBEN_SPOTS.pit.z };
  out.push({ id: 'mine-king', kind: 'mine_king', x: pit.x, z: pit.z - 4, leash: 18 });
  out.push({ id: 'pit-draug-0', kind: 'draug', x: pit.x - 7, z: pit.z + 3, leash: 14 });
  out.push({ id: 'pit-draug-1', kind: 'draug', x: pit.x + 7, z: pit.z + 3, leash: 14 });
  return out;
}
export const SPAWNS: Spawn[] = spawns();
/** How long a skinnable body stays after death. */
export const CORPSE_SEC = 30;
