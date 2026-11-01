/**
 * Ore veins: the real, minable ones from shared data (same ids the server checks). Each is a
 * faceted boulder with ore showing through — pale quartz-shot stone or rusty iron nodules. A
 * depleted vein loses its ore and sinks into a dull rubble pile until the server says it is back.
 */
import * as THREE from 'three';
import { VEINS, VEIN_TYPES, type Vein } from '@kontor/shared';
import { faceted } from './props.js';
import type { Collider } from './props.js';

interface VeinView {
  v: Vein;
  g: THREE.Group;
  rock: THREE.Mesh;
  ore: THREE.Group;
  rubble: THREE.Mesh;
  /** Mined out; the server says when it is back (and never tells anyone when that will be). */
  depleted: boolean;
  hit: number;
}

const ROCK_MATS = {
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 }),
  iron: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82 }),
  silver: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
  coal: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  coral: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  seaglass: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
};
const ORE_MATS = {
  coral: new THREE.MeshStandardMaterial({ color: 0xe0584a, emissive: 0x2a0806, roughness: 0.6, flatShading: true }),
  seaglass: new THREE.MeshStandardMaterial({ color: 0x9fe0c0, emissive: 0x10302a, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }),
  stone: new THREE.MeshStandardMaterial({ color: 0xf4efe6, emissive: 0x2a2620, roughness: 0.25, metalness: 0.1, flatShading: true }),
  iron: new THREE.MeshStandardMaterial({ color: 0xa4572c, roughness: 0.45, metalness: 0.7, flatShading: true }),
  silver: new THREE.MeshStandardMaterial({ color: 0xe8eef6, emissive: 0x303844, roughness: 0.2, metalness: 1, flatShading: true }),
  coal: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.35, metalness: 0.3, flatShading: true }),
};
const RUBBLE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });

function rockFor(v: Vein, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.9, 1).scale(1.15, 0.78, 1);
  if (v.type === 'coral') return faceted(g, seed, 0.3, new THREE.Color(0x8a7a6a), new THREE.Color(0xb0a088), -0.6, 0.6, new THREE.Color(0x6a7a5a));
  if (v.type === 'coal') return faceted(g, seed, 0.42, new THREE.Color(0x3a3734), new THREE.Color(0x5e5a54), -0.6, 0.6, new THREE.Color(0x4a5232));
  return v.type === 'iron'
    ? faceted(g, seed, 0.42, new THREE.Color(0x4a403a), new THREE.Color(0x7a6a5e), -0.6, 0.6, new THREE.Color(0x5d6a3a))
    : faceted(g, seed, 0.42, new THREE.Color(0x4f4d49), new THREE.Color(0x77736b), -0.6, 0.6, new THREE.Color(0x56683a));
}

