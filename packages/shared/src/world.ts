/**
 * World content client and server must agree on: ore veins, trees, crafting stations, NPCs and
 * shops, the inn, and recipes. Everything is generated deterministically, so ids match everywhere
 * and the server can validate requests by id.
 */
import { CHUNK_SIZE, SPIKE_CHUNKS, WATER_LEVEL } from './constants.js';
import { heightAt, mulberry32, VILLAGE, LAKE, PIER, GRUBEN, GRUBEN_SPOTS, inGruben, FJORD, FJORD_SPOTS, inFjord, SHIPWRECK, FORD_Z, fjordMid } from './terrain.js';
import { CAVE, CAVE_ENTRANCE, CHUNK_RANGES, GRUBEN_PASS, caveClearance, caveFloor, caveRoomCentre, inBounds } from './cave.js';
import { ARMOUR_PIECES, CLOTHS, ITEMS, JEWELS } from './items.js';
import { HOUSES, houseAt, toWorld, type HouseFrame } from './houses.js';
import type { SkillId } from './skills.js';

// ------------------------------------------------------------------ resource nodes

export type VeinType = 'stone' | 'iron' | 'coal' | 'silver' | 'coral' | 'seaglass';

export interface NodeTypeDef {
  name: string;
  item: string;
  skill: 'mining' | 'woodcutting' | 'tailoring' | 'herbalism' | 'cooking';
  level: number;
  power: number;
  xp: number;
  /** A depleted node comes back after a random time in this range (seconds). Nobody is told when. */
  respawnSec: [number, number];
  /** How many hits it takes to use it up. */
  hits: [number, number];
  gem?: { item: string; chance: number };
}

export const VEIN_TYPES: Record<VeinType, NodeTypeDef> = {
  // Each hit gives one ore; a vein gives `hits` before it's worked out, then regrows in `respawnSec`.
  stone: { name: 'Stone vein', item: 'stone', skill: 'mining', level: 1, power: 1, xp: 8, respawnSec: [10 * 60, 20 * 60], hits: [6, 10], gem: { item: 'quartz', chance: 1 / 150 } },
  iron: { name: 'Iron vein', item: 'iron_ore', skill: 'mining', level: 8, power: 1, xp: 20, respawnSec: [12 * 60, 25 * 60], hits: [5, 8], gem: { item: 'sapphire', chance: 1 / 200 } },
  coal: { name: 'Coal seam', item: 'coal', skill: 'mining', level: 14, power: 2, xp: 30, respawnSec: [15 * 60, 30 * 60], hits: [5, 9] },
  coral: { name: 'Coral bed', item: 'coral', skill: 'mining', level: 10, power: 1, xp: 26, respawnSec: [15 * 60, 30 * 60], hits: [3, 6], gem: { item: 'pearl', chance: 1 / 120 } },
  seaglass: { name: 'Sea-glass seam', item: 'sea_glass', skill: 'mining', level: 14, power: 2, xp: 34, respawnSec: [15 * 60, 30 * 60], hits: [3, 5] },
  silver: { name: 'Silver vein', item: 'silver_ore', skill: 'mining', level: 18, power: 2, xp: 45, respawnSec: [20 * 60, 40 * 60], hits: [4, 7], gem: { item: 'garnet', chance: 1 / 150 } },
};

export interface Vein { id: string; type: VeinType; x: number; y: number; z: number; r: number }

/** How close you must stand to mine or chop (metres, horizontal, from the node's edge). */
export const MINE_RANGE = 3.4;
/** How close you must stand to use a station, NPC or door. */
export const USE_RANGE = 4;

function slopeY(x: number, z: number): number {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
  return (2 * e) / Math.hypot(dx, 2 * e, dz);
}

const G = GRUBEN, FJ = FJORD;
/** Dirt paths between camp, Bjørkvik, the quarries, the mine and the goblin camp (polylines). */
export const PATHS: [number, number][][] = [
  [[0, 0], [-6, 10], [-12, 24], [-15, 35]],
  [[4, -2], [16, -12], [26, -22], [48, -20], [70, -16], [86, -14]],
  [[2, -6], [14, -30], [30, -52], [46, -70], [50, -76]],
  [[6, 4], [22, 22], [30, 44], [28, 70], [30, 90]],
  [[22, 22], [46, 30], [66, 33]],
  [[-40, 26], [-44, 8], [-50, -20], [-58, -48]],
  // Into Ulvedalen.
  [[-46, -4], [-58, -9], [-70, -13]],
  // Saltfjorden: up from the village along the east shore, over the ford, down the west shore to the wreck;
  // and south to the crab beach.
  [[FJ.x + 34, FJ.z + 4], [FJ.x + 37, FJ.z - 16], [FJ.x + 30, FJ.z - 40], [FJ.x + 22, FJ.z + FORD_Z]],
  [[FJ.x + 22, FJ.z + FORD_Z], [FJ.x + fjordMid(FORD_Z), FJ.z + FORD_Z], [FJ.x - 44, FJ.z + FORD_Z], [FJ.x - 50, FJ.z - 30], [FJ.x - 44, FJ.z], [SHIPWRECK.plankFrom - 4, SHIPWRECK.z]],
  [[FJ.x + 34, FJ.z + 14], [FJ.x + 34, FJ.z + 34], [FJ.x + 38, FJ.z + 52]],
  // Over the wolf meadows to the Gruben pass.
  [[66, 33], [84, 42], [96, 48]],
  // Gruben: from the arrival camp up the valley to the miners' village and the pit.
  [[G.x, G.z + 62], [G.x + 2, G.z + 44], [G.x - 4, G.z + 20], [G.x + 6, G.z - 12], [G.x, G.z - 42]],
  [[G.x + 4, G.z + 30], [G.x + 26, G.z + 22], [G.x + 38, G.z + 16]],
];
/** Distance (m) to the nearest path centre line. */
export function pathDist(x: number, z: number): number {
  let best = Infinity;
  for (const line of PATHS) for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Places nothing should be built over (buildings, paths, the cave mouth). */
export function keepClear(x: number, z: number): boolean {
  if (inGruben(x, z)) {
    const lx = x - G.x, lz = z - G.z, sp = GRUBEN_SPOTS;
    return Math.hypot(lx - sp.arrival.x, lz - sp.arrival.z) < sp.arrival.r + 7 || Math.hypot(lx - sp.pit.x, lz - sp.pit.z) < sp.pit.r + 3
      || Math.hypot(lx - sp.village.x, lz - sp.village.z) < sp.village.r + 4;
  }
  if (inFjord(x, z)) {
    const lx = x - FJ.x, lz = z - FJ.z, sp = FJORD_SPOTS;
    return Math.hypot(lx - sp.arrival.x, lz - sp.arrival.z) < sp.arrival.r + 5 || Math.hypot(lx - sp.village.x, lz - sp.village.z) < sp.village.r + 5
      || (Math.abs(x - SHIPWRECK.x) < 12 && Math.abs(z - SHIPWRECK.z) < SHIPWRECK.length / 2 + 4);
  }
  if (Math.hypot(x - GRUBEN_PASS.x, z - GRUBEN_PASS.z) < 7) return true;
  if (Math.hypot(x, z) < 18 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 7 || Math.hypot(x - CAVE_ENTRANCE.x, z - CAVE_ENTRANCE.z) < 8) return true;
  // The pier and a strip of shore around it.
  const px = x - PIER.x, pz = z - PIER.z, along = px * PIER.ux + pz * PIER.uz, side = -px * PIER.uz + pz * PIER.ux;
  return along > -4 && along < PIER.length + 2 && Math.abs(side) < 4;
}

/** Hotspots of several veins near the hills; a few lone veins elsewhere. */
export const MINING_SPOTS = [
  { name: 'Camp quarry', x: 26, z: -22 },
  { name: 'Grey Ridge', x: 86, z: -14 },
  { name: 'Hollow Hill', x: -84, z: -78 },
  { name: 'North Scree', x: 30, z: 94 },
  { name: 'Ulvedalen', x: -81, z: -15 },
];

function generateVeins(): Vein[] {
  const out: Vein[] = [];
  const far = (x: number, z: number) => out.every((v) => Math.hypot(v.x - x, v.z - z) > 3.6);
  const add = (type: VeinType, x: number, z: number, id: string, cave = false) => {
    const y = cave ? caveFloor(x, z) : heightAt(x, z);
    const r = type === 'stone' ? 1.1 : 1.0;
    // Inside the mine: well clear of the walls, so the rock isn't buried in one.
    if (cave && caveClearance(x, z) < r + 0.8) return false;
    if (!cave) {
      if (y < WATER_LEVEL + 0.6 || slopeY(x, z) < 0.75 || keepClear(x, z)) return false;
      // Fairly level footprint, so the rock sits on the ground instead of sinking into a slope.
      const hs = [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]].map(([dx, dz]) => heightAt(x + dx, z + dz));
      if (Math.max(...hs) - Math.min(...hs) > 0.9) return false;
    }
    if (!far(x, z)) return false;
    out.push({ id, type, x, y, z, r: type === 'stone' ? 1.1 : 1.0 });
    return true;
  };
  // Starter quarry a short walk north-east of camp: stone only.
  const rngC = mulberry32(4242);
  for (let i = 0, made = 0; i < 60 && made < 5; i++) {
    const a = rngC() * Math.PI * 2, d = rngC() * 7;
    if (add('stone', 26 + Math.cos(a) * d, -22 + Math.sin(a) * d, `camp-${made}`)) made++;
  }
  // Hotspots: three stone and three iron each, and two coal seams in the far ones.
  MINING_SPOTS.slice(1).forEach((h, hi) => {
    const rng = mulberry32(7000 + hi);
    let s = 0, f = 0;
    for (let i = 0; i < 80 && (s < 3 || f < 3); i++) {
      const a = rng() * Math.PI * 2, d = 2 + rng() * 9;
      const type: VeinType = s < 3 ? 'stone' : 'iron';
      if (add(type, h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, `h${hi}-${s + f}`)) type === 'stone' ? s++ : f++;
    }
    const crng = mulberry32(7300 + hi);
    for (let i = 0, c = 0; i < 60 && c < (hi === 0 ? 1 : 2); i++) {
      const a = crng() * Math.PI * 2, d = 4 + crng() * 10;
      if (add('coal', h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, `h${hi}-c${c}`)) c++;
    }
  });
  // A few lone veins scattered around.
  const [ax, bx, az, bz] = CHUNK_RANGES[0];
  for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) {
    const rng = mulberry32((cx * 92821) ^ (cz * 68917) ^ 0xa11);
    if (rng() > 0.45) continue;
    for (let i = 0; i < 10; i++) {
      const x = cx * CHUNK_SIZE + 6 + rng() * (CHUNK_SIZE - 12), z = cz * CHUNK_SIZE + 6 + rng() * (CHUNK_SIZE - 12);
      if (keepClear(x, z)) continue;
      const h = heightAt(x, z);
      if (add(h > 8.5 && rng() < 0.5 ? 'iron' : 'stone', x, z, `s${cx},${cz}`)) break;
    }
  }
  // The Old Mine: silver in the galleries, a little iron on the way.
  const gal = caveRoomCentre(1), roost = caveRoomCentre(2);
  [[gal.x - 5, gal.z - 3], [gal.x + 5, gal.z - 4], [gal.x - 2, gal.z + 5.5], [gal.x + 6, gal.z + 3], [roost.x + 3, roost.z - 3], [roost.x - 3.5, roost.z + 2]]
    .forEach(([x, z], i) => add('silver', x, z, `c-s${i}`, true));
  [[CAVE.x + 1.6, CAVE.z - 10], [CAVE.x + 7, CAVE.z - 26]].forEach(([x, z], i) => add('iron', x, z, `c-i${i}`, true));
  [[gal.x - 7, gal.z + 1], [gal.x + 2, gal.z - 6], [roost.x, roost.z + 4]].forEach(([x, z], i) => add('coal', x, z, `c-c${i}`, true));
  // Gruben: coal seams all over, silver and iron on the scree slopes.
  const grng = mulberry32(9911);
  const want: [VeinType, number][] = [['coal', 12], ['silver', 7], ['iron', 6], ['stone', 4]];
  for (const [type, n] of want) {
    for (let i = 0, made = 0; i < 400 && made < n; i++) {
      const x = G.x + (grng() - 0.5) * (G.half * 2 - 40), z = G.z + (grng() - 0.5) * (G.half * 2 - 40);
      if (add(type, x, z, `g-${type[0]}${made}`)) made++;
    }
  }
  // Saltfjorden: coral beds on the southern beaches, sea glass along the west shore.
  const frng = mulberry32(9933);
  const fz: [VeinType, number, number, number, number][] = [['coral', 36, 52, 10, 3], ['coral', -34, 52, 10, 2], ['seaglass', -44, -2, 10, 3]];
  fz.forEach(([type, cx, cz, r, n], k) => {
    for (let i = 0, made = 0; i < 300 && made < n; i++) {
      const a = frng() * Math.PI * 2, d = 2 + frng() * r;
      if (add(type, FJ.x + cx + Math.cos(a) * d, FJ.z + cz + Math.sin(a) * d, `f-${type[0]}${k}${made}`)) made++;
    }
  });
  return out;
}

