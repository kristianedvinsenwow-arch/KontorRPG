/**
 * Monsters as the client sees them: procedural models (wolf, goblins, bats, the troll), smoothed
 * movement from snapshots, a name/level/health label, status looks (burning, slowed, frozen),
 * attack and death animations, and picking under the crosshair.
 */
import * as THREE from 'three';
import { MOBS, ST_ANGRY, ST_BURN, ST_DEAD, ST_FROZEN, ST_SLOW, groundAt, type MobKind, type MobState } from '@kontor/shared';
import { mat, mesh, bx, ball, limb, v3 } from '../engine/procgen.js';
import { makeCharacter, animateCharacter, type Character } from './character.js';
import { applyGear } from './held.js';
import { addLabel, removeLabel, type Label } from '../engine/labels.js';

interface MobView {
  id: string;
  kind: MobKind;
  g: THREE.Group;
  body: THREE.Group;
  char?: Character;
  legs: THREE.Object3D[];
  wings: THREE.Object3D[];
  target: { x: number; y: number; z: number; yaw: number };
  s: MobState;
  speed: number;
  ph: number;
  deadT: number;
  label: Label;
  hpFill: HTMLElement;
  statusEl: HTMLElement;
  atkT: number;
  tintMats: THREE.MeshStandardMaterial[];
}

function swapSkin(root: THREE.Object3D, from: number, to: THREE.Material) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color?.getHex() === from) m.material = to;
  });
}

const quad = (k: MobKind) => k === 'wolf' || k === 'lynx';
const OGRES: MobKind[] = ['troll', 'hill_troll'];
const isOgre = (k: MobKind) => OGRES.includes(k);
const isUndead = (k: MobKind) => k === 'draug' || k === 'mine_king';

export function humanoid(kind: MobKind): { g: THREE.Group; c: Character } {
  const race = isOgre(kind) ? 'ogre' : isUndead(kind) ? 'human' : 'gnome';
  const color = kind === 'cave_shaman' ? 4 : kind === 'troll' ? 7 : kind === 'hill_troll' ? 3 : kind === 'cave_goblin' ? 0 : isUndead(kind) ? 7 : 3;
  const c = makeCharacter(color, undefined, race, isOgre(kind) ? 3 : 1);
  const skinHex = kind === 'troll' ? 0x7d8790 : kind === 'hill_troll' ? 0x8a7a62 : isUndead(kind) ? 0x8fa3a8 : kind === 'cave_goblin' ? 0x5f7a48 : 0x7a9a4a;
  const skin = mat(skinHex, null, { r: 0.7 });
  swapSkin(c.g, race === 'ogre' ? 0x9fa478 : 0xd1a582, skin);
  // Goblin ears.
  if (race === 'gnome') for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.035, 0.16, 5), skin, c.head);
    ear.position.set(sx * 0.12, 0.03, 0.01); ear.rotation.z = -sx * 1.2;
  }
  // The dead have cold, glowing eyes.
  if (isUndead(kind)) for (const sx of [-1, 1]) {
    const eye = ball(c.head, v3(sx * 0.05, 0.03, -0.13), 0.02, new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x6fd8ff, emissiveIntensity: 3 }), 6);
    void eye;
  }
  if (kind === 'mine_king') {
    // A rusted crown.
    const gold = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.45 });
    const crown = mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.07, 10, 1, true), gold, c.head); crown.position.y = 0.16;
    for (let i = 0; i < 6; i++) { const sp = mesh(new THREE.ConeGeometry(0.025, 0.08, 4), gold, c.head); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.125, 0.23, Math.sin(a) * 0.125); }
  }
  const gear: Record<string, Parameters<typeof applyGear>[1]> = {
    troll: { h: 'stone_battleaxe' }, hill_troll: { h: 'stone_longsword' }, cave_shaman: { h: 'birch_fire_staff' },
    cave_goblin: { h: 'iron_sword', hd: 'stone_helm' }, goblin: { h: 'stone_sword' },
    draug: { h: 'iron_pickaxe', hd: 'iron_helm', c: 'stone_breastplate' },
    mine_king: { h: 'silversteel_longsword', c: 'steel_breastplate', s: 'steel_pauldrons' },
  };
  applyGear(c, gear[kind] ?? {});
  const g = new THREE.Group();
  g.add(c.g);
  return { g, c };
}

