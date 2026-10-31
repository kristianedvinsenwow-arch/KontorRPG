/**
 * Plants you pick by hand: flax, jute, ramie, cotton and bamboo (tailoring), and herbs — angelica, cloudberries,
 * roseroot, grave moss (herbalism). Picked by hand; a picked-out patch drops to bare stubble until it regrows.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLANTS, type Plant } from '@kontor/shared';

/**
 * Collapse a patch's dozens of little stem/leaf/flower meshes into one mesh per material:
 * a patch is then 1–2 draw calls instead of ~40 (there are ~100 patches).
 */
function merge(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const c of [...group.children] as THREE.Mesh[]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    const geo = c.geometry.clone().applyMatrix4(c.matrix);
    const list = byMat.get(c.material as THREE.Material) ?? [];
    list.push(geo.index ? geo : geo);
    byMat.set(c.material as THREE.Material, list);
    group.remove(c);
  }
  for (const [m, geos] of byMat) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }));
    if (merged) group.add(new THREE.Mesh(merged, m));
  }
}
/** Materials shared by every patch of a kind. */
const matCache = new Map<number, THREE.MeshStandardMaterial>();
const sharedMat = (color: number, emissive = 0) => {
  const key = color * 7 + emissive;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive }); matCache.set(key, m); }
  return m;
};

interface PlantView { p: Plant; g: THREE.Group; full: THREE.Group; stubble: THREE.Mesh; depleted: boolean; shake: number }

const stem = new THREE.MeshStandardMaterial({ color: 0x6f8c42, roughness: 0.9 });
const flaxFlower = new THREE.MeshStandardMaterial({ color: 0x7a9ae8, emissive: 0x18224a, roughness: 0.6 });
const cotton = new THREE.MeshStandardMaterial({ color: 0xf6f4ec, roughness: 1 });
const stubbleMat = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 1 });
/** Herbs: [stem colour, top colour, top size, height, count]. */
const HERB: Record<string, [number, number, number, number, number, 'umbel' | 'berry' | 'rosette' | 'moss']> = {
  angelica: [0x6f9a42, 0xe8ecc0, 0.09, 0.9, 7, 'umbel'],
  cloudberry: [0x5f8a3a, 0xf0a030, 0.035, 0.18, 14, 'berry'],
  roseroot: [0x7a9a5a, 0xe8c040, 0.06, 0.28, 9, 'rosette'],
  grave_moss: [0x8a9a8a, 0xc8d8d0, 0.12, 0.05, 12, 'moss'],
};

export class Plants {
  readonly group = new THREE.Group();
  private views = new Map<string, PlantView>();
  private highlighted: PlantView | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 1, 4).translate(0, 0.5, 0);
    const flowerGeo = new THREE.SphereGeometry(0.035, 5, 4);
    const tuftGeo = new THREE.SphereGeometry(0.07, 6, 5);
    const leafGeo = new THREE.SphereGeometry(0.12, 5, 3).scale(1.3, 0.18, 0.55).translate(0.12, 0, 0);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const p of PLANTS) {
      const g = new THREE.Group();
      g.position.set(p.x, p.y - 0.02, p.z);
      const full = new THREE.Group();
      const herb = HERB[p.kind];
      if (herb) {
        const [sc, tc, ts, hh, n, shape] = herb;
        const sm = sharedMat(sc), tm = sharedMat(tc, shape === 'moss' ? 0x203028 : 0x000000);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (shape === 'umbel' ? 0.45 : 0.55), h = hh * (0.7 + rnd() * 0.5);
          if (shape !== 'moss') {
            const st2 = new THREE.Mesh(stemGeo, sm); st2.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); st2.scale.set(shape === 'umbel' ? 1.6 : 1, h, shape === 'umbel' ? 1.6 : 1); full.add(st2);
            // Leaves.
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 3), sm); leaf.scale.set(1.4, 0.25, 0.7); leaf.position.set(st2.position.x + 0.05, h * 0.4, st2.position.z); leaf.rotation.y = a; full.add(leaf);
          }
          const top = new THREE.Mesh(shape === 'umbel' ? new THREE.SphereGeometry(ts, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.SphereGeometry(ts, 6, 4), tm);
          top.position.set(Math.cos(a) * r, shape === 'moss' ? 0.02 : h, Math.sin(a) * r);
          if (shape === 'moss') top.scale.set(1.6, 0.35, 1.6);
          full.add(top);
        }
        merge(full);
        g.add(full);
        const stubble = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.04, 10), stubbleMat);
        stubble.position.y = 0.02; stubble.visible = false; g.add(stubble);
        this.group.add(g);
        this.views.set(p.id, { p, g, full, stubble, depleted: false, shake: 0 });
        continue;
      }
      // Fibre plants: [count, height min, height span, stem thickness, top, top colour, stem colour].
      const F: Record<string, [number, number, number, number, 'flower' | 'tuft' | 'leaf' | 'cane', THREE.Material, THREE.Material]> = {
        flax: [22, 0.6, 0.35, 1, 'flower', flaxFlower, stem],
        jute: [14, 1.2, 0.5, 1.8, 'flower', sharedMat(0xe8c838, 0x302808), sharedMat(0x5f8a3a)],
        ramie: [10, 0.7, 0.35, 1.4, 'leaf', sharedMat(0x7e9a62), sharedMat(0x6f8a52)],
        bog_cotton: [14, 0.45, 0.3, 1.2, 'tuft', cotton, sharedMat(0x6a5a3a)],
        bamboo: [8, 2.2, 1.2, 4, 'cane', sharedMat(0x6e9a40), sharedMat(0xa8c070)],
      };
      const [n, h0, hs, thick, shape, topMat, stemMat] = F[p.kind] ?? F.flax;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.6, h = h0 + rnd() * hs;
        const s = new THREE.Mesh(stemGeo, stemMat);
        s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        s.scale.set(thick, h, thick);
        s.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
        full.add(s);
        if (shape === 'leaf' || shape === 'cane') {
          // Broad leaves up the stem (ramie), or a leafy tuft at the top of each cane (bamboo).
          for (const f of shape === 'leaf' ? [0.35, 0.6, 0.85] : [0.8, 0.95]) {
            const leaf = new THREE.Mesh(leafGeo, topMat);
            leaf.position.set(s.position.x, h * f, s.position.z);
            leaf.rotation.y = rnd() * Math.PI * 2;
            leaf.scale.setScalar(shape === 'cane' ? 1.4 : 1);
            full.add(leaf);
          }
          continue;
        }
        const top = new THREE.Mesh(shape === 'flower' ? flowerGeo : tuftGeo, topMat);
        top.position.set(s.position.x, h, s.position.z);
        if (shape === 'tuft') top.scale.set(1, 1.3, 1);
        full.add(top);
      }
      merge(full);
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

  animate(dt: number, t: number, at?: THREE.Vector3): void {
    for (const v of this.views.values()) {
      // Only draw patches within 70 m.
      if (at) { const far = Math.abs(v.p.x - at.x) > 70 || Math.abs(v.p.z - at.z) > 70; v.g.visible = !far; if (far) continue; }
      v.full.rotation.z = Math.sin(t * 1.3 + v.p.x) * 0.04 + Math.sin(v.shake * 25) * v.shake * 0.12;
      if (v.shake > 0) v.shake = Math.max(0, v.shake - dt * 4);
    }
  }
}