export const VEINS: Vein[] = generateVeins();
export const VEIN_BY_ID: Map<string, Vein> = new Map(VEINS.map((v) => [v.id, v]));

// ------------------------------------------------------------------ trees

export type TreeKind = 'birch' | 'pine';
export const TREE_TYPES: Record<TreeKind, NodeTypeDef> = {
  birch: { name: 'Birch', item: 'birch_log', skill: 'woodcutting', level: 1, power: 1, xp: 10, respawnSec: [20 * 60, 60 * 60], hits: [3, 6] },
  pine: { name: 'Pine', item: 'pine_log', skill: 'woodcutting', level: 10, power: 1, xp: 24, respawnSec: [20 * 60, 60 * 60], hits: [4, 8] },
};

export interface Tree { id: string; kind: TreeKind; x: number; y: number; z: number; s: number; ry: number; tint: number }

/** Every tree in the world, per chunk. All of them can be felled. */
export function treesInChunk(cx: number, cz: number): Tree[] {
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x7a3e);
  const out: Tree[] = [];
  for (let i = 0; i < 60; i++) {
    const x = cx * CHUNK_SIZE + rng() * CHUNK_SIZE, z = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const roll = rng(), ry = rng() * Math.PI * 2, s0 = rng(), tint = 0.85 + rng() * 0.3;
    const y = heightAt(x, z);
    if (!inBounds(x, z, 3)) continue;
    const gr = inGruben(x, z);
    if (y < WATER_LEVEL + 0.6 || y > (gr ? 22 : 16) || keepClear(x, z) || slopeY(x, z) < 0.8) continue;
    // Gruben is barer: old mine country, logged long ago.
    if (gr && rng() < 0.45) continue;
    if (VEINS.some((v) => Math.abs(v.x - x) < 3.2 && Math.abs(v.z - z) < 3.2)) continue;
    if (pathDist(x, z) < 2.4) continue;
    if (roll > 0.62) continue;
    const near = Math.hypot(x, z) < 75;
    const kind: TreeKind = (gr ? roll < 0.08 : near ? roll < 0.38 : roll < 0.2) ? 'birch' : 'pine';
    out.push({ id: `t${cx},${cz},${i}`, kind, x, y, z, s: kind === 'birch' ? 0.8 + s0 * 0.5 : 0.75 + s0 * 0.65, ry, tint });
  }
  return out;
}

const _trees = new Map<string, Tree>();
for (const [ax, bx, az, bz] of CHUNK_RANGES) for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) for (const t of treesInChunk(cx, cz)) _trees.set(t.id, t);
export const TREE_BY_ID: Map<string, Tree> = _trees;

/** Seconds per swing: tool speed, −1% per level, then speed bonuses. */
export function swingSeconds(toolSwingSec: number, level: number, speedBonus: number): number {
  return (toolSwingSec * (1 - 0.01 * (level - 1))) / (1 + Math.max(0, speedBonus));
}

// ------------------------------------------------------------------ plants (tailoring fibres, herbalism herbs)

