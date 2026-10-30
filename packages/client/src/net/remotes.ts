/**
 * Remote players: buffer server snapshots and render each player slightly in the past, blending
 * between the two snapshots around that moment — the same idea as KontorLAN's updateRemotes, but
 * timed by server timestamps so jitter doesn't cause stutter.
 */
import * as THREE from 'three';
import { INTERP_DELAY_MS, PLAYER_COLORS, RACES, type PlayerState } from '@kontor/shared';
import { addLabel, removeLabel, type Label } from '../engine/labels.js';
import { makeCharacter, animateCharacter, aimPose, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';

interface Sample { at: number; s: PlayerState }

interface Remote {
  id: string;
  name: string;
  color: number;
  race: string;
  face: number;
  model: Character;
  label: Label;
  hp: HTMLElement;
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
        if (r) { this.scene.remove(r.model.g); removeLabel(r.label); }
        const model = makeCharacter(s.color, s.name, s.race, s.face ?? 0);
        model.g.position.set(s.x, s.y, s.z);
        this.scene.add(model.g);
        const el = document.createElement('div');
        el.className = 'tag player';
        const b = document.createElement('b'); b.textContent = s.name; b.style.color = PLAYER_COLORS[s.color % PLAYER_COLORS.length];
        const bar = document.createElement('div'); bar.className = 'hpbar'; const fill = document.createElement('i'); bar.append(fill);
        el.append(b, bar);
        const g = model.g, h = RACES[s.race]?.height ?? 1.85;
        const label = addLabel(el, () => g.position.clone().setY(g.position.y + h + 0.35), 40);
        r = { id: s.id, name: s.name, color: s.color, race: s.race, face: s.face ?? 0, model, label, hp: fill, buf: [], lastSeen: now };
        this.map.set(s.id, r);
      }
      applyGear(r.model, s.gear);
      if (s.hp != null && s.mhp) { r.hp.style.width = `${(s.hp / s.mhp) * 100}%`; r.label.el.classList.toggle('hurt', s.hp < s.mhp); }
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
    removeLabel(r.label);
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
      animateCharacter(r.model, spd, c.s.pitch, c.s.act === 'swing' || c.s.act === 'spin', dt);
      if (c.s.act === 'spin') r.model.body.rotation.y += dt * 14; else r.model.body.rotation.y = 0;
      if (c.s.act === 'shoot' || c.s.act === 'cast') aimPose(r.model, c.s.act);
    }
  }

  get count(): number { return this.map.size; }
}

export function remotePosition(r: Remotes, id: string): THREE.Vector3 | null { return (r as any).map.get(id)?.model.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)) ?? null; }
