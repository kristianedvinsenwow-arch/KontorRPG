/**
 * Procedural art helpers, ported from KontorLAN: everything is built from primitives in code and
 * painted with small canvas textures, so there is no asset pipeline and the download stays tiny.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = THREE.Vector3;
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- textures

type Painter = (g: CanvasRenderingContext2D, size: number) => void;

export function canvasTex(draw: Painter, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function speckle(g: CanvasRenderingContext2D, s: number, n: number, lo: number, hi: number, sz = 2) {
  for (let i = 0; i < n; i++) {
    const v = (lo + Math.random() * (hi - lo)) | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * s, Math.random() * s, sz, sz);
  }
}

export function grime(g: CanvasRenderingContext2D, s: number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = rand(8, s * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(70,55,40,${a})`);
    gr.addColorStop(1, 'rgba(70,55,40,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Grey-scale detail textures; the material colour (or vertex colour) tints them. */
export const TEX = {
  ground: canvasTex((g, s) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, 150, 255, 2);
    for (let i = 0; i < 900; i++) { // blades of grass
      const x = Math.random() * s, y = Math.random() * s, v = (120 + Math.random() * 110) | 0;
      g.strokeStyle = `rgba(${v},${v},${v},.7)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(3, 7)); g.stroke();
    }
    grime(g, s, 14, 0.1);
  }),
  rock: canvasTex((g, s) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, s, s);
    speckle(g, s, 12000, 120, 240, 2);
    g.strokeStyle = 'rgba(60,60,60,.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += rand(-30, 30); y += rand(-30, 30); g.lineTo(x, y); }
      g.stroke();
    }
    grime(g, s, 16, 0.18);
  }),
  cloth: canvasTex((g, s) => {
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`; g.fillRect(x, 0, 1, s); }
    speckle(g, s, 2500, 150, 230, 1);
    grime(g, s, 10, 0.12);
  }),
  wood: canvasTex((g, s) => {
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const y = Math.random() * s, v = (110 + Math.random() * 100) | 0;
      g.strokeStyle = `rgba(${v},${v},${v},.5)`; g.lineWidth = rand(1, 3);
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + rand(-6, 6), s * 0.6, y + rand(-6, 6), s, y); g.stroke();
    }
  }),
  bark: canvasTex((g, s) => {
    g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * s, v = (60 + Math.random() * 120) | 0;
      g.strokeStyle = `rgba(${v},${v},${v},.6)`; g.lineWidth = rand(1, 4);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rand(-8, 8), s); g.stroke();
    }
  }),
  leather: canvasTex((g, s) => {
    g.fillStyle = '#cccccc'; g.fillRect(0, 0, s, s);
    speckle(g, s, 6000, 150, 220, 1);
    grime(g, s, 20, 0.15);
  }),
};
export type TexKey = keyof typeof TEX;

const ROUGH: Record<TexKey, number> = { ground: 0.95, rock: 0.9, cloth: 0.95, wood: 0.7, bark: 0.95, leather: 0.75 };
const BUMP: Record<TexKey, number> = { ground: 0.6, rock: 1.2, cloth: 0.25, wood: 0.2, bark: 1.5, leather: 0.3 };

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached standard material: same colour + texture + options → same material (fewer draw calls once merged). */
export function mat(color: number, tex: TexKey | null = null, o: { r?: number; m?: number } = {}): THREE.MeshStandardMaterial {
  const k = `${color}|${tex}|${o.r}|${o.m}`;
  let m = matCache.get(k);
  if (!m) {
    const T = tex ? TEX[tex] : null;
    m = new THREE.MeshStandardMaterial({
      color,
      map: T,
      bumpMap: T,
      bumpScale: tex ? BUMP[tex] : 0,
      roughness: o.r ?? (tex ? ROUGH[tex] : 0.8),
      metalness: o.m ?? 0,
    });
    matCache.set(k, m);
  }
  return m;
}

// ---------------------------------------------------------------- geometry helpers

/** Box whose UVs are scaled by its real size, so textures keep the same density on every box. */
export function boxGeo(w: number, h: number, d: number, tile = 0.5): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
  }
  uv.needsUpdate = true;
  return g;
}

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = shadow;
  o.receiveShadow = shadow;
  parent.add(o);
  return o;
}

export function bx(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const o = mesh(boxGeo(w, h, d, 0.12), m, parent);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

export function ball(parent: THREE.Object3D, p: THREE.Vector3, r: number, m: THREE.Material, seg = 14) {
  const o = mesh(new THREE.SphereGeometry(r, seg, Math.max(6, (seg * 0.7) | 0)), m, parent);
  o.position.copy(p);
  return o;
}

/** A tapered cylinder from point a to point b — arms, legs, handles. */
export function limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, m: THREE.Material, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const o = mesh(new THREE.CylinderGeometry(r1, r0, L, seg), m, parent);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}

/**
 * Draw-call merging (KontorLAN's mergeDeep): static meshes that share a material and a parent are
 * baked into one mesh. Moving parts live in their own child groups, so they keep animating.
 */
export function mergeStatic(root: THREE.Object3D): void {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of parent.children) {
      if (!(c instanceof THREE.Mesh) || c.children.length || Array.isArray(c.material) || c.userData.keep) continue;
      const list = byMat.get(c.material) ?? [];
      list.push(c);
      byMat.set(c.material, list);
    }
    for (const [m, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((c) => {
        c.updateMatrix();
        const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      for (const c of list) { parent.remove(c); c.geometry.dispose(); }
      mesh(merged, m, parent, list[0].castShadow);
    }
  }
}

/** Floating name tag (KontorLAN's nameSprite). */
export function nameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 34px "Saira Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true, fog: false, toneMapped: false }));
  s.scale.set(1.6, 0.4, 1);
  s.position.y = 2.15;
  return s;
}