export type PlantKind = 'flax' | 'jute' | 'ramie' | 'bog_cotton' | 'bamboo' | 'salt_pan' | 'angelica' | 'cloudberry' | 'roseroot' | 'grave_moss';
export const PLANT_TYPES: Record<PlantKind, NodeTypeDef> = {
  flax: { name: 'Flax', item: 'flax', skill: 'tailoring', level: 1, power: 0, xp: 6, respawnSec: [8 * 60, 15 * 60], hits: [2, 4] },
  jute: { name: 'Jute', item: 'jute', skill: 'tailoring', level: 6, power: 0, xp: 10, respawnSec: [8 * 60, 16 * 60], hits: [2, 4] },
  ramie: { name: 'Ramie', item: 'ramie', skill: 'tailoring', level: 12, power: 0, xp: 15, respawnSec: [10 * 60, 18 * 60], hits: [2, 4] },
  bog_cotton: { name: 'Cotton', item: 'bog_cotton', skill: 'tailoring', level: 18, power: 0, xp: 21, respawnSec: [10 * 60, 20 * 60], hits: [2, 4] },
  bamboo: { name: 'Bamboo', item: 'bamboo', skill: 'tailoring', level: 24, power: 0, xp: 28, respawnSec: [12 * 60, 22 * 60], hits: [2, 3] },
  salt_pan: { name: 'Salt pan', item: 'salt', skill: 'cooking', level: 1, power: 0, xp: 5, respawnSec: [6 * 60, 12 * 60], hits: [3, 5] },
  angelica: { name: 'Angelica', item: 'angelica', skill: 'herbalism', level: 1, power: 0, xp: 8, respawnSec: [8 * 60, 15 * 60], hits: [1, 3] },
  cloudberry: { name: 'Cloudberries', item: 'cloudberry', skill: 'herbalism', level: 6, power: 0, xp: 14, respawnSec: [10 * 60, 20 * 60], hits: [2, 3] },
  roseroot: { name: 'Roseroot', item: 'roseroot', skill: 'herbalism', level: 12, power: 0, xp: 24, respawnSec: [12 * 60, 25 * 60], hits: [1, 3] },
  grave_moss: { name: 'Grave moss', item: 'grave_moss', skill: 'herbalism', level: 18, power: 0, xp: 38, respawnSec: [15 * 60, 30 * 60], hits: [1, 3] },
};
/** Seconds per pick at level 1 (no tool needed); −1% per level. */
export const PICK_SEC = 1.5;
export interface Plant { id: string; kind: PlantKind; x: number; y: number; z: number }

/** Flax fields in the valley meadows; jute on the lake shore; ramie on the valley's slopes; cotton on Gruben's terraces; bamboo in Gruben's bog. */
export const FLAX_FIELDS = [{ name: 'Flax field', x: 10, z: 42 }, { name: 'Flax field', x: -46, z: 4 }, { name: 'Flax field', x: 44, z: 62 }];
function generatePlants(): Plant[] {
  const out: Plant[] = [];
  const ok = (x: number, z: number) => !keepClear(x, z) && pathDist(x, z) > 2 && slopeY(x, z) > 0.85
    && out.every((p) => Math.hypot(p.x - x, p.z - z) > 2.2) && VEINS.every((v) => Math.hypot(v.x - x, v.z - z) > 3);
  FLAX_FIELDS.forEach((f, fi) => {
    const rng = mulberry32(5100 + fi);
    for (let i = 0, made = 0; i < 80 && made < 6; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 7, x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      if (heightAt(x, z) > 0.8 && ok(x, z)) { out.push({ id: `f${fi}-${made}`, kind: 'flax', x, y: heightAt(x, z), z }); made++; }
    }
  });
  // Lake shore: wet ground just above the water.
  const rl = mulberry32(5200);
  for (let i = 0, made = 0; i < 600 && made < 10; i++) {
    const a = rl() * Math.PI * 2, d = LAKE.r * (0.6 + rl() * 0.6), x = LAKE.x + Math.cos(a) * d, z = LAKE.z + Math.sin(a) * d, h = heightAt(x, z);
    if (h > 0.35 && h < 1.4 && ok(x, z)) { out.push({ id: `c-l${made}`, kind: 'jute', x, y: h, z }); made++; }
  }
  // Gruben's Lantern bog: a bamboo grove.
  const rg = mulberry32(5300);
  for (let i = 0, made = 0; i < 300 && made < 8; i++) {
    const a = rg() * Math.PI * 2, d = 2 + rg() * 12, x = G.x - 42 + Math.cos(a) * d, z = G.z - 46 + Math.sin(a) * d;
    if (ok(x, z)) { out.push({ id: `c-g${made}`, kind: 'bamboo', x, y: heightAt(x, z), z }); made++; }
  }
  // Saltfjorden's salt pans: shallow pools on the east shore south of the village.
  const rs = mulberry32(5600);
  for (let i = 0, made = 0; i < 600 && made < 6; i++) {
    const x = FJ.x + 24 + rs() * 18, z = FJ.z + 24 + rs() * 22, h = heightAt(x, z);
    if (h > 0.5 && h < 6 && ok(x, z)) { out.push({ id: `salt-${made}`, kind: 'salt_pan', x, y: h, z }); made++; }
  }
  // Herbs. Angelica: meadows and stream banks across the valley.
  const scatter = (kind: PlantKind, seed: number, n: number, tries: number, at: () => [number, number], when: (x: number, z: number, h: number) => boolean) => {
    for (let i = 0, made = 0; i < tries && made < n; i++) {
      const [x, z] = at(), h = heightAt(x, z);
      if (when(x, z, h) && inBounds(x, z, 6) && ok(x, z)) { out.push({ id: `h-${seed}-${made}`, kind, x, y: h, z }); made++; }
    }
  };
  const rv = mulberry32(5400), rg2 = mulberry32(5500);
  const inValley = (): [number, number] => [(rv() - 0.5) * 220, (rv() - 0.5) * 220];
  const inGrubenV = (): [number, number] => [G.x + (rg2() - 0.5) * 150, G.z + (rg2() - 0.5) * 150];
  // Ramie on the valley's lower slopes; cotton on Gruben's sheltered terraces.
  scatter('ramie', 5408, 10, 3000, inValley, (_x, _z, h) => h > 2.5 && h < 8);
  scatter('bog_cotton', 5409, 9, 3000, inGrubenV, (_x, _z, h) => h > 5 && h < 10);
  scatter('angelica', 5401, 16, 2000, inValley, (_x, _z, h) => h > 1.2 && h < 7);
  scatter('cloudberry', 5402, 8, 3000, () => { const a = rv() * Math.PI * 2, d = LAKE.r * (0.7 + rv() * 0.5); return [LAKE.x + Math.cos(a) * d, LAKE.z + Math.sin(a) * d]; }, (_x, _z, h) => h > 0.4 && h < 1.8);
  scatter('cloudberry', 5403, 6, 600, () => [G.x - 42 + (rg2() - 0.5) * 26, G.z - 46 + (rg2() - 0.5) * 26], () => true);
  scatter('roseroot', 5404, 8, 3000, inValley, (_x, _z, h) => h > 9);
  scatter('roseroot', 5405, 8, 3000, inGrubenV, (_x, _z, h) => h > 11);
  const row = { x: G.x + GRUBEN_SPOTS.village.x, z: G.z + GRUBEN_SPOTS.village.z }, pit = { x: G.x + GRUBEN_SPOTS.pit.x, z: G.z + GRUBEN_SPOTS.pit.z };
  scatter('grave_moss', 5406, 6, 600, () => [row.x + (rg2() - 0.5) * 28, row.z + (rg2() - 0.5) * 28], () => true);
  scatter('grave_moss', 5407, 4, 600, () => { const a = rg2() * Math.PI * 2, d = 14 + rg2() * 8; return [pit.x + Math.cos(a) * d, pit.z + Math.sin(a) * d]; }, () => true);
  return out;
}
export const PLANTS: Plant[] = generatePlants();
export const PLANT_BY_ID: Map<string, Plant> = new Map(PLANTS.map((p) => [p.id, p]));

// ------------------------------------------------------------------ fishing

/** Fish in the lake by level; weights are relative. Rare fish roll separately. */
export const FISH_TABLE: { item: string; level: number; xp: number; weight: number; difficulty: number }[] = [
  { item: 'raw_perch', level: 1, xp: 10, weight: 50, difficulty: 0.15 },
  { item: 'raw_trout', level: 5, xp: 18, weight: 30, difficulty: 0.3 },
  { item: 'raw_char', level: 12, xp: 30, weight: 20, difficulty: 0.45 },
  { item: 'raw_pike', level: 18, xp: 45, weight: 14, difficulty: 0.6 },
  { item: 'old_boot', level: 1, xp: 2, weight: 4, difficulty: 0.05 },
];
export const RARE_FISH = { item: 'golden_perch', chance: 1 / 120, xp: 80, difficulty: 0.85 };
/** Saltfjorden's sea fish (instead of the lake's), and its rare catch. */
export const SEA_FISH_TABLE: typeof FISH_TABLE = [
  { item: 'raw_herring', level: 8, xp: 22, weight: 45, difficulty: 0.25 },
  { item: 'raw_mackerel', level: 12, xp: 30, weight: 30, difficulty: 0.35 },
  { item: 'raw_cod', level: 16, xp: 42, weight: 22, difficulty: 0.5 },
  { item: 'raw_halibut', level: 22, xp: 60, weight: 12, difficulty: 0.65 },
  { item: 'raw_wolffish', level: 28, xp: 80, weight: 8, difficulty: 0.75 },
  { item: 'seaweed', level: 1, xp: 2, weight: 6, difficulty: 0.05 },
];
export const SEA_RARE = { item: 'pearl', chance: 1 / 90, xp: 120, difficulty: 0.85 };
/**
 * Saltfjorden's deeps (rolled before the lake-bed treasure, only there): the fished weapons and the
 * alligator. Very hard catches.
 */
