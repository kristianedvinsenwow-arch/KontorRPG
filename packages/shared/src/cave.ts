/**
 * The Old Mine: an underground area. The heightmap world can't have real caves, so the cave lives
 * in its own region far outside the overworld (around CAVE.x, CAVE.z). An entrance in the hills
 * teleports you there; the exit brings you back. Shape = corridors (capsules) + chambers (circles).
 */
import { heightAt, pierDeck, GRUBEN, inGruben, FJORD, FJORD_SPOTS, inFjord, BOAT_HOME, BOAT_FJORD } from './terrain.js';
import { CHUNK_SIZE, WORLD_HALF } from './constants.js';
import { houseFloor } from './houses.js';

export const CAVE = { x: 0, z: 1000 };
/** Overworld entrance (a rock arch in the north-eastern hills) and where you appear on leaving. */
export const CAVE_ENTRANCE = { x: 50, z: -78, r: 2.5 };
export const CAVE_EXIT_OUT = { x: 47.5, z: -74.5 };
/** Where you appear inside, and the exit marker beside it. */
export const CAVE_START = { x: CAVE.x, z: CAVE.z + 2 };
export const CAVE_EXIT = { x: CAVE.x, z: CAVE.z + 5.5, r: 2 };

type P = [number, number];
/** Corridors: from, to, width (local coordinates). */
export const CAVE_TUNNELS: [P, P, number][] = [
  [[0, 6], [0, -18], 5],
  [[0, -18], [13, -32], 4.5],
  [[13, -32], [24, -52], 4],
  [[13, -32], [-4, -52], 4.5],
  [[-4, -52], [-10, -68], 4.5],
];
/** Chambers: centre, radius, name. */
export const CAVE_ROOMS: { c: P; r: number; name: string }[] = [
  { c: [0, 2], r: 6, name: 'Entrance hall' },
  { c: [14, -36], r: 9, name: 'Silver gallery' },
  { c: [25, -57], r: 7, name: 'Bat roost' },
  { c: [-10, -80], r: 11, name: "Knut's hall" },
];

const distSeg = (px: number, pz: number, a: P, b: P) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
};

/**
 * Sjøgrotta, the Sea Grotto: a flooded cavern under Saltfjorden's north-eastern hills (levels
 * 14–17), with glowing pools to fish, ore in the walls, and the Kraken's lair at the bottom.
 * Its own patch of the underground region, well away from the Old Mine.
 */
export const GROTTO = { x: 400, z: 1000 };
export const GROTTO_TUNNELS: [P, P, number][] = [
  [[0, 6], [0, -10], 5],
  [[0, -10], [-16, -24], 4.5],
  [[0, -10], [17, -30], 4.5],
  [[-16, -24], [-2, -50], 4.5],
  [[17, -30], [-2, -50], 4],
  [[-2, -50], [0, -70], 5],
];
export const GROTTO_ROOMS: { c: P; r: number; name: string }[] = [
  { c: [0, 2], r: 7, name: 'Tide mouth' },
  { c: [-17, -25], r: 11, name: 'Glow pools' },
  { c: [18, -32], r: 10, name: 'Crab hollow' },
  { c: [-2, -52], r: 10, name: 'Drowned gallery' },
  { c: [0, -86], r: 17, name: 'The Kraken’s lair' },
];
/** Water you can't walk on, only fish (local centre, radius): the glowing pools, and the lair's. */
export const GROTTO_POOLS: { c: P; r: number }[] = [
  { c: [-21, -29], r: 4.2 }, { c: [-12, -19], r: 2.6 },
  { c: [0, -88], r: 4 },
];
/** The gate into the lair (local): an arch across the last tunnel. */
export const GROTTO_GATE = { x: GROTTO.x + 0, z: GROTTO.z - 68 };
/** Where the lair starts (local z): everything deeper counts as the boss's room. */
export const GROTTO_LAIR_Z = -69;

/** Which underground place (x, z) is in, if any. */
export type CaveId = 'mine' | 'grotto';
export const caveAt = (x: number, z: number): CaveId | null =>
  Math.abs(z - CAVE.z) >= 200 ? null : Math.abs(x - CAVE.x) < 200 ? 'mine' : Math.abs(x - GROTTO.x) < 200 ? 'grotto' : null;

