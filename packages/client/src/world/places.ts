/**
 * Built places: every crafting station (furnace, anvil, workbench, campfire, stove), every NPC,
 * Ingrid's trading stall at camp, Bjørkvik Lodge with its eight rented rooms, a few village
 * cottages, and the mouth of the Old Mine. Positions all come from shared data, so the server
 * checks the same spots.
 */
import * as THREE from 'three';
import { CAVE_ENTRANCE, INN, NPCS, STATIONS, VILLAGE, heightAt, innDoor, type Npc, type Station } from '@kontor/shared';
import { mat, bx, mesh, canvasTex } from '../engine/procgen.js';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';
import { addLabel } from '../engine/labels.js';
import { rockGeo } from './props.js';
import type { Collider } from './props.js';

const M = {
  stone: mat(0x7d7a73, 'rock'),
  dark: mat(0x4f4c47, 'rock'),
  wood: mat(0x7a5a3a, 'wood'),
  darkWood: mat(0x5a4029, 'wood'),
  plank: mat(0x9a7650, 'wood'),
  roof: mat(0x4a3a30, 'wood', { r: 0.9 }),
  turf: mat(0x55703a, 'ground', { r: 1 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x3c3f44, metalness: 0.85, roughness: 0.42 }),
};

function tag(text: string, sub: string | null, cls: string, at: THREE.Vector3, max = 26) {
  const el = document.createElement('div');
  el.className = `tag ${cls}`;
  const b = document.createElement('b'); b.textContent = text; el.append(b);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  return addLabel(el, () => at, max);
}

export class Places {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private fires: { light: THREE.PointLight; mats: THREE.MeshStandardMaterial[]; base: number }[] = [];
  private npcs: { c: Character; n: Npc; g: THREE.Group }[] = [];
  private t = 0;
  private doorTags: HTMLElement[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (const s of STATIONS) this.station(s);
    for (const n of NPCS) this.npc(n);
    this.stall();
    this.lodge();
    this.village();
    this.caveMouth();
  }

  private place(x: number, z: number, faceX = 0, faceZ = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = Math.atan2(faceX - x, faceZ - z) + Math.PI; // local −Z faces (faceX, faceZ)
    this.group.add(g);
    return g;
  }

