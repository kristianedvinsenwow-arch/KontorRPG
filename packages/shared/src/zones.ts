/**
 * The world plan: which zones exist (and which are still to come), in what order you reach them,
 * and how they connect. The world map's overview (right click on the map) is drawn from this.
 *
 *   ┌───────────────────────────────┐
 *   │ 6  the far north (largest)     │
 *   ├─────────┬─────────┬───────────┤
 *   │ 2 Salt- │ 1 Mof-  │ 3 Gruben  │      1 → 2 by rowboat (Bjørkvik pier), 1 → 3 over the pass,
 *   │  fjorden│  fjellet│           │      3 → 5 down out of Gruben, 5 → 4 west, 4 → 2 north.
 *   ├─────────┼─────────┴───────────┤
 *   │ 4       │ 5  the southlands     │
 *   └─────────┴─────────────────────┘
 *
 * Zones 4–6 are planned, not built. 5 and 6 are meant to be bigger than the others (in world
 * terms: a half-size of ~160–190 m against 96–128 m), placed south (+z) and north (−z) of the row
 * of existing zones.
 */
import type { Region } from './cave.js';

export interface ZonePlan {
  id: string;
  /** The order you're meant to reach them in (1 = the start). */
  tier: number;
  name: string;
  /** The built region it maps to; none = still to come. */
  region?: Exclude<Region, 'cave'>;
  /** Placement on the overview grid (3 columns × 3 rows), and its size in cells. */
  col: number; row: number; w: number; h: number;
  blurb: string;
}

export const ZONES: ZonePlan[] = [
  { id: 'north', tier: 6, name: 'The far north', col: 0, row: 0, w: 3, h: 1, blurb: 'Not yet discovered.' },
  { id: 'fjord', tier: 2, name: 'Saltfjorden', region: 'fjord', col: 0, row: 1, w: 1, h: 1, blurb: 'Sea fishing · Fishing 8–28' },
  { id: 'valley', tier: 1, name: 'Mofjellet & Bjørkvik', region: 'valley', col: 1, row: 1, w: 1, h: 1, blurb: 'Where you start · monsters level 2–12' },
  { id: 'gruben', tier: 3, name: 'Gruben', region: 'gruben', col: 2, row: 1, w: 1, h: 1, blurb: 'The old mine valley · monsters level 13–22' },
  { id: 'southwest', tier: 4, name: 'The south-west', col: 0, row: 2, w: 1, h: 1, blurb: 'Not yet discovered.' },
  { id: 'south', tier: 5, name: 'The southlands', col: 1, row: 2, w: 2, h: 1, blurb: 'Not yet discovered.' },
];

/** Ways between zones: [from, to, how]. */
export const ZONE_LINKS: [string, string, string][] = [
  ['valley', 'fjord', 'Rowboat from Bjørkvik pier'],
  ['valley', 'gruben', 'The pass in the east'],
  ['gruben', 'south', 'Down out of Gruben'],
  ['south', 'southwest', 'West across the southlands'],
  ['southwest', 'fjord', 'North along the coast'],
];
