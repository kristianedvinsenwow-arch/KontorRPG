/**
 * Rentable houses (cottages on Bjørkvik's green, miners' huts at Gruben camp): where they stand,
 * which way they face, their floor height and what's inside. Kept apart from world.ts so ground
 * height (cave.ts) can include house floors without an import cycle.
 *
 * Local frame: origin at the house centre, −Z towards the door (the yard it faces), +X to the
 * right as you walk in... mirrored, but consistent everywhere via toWorld / toLocal.
 */
import { GRUBEN, VILLAGE, heightAt } from './terrain.js';

export type HouseKind = 'cottage' | 'hut';
export interface HouseFrame {
  id: number; kind: HouseKind; name: string;
  x: number; z: number; ry: number;
  /** Width (local X) and depth (local Z) of the inside. */
  w: number; d: number;
  /** Floor height: the highest ground under the footprint (the rest gets a stone plinth). */
  floor: number;
  /** Door opening width. */
  doorW: number;
  /** Furniture positions (local). */
  bed: { x: number; z: number }; chest: { x: number; z: number }; hearth: { x: number; z: number }; table?: { x: number; z: number };
}

export function toWorld(f: Pick<HouseFrame, 'x' | 'z' | 'ry'>, lx: number, lz: number) {
  const c = Math.cos(f.ry), s = Math.sin(f.ry);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}
export function toLocal(f: Pick<HouseFrame, 'x' | 'z' | 'ry'>, x: number, z: number) {
  const c = Math.cos(f.ry), s = Math.sin(f.ry), dx = x - f.x, dz = z - f.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function frame(id: number, kind: HouseKind, name: string, x: number, z: number, faceX: number, faceZ: number): HouseFrame {
  const ry = Math.atan2(faceX - x, faceZ - z) + Math.PI;
  const [w, d] = kind === 'cottage' ? [5, 4] : [4, 3.4];
  const c = Math.cos(ry), s = Math.sin(ry);
  let floor = -Infinity;
  for (const lx of [-w / 2 - 0.2, 0, w / 2 + 0.2]) for (const lz of [-d / 2 - 0.2, 0, d / 2 + 0.2]) floor = Math.max(floor, heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
  return kind === 'cottage'
    ? { id, kind, name, x, z, ry, w, d, floor, doorW: 1.1, bed: { x: -w / 2 + 0.7, z: d / 2 - 1.1 }, chest: { x: -w / 2 + 0.7, z: d / 2 - 2.45 }, hearth: { x: w / 2 - 0.65, z: d / 2 - 0.55 }, table: { x: w / 2 - 1.5, z: -0.35 } }
    : { id, kind, name, x, z, ry, w, d, floor, doorW: 1.0, bed: { x: -w / 2 + 0.65, z: d / 2 - 1.1 }, chest: { x: w / 2 - 0.55, z: -0.2 }, hearth: { x: w / 2 - 0.6, z: d / 2 - 0.55 } };
}

const V = VILLAGE, G = GRUBEN;
export const HOUSES: HouseFrame[] = [
  frame(8, 'cottage', 'Green cottage', V.x + 17, V.z - 4, V.x, V.z),
  frame(9, 'cottage', 'Brook cottage', V.x + 17, V.z + 12, V.x, V.z),
  frame(10, 'cottage', 'Lakeview cottage', V.x + 8, V.z + 17, V.x, V.z),
  frame(11, 'hut', 'East miners’ hut', G.x + 13, G.z + 59, G.x, G.z + 54),
  frame(12, 'hut', 'West miners’ hut', G.x - 12, G.z + 47, G.x, G.z + 54),
];

/** The house whose inside (between its walls) contains (x, z), if any. */
export function houseAt(x: number, z: number, margin = 0): HouseFrame | undefined {
  for (const h of HOUSES) {
    if (Math.abs(x - h.x) > 6 || Math.abs(z - h.z) > 6) continue;
    const l = toLocal(h, x, z);
    if (Math.abs(l.x) < h.w / 2 + margin && Math.abs(l.z) < h.d / 2 + margin) return h;
  }
  return undefined;
}

/** Floor height if (x, z) is on a house's floor (walls included), else null. */
export function houseFloor(x: number, z: number): number | null {
  const h = houseAt(x, z, 0.35);
  return h ? h.floor : null;
}
