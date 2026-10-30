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

/** Where the spike's lake sits (south-west of spawn). */
export const LAKE = { x: -62, z: 58, r: 34, depth: 7 };

/** Ground height in metres at world position (x, z). */
export function heightAt(x: number, z: number): number {
  // Rolling hills.
  let h = (fbm(x / 70, z / 70) - 0.42) * 18 + (fbm(x / 22 + 40, z / 22 - 17, 3) - 0.5) * 3;
  h += 3;

  // Flat clearing around spawn (future camp / waystone).
  const dSpawn = Math.hypot(x, z);
  h = h + (2.2 - h) * (1 - smooth(14, 30, dSpawn));

  // Lake basin.
  const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
  h -= LAKE.depth * (1 - smooth(LAKE.r * 0.35, LAKE.r, dLake));

  // Mountains rise at the edge of the spike area so nobody walks off the world.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smooth(WORLD_HALF - 40, WORLD_HALF - 4, edge) * 26;

  return h;
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