/** Is (x, z) underground at all (the Old Mine or the Sea Grotto), as opposed to the overworld? */
export const inCaveRegion = (x: number, z: number) => caveAt(x, z) !== null;

/** How far inside the walkable cave a point is (positive = inside, metres to the nearest wall). */
export function caveClearance(x: number, z: number): number {
  const grotto = caveAt(x, z) === 'grotto';
  const O = grotto ? GROTTO : CAVE, lx = x - O.x, lz = z - O.z;
  let best = -Infinity;
  for (const [a, b, w] of grotto ? GROTTO_TUNNELS : CAVE_TUNNELS) best = Math.max(best, w / 2 - distSeg(lx, lz, a, b));
  for (const r of grotto ? GROTTO_ROOMS : CAVE_ROOMS) best = Math.max(best, r.r - Math.hypot(lx - r.c[0], lz - r.c[1]));
  // The pools are water: not walkable (you fish them from the edge).
  if (grotto) for (const p of GROTTO_POOLS) best = Math.min(best, Math.hypot(lx - p.c[0], lz - p.c[1]) - p.r);
  return best;
}

/** In one of the grotto's pools (for fishing). */
export const inGrottoPool = (x: number, z: number) => caveAt(x, z) === 'grotto' && GROTTO_POOLS.some((p) => Math.hypot(x - GROTTO.x - p.c[0], z - GROTTO.z - p.c[1]) < p.r);

/** Cave floor: gentle bumps, sloping down the deeper you go. */
export function caveFloor(x: number, z: number): number {
  const lz = z - CAVE.z;
  if (caveAt(x, z) === 'grotto') return -0.03 * Math.max(0, -lz) + Math.sin(x * 0.5 + z * 0.2) * 0.12 + Math.cos(z * 0.45) * 0.1;
  return -0.04 * Math.max(0, -lz) + Math.sin(x * 0.7) * 0.08 + Math.cos(z * 0.6) * 0.08;
}

/** Ground height anywhere: overworld terrain or cave floor. */
export function groundAt(x: number, z: number): number {
  if (inCaveRegion(x, z)) return caveFloor(x, z);
  const h = heightAt(x, z), deck = pierDeck(x, z), floor = houseFloor(x, z);
  return Math.max(h, deck ?? -Infinity, floor ?? -Infinity);
}

/** Can a player stand here? Overworld bounds or inside the cave. */
export function walkable(x: number, z: number, margin = 0.35): boolean {
  if (inCaveRegion(x, z)) return caveClearance(x, z) > margin - 0.2;
  if (inGruben(x, z)) {
    const lim = GRUBEN.half - margin - 0.5;
    return Math.abs(x - GRUBEN.x) <= lim && Math.abs(z - GRUBEN.z) <= lim;
  }
  if (inFjord(x, z)) {
    const lim = FJORD.half - margin - 0.5;
    return Math.abs(x - FJORD.x) <= lim && Math.abs(z - FJORD.z) <= lim;
  }
  const lim = WORLD_HALF - margin - 0.5;
  return Math.abs(x) <= lim && Math.abs(z) <= lim;
}

/** Which chunks have terrain: the home valley, and Gruben. [minX, maxX, minZ, maxZ] inclusive. */
export const CHUNK_RANGES: [number, number, number, number][] = [
  [-Math.ceil(WORLD_HALF / CHUNK_SIZE), Math.ceil(WORLD_HALF / CHUNK_SIZE) - 1, -Math.ceil(WORLD_HALF / CHUNK_SIZE), Math.ceil(WORLD_HALF / CHUNK_SIZE) - 1],
  [Math.floor((FJORD.x - FJORD.half) / CHUNK_SIZE), Math.ceil((FJORD.x + FJORD.half) / CHUNK_SIZE) - 1, Math.floor((FJORD.z - FJORD.half) / CHUNK_SIZE), Math.ceil((FJORD.z + FJORD.half) / CHUNK_SIZE) - 1],
  [Math.floor((GRUBEN.x - GRUBEN.half) / CHUNK_SIZE), Math.ceil((GRUBEN.x + GRUBEN.half) / CHUNK_SIZE) - 1, Math.floor((GRUBEN.z - GRUBEN.half) / CHUNK_SIZE), Math.ceil((GRUBEN.z + GRUBEN.half) / CHUNK_SIZE) - 1],
];
export const chunkExists = (cx: number, cz: number) => CHUNK_RANGES.some(([a, b, c, d]) => cx >= a && cx <= b && cz >= c && cz <= d);
/** Inside the playable part of an outdoor region (with a margin from its edge). */
export function inBounds(x: number, z: number, margin = 3): boolean {
  if (inGruben(x, z)) return Math.abs(x - GRUBEN.x) < GRUBEN.half - margin && Math.abs(z - GRUBEN.z) < GRUBEN.half - margin;
  if (inFjord(x, z)) return Math.abs(x - FJORD.x) < FJORD.half - margin && Math.abs(z - FJORD.z) < FJORD.half - margin;
  return Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin;
}
/** Which region a point is in, for the map, music and mood. */
export type Region = 'valley' | 'cave' | 'gruben' | 'fjord';
export const regionAt = (x: number, z: number): Region => (inCaveRegion(x, z) ? 'cave' : inGruben(x, z) ? 'gruben' : inFjord(x, z) ? 'fjord' : 'valley');

