/**
 * A procedural horse (Fjord-ish: stocky, short-necked, upright mane) with a saddle. Built facing
 * −Z like the characters. `animateHorse` swings the legs and bobs the body with speed.
 */
import * as THREE from 'three';
import { ITEMS } from '@kontor/shared';
import { mat, mesh, ball, limb, v3, bx } from '../engine/procgen.js';

export interface Horse { g: THREE.Group; body: THREE.Group; legs: THREE.Object3D[]; neck: THREE.Group; ph: number }

/** Saddle height: where a rider's hips sit, relative to the horse's feet. */
export const SADDLE_Y = 1.55;

export function makeHorse(itemId: string): Horse {
  const m = ITEMS[itemId]?.mount ?? { coat: 0xc8a878, mane: 0x3a2a1c, mult: 1.6 };
  const coat = mat(m.coat, 'cloth', { r: 0.85 }), mane = mat(m.mane, 'cloth', { r: 1 });
  const hoof = mat(0x2a2420, null, { r: 0.6 }), dark = mat(0x1a1612, null);
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const torso = ball(body, v3(0, 1.05, 0), 0.42, coat, 14); torso.scale.set(0.95, 0.9, 2.0);
  ball(body, v3(0, 1.08, -0.62), 0.4, coat, 12).scale.set(1, 1, 1);
  ball(body, v3(0, 1.08, 0.62), 0.4, coat, 12).scale.set(1, 0.95, 1);
  // Neck and head.
  const neck = new THREE.Group(); neck.position.set(0, 1.25, -0.8); body.add(neck);
  const n = limb(neck, v3(0, 0, 0), v3(0, 0.55, -0.35), 0.2, 0.15, coat, 10); void n;
  const head = new THREE.Group(); head.position.set(0, 0.6, -0.42); neck.add(head);
  ball(head, v3(0, 0, 0), 0.16, coat, 10).scale.set(0.9, 0.95, 1.1);
  const muzzle = limb(head, v3(0, -0.02, -0.08), v3(0, -0.12, -0.42), 0.13, 0.1, coat, 8); void muzzle;
  ball(head, v3(0, -0.13, -0.44), 0.1, mat(Math.max(0, m.coat - 0x202020), null, { r: 0.8 }), 8);
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.04, 0.14, 5), coat, head); ear.position.set(sx * 0.08, 0.17, 0.04);
    ball(head, v3(sx * 0.12, 0.03, -0.1), 0.025, dark, 6);
  }
  // Upright Fjord mane along the neck, and a tail.
  for (let i = 0; i < 6; i++) { const t = i / 5; bx(neck, 0.06, 0.16, 0.12, mane, 0, 0.12 + t * 0.55, 0.12 - t * 0.38); }
  const tail = mesh(new THREE.ConeGeometry(0.1, 0.8, 6), mane, body); tail.position.set(0, 0.8, 1.05); tail.rotation.x = 0.35;
  // Saddle and blanket.
  bx(body, 0.7, 0.04, 0.75, mat(0x7a2a24, 'cloth', { r: 1 }), 0, 1.42, -0.05);
  bx(body, 0.5, 0.12, 0.55, mat(0x5a3a22, 'leather', { r: 0.7 }), 0, 1.5, -0.05);
  bx(body, 0.3, 0.14, 0.08, mat(0x5a3a22, 'leather', { r: 0.7 }), 0, 1.6, -0.3);
  // Legs (pivot at the shoulder/hip).
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.22, -0.68], [0.22, -0.68], [-0.22, 0.68], [0.22, 0.68]]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.95, z); body.add(leg);
    limb(leg, v3(), v3(0, -0.5, 0), 0.1, 0.07, coat, 7);
    limb(leg, v3(0, -0.5, 0), v3(0, -0.88, 0), 0.07, 0.065, coat, 7);
    const hf = ball(leg, v3(0, -0.9, 0), 0.075, hoof, 7); hf.scale.set(1, 0.6, 1.1);
    legs.push(leg);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { g, body, legs, neck, ph: 0 };
}

export function animateHorse(h: Horse, speed: number, dt: number): void {
  h.ph += dt * Math.min(speed, 9) * 1.5;
  const amp = Math.min(0.6, speed * 0.09);
  h.legs.forEach((l, i) => (l.rotation.x = Math.sin(h.ph + (i === 0 || i === 3 ? 0 : Math.PI)) * amp));
  h.body.position.y = Math.abs(Math.sin(h.ph)) * amp * 0.08;
  h.neck.rotation.x = Math.sin(h.ph * 2) * amp * 0.08 + (speed < 0.2 ? Math.sin(performance.now() / 1500) * 0.05 : 0);
}

/** Pose a character astride: hips at the saddle, thighs forward and apart, shins down. */
export function seatRider(c: import('./character.js').Character): void {
  c.g.position.y += SADDLE_Y - c.hipY + 0.05;
  for (const [i, l] of c.legs.entries()) {
    l.hip.rotation.x = 1.25;
    l.hip.rotation.z = (i === 0 ? 1 : -1) * 0.35;
    l.knee.rotation.x = -1.35;
  }
}
