/**
 * Sjøgrotta, the Sea Grotto: wet blue-black rock, glowing pools you can fish, luminous anemones
 * and shell-pale crystals in the walls, a barnacled arch across the way into the lair, and the
 * Kraken's black pool at the bottom. Built like the Old Mine (one heightfield for floor and walls,
 * one for the ceiling) and only shown while you're down here.
 */
import * as THREE from 'three';
import { GROTTO, GROTTO_GATE, GROTTO_POOLS, GROTTO_ROOMS, GROTTO_TUNNELS, caveFloor, mulberry32 } from '@kontor/shared';
import { mat, bx, mesh } from '../engine/procgen.js';
import { addLabel } from '../engine/labels.js';

const X0 = -34, X1 = 34, Z0 = -108, Z1 = 14, STEP = 0.7, WALL = 7.5;

type P = [number, number];
const distSeg = (px: number, pz: number, a: P, b: P) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
};
/** Open space (rooms and tunnels), pools included: the rock's shape. */
function open(x: number, z: number): number {
  const lx = x - GROTTO.x, lz = z - GROTTO.z;
  let best = -Infinity;
  for (const [a, b, w] of GROTTO_TUNNELS) best = Math.max(best, w / 2 - distSeg(lx, lz, a, b));
  for (const r of GROTTO_ROOMS) best = Math.max(best, r.r - Math.hypot(lx - r.c[0], lz - r.c[1]));
  return best;
}
/** How deep inside a pool (positive), else negative. */
function pool(x: number, z: number): number {
  const lx = x - GROTTO.x, lz = z - GROTTO.z;
  let best = -Infinity;
  for (const p of GROTTO_POOLS) best = Math.max(best, p.r - Math.hypot(lx - p.c[0], lz - p.c[1]));
  return best;
}

function grid(height: (x: number, z: number) => number, color: (x: number, z: number, y: number) => THREE.Color, flip: boolean): THREE.Mesh {
  const nx = Math.ceil((X1 - X0) / STEP) + 1, nz = Math.ceil((Z1 - Z0) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = GROTTO.x + X0 + i * STEP, z = GROTTO.z + Z0 + j * STEP;
    const y = height(x, z);
    pos.set([x, y, z], (j * nx + i) * 3);
    const c = color(x, z, y);
    col.set([c.r, c.g, c.b], (j * nx + i) * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if (flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, flatShading: true }));
}

