/**
 * Tailoring plants: flax patches (tall stalks with little blue flowers) and bog cotton (white tufts
 * on thin stems). Picked by hand; a picked-out patch drops to bare stubble until it regrows.
 */
import * as THREE from 'three';
import { PLANTS, type Plant } from '@kontor/shared';

interface PlantView { p: Plant; g: THREE.Group; full: THREE.Group; stubble: THREE.Mesh; depleted: boolean; shake: number }

const stem = new THREE.MeshStandardMaterial({ color: 0x6f8c42, roughness: 0.9 });
const flaxFlower = new THREE.MeshStandardMaterial({ color: 0x7a9ae8, emissive: 0x18224a, roughness: 0.6 });
const cotton = new THREE.MeshStandardMaterial({ color: 0xf6f4ec, roughness: 1 });
const stubbleMat = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 1 });

export class Plants {
  readonly group = new THREE.Group();
  private views = new Map<string, PlantView>();
  private highlighted: PlantView | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 1, 4).translate(0, 0.5, 0);
    const flowerGeo = new THREE.SphereGeometry(0.035, 5, 4);
    const tuftGeo = new THREE.SphereGeometry(0.07, 6, 5);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const p of PLANTS) {
      const g = new THREE.Group();
      g.position.set(p.x, p.y - 0.02, p.z);
      const full = new THREE.Group();
      const n = p.kind === 'flax' ? 22 : 16;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.6, h = p.kind === 'flax' ? 0.6 + rnd() * 0.35 : 0.35 + rnd() * 0.25;
        const s = new THREE.Mesh(stemGeo, stem);
        s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        s.scale.y = h;
        s.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
        full.add(s);
        const top = new THREE.Mesh(p.kind === 'flax' ? flowerGeo : tuftGeo, p.kind === 'flax' ? flaxFlower : cotton);
        top.position.set(s.position.x, h, s.position.z);
        if (p.kind === 'bog_cotton') top.scale.set(1, 1.3, 1);
        full.add(top);
      }
      g.add(full);
      const stubble = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 10), stubbleMat);
      stubble.position.y = 0.03;
      stubble.visible = false;
      g.add(stubble);
      this.group.add(g);
      this.views.set(p.id, { p, g, full, stubble, depleted: false, shake: 0 });
    }
  }

  setDepleted(list: [string, 0 | 1][]): void {
    for (const [id, s] of list) {
      const v = this.views.get(id);
      if (!v) continue;
      v.depleted = s === 1;
      v.full.visible = !v.depleted;
      v.stubble.visible = v.depleted;
    }
  }

  isDepleted(id: string): boolean { return !!this.views.get(id)?.depleted; }
  hit(id: string): void { const v = this.views.get(id); if (v) v.shake = 1; }

  /** The patch under the crosshair within reach (ray vs. a low, wide sphere). */
  target(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Plant | null {
    let best: Plant | null = null, bestT = Infinity;
    const c = new THREE.Vector3();
    for (const v of this.views.values()) {
      const p = v.p;
      if (Math.abs(p.x - origin.x) > reach + 2 || Math.abs(p.z - origin.z) > reach + 2) continue;
      c.set(p.x, p.y + 0.35, p.z).sub(origin);
      const t = c.dot(dir);
      if (t < 0) continue;
      const d2 = c.lengthSq() - t * t, rad = 0.75;
      if (d2 > rad * rad || Math.hypot(p.x - origin.x, p.z - origin.z) > reach + 0.6) continue;
      if (t < bestT) { bestT = t; best = p; }
    }
    return best;
  }

  setHighlight(id: string | null): void {
    const next = id ? this.views.get(id) ?? null : null;
    if (next === this.highlighted) return;
    if (this.highlighted) this.highlighted.g.scale.setScalar(1);
    this.highlighted = next;
    if (next) next.g.scale.setScalar(1.06);
  }

  animate(dt: number, t: number): void {
    for (const v of this.views.values()) {
      v.full.rotation.z = Math.sin(t * 1.3 + v.p.x) * 0.04 + Math.sin(v.shake * 25) * v.shake * 0.12;
      if (v.shake > 0) v.shake = Math.max(0, v.shake - dt * 4);
    }
  }
}
