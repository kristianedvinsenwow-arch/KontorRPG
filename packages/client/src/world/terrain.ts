/**
 * Terrain streaming. The world is split into CHUNK_SIZE squares built on demand from the shared
 * deterministic height function and disposed when far away — the same mechanism will carry the
 * full 6 × 6 km map. Each chunk also scatters its own trees, rocks and decorative ore veins.
 */
import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HALF, WATER_LEVEL, heightAt, mulberry32 } from '@kontor/shared';
import { TEX, mat } from '../engine/procgen.js';

const SEG = 48; // grid cells per chunk side (~1.33 m)
const LOAD_RADIUS = 2; // chunks around the player kept loaded

export interface Collider { x: number; z: number; r: number }

interface Chunk {
  key: string;
  group: THREE.Group;
  colliders: Collider[];
}

const C = {
  grassLo: new THREE.Color(0x5f7d3c),
  grassHi: new THREE.Color(0x7f9548),
  dirt: new THREE.Color(0x7a6548),
  sand: new THREE.Color(0xa69676),
  rock: new THREE.Color(0x7c7a74),
  snow: new THREE.Color(0xe8eef0),
};

const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.ground, bumpMap: TEX.ground, bumpScale: 0.5, roughness: 0.95 });

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
    if (y < WATER_LEVEL + 0.8) c.lerp(C.sand, THREE.MathUtils.smoothstep(WATER_LEVEL + 0.8 - y, 0, 0.8));
    const steep = THREE.MathUtils.smoothstep(1 - N.y, 0.18, 0.4);
    c.lerp(C.rock, steep);
    if (y > 18) c.lerp(C.snow, THREE.MathUtils.smoothstep(y, 18, 24) * (1 - steep * 0.6));
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

// ---- props: shared geometries, one InstancedMesh per kind per chunk ----
const PROP = {
  pineTrunk: { geo: new THREE.CylinderGeometry(0.12, 0.2, 2.2, 7).translate(0, 1.1, 0), mat: mat(0x5a4330, 'bark') },
  pineLow: { geo: new THREE.ConeGeometry(1.5, 2.6, 8).translate(0, 2.4, 0), mat: mat(0x2f4a2a, 'ground', { r: 0.95 }) },
  pineMid: { geo: new THREE.ConeGeometry(1.15, 2.2, 8).translate(0, 3.6, 0), mat: mat(0x34532e, 'ground', { r: 0.95 }) },
  pineTop: { geo: new THREE.ConeGeometry(0.75, 1.8, 8).translate(0, 4.7, 0), mat: mat(0x3a5c32, 'ground', { r: 0.95 }) },
  birchTrunk: { geo: new THREE.CylinderGeometry(0.09, 0.14, 3.4, 7).translate(0, 1.7, 0), mat: mat(0xe6e2d8, 'bark') },
  birchCrown: { geo: new THREE.IcosahedronGeometry(1.3, 1).scale(1, 1.25, 1).translate(0, 3.9, 0), mat: mat(0x6f8f3c, 'ground', { r: 0.95 }) },
  rock: { geo: new THREE.IcosahedronGeometry(0.8, 1), mat: mat(0x8a8780, 'rock') },
  ore: { geo: new THREE.IcosahedronGeometry(0.75, 1), mat: mat(0x6d625a, 'rock') },
  oreFleck: { geo: new THREE.OctahedronGeometry(0.16, 0), mat: mat(0xb0643a, null, { r: 0.4, m: 0.6 }) },
};
// Lumpy rocks: displace once, shared by every instance.
for (const g of [PROP.rock.geo, PROP.ore.geo]) {
  const p = g.attributes.position;
  const rng = mulberry32(99);
  for (let i = 0; i < p.count; i++) {
    const s = 0.8 + rng() * 0.35;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.75, p.getZ(i) * s);
  }
  g.computeVertexNormals();
}

type PropKey = keyof typeof PROP;

function buildProps(cx: number, cz: number, colliders: Collider[]): THREE.Object3D[] {
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5eed);
  const mats: Partial<Record<PropKey, THREE.Matrix4[]>> = {};
  const add = (k: PropKey, m: THREE.Matrix4) => (mats[k] ??= []).push(m);
  const M = (x: number, y: number, z: number, s: number, ry: number, sy = s) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, sy, s));
  const N = new THREE.Vector3();

  const tries = 70;
  for (let i = 0; i < tries; i++) {
    const x = cx * CHUNK_SIZE + rng() * CHUNK_SIZE, z = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const y = heightAt(x, z);
    normalAt(x, z, N);
    const spawnDist = Math.hypot(x, z);
    if (y < WATER_LEVEL + 0.6 || spawnDist < 18 || Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
    const roll = rng();
    const ry = rng() * Math.PI * 2;
    if (N.y < 0.8 || y > 16) {
      // Steep or high ground: rocks and the occasional ore vein.
      const s = 0.7 + rng() * 1.3;
      if (roll < 0.25 && y > 5) {
        add('ore', M(x, y + 0.1, z, s, ry));
        for (let f = 0; f < 4; f++) {
          const a = rng() * Math.PI * 2;
          add('oreFleck', M(x + Math.cos(a) * 0.55 * s, y + 0.35 * s + rng() * 0.2, z + Math.sin(a) * 0.55 * s, s * (0.7 + rng() * 0.5), rng() * 3));
        }
      } else if (roll < 0.6) add('rock', M(x, y + 0.1, z, s, ry));
      else continue;
      colliders.push({ x, z, r: 0.75 * s });
    } else if (roll < 0.55) {
      const s = 0.8 + rng() * 0.6;
      for (const k of ['pineTrunk', 'pineLow', 'pineMid', 'pineTop'] as const) add(k, M(x, y - 0.1, z, s, ry));
      colliders.push({ x, z, r: 0.3 * s });
    } else if (roll < 0.8) {
      const s = 0.8 + rng() * 0.5;
      add('birchTrunk', M(x, y - 0.1, z, s, ry));
      add('birchCrown', M(x, y - 0.1, z, s, ry));
      colliders.push({ x, z, r: 0.22 * s });
    } else if (roll < 0.9) {
      const s = 0.3 + rng() * 0.5;
      add('rock', M(x, y + 0.05, z, s, ry));
      if (s > 0.55) colliders.push({ x, z, r: 0.7 * s });
    }
  }

  const out: THREE.Object3D[] = [];
  for (const [k, list] of Object.entries(mats) as [PropKey, THREE.Matrix4[]][]) {
    const p = PROP[k];
    const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = k !== 'oreFleck';
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

export class Terrain {
  private chunks = new Map<string, Chunk>();
  readonly root = new THREE.Group();
  private water: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    const size = WORLD_HALF * 2 + 400;
    const waterGeo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: 0x2f5c6b, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.85 }));
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  /** Load chunks around (x, z) and drop ones that are far away. Returns how many were built. */
  update(x: number, z: number, maxBuilds = 2): number {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    const min = -Math.ceil(WORLD_HALF / CHUNK_SIZE), max = Math.ceil(WORLD_HALF / CHUNK_SIZE) - 1;
    const want = new Set<string>();
    const queue: [number, number, number][] = [];
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < min || cx > max || cz < min || cz > max) continue;
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
      for (const o of buildProps(cx, cz, colliders)) group.add(o);
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
