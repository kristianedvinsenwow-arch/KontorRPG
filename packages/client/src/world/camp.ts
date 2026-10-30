/**
 * Mofjell camp next to spawn: the furnace and anvil (smithing), and the trading post where you buy
 * your first pickaxe. Positions come from shared data, so the server checks the same spots.
 */
import * as THREE from 'three';
import { STATIONS, TRADING_POST, heightAt } from '@kontor/shared';
import { mat, bx, mesh, nameSprite, canvasTex } from '../engine/procgen.js';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';
import type { Collider } from './props.js';

export class Camp {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private fireLight: THREE.PointLight;
  private fireMat: THREE.MeshStandardMaterial;
  private vendor: Character;
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const stone = mat(0x7d7a73, 'rock');
    const dark = mat(0x4f4c47, 'rock');
    const wood = mat(0x7a5a3a, 'wood');
    const darkWood = mat(0x5a4029, 'wood');
    const iron = new THREE.MeshStandardMaterial({ color: 0x3c3f44, metalness: 0.85, roughness: 0.42 });

    // ---- furnace: a squat fieldstone kiln with a glowing mouth and a chimney
    const F = STATIONS.furnace;
    const furnace = new THREE.Group();
    furnace.position.set(F.x, heightAt(F.x, F.z), F.z);
    furnace.rotation.y = Math.atan2(-F.x, -F.z) + Math.PI; // mouth faces the camp centre
    this.group.add(furnace);
    const body = mesh(new THREE.CylinderGeometry(0.95, 1.15, 1.5, 9).translate(0, 0.75, 0), stone, furnace);
    void body;
    mesh(new THREE.SphereGeometry(0.95, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.5, 0), stone, furnace);
    mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.3, 7).translate(0.25, 2.4, 0.25), dark, furnace);
    this.fireMat = new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 1 });
    const mouth = mesh(new THREE.CircleGeometry(0.36, 14, 0, Math.PI), this.fireMat, furnace, false);
    mouth.position.set(0, 0.42, -1.04); mouth.rotation.y = Math.PI;
    const lintel = bx(furnace, 0.95, 0.14, 0.24, dark, 0, 0.84, -1.0);
    void lintel;
    // Coal bin and bellows beside it.
    bx(furnace, 0.55, 0.32, 0.45, darkWood, 1.25, 0.16, -0.35);
    mesh(new THREE.DodecahedronGeometry(0.2, 0).translate(1.25, 0.38, -0.35), mat(0x1c1b1a, null, { r: 0.6 }), furnace).scale.set(1.2, 0.5, 1);
    this.fireLight = new THREE.PointLight(0xff7a2a, 6, 8, 1.8);
    this.fireLight.position.set(0, 0.6, -1.4);
    furnace.add(this.fireLight);
    const fTag = nameSprite('Furnace', '#f2a23a'); fTag.position.y = 3.2; furnace.add(fTag);
    this.colliders.push({ x: F.x, z: F.z, r: F.r });

    // ---- anvil on a stump, with a quench barrel
    const A = STATIONS.anvil;
    const anvil = new THREE.Group();
    anvil.position.set(A.x, heightAt(A.x, A.z), A.z);
    anvil.rotation.y = 0.6;
    this.group.add(anvil);
    mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.6, 10).translate(0, 0.3, 0), mat(0x6b4f33, 'bark'), anvil);
    bx(anvil, 0.36, 0.12, 0.22, iron, 0, 0.66, 0);
    bx(anvil, 0.2, 0.12, 0.16, iron, 0, 0.78, 0);
    bx(anvil, 0.6, 0.12, 0.26, iron, 0.02, 0.9, 0);
    const horn = mesh(new THREE.ConeGeometry(0.11, 0.34, 8), iron, anvil);
    horn.rotation.z = Math.PI / 2; horn.position.set(-0.45, 0.9, 0);
    // A hammer resting on the face.
    const ham = new THREE.Group(); ham.position.set(0.12, 0.98, 0.04); ham.rotation.set(Math.PI / 2, 0, 0.5); anvil.add(ham);
    mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.36, 6).translate(0, 0.18, 0), wood, ham);
    bx(ham, 0.15, 0.06, 0.06, iron, 0, 0.34, 0);
    const barrel = mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.62, 12).translate(0, 0.31, 0), darkWood, anvil);
    barrel.position.set(0.85, 0, 0.45);
    const water = mesh(new THREE.CircleGeometry(0.27, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c3038, roughness: 0.1, metalness: 0.2 }), anvil, false);
    water.position.set(0.85, 0.58, 0.45);
    const aTag = nameSprite('Anvil', '#f2a23a'); aTag.position.y = 1.9; anvil.add(aTag);
    this.colliders.push({ x: A.x, z: A.z, r: A.r }, { x: A.x + 0.85 * Math.cos(0.6) + 0.45 * Math.sin(0.6), z: A.z - 0.85 * Math.sin(0.6) + 0.45 * Math.cos(0.6), r: 0.35 });

    // ---- trading post: a timber stall with a striped awning, crates and a sign
    const T = TRADING_POST;
    const post = new THREE.Group();
    post.position.set(T.x, heightAt(T.x, T.z), T.z);
    post.rotation.y = Math.atan2(-T.x, -T.z) + Math.PI; // counter faces the camp centre
    this.group.add(post);
    for (const [px, pz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.9], [1.4, 0.9]]) {
      mesh(new THREE.CylinderGeometry(0.07, 0.08, pz < 0 ? 2.95 : 2.55, 6).translate(px, pz < 0 ? 1.475 : 1.275, pz), darkWood, post);
    }
    bx(post, 3.0, 0.9, 0.5, wood, 0, 0.45, -0.75); // counter
    bx(post, 3.1, 0.08, 0.6, darkWood, 0, 0.92, -0.75); // counter top
    const awningTex = canvasTex((g, s) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e9dfc9' : '#b8452f'; g.fillRect((i * s) / 8, 0, s / 8, s); }
    }, 128);
    const awning = mesh(new THREE.PlaneGeometry(3.3, 2.0), new THREE.MeshStandardMaterial({ map: awningTex, side: THREE.DoubleSide, roughness: 0.9 }), post);
    awning.position.set(0, 2.78, 0.1); awning.rotation.x = -Math.PI / 2 + 0.2;
    // Goods on the counter: pickaxes, a rucksack, a little stack of ingots.
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Group(); p.position.set(-0.9 + i * 0.3, 0.98, -0.75); p.rotation.set(0, 0.3, Math.PI / 2 - 0.15); post.add(p);
      mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.66, 6).translate(0, 0.33, 0), wood, p);
      bx(p, 0.36, 0.06, 0.06, stone, 0, 0.64, 0);
    }
    bx(post, 0.32, 0.38, 0.2, mat(0x7a5a3a, 'leather'), -1.15, 1.15, -0.72);
    for (let i = 0; i < 3; i++) bx(post, 0.18, 0.06, 0.08, iron, 1.0 + (i % 2) * 0.05, 0.99 + i * 0.065, -0.75, 0, i * 0.2, 0);
    // Crates and a barrel behind.
    bx(post, 0.6, 0.6, 0.6, wood, -1.0, 0.3, 0.6, 0, 0.2, 0);
    bx(post, 0.45, 0.45, 0.45, darkWood, -0.95, 0.83, 0.6, 0, -0.1, 0);
    mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.7, 12).translate(1.0, 0.35, 0.65), darkWood, post);
    // Sign.
    const signTex = canvasTex((g, s) => {
      g.fillStyle = '#6b4c2e'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#f0e2c0'; g.font = `700 ${s * 0.2}px "Saira Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TRADING', s / 2, s * 0.36); g.fillText('POST', s / 2, s * 0.64);
    }, 256);
    const sign = mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }), post);
    sign.position.set(0, 3.3, -0.62); sign.rotation.y = Math.PI;
    bx(post, 1.2, 0.08, 0.06, darkWood, 0, 3.6, -0.66);
    for (const sx of [-0.5, 0.5]) bx(post, 0.04, 0.7, 0.04, darkWood, sx, 3.25, -0.66);

    // The trader behind the counter.
    this.vendor = makeCharacter(5, 'Trader Ingrid', 'human');
    applyGear(this.vendor, { b: 'leather_backpack' });
    this.vendor.g.position.set(0, 0, -0.1);
    this.vendor.g.rotation.y = 0;
    post.add(this.vendor.g);
    this.colliders.push(...[-1, 0, 1].map((k) => {
      const lx = k * 1.0, lz = -0.2;
      const c = Math.cos(post.rotation.y), s = Math.sin(post.rotation.y);
      return { x: T.x + lx * c + lz * s, z: T.z - lx * s + lz * c, r: 0.95 };
    }));
  }

  animate(dt: number): void {
    this.t += dt;
    const f = 0.85 + Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3) * 0.07;
    this.fireLight.intensity = 6 * f;
    this.fireMat.emissiveIntensity = 2.2 * f;
    animateCharacter(this.vendor, 0, Math.sin(this.t * 0.4) * 0.15, false, dt);
    this.vendor.head.rotation.y = Math.sin(this.t * 0.3) * 0.4;
  }
}
