/**
 * Deterministic terrain height. Client and server call the same function, so the server can
 * validate a player's height without shipping a heightmap, and every client builds identical chunks.
 * M0 spike: a patch of "Mofjellet" — rolling hills, a flat clearing at spawn, a small lake, and
 * steep slopes at the edge of the spike area that act as a natural wall.
 */
import { WORLD_HALF } from './constants.js';

const SEED = 1337;

/** Integer hash → [0, 1). Stable across JS engines (only 32-bit integer math). */
export function hash2(ix: number, iz: number, seed = SEED): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, z * freq, SEED + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // 0..1
}

/** Bjørkvik, the first settlement: inn, campfire, workbench, a few villagers. */
export const VILLAGE = { x: -28, z: 38, r: 21, h: 2.0 };

/**
 * Ulvedalen ("wolf valley"): a small sheltered hollow in the west, ringed by hills and open to
 * the east, with a few veins and a wolf pack. A second place to mine close to home.
 */
export const ULVEDAL = { x: -80, z: -14, r: 15, h: 3.5 };

/** Where the spike's lake sits (south-west of spawn). */
export const LAKE = { x: -62, z: 58, r: 34, depth: 7 };

/**
 * Gruben: the second region, an old mining valley beyond the eastern pass. It lives in its own
 * patch of the map (3 × 3 chunks around GRUBEN.x/z), reached through the pass (see regions.ts).
 * Local layout: you arrive at the south end; the Mine King's pit is at the north end.
 */
export const GRUBEN = { x: 1056, z: -32, half: 96, name: 'Gruben' };
/** Points of interest in Gruben, local to its centre. */
export const GRUBEN_SPOTS = {
  arrival: { x: 0, z: 54, r: 12, h: 9 },
  pit: { x: 0, z: -58, r: 15, h: 4 },
  village: { x: 44, z: 14, r: 13, h: 9.5 },
};
export const inGruben = (x: number, z: number) => Math.abs(x - GRUBEN.x) < GRUBEN.half + 60 && Math.abs(z - GRUBEN.z) < GRUBEN.half + 60;

function grubenHeight(x: number, z: number): number {
  const lx = x - GRUBEN.x, lz = z - GRUBEN.z;
  // A valley running north–south: low in the middle, rising to the sides.
  let h = 7 + (fbm(x / 46, z / 46) - 0.45) * 16 + (fbm(x / 15 + 9, z / 15 - 3, 3) - 0.5) * 2.5;
  h += Math.max(0, Math.abs(lx) - 30) * 0.12;
  for (const p of Object.values(GRUBEN_SPOTS)) h = h + (p.h - h) * (1 - smooth(p.r, p.r + 12, Math.hypot(lx - p.x, lz - p.z)));
  // The pit is a bowl, a little lower in the middle.
  h -= 2 * (1 - smooth(0, GRUBEN_SPOTS.pit.r, Math.hypot(lx - GRUBEN_SPOTS.pit.x, lz - GRUBEN_SPOTS.pit.z)));
  const edge = Math.max(Math.abs(lx), Math.abs(lz));
  h += smooth(GRUBEN.half - 30, GRUBEN.half - 4, edge) * 30;
  return Math.max(1, h);
}

/**
 * Saltfjorden: the third region, a sea inlet over the western road. Steep rocky shores either
 * side of deep salt water that widens to the south; a fishing village on the east shore.
 * Local layout: you arrive at the north-east; the village is mid-way down the east shore.
 */
export const FJORD = { x: -1056, z: 0, half: 96, name: 'Saltfjorden' };
export const FJORD_SPOTS = {
  arrival: { x: 44, z: -66, r: 9, h: 5 },
  village: { x: 34, z: 8, r: 12, h: 2.4 },
};
export const inFjord = (x: number, z: number) => Math.abs(x - FJORD.x) < FJORD.half + 60 && Math.abs(z - FJORD.z) < FJORD.half + 60;
/** Where the fjord's channel runs (local x of its middle) at local z. */
export const fjordMid = (lz: number) => Math.sin(lz / 40) * 10 - 6;

