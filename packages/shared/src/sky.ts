/**
 * Time of day and weather, worked out from the clock so every client (and the server) agrees
 * without sending anything over the network.
 *  - The sun follows the real sun over Oslo (59.9° N, 10.75° E): long summer evenings, short
 *    winter days. Night is dim but playable (moonlight).
 *  - Weather changes every 20 minutes per region, from a seeded roll, blending over a few minutes:
 *    clear, cloudy, rain, fog — and snow instead of rain up in Gruben.
 */
import type { Region } from './cave.js';

const LAT = 59.91 * (Math.PI / 180), LON = 10.75;

/** Sun direction (unit vector, +Y up, −Z north... in world terms: x east, z south) and elevation (radians). */
export function sunAt(ms: number): { x: number; y: number; z: number; elevation: number } {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = ((357.529 + 0.98560028 * d) % 360) * (Math.PI / 180);
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const e = (23.439 - 0.00000036 * d) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lst = ((gmst + LON / 15) % 24) * 15 * (Math.PI / 180);
  const ha = lst - ra;
  const elevation = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha));
  // Azimuth from north, clockwise.
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(ha));
  const ce = Math.cos(elevation);
  // World axes: +x east, −z north (the map has north up at −z).
  return { x: Math.sin(az) * ce, y: Math.sin(elevation), z: -Math.cos(az) * ce, elevation };
}

/** 0 at night, 1 in full day, smooth through dusk and dawn. */
export function daylight(ms: number): number {
  const s = sunAt(ms).y;
  const t = Math.min(1, Math.max(0, (s + 0.1) / 0.32));
  return t * t * (3 - 2 * t);
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow';
export interface Weather {
  kind: WeatherKind;
  /** 0..1: how strongly it's happening (rises and falls at the edges of a weather spell). */
  k: number;
  /** Cloud cover 0..1 (dims the sun), fog 0..1 (pulls the fog in), rain/snow 0..1 (particles). */
  cloud: number; fog: number; rain: number; snow: number;
}

const SLOT_MS = 20 * 60_000;
const BLEND_MS = 3 * 60_000;

function roll(region: Region, slot: number): WeatherKind {
  let h = (slot * 2654435761 + (region === 'gruben' ? 97 : 13)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  if (region === 'gruben') return r < 0.25 ? 'clear' : r < 0.5 ? 'cloudy' : r < 0.72 ? 'snow' : 'fog';
  return r < 0.45 ? 'clear' : r < 0.7 ? 'cloudy' : r < 0.87 ? 'rain' : 'fog';
}

const MIX: Record<WeatherKind, [number, number, number, number]> = {
  // cloud, fog, rain, snow
  clear: [0, 0, 0, 0],
  cloudy: [0.6, 0.15, 0, 0],
  rain: [0.85, 0.35, 1, 0],
  fog: [0.5, 1, 0, 0],
  snow: [0.75, 0.45, 0, 1],
};

export function weatherAt(region: Region, ms: number): Weather {
  if (region === 'cave') return { kind: 'clear', k: 0, cloud: 0, fog: 0, rain: 0, snow: 0 };
  const slot = Math.floor(ms / SLOT_MS), into = ms - slot * SLOT_MS;
  const now = roll(region, slot), prev = roll(region, slot - 1);
  const t = Math.min(1, into / BLEND_MS);
  const a = MIX[prev], b = MIX[now];
  const m = a.map((v, i) => v + (b[i] - v) * t);
  return { kind: now, k: t, cloud: m[0], fog: m[1], rain: m[2], snow: m[3] };
}

export const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', snow: 'Snow' };