function lynx(): { g: THREE.Group; legs: THREE.Object3D[] } {
  const { g, legs } = wolf(0xa8875a, 0x5a4630);
  // Spots, short tail, tufted ears.
  const spot = mat(0x4a3826, null);
  for (let i = 0; i < 10; i++) ball(g, v3(((i * 37) % 7 - 3) * 0.05, 0.72 + (i % 3) * 0.04, -0.3 + i * 0.07), 0.035, spot, 5);
  const tail = g.children.find((o) => (o as THREE.Mesh).geometry instanceof THREE.ConeGeometry && o.position.z > 0.5);
  if (tail) tail.scale.set(0.8, 0.35, 0.8);
  return { g, legs };
}

function wisp(): { g: THREE.Group; wings: THREE.Object3D[] } {
  const g = new THREE.Group();
  const core = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x8fdcff, emissiveIntensity: 3, roughness: 0.2 });
  const halo = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.25, depthWrite: false });
  ball(g, v3(), 0.14, core, 10);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), halo); g.add(h);
  // Two little motes that circle it (animated like wings).
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); g.add(w);
    const m = ball(w, v3(sx * 0.3, 0.05, 0), 0.04, core, 6); void m;
    wings.push(w);
  }
  return { g, wings };
}

function wolf(furHex = 0x7a756c, darkHex = 0x4a4640): { g: THREE.Group; legs: THREE.Object3D[] } {
  const g = new THREE.Group();
  const fur = mat(furHex, 'cloth', { r: 1 }), dark = mat(darkHex, 'cloth', { r: 1 }), nose = mat(0x1a1816, null);
  const body = ball(g, v3(0, 0.62, 0), 0.28, fur, 12); body.scale.set(0.8, 0.85, 1.9);
  const chest = ball(g, v3(0, 0.66, -0.35), 0.25, fur, 10); chest.scale.set(0.9, 1, 1);
  const head = new THREE.Group(); head.position.set(0, 0.85, -0.62); g.add(head);
  ball(head, v3(), 0.16, fur, 10).scale.set(0.9, 0.9, 1.1);
  const snout = mesh(new THREE.ConeGeometry(0.08, 0.26, 6), fur, head); snout.rotation.x = -Math.PI / 2; snout.position.set(0, -0.04, -0.2);
  ball(head, v3(0, -0.03, -0.33), 0.03, nose, 6);
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.05, 0.14, 4), dark, head); ear.position.set(sx * 0.08, 0.15, 0.02);
    ball(head, v3(sx * 0.07, 0.04, -0.12), 0.022, mat(0xe8c040, null, { r: 0.2 }), 6);
  }
  const tail = mesh(new THREE.ConeGeometry(0.07, 0.5, 6), dark, g); tail.position.set(0, 0.7, 0.62); tail.rotation.x = 1.9;
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.14, -0.38], [0.14, -0.38], [-0.14, 0.36], [0.14, 0.36]]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.55, z); g.add(leg);
    limb(leg, v3(), v3(0, -0.52, 0), 0.06, 0.04, fur, 6);
    legs.push(leg);
  }
  return { g, legs };
}