/**
 * Walk-in portals between regions: step into `at` and you appear at `to`.
 * The Gruben pass is in the eastern mountains past the wolf pack.
 */
/** `level` is only a recommendation (shown as a warning); anyone can walk through. */
/** `use`: taken with E (a rowboat) instead of by walking in. */
export interface Portal { id: string; name: string; at: { x: number; z: number; r: number }; to: { x: number; z: number }; level?: number; use?: boolean }
export const GRUBEN_PASS = { x: 99, z: 49.5, r: 2.6 };
/** Sjøgrotta's mouth, in Saltfjorden's north-eastern hills, and where you come back out. */
export const GROTTO_ENTRANCE = { x: FJORD.x + FJORD_SPOTS.grotto.x, z: FJORD.z + FJORD_SPOTS.grotto.z - 1.5, r: 2.4 };
export const GROTTO_EXIT_OUT = { x: FJORD.x + FJORD_SPOTS.grotto.x, z: FJORD.z + FJORD_SPOTS.grotto.z + 3.5 };
/** Rowboats at the end of Bjørkvik's pier and Saltfjorden's jetty: press E to row across. */
const step = (p: { x: number; z: number }, dx: number, dz: number) => ({ x: p.x + dx, z: p.z + dz });
export const PORTALS: Portal[] = [
  { id: 'cave', name: 'The Old Mine', at: CAVE_ENTRANCE, to: CAVE_START },
  { id: 'cave_out', name: 'Out of the mine', at: CAVE_EXIT, to: CAVE_EXIT_OUT },
  { id: 'gruben', name: 'The pass to Gruben', at: GRUBEN_PASS, to: { x: GRUBEN.x, z: GRUBEN.z + 58 }, level: 12 },
  { id: 'fjord', name: 'Rowboat to Saltfjorden', at: { ...BOAT_HOME, r: 2 }, to: step(BOAT_FJORD, 1.5, 0), use: true },
  { id: 'fjord_out', name: 'Rowboat to Bjørkvik', at: { ...BOAT_FJORD, r: 2 }, to: BOAT_HOME, use: true },
  { id: 'grotto', name: 'Sjøgrotta', at: GROTTO_ENTRANCE, to: { x: GROTTO.x, z: GROTTO.z + 2 }, level: 14 },
  { id: 'grotto_out', name: 'Out of the grotto', at: { x: GROTTO.x, z: GROTTO.z + 6.5, r: 2 }, to: GROTTO_EXIT_OUT },
  { id: 'gruben_out', name: 'Back to the valley', at: { x: GRUBEN.x, z: GRUBEN.z + 64, r: 2.6 }, to: { x: GRUBEN_PASS.x - 4.5, z: GRUBEN_PASS.z - 2.5 } },
];
export const PORTAL_BY_ID: Map<string, Portal> = new Map(PORTALS.map((p) => [p.id, p]));

export const caveRoomCentre = (i: number) => ({ x: CAVE.x + CAVE_ROOMS[i].c[0], z: CAVE.z + CAVE_ROOMS[i].c[1] });
export const grottoRoomCentre = (i: number) => ({ x: GROTTO.x + GROTTO_ROOMS[i].c[0], z: GROTTO.z + GROTTO_ROOMS[i].c[1] });