export class Veins {
  readonly group = new THREE.Group();
  private views = new Map<string, VeinView>();
  readonly colliders: Collider[] = [];
  private highlighted: VeinView | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    let seed = 100;
    const rubbleGeo = faceted(new THREE.IcosahedronGeometry(0.55, 0).scale(1.4, 0.35, 1.2), 7, 0.3, new THREE.Color(0x55524c), new THREE.Color(0x77736a), -0.2, 0.2);
    for (const v of VEINS) {
      const g = new THREE.Group();
      g.position.set(v.x, v.y - 0.15, v.z);
      g.rotation.y = (seed * 1.37) % (Math.PI * 2);
      const rock = new THREE.Mesh(rockFor(v, seed++), ROCK_MATS[v.type].clone());
      rock.position.y = 0.35;
      rock.castShadow = rock.receiveShadow = true;
      g.add(rock);
      // Ore showing through the surface: crystals for stone (quartz), knobbly nodules for iron.
      const ore = new THREE.Group();
      const n = v.type === 'stone' ? 9 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.sin(seed + i) * 0.4;
        const up = 0.15 + ((i * 37) % 10) / 22;
        // Coral grows as little branching fingers; sea glass and quartz as crystals; the rest as nodules.
        const geo = v.type === 'coral' ? new THREE.ConeGeometry(0.06, 0.45 + (i % 3) * 0.12, 5) : v.type === 'stone' || v.type === 'seaglass' ? new THREE.OctahedronGeometry(0.13 + (i % 3) * 0.04, 0).scale(0.7, 1.9, 0.7) : new THREE.DodecahedronGeometry(0.14 + (i % 3) * 0.03, 0);
        const m = new THREE.Mesh(geo, ORE_MATS[v.type]);
        const r = 0.82 * Math.cos(up * 1.2);
        m.position.set(Math.cos(a) * r, 0.35 + up * 0.75, Math.sin(a) * r);
        m.lookAt(new THREE.Vector3(Math.cos(a) * 3, 0.35 + up * 3, Math.sin(a) * 3));
        m.rotateX(Math.PI / 2);
        m.castShadow = true;
        ore.add(m);
      }
      g.add(ore);
      const rubble = new THREE.Mesh(rubbleGeo, RUBBLE_MAT);
      rubble.position.y = 0.12;
      rubble.visible = false;
      rubble.receiveShadow = true;
      g.add(rubble);
      g.scale.setScalar(v.r);
      this.group.add(g);
      this.views.set(v.id, { v, g, rock, ore, rubble, depleted: false, hit: 0 });
      this.colliders.push({ x: v.x, z: v.z, r: 0.85 * v.r });
    }
  }

  /** Server update: [id, 1] depleted, [id, 0] back. */
  setDepleted(list: [string, 0 | 1][]): void {
    for (const [id, s] of list) {
      const view = this.views.get(id);
      if (!view) continue;
      const gone = s === 1;
      view.depleted = gone;
      view.rock.visible = view.ore.visible = !gone;
      view.rubble.visible = gone;
    }
  }

  isDepleted(id: string): boolean { return !!this.views.get(id)?.depleted; }

  /** A little shake when your pickaxe lands. */
  hit(id: string): void { const v = this.views.get(id); if (v) v.hit = 1; }

  collidersNear(x: number, z: number, r = 40): Collider[] {
    return this.colliders.filter((c) => Math.abs(c.x - x) < r && Math.abs(c.z - z) < r);
  }

  /** The vein under the crosshair within reach, if any (ray vs. a sphere around each nearby vein). */
  target(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Vein | null {
    let best: Vein | null = null, bestT = Infinity;
    const c = new THREE.Vector3();
    for (const view of this.views.values()) {
      const v = view.v;
      if (Math.abs(v.x - origin.x) > reach + 3 || Math.abs(v.z - origin.z) > reach + 3) continue;
      c.set(v.x, v.y + 0.35 * v.r, v.z).sub(origin);
      const t = c.dot(dir);
      if (t < 0) continue;
      const d2 = c.lengthSq() - t * t, rad = 0.95 * v.r;
      if (d2 > rad * rad) continue;
      const hitT = t - Math.sqrt(rad * rad - d2);
      if (hitT < bestT && Math.hypot(v.x - origin.x, v.z - origin.z) <= reach + v.r) { bestT = hitT; best = v; }
    }
    return best;
  }

  setHighlight(id: string | null): void {
    const next = id ? this.views.get(id) ?? null : null;
    if (next === this.highlighted) return;
    if (this.highlighted) (this.highlighted.rock.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    this.highlighted = next;
    if (next) (next.rock.material as THREE.MeshStandardMaterial).emissive.setHex(0x2a2010);
  }

  animate(dt: number): void {
    for (const v of this.views.values()) {
      if (v.hit <= 0) continue;
      v.hit = Math.max(0, v.hit - dt * 5);
      const s = Math.sin(v.hit * 30) * v.hit * 0.04;
      v.g.position.x = v.v.x + s;
      v.g.position.z = v.v.z + s * 0.6;
    }
  }

  static typeName(v: Vein): string { return VEIN_TYPES[v.type].name; }
}
