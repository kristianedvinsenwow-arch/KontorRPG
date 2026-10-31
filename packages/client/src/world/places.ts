/**
 * Built places: every crafting station (furnace, anvil, workbench, campfire, stove), every NPC,
 * Ingrid's trading stall at camp, Bjørkvik Lodge with its eight rented rooms, a few village
 * cottages, and the mouth of the Old Mine. Positions all come from shared data, so the server
 * checks the same spots.
 */
import * as THREE from 'three';
import { STABLE, CAVE_ENTRANCE, GRUBEN, GRUBEN_PASS, GRUBEN_SPOTS, HOMES, HOUSES, INN, homeAt, innRoom, toWorld, NPCS, PIER, PORTAL_BY_ID, STATIONS, VILLAGE, heightAt, type Home, type Npc, type Station } from '@kontor/shared';
import { mat, bx, mesh, canvasTex } from '../engine/procgen.js';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';
import { makeHorse, animateHorse, type Horse } from '../entities/horse.js';
import { addLabel } from '../engine/labels.js';
import { rockGeo } from './props.js';
import type { Collider } from './props.js';

const GRUBEN_CAMP = { x: GRUBEN.x + GRUBEN_SPOTS.arrival.x, z: GRUBEN.z + GRUBEN_SPOTS.arrival.z };

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
  /** How many real point lights the fires share. */
  static readonly POOL = 4;
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /**
   * Every fire and lamp in the world. They are not lights themselves: three.js shades every surface
   * once per point light in the scene (even far away or at zero), so a small fixed pool of real
   * lights follows the fires nearest to you instead (see animate).
   */
  private fires: { light: THREE.Object3D; mats: THREE.MeshStandardMaterial[]; base: number; color: number; range: number; pos?: THREE.Vector3 }[] = [];
  private pool: THREE.PointLight[] = [];
  private poolFor: number[] = [];
  private nextPick = 0;
  private npcs: { c: Character; n: Npc; g: THREE.Group }[] = [];
  private t = 0;
  private doorTags: HTMLElement[] = [];
  private stableHorse: Horse | null = null;
  private windows: THREE.MeshStandardMaterial[] = [];
  private night = 0;
  private roomDoors: { hinge: THREE.Group; open: boolean; angle: number; col: Collider; home: { x: number; z: number }; outward?: boolean }[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (const s of STATIONS) this.station(s);
    for (const n of NPCS) this.npc(n);
    this.stall();
    this.lodge();
    this.village();
    this.pier();
    this.fence();
    this.signpost(-7, 12.5, [['Bjørkvik', VILLAGE.x, VILLAGE.z], ['Camp', 0, 0]]);
    this.signpost(18, -16, [['Grey Ridge', 86, -14], ['Old Mine', 50, -78], ['Camp', 0, 0]]);
    this.signpost(24, 26, [['North Scree', 30, 94], ['Wolf pack ⚠', 66, 33], ['Camp', 0, 0]]);
    this.signpost(-38, 22, [['Goblin camp ⚠', -62, -60], ['Bjørkvik', VILLAGE.x, VILLAGE.z]]);
    this.caveMouth();
    this.signpost(86, 40, [['Gruben pass ⚠', GRUBEN_PASS.x, GRUBEN_PASS.z], ['Wolf pack ⚠', 66, 33], ['Camp', 0, 0]]);
    this.passGate(GRUBEN_PASS.x, GRUBEN_PASS.z, 70, 34, 'Pass to Gruben', 'Walk through · monsters level 13–22 · the Mine King');
    this.gruben();
    this.stable();
  }

  /**
   * A group standing at (x, z), its −Z facing (faceX, faceZ). With a footprint (w × d), it sits on
   * the highest ground under it and gets a stone plinth down to the lowest, so nothing floats on a
   * slope or half-sinks into it.
   */
  private place(x: number, z: number, faceX = 0, faceZ = 0, foot?: [number, number]): THREE.Group {
    const g = new THREE.Group();
    g.rotation.y = Math.atan2(faceX - x, faceZ - z) + Math.PI;
    let y = heightAt(x, z);
    if (foot) {
      const [w, d] = foot, c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
      const hs: number[] = [];
      for (const lx of [-w / 2, 0, w / 2]) for (const lz of [-d / 2, 0, d / 2]) hs.push(heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
      const hi = Math.max(...hs), lo = Math.min(...hs);
      y = hi;
      if (hi - lo > 0.04) bx(g, w + 0.2, hi - lo + 0.4, d + 0.2, M.stone, 0, -(hi - lo + 0.4) / 2 + 0.02, 0);
    }
    g.position.set(x, y, z);
    this.group.add(g);
    return g;
  }

  private fire(parent: THREE.Object3D, y: number, intensity: number, range: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 1 });
    const light = new THREE.Object3D();
    light.position.y = y;
    parent.add(light);
    this.fires.push({ light, mats: [m], base: intensity, color: 0xff7a2a, range });
    return m;
  }

  private station(s: Station): void {
    const centre = s.id.startsWith('camp') ? { x: 0, z: 0 } : s.id.startsWith('gruben') ? GRUBEN_CAMP : VILLAGE;
    const foot: Record<string, [number, number]> = { furnace: [2.2, 2.2], anvil: [1.2, 1.2], workbench: [2, 1], stove: [1.4, 1], tanning: [2.2, 1], loom: [1.8, 1.2], alchemy: [1.6, 0.9] };
    const g = this.place(s.x, s.z, centre.x, centre.z, foot[s.kind]);
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
    } else if (s.kind === 'tanning') {
      // An A-frame rack with two hides stretched on it, and a soaking tub.
      for (const sx of [-1, 1]) {
        const leg = bx(g, 0.08, 2, 0.08, M.darkWood, sx * 1, 0.95, 0.25, 0.25, 0, 0); void leg;
        bx(g, 0.08, 2, 0.08, M.darkWood, sx * 1, 0.95, -0.25, -0.25, 0, 0);
      }
      bx(g, 2.2, 0.08, 0.08, M.darkWood, 0, 1.9, 0);
      const hide = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.95, side: THREE.DoubleSide });
      for (const sx of [-0.48, 0.48]) {
        const hp = mesh(new THREE.PlaneGeometry(0.85, 1.3), hide, g); hp.position.set(sx, 1.15, -0.2); hp.rotation.x = -0.25;
      }
      const tub = mesh(new THREE.CylinderGeometry(0.4, 0.35, 0.5, 12).translate(0, 0.25, 0), M.darkWood, g); tub.position.set(1.4, 0, 0.5);
      h = 2.3;
    } else if (s.kind === 'loom') {
      // A standing loom with a half-woven cloth, and a spinning wheel beside it.
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.35, 0.35]) bx(g, 0.08, 1.6, 0.08, M.darkWood, sx, 0.8, sz);
      bx(g, 1.7, 0.08, 0.08, M.darkWood, 0, 1.55, -0.35); bx(g, 1.7, 0.08, 0.08, M.darkWood, 0, 0.55, 0.35);
      bx(g, 1.7, 0.1, 0.1, M.wood, 0, 0.75, -0.35);
      const cloth = mesh(new THREE.PlaneGeometry(1.4, 0.75), new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 1, side: THREE.DoubleSide }), g);
      cloth.position.set(0, 1.15, -0.35);
      for (let i = 0; i < 12; i++) bx(g, 0.01, 0.75, 0.01, mat(0xe8e0cc, null), -0.65 + i * 0.12, 0.95, 0);
      const wheel = mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 16), M.wood, g); wheel.position.set(1.35, 0.6, 0.1); wheel.rotation.y = Math.PI / 2;
      bx(g, 0.06, 0.6, 0.06, M.darkWood, 1.35, 0.3, 0.1);
      h = 2;
    } else if (s.kind === 'alchemy') {
      // A table with a bubbling flask over a burner, bottles and drying herbs.
      bx(g, 1.5, 0.08, 0.8, M.plank, 0, 0.9, 0);
      for (const [px, pz] of [[-0.68, -0.33], [0.68, -0.33], [-0.68, 0.33], [0.68, 0.33]]) bx(g, 0.07, 0.9, 0.07, M.darkWood, px, 0.45, pz);
      const glass = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75, emissive: c, emissiveIntensity: 0.35 });
      const flask = mesh(new THREE.SphereGeometry(0.13, 10, 8), glass(0x6fd88a), g); flask.position.set(-0.3, 1.12, 0);
      mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 8), glass(0xd8e8e0), g).position.set(-0.3, 1.3, 0);
      const burner = this.fire(g, 1.0, 1.2, 3); void burner;
      g.children.at(-1)!.position.set(-0.3, 1.0, 0);
      bx(g, 0.18, 0.08, 0.18, M.iron, -0.3, 0.97, 0);
      [0xd84a3a, 0x4a8ad8, 0xe8c040].forEach((c, i) => { const b = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 8), glass(c), g); b.position.set(0.15 + i * 0.16, 1.04, -0.18); });
      // Herbs hung to dry from a rail.
      for (const sx of [-0.7, 0.7]) bx(g, 0.05, 0.9, 0.05, M.darkWood, sx, 1.35, 0.35);
      bx(g, 1.45, 0.04, 0.04, M.darkWood, 0, 1.78, 0.35);
      for (let i = 0; i < 5; i++) { const bunch = mesh(new THREE.ConeGeometry(0.06, 0.25, 5), mat([0x6f9a42, 0x8a9a5a, 0x5f8a3a][i % 3], null), g); bunch.position.set(-0.55 + i * 0.27, 1.62, 0.35); bunch.rotation.x = Math.PI; }
      h = 2;
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
    const centre = n.x > 600 ? GRUBEN_CAMP : Math.hypot(n.x, n.z) < 30 ? { x: 0, z: 0 } : { x: VILLAGE.x, z: VILLAGE.z };
    g.rotation.y = Math.atan2(n.x - centre.x, n.z - centre.z);
    g.add(c.g);
    const look: Record<string, Parameters<typeof applyGear>[1]> = {
      ingrid: { b: 'leather_backpack' }, mats: { h: 'iron_pickaxe', hd: 'stone_helm' }, sigrid: { h: 'iron_sword', c: 'iron_breastplate' },
      halvard: { h: 'pine_longbow', c: 'leather_breastplate' }, tor: { h: 'iron_hatchet' }, frida: { h: 'pine_rod' }, ragna: { h: 'birch_frost_staff', b: 'small_rucksack' },
      johan: { h: 'steel_pickaxe', hd: 'iron_helm', c: 'leather_breastplate' },
      eirik: { c: 'leather_breastplate', l: 'leather_greaves' },
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
    const post = this.place(n.x, n.z, 0, 0, [3.2, 2.2]);
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

  /**
   * Bjørkvik Lodge: a long timber house with a turf roof and eight small rooms behind numbered
   * doors. Each room has a bed against the back wall, a nightstand and a chest at the foot of the
   * bed. Doors swing open (only the tenant can open them; the server enforces it).
   */
  private lodge(): void {
    const W = INN.w, D = INN.d, RW = W / INN.rooms;
    const g = this.place(INN.x, INN.z, INN.x, INN.z - 1, [W, D]);
    g.rotation.y = 0;
    const gy = g.position.y;
    // Floor and ceiling.
    bx(g, W, 0.08, D, M.plank, 0, 0.04, 0);
    bx(g, W, 0.08, D, M.darkWood, 0, 3.12, 0);
    const doorX = (n: number) => -W / 2 + (n + 0.5) * RW;
    // Log walls; the front wall has door openings below the lintel.
    const DOOR_W = 1.1, DOOR_H = 2.2;
    for (let i = 0; i < 9; i++) {
      const y = 0.25 + i * 0.32;
      const log = (x0: number, x1: number, z: number) => { const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, x1 - x0, 8), M.wood, g); l.rotation.z = Math.PI / 2; l.position.set((x0 + x1) / 2, y, z); };
      log(-W / 2 - 0.2, W / 2 + 0.2, -D / 2);
      if (y > DOOR_H) log(-W / 2 - 0.2, W / 2 + 0.2, D / 2);
      else {
        let x = -W / 2 - 0.2;
        for (let n = 0; n < INN.rooms; n++) { log(x, doorX(n) - DOOR_W / 2, D / 2); x = doorX(n) + DOOR_W / 2; }
        log(x, W / 2 + 0.2, D / 2);
      }
      for (const sx of [-1, 1]) { const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, D + 0.4, 8), M.wood, g); l.rotation.x = Math.PI / 2; l.position.set(sx * W / 2, y + 0.16, 0); }
    }
    // Gable roof with turf.
    for (const sz of [-1, 1]) {
      bx(g, W + 1.2, 0.18, D * 0.62, M.roof, 0, 3.75, sz * D * 0.26, sz * 0.62, 0, 0);
      const turf = bx(g, W + 1.1, 0.12, D * 0.6, M.turf, 0, 3.9, sz * D * 0.26, sz * 0.62, 0, 0);
      turf.position.y += 0.05;
    }
    const linen = mat(0xe8e2d4, 'cloth', { r: 0.95 });
    const blanket = [0x7a3a32, 0x3a5a7a, 0x5a6a3a, 0x7a6a3a];
    for (let n = 0; n < INN.rooms; n++) {
      const lx = doorX(n), room = innRoom(n);
      const rx = (x: number) => x - INN.x, rz = (z: number) => z - INN.z;
      // Partition to the next room.
      if (n < INN.rooms - 1) bx(g, 0.1, 3.05, D, M.plank, -W / 2 + (n + 1) * RW, 1.55, 0);
      // Door frame, number board and the door itself on a hinge.
      bx(g, 0.12, DOOR_H, 0.3, M.darkWood, lx - DOOR_W / 2 - 0.04, DOOR_H / 2, D / 2);
      bx(g, 0.12, DOOR_H, 0.3, M.darkWood, lx + DOOR_W / 2 + 0.04, DOOR_H / 2, D / 2);
      bx(g, DOOR_W + 0.3, 0.14, 0.32, M.darkWood, lx, DOOR_H + 0.05, D / 2);
      const sign = canvasTex((c, sz) => { c.fillStyle = '#6b4c2e'; c.fillRect(0, 0, sz, sz); c.fillStyle = '#f0e2c0'; c.font = `700 ${sz * 0.7}px "Saira Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n + 1), sz / 2, sz * 0.55); }, 64);
      const plate = mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }), g);
      plate.position.set(lx, DOOR_H + 0.4, D / 2 + 0.18);
      const hinge = new THREE.Group(); hinge.position.set(lx - DOOR_W / 2, 0, D / 2); g.add(hinge);
      bx(hinge, DOOR_W, DOOR_H - 0.05, 0.08, M.darkWood, DOOR_W / 2, DOOR_H / 2, 0);
      for (const hy of [0.4, 1.7]) bx(hinge, DOOR_W * 0.9, 0.08, 0.1, M.iron, DOOR_W / 2, hy, 0);
      const knob = mesh(new THREE.SphereGeometry(0.045, 6, 4), M.iron, hinge); knob.position.set(DOOR_W - 0.15, 1.05, 0.07);
      const col: Collider = { x: INN.x + lx, z: INN.z + D / 2, r: 0.55 };
      this.colliders.push(col);
      this.roomDoors[n] = { hinge, open: false, angle: 0, col, home: { x: col.x, z: col.z } };
      // Bed against the back wall, nightstand by its head, chest at its foot.
      const bed = new THREE.Group(); bed.position.set(rx(room.bed.x), 0.08, rz(room.bed.z)); g.add(bed);
      bx(bed, 1.0, 0.3, 2.0, M.darkWood, 0, 0.25, 0);
      bx(bed, 0.92, 0.16, 1.9, linen, 0, 0.48, 0);
      bx(bed, 0.94, 0.06, 1.3, mat(blanket[n % blanket.length], 'cloth', { r: 1 }), 0, 0.58, 0.3);
      bx(bed, 0.6, 0.12, 0.32, linen, 0, 0.62, -0.75);
      bx(bed, 1.0, 0.75, 0.08, M.darkWood, 0, 0.45, -1.0);
      const ns = new THREE.Group(); ns.position.set(rx(room.nightstand.x), 0.08, rz(room.nightstand.z)); g.add(ns);
      bx(ns, 0.45, 0.55, 0.4, M.wood, 0, 0.28, 0);
      const candle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), linen, ns); candle.position.set(0.08, 0.63, 0);
      const flame = mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xffa040, emissiveIntensity: 3 }), ns, false); flame.position.set(0.08, 0.73, 0);
      const ch = new THREE.Group(); ch.position.set(rx(room.chest.x), 0.08, rz(room.chest.z)); g.add(ch);
      bx(ch, 0.8, 0.42, 0.46, M.wood, 0, 0.21, 0);
      bx(ch, 0.84, 0.08, 0.5, M.iron, 0, 0.44, 0);
      bx(ch, 0.1, 0.12, 0.04, M.iron, 0, 0.32, 0.25);
      this.colliders.push({ x: room.bed.x, z: room.bed.z - 0.5, r: 0.5 }, { x: room.bed.x, z: room.bed.z + 0.45, r: 0.5 }, { x: room.chest.x, z: room.chest.z, r: 0.42 }, { x: room.nightstand.x, z: room.nightstand.z, r: 0.28 });
      // Partition colliders.
      if (n < INN.rooms - 1) for (let z = -D / 2; z <= D / 2; z += 0.4) this.colliders.push({ x: INN.x - W / 2 + (n + 1) * RW, z: INN.z + z, r: 0.1 });
      this.doorTag(HOMES[n], 2.9);
    }
    // Lodge sign.
    const sign = canvasTex((c, s) => { c.fillStyle = '#5a3d24'; c.fillRect(0, 0, s, s / 3); c.fillStyle = '#f0e2c0'; c.font = `700 ${s * 0.15}px "Saira Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BJØRKVIK LODGE', s / 2, s / 6); }, 256);
    const sp = mesh(new THREE.PlaneGeometry(3.2, 1.07), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8, transparent: true }), g);
    sp.position.set(0, 3.45, D / 2 + 0.2);
    sign.repeat.set(1, 1 / 3); sign.offset.set(0, 2 / 3);
    // Outer walls block movement (thin rows of colliders), leaving the doorways open.
    for (let x = -W / 2; x <= W / 2 + 1e-6; x += 0.4) {
      this.colliders.push({ x: INN.x + x, z: INN.z - D / 2, r: 0.2 });
      if (!Array.from({ length: INN.rooms }, (_, n) => Math.abs(x - doorX(n)) < DOOR_W / 2 + 0.15).some(Boolean)) this.colliders.push({ x: INN.x + x, z: INN.z + D / 2, r: 0.2 });
    }
    for (let z = -D / 2; z <= D / 2 + 1e-6; z += 0.4) for (const sx of [-1, 1]) this.colliders.push({ x: INN.x + sx * W / 2, z: INN.z + z, r: 0.2 });
    void gy;
  }

  /** Windows glow and fires burn brighter after dark. */
  setNight(n: number): void {
    if (Math.abs(n - this.night) < 0.01) return;
    this.night = n;
    for (const w of this.windows) w.emissiveIntensity = n * 1.6;
  }

  openDoors(): number[] { return this.roomDoors.flatMap((d, n) => (d?.open ? [n] : [])); }

  /** Positions of every fire (campfires, furnaces, stoves, hearths, lanterns), for sound. */
  firePositions(): THREE.Vector3[] { return this.fires.map((f) => (f.pos ??= f.light.getWorldPosition(new THREE.Vector3()))); }

  doorOpen(n: number): boolean { return !!this.roomDoors[n]?.open; }

  /** Lodge room doors: which stand open (from the server). */
  setDoors(open: number[]): void {
    this.roomDoors.forEach((d, n) => { if (d) d.open = open.includes(n); });
  }

  /**
   * Per frame: swing doors, and move each closed door's collider into its doorway — except for
   * someone who's inside a room that isn't theirs (they can always get out).
   */
  updateDoors(dt: number, meX: number, meZ: number, myRoom: number | null): void {
    const inside = homeAt(meX, meZ);
    this.roomDoors.forEach((d, n) => {
      if (!d) return;
      const want = d.open ? (d.outward ? 1.45 : -1.45) : 0;
      d.angle += (want - d.angle) * Math.min(1, dt * 6);
      d.hinge.rotation.y = d.angle;
      const blocks = !d.open && !(inside === n && myRoom !== n);
      d.col.x = blocks ? d.home.x : 1e6;
      d.col.z = d.home.z;
    });
  }

  /** Names on the room doors (from the server's room list). */
  setRooms(names: (string | null)[]): void {
    this.doorTags.forEach((el, i) => {
      const h = HOMES[i];
      if (!h) return;
      const label = h.kind === 'room' ? `Room ${i + 1}` : h.name;
      el.textContent = names[i] ? `${label} · ${names[i]}` : `${label} · vacant · ${h.price} g/wk`;
      el.classList.toggle('free', !names[i]);
    });
  }

  /** A door tag for a home (filled in by setRooms). */
  private doorTag(h: Home, y: number): void {
    const el = document.createElement('div');
    el.className = 'tag door free';
    el.textContent = h.kind === 'room' ? `Room ${h.id + 1}` : h.name;
    this.doorTags[h.id] = el;
    addLabel(el, () => new THREE.Vector3(h.door.x, heightAt(h.door.x, h.door.z) + y, h.door.z), 16);
  }

  /**
   * A rentable cottage (plank walls, turf roof) or miners' hut (stone and planks). Inside: a bed
   * against the back wall, the chest at its foot, a hearth, and (cottages) a table with stools.
   * The door works like the lodge rooms': only the tenant opens it.
   */
  private house(h: Home): void {
    const f = HOUSES.find((x) => x.id === h.id)!;
    const hut = f.kind === 'hut', { w, d, doorW } = f;
    const H = hut ? 2.2 : 2.4, T = 0.16;
    const g = new THREE.Group();
    g.position.set(f.x, f.floor, f.z); g.rotation.y = f.ry;
    this.group.add(g);
    // Plinth down to the lowest ground under the footprint.
    let lo = f.floor;
    for (const lx of [-w / 2, 0, w / 2]) for (const lz of [-d / 2, 0, d / 2]) { const p = toWorld(f, lx, lz); lo = Math.min(lo, heightAt(p.x, p.z)); }
    if (f.floor - lo > 0.04) bx(g, w + 0.5, f.floor - lo + 0.3, d + 0.5, M.stone, 0, -(f.floor - lo + 0.3) / 2 + 0.02, 0);
    const wallM = hut ? M.plank : M.plank;
    bx(g, w, 0.08, d, M.darkWood, 0, 0.04, 0);
    // Walls: back, sides, and the front around the doorway.
    const wall = (x: number, z: number, ww: number, dd: number, y0 = 0, hh = H) => {
      if (hut && y0 < 0.9) { const sh = Math.min(hh, 0.9 - y0); bx(g, ww, sh, dd, M.stone, x, y0 + sh / 2, z); if (hh > sh) bx(g, ww, hh - sh, dd, wallM, x, y0 + sh + (hh - sh) / 2, z); }
      else bx(g, ww, hh, dd, wallM, x, y0 + hh / 2, z);
    };
    wall(0, d / 2, w + T, T);
    for (const sx of [-1, 1]) wall(sx * w / 2, 0, T, d + T);
    const side = (w - doorW) / 2;
    for (const sx of [-1, 1]) wall(sx * (doorW / 2 + side / 2), -d / 2, side + T / 2, T);
    wall(0, -d / 2, doorW, T, 2.05, H - 2.05);
    // Window on the right-hand wall; it glows at night.
    const win = new THREE.MeshStandardMaterial({ color: 0xe8d8a8, roughness: 0.3, emissive: 0xffb060, emissiveIntensity: 0 });
    this.windows.push(win);
    // The panes sit a few cm proud of each face of the wall (not inside it, which flickered), with a
    // wooden frame around the outside one.
    for (const sx of [1, -1]) bx(g, 0.02, 0.6, 0.8, win, w / 2 + sx * (T / 2 + 0.02), 1.45, -0.3);
    const fx = w / 2 + T / 2 + 0.035;
    for (const dy of [-0.33, 0.33]) bx(g, 0.07, 0.07, 0.94, M.darkWood, fx, 1.45 + dy, -0.3);
    for (const dz of [-0.435, 0.435]) bx(g, 0.07, 0.6, 0.07, M.darkWood, fx, 1.45, -0.3 + dz);
    bx(g, 0.05, 0.6, 0.04, M.darkWood, fx + 0.01, 1.45, -0.3);
    // Ceiling and roof.
    bx(g, w - T, 0.06, d - T, M.darkWood, 0, H - 0.03, 0); // inside the walls, so no faces share a plane
    // Two roof slabs meeting at the ridge, their low edges resting on the wall tops.
    const slope = 0.5, half = (w / 2 + 0.35) / Math.cos(slope);
    for (const sx of [-1, 1]) bx(g, half, 0.16, d + 0.6, hut ? M.roof : M.turf, sx * (w / 2 + 0.35) / 2, H + 0.1 + Math.tan(slope) * (w / 2 + 0.35) / 2, 0, 0, 0, -sx * slope);
    // Gable ends: stacked boards, narrowing to the ridge.
    const ridge = Math.tan(slope) * (w / 2 + 0.35);
    for (const sz of [-1, 1]) for (let i = 0, n = Math.ceil(ridge / 0.22); i < n; i++) bx(g, w * (1 - (i + 0.5) / n), 0.22, 0.06, M.wood, 0, H + 0.11 + i * 0.22, sz * (d / 2 + T / 2));
    // Door on a hinge.
    const hinge = new THREE.Group(); hinge.position.set(-doorW / 2, 0, -d / 2); g.add(hinge);
    bx(hinge, doorW, 2.0, 0.07, M.darkWood, doorW / 2, 1.02, 0);
    for (const hy of [0.4, 1.6]) bx(hinge, doorW * 0.9, 0.07, 0.09, M.iron, doorW / 2, hy, 0);
    const knob = mesh(new THREE.SphereGeometry(0.04, 6, 4), M.iron, hinge); knob.position.set(doorW - 0.14, 1.0, -0.06);
    const dw = toWorld(f, 0, -d / 2);
    const col: Collider = { x: dw.x, z: dw.z, r: 0.5 };
    this.colliders.push(col);
    this.roomDoors[h.id] = { hinge, open: false, angle: 0, col, home: { x: dw.x, z: dw.z }, outward: true };
    // Furniture.
    const linen = mat(0xe8e2d4, 'cloth', { r: 0.95 });
    const bed = new THREE.Group(); bed.position.set(f.bed.x, 0.08, f.bed.z); bed.rotation.y = Math.PI; g.add(bed);
    bx(bed, 1.0, 0.3, 2.0, M.darkWood, 0, 0.25, 0);
    bx(bed, 0.92, 0.16, 1.9, linen, 0, 0.48, 0);
    bx(bed, 0.94, 0.06, 1.3, mat(hut ? 0x6a5a3a : 0x7a3a32, 'cloth', { r: 1 }), 0, 0.58, 0.3);
    bx(bed, 0.6, 0.12, 0.32, linen, 0, 0.62, -0.75);
    bx(bed, 1.0, 0.75, 0.08, M.darkWood, 0, 0.45, -1.0);
    const ch = new THREE.Group(); ch.position.set(f.chest.x, 0.08, f.chest.z); g.add(ch);
    if (hut) ch.rotation.y = Math.PI / 2;
    bx(ch, 0.8, 0.42, 0.46, M.wood, 0, 0.21, 0);
    bx(ch, 0.84, 0.08, 0.5, M.iron, 0, 0.44, 0);
    // Hearth with a fire, and a chimney through the roof.
    const he = new THREE.Group(); he.position.set(f.hearth.x, 0.08, f.hearth.z); g.add(he);
    bx(he, 0.9, 0.9, 0.7, M.stone, 0, 0.45, 0.1);
    const fm = new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 1 });
    const hl = new THREE.Object3D(); hl.position.set(0, 0.5, -0.4); he.add(hl);
    this.fires.push({ light: hl, mats: [fm], base: 2, color: 0xff7a2a, range: 5 });
    const fl = mesh(new THREE.PlaneGeometry(0.45, 0.3), fm, he, false); fl.position.set(0, 0.3, -0.26); fl.rotation.y = Math.PI;
    bx(he, 0.4, H + 1.2, 0.4, M.dark, 0.1, (H + 1.2) / 2 + 0.6, 0.2);
    if (f.table) {
      const t = new THREE.Group(); t.position.set(f.table.x, 0.08, f.table.z); g.add(t);
      bx(t, 1.1, 0.07, 0.7, M.plank, 0, 0.75, 0);
      for (const [px, pz] of [[-0.45, -0.28], [0.45, -0.28], [-0.45, 0.28], [0.45, 0.28]]) bx(t, 0.07, 0.72, 0.07, M.darkWood, px, 0.36, pz);
      for (const sx of [-1, 1]) { const st = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.45, 10).translate(0, 0.225, 0), M.wood, t); st.position.set(sx * 0.8, 0, 0); }
      const mug = mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 8), M.iron, t); mug.position.set(0.2, 0.84, 0.1);
      const p = toWorld(f, f.table.x, f.table.z); this.colliders.push({ x: p.x, z: p.z, r: 0.5 });
    }
    // Colliders: walls (leaving the doorway), furniture.
    const push = (lx: number, lz: number, r: number) => { const p = toWorld(f, lx, lz); this.colliders.push({ x: p.x, z: p.z, r }); };
    for (let lx = -w / 2; lx <= w / 2 + 1e-6; lx += 0.35) { push(lx, d / 2, 0.18); if (Math.abs(lx) > doorW / 2 + 0.15) push(lx, -d / 2, 0.18); }
    for (let lz = -d / 2; lz <= d / 2 + 1e-6; lz += 0.35) for (const sx of [-1, 1]) push(sx * w / 2, lz, 0.18);
    push(f.bed.x, f.bed.z + 0.45, 0.5); push(f.bed.x, f.bed.z - 0.5, 0.5); push(f.chest.x, f.chest.z, 0.42); push(f.hearth.x, f.hearth.z, 0.5);
    this.doorTag(h, H + 1.2);
  }

  /** A couple of turf-roofed cottages and a well around the green. */
  private village(): void {
    // Rentable cottages on the flat east side of the green, doors facing the middle.
    for (const h of HOMES) if (h.kind === 'cottage') this.house(h);
    const wx = VILLAGE.x + 4, wz = VILLAGE.z + 3;
    const well = this.place(wx, wz, VILLAGE.x, VILLAGE.z, [1.6, 1.6]);
    mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.8, 12, 1, true).translate(0, 0.4, 0), M.stone, well);
    for (const sx of [-0.65, 0.65]) bx(well, 0.1, 1.8, 0.1, M.darkWood, sx, 0.9, 0);
    bx(well, 1.6, 0.12, 1.0, M.roof, 0, 1.85, 0, 0, 0, 0);
    this.colliders.push({ x: wx, z: wz, r: 0.8 });
  }

  /** Bjørkvik's fishing pier: plank deck on stilts down to the lake bed, a lantern at the end. */
  private pier(): void {
    const P = PIER;
    const g = new THREE.Group();
    g.position.set(P.x, 0, P.z);
    g.rotation.y = Math.atan2(P.ux, P.uz); // local +Z runs out along the pier
    this.group.add(g);
    const plank = mat(0x8a6a48, 'wood', { r: 0.85 });
    for (let d = 0; d < P.length; d += 0.5) bx(g, P.width, 0.08, 0.46, plank, 0, P.deck - 0.04, d + 0.25);
    for (const sx of [-1, 1]) bx(g, 0.1, 0.16, P.length, M.darkWood, sx * (P.width / 2 - 0.05), P.deck - 0.16, P.length / 2);
    for (let d = 0.3; d <= P.length; d += 2.2) for (const sx of [-1, 1]) {
      const wx = P.x + P.ux * d + -P.uz * 0 + (sx * (P.width / 2 - 0.1)) * P.uz, wz = P.z + P.uz * d - (sx * (P.width / 2 - 0.1)) * P.ux;
      const bottom = Math.min(heightAt(wx, wz), -0.2) - 0.4;
      const len = P.deck - bottom;
      const post = mesh(new THREE.CylinderGeometry(0.09, 0.1, len, 7), M.darkWood, g);
      post.position.set(sx * (P.width / 2 - 0.1), bottom + len / 2, d);
      // Railing posts along the outer two thirds.
      if (d > P.length * 0.35) { bx(g, 0.07, 0.9, 0.07, M.darkWood, sx * (P.width / 2 - 0.1), P.deck + 0.45, d); }
    }
    for (const sx of [-1, 1]) bx(g, 0.06, 0.06, P.length * 0.65, M.wood, sx * (P.width / 2 - 0.1), P.deck + 0.85, P.length * 0.675);
    const lampPost = bx(g, 0.1, 2, 0.1, M.darkWood, P.width / 2 - 0.1, P.deck + 1, P.length - 0.2); void lampPost;
    const lamp = new THREE.Object3D(); lamp.position.set(P.width / 2 - 0.3, P.deck + 2, P.length - 0.2); g.add(lamp);
    this.fires.push({ light: lamp, mats: [], base: 3, color: 0xffb060, range: 9 });
    const end = new THREE.Vector3(P.x + P.ux * (P.length - 1), P.deck + 2.4, P.z + P.uz * (P.length - 1));
    tag('Fishing pier', 'Cast off the end', 'place', end, 30);
  }

  /** A split-rail fence around Bjørkvik's east side, open towards the paths and the lake. */
  private fence(): void {
    const r = 23.5, a0 = -0.6, a1 = 2.1, step = 2.4 / r;
    const pts: THREE.Vector3[] = [];
    for (let a = a0; a <= a1 + 1e-6; a += step) {
      const x = VILLAGE.x + Math.cos(a) * r, z = VILLAGE.z + Math.sin(a) * r;
      pts.push(new THREE.Vector3(x, heightAt(x, z), z));
      this.colliders.push({ x, z, r: 0.25 });
    }
    for (const p of pts) { const post = bx(this.group, 0.12, 1.1, 0.12, M.darkWood, p.x, p.y + 0.5, p.z); void post; }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (const h of [0.45, 0.85]) {
        const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), M.wood, this.group);
        const pa = a.clone().setY(a.y + h), pb = b.clone().setY(b.y + h);
        rail.position.copy(pa).add(pb).multiplyScalar(0.5);
        rail.scale.y = pa.distanceTo(pb);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
        this.colliders.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: 0.3 });
      }
    }
  }

  /** Bjørkvik's stable: an open-fronted shed with a hay rack, a trough and a horse in it. */
  private stable(): void {
    const S = STABLE;
    const g = this.place(S.x, S.z, VILLAGE.x, VILLAGE.z, [S.w, S.d]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, 0.18, 2.6, 0.18, M.darkWood, sx * (S.w / 2 - 0.1), 1.3, sz * (S.d / 2 - 0.1));
    bx(g, S.w, 2.4, 0.12, M.plank, 0, 1.2, S.d / 2 - 0.05);
    for (const sx of [-1, 1]) bx(g, 0.12, 2.4, S.d, M.plank, sx * (S.w / 2 - 0.05), 1.2, 0);
    bx(g, S.w + 0.6, 0.14, S.d + 0.8, M.roof, 0, 2.75, 0.15, -0.18, 0, 0);
    bx(g, 0.1, 1.0, S.d - 0.6, M.darkWood, 0, 0.5, 0.1); // stall divider
    const trough = mesh(new THREE.BoxGeometry(1.4, 0.35, 0.45), M.darkWood, g); trough.position.set(1.4, 0.18, S.d / 2 - 0.45);
    bx(g, 1.3, 0.06, 0.38, new THREE.MeshStandardMaterial({ color: 0x4a6a7a, roughness: 0.2 }), 1.4, 0.34, S.d / 2 - 0.45);
    for (let i = 0; i < 3; i++) { const bale = bx(g, 0.9, 0.45, 0.55, mat(0xc8b060, 'cloth', { r: 1 }), -1.6, 0.23 + i * 0.45, S.d / 2 - 0.5 - (i % 2) * 0.1); void bale; }
    const horse = makeHorse('fjord_horse');
    horse.g.position.set(1.2, 0, -0.2); horse.g.rotation.y = Math.PI / 2 + 0.2;
    g.add(horse.g);
    this.stableHorse = horse;
    for (const [lx, lz, r] of [[-S.w / 2, 0, 0.5], [S.w / 2, 0, 0.5], [0, S.d / 2, 0.5], [-S.w / 4, S.d / 2, 0.5], [S.w / 4, S.d / 2, 0.5], [1.2, -0.2, 0.9]] as const) {
      const c = Math.cos(g.rotation.y), s2 = Math.sin(g.rotation.y);
      this.colliders.push({ x: S.x + lx * c + lz * s2, z: S.z - lx * s2 + lz * c, r });
    }
    tag('Stable', 'Eirik sells horses · R to ride', 'place', new THREE.Vector3(S.x, heightAt(S.x, S.z) + 3.4, S.z), 30);
  }

  /** A stone gate with a lantern: where you walk through to another region. */
  private passGate(x: number, z: number, faceX: number, faceZ: number, name: string, sub: string): void {
    const g = this.place(x, z, faceX, faceZ);
    const rock = mat(0x6d6a63, null);
    for (const sx of [-1, 1]) {
      const p = mesh(rockGeo(70 + sx, 0.8), rock, g); p.scale.set(1.1, 2.6, 1.1); p.position.set(sx * 1.7, 1.6, 0);
      bx(g, 0.3, 3.2, 0.3, M.darkWood, sx * 1.15, 1.6, -0.3);
    }
    bx(g, 2.8, 0.3, 0.34, M.darkWood, 0, 3.2, -0.3);
    for (let i = 0; i < 5; i++) { const c = mesh(rockGeo(80 + i, 0.5), rock, g); c.scale.setScalar(0.35); c.position.set(-0.6 + i * 0.3, 3.45 + (i % 2) * 0.12, -0.3); }
    const lamp = new THREE.Object3D(); lamp.position.set(1.4, 2.6, -0.8); g.add(lamp);
    this.fires.push({ light: lamp, mats: [], base: 3, color: 0xffb060, range: 8 });
    const glow = mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xffa040, emissiveIntensity: 2 }), g, false);
    glow.position.copy(lamp.position);
    tag(name, sub, 'place', new THREE.Vector3(x, heightAt(x, z) + 4.2, z), 40);
    for (const sx of [-1, 1]) this.colliders.push({ x: x + sx * 1.7 * Math.cos(g.rotation.y), z: z - sx * 1.7 * Math.sin(g.rotation.y), r: 1.1 });
  }

  /** Gruben: the arrival camp (tent, huts, forge), the way back, the dead miners' row and the pit. */
  private gruben(): void {
    const G = GRUBEN, cx = GRUBEN_CAMP.x, cz = GRUBEN_CAMP.z;
    for (const h of HOMES) if (h.kind === 'hut') this.house(h);
    const back = PORTAL_BY_ID.get('gruben_out')!.at;
    this.passGate(back.x, back.z, back.x, back.z - 5, 'Back to the valley', 'Walk through to the pass');
    // Johan's tent.
    const t = this.place(cx - 2, cz - 10, cx, cz, [3, 3]);
    const canvas = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1, side: THREE.DoubleSide });
    const tent = mesh(new THREE.ConeGeometry(2, 2.4, 4, 1, true).translate(0, 1.2, 0), canvas, t); tent.rotation.y = Math.PI / 4;
    this.colliders.push({ x: cx - 2, z: cz - 10, r: 1.4 });
    this.signpost(cx + 3, cz - 4, [['Dead miners’ row ⚠', G.x + GRUBEN_SPOTS.village.x, G.z + GRUBEN_SPOTS.village.z], ['The pit ⚠ Boss', G.x + GRUBEN_SPOTS.pit.x, G.z + GRUBEN_SPOTS.pit.z], ['Lantern bog ⚠', G.x - 42, G.z - 46], ['Lynx slopes', G.x - 46, G.z + 30]]);
    // Dead miners' row: roofless, broken houses.
    const vx = G.x + GRUBEN_SPOTS.village.x, vz = G.z + GRUBEN_SPOTS.village.z;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4, hx = vx + Math.cos(a) * 9, hz = vz + Math.sin(a) * 9;
      const g = this.place(hx, hz, vx, vz, [3.6, 3]);
      for (const [sx, sz, w, dd] of [[0, -1.5, 3.6, 0.3], [0, 1.5, 3.6, 0.3], [-1.8, 0, 0.3, 3], [1.8, 0, 0.3, 3]] as const) {
        const hgt = 0.6 + ((i * 7 + sx * 3 + sz * 5) % 3 + 3) % 3 * 0.55;
        bx(g, w, hgt, dd, M.dark, sx, hgt / 2, sz);
      }
      const beam = bx(g, 0.18, 0.18, 3.4, M.darkWood, 0.4, 1.4, 0, 0.3, 0, 0.5); void beam;
      this.colliders.push({ x: hx, z: hz, r: 1.8 });
    }
    // The pit: a timber headframe over the old shaft, slag heaps around.
    const px = G.x + GRUBEN_SPOTS.pit.x, pz = G.z + GRUBEN_SPOTS.pit.z - 13;
    const hf = this.place(px, pz, px, pz + 10);
    for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const leg = bx(hf, 0.3, 7, 0.3, M.darkWood, sx * 0.8, 3.5, sz * 0.8, sz * -0.08, 0, sx * 0.08); void leg;
    }
    bx(hf, 3, 0.3, 0.3, M.darkWood, 0, 6.9, 0);
    const wheel = mesh(new THREE.TorusGeometry(1, 0.08, 6, 18), M.iron, hf); wheel.position.set(0, 7.4, 0);
    const shaft = mesh(new THREE.CircleGeometry(1.4, 16), new THREE.MeshBasicMaterial({ color: 0x050403 }), hf, false); shaft.rotation.x = -Math.PI / 2; shaft.position.y = 0.05;
    this.colliders.push({ x: px, z: pz, r: 2.2 });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1 + 0.3, sx = G.x + GRUBEN_SPOTS.pit.x + Math.cos(a) * 19, sz = G.z + GRUBEN_SPOTS.pit.z + Math.sin(a) * 19;
      const heap = mesh(new THREE.ConeGeometry(2.4 + (i % 3), 2 + (i % 2), 7), mat(0x3a3836, 'rock', { r: 1 }), this.group);
      heap.position.set(sx, heightAt(sx, sz) + 0.8, sz);
      this.colliders.push({ x: sx, z: sz, r: 2.2 });
    }
    tag('The pit', 'The Mine King · level 22 boss', 'place', new THREE.Vector3(px, heightAt(px, pz) + 8.4, pz), 60);
    tag('Gruben', 'Old mine valley · monsters level 13–22', 'place', new THREE.Vector3(cx, heightAt(cx, cz) + 5, cz - 14), 50);
  }

  /** A signpost with boards pointing at places. */
  private signpost(x: number, z: number, signs: [string, number, number][]): void {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    this.group.add(g);
    bx(g, 0.14, 2.4, 0.14, M.darkWood, 0, 1.2, 0);
    signs.forEach(([text, tx, tz], i) => {
      const board = new THREE.Group();
      board.position.y = 2.05 - i * 0.36;
      board.rotation.y = Math.atan2(tx - x, tz - z) - Math.PI / 2; // local +X points at the place
      g.add(board);
      const tex = canvasTex((c, s) => {
        c.fillStyle = '#7a5a3a'; c.fillRect(0, 0, s, s / 4);
        c.fillStyle = '#f0e2c0'; c.font = `700 ${s * 0.13}px "Saira Condensed", sans-serif`; c.textBaseline = 'middle';
        c.fillText(text, s * 0.06, s / 8);
      }, 256);
      tex.repeat.set(1, 0.25); tex.offset.set(0, 0.75);
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      for (const side of [1, -1]) {
        const p = mesh(new THREE.PlaneGeometry(1.1, 0.27), m, board);
        p.position.set(0.62, 0, side * 0.035);
        if (side < 0) p.rotation.y = Math.PI;
      }
      const tip = mesh(new THREE.ConeGeometry(0.14, 0.2, 3), M.wood, board); tip.rotation.z = -Math.PI / 2; tip.position.x = 1.25; tip.scale.z = 0.3;
      bx(board, 1.1, 0.28, 0.06, M.wood, 0.62, 0, 0);
    });
    this.colliders.push({ x, z, r: 0.2 });
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
    const lamp = new THREE.Object3D(); lamp.position.set(1.4, 2.2, -0.9); g.add(lamp);
    this.fires.push({ light: lamp, mats: [], base: 3, color: 0xffb060, range: 7 });
    tag('The Old Mine', 'Walk in · levels 5–12 · Old Knut', 'place', new THREE.Vector3(x, heightAt(x, z) + 3.6, z), 40);
    for (const [dx, dz] of [[-2.2, 0], [2.2, 0], [-2.6, 1.6], [2.6, 1.6], [0, 2.8]]) this.colliders.push({ x: x + dx, z: z + dz, r: 1.1 });
  }

  animate(dt: number, at: THREE.Vector3): void {
    this.t += dt;
    // The light pool: a fixed number of real lights (a changing count would recompile shaders),
    // given to the fires nearest the camera a few times a second.
    if (!this.pool.length) for (let i = 0; i < Places.POOL; i++) { const l = new THREE.PointLight(0xff7a2a, 0, 8, 1.8); l.position.set(0, -500, 0); this.group.add(l); this.pool.push(l); this.poolFor.push(-1); }
    if (this.t >= this.nextPick) {
      this.nextPick = this.t + 0.3;
      const ps = this.firePositions();
      const near = ps.map((p, i) => [i, p.distanceToSquared(at)] as const).filter(([, d]) => d < 45 * 45).sort((a, b) => a[1] - b[1]).slice(0, Places.POOL);
      this.poolFor = this.pool.map((_, i) => near[i]?.[0] ?? -1);
    }
    const flick = (f: { base: number }) => 0.85 + Math.sin(this.t * 13 + f.base) * 0.08 + Math.sin(this.t * 7.3) * 0.07;
    this.pool.forEach((l, i) => {
      const f = this.fires[this.poolFor[i]];
      if (!f) { l.intensity = 0; return; }
      l.position.copy(f.pos!);
      l.color.setHex(f.color);
      l.distance = f.range;
      l.intensity = f.base * flick(f) * (1 + this.night * 0.25);
    });
    for (const f of this.fires) { const k = flick(f); for (const m of f.mats) m.emissiveIntensity = 2.2 * k; }
    if (this.stableHorse) animateHorse(this.stableHorse, 0, dt);
    for (const { c } of this.npcs) {
      animateCharacter(c, 0, Math.sin(this.t * 0.4) * 0.15, false, dt);
      c.head.rotation.y = Math.sin(this.t * 0.3 + c.hipY * 7) * 0.4;
    }
  }
}
