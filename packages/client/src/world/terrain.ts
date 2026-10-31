/**
 * Terrain streaming. The world is split into CHUNK_SIZE squares built on demand from the shared
 * deterministic height function and disposed when far away — the same mechanism will carry the
 * full 6 × 6 km map. Each chunk also scatters its own trees, rocks and decorative ore veins.
 */
import * as THREE from 'three';
import { CHUNK_SIZE, GRUBEN, GRUBEN_SPOTS, WATER_LEVEL, chunkExists, heightAt, inGruben, mulberry32, pathDist } from '@kontor/shared';
import { TEX } from '../engine/procgen.js';
import { buildProps, wind, type Collider } from './props.js';
import { Water } from './water.js';

export type { Collider };

const SEG = 48; // grid cells per chunk side (~1.33 m)
const LOAD_RADIUS = 2; // chunks around the player kept loaded


interface Chunk {
  key: string;
  group: THREE.Group;
  colliders: Collider[];
}

const C = {
  grassLo: new THREE.Color(0x5f7d3c),
  grassHi: new THREE.Color(0x7f9548),
  dirt: new THREE.Color(0x7a6548),
  path: new THREE.Color(0x8a7556),
  sand: new THREE.Color(0xa69676),
  rock: new THREE.Color(0x7c7a74),
  snow: new THREE.Color(0xe8eef0),
  heath: new THREE.Color(0x6c6a4a),
  heathHi: new THREE.Color(0x7d6f52),
  slag: new THREE.Color(0x3c3a38),
  bog: new THREE.Color(0x4a5634),
};

const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.ground, bumpMap: TEX.ground, bumpScale: 0.8, roughness: 0.96, envMapIntensity: 0.6 });

function normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

function buildGround(cx: number, cz: number): THREE.Mesh {
  const n = SEG + 1;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3);
  const step = CHUNK_SIZE / SEG, x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const N = new THREE.Vector3(), c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = x0 + i * step, z = z0 + j * step, y = heightAt(x, z);
    pos.set([x, y, z], k * 3);
    normalAt(x, z, N);
    nor.set([N.x, N.y, N.z], k * 3);
    uv.set([x / 3, z / 3], k * 2); // world-space UVs: seamless across chunks
    // Colour by height and slope: shore sand, grass, dirt patches, rock on cliffs, snow on peaks.
    const v = (Math.sin(x * 0.11) * Math.cos(z * 0.09) + Math.sin(x * 0.031 + z * 0.047)) * 0.25 + 0.5;
    c.copy(C.grassLo).lerp(C.grassHi, v);
    if (v > 0.8) c.lerp(C.dirt, (v - 0.8) * 2.5);
    if (inGruben(x, z)) {
      // Gruben: worn heath, dark slag around the pit, mossy bog in the south-west.
      c.copy(C.heath).lerp(C.heathHi, v);
      const lx = x - GRUBEN.x, lz = z - GRUBEN.z, P = GRUBEN_SPOTS.pit;
      c.lerp(C.slag, 1 - THREE.MathUtils.smoothstep(Math.hypot(lx - P.x, lz - P.z), P.r * 0.6, P.r + 14));
      c.lerp(C.bog, (1 - THREE.MathUtils.smoothstep(Math.hypot(lx + 42, lz + 46), 6, 16)) * 0.8);
    }
    // Trodden dirt paths between the places people go.
    const pd = pathDist(x, z);
    if (pd < 2.2) c.lerp(C.path, (1 - THREE.MathUtils.smoothstep(pd, 0.9, 2.2)) * 0.85);
    if (y < WATER_LEVEL + 0.8) c.lerp(C.sand, THREE.MathUtils.smoothstep(WATER_LEVEL + 0.8 - y, 0, 0.8));
    const steep = THREE.MathUtils.smoothstep(1 - N.y, 0.18, 0.4);
    c.lerp(C.rock, steep);
    const snowAt = x > 600 ? 24 : 18;
    if (y > snowAt) c.lerp(C.snow, THREE.MathUtils.smoothstep(y, snowAt, snowAt + 6) * (1 - steep * 0.6));
    col.set([c.r, c.g, c.b], k * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, groundMat);
  m.receiveShadow = true;
  return m;
}

export class Terrain {
  private chunks = new Map<string, Chunk>();
  readonly root = new THREE.Group();
  private water: Water;
  /** Fewer grass tufts on low quality. Changing it rebuilds chunks as they stream. */
  dense = true;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.water = new Water(scene);
  }

  /** Wind sway for grass and flowers, ripples on the water. */
  animate(t: number): void {
    wind.value = t;
    this.water.animate(t);
  }

  /** Load chunks around (x, z) and drop ones that are far away. Returns how many were built. */
  update(x: number, z: number, maxBuilds = 2): number {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    const want = new Set<string>();
    const queue: [number, number, number][] = [];
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      if (!chunkExists(cx, cz)) continue;
      const key = `${cx},${cz}`;
      want.add(key);
      if (!this.chunks.has(key)) queue.push([cx, cz, dx * dx + dz * dz]);
    }
    queue.sort((a, b) => a[2] - b[2]); // nearest first, a few per frame to avoid hitches
    let built = 0;
    for (const [cx, cz] of queue) {
      if (built >= maxBuilds) break;
      const key = `${cx},${cz}`;
      const group = new THREE.Group();
      const colliders: Collider[] = [];
      group.add(buildGround(cx, cz));
      for (const o of buildProps(cx, cz, colliders, this.dense)) group.add(o);
      this.root.add(group);
      this.chunks.set(key, { key, group, colliders });
      built++;
    }
    for (const [key, ch] of this.chunks) {
      if (want.has(key)) continue;
      this.root.remove(ch.group);
      ch.group.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose(); if (o instanceof THREE.InstancedMesh) o.dispose(); });
      this.chunks.delete(key);
    }
    return built;
  }

  /** Colliders in the chunk at (x, z) and its neighbours. */
  collidersNear(x: number, z: number): Collider[] {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    const out: Collider[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ch = this.chunks.get(`${pcx + dx},${pcz + dz}`);
      if (ch) out.push(...ch.colliders);
    }
    return out;
  }

  get loaded(): number { return this.chunks.size; }
}
