/**
 * Remote players: buffer server snapshots and render each player slightly in the past, blending
 * between the two snapshots around that moment — the same idea as KontorLAN's updateRemotes, but
 * timed by server timestamps so jitter doesn't cause stutter.
 */
import * as THREE from 'three';
import { INTERP_DELAY_MS, type PlayerState } from '@kontor/shared';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';

interface Sample { at: number; s: PlayerState }

interface Remote {
  id: string;
  name: string;
  color: number;
  race: string;
  face: number;
  model: Character;
  buf: Sample[];
  lastSeen: number;
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Remotes {
  private map = new Map<string, Remote>();
  /** Estimated (localTime − serverTime); the minimum seen is the lowest-latency sample. */
  private offset: number | null = null;
  private offsets: number[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  ingest(at: number, players: PlayerState[]): void {
    const now = Date.now();
    this.offsets.push(now - at);
    if (this.offsets.length > 30) this.offsets.shift();
    this.offset = Math.min(...this.offsets);

    const seen = new Set<string>();
    for (const s of players) {
      seen.add(s.id);
      let r = this.map.get(s.id);
      if (!r || r.name !== s.name || r.color !== s.color || r.race !== s.race || r.face !== (s.face ?? 0)) {
        if (r) this.scene.remove(r.model.g);
        const model = makeCharacter(s.color, s.name, s.race, s.face ?? 0);
        model.g.position.set(s.x, s.y, s.z);
        this.scene.add(model.g);
        r = { id: s.id, name: s.name, color: s.color, race: s.race, face: s.face ?? 0, model, buf: [], lastSeen: now };
        this.map.set(s.id, r);
      }
      applyGear(r.model, s.gear);
      r.buf.push({ at, s });
      if (r.buf.length > 20) r.buf.shift();
      r.lastSeen = now;
    }
    // Out of area of interest (or gone): remove after a grace period so brief gaps don't flicker.
    for (const [id, r] of this.map) if (!seen.has(id) && now - r.lastSeen > 1500) this.remove(id);
  }

  remove(id: string): void {
    const r = this.map.get(id);
    if (!r) return;
    this.scene.remove(r.model.g);
    this.map.delete(id);
  }

  update(dt: number): void {
    if (this.offset === null) return;
    const renderAt = Date.now() - this.offset - INTERP_DELAY_MS;
    for (const r of this.map.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].at <= renderAt && b[i + 1].at >= renderAt) { a = b[i]; c = b[i + 1]; break; }
      }
      const span = c.at - a.at;
      const t = span > 0 ? THREE.MathUtils.clamp((renderAt - a.at) / span, 0, 1) : 1;
      const g = r.model.g;
      g.position.set(
        a.s.x + (c.s.x - a.s.x) * t,
        a.s.y + (c.s.y - a.s.y) * t,
        a.s.z + (c.s.z - a.s.z) * t,
      );
      g.rotation.y = lerpAngle(a.s.yaw, c.s.yaw, t);
      const spd = a.s.spd + (c.s.spd - a.s.spd) * t;
      animateCharacter(r.model, spd, c.s.pitch, c.s.act === 'swing', dt);
    }
  }

  get count(): number { return this.map.size; }
}