function fjordHeight(x: number, z: number): number {
  const lx = x - FJORD.x, lz = z - FJORD.z;
  // Distance from the channel; the channel widens towards the open sea in the south.
  const d = Math.abs(lx - fjordMid(lz)) * (1 - 0.45 * smooth(20, 90, lz));
  let h = -9 + smooth(15, 32, d) * 14 + (fbm(x / 30, z / 30) - 0.5) * 4;
  h += Math.max(0, d - 40) * 0.4 + (fbm(x / 14 + 3, z / 14, 3) - 0.5) * 2 * smooth(30, 45, d);
  for (const p of Object.values(FJORD_SPOTS)) h = h + (p.h - h) * (1 - smooth(p.r, p.r + 10, Math.hypot(lx - p.x, lz - p.z)));
  const edge = Math.max(Math.abs(lx), Math.abs(lz));
  h += smooth(FJORD.half - 30, FJORD.half - 4, edge) * 30;
  return h;
}

/** Ground height in metres at world position (x, z). */
export function heightAt(x: number, z: number): number {
  if (x > 600) return grubenHeight(x, z);
  if (x < -600) return fjordHeight(x, z);
  // Rolling hills.
  let h = (fbm(x / 70, z / 70) - 0.42) * 18 + (fbm(x / 22 + 40, z / 22 - 17, 3) - 0.5) * 3;
  h += 3;

  // Flat clearing around spawn (future camp / waystone).
  const dSpawn = Math.hypot(x, z);
  h = h + (2.2 - h) * (1 - smooth(14, 30, dSpawn));

  // Flat ground for Bjørkvik, the lakeside village.
  const dVillage = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  h = h + (VILLAGE.h - h) * (1 - smooth(VILLAGE.r, VILLAGE.r + 12, dVillage));

  // Lake basin.
  const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
  h -= LAKE.depth * (1 - smooth(LAKE.r * 0.35, LAKE.r, dLake));

  // Ulvedalen: hills ringing a flat floor, with the mouth of the valley facing east.
  const ux = x - ULVEDAL.x, uz = z - ULVEDAL.z, dU = Math.hypot(ux, uz);
  if (dU < ULVEDAL.r + 22) {
    const mouth = smooth(0.45, 0.85, dU > 0.01 ? ux / dU : 0); // 1 = facing east
    h += 8 * smooth(ULVEDAL.r - 3, ULVEDAL.r + 4, dU) * (1 - smooth(ULVEDAL.r + 6, ULVEDAL.r + 20, dU)) * (1 - mouth * 0.9);
    h = h + (ULVEDAL.h - h) * (1 - smooth(ULVEDAL.r - 4, ULVEDAL.r + 2, dU));
  }

  // Mountains rise at the edge of the spike area so nobody walks off the world.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smooth(WORLD_HALF - 40, WORLD_HALF - 4, edge) * 26;

  return h;
}

/**
 * Bjørkvik's fishing pier: a timber deck running from the shore out into the lake, on the line from
 * the village to the lake's middle. It's walkable ground (see groundAt) and you fish off its end.
 */
export const PIER = (() => {
  const dx = LAKE.x - VILLAGE.x, dz = LAKE.z - VILLAGE.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  let d = 0;
  while (d < len && heightAt(VILLAGE.x + ux * d, VILLAGE.z + uz * d) > 0.45) d += 0.5;
  const sx = VILLAGE.x + ux * (d - 3), sz = VILLAGE.z + uz * (d - 3);
  return { x: sx, z: sz, ux, uz, length: 17, width: 2.8, deck: 0.75 };
})();

/** Saltfjorden's jetty: from the village shore out west into the fjord. */
export const FJORD_PIER = (() => {
  const lz = FJORD_SPOTS.village.z - 4, z = FJORD.z + lz;
  let x = FJORD.x + FJORD_SPOTS.village.x;
  while (fjordHeight(x, z) > 0.45 && x > FJORD.x - 40) x -= 0.5;
  return { x: x + 1.5, z, ux: -1, uz: 0, length: 11, width: 2.4, deck: 0.75 };
})();
/** Where the rowboats tie up: the far end of each pier, on the deck. */
const pierEnd = (P: { x: number; z: number; ux: number; uz: number; length: number }) => ({ x: P.x + P.ux * (P.length - 0.8), z: P.z + P.uz * (P.length - 0.8) });
export const BOAT_HOME = pierEnd(PIER);
export const BOAT_FJORD = pierEnd(FJORD_PIER);

/** Deck height if (x, z) is on a pier (Bjørkvik's or Saltfjorden's jetty), else null. */
export function pierDeck(x: number, z: number): number | null {
  for (const P of [PIER, FJORD_PIER]) {
    const px = x - P.x, pz = z - P.z;
    const along = px * P.ux + pz * P.uz, side = -px * P.uz + pz * P.ux;
    if (along >= 0 && along <= P.length && Math.abs(side) <= P.width / 2) return P.deck;
  }
  return null;
}

/** Small deterministic random generator for placing props per chunk. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