export class GrottoView {
  readonly group = new THREE.Group();
  private glows: { m: THREE.MeshStandardMaterial; base: number; ph: number }[] = [];
  private lights: THREE.PointLight[] = [];
  private water: THREE.MeshStandardMaterial[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.visible = false;
    const rng = mulberry32(4711);
    const noise = (x: number, z: number) => Math.sin(x * 0.8 + z * 0.35) * 0.4 + Math.cos(z * 1.1 - x * 0.45) * 0.3;
    const floorC = new THREE.Color(0x2e3a40), wallC = new THREE.Color(0x3c4c56), wet = new THREE.Color(0x1e2a30), sand = new THREE.Color(0x5a564a);
    this.group.add(grid(
      (x, z) => {
        const p = pool(x, z);
        if (p > -0.3) return caveFloor(x, z) - 1.4 * THREE.MathUtils.smoothstep(p, -0.3, 1.2); // a basin under the water
        const wall = THREE.MathUtils.smoothstep(-open(x, z), -0.2, 1.8);
        return caveFloor(x, z) + wall * (WALL + noise(x, z)) + (wall > 0.05 ? noise(x * 2, z * 2) * 0.35 : 0);
      },
      (x, z, y) => {
        const c = new THREE.Color().copy(floorC).lerp(wallC, THREE.MathUtils.clamp(y / 3, 0, 1));
        if (y < caveFloor(x, z) + 0.2 && Math.sin(x * 0.4) * Math.cos(z * 0.33) > 0.3) c.lerp(sand, 0.45); // sandy floor patches
        if (Math.sin(x * 0.25 + 1) * Math.cos(z * 0.19) > 0.5) c.lerp(wet, 0.6);
        return c.multiplyScalar(0.85 + rng() * 0.25);
      },
      false,
    ));
    this.group.add(grid(
      (x, z) => caveFloor(x, z) + WALL - 0.4 + noise(x * 1.3, z * 1.3) * 0.7 - THREE.MathUtils.smoothstep(open(x, z), 0, 5) * 1.0,
      () => new THREE.Color(0x1c262c).multiplyScalar(0.8 + rng() * 0.3),
      true,
    ));
    // The pools: still water lit from below, a pale green-blue.
    for (const p of GROTTO_POOLS) {
      const x = GROTTO.x + p.c[0], z = GROTTO.z + p.c[1], lair = p.c[1] < -70;
      const wm = new THREE.MeshStandardMaterial({ color: lair ? 0x0a1418 : 0x2a8a8a, emissive: lair ? 0x082028 : 0x30c8b0, emissiveIntensity: lair ? 0.4 : 0.9, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.88 });
      this.water.push(wm);
      const w = mesh(new THREE.CircleGeometry(p.r + 0.35, 32), wm, this.group, false);
      w.rotation.x = -Math.PI / 2; w.position.set(x, caveFloor(x, z) - 0.25, z);
      const l = new THREE.PointLight(lair ? 0x4080a0 : 0x40e0c0, lair ? 3 : 4, p.r * 3.5, 1.4);
      l.position.set(x, caveFloor(x, z) + 0.6, z);
      this.group.add(l); this.lights.push(l);
    }
    // Luminous anemones and pale crystals along the walls of every chamber.
    for (const r of GROTTO_ROOMS) {
      const x = GROTTO.x + r.c[0], z = GROTTO.z + r.c[1];
      for (let i = 0; i < Math.round(r.r * 1.1); i++) {
        const a = rng() * Math.PI * 2, d = r.r - 0.3 - rng() * 0.6;
        const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, y = caveFloor(cx, cz);
        const hue = [0x40e0c0, 0x8070ff, 0xff70c0][i % 3];
        const gm = new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.2, roughness: 0.4 });
        this.glows.push({ m: gm, base: 1.2, ph: rng() * 6 });
        if (i % 2) {
          // Anemone: a squat stalk with a ring of tendrils.
          const g = new THREE.Group(); g.position.set(cx, y + 0.1 + rng() * 2.2, cz); this.group.add(g);
          mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.18, 8), gm, g);
          for (let k = 0; k < 7; k++) { const tnd = mesh(new THREE.ConeGeometry(0.025, 0.22, 4), gm, g); const ta = (k / 7) * Math.PI * 2; tnd.position.set(Math.cos(ta) * 0.08, 0.16, Math.sin(ta) * 0.08); tnd.rotation.set(Math.sin(ta) * 0.6, 0, -Math.cos(ta) * 0.6); }
        } else {
          const cr = mesh(new THREE.OctahedronGeometry(0.22 + rng() * 0.2, 0), gm, this.group);
          cr.position.set(cx, y + 0.5 + rng() * 2, cz); cr.scale.set(0.6, 1.7, 0.6); cr.rotation.set(rng(), rng(), rng());
        }
      }
      const l = new THREE.PointLight(0x60c8e0, 3.2, r.r * 2.6, 1.6);
      l.position.set(x - r.r * 0.3, caveFloor(x, z) + 3.8, z);
      this.group.add(l); this.lights.push(l);
    }
    // The gate to the lair: a great arch of barnacled rock and whale ribs, with a warning.
    {
      const gx = GROTTO_GATE.x, gz = GROTTO_GATE.z, y = caveFloor(gx, gz);
      const rock = mat(0x2a3438, 'rock', { r: 0.8 }), bone = mat(0xe0d8c0, null, { r: 0.7 });
      for (const sx of [-1, 1]) bx(this.group, 0.8, 4.6, 0.9, rock, gx + sx * 2.6, y + 2.3, gz);
      bx(this.group, 6.2, 0.8, 1.0, rock, gx, y + 4.6, gz);
      for (let k = 0; k < 5; k++) {
        const rib = mesh(new THREE.TorusGeometry(2.6, 0.12, 6, 16, Math.PI), bone, this.group);
        rib.position.set(gx, y + 0.2, gz - 1 - k * 0.9); rib.scale.y = 1.6;
      }
      const el = document.createElement('div');
      el.className = 'tag place';
      el.innerHTML = '<b>The Kraken’s lair ⚠</b><small>Level 18 boss · bring friends</small>';
      addLabel(el, () => (this.group.visible ? new THREE.Vector3(gx, y + 5.6, gz) : null), 30);
    }
    // The way out: grey daylight and sea air down a crack in the roof.
    const exZ = GROTTO.z + 6.5;
    const ex = mesh(new THREE.CylinderGeometry(1.2, 1.7, 7, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }), this.group, false);
    ex.position.set(GROTTO.x, caveFloor(GROTTO.x, exZ) + 3.5, exZ);
    const day = new THREE.PointLight(0xd8f0ff, 6, 12, 1.5);
    day.position.set(GROTTO.x, caveFloor(GROTTO.x, exZ) + 5, exZ);
    this.group.add(day);
    const out = document.createElement('div');
    out.className = 'tag place';
    out.innerHTML = '<b>Way out</b><small>Walk into the light</small>';
    addLabel(out, () => (this.group.visible ? new THREE.Vector3(GROTTO.x, caveFloor(GROTTO.x, exZ) + 3.2, exZ) : null), 30);
  }

  setVisible(on: boolean): void { this.group.visible = on; }

  animate(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    for (const g of this.glows) g.m.emissiveIntensity = g.base * (0.75 + Math.sin(this.t * 1.3 + g.ph) * 0.25);
    this.lights.forEach((l, i) => (l.intensity = (i < GROTTO_POOLS.length ? 4 : 3.2) * (0.9 + Math.sin(this.t * 1.7 + i) * 0.1)));
    for (const w of this.water) w.emissiveIntensity = (w.color.r < 0.1 ? 0.4 : 0.9) * (0.85 + Math.sin(this.t * 0.9) * 0.15);
  }
}