function bat(): { g: THREE.Group; wings: THREE.Object3D[] } {
  const g = new THREE.Group();
  const skin = mat(0x3a3036, 'leather', { r: 0.8 });
  ball(g, v3(0, 0, 0), 0.14, skin, 10).scale.set(0.9, 1, 1.2);
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.04, 0.12, 4), skin, g); ear.position.set(sx * 0.06, 0.15, -0.05);
    ball(g, v3(sx * 0.05, 0.03, -0.13), 0.018, mat(0xff4030, null, { r: 0.3 }), 5);
  }
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); g.add(w);
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.55, 0.12), new THREE.Vector2(0.5, -0.1), new THREE.Vector2(0.35, -0.02), new THREE.Vector2(0.25, -0.16), new THREE.Vector2(0.1, -0.04)]);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x2a2228, side: THREE.DoubleSide, roughness: 0.8 }));
    m.rotation.x = -Math.PI / 2;
    m.scale.x = sx;
    w.add(m);
    wings.push(w);
  }
  return { g, wings };
}

export class Mobs {
  private views = new Map<string, MobView>();
  private targetId: string | null = null;
  /** Voice hook: a mob noticed someone, attacked, or died (and idle chatter now and then). */
  onVoice: ((kind: MobKind, mood: 'aggro' | 'attack' | 'death' | 'idle', pos: THREE.Vector3) => void) | null = null;
  private nextIdle = new Map<string, number>();

  constructor(private readonly scene: THREE.Scene) {}

