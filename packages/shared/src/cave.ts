/**
 * The Old Mine: an underground area. The heightmap world can't have real caves, so the cave lives
 * in its own region far outside the overworld (around CAVE.x, CAVE.z). An entrance in the hills
 * teleports you there; the exit brings you back. Shape = corridors (capsules) + chambers (circles).
 */
import { heightAt, pierDeck } from './terrain.js';
import { WORLD_HALF } from './constants.js';

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

/** Is (x, z) in the cave's region at all (as opposed to the overworld)? */
export const inCaveRegion = (x: number, z: number) => Math.abs(x - CAVE.x) < 200 && Math.abs(z - CAVE.z) < 200;

/** How far inside the walkable cave a point is (positive = inside, metres to the nearest wall). */
export function caveClearance(x: number, z: number): number {
  const lx = x - CAVE.x, lz = z - CAVE.z;
  let best = -Infinity;
  for (const [a, b, w] of CAVE_TUNNELS) best = Math.max(best, w / 2 - distSeg(lx, lz, a, b));
  for (const r of CAVE_ROOMS) best = Math.max(best, r.r - Math.hypot(lx - r.c[0], lz - r.c[1]));
  return best;
}

/** Cave floor: gentle bumps, sloping down the deeper you go. */
export function caveFloor(x: number, z: number): number {
  const lz = z - CAVE.z;
  return -0.04 * Math.max(0, -lz) + Math.sin(x * 0.7) * 0.08 + Math.cos(z * 0.6) * 0.08;
}

/** Ground height anywhere: overworld terrain or cave floor. */
export function groundAt(x: number, z: number): number {
  if (inCaveRegion(x, z)) return caveFloor(x, z);
  const h = heightAt(x, z), deck = pierDeck(x, z);
  return deck != null ? Math.max(h, deck) : h;
}

/** Can a player stand here? Overworld bounds or inside the cave. */
export function walkable(x: number, z: number, margin = 0.35): boolean {
  if (inCaveRegion(x, z)) return caveClearance(x, z) > margin - 0.2;
  const lim = WORLD_HALF - margin - 0.5;
  return Math.abs(x) <= lim && Math.abs(z) <= lim;
}

export const caveRoomCentre = (i: number) => ({ x: CAVE.x + CAVE_ROOMS[i].c[0], z: CAVE.z + CAVE_ROOMS[i].c[1] });
