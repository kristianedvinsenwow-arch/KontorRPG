/**
 * Local player movement (client-side prediction). Walk at 5 m/s with no sprint, follow the
 * terrain, jump, and slide around tree/rock colliders. The server re-checks every step with the
 * same shared rules (checkStep), so what feels right here is what the server accepts.
 */
import { GRAVITY, JUMP_VELOCITY, PLAYER_RADIUS, WATER_LEVEL, clampToWorld, heightAt, maxSpeed } from '@kontor/shared';
import type { Collider } from '../world/terrain.js';

export interface LocalPlayer {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  onGround: boolean;
  /** Smoothed horizontal speed, drives head bob and the walk animation. */
  speed: number;
}

export interface MoveInput { forward: number; right: number; jump: boolean }

export function createLocalPlayer(x: number, y: number, z: number, yaw: number): LocalPlayer {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, onGround: true, speed: 0 };
}

export function stepPlayer(p: LocalPlayer, input: MoveInput, colliders: Collider[], dt: number, speedBonus = 0): void {
  // Wish direction in world space from yaw (camera looks down -Z at yaw 0).
  const len = Math.hypot(input.forward, input.right) || 1;
  const f = input.forward / len, r = input.right / len;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wishX = -sin * f + cos * r, wishZ = -cos * f - sin * r;
  let target = maxSpeed(1, speedBonus); // perks like Pack Mule or Small Frame; the server uses the same cap
  const inWater = heightAt(p.x, p.z) < WATER_LEVEL - 0.4 && p.y < WATER_LEVEL;
  if (inWater) target *= 0.55; // wading is slow, never faster than walking

  const accel = p.onGround ? 14 : 3;
  const tx = (input.forward || input.right) ? wishX * target : 0;
  const tz = (input.forward || input.right) ? wishZ * target : 0;
  const k = Math.min(1, accel * dt);
  p.vx += (tx - p.vx) * k;
  p.vz += (tz - p.vz) * k;

  if (input.jump && p.onGround && !inWater) { p.vy = JUMP_VELOCITY; p.onGround = false; }
  p.vy -= GRAVITY * dt;

  let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;

  // Push out of circular colliders (trees, rocks). Two passes handle corners between props.
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const dx = nx - c.x, dz = nz - c.z, min = c.r + PLAYER_RADIUS, d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (min - d) / d;
        nx += dx * push; nz += dz * push;
      }
    }
  }

  // Refuse to climb slopes steeper than ~50°: the step is cancelled and you slide along.
  const ground0 = heightAt(p.x, p.z), ground1 = heightAt(nx, nz);
  const horiz = Math.hypot(nx - p.x, nz - p.z);
  if (p.onGround && horiz > 1e-4 && (ground1 - ground0) / horiz > 1.2) { nx = p.x; nz = p.z; }

  const c = clampToWorld({ x: nx, y: p.y, z: nz });
  p.x = c.x; p.z = c.z;
  p.y += p.vy * dt;

  const ground = heightAt(p.x, p.z);
  const floor = Math.max(ground, inWater ? WATER_LEVEL - 1.1 : ground);
  if (p.y <= floor) {
    p.y = floor; p.vy = 0; p.onGround = true;
  } else if (p.onGround && p.y - floor < 0.6 && p.vy <= 0) {
    p.y = floor; p.vy = 0; // stick to the ground when walking downhill
  } else {
    p.onGround = false;
  }
  p.speed += (Math.hypot(p.vx, p.vz) - p.speed) * Math.min(1, dt * 10);
}
