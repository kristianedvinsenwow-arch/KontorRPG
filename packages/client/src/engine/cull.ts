/**
 * Distance culling for big flat groups (veins, plants…): each direct child is hidden when it's
 * further than `range` from the camera. Child centres are measured once and cached.
 */
import * as THREE from 'three';

const centres = new WeakMap<THREE.Object3D, { c: THREE.Vector3; r: number }>();
const box = new THREE.Box3(), sph = new THREE.Sphere();

export function cullChildren(group: THREE.Object3D, at: THREE.Vector3, range: number): void {
  for (const o of group.children) {
    if ((o as THREE.Light).isLight) continue;
    let e = centres.get(o);
    if (!e) { box.setFromObject(o); box.getBoundingSphere(sph); e = { c: sph.center.clone(), r: Number.isFinite(sph.radius) ? sph.radius : 0 }; centres.set(o, e); }
    o.visible = e.c.distanceTo(at) - e.r < range;
  }
}
