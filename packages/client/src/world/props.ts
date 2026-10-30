/**
 * Vegetation and rocks. Stylised low-poly: faceted (flat-shaded) shapes with baked vertex-colour
 * gradients, per-instance colour variation, and grass and flowers that sway in the wind.
 * Everything is instanced: one draw call per kind per chunk.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, VEINS, WORLD_HALF, WATER_LEVEL, heightAt, mulberry32, keepClear, pathDist, treesInChunk } from '@kontor/shared';
import { registerTrees } from './trees.js';
import { canvasTex, TEX } from '../engine/procgen.js';

export interface Collider { x: number; z: number; r: number }

/** Shared clock for every wind-animated material. */
export const wind = { value: 0 };

// ------------------------------------------------------------------ geometry helpers

/** Jitter vertices (seeded), then make the geometry faceted with a vertical colour gradient. */
export function faceted(geo: THREE.BufferGeometry, seed: number, jitter: number, bottom: THREE.Color, top: THREE.Color, y0: number, y1: number, moss?: THREE.Color): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  // Jitter by original vertex position so shared corners stay shared (no cracks).
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = offsets.get(k);
    if (!o) { o = [(rng() - 0.5) * jitter, (rng() - 0.5) * jitter * 0.6, (rng() - 0.5) * jitter]; offsets.set(k, o); }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    c.copy(bottom).lerp(top, t);
    if (moss) c.lerp(moss, THREE.MathUtils.smoothstep(n.getY(i), 0.55, 0.9) * 0.75);
    const shade = 0.92 + rng() * 0.16; // per-face variation reads as texture at a distance
    col.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function pineCrownGeo(): THREE.BufferGeometry {
  const layers: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 1.75 - t * 1.25, h = 1.9 - t * 0.5, y = 1.5 + i * 0.95;
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0);
    cone.rotateY(i * 0.7);
    layers.push(cone);
  }
  return faceted(mergeGeometries(layers.map((g) => g.toNonIndexed()))!, 11, 0.22, new THREE.Color(0x1c3019), new THREE.Color(0x40683a), 1.5, 7);
}

function birchCrownGeo(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(1.25, 0).translate(0, 3.9, 0),
    new THREE.IcosahedronGeometry(0.95, 0).translate(0.7, 3.4, 0.2),
    new THREE.IcosahedronGeometry(0.9, 0).translate(-0.6, 3.5, -0.3),
    new THREE.IcosahedronGeometry(0.85, 0).translate(0.1, 4.7, 0.1),
  ];
  return faceted(mergeGeometries(parts.map((g) => g.toNonIndexed()))!, 21, 0.25, new THREE.Color(0x45612a), new THREE.Color(0x7f9a3e), 2.8, 5.4);
}

/** A low, lumpy shrub; berry bushes get red speckles. */
function bushGeo(seed: number, berries: boolean): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(0.6, 0).translate(0, 0.45, 0),
    new THREE.IcosahedronGeometry(0.45, 0).translate(0.45, 0.35, 0.15),
    new THREE.IcosahedronGeometry(0.42, 0).translate(-0.4, 0.33, -0.1),
  ];
  const g = faceted(mergeGeometries(parts.map((p) => p.toNonIndexed()))!, seed, 0.2, new THREE.Color(0x2c4a22), new THREE.Color(0x5a7a34), 0, 1);
  if (berries) {
    const col = g.attributes.color as THREE.BufferAttribute, rng = mulberry32(seed);
    for (let i = 0; i < col.count; i += 3) if (rng() < 0.18) for (let k = 0; k < 3; k++) col.setXYZ(i + k, 0.7, 0.1, 0.12);
  }
  return g;
}

export function rockGeo(seed: number, flat: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.8, 1).scale(1, flat, 1);
  return faceted(g, seed, 0.38, new THREE.Color(0x6c6a64), new THREE.Color(0x9a978f), -0.5, 0.6, new THREE.Color(0x667a3c));
}

/** A tuft: three crossed quads textured with grass blades; uv.y drives the wind (tips move, roots don't). */
function tuftGeo(w: number, h: number): THREE.BufferGeometry {
  const quads = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0).rotateY(a));
  return mergeGeometries(quads)!;
}

const bladesTex = canvasTex((g, s) => {
  g.clearRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = s * (0.08 + Math.random() * 0.84), lean = (Math.random() - 0.5) * s * 0.25, top = s * (0.05 + Math.random() * 0.4);
    const w = s * (0.025 + Math.random() * 0.02);
    const v = 150 + Math.random() * 100;
    g.fillStyle = `rgb(${v * 0.75 | 0},${v | 0},${v * 0.55 | 0})`;
    g.beginPath(); g.moveTo(x - w, s); g.quadraticCurveTo(x + lean * 0.4, s * 0.55, x + lean, top); g.quadraticCurveTo(x + lean * 0.4 + w * 0.5, s * 0.55, x + w, s); g.fill();
  }
}, 128);
bladesTex.wrapS = bladesTex.wrapT = THREE.ClampToEdgeWrapping;