export const SEA_TREASURE: { item: string; chance: number; level: number; xp: number; difficulty: number }[] = [
  { item: 'swordfish_blade', chance: 1 / 500, level: 14, xp: 200, difficulty: 0.92 },
  { item: 'harpoon', chance: 1 / 500, level: 16, xp: 200, difficulty: 0.92 },
  { item: 'sea_kings_trident', chance: 1 / 1400, level: 22, xp: 350, difficulty: 0.95 },
  { item: 'ships_anchor', chance: 1 / 1400, level: 22, xp: 350, difficulty: 0.95 },
  { item: 'fjord_alligator', chance: 1 / 2500, level: 25, xp: 500, difficulty: 0.95 },
];
/**
 * Things at the bottom of the lake, rolled before the fish (chances per cast, before luck). The
 * catch is decided when you cast, and the better it is the harder it fights: gems are tricky,
 * gear is very hard (more so the higher its tier and rarity), and a horse is nearly impossible.
 */
export const LAKE_TREASURE: { what: 'gem' | 'gear' | 'plans' | 'mount'; chance: number; level: number; xp: number; difficulty: number }[] = [
  { what: 'gem', chance: 1 / 70, level: 4, xp: 40, difficulty: 0.75 },
  { what: 'gear', chance: 1 / 160, level: 6, xp: 70, difficulty: 0.9 },
  { what: 'plans', chance: 1 / 900, level: 12, xp: 120, difficulty: 0.92 },
  { what: 'mount', chance: 1 / 3000, level: 15, xp: 250, difficulty: 0.95 },
];
/** You must stand within this of the water's edge, and cast at most this far. */
export const CAST_RANGE = 14;
/** A point is fishable if it's lake water deep enough. */
export const isFishable = (x: number, z: number) => heightAt(x, z) < WATER_LEVEL - 0.4 && (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r || inFjord(x, z));

// ------------------------------------------------------------------ places: stations, NPCs, inn

export type StationKind = 'furnace' | 'anvil' | 'workbench' | 'campfire' | 'stove' | 'tanning' | 'loom' | 'alchemy';
export interface Station { id: string; kind: StationKind; name: string; x: number; z: number; r: number }
const V = VILLAGE;

export const STATIONS: Station[] = [
  { id: 'camp_furnace', kind: 'furnace', name: 'Furnace', x: 6.5, z: -8, r: 1.2 },
  { id: 'camp_anvil', kind: 'anvil', name: 'Anvil', x: 10.5, z: -4, r: 0.8 },
  { id: 'camp_bench', kind: 'workbench', name: 'Workbench', x: 9, z: 4, r: 1 },
  { id: 'camp_fire', kind: 'campfire', name: 'Campfire', x: -3, z: 6, r: 0.9 },
  { id: 'village_fire', kind: 'campfire', name: 'Campfire', x: V.x + 1, z: V.z + 7, r: 0.9 },
  { id: 'inn_stove', kind: 'stove', name: 'Inn stove', x: V.x + 12.4, z: V.z - 9.5, r: 0.8 },
  { id: 'village_bench', kind: 'workbench', name: 'Workbench', x: V.x - 8, z: V.z - 1, r: 1 },
  { id: 'camp_tanning', kind: 'tanning', name: 'Tanning rack', x: -4, z: -12.5, r: 1 },
  { id: 'village_tanning', kind: 'tanning', name: 'Tanning rack', x: V.x + 13, z: V.z + 6, r: 1 },
  { id: 'village_loom', kind: 'loom', name: 'Loom', x: V.x + 7, z: V.z + 1, r: 1 },
  { id: 'village_alchemy', kind: 'alchemy', name: 'Alchemy table', x: V.x - 1, z: V.z + 13.5, r: 1 },
  { id: 'fjord_fire', kind: 'campfire', name: 'Smokehouse fire', x: FJ.x + FJORD_SPOTS.village.x + 3, z: FJ.z + FJORD_SPOTS.village.z + 4, r: 0.9 },
  { id: 'fjord_tanning', kind: 'tanning', name: 'Tanning rack', x: FJ.x + FJORD_SPOTS.village.x + 6, z: FJ.z + FJORD_SPOTS.village.z - 6, r: 1 },
  { id: 'gruben_alchemy', kind: 'alchemy', name: 'Alchemy table', x: G.x - 10, z: G.z + 52, r: 1 },
  { id: 'gruben_loom', kind: 'loom', name: 'Loom', x: G.x - 6, z: G.z + 61, r: 1 },
  // Gruben's arrival camp: a fire, a forge and a rack, so you can work what you find up here.
  { id: 'gruben_fire', kind: 'campfire', name: 'Campfire', x: G.x - 4, z: G.z + 51, r: 0.9 },
  { id: 'gruben_furnace', kind: 'furnace', name: 'Furnace', x: G.x + 7, z: G.z + 48, r: 1.2 },
  { id: 'gruben_anvil', kind: 'anvil', name: 'Anvil', x: G.x + 8, z: G.z + 53, r: 0.8 },
  { id: 'gruben_tanning', kind: 'tanning', name: 'Tanning rack', x: G.x - 9, z: G.z + 57, r: 1 },
];
export const STATION_BY_ID: Map<string, Station> = new Map(STATIONS.map((s) => [s.id, s]));
export const STATION_LABEL: Record<StationKind, string> = { furnace: 'Furnace', anvil: 'Anvil', workbench: 'Workbench', campfire: 'Campfire', stove: 'Stove', tanning: 'Tanning rack', loom: 'Loom', alchemy: 'Alchemy table' };

export type NpcRole = 'shop' | 'quests' | 'inn' | 'imbuer';
export interface Npc { id: string; name: string; title: string; x: number; z: number; face: number; color: number; race: 'human' | 'dwarf' | 'gnome' | 'ogre'; roles: NpcRole[]; sells?: string[] }

export const NPCS: Npc[] = [
  { id: 'ingrid', name: 'Ingrid', title: 'Trader', x: -9, z: -7, face: 2, color: 5, race: 'human', roles: ['shop'],
    sells: ['stone_pickaxe', 'stone_hatchet', 'basic_rod', 'small_rucksack', 'leather_backpack', 'skateboard'] },
  { id: 'mats', name: 'Mats', title: 'Miner', x: 20, z: -15, face: 3, color: 3, race: 'dwarf', roles: ['quests'] },
  { id: 'sigrid', name: 'Sigrid', title: 'Smith', x: 13, z: -6.5, face: 1, color: 0, race: 'human', roles: ['quests'] },
  { id: 'hilde', name: 'Hilde', title: 'Innkeeper', x: V.x, z: V.z - 3.2, face: 0, color: 6, race: 'human', roles: ['inn', 'quests'] },
  { id: 'frida', name: 'Frida', title: 'Fisher', x: PIER.x - PIER.uz * 2.4 - PIER.ux * 1.5, z: PIER.z + PIER.ux * 2.4 - PIER.uz * 1.5, face: 4, color: 1, race: 'human', roles: ['quests'] },
  { id: 'halvard', name: 'Halvard', title: 'Hunter', x: V.x + 12, z: V.z + 2, face: 3, color: 2, race: 'ogre', roles: ['quests'] },
  { id: 'tor', name: 'Tor', title: 'Woodcutter', x: V.x + 6, z: V.z + 11, face: 0, color: 7, race: 'human', roles: ['quests'] },
  { id: 'eirik', name: 'Eirik', title: 'Stablemaster', x: V.x - 15.5, z: V.z - 6, face: 2, color: 6, race: 'human', roles: ['shop'], sells: ['fjord_horse', 'black_fjord_horse'] },
  { id: 'solvi', name: 'Sølvi', title: 'Fishmonger', x: FJ.x + FJORD_SPOTS.village.x - 3, z: FJ.z + FJORD_SPOTS.village.z - 2, face: 4, color: 5, race: 'human', roles: ['shop', 'quests'], sells: ['saltwater_rod', 'basic_rod'] },
  { id: 'ulrik', name: 'Ulrik', title: 'Old sailor', x: FJ.x + FJORD_SPOTS.village.x + 1, z: FJ.z + FJORD_SPOTS.village.z + 6, face: 1, color: 2, race: 'dwarf', roles: ['quests'] },
  { id: 'johan', name: 'Johan', title: 'Old miner', x: G.x + 2, z: G.z + 47, face: 1, color: 3, race: 'dwarf', roles: ['quests'] },
  { id: 'ragna', name: 'Ragna', title: 'Imbuer & herbalist', x: V.x - 4, z: V.z + 11, face: 4, color: 4, race: 'gnome', roles: ['imbuer', 'shop', 'quests'], sells: ['vial'] },
];
export const NPC_BY_ID: Map<string, Npc> = new Map(NPCS.map((n) => [n.id, n]));

