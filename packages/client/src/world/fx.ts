/**
 * Short-lived effects: arrows and bolts in flight, the longsword spin, frost nova, ignite flashes,
 * the troll's ground slam, a fishing bobber, ground loot, and the wear rings on veins and trees.
 */
import * as THREE from 'three';
import { ITEMS, PROJECTILE_SPEED, type GroundItem } from '@kontor/shared';
import { addLabel, removeLabel, type Label } from '../engine/labels.js';
import { rarityColor } from '../ui/icons.js';

interface Live { obj: THREE.Object3D; t: number; dur: number; tick: (k: number, o: THREE.Object3D) => void }

const ARROW = (() => {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xc8b48a }));
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 }));
  tip.rotation.x = -Math.PI / 2; tip.position.z = -0.38;
  g.add(tip);
  return g;
})();

const bolt = (color: number) => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color })));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  g.add(halo);
  return g;
};

export class Fx {
  private live: Live[] = [];
  private ground = new Map<number, { g: GroundItem; obj: THREE.Object3D; label: Label }>();
  private rings = new Map<string, { label: Label; arc: SVGCircleElement; until: number }>();
  private bobber: THREE.Mesh | null = null;
  private bobberBite = false;
  private t = 0;

  /** One persistent light for flashes (adding and removing lights recompiles every shader). */
  private flashLight = new THREE.PointLight(0xff7a2a, 0, 6, 2);

  constructor(private readonly scene: THREE.Scene) { this.flashLight.position.set(0, -500, 0); scene.add(this.flashLight); }

  private add(obj: THREE.Object3D, dur: number, tick: Live['tick']) {
    this.scene.add(obj);
    this.live.push({ obj, t: 0, dur, tick });
  }

  /** A projectile from `from` to (a moving) `to`, arriving after distance / speed. */
  projectile(kind: 'arrow' | 'firebolt' | 'frostbolt' | 'magic' | 'heal' | 'waterbolt', from: THREE.Vector3, to: () => THREE.Vector3 | null): void {
    const end0 = to();
    if (!end0) return;
    const obj = kind === 'arrow' ? ARROW.clone() : bolt(kind === 'firebolt' ? 0xff7a2a : kind === 'frostbolt' ? 0x9fdcff : kind === 'heal' ? 0x7fe08a : kind === 'waterbolt' ? 0x3aa8ff : 0xb070ff);
    const dur = Math.max(0.12, from.distanceTo(end0) / PROJECTILE_SPEED);
    obj.position.copy(from);
    this.add(obj, dur, (k, o) => {
      const end = to() ?? end0;
      const p = from.clone().lerp(end, k);
      if (kind === 'arrow') p.y += Math.sin(k * Math.PI) * 0.4;
      o.lookAt(p.clone().add(p.clone().sub(o.position)));
      o.position.copy(p);
    });
  }