  ingest(list: MobState[]): void {
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) v = this.create(s);
      const wasDead = !!(v.s.st & ST_DEAD), wasAngry = !!(v.s.st & ST_ANGRY), wasAct = v.s.act;
      if (this.onVoice && !(s.st & ST_DEAD)) {
        if (!wasAngry && s.st & ST_ANGRY) this.onVoice(s.k, 'aggro', v.g.position);
        else if (s.act === 'atk' && wasAct !== 'atk' && Math.random() < 0.6) this.onVoice(s.k, 'attack', v.g.position);
      }
      if (this.onVoice && !wasDead && s.st & ST_DEAD) this.onVoice(s.k, 'death', v.g.position);
      v.s = s;
      v.target = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
      if (wasDead && !(s.st & ST_DEAD)) { v.g.position.set(s.x, s.y, s.z); v.deadT = 0; v.body.rotation.set(0, 0, 0); v.g.visible = true; }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.scene.remove(v.g); removeLabel(v.label); this.views.delete(id); }
  }

  private create(s: MobState): MobView {
    const def = MOBS[s.k];
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    let legs: THREE.Object3D[] = [], wings: THREE.Object3D[] = [], char: Character | undefined;
    if (s.k === 'wolf') { const w = wolf(); body.add(w.g); legs = w.legs; }
    else if (s.k === 'lynx') { const w = lynx(); body.add(w.g); legs = w.legs; }
    else if (s.k === 'bat') { const b = bat(); body.add(b.g); wings = b.wings; }
    else if (s.k === 'wisp') { const b = wisp(); body.add(b.g); wings = b.wings; }
    else { const h = humanoid(s.k); body.add(h.g); char = h.c; }
    body.scale.setScalar(isOgre(s.k) ? def.scale / 1.16 : def.scale);
    g.position.set(s.x, s.y, s.z);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
    // Status looks are applied with a per-mob material tint.
    const tintMats: THREE.MeshStandardMaterial[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const c = (m.material as THREE.MeshStandardMaterial).clone();
        m.material = c;
        tintMats.push(c);
      }
    });
    this.scene.add(g);
    const el = document.createElement('div');
    el.className = `tag mob${def.boss ? ' boss' : ''}`;
    const nm = document.createElement('b'); nm.textContent = `${def.name}`;
    const lv = document.createElement('small'); lv.textContent = `Level ${def.level}${def.boss ? ' · Boss' : ''}`;
    const bar = document.createElement('div'); bar.className = 'hpbar';
    const fill = document.createElement('i'); bar.append(fill);
    const status = document.createElement('div'); status.className = 'status';
    el.append(nm, lv, bar, status);
    const height = (isOgre(s.k) ? 2.2 * def.scale / 1.16 : quad(s.k) ? 1.1 : def.flying ? 0.6 : isUndead(s.k) ? 1.85 * def.scale : 1.0 * def.scale) + 0.4;
    const view: MobView = {
      id: s.id, kind: s.k, g, body, char, legs, wings, target: { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, s, speed: 0, ph: Math.random() * 6, deadT: 0,
      label: addLabel(el, () => (g.visible ? new THREE.Vector3(g.position.x, g.position.y + height + (def.flying ? 1.5 : 0), g.position.z) : null), def.boss ? 50 : 34),
      hpFill: fill, statusEl: status, atkT: 0, tintMats,
    };
    this.views.set(s.id, view);
    return view;
  }

  setTarget(id: string | null): void {
    if (id === this.targetId) return;
    if (this.targetId) this.views.get(this.targetId)?.label.el.classList.remove('targeted');
    this.targetId = id;
    if (id) this.views.get(id)?.label.el.classList.add('targeted');
  }

  update(dt: number): void {
    const now = performance.now();
    for (const v of this.views.values()) {
      // Idle mutterings: goblins chatter, draugs moan, wolves growl — every few seconds, at random.
      if (this.onVoice && !(v.s.st & (ST_DEAD | ST_ANGRY))) {
        const at = this.nextIdle.get(v.id) ?? now + Math.random() * 8000;
        if (now >= at) { if (at !== now) this.onVoice(v.kind, 'idle', v.g.position); this.nextIdle.set(v.id, now + 5000 + Math.random() * 12000); }
        else if (!this.nextIdle.has(v.id)) this.nextIdle.set(v.id, at);
      }
      const s = v.s, g = v.g;
      const dead = !!(s.st & ST_DEAD);
      const k = Math.min(1, dt * 8);
      const px = g.position.x, pz = g.position.z;
      g.position.x += (v.target.x - g.position.x) * k;
      g.position.z += (v.target.z - g.position.z) * k;
      const fly = MOBS[v.kind].flying;
      const gy = fly ? groundAt(g.position.x, g.position.z) + 1.5 + Math.sin(v.ph * (v.kind === 'wisp' ? 0.3 : 2)) * (v.kind === 'wisp' ? 0.4 : 0.15) : v.target.y;
      g.position.y += (gy - g.position.y) * k;
      let dy = v.target.yaw - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, dt * 10);
      const sp = Math.hypot(g.position.x - px, g.position.z - pz) / Math.max(dt, 1e-3);
      v.speed += (sp - v.speed) * Math.min(1, dt * 6);
      const frozen = !!(s.st & ST_FROZEN);
      v.ph += dt * (frozen ? 0 : 1) * (v.kind === 'bat' ? 14 : v.kind === 'wisp' ? 5 : v.speed * 2.4);
      if (s.act) v.atkT = Math.min(1, v.atkT + dt * 3); else v.atkT = Math.max(0, v.atkT - dt * 4);
      // Animation per kind.
      if (v.char) animateCharacter(v.char, frozen ? 0 : v.speed, 0, !!s.act && !frozen, frozen ? 0 : dt);
      v.legs.forEach((l, i) => (l.rotation.x = Math.sin(v.ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * Math.min(0.7, v.speed * 0.15)));
      if (quad(v.kind)) v.body.rotation.x = -v.atkT * 0.35;
      if (v.kind === 'wisp') v.wings.forEach((w, i) => (w.rotation.y = v.ph + i * Math.PI));
      else v.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * Math.sin(v.ph) * 0.8));
      if (dead) {
        v.deadT += dt;
        v.body.rotation.z = Math.min(Math.PI / 2, v.deadT * 4) * (fly ? 0 : 1);
        if (v.kind === 'wisp') v.body.scale.setScalar(Math.max(0.01, 1 - v.deadT * 2));
        if (fly) g.position.y = Math.max(groundAt(g.position.x, g.position.z) + 0.1, g.position.y - dt * 4);
        // Skinnable bodies stay until skinned or until the server lets them go (30 s).
        if (v.deadT > 3 && !s.sk) g.visible = false;
        else if (s.sk) g.visible = true;
      }
      // Status tint: red-orange glow while burning, icy blue while frozen/slowed.
      const burn = !!(s.st & ST_BURN), slow = !!(s.st & ST_SLOW);
      const emis = frozen ? 0x3a6a9a : burn ? 0x7a2a08 : slow ? 0x1a3050 : 0;
      for (const m of v.tintMats) m.emissive.setHex(emis);
      v.hpFill.style.width = `${Math.max(0, (s.hp / s.mhp) * 100)}%`;
      v.label.el.classList.toggle('corpse', dead && !!s.sk);
      v.label.el.classList.toggle('hurt', s.hp < s.mhp || v.id === this.targetId);
      const st = [burn ? `Burn ×${s.bs ?? 1}` : '', frozen ? 'Frozen' : slow ? 'Slowed' : ''].filter(Boolean).join(' · ');
      if (v.statusEl.textContent !== st) v.statusEl.textContent = st;
    }
  }

  /** Live mob under the crosshair within `reach` (ray vs. a sphere around the body). */
  /**
   * Mob under the crosshair: a ray against a body-sized sphere (no huge margins — you have to
   * actually look at it). `corpses` picks skinnable bodies instead of live mobs.
   */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, slack = 0.2, corpses = false): MobState | null {
    let best: MobState | null = null, bestT = Infinity;
    const c = new THREE.Vector3();
    for (const v of this.views.values()) {
      const dead = !!(v.s.st & ST_DEAD);
      if (corpses ? !(dead && v.s.sk) : dead) continue;
      const def = MOBS[v.kind];
      const r = (isOgre(v.kind) ? 0.55 * def.scale : def.flying ? 0.38 : quad(v.kind) ? 0.5 * def.scale : isUndead(v.kind) ? 0.4 * def.scale : 0.42 * def.scale) * (1 + slack) + (corpses ? 0.25 : 0);
      // Live bodies are an upright capsule from the feet to the top of the head (so a tall troll can
      // be hit anywhere on its body, not just at one point); corpses are a low sphere.
      const top = corpses ? 0 : isOgre(v.kind) ? 2.2 * def.scale / 1.16 : quad(v.kind) ? 0.9 : def.flying ? 0 : isUndead(v.kind) ? 1.85 * def.scale : 1.0 * def.scale;
      const y0 = v.g.position.y + (corpses ? 0.25 : def.flying ? 0 : Math.min(r, top / 2)), y1 = v.g.position.y + (corpses || def.flying ? (corpses ? 0.25 : 0) : Math.max(top - r * 0.6, top / 2));
      // Closest approach between the ray and the vertical segment (x, y0..y1, z).
      c.set(v.g.position.x - origin.x, 0, v.g.position.z - origin.z);
      const hx = c.x, hz = c.z;
      const dxz = dir.x * dir.x + dir.z * dir.z;
      let t: number, y: number;
      if (dxz < 1e-6) { t = 0; y = origin.y; } else {
        t = (hx * dir.x + hz * dir.z) / dxz; // ray param where it's horizontally nearest the axis
        y = origin.y + dir.y * t;
      }
      const yc = Math.max(y0, Math.min(y1, y));
      // Re-solve t against the clamped point on the axis.
      c.set(v.g.position.x, yc, v.g.position.z).sub(origin);
      t = c.dot(dir);
      if (t < 0 || t > reach + r + 0.5) continue;
      const d2 = c.lengthSq() - t * t;
      if (d2 > r * r) continue;
      if (t < bestT) { bestT = t; best = v.s; }
    }
    return best;
  }

  position(id: string): THREE.Vector3 | null {
    const v = this.views.get(id);
    const def = v ? MOBS[v.kind] : null;
    return v ? v.g.position.clone().add(new THREE.Vector3(0, isOgre(v.kind) ? 0.9 * def!.scale : def!.flying ? 0 : isUndead(v.kind) ? 1.1 * def!.scale : 0.8, 0)) : null;
  }

  get(id: string): MobState | undefined { return this.views.get(id)?.s; }

  all(): MobState[] { return [...this.views.values()].map((v) => v.s); }
}
