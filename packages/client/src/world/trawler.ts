/**
 * The fjord trawler: a red-and-white fishing boat with a wheelhouse, a mast with a net boom, nets
 * and floats, and a lamp, sailing its loop of Saltfjorden (position from the shared timetable).
 * Passengers stand on its deck; the server moves them with it.
 */
import * as THREE from 'three';
import { TRAWLER, trawlerAt } from '@kontor/shared';
import { mat, bx, mesh } from '../engine/procgen.js';

export class TrawlerView {
  readonly group = new THREE.Group();
  private lamp: THREE.MeshStandardMaterial;
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const g = this.group;
    const red = mat(0xa8302a, 'wood', { r: 0.7 }), white = mat(0xeee8dc, 'wood', { r: 0.7 }), deck = mat(0x9a7a52, 'wood', { r: 0.85 });
    const dark = mat(0x3a2a20, 'wood', { r: 0.8 }), net = new THREE.MeshStandardMaterial({ color: 0x2e4a40, roughness: 1, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    const D = TRAWLER.deck;
    // Hull: a long box tapering to a bow (−Z), red below a white band, sitting low in the water.
    bx(g, 3.2, 1.6, 8.4, red, 0, D - 0.85, 0.6);
    bx(g, 3.26, 0.35, 8.5, white, 0, D - 0.12, 0.6);
    const bow = new THREE.Shape(); bow.moveTo(-1.6, 0); bow.lineTo(1.6, 0); bow.lineTo(0, -2.4); bow.closePath();
    const bowM = mesh(new THREE.ExtrudeGeometry(bow, { depth: 1.95, bevelEnabled: false }), red, g); bowM.rotation.x = Math.PI / 2; bowM.position.set(0, D - 0.03, -3.6); // just under the bow deck
    bx(g, 3.0, 0.08, 8.2, deck, 0, D, 0.6); // deck
    const bowDeck = new THREE.Shape(); bowDeck.moveTo(-1.6, 0); bowDeck.lineTo(1.6, 0); bowDeck.lineTo(0, 2.4); // (rotated flat, shape +y ends up towards −Z) bowDeck.closePath();
    const bd = mesh(new THREE.ShapeGeometry(bowDeck), deck, g); bd.rotation.x = -Math.PI / 2; bd.position.set(0, D + 0.01, -3.6);
    // Bow gunwales, meeting at the stem.
    for (const sx of [-1, 1]) { const gw = bx(g, 0.12, 0.45, 2.9, white, sx * 0.8, D + 0.22, -4.85); gw.rotation.y = sx * 0.59; }
    // Gunwales.
    for (const sx of [-1, 1]) bx(g, 0.12, 0.45, 8.2, white, sx * 1.55, D + 0.22, 0.6);
    bx(g, 3.2, 0.45, 0.12, white, 0, D + 0.22, 4.7);
    // Wheelhouse aft, with windows that glow at night.
    bx(g, 2.2, 1.9, 2.0, white, 0, D + 0.95, 3.4);
    bx(g, 2.5, 0.15, 2.3, red, 0, D + 1.95, 3.4);
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xd8e0e8, emissive: 0xffc070, emissiveIntensity: 0.3, roughness: 0.2 });
    bx(g, 1.8, 0.6, 0.04, this.lamp, 0, D + 1.4, 2.38);
    for (const sx of [-1, 1]) bx(g, 0.04, 0.6, 1.3, this.lamp, sx * 1.11, D + 1.4, 3.4);
    // Mast and net boom, with a hanging net and orange floats.
    mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 8).translate(0, 2.6, 0), dark, g).position.set(0, D, -1.0);
    const boom = mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), dark, g); boom.position.set(1.4, D + 3.4, 0.2); boom.rotation.set(0.4, 0, -1.0);
    const n = mesh(new THREE.ConeGeometry(0.45, 1.7, 8, 1, true), net, g); n.position.set(2.75, D + 2.2, 0.55); n.rotation.z = Math.PI; // the net, hanging from the boom's end
    const fl = mat(0xf07a20, null, { r: 0.5 });
    for (let i = 0; i < 6; i++) { const b = mesh(new THREE.SphereGeometry(0.12, 8, 6), fl, g); b.position.set(-1.62, D + 0.25, -1.8 + i * 0.9); }
    // A heap of nets and fish boxes on deck.
    bx(g, 1.0, 0.4, 0.8, mat(0x6a8aa0, null, { r: 0.7 }), -0.8, D + 0.2, 1.6);
    bx(g, 1.0, 0.4, 0.8, mat(0x6a8aa0, null, { r: 0.7 }), -0.8, D + 0.6, 1.6);
    const heap = mesh(new THREE.SphereGeometry(0.6, 10, 6), net, g); heap.position.set(0.5, D + 0.05, -4.6); heap.scale.set(0.8, 0.4, 0.7);
    // A flag at the stern.
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6).translate(0, 0.7, 0), dark, g).position.set(0, D + 2.0, 4.5);
    bx(g, 0.6, 0.38, 0.02, red, 0.3, D + 3.15, 4.5);
    // Norway's flag: a white-edged blue cross.
    const blue = mat(0x1f3a7a, null, { r: 0.7 });
    bx(g, 0.6, 0.1, 0.025, white, 0.3, D + 3.15, 4.5);
    bx(g, 0.1, 0.38, 0.025, white, 0.2, D + 3.15, 4.5);
    bx(g, 0.6, 0.045, 0.03, blue, 0.3, D + 3.15, 4.5);
    bx(g, 0.045, 0.38, 0.03, blue, 0.2, D + 3.15, 4.5);
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** Move to where the timetable says (server clock), with a gentle roll; `visible` = you're in Saltfjorden. */
  update(dt: number, serverNow: number, visible: boolean, night: number): void {
    this.group.visible = visible;
    if (!visible) return;
    this.t += dt;
    const b = trawlerAt(serverNow);
    this.group.position.set(b.x, Math.sin(this.t * 1.1) * 0.05, b.z);
    this.group.rotation.set(Math.sin(this.t * 0.8) * 0.02, b.yaw, Math.sin(this.t * 0.9 + 1) * 0.03);
    this.lamp.emissiveIntensity = 0.3 + night * 1.8;
  }
}