  /** An expanding ring on the ground (spin, nova, slam). */
  /** Tentacle Slap: a little purple tentacle shoots up out of the ground, curls over and slaps down. */
  tentacle(at: THREE.Vector3): void {
    const g = new THREE.Group(); g.position.copy(at);
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a3a4a, roughness: 0.5 });
    let parent: THREE.Object3D = g, r = 0.13;
    const segs: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group(); seg.position.y = i ? 0.3 : 0; parent.add(seg);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.32, 8).translate(0, 0.16, 0), skin); seg.add(m);
      segs.push(seg); parent = seg; r *= 0.82;
    }
    this.add(g, 0.8, (k, o) => {
      // Up out of the ground (0–30%), then curl over hard (30–55%), then sink back.
      const up = Math.min(1, k / 0.3), down = Math.max(0, (k - 0.6) / 0.4);
      o.scale.set(1, up * (1 - down), 1);
      const curl = Math.min(1, Math.max(0, (k - 0.3) / 0.25));
      segs.forEach((s2, i) => (s2.rotation.x = i ? curl * 0.45 : 0));
    });
  }

  ring(at: THREE.Vector3, radius: number, color: number, dur = 0.5): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(at).add(new THREE.Vector3(0, 0.15, 0));
    this.add(m, dur, (k, o) => {
      o.scale.setScalar(0.2 + k * radius);
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    });
  }

  /** A telegraph: a red disc on the ground that fills in until the hit lands. */
  warn(at: THREE.Vector3, radius: number, dur: number): void {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.15, depthWrite: false }));
    const edge = new THREE.Mesh(new THREE.RingGeometry(radius - 0.12, radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4a20, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.3, depthWrite: false }));
    g.add(disc, edge, fill);
    g.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
    this.add(g, dur, (k) => { fill.scale.setScalar(Math.max(0.01, k * radius)); (disc.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.12 * Math.sin(k * 20); });
  }

  /** A short flash of light (ignite, hits). */
  flash(at: THREE.Vector3, color: number): void {
    const l = this.flashLight;
    l.position.copy(at); l.color.setHex(color);
    this.add(new THREE.Object3D(), 0.35, (k) => { l.intensity = 8 * (1 - k); if (k >= 1) l.intensity = 0; });
  }

  // ---------------------------------------------------------------- fishing bobber

  setBobber(at: THREE.Vector3 | null): void {
    if (this.bobber) { this.scene.remove(this.bobber); this.bobber = null; }
    this.bobberBite = false;
    if (!at) return;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8402a, roughness: 0.4 }));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2f2ea }));
    top.position.y = 0.07;
    b.add(top);
    b.position.copy(at);
    b.userData.y = at.y;
    this.scene.add(b);
    this.bobber = b;
  }
  /** The bobber drifts along with you (cast from the trawler). */
  moveBobber(at: THREE.Vector3): void { if (this.bobber) { this.bobber.position.x = at.x; this.bobber.position.z = at.z; } }
  bite(): void { this.bobberBite = true; if (this.bobber) this.ring(this.bobber.position, 1.2, 0xffffff, 0.6); }

  // ---------------------------------------------------------------- ground loot

  groundAdd(list: GroundItem[]): void {
    for (const g of list) {
      if (this.ground.has(g.id)) continue;
      const obj = new THREE.Group();
      const d = ITEMS[g.item.id];
      const colour = new THREE.Color(rarityColor(g.item));
      const sack = new THREE.Mesh(g.item.id === 'coins' ? new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12) : new THREE.DodecahedronGeometry(0.16, 0),
        new THREE.MeshStandardMaterial({ color: g.item.id === 'coins' ? 0xf2cc5a : 0x8a6a48, metalness: g.item.id === 'coins' ? 0.9 : 0, roughness: 0.5, emissive: colour, emissiveIntensity: (g.item.r ?? 0) > 0 ? 0.5 : 0.08 }));
      sack.castShadow = true;
      obj.add(sack);
      obj.position.set(g.x, g.y + 0.15, g.z);
      obj.userData.y = g.y + 0.15;
      this.scene.add(obj);
      const el = document.createElement('div');
      el.className = 'tag loot';
      el.textContent = g.item.qty > 1 ? `${d?.name ?? g.item.id} ×${g.item.qty}` : d?.name ?? g.item.id;
      el.style.color = rarityColor(g.item);
      const label = addLabel(el, () => obj.position.clone().add(new THREE.Vector3(0, 0.45, 0)), 16);
      this.ground.set(g.id, { g, obj, label });
    }
  }

  groundRemove(ids: number[]): void {
    for (const id of ids) {
      const x = this.ground.get(id);
      if (!x) continue;
      this.scene.remove(x.obj);
      removeLabel(x.label);
      this.ground.delete(id);
    }
  }

  /** Nearest loot within reach. */
  nearestLoot(x: number, z: number, reach = 2.6): GroundItem | null {
    let best: GroundItem | null = null, bd = reach;
    for (const { g } of this.ground.values()) {
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  // ---------------------------------------------------------------- wear rings on nodes

  /** Show how used-up a vein or tree is (everyone sees the same ring). */
  nodeWear(id: string, at: THREE.Vector3, left: number, total: number): void {
    let r = this.rings.get(id);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'wear';
      el.innerHTML = '<svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16"/></svg>';
      const arc = el.querySelector('.fg') as SVGCircleElement;
      const p = at.clone();
      r = { label: addLabel(el, () => p, 18, true), arc, until: 0 };
      this.rings.set(id, r);
    }
    const c = 2 * Math.PI * 16;
    const frac = total > 0 ? left / total : 0;
    r.arc.style.strokeDasharray = `${(c * frac).toFixed(1)} ${c.toFixed(1)}`;
    r.arc.style.stroke = frac > 0.5 ? '#86d46b' : frac > 0.25 ? '#f2a23a' : '#ff6a4a';
    r.until = performance.now() + (left <= 0 ? 1200 : 6000);
    r.label.el.classList.remove('gone');
  }

  update(dt: number): void {
    this.t += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      l.tick(k, l.obj);
      if (k >= 1) { this.scene.remove(l.obj); this.live.splice(i, 1); }
    }
    for (const { obj } of this.ground.values()) { obj.rotation.y += dt; obj.position.y = obj.userData.y + Math.sin(this.t * 2 + obj.id) * 0.04; }
    if (this.bobber) {
      const y0 = this.bobber.userData.y;
      this.bobber.position.y = y0 + (this.bobberBite ? Math.sin(this.t * 22) * 0.06 - 0.08 : Math.sin(this.t * 2) * 0.02);
    }
    const now = performance.now();
    for (const [id, r] of this.rings) {
      if (now > r.until) { removeLabel(r.label); this.rings.delete(id); }
      else if (now > r.until - 600) r.label.el.classList.add('gone');
    }
  }
}