  private fire(parent: THREE.Object3D, y: number, intensity: number, range: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 1 });
    const light = new THREE.PointLight(0xff7a2a, intensity, range, 1.8);
    light.position.y = y;
    parent.add(light);
    this.fires.push({ light, mats: [m], base: intensity });
    return m;
  }

  private station(s: Station): void {
    const centre = s.id.startsWith('camp') ? { x: 0, z: 0 } : VILLAGE;
    const g = this.place(s.x, s.z, centre.x, centre.z);
    let h = 1.6;
    if (s.kind === 'furnace') {
      mesh(new THREE.CylinderGeometry(0.95, 1.15, 1.5, 9).translate(0, 0.75, 0), M.stone, g);
      mesh(new THREE.SphereGeometry(0.95, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.5, 0), M.stone, g);
      mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.3, 7).translate(0.25, 2.4, 0.25), M.dark, g);
      const fm = this.fire(g, 0.6, 6, 8);
      g.children.at(-1)!.position.set(0, 0.6, -1.4);
      const mouth = mesh(new THREE.CircleGeometry(0.36, 14, 0, Math.PI), fm, g, false);
      mouth.position.set(0, 0.42, -1.04); mouth.rotation.y = Math.PI;
      bx(g, 0.95, 0.14, 0.24, M.dark, 0, 0.84, -1.0);
      bx(g, 0.55, 0.32, 0.45, M.darkWood, 1.25, 0.16, -0.35);
      h = 3.1;
    } else if (s.kind === 'anvil') {
      mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.6, 10).translate(0, 0.3, 0), mat(0x6b4f33, 'bark'), g);
      bx(g, 0.36, 0.12, 0.22, M.iron, 0, 0.66, 0);
      bx(g, 0.2, 0.12, 0.16, M.iron, 0, 0.78, 0);
      bx(g, 0.6, 0.12, 0.26, M.iron, 0.02, 0.9, 0);
      const horn = mesh(new THREE.ConeGeometry(0.11, 0.34, 8), M.iron, g);
      horn.rotation.z = Math.PI / 2; horn.position.set(-0.45, 0.9, 0);
      const barrel = mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.62, 12).translate(0, 0.31, 0), M.darkWood, g);
      barrel.position.set(0.85, 0, 0.45);
      h = 1.7;
    } else if (s.kind === 'workbench') {
      bx(g, 1.8, 0.1, 0.8, M.plank, 0, 0.85, 0);
      for (const [x, z] of [[-0.8, -0.32], [0.8, -0.32], [-0.8, 0.32], [0.8, 0.32]]) bx(g, 0.08, 0.85, 0.08, M.darkWood, x, 0.42, z);
      bx(g, 0.5, 0.12, 0.14, M.wood, -0.4, 0.96, 0.1);
      const saw = bx(g, 0.5, 0.12, 0.01, M.iron, 0.4, 0.93, -0.1); saw.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 3; i++) { const l = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), mat(0xd9d6cc, 'bark'), g); l.rotation.z = Math.PI / 2; l.position.set(0, 0.12 + (i === 2 ? 0.2 : 0), 0.8 + (i === 2 ? 0.12 : i * 0.25)); }
      h = 1.6;
    } else if (s.kind === 'campfire') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = mesh(rockGeo(30 + i, 0.6), mat(0x77736b, null), g);
        r.scale.setScalar(0.22); r.position.set(Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62);
      }
      for (let i = 0; i < 4; i++) { const l = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6), M.darkWood, g); l.rotation.set(0.5, (i / 4) * Math.PI * 2, 0); l.position.y = 0.2; }
      const fm = this.fire(g, 0.6, 7, 10);
      fm.transparent = true;
      for (let i = 0; i < 3; i++) {
        const fl = mesh(new THREE.ConeGeometry(0.22 - i * 0.05, 0.6 + i * 0.15, 6).translate(0, 0.3, 0), fm, g, false);
        fl.position.set((i - 1) * 0.08, 0.15, (i % 2) * 0.06);
      }
      // A spit for cooking.
      for (const sx of [-0.55, 0.55]) bx(g, 0.04, 0.9, 0.04, M.darkWood, sx, 0.45, 0);
      const bar = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), M.iron, g); bar.rotation.z = Math.PI / 2; bar.position.y = 0.88;
      h = 1.5;
    } else if (s.kind === 'stove') {
      bx(g, 1.3, 1.0, 0.9, M.stone, 0, 0.5, 0);
      bx(g, 1.4, 0.1, 1.0, M.dark, 0, 1.05, 0);
      mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.6, 8).translate(0.4, 1.9, 0.25), M.dark, g);
      const fm = this.fire(g, 0.5, 4, 6);
      g.children.at(-1)!.position.set(0, 0.4, -0.7);
      const mouth = mesh(new THREE.PlaneGeometry(0.5, 0.35), fm, g, false); mouth.position.set(0, 0.4, -0.46); mouth.rotation.y = Math.PI;
      const pot = mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.25, 12), M.iron, g); pot.position.set(-0.3, 1.22, 0);
      h = 1.9;
    }
    this.colliders.push({ x: s.x, z: s.z, r: s.r });
    const p = new THREE.Vector3(s.x, heightAt(s.x, s.z) + h, s.z);
    tag(s.name, null, 'station', p, 22);
  }

  private npc(n: Npc): void {
    const c = makeCharacter(n.color, undefined, n.race, n.face);
    const g = this.place(n.x, n.z, n.id === 'ingrid' ? 0 : n.x + (n.x > VILLAGE.x - 20 && n.z > 20 ? VILLAGE.x - n.x : -n.x) * 0.1, n.z + 1);
    // Face towards the middle of camp / the village green.
    const centre = Math.hypot(n.x, n.z) < 30 ? { x: 0, z: 0 } : { x: VILLAGE.x, z: VILLAGE.z };
    g.rotation.y = Math.atan2(n.x - centre.x, n.z - centre.z);
    g.add(c.g);
    const look: Record<string, Parameters<typeof applyGear>[1]> = {
      ingrid: { b: 'leather_backpack' }, mats: { h: 'iron_pickaxe', hd: 'stone_helm' }, sigrid: { h: 'iron_sword', c: 'iron_breastplate' },
      halvard: { h: 'pine_longbow', c: 'leather_breastplate' }, tor: { h: 'iron_hatchet' }, frida: { h: 'pine_rod' }, ragna: { h: 'birch_frost_staff' },
    };
    applyGear(c, look[n.id] ?? {});
    this.npcs.push({ c, n, g });
    if (n.id !== 'ingrid') this.colliders.push({ x: n.x, z: n.z, r: 0.45 });
    const R = { human: 1.85, dwarf: 1.3, gnome: 0.95, ogre: 2.2 }[n.race];
    tag(n.name, n.title, n.roles.includes('quests') ? 'npc quest' : 'npc', new THREE.Vector3(n.x, heightAt(n.x, n.z) + R + 0.35, n.z), 28);
  }

  /** Ingrid's stall at camp. */
  private stall(): void {
    const n = NPCS.find((x) => x.id === 'ingrid')!;
    const post = this.place(n.x, n.z, 0, 0);
    for (const [px, pz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.9], [1.4, 0.9]]) {
      mesh(new THREE.CylinderGeometry(0.07, 0.08, pz < 0 ? 2.95 : 2.55, 6).translate(px, pz < 0 ? 1.475 : 1.275, pz), M.darkWood, post);
    }
    bx(post, 3.0, 0.9, 0.5, M.wood, 0, 0.45, -0.75);
    bx(post, 3.1, 0.08, 0.6, M.darkWood, 0, 0.92, -0.75);
    const awningTex = canvasTex((g, s) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e9dfc9' : '#b8452f'; g.fillRect((i * s) / 8, 0, s / 8, s); } }, 128);
    const awning = mesh(new THREE.PlaneGeometry(3.3, 2.0), new THREE.MeshStandardMaterial({ map: awningTex, side: THREE.DoubleSide, roughness: 0.9 }), post);
    awning.position.set(0, 2.78, 0.1); awning.rotation.x = -Math.PI / 2 + 0.2;
    bx(post, 0.6, 0.6, 0.6, M.wood, -1.0, 0.3, 0.6, 0, 0.2, 0);
    mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.7, 12).translate(1.0, 0.35, 0.65), M.darkWood, post);
    const me = this.npcs.find((x) => x.n.id === 'ingrid')!;
    me.g.position.copy(post.position);
    me.g.rotation.y = post.rotation.y;
    me.c.g.position.z = -0.1;
    const c = Math.cos(post.rotation.y), s = Math.sin(post.rotation.y);
    for (const k of [-1, 0, 1]) this.colliders.push({ x: n.x + k * c + -0.2 * s, z: n.z - k * s + -0.2 * c, r: 0.95 });
  }

  /** Bjørkvik Lodge: a long timber house with a turf roof and eight numbered room doors. */
  private lodge(): void {
    const g = new THREE.Group();
    g.position.set(INN.x, heightAt(INN.x, INN.z), INN.z);
    this.group.add(g);
    const W = INN.w, D = INN.d;
    bx(g, W, 0.4, D, M.stone, 0, 0.2, 0);
    // Log walls.
    for (let i = 0; i < 9; i++) {
      const y = 0.55 + i * 0.32;
      for (const sz of [-1, 1]) { const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, W + 0.4, 8), M.wood, g); l.rotation.z = Math.PI / 2; l.position.set(0, y, sz * D / 2); }
      for (const sx of [-1, 1]) { const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, D + 0.4, 8), M.wood, g); l.rotation.x = Math.PI / 2; l.position.set(sx * W / 2, y + 0.16, 0); }
    }
    // Gable roof with turf.
    for (const sz of [-1, 1]) {
      const roof = bx(g, W + 1.2, 0.18, D * 0.62, M.roof, 0, 3.75, sz * D * 0.26, sz * 0.62, 0, 0);
      void roof;
      const turf = bx(g, W + 1.1, 0.12, D * 0.6, M.turf, 0, 3.9, sz * D * 0.26, sz * 0.62, 0, 0);
      turf.position.y += 0.05;
    }
    // Room doors on the front wall, each with a number board.
    for (let n = 0; n < INN.rooms; n++) {
      const d = innDoor(n);
      const lx = d.x - INN.x, lz = d.z - INN.z - 0.25;
      bx(g, 0.95, 1.9, 0.12, M.darkWood, lx, 1.35, lz);
      bx(g, 1.1, 0.12, 0.16, M.wood, lx, 2.35, lz);
      const knob = mesh(new THREE.SphereGeometry(0.04, 6, 4), M.iron, g); knob.position.set(lx + 0.32, 1.3, lz + 0.08);
      const sign = canvasTex((c, s) => { c.fillStyle = '#6b4c2e'; c.fillRect(0, 0, s, s); c.fillStyle = '#f0e2c0'; c.font = `700 ${s * 0.7}px "Saira Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n + 1), s / 2, s * 0.55); }, 64);
      const plate = mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }), g);
      plate.position.set(lx, 2.6, lz + 0.09);
      // Storage chest beside the door.
      bx(g, 0.5, 0.35, 0.35, M.wood, lx + 0.75, 0.6, lz + 0.35);
      const el = document.createElement('div');
      el.className = 'tag door';
      this.doorTags.push(el);
      addLabel(el, () => new THREE.Vector3(d.x, heightAt(d.x, d.z) + 2.9, d.z), 14);
    }
    // Lodge sign.
    const sign = canvasTex((c, s) => { c.fillStyle = '#5a3d24'; c.fillRect(0, 0, s, s / 3); c.fillStyle = '#f0e2c0'; c.font = `700 ${s * 0.15}px "Saira Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BJØRKVIK LODGE', s / 2, s / 6); }, 256);
    const sp = mesh(new THREE.PlaneGeometry(3.2, 1.07), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8, transparent: true }), g);
    sp.position.set(0, 3.25, D / 2 + 0.15);
    sign.repeat.set(1, 1 / 3); sign.offset.set(0, 2 / 3);
    // Walls block movement: a row of colliders along each long side.
    for (let x = -W / 2; x <= W / 2; x += 1.2) for (const sz of [-1, 1]) this.colliders.push({ x: INN.x + x, z: INN.z + sz * D / 2, r: 0.7 });
    for (let z = -D / 2; z <= D / 2; z += 1.2) for (const sx of [-1, 1]) this.colliders.push({ x: INN.x + sx * W / 2, z: INN.z + z, r: 0.7 });
    for (let z = -D / 2 + 1; z < D / 2; z += 1.2) for (let x = -W / 2 + 1; x < W / 2; x += 1.6) this.colliders.push({ x: INN.x + x, z: INN.z + z, r: 0.9 });
  }

  /** Names on the room doors (from the server's room list). */
  setRooms(names: (string | null)[]): void {
    this.doorTags.forEach((el, i) => {
      el.textContent = names[i] ? `Room ${i + 1} · ${names[i]}` : `Room ${i + 1} · free`;
      el.classList.toggle('free', !names[i]);
    });
  }

  /** A couple of turf-roofed cottages and a well around the green. */
  private village(): void {
    const spots = [[VILLAGE.x - 14, VILLAGE.z + 8, 0.6], [VILLAGE.x + 16, VILLAGE.z + 9, -0.5], [VILLAGE.x - 3, VILLAGE.z + 18, 0]];
    for (const [x, z, ry] of spots) {
      const g = new THREE.Group();
      g.position.set(x, heightAt(x, z), z);
      g.rotation.y = ry;
      this.group.add(g);
      bx(g, 4.2, 2.2, 3.4, M.plank, 0, 1.1, 0);
      for (const sz of [-1, 1]) bx(g, 4.6, 0.16, 2.2, M.turf, 0, 2.65, sz * 0.9, sz * 0.6, 0, 0);
      bx(g, 0.8, 1.6, 0.08, M.darkWood, 0, 0.8, -1.72);
      bx(g, 0.6, 0.5, 0.06, mat(0xe8d8a8, null, { r: 0.3 }), 1.3, 1.3, -1.72);
      for (const dx of [-1.6, 0, 1.6]) for (const dz of [-1.2, 0, 1.2]) this.colliders.push({ x: x + dx * Math.cos(ry) + dz * Math.sin(ry), z: z - dx * Math.sin(ry) + dz * Math.cos(ry), r: 1 });
    }
    const wx = VILLAGE.x + 4, wz = VILLAGE.z + 3;
    const well = new THREE.Group(); well.position.set(wx, heightAt(wx, wz), wz); this.group.add(well);
    mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.8, 12, 1, true).translate(0, 0.4, 0), M.stone, well);
    for (const sx of [-0.65, 0.65]) bx(well, 0.1, 1.8, 0.1, M.darkWood, sx, 0.9, 0);
    bx(well, 1.6, 0.12, 1.0, M.roof, 0, 1.85, 0, 0, 0, 0);
    this.colliders.push({ x: wx, z: wz, r: 0.8 });
  }

  /** The Old Mine's entrance: a timber-framed adit in a heap of rock. */
  private caveMouth(): void {
    const { x, z } = CAVE_ENTRANCE;
    const g = this.place(x, z, x - 3, z + 4);
    for (let i = 0; i < 7; i++) {
      const r = mesh(rockGeo(50 + i, 0.8), mat(0x6d6a63, null), g);
      const a = -0.6 + (i / 6) * 4.4;
      r.scale.setScalar(1.6 + (i % 3) * 0.5);
      r.position.set(Math.cos(a) * 3, 0.6 + (i % 2) * 1.2, Math.sin(a) * 3 + 1.5);
    }
    bx(g, 0.25, 2.8, 0.25, M.darkWood, -1.1, 1.4, -0.4);
    bx(g, 0.25, 2.8, 0.25, M.darkWood, 1.1, 1.4, -0.4);
    bx(g, 2.7, 0.3, 0.3, M.darkWood, 0, 2.85, -0.4);
    const hole = mesh(new THREE.PlaneGeometry(2, 2.7), new THREE.MeshBasicMaterial({ color: 0x050403 }), g, false);
    hole.position.set(0, 1.35, -0.3); hole.rotation.y = Math.PI;
    const lamp = new THREE.PointLight(0xffb060, 3, 7, 2); lamp.position.set(1.4, 2.2, -0.9); g.add(lamp);
    this.fires.push({ light: lamp, mats: [], base: 3 });
    tag('The Old Mine', 'Walk in · levels 5–12 · Old Knut', 'place', new THREE.Vector3(x, heightAt(x, z) + 3.6, z), 40);
    for (const [dx, dz] of [[-2.2, 0], [2.2, 0], [-2.6, 1.6], [2.6, 1.6], [0, 2.8]]) this.colliders.push({ x: x + dx, z: z + dz, r: 1.1 });
  }

  animate(dt: number): void {
    this.t += dt;
    for (const f of this.fires) {
      const k = 0.85 + Math.sin(this.t * 13 + f.base) * 0.08 + Math.sin(this.t * 7.3) * 0.07;
      f.light.intensity = f.base * k;
      for (const m of f.mats) m.emissiveIntensity = 2.2 * k;
    }
    for (const { c } of this.npcs) {
      animateCharacter(c, 0, Math.sin(this.t * 0.4) * 0.15, false, dt);
      c.head.rotation.y = Math.sin(this.t * 0.3 + c.hipY * 7) * 0.4;
    }
  }
}