function flowerTex(petal: string): THREE.CanvasTexture {
  const t = canvasTex((g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 7; i++) {
      const x = s * (0.15 + Math.random() * 0.7), top = s * (0.15 + Math.random() * 0.35);
      g.strokeStyle = '#5d7a35'; g.lineWidth = s * 0.02;
      g.beginPath(); g.moveTo(x, s); g.lineTo(x + (Math.random() - 0.5) * s * 0.1, top); g.stroke();
      g.fillStyle = petal;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.26) * s * 0.035, top + Math.sin(k * 1.26) * s * 0.035, s * 0.035, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#f2d24a'; g.beginPath(); g.arc(x, top, s * 0.02, 0, Math.PI * 2); g.fill();
    }
  }, 128);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Standard material + vertex sway for things that bend in the wind. */
function windMaterial(map: THREE.Texture, color: number, strength: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uWind * 1.7 + ip.x * 0.35 + ip.z * 0.27) * 0.6 + sin(uWind * 3.1 + ip.x * 0.9) * 0.25;
        transformed.x += sway * ${strength.toFixed(3)} * uv.y * uv.y;
        transformed.z += sway * ${(strength * 0.6).toFixed(3)} * uv.y * uv.y;`);
  };
  // Grass normals point up so tufts light like the ground beneath them instead of like thin cards.
  return m;
}

const birchBark = canvasTex((g, s) => {
  g.fillStyle = '#ecebe4'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,30,28,${0.5 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * s, Math.random() * s, 6 + Math.random() * 30, 2 + Math.random() * 4);
  }
}, 128);

export const PROP = {
  pineTrunk: { geo: new THREE.CylinderGeometry(0.12, 0.24, 2.4, 7).translate(0, 1.2, 0), mat: new THREE.MeshStandardMaterial({ color: 0x5b4330, map: TEX.bark, bumpMap: TEX.bark, bumpScale: 1.2, roughness: 0.95 }) },
  pineCrown: { geo: pineCrownGeo(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 }) },
  birchTrunk: { geo: new THREE.CylinderGeometry(0.08, 0.14, 3.6, 7).translate(0, 1.8, 0), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, map: birchBark, roughness: 0.8 }) },
  birchCrown: { geo: birchCrownGeo(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }) },
  rockA: { geo: rockGeo(3, 0.7), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }) },
  rockB: { geo: rockGeo(7, 0.5), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }) },
  grass: { geo: tuftGeo(0.8, 0.45), mat: windMaterial(bladesTex, 0x6f8c42, 0.1) },
  reed: { geo: tuftGeo(0.45, 1.3), mat: windMaterial(bladesTex, 0x4f6a30, 0.12) },
  bush: { geo: bushGeo(5, false), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }) },
  berryBush: { geo: bushGeo(9, true), mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }) },
  heather: { geo: tuftGeo(0.55, 0.38), mat: windMaterial(flowerTex('#b77fc9'), 0xffffff, 0.06) },
  buttercup: { geo: tuftGeo(0.5, 0.42), mat: windMaterial(flowerTex('#f4d54a'), 0xffffff, 0.07) },
  cotton: { geo: tuftGeo(0.5, 0.45), mat: windMaterial(flowerTex('#f4f2ea'), 0xffffff, 0.08) },
};
// Shadows from thousands of grass cards cost a lot and look noisy; only the big things cast.
const CASTS: Partial<Record<PropKey, boolean>> = { pineTrunk: true, pineCrown: true, birchTrunk: true, birchCrown: true, rockA: true, rockB: true, bush: true, berryBush: true };
type PropKey = keyof typeof PROP;

/** Scatter one chunk's props deterministically, filling `colliders` for trees and big rocks. */
/** Real ore veins (and their mining space) come from shared data; keep scenery off them. */
function nearVein(x: number, z: number, d: number): boolean {
  for (const v of VEINS) if (Math.abs(v.x - x) < d + v.r && Math.abs(v.z - z) < d + v.r && Math.hypot(v.x - x, v.z - z) < d + v.r) return true;
  return false;
}

export function buildProps(cx: number, cz: number, colliders: Collider[], dense: boolean): THREE.Object3D[] {
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5eed);
  const items: Partial<Record<PropKey, { m: THREE.Matrix4; c: THREE.Color }[]>> = {};
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), N = new THREE.Vector3();
  const add = (k: PropKey, x: number, y: number, z: number, s: number, ry: number, sy = s, tint = 1) => {
    q.setFromAxisAngle(up, ry);
    (items[k] ??= []).push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, sy, s)), c: new THREE.Color(tint, tint, tint) });
  };
  const normalAt = (x: number, z: number) => {
    const e = 0.6;
    return N.set(-(heightAt(x + e, z) - heightAt(x - e, z)), 2 * e, -(heightAt(x, z + e) - heightAt(x, z - e))).normalize();
  };
  const inWorld = (x: number, z: number) => Math.abs(x) < WORLD_HALF - 2 && Math.abs(z) < WORLD_HALF - 2;

  // Rocks (decoration only).
  for (let i = 0; i < 70; i++) {
    const x = cx * CHUNK_SIZE + rng() * CHUNK_SIZE, z = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const y = heightAt(x, z);
    normalAt(x, z);
    if (y < WATER_LEVEL + 0.6 || Math.hypot(x, z) < 18 || !inWorld(x, z) || nearVein(x, z, 2.6) || keepClear(x, z)) continue;
    const roll = rng(), ry = rng() * Math.PI * 2, tint = 0.85 + rng() * 0.3;
    if (N.y < 0.8 || y > 16) {
      const s = 0.7 + rng() * 1.3;
      if (roll < 0.6) add(roll < 0.45 ? 'rockA' : 'rockB', x, y + 0.05, z, s, ry, s, tint);
      else continue;
      colliders.push({ x, z, r: 0.75 * s });
    } else if (roll > 0.9) {
      const s = 0.3 + rng() * 0.5;
      add(roll < 0.95 ? 'rockA' : 'rockB', x, y + 0.02, z, s, ry, s, tint);
      if (s > 0.55) colliders.push({ x, z, r: 0.7 * s });
    }
  }
  // Trees: every one is a real, fellable tree from shared data (same ids as the server).
  const treeSlots: { id: string; k: 'pine' | 'birch'; t: number; c: number }[] = [];
  for (const t of treesInChunk(cx, cz)) {
    const trunk = t.kind === 'pine' ? 'pineTrunk' : 'birchTrunk', crown = t.kind === 'pine' ? 'pineCrown' : 'birchCrown';
    treeSlots.push({ id: t.id, k: t.kind, t: items[trunk]?.length ?? 0, c: items[crown]?.length ?? 0 });
    add(trunk, t.x, t.y - 0.1, t.z, t.s, t.ry);
    add(crown, t.x, t.y - 0.1, t.z, t.s, t.ry, t.kind === 'pine' ? t.s * 1.05 : t.s, t.tint);
    colliders.push({ x: t.x, z: t.z, r: (t.kind === 'pine' ? 0.3 : 0.22) * t.s });
  }

  // Bushes along forest edges and hillsides.
  for (let i = 0; i < 26; i++) {
    const x = cx * CHUNK_SIZE + rng() * CHUNK_SIZE, z = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const y = heightAt(x, z);
    const s = 0.5 + rng() * 0.7, ry = rng() * 6.28, roll = rng();
    if (y < WATER_LEVEL + 0.5 || y > 14 || !inWorld(x, z) || keepClear(x, z) || pathDist(x, z) < 2 || nearVein(x, z, 2)) continue;
    if (normalAt(x, z).y < 0.85) continue;
    add(roll < 0.3 ? 'berryBush' : 'bush', x, y - 0.1, z, s, ry, s * (0.8 + rng() * 0.3), 0.85 + rng() * 0.3);
  }

  // Ground cover: grass everywhere it's green and gentle, flower patches here and there.
  const tufts = dense ? 1400 : 500;
  for (let i = 0; i < tufts; i++) {
    const x = cx * CHUNK_SIZE + rng() * CHUNK_SIZE, z = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const y = heightAt(x, z);
    if (y > 15 || !inWorld(x, z)) continue;
    // Reeds in the shallows.
    if (y < WATER_LEVEL + 0.35) { if (y > WATER_LEVEL - 0.7 && rng() < 0.5) add('reed', x, y - 0.05, z, 0.8 + rng() * 0.5, rng() * 3, 1 + rng() * 0.6, 0.8 + rng() * 0.3); continue; }
    if (normalAt(x, z).y < 0.86) continue;
    if (pathDist(x, z) < 1.1) continue; // keep the paths clear
    const s = 0.7 + rng() * 0.7, ry = rng() * Math.PI;
    const patch = Math.sin(x * 0.13 + z * 0.07) * Math.cos(z * 0.11 - x * 0.05);
    const r = rng();
    if (patch > 0.55 && r < 0.35) add(r < 0.17 ? 'heather' : 'buttercup', x, y - 0.03, z, s, ry, s, 1);
    else if (y < 1.6 && r < 0.12) add('cotton', x, y - 0.03, z, s, ry, s, 1); // bog cotton by the water
    else add('grass', x, y - 0.04, z, s, ry, s * (0.8 + rng() * 0.6), 0.8 + rng() * 0.35);
  }

  const out: THREE.Object3D[] = [];
  const meshes: Partial<Record<PropKey, THREE.InstancedMesh>> = {};
  for (const [k, list] of Object.entries(items) as [PropKey, { m: THREE.Matrix4; c: THREE.Color }[]][]) {
    const p = PROP[k];
    const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
    meshes[k] = im;
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
    im.castShadow = !!CASTS[k];
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  registerTrees(treeSlots.map((t) => ({ id: t.id, kind: t.k, trunk: meshes[t.k === 'pine' ? 'pineTrunk' : 'birchTrunk']!, crown: meshes[t.k === 'pine' ? 'pineCrown' : 'birchCrown']!, ti: t.t, ci: t.c })));
  return out;
}
