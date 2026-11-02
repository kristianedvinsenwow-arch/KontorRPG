/**
 * The fishing trawler in Saltfjorden: a boat that sails a loop up and down the fjord all the time.
 * Rent a trip (15 minutes, once per clock hour) at the jetty and you ride on its deck with
 * everyone else who rented one, fishing as it goes: every ordinary fish comes up as two or three,
 * and the odds of anything rare or treasured are 2.5× better.
 *
 * Its position is a pure function of time, so the server (which moves the passengers) and every
 * client (which draws the boat) agree on where it is.
 */
import { FJORD, fjordMid, FJORD_PIER } from './terrain.js';

export const TRAWLER = {
  /** Gold for one trip. */
  price: 20,
  /** How long a trip lasts. */
  minutes: 15,
  /** Metres per second. */
  speed: 3.2,
  /** Deck height above the water. */
  deck: 1.15,
  /** Rare and treasure catches: this much likelier aboard. */
  rareMult: 2.5,
  /** Ordinary fish: this many per catch (min, max). */
  fishQty: [2, 3] as [number, number],
};

/** Where you board, on Saltfjorden's jetty (about halfway out). */
export const TRAWLER_BOARD = (() => {
  const P = FJORD_PIER, d = P.length * 0.5;
  return { x: P.x + P.ux * d, z: P.z + P.uz * d, r: 1.8 };
})();

/** The loop: down the fjord in the west lane, round the south end, back up the east lane, round the north end. */
const LANE = 9, NORTH = -28, SOUTH = 62;
const ROUTE: { x: number; z: number; s: number }[] = (() => {
  const pts: { x: number; z: number }[] = [];
  for (let lz = NORTH; lz <= SOUTH; lz += 1) pts.push({ x: FJORD.x + fjordMid(lz) - LANE, z: FJORD.z + lz });
  for (let a = Math.PI; a >= 0; a -= Math.PI / 24) pts.push({ x: FJORD.x + fjordMid(SOUTH) + Math.cos(a) * LANE, z: FJORD.z + SOUTH + Math.sin(a) * LANE });
  for (let lz = SOUTH; lz >= NORTH; lz -= 1) pts.push({ x: FJORD.x + fjordMid(lz) + LANE, z: FJORD.z + lz });
  for (let a = 0; a >= -Math.PI; a -= Math.PI / 24) pts.push({ x: FJORD.x + fjordMid(NORTH) + Math.cos(a) * LANE, z: FJORD.z + NORTH + Math.sin(a) * LANE });
  let s = 0;
  return pts.map((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); return { ...p, s }; });
})();
const LOOP = ROUTE[ROUTE.length - 1].s + Math.hypot(ROUTE[0].x - ROUTE[ROUTE.length - 1].x, ROUTE[0].z - ROUTE[ROUTE.length - 1].z);
export const TRAWLER_ROUTE = ROUTE;

/** Where the trawler is at time `t` (ms), and which way it faces (yaw: −Z forward, like players). */
export function trawlerAt(t: number): { x: number; z: number; yaw: number } {
  const s = ((t / 1000) * TRAWLER.speed) % LOOP;
  let i = 0;
  while (i < ROUTE.length - 1 && ROUTE[i + 1].s < s) i++;
  const a = ROUTE[i], b = ROUTE[(i + 1) % ROUTE.length];
  const len = (i + 1 < ROUTE.length ? b.s : LOOP) - a.s || 1;
  const k = Math.min(1, Math.max(0, (s - a.s) / len));
  const dx = b.x - a.x, dz = b.z - a.z;
  return { x: a.x + dx * k, z: a.z + dz * k, yaw: Math.atan2(-dx, -dz) };
}

/** Places on deck (boat-local: x to starboard, z towards the stern). Passengers beyond 10 share. */
export const TRAWLER_SEATS: [number, number][] = [
  [-1.1, -2.8], [1.1, -2.8], [-1.1, -1.6], [1.1, -1.6], [-1.1, -0.4], [1.1, -0.4], [-1.1, 0.8], [1.1, 0.8], [-0.4, -3.6], [0.4, -3.6],
];
export function trawlerSeat(t: number, seat: number): { x: number; y: number; z: number; yaw: number } {
  const b = trawlerAt(t), [sx, sz] = TRAWLER_SEATS[seat % TRAWLER_SEATS.length];
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  // Boat-local → world: rotate by yaw (same convention as a three.js Group's rotation.y).
  return { x: b.x + sx * c + sz * s, y: TRAWLER.deck, z: b.z - sx * s + sz * c, yaw: b.yaw };
}

/** Which clock hour a time is in: one trip per hour, resetting on the hour. */
export const trawlerHour = (t: number) => Math.floor(t / 3_600_000);