/** The lodge: a long building with 8 numbered doors facing the village green. */
export const INN = {
  name: 'Bjørkvik Lodge', x: V.x, z: V.z - 7.5, w: 22, d: 6,
  rooms: 8, pricePerWeek: 25, maxWeeks: 4,
};
/** Door n (0–7) of the lodge, on its front (+z) wall, in the middle of room n. */
export const innDoor = (n: number) => ({ x: INN.x - INN.w / 2 + (n + 0.5) * (INN.w / INN.rooms), z: INN.z + INN.d / 2 + 0.2 });
/**
 * Room n inside the lodge: a cell between partition walls, the door in its front wall. The bed is
 * against the back wall, a nightstand by its head, the chest at its foot.
 */
export function innRoom(n: number) {
  const w = INN.w / INN.rooms, x0 = INN.x - INN.w / 2 + n * w, z0 = INN.z - INN.d / 2, z1 = INN.z + INN.d / 2;
  const bx = x0 + w * 0.3;
  return {
    x0, x1: x0 + w, z0, z1,
    bed: { x: bx, z: z0 + 1.15 },
    nightstand: { x: x0 + w * 0.78, z: z0 + 0.4 },
    chest: { x: bx, z: z0 + 2.65 },
  };
}
/** Is (x, z) inside room n (between its walls)? */
export function inInnRoom(n: number, x: number, z: number, margin = 0): boolean {
  const r = innRoom(n);
  return x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin;
}
/** Which home's inside (x, z) is in — a lodge room or a house — or -1. */
export function homeAt(x: number, z: number): number {
  const r = innRoomAt(x, z);
  if (r >= 0) return r;
  return houseAt(x, z)?.id ?? -1;
}
/** Where a home's door is (the opening in its wall), for collisions and the door model. */
export function homeDoorway(id: number): { x: number; z: number } {
  if (id < INN.rooms) { const d = innDoor(id); return { x: d.x, z: INN.z + INN.d / 2 }; }
  const f = HOUSES.find((h) => h.id === id)!;
  return toWorld(f, 0, -f.d / 2);
}

/** Which lodge room (x, z) is in, or -1. */
export function innRoomAt(x: number, z: number): number {
  if (Math.abs(z - INN.z) > INN.d / 2 || Math.abs(x - INN.x) > INN.w / 2) return -1;
  return Math.min(INN.rooms - 1, Math.floor((x - (INN.x - INN.w / 2)) / (INN.w / INN.rooms)));
}

/**
 * Homes you can rent: the lodge's eight rooms, three cottages on Bjørkvik's green and two miners'
 * huts at Gruben's camp. One home at a time; your chest (character storage) moves with you, but
 * how much of it you can fill depends on the home. Rest at your door for a "Rested" XP buff.
 */
export type HomeKind = 'room' | 'cottage' | 'hut';
export interface Home {
  id: number; kind: HomeKind; name: string;
  /** Where its door is (stand here to use the chest or rest). */
  door: { x: number; z: number };
  /** The building (cottages and huts), facing `face`. */
  house?: { x: number; z: number; faceX: number; faceZ: number };
  price: number; storage: number; rest: { xp: number; regen: number };
  /** Where the storage chest is (inside lodge rooms; by the door for houses). */
  chest: { x: number; z: number };
}
export const STORAGE_MAX = 48;
const ROOM_REST = { xp: 0.05, regen: 1 }, HOUSE_REST = { xp: 0.1, regen: 2 };
function houseHome(f: HouseFrame, price: number, storage: number): Home {
  return {
    id: f.id, kind: f.kind, name: f.name, door: toWorld(f, 0, -f.d / 2 - 0.6), chest: toWorld(f, f.chest.x, f.chest.z),
    house: { x: f.x, z: f.z, faceX: f.x + Math.sin(f.ry + Math.PI), faceZ: f.z + Math.cos(f.ry + Math.PI) }, price, storage, rest: HOUSE_REST,
  };
}
export const HOMES: Home[] = [
  ...Array.from({ length: INN.rooms }, (_, n): Home => ({ id: n, kind: 'room', name: `Room ${n + 1}`, door: innDoor(n), chest: innRoom(n).chest, price: INN.pricePerWeek, storage: 24, rest: ROOM_REST })),
  ...HOUSES.map((f) => (f.kind === 'cottage' ? houseHome(f, 60, 48) : houseHome(f, 40, 36))),
];
/** Who rents which home, as the server sends it: one name (or null) per home. */
export const homeLabel = (h: Home) => (h.kind === 'room' ? `Lodge room ${h.id + 1}` : h.name);

/** Bjørkvik's stable (an open shed by Eirik). */
export const STABLE = { x: V.x - 20, z: V.z - 7, w: 6, d: 3.4 };

/** Staffs the Imbuer can enchant: staff → gem + gold. */
export const IMBUE: Record<string, { gem: string; gold: number; fire: string; frost: string; life: string }> = {
  birch_staff: { gem: 'quartz', gold: 25, fire: 'birch_fire_staff', frost: 'birch_frost_staff', life: 'birch_life_staff' },
  pine_staff: { gem: 'sapphire', gold: 75, fire: 'pine_fire_staff', frost: 'pine_frost_staff', life: 'pine_life_staff' },
};

// ------------------------------------------------------------------ recipes

export interface Recipe {
  id: string;
  skill: SkillId;
  station: StationKind | StationKind[];
  level: number;
  inputs: { item: string; qty: number }[];
  output: { item: string; qty: number };
  xp: number;
  seconds: number;
  /** Cooking: can burn into burnt_fish. */
  burns?: boolean;
  /** Needs these plans learned first (warhammer, halberd, spear). */
  plans?: string;
}

