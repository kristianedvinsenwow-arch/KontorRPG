/**
 * Fellable trees. Trees are drawn as instanced meshes per terrain chunk (see props.ts); this module
 * remembers which instance is which tree, so a felled tree can be hidden, replaced by a copy that
 * topples over and sinks away, and leave a stump until the server says it has grown back.
 */
import * as THREE from 'three';
import { TREE_BY_ID, TREE_TYPES, type Tree } from '@kontor/shared';
import { mat } from '../engine/procgen.js';

interface Slot { id: string; kind: 'pine' | 'birch'; trunk: THREE.InstancedMesh; crown: THREE.InstancedMesh; ti: number; ci: number }

const slots = new Map<string, Slot>();
const depleted = new Set<string>();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
let scene: THREE.Scene | null = null;
const stumps = new Map<string, THREE.Mesh>();
const falling: { g: THREE.Group; t: number; axis: THREE.Vector3; y0: number }[] = [];
const stumpGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.4, 8).translate(0, 0.2, 0);
const stumpMat = { pine: mat(0x5b4330, 'bark'), birch: mat(0xd9d6cc, 'bark') };
const cutMat = mat(0xd8b884, 'wood');

export function initTrees(s: THREE.Scene): void { scene = s; }

/** Called by props.ts when a chunk is built. */
export function registerTrees(list: Slot[]): void {
  for (const s of list) {
    slots.set(s.id, s);
    if (depleted.has(s.id)) hide(s);
  }
}

function hide(s: Slot) {
  s.trunk.setMatrixAt(s.ti, ZERO); s.trunk.instanceMatrix.needsUpdate = true;
  s.crown.setMatrixAt(s.ci, ZERO); s.crown.instanceMatrix.needsUpdate = true;
}

function show(s: Slot, t: Tree) {
  const m = treeMatrix(t, false), mc = treeMatrix(t, true);
  s.trunk.setMatrixAt(s.ti, m); s.trunk.instanceMatrix.needsUpdate = true;
  s.crown.setMatrixAt(s.ci, mc); s.crown.instanceMatrix.needsUpdate = true;
}

function treeMatrix(t: Tree, crown: boolean): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
  const sy = crown && t.kind === 'pine' ? t.s * 1.05 : t.s;
  return new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y - 0.1, t.z), q, new THREE.Vector3(t.s, sy, t.s));
}

function addStump(t: Tree) {
  if (!scene || stumps.has(t.id)) return;
  const m = new THREE.Mesh(stumpGeo, stumpMat[t.kind]);
  m.position.set(t.x, t.y - 0.05, t.z);
  m.scale.setScalar(t.s * (t.kind === 'pine' ? 1.1 : 0.85));
  m.castShadow = m.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2), cutMat);
  top.position.y = 0.401;
  m.add(top);
  scene.add(m);
  stumps.set(t.id, m);
}

/** Server update: [id, 1] felled, [id, 0] grown back. `animate` = play the fall (it just happened). */
export function setTreesDepleted(list: [string, 0 | 1][], animate: boolean): void {
  for (const [id, v] of list) {
    const t = TREE_BY_ID.get(id);
    if (!t) continue;
    const s = slots.get(id);
    if (v === 1) {
      if (depleted.has(id)) continue;
      depleted.add(id);
      if (s) { hide(s); if (animate) topple(s, t); }
      addStump(t);
    } else {
      depleted.delete(id);
      if (s) show(s, t);
      const st = stumps.get(id);
      if (st) { scene?.remove(st); stumps.delete(id); }
    }
  }
}

export const isTreeDown = (id: string) => depleted.has(id);

/** A copy of the tree that falls over (away from the camera) and sinks into the ground. */
function topple(s: Slot, t: Tree) {
  if (!scene) return;
  const g = new THREE.Group();
  g.position.set(t.x, t.y - 0.1 + 0.4 * t.s, t.z);
  const body = new THREE.Group();
  body.position.y = -0.4 * t.s;
  g.add(body);
  for (const [im, crown] of [[s.trunk, false], [s.crown, true]] as const) {
    const m = new THREE.Mesh(im.geometry, im.material as THREE.Material);
    m.rotation.y = t.ry;
    m.scale.set(t.s, crown && t.kind === 'pine' ? t.s * 1.05 : t.s, t.s);
    if (crown) {
      // Instanced crowns get their tint from instance colours; plain meshes need vertex colours, which the geometry has.
      m.material = (im.material as THREE.MeshStandardMaterial).clone();
    }
    m.castShadow = true;
    body.add(m);
  }
  scene.add(g);
  const a = Math.random() * Math.PI * 2;
  falling.push({ g, t: 0, axis: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), y0: g.position.y });
}

export function animateTrees(dt: number): void {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.t += dt;
    // Accelerating fall for 1.3 s, a short rest, then sink and fade.
    const k = Math.min(1, (f.t / 1.3) ** 2);
    f.g.quaternion.setFromAxisAngle(f.axis, k * (Math.PI / 2 - 0.08));
    if (f.t > 2.2) f.g.position.y = f.y0 - (f.t - 2.2) * 1.4;
    if (f.t > 4) { scene?.remove(f.g); falling.splice(i, 1); }
  }
}

/** The standing tree under the crosshair within reach (ray vs. a cylinder around each trunk). */
export function targetTree(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Tree | null {
  let best: Tree | null = null, bestT = Infinity;
  for (const s of slots.values()) {
    const t = TREE_BY_ID.get(s.id);
    if (!t || depleted.has(t.id)) continue;
    if (Math.abs(t.x - origin.x) > reach + 2 || Math.abs(t.z - origin.z) > reach + 2) continue;
    // Horizontal ray vs. circle of radius ~0.5 m, then check the hit height is on the trunk.
    const r = 0.55 * t.s;
    const ox = origin.x - t.x, oz = origin.z - t.z;
    const a = dir.x * dir.x + dir.z * dir.z, b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (a < 1e-6 || disc < 0) continue;
    const hit = (-b - Math.sqrt(disc)) / (2 * a);
    if (hit < 0 || hit > bestT) continue;
    const y = origin.y + dir.y * hit;
    if (y < t.y - 0.3 || y > t.y + 3.5 * t.s) continue;
    if (Math.hypot(t.x - origin.x, t.z - origin.z) > reach + r) continue;
    bestT = hit; best = t;
  }
  return best;
}

export const treeName = (t: Tree) => TREE_TYPES[t.kind].name;
