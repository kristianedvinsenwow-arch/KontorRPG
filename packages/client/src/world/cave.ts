/**
 * The Old Mine's interior: one heightfield for floor + walls (the floor rises into rock walls
 * wherever the shared cave shape says you can't walk), a ceiling, timber supports, a few lanterns
 * and glowing crystals, and the way out. Only shown while you're down there.
 */
import * as THREE from 'three';
import { CAVE, CAVE_EXIT, CAVE_ROOMS, CAVE_TUNNELS, caveClearance, caveFloor, mulberry32 } from '@kontor/shared';
import { mat, bx } from '../engine/procgen.js';
import { addLabel } from '../engine/labels.js';

const X0 = -26, X1 = 42, Z0 = -96, Z1 = 14, STEP = 0.7, WALL = 6.5;

function grid(height: (x: number, z: number) => number, color: (x: number, z: number, y: number) => THREE.Color, flip: boolean): THREE.Mesh {
  const nx = Math.ceil((X1 - X0) / STEP) + 1, nz = Math.ceil((Z1 - Z0) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = CAVE.x + X0 + i * STEP, z = CAVE.z + Z0 + j * STEP;
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
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  m.receiveShadow = true;
  m.castShadow = !flip;
  return m;
}

export class CaveView {
  readonly group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.visible = false;
    const rng = mulberry32(99);
    const noise = (x: number, z: number) => Math.sin(x * 0.9 + z * 0.4) * 0.35 + Math.cos(z * 1.3 - x * 0.5) * 0.25;
    const floorC = new THREE.Color(0x4a4640), wallC = new THREE.Color(0x5e5850), wet = new THREE.Color(0x353836);
    this.group.add(grid(
      (x, z) => {
        const c = caveClearance(x, z);
        const wall = THREE.MathUtils.smoothstep(-c, -0.2, 1.8);
        return caveFloor(x, z) + wall * (WALL + noise(x, z)) + (wall > 0.05 ? noise(x * 2, z * 2) * 0.3 : 0);
      },
      (x, z, y) => {
        const c = new THREE.Color().copy(floorC).lerp(wallC, THREE.MathUtils.clamp(y / 3, 0, 1));
        if (Math.sin(x * 0.3) * Math.cos(z * 0.21) > 0.6) c.lerp(wet, 0.5);
        return c.multiplyScalar(0.85 + rng() * 0.25);
      },
      false,
    ));
    this.group.add(grid(
      (x, z) => caveFloor(x, z) + WALL - 0.6 + noise(x * 1.4, z * 1.4) * 0.6 - THREE.MathUtils.smoothstep(caveClearance(x, z), 0, 4) * 1.2,
      () => new THREE.Color(0x2e2b28).multiplyScalar(0.8 + rng() * 0.3),
      true,
    ));
    // Timber supports along the tunnels, lanterns in each chamber.
    const wood = mat(0x5a4029, 'wood');
    for (const [a, b, w] of CAVE_TUNNELS) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (let d = 3; d < len - 2; d += 6) {
        const x = CAVE.x + a[0] + Math.sin(ang) * d, z = CAVE.z + a[1] + Math.cos(ang) * d;
        const g = new THREE.Group();
        g.position.set(x, caveFloor(x, z), z);
        g.rotation.y = ang; // local x across the tunnel: posts against both walls, the cap beam spanning it
        for (const s of [-1, 1]) bx(g, 0.22, 3.2, 0.22, wood, s * (w / 2 - 0.25), 1.6, 0);
        bx(g, w - 0.2, 0.24, 0.26, wood, 0, 3.2, 0);
        this.group.add(g);
      }
    }
    for (const r of CAVE_ROOMS) {
      const x = CAVE.x + r.c[0], z = CAVE.z + r.c[1];
      const l = new THREE.PointLight(0xffb060, 5, r.r * 2.6, 1.6);
      l.position.set(x + r.r * 0.4, caveFloor(x, z) + 3.2, z);
      this.group.add(l);
      this.lights.push(l);
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: 0x302010, emissive: 0xffa040, emissiveIntensity: 2 }));
      lantern.position.copy(l.position).add(new THREE.Vector3(0, -0.2, 0));
      this.group.add(lantern);
      // Crystals that glow faintly in the walls.
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2;
        const cx = x + Math.cos(a) * (r.r + 0.4), cz = z + Math.sin(a) * (r.r + 0.4);
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + rng() * 0.2, 0), new THREE.MeshStandardMaterial({ color: 0x8a70c8, emissive: 0x6a40c0, emissiveIntensity: 1.4, roughness: 0.2 }));
        cr.position.set(cx, caveFloor(cx, cz) + 0.6 + rng() * 1.5, cz);
        cr.scale.set(0.6, 1.6, 0.6);
        cr.rotation.set(rng(), rng(), rng());
        this.group.add(cr);
      }
    }
    // The way out: daylight spilling down a shaft.
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    ex.position.set(CAVE_EXIT.x, caveFloor(CAVE_EXIT.x, CAVE_EXIT.z) + 3, CAVE_EXIT.z);
    this.group.add(ex);
    const day = new THREE.PointLight(0xfff0c8, 6, 12, 1.5);
    day.position.set(CAVE_EXIT.x, 4.5, CAVE_EXIT.z);
    this.group.add(day);
    const el = document.createElement('div');
    el.className = 'tag place';
    el.innerHTML = '<b>Way out</b><small>Walk into the light</small>';
    addLabel(el, () => (this.group.visible ? new THREE.Vector3(CAVE_EXIT.x, 3.2, CAVE_EXIT.z) : null), 30);
  }

  setVisible(on: boolean): void { this.group.visible = on; }

  animate(dt: number): void {
    this.t += dt;
    this.lights.forEach((l, i) => (l.intensity = 5 * (0.88 + Math.sin(this.t * 9 + i) * 0.06 + Math.sin(this.t * 5.1 + i * 2) * 0.06)));
  }
}
