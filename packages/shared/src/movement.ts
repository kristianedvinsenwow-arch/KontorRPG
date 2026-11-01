/**
 * Movement rules shared by the client (prediction) and the server (validation).
 * The client moves itself every frame; the server checks each reported step is physically possible.
 */
import { WALK_SPEED, MAX_SPEED_BONUS, WORLD_HALF, PLAYER_RADIUS } from './constants.js';
import { groundAt, inCaveRegion, walkable } from './cave.js';
import { GRUBEN, inGruben, FJORD, inFjord } from './terrain.js';

export interface Vec3 { x: number; y: number; z: number }

/** Highest horizontal speed: mount multiplier × (1 + bonuses). Bonuses cap at +30%; perks can also be negative. */
export function maxSpeed(mountMult = 1, bonus = 0): number {
  return WALK_SPEED * mountMult * (1 + Math.max(-0.5, Math.min(bonus, MAX_SPEED_BONUS)));
}

export function clampToWorld(p: Vec3): Vec3 {
  if (inCaveRegion(p.x, p.z)) return p; // cave walls are colliders
  if (inFjord(p.x, p.z)) {
    const lim = FJORD.half - PLAYER_RADIUS - 1;
    return { x: Math.max(FJORD.x - lim, Math.min(FJORD.x + lim, p.x)), y: p.y, z: Math.max(FJORD.z - lim, Math.min(FJORD.z + lim, p.z)) };
  }
  if (inGruben(p.x, p.z)) {
    const lim = GRUBEN.half - PLAYER_RADIUS - 1;
    return { x: Math.max(GRUBEN.x - lim, Math.min(GRUBEN.x + lim, p.x)), y: p.y, z: Math.max(GRUBEN.z - lim, Math.min(GRUBEN.z + lim, p.z)) };
  }
  const lim = WORLD_HALF - PLAYER_RADIUS - 1;
  return { x: Math.max(-lim, Math.min(lim, p.x)), y: p.y, z: Math.max(-lim, Math.min(lim, p.z)) };
}

export interface StepCheck { ok: boolean; reason?: string }

/**
 * Is moving from `prev` to `next` over `dtSec` allowed?
 * Generous slack absorbs network jitter (bursty packets) without letting speed hacks through.
 */
export function checkStep(prev: Vec3, next: Vec3, dtSec: number, speedCap = maxSpeed()): StepCheck {
  if (!walkable(next.x, next.z, PLAYER_RADIUS)) return { ok: false, reason: 'out_of_bounds' };
  const dt = Math.max(0.05, Math.min(dtSec, 1.5));
  const horiz = Math.hypot(next.x - prev.x, next.z - prev.z);
  const allowed = speedCap * dt * 1.35 + 0.6;
  if (horiz > allowed) return { ok: false, reason: 'too_fast' };
  const ground = groundAt(next.x, next.z);
  if (next.y < ground - 0.75) return { ok: false, reason: 'below_ground' };
  if (next.y > ground + 4.5) return { ok: false, reason: 'flying' };
  return { ok: true };
}