/** Fibres: raw plant → thread → cloth, and the Tailoring level to spin them. */
export const FIBRES = [
  { raw: 'flax', thread: 'linen_thread', cloth: 'linen', level: 1, xp: 5 },
  { raw: 'jute', thread: 'jute_thread', cloth: 'hessian', level: 6, xp: 8 },
  { raw: 'ramie', thread: 'ramie_thread', cloth: 'ramie_cloth', level: 12, xp: 12 },
  { raw: 'bog_cotton', thread: 'cotton_thread', cloth: 'cotton_cloth', level: 18, xp: 17 },
  { raw: 'bamboo', thread: 'bamboo_thread', cloth: 'bamboo_cloth', level: 24, xp: 23 },
];
const R: Recipe[] = [
  // smithing: materials
  { id: 'shaped_stone', skill: 'smithing', station: 'anvil', level: 1, inputs: [{ item: 'stone', qty: 2 }], output: { item: 'shaped_stone', qty: 1 }, xp: 6, seconds: 1.6 },
  { id: 'iron_bar', skill: 'smithing', station: 'furnace', level: 8, inputs: [{ item: 'iron_ore', qty: 2 }], output: { item: 'iron_bar', qty: 1 }, xp: 15, seconds: 2 },
  { id: 'silver_bar', skill: 'smithing', station: 'furnace', level: 18, inputs: [{ item: 'silver_ore', qty: 2 }], output: { item: 'silver_bar', qty: 1 }, xp: 30, seconds: 2.4 },
  { id: 'steel_bar', skill: 'smithing', station: 'furnace', level: 16, inputs: [{ item: 'iron_ore', qty: 2 }, { item: 'coal', qty: 2 }], output: { item: 'steel_bar', qty: 1 }, xp: 28, seconds: 2.4 },
  { id: 'silversteel_bar', skill: 'smithing', station: 'furnace', level: 26, inputs: [{ item: 'steel_bar', qty: 2 }, { item: 'silver_bar', qty: 1 }], output: { item: 'silversteel_bar', qty: 1 }, xp: 60, seconds: 3 },
  { id: 'stone_arrowheads', skill: 'smithing', station: 'anvil', level: 1, inputs: [{ item: 'shaped_stone', qty: 1 }], output: { item: 'stone_arrowheads', qty: 15 }, xp: 8, seconds: 2 },
  { id: 'iron_arrowheads', skill: 'smithing', station: 'anvil', level: 9, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_arrowheads', qty: 15 }, xp: 18, seconds: 2 },
  { id: 'steel_arrowheads', skill: 'smithing', station: 'anvil', level: 18, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_arrowheads', qty: 15 }, xp: 32, seconds: 2 },
  // smithing: weapons and tools
  { id: 'stone_sword', skill: 'smithing', station: 'anvil', level: 2, inputs: [{ item: 'shaped_stone', qty: 4 }], output: { item: 'stone_sword', qty: 1 }, xp: 30, seconds: 3 },
  { id: 'stone_mace', skill: 'smithing', station: 'anvil', level: 3, inputs: [{ item: 'shaped_stone', qty: 4 }, { item: 'birch_log', qty: 1 }], output: { item: 'stone_mace', qty: 1 }, xp: 32, seconds: 3 },
  { id: 'stone_longsword', skill: 'smithing', station: 'anvil', level: 5, inputs: [{ item: 'shaped_stone', qty: 8 }], output: { item: 'stone_longsword', qty: 1 }, xp: 60, seconds: 4 },
  { id: 'stone_battleaxe', skill: 'smithing', station: 'anvil', level: 6, inputs: [{ item: 'shaped_stone', qty: 8 }, { item: 'birch_log', qty: 1 }], output: { item: 'stone_battleaxe', qty: 1 }, xp: 65, seconds: 4 },
  { id: 'iron_pickaxe', skill: 'smithing', station: 'anvil', level: 10, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'shaped_stone', qty: 1 }], output: { item: 'iron_pickaxe', qty: 1 }, xp: 100, seconds: 4 },
  { id: 'iron_hatchet', skill: 'smithing', station: 'anvil', level: 11, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'birch_log', qty: 1 }], output: { item: 'iron_hatchet', qty: 1 }, xp: 100, seconds: 4 },
  { id: 'iron_sword', skill: 'smithing', station: 'anvil', level: 10, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'shaped_stone', qty: 1 }], output: { item: 'iron_sword', qty: 1 }, xp: 100, seconds: 4 },
  { id: 'iron_mace', skill: 'smithing', station: 'anvil', level: 11, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'birch_log', qty: 1 }], output: { item: 'iron_mace', qty: 1 }, xp: 105, seconds: 4 },
  { id: 'iron_longsword', skill: 'smithing', station: 'anvil', level: 14, inputs: [{ item: 'iron_bar', qty: 8 }, { item: 'shaped_stone', qty: 2 }], output: { item: 'iron_longsword', qty: 1 }, xp: 190, seconds: 5 },
  { id: 'iron_battleaxe', skill: 'smithing', station: 'anvil', level: 15, inputs: [{ item: 'iron_bar', qty: 8 }, { item: 'pine_log', qty: 1 }], output: { item: 'iron_battleaxe', qty: 1 }, xp: 200, seconds: 5 },
  { id: 'stone_skinning_knife', skill: 'smithing', station: 'anvil', level: 2, inputs: [{ item: 'shaped_stone', qty: 2 }], output: { item: 'stone_skinning_knife', qty: 1 }, xp: 16, seconds: 2.5 },
  { id: 'iron_skinning_knife', skill: 'smithing', station: 'anvil', level: 9, inputs: [{ item: 'iron_bar', qty: 2 }, { item: 'birch_log', qty: 1 }], output: { item: 'iron_skinning_knife', qty: 1 }, xp: 50, seconds: 3 },
  // steel (tier 3) and silversteel (tier 4) tools and weapons
  ...(['steel', 'silversteel'] as const).flatMap((t, i): Recipe[] => {
    const bar = `${t}_bar`, lv = i === 0 ? 18 : 28, k = i === 0 ? 1 : 2.2;
    const mk = (id: string, level: number, inputs: Recipe['inputs'], xp: number, seconds = 4.5): Recipe => ({ id, skill: 'smithing', station: 'anvil', level, inputs, output: { item: id, qty: 1 }, xp: Math.round(xp * k), seconds });
    return [
      mk(`${t}_pickaxe`, lv, [{ item: bar, qty: 4 }, { item: 'pine_log', qty: 1 }], 180),
      mk(`${t}_hatchet`, lv + 1, [{ item: bar, qty: 4 }, { item: 'pine_log', qty: 1 }], 180),
      mk(`${t}_skinning_knife`, lv - 1, [{ item: bar, qty: 2 }, { item: 'leather', qty: 1 }], 90, 3),
      mk(`${t}_sword`, lv, [{ item: bar, qty: 4 }, { item: 'leather', qty: 1 }], 180),
      mk(`${t}_mace`, lv + 1, [{ item: bar, qty: 4 }, { item: 'pine_log', qty: 1 }], 185),
      mk(`${t}_longsword`, lv + 4, [{ item: bar, qty: 8 }, { item: 'leather', qty: 1 }], 340, 5.5),
      mk(`${t}_battleaxe`, lv + 5, [{ item: bar, qty: 8 }, { item: 'pine_log', qty: 2 }], 360, 5.5),
    ];
  }),
  // Weapons from found plans: every metal, a little later than the longsword of that metal.
  ...(['warhammer', 'halberd', 'spear'] as const).flatMap((wpn): Recipe[] => (['stone', 'iron', 'steel', 'silversteel'] as const).map((t, i) => {
    const mat = i === 0 ? 'shaped_stone' : `${t}_bar`, wood = i === 0 ? 'birch_log' : 'pine_log';
    return { id: `${t}_${wpn}`, skill: 'smithing', station: 'anvil', level: [6, 15, 23, 33][i], plans: wpn,
      inputs: [{ item: mat, qty: 8 }, { item: wood, qty: wpn === 'warhammer' ? 1 : 2 }], output: { item: `${t}_${wpn}`, qty: 1 }, xp: [65, 200, 360, 790][i], seconds: 5 };
  })),
  // jewellery: silver, plain or with a gem set in it
  ...JEWELS.flatMap((j, i): Recipe[] => {
    const base = j.gem ? `${j.gem}_` : 'silver_', gem = j.gem ? [{ item: j.gem, qty: 1 }] : [];
    return [
      { id: `${base}ring`, skill: 'smithing', station: 'anvil', level: j.level ?? 19 + i * 3, inputs: [{ item: 'silver_bar', qty: 1 }, ...gem], output: { item: `${base}ring`, qty: 1 }, xp: 60 + i * 30, seconds: 3.5 },
      { id: `${base}necklace`, skill: 'smithing', station: 'anvil', level: (j.level ?? 19 + i * 3) + 2, inputs: [{ item: 'silver_bar', qty: 2 }, ...gem], output: { item: `${base}necklace`, qty: 1 }, xp: 100 + i * 40, seconds: 4 },
    ];
  }),
  // tailoring: spin and weave
  ...FIBRES.flatMap((f) => [
    { id: f.thread, skill: 'tailoring' as const, station: 'loom' as const, level: f.level, inputs: [{ item: f.raw, qty: 2 }], output: { item: f.thread, qty: 1 }, xp: f.xp, seconds: 1.6 },
    { id: f.cloth, skill: 'tailoring' as const, station: 'loom' as const, level: f.level + 1, inputs: [{ item: f.thread, qty: 2 }], output: { item: f.cloth, qty: 1 }, xp: f.xp * 2, seconds: 2.2 },
  ]),
  { id: 'spirit_silk', skill: 'tailoring', station: 'loom', level: 30, inputs: [{ item: 'bamboo_cloth', qty: 2 }, { item: 'wisp_essence', qty: 1 }], output: { item: 'spirit_silk', qty: 1 }, xp: 80, seconds: 3 },
  // alchemy: one vial each
  { id: 'healing_draught', skill: 'alchemy', station: 'alchemy', level: 1, inputs: [{ item: 'angelica', qty: 2 }, { item: 'vial', qty: 1 }], output: { item: 'healing_draught', qty: 1 }, xp: 12, seconds: 2.5 },
  { id: 'cloudberry_tonic', skill: 'alchemy', station: 'alchemy', level: 6, inputs: [{ item: 'cloudberry', qty: 2 }, { item: 'angelica', qty: 1 }, { item: 'vial', qty: 1 }], output: { item: 'cloudberry_tonic', qty: 1 }, xp: 24, seconds: 2.8 },
  { id: 'strength_elixir', skill: 'alchemy', station: 'alchemy', level: 12, inputs: [{ item: 'roseroot', qty: 2 }, { item: 'bat_wing', qty: 1 }, { item: 'vial', qty: 1 }], output: { item: 'strength_elixir', qty: 1 }, xp: 40, seconds: 3 },
  { id: 'mind_elixir', skill: 'alchemy', station: 'alchemy', level: 15, inputs: [{ item: 'roseroot', qty: 1 }, { item: 'wisp_essence', qty: 1 }, { item: 'vial', qty: 1 }], output: { item: 'mind_elixir', qty: 1 }, xp: 50, seconds: 3 },
  { id: 'warding_elixir', skill: 'alchemy', station: 'alchemy', level: 17, inputs: [{ item: 'cloudberry', qty: 2 }, { item: 'grave_dust', qty: 2 }, { item: 'vial', qty: 1 }], output: { item: 'warding_elixir', qty: 1 }, xp: 55, seconds: 3 },
  { id: 'grave_draught', skill: 'alchemy', station: 'alchemy', level: 20, inputs: [{ item: 'grave_moss', qty: 2 }, { item: 'grave_dust', qty: 1 }, { item: 'vial', qty: 1 }], output: { item: 'grave_draught', qty: 1 }, xp: 70, seconds: 3.2 },
  // leatherworking
  { id: 'leather', skill: 'leatherworking', station: 'tanning', level: 1, inputs: [{ item: 'wolf_pelt', qty: 1 }], output: { item: 'leather', qty: 1 }, xp: 8, seconds: 2.5 },
  { id: 'naga_leather', skill: 'leatherworking', station: 'tanning', level: 12, inputs: [{ item: 'naga_hide', qty: 1 }], output: { item: 'naga_leather', qty: 1 }, xp: 26, seconds: 2.9 },
  { id: 'cooked_crab', skill: 'cooking', station: ['campfire', 'stove'], level: 9, inputs: [{ item: 'raw_crab', qty: 1 }], output: { item: 'cooked_crab', qty: 1 }, xp: 22, seconds: 2.4, burns: true },
  // Salted and cured food: new kinds of buffs (not just bigger ones). Needs sea salt from Saltfjorden's pans.
  { id: 'rakfisk', skill: 'cooking', station: ['campfire', 'stove'], level: 8, inputs: [{ item: 'raw_trout', qty: 1 }, { item: 'salt', qty: 2 }], output: { item: 'rakfisk', qty: 1 }, xp: 22, seconds: 2.6 },
  { id: 'salted_herring', skill: 'cooking', station: ['campfire', 'stove'], level: 10, inputs: [{ item: 'raw_herring', qty: 1 }, { item: 'salt', qty: 2 }], output: { item: 'salted_herring', qty: 1 }, xp: 26, seconds: 2.6 },
  { id: 'gravlaks', skill: 'cooking', station: ['campfire', 'stove'], level: 13, inputs: [{ item: 'raw_char', qty: 1 }, { item: 'salt', qty: 2 }, { item: 'angelica', qty: 1 }], output: { item: 'gravlaks', qty: 1 }, xp: 34, seconds: 2.8 },
  { id: 'cured_crab', skill: 'cooking', station: ['campfire', 'stove'], level: 14, inputs: [{ item: 'raw_crab', qty: 1 }, { item: 'salt', qty: 3 }], output: { item: 'cured_crab', qty: 1 }, xp: 36, seconds: 2.8 },
  { id: 'lutefisk', skill: 'cooking', station: ['campfire', 'stove'], level: 18, inputs: [{ item: 'raw_cod', qty: 1 }, { item: 'salt', qty: 3 }], output: { item: 'lutefisk', qty: 1 }, xp: 46, seconds: 3 },
  { id: 'salt_halibut', skill: 'cooking', station: ['campfire', 'stove'], level: 24, inputs: [{ item: 'raw_halibut', qty: 1 }, { item: 'salt', qty: 4 }], output: { item: 'salt_halibut', qty: 1 }, xp: 64, seconds: 3.2 },
  { id: 'lynx_leather', skill: 'leatherworking', station: 'tanning', level: 17, inputs: [{ item: 'lynx_pelt', qty: 1 }], output: { item: 'lynx_leather', qty: 1 }, xp: 34, seconds: 3 },
  { id: 'goblin_leather', skill: 'leatherworking', station: 'tanning', level: 8, inputs: [{ item: 'goblin_skin', qty: 1 }], output: { item: 'goblin_leather', qty: 1 }, xp: 18, seconds: 2.8 },
  // carpentry
  { id: 'arrow_shaft', skill: 'carpentry', station: 'workbench', level: 1, inputs: [{ item: 'birch_log', qty: 1 }], output: { item: 'arrow_shaft', qty: 15 }, xp: 6, seconds: 2 },
  { id: 'stone_arrow', skill: 'carpentry', station: 'workbench', level: 1, inputs: [{ item: 'arrow_shaft', qty: 15 }, { item: 'stone_arrowheads', qty: 15 }], output: { item: 'stone_arrow', qty: 15 }, xp: 10, seconds: 2.5 },
  { id: 'steel_arrow', skill: 'carpentry', station: 'workbench', level: 18, inputs: [{ item: 'arrow_shaft', qty: 15 }, { item: 'steel_arrowheads', qty: 15 }], output: { item: 'steel_arrow', qty: 15 }, xp: 34, seconds: 2.5 },
  { id: 'iron_arrow', skill: 'carpentry', station: 'workbench', level: 10, inputs: [{ item: 'arrow_shaft', qty: 15 }, { item: 'iron_arrowheads', qty: 15 }], output: { item: 'iron_arrow', qty: 15 }, xp: 20, seconds: 2.5 },
  { id: 'birch_shortbow', skill: 'carpentry', station: 'workbench', level: 2, inputs: [{ item: 'birch_log', qty: 3 }], output: { item: 'birch_shortbow', qty: 1 }, xp: 30, seconds: 3 },
  { id: 'birch_staff', skill: 'carpentry', station: 'workbench', level: 4, inputs: [{ item: 'birch_log', qty: 4 }], output: { item: 'birch_staff', qty: 1 }, xp: 40, seconds: 3.5 },
  { id: 'birch_rod', skill: 'carpentry', station: 'workbench', level: 6, inputs: [{ item: 'birch_log', qty: 3 }], output: { item: 'birch_rod', qty: 1 }, xp: 45, seconds: 3 },
  { id: 'pine_longbow', skill: 'carpentry', station: 'workbench', level: 12, inputs: [{ item: 'pine_log', qty: 3 }, { item: 'birch_log', qty: 1 }], output: { item: 'pine_longbow', qty: 1 }, xp: 110, seconds: 4 },
  { id: 'pine_staff', skill: 'carpentry', station: 'workbench', level: 14, inputs: [{ item: 'pine_log', qty: 4 }], output: { item: 'pine_staff', qty: 1 }, xp: 120, seconds: 4 },
  { id: 'pine_rod', skill: 'carpentry', station: 'workbench', level: 16, inputs: [{ item: 'pine_log', qty: 3 }, { item: 'iron_bar', qty: 1 }], output: { item: 'pine_rod', qty: 1 }, xp: 130, seconds: 4 },
  // cooking
  { id: 'cooked_perch', skill: 'cooking', station: ['campfire', 'stove'], level: 1, inputs: [{ item: 'raw_perch', qty: 1 }], output: { item: 'cooked_perch', qty: 1 }, xp: 8, seconds: 2, burns: true },
  { id: 'cooked_trout', skill: 'cooking', station: ['campfire', 'stove'], level: 5, inputs: [{ item: 'raw_trout', qty: 1 }], output: { item: 'cooked_trout', qty: 1 }, xp: 15, seconds: 2.2, burns: true },
  { id: 'cooked_char', skill: 'cooking', station: ['campfire', 'stove'], level: 12, inputs: [{ item: 'raw_char', qty: 1 }], output: { item: 'cooked_char', qty: 1 }, xp: 25, seconds: 2.5, burns: true },
  { id: 'cooked_wolf_meat', skill: 'cooking', station: ['campfire', 'stove'], level: 3, inputs: [{ item: 'raw_wolf_meat', qty: 1 }], output: { item: 'cooked_wolf_meat', qty: 1 }, xp: 12, seconds: 2.4, burns: true },
  { id: 'cooked_herring', skill: 'cooking', station: ['campfire', 'stove'], level: 8, inputs: [{ item: 'raw_herring', qty: 1 }], output: { item: 'cooked_herring', qty: 1 }, xp: 20, seconds: 2.2, burns: true },
  { id: 'cooked_mackerel', skill: 'cooking', station: ['campfire', 'stove'], level: 12, inputs: [{ item: 'raw_mackerel', qty: 1 }], output: { item: 'cooked_mackerel', qty: 1 }, xp: 28, seconds: 2.4, burns: true },
  { id: 'cooked_cod', skill: 'cooking', station: ['campfire', 'stove'], level: 16, inputs: [{ item: 'raw_cod', qty: 1 }], output: { item: 'cooked_cod', qty: 1 }, xp: 36, seconds: 2.6, burns: true },
  { id: 'cooked_halibut', skill: 'cooking', station: ['campfire', 'stove'], level: 22, inputs: [{ item: 'raw_halibut', qty: 1 }], output: { item: 'cooked_halibut', qty: 1 }, xp: 50, seconds: 2.8, burns: true },
  { id: 'cooked_wolffish', skill: 'cooking', station: ['campfire', 'stove'], level: 28, inputs: [{ item: 'raw_wolffish', qty: 1 }], output: { item: 'cooked_wolffish', qty: 1 }, xp: 66, seconds: 3, burns: true },
  { id: 'cooked_pike', skill: 'cooking', station: ['campfire', 'stove'], level: 18, inputs: [{ item: 'raw_pike', qty: 1 }], output: { item: 'cooked_pike', qty: 1 }, xp: 38, seconds: 2.8, burns: true },
];
// Metal armour: stone uses shaped stone, iron uses bars (+ a little shaped stone), counts from the design doc.
for (const p of ARMOUR_PIECES) {
  const lvl = { helm: 3, pauldrons: 4, breastplate: 7, greaves: 5, gauntlets: 2, boots: 2, kite_shield: 6 }[p.piece] ?? 3;
  R.push({ id: `stone_${p.piece}`, skill: 'smithing', station: 'anvil', level: lvl, inputs: [{ item: 'shaped_stone', qty: p.bars }], output: { item: `stone_${p.piece}`, qty: 1 }, xp: p.bars * 8, seconds: 2 + p.bars * 0.2 });
  R.push({ id: `iron_${p.piece}`, skill: 'smithing', station: 'anvil', level: lvl + 9, inputs: [{ item: 'iron_bar', qty: p.bars }, { item: 'shaped_stone', qty: Math.ceil(p.bars / 6) }], output: { item: `iron_${p.piece}`, qty: 1 }, xp: p.bars * 25, seconds: 3 + p.bars * 0.2 });
  // Steel needs leather straps; silversteel is half steel, with silver bars worked in.
  R.push({ id: `steel_${p.piece}`, skill: 'smithing', station: 'anvil', level: lvl + 17, inputs: [{ item: 'steel_bar', qty: p.bars }, { item: 'leather', qty: Math.ceil(p.bars / 6) }], output: { item: `steel_${p.piece}`, qty: 1 }, xp: p.bars * 45, seconds: 3.5 + p.bars * 0.2 });
  R.push({ id: `silversteel_${p.piece}`, skill: 'smithing', station: 'anvil', level: lvl + 26, inputs: [{ item: 'silversteel_bar', qty: Math.ceil(p.bars / 2) }, { item: 'steel_bar', qty: Math.ceil(p.bars / 2) }, { item: 'goblin_leather', qty: Math.ceil(p.bars / 6) }], output: { item: `silversteel_${p.piece}`, qty: 1 }, xp: p.bars * 80, seconds: 4 + p.bars * 0.2 });
}
// Cloth armour (tailoring): each tier also takes one bolt of the tier below.
for (const p of ARMOUR_PIECES) {
  if (p.slot === 'offHand') continue;
  const n = { helm: 3, pauldrons: 3, breastplate: 6, greaves: 5, gauntlets: 2, boots: 2 }[p.piece] ?? 3;
  const lvl = { gauntlets: 1, boots: 1, helm: 2, pauldrons: 3, greaves: 4, breastplate: 5 }[p.piece] ?? 2;
  CLOTHS.forEach((c, i) => R.push({
    id: `${c.prefix}_${p.piece}`, skill: 'tailoring', station: 'loom', level: lvl + c.step,
    inputs: i === 0 ? [{ item: c.cloth, qty: n }] : [{ item: c.cloth, qty: n }, { item: CLOTHS[i - 1].cloth, qty: 1 }],
    output: { item: `${c.prefix}_${p.piece}`, qty: 1 }, xp: n * [14, 22, 32, 45, 60, 80][i], seconds: 2 + i * 0.25 + n * 0.3,
  }));
}
// Leather armour: wolf leather (tier 1) and goblinhide (tier 2, needs a little wolf leather too).
for (const p of ARMOUR_PIECES) {
  if (p.slot === 'offHand') continue;
  const n = { helm: 3, pauldrons: 3, breastplate: 6, greaves: 5, gauntlets: 2, boots: 2 }[p.piece] ?? 3;
  const lvl = { gauntlets: 1, boots: 1, helm: 2, pauldrons: 3, greaves: 4, breastplate: 5 }[p.piece] ?? 2;
  R.push({ id: `leather_${p.piece}`, skill: 'leatherworking', station: 'tanning', level: lvl, inputs: [{ item: 'leather', qty: n }], output: { item: `leather_${p.piece}`, qty: 1 }, xp: n * 14, seconds: 2 + n * 0.3 });
  R.push({ id: `nagahide_${p.piece}`, skill: 'leatherworking', station: 'tanning', level: lvl + 13, inputs: [{ item: 'naga_leather', qty: n }, { item: 'goblin_leather', qty: 1 }], output: { item: `nagahide_${p.piece}`, qty: 1 }, xp: n * 50, seconds: 2.8 + n * 0.3 });
  R.push({ id: `lynxhide_${p.piece}`, skill: 'leatherworking', station: 'tanning', level: lvl + 18, inputs: [{ item: 'lynx_leather', qty: n }, { item: 'goblin_leather', qty: 1 }], output: { item: `lynxhide_${p.piece}`, qty: 1 }, xp: n * 70, seconds: 3 + n * 0.3 });
  R.push({ id: `goblinhide_${p.piece}`, skill: 'leatherworking', station: 'tanning', level: lvl + 9, inputs: [{ item: 'goblin_leather', qty: n }, { item: 'leather', qty: 1 }], output: { item: `goblinhide_${p.piece}`, qty: 1 }, xp: n * 35, seconds: 2.5 + n * 0.3 });
}
export const RECIPES: Recipe[] = R;
export const RECIPE_BY_ID: Map<string, Recipe> = new Map(RECIPES.map((r) => [r.id, r]));
/** Tab a recipe sits under in the crafting menus: by material tier, or food type. */
export function recipeGroup(r: Recipe): string {
  const out = ITEMS[r.output.item];
  const ins = r.inputs.map((i) => ITEMS[i.item]);
  if (r.skill === 'cooking') return r.inputs.some((i) => i.item === 'salt') ? 'Salted & cured' : ins.some((d) => d?.kind === 'meat') ? 'Meat' : 'Fish';
  if (r.skill === 'carpentry' && (out.kind === 'ammo' || r.output.item === 'arrow_shaft')) return 'Arrows';
  if (r.skill === 'leatherworking') return out.look === 'goblin' ? 'Goblinhide' : out.look === 'naga' ? 'Nagahide' : out.look === 'lynx' ? 'Lynx' : 'Wolf leather';
  if (out.slot === 'ring' || out.slot === 'neck') return 'Jewellery';
  if (r.skill === 'alchemy') return ITEMS[r.output.item].potion?.heal ? 'Healing' : 'Elixirs';
  if (r.skill === 'tailoring') return ({ linen: 'Linen', jute: 'Jute', ramie: 'Ramie', cotton: 'Cotton', bamboo: 'Bamboo', silk: 'Spirit silk' } as Record<string, string>)[out.look ?? 'linen'] ?? 'Linen';
  const look = out.look ?? ins[0]?.look ?? 'stone';
  return look[0].toUpperCase() + look.slice(1);
}
export const recipeAt = (r: Recipe, k: StationKind) => (Array.isArray(r.station) ? r.station.includes(k) : r.station === k);
/** Gear (weapons, armour, tools) rolls a rarity when crafted. */
export const rollsRarity = (r: Recipe) => !!ITEMS[r.output.item]?.slot && ITEMS[r.output.item]?.kind !== 'ammo';

/** Burn chance for cooking: 40% at the recipe's level, −3% per level above, min 2%; stoves −5%. */
export function burnChance(level: number, recipeLevel: number, stove: boolean, bonus: number): number {
  return Math.max(0.02, 0.4 - 0.03 * (level - recipeLevel) - (stove ? 0.05 : 0) - bonus);
}
