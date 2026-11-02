/**
 * Built places: every crafting station (furnace, anvil, workbench, campfire, stove), every NPC,
 * Ingrid's trading stall in the market, Bjørkvik Lodge with its eight rented rooms, a few village
 * cottages, and the mouth of the Old Mine. Positions all come from shared data, so the server
 * checks the same spots.
 */
import * as THREE from 'three';
import { GROTTO_ENTRANCE, MANOR_DOCK, MANOR_PRICE, mulberry32, stationHouse, STALL, STABLE, MARKET, TOWN_GATE, CAVE_ENTRANCE, GRUBEN, GRUBEN_PASS, GRUBEN_SPOTS, FJORD, FJORD_SPOTS, FJORD_PIER, SHIPWRECK, fjordMid, HOMES, HOUSES, INN, homeAt, innRoom, toWorld, NPCS, PIER, PORTAL_BY_ID, STATIONS, VILLAGE, heightAt, type Home, type Npc, type Station } from '@kontor/shared';
import { mat, bx, mesh, canvasTex } from '../engine/procgen.js';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { applyGear } from '../entities/held.js';
import { makeHorse, animateHorse, type Horse } from '../entities/horse.js';
import { addLabel } from '../engine/labels.js';
import { rockGeo } from './props.js';
import type { Collider } from './props.js';

const GRUBEN_CAMP = { x: GRUBEN.x + GRUBEN_SPOTS.arrival.x, z: GRUBEN.z + GRUBEN_SPOTS.arrival.z };
/** Metres of railing left off the pier's end, on the boat's side. */
const BOAT_GAP = 4.6;
const FJORD_VILLAGE = { x: FJORD.x + FJORD_SPOTS.village.x, z: FJORD.z + FJORD_SPOTS.village.z };

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
    { const ox = TOWN_GATE.x - VILLAGE.x, oz = TOWN_GATE.z - VILLAGE.z, l = Math.hypot(ox, oz); this.signpost(TOWN_GATE.x + (ox / l) * 3 + (oz / l) * 3.6, TOWN_GATE.z + (oz / l) * 3 - (ox / l) * 3.6, [['Bjørkvik', VILLAGE.x, VILLAGE.z], ['Crossroads', 0, 0]]); } // outside the gate, beside the road
    this.gate();
    this.signpost(18, -16, [['Grey Ridge', 86, -14], ['Old Mine', 50, -78], ['Crossroads', 0, 0]]);
    this.signpost(24, 26, [['North Scree', 30, 94], ['Wolf pack ⚠', 66, 33], ['Crossroads', 0, 0]]);
    this.signpost(-38, 22, [['Goblin camp ⚠', -62, -60], ['Bjørkvik', VILLAGE.x, VILLAGE.z]]);
    this.caveMouth();
    this.grottoMouth();
    this.signpost(86, 40, [['Gruben pass ⚠', GRUBEN_PASS.x, GRUBEN_PASS.z], ['Wolf pack ⚠', 66, 33], ['Crossroads', 0, 0]]);
    this.passGate(GRUBEN_PASS.x, GRUBEN_PASS.z, 70, 34, 'Pass to Gruben', 'Walk through · monsters level 13–22 · the Mine King');
    this.gruben();
    this.stable();
    this.manor();
    this.fjord();
    this.rowboat(PIER, 'fjord', null, null); // labelled by the pier's own tag
  }

  /**
   * A group standing at (x, z), its −Z facing (faceX, faceZ). With a footprint (w × d), it sits on
   * the highest ground under it and gets a stone plinth down to the lowest, so nothing floats on a
   * slope or half-sinks into it.
   */
  /** Solid walls for a box-shaped building (w across, d deep, in the group's own frame): a ring of
   *  small circles along the outline, so corners don't stick through a single round collider. */
  private rectCollider(g: THREE.Object3D, w: number, d: number, r = 0.3): void {
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y), x0 = g.position.x, z0 = g.position.z;
    const add = (lx: number, lz: number) => this.colliders.push({ x: x0 + lx * c + lz * s, z: z0 - lx * s + lz * c, r });
    const hw = w / 2 - r, hd = d / 2 - r;
    for (let t = -hw; t <= hw + 1e-6; t += r * 1.4) { add(t, -hd); add(t, hd); }
    for (let t = -hd; t <= hd + 1e-6; t += r * 1.4) { add(-hw, t); add(hw, t); }
    this.colliders.push({ x: x0, z: z0, r: Math.min(hw, hd) }); // and the middle, so you can't end up inside
  }

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
    const centre = s.id === 'village_furnace' || s.id === 'village_anvil' ? MARKET : s.id.startsWith('camp') ? { x: 0, z: 0 } : s.id.startsWith('gruben') ? GRUBEN_CAMP : s.id.startsWith('fjord') ? FJORD_VILLAGE : VILLAGE;
    const foot: Record<string, [number, number]> = { furnace: [2.2, 2.2], anvil: [1.2, 1.2], workbench: [2, 1], stove: [1.4, 1], tanning: [2.2, 1], loom: [1.8, 1.2], alchemy: [1.6, 0.9] };
    const home = stationHouse(s);
    // A cottage stove stands on the house floor, facing into the room.
    const g = home ? this.place(s.x, s.z, home.x, home.z) : this.place(s.x, s.z, centre.x, centre.z, foot[s.kind]);
    if (home) g.position.y = home.floor + 0.08;
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
    const p = new THREE.Vector3(s.x, (home ? home.floor + 0.08 : heightAt(s.x, s.z)) + h, s.z);
    tag(s.name, home ? 'Cooks 15% faster, burns less' : null, 'station', p, home ? 8 : 22);
  }

  private npc(n: Npc): void {
    const c = makeCharacter(n.color, undefined, n.race, n.face);
    const g = this.place(n.x, n.z, n.id === 'ingrid' ? 0 : n.x + (n.x > VILLAGE.x - 20 && n.z > 20 ? VILLAGE.x - n.x : -n.x) * 0.1, n.z + 1);
    // Face towards the middle of camp / the village green.
    const centre = n.x > 600 ? GRUBEN_CAMP : Math.hypot(n.x - MARKET.x, n.z - MARKET.z) < 14 ? MARKET : { x: VILLAGE.x, z: VILLAGE.z };
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

  /** Ingrid's stall in the market. */
  private stall(): void {
    const n = NPCS.find((x) => x.id === 'ingrid')!;
    const post = this.place(n.x, n.z, STALL.faceX, STALL.faceZ, [3.2, 2.2]);
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
    if (f.kind === 'cottage') { bx(he, 0.4, H + 1.2, 0.4, M.dark, 0.1, (H + 1.2) / 2 + 0.6, 0.2); he.visible = true; } // the stove (a station) stands here; just the chimney
    else {
    bx(he, 0.9, 0.9, 0.7, M.stone, 0, 0.45, 0.1);
    const fm = new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 1 });
    const hl = new THREE.Object3D(); hl.position.set(0, 0.5, -0.4); he.add(hl);
    this.fires.push({ light: hl, mats: [fm], base: 2, color: 0xff7a2a, range: 5 });
    const fl = mesh(new THREE.PlaneGeometry(0.45, 0.3), fm, he, false); fl.position.set(0, 0.3, -0.26); fl.rotation.y = Math.PI;
    bx(he, 0.4, H + 1.2, 0.4, M.dark, 0.1, (H + 1.2) / 2 + 0.6, 0.2);
    }
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
    push(f.bed.x, f.bed.z + 0.45, 0.5); push(f.bed.x, f.bed.z - 0.5, 0.5); push(f.chest.x, f.chest.z, 0.42); if (f.kind !== 'cottage') push(f.hearth.x, f.hearth.z, 0.5);
    this.doorTag(h, H + 1.2);
  }

  /**
   * The Lakeside Manor: the grandest house in the game. A whitewashed, timber-framed hall on a
   * stone terrace, two storeys under a steep slate roof with dormers and tall chimneys, round
   * towers at the front corners, a columned portico, and a walled garden with a fountain, hedges,
   * flowerbeds and lanterns, looking across the lake to Bjørkvik. Inside: one great hall with a
   * fireplace, a four-poster bed, a long dining table under chandeliers, and every workshop.
   */
  private manor(): void {
    const h = HOMES.find((x) => x.kind === 'manor');
    const f = HOUSES.find((x) => x.kind === 'manor');
    if (!h || !f) return;
    const { w, d, doorW } = f;
    const H = 4.4, TOP = 7.6, T = 0.3;
    const g = new THREE.Group();
    g.position.set(f.x, f.floor, f.z); g.rotation.y = f.ry;
    this.group.add(g);
    const plaster = mat(0xf0e9dc, null, { r: 0.92 }), trim = mat(0xf8f4ec, null, { r: 0.6 });
    const slate = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.65, metalness: 0.15 });
    const brick = mat(0x8a4a36, 'rock', { r: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a838, metalness: 0.85, roughness: 0.3 });
    const hedge = mat(0x2f5a2a, 'ground', { r: 1 }), gravel = mat(0xc8beac, 'rock', { r: 1 });
    const red = mat(0x8a2228, 'cloth', { r: 1 }), win = new THREE.MeshStandardMaterial({ color: 0xc8d8e8, roughness: 0.15, metalness: 0.2, emissive: 0xffb060, emissiveIntensity: 0 });
    this.windows.push(win);
    const col = (lx: number, lz: number, r: number) => { const p = toWorld(f, lx, lz); this.colliders.push({ x: p.x, z: p.z, r }); };

    // Terrace: a stone plinth under the whole house, down to the ground.
    let lo = f.floor;
    for (const lx of [-w / 2 - 3, 0, w / 2 + 3]) for (const lz of [-d / 2 - 4, 0, d / 2 + 1]) { const p = toWorld(f, lx, lz); lo = Math.min(lo, heightAt(p.x, p.z)); }
    const plH = f.floor - lo + 0.5;
    bx(g, w + 1.6, plH, d + 1.6, M.stone, 0, -plH / 2 + 0.02, 0);
    bx(g, w + 1.8, 0.12, d + 1.8, trim, 0, 0.0, 0); // cornice round the plinth top
    // Floor: polished boards with a long red runner.
    bx(g, w, 0.08, d, M.plank, 0, 0.06, 0);
    bx(g, 2.2, 0.02, d - 1.2, red, 0, 0.11, 0);
    for (const sx of [-1, 1]) bx(g, 0.08, 0.025, d - 1.2, gold, sx * 1.08, 0.115, 0);

    // Walls: two storeys outside (the upper one is the facade above the great hall's ceiling).
    const wall = (x: number, z: number, ww: number, dd: number, y0: number, hh: number) => bx(g, ww, hh, dd, plaster, x, y0 + hh / 2, z);
    wall(0, d / 2, w + T, T, 0, TOP);
    for (const sx of [-1, 1]) wall(sx * w / 2, 0, T, d + T, 0, TOP);
    const side = (w - doorW) / 2;
    for (const sx of [-1, 1]) wall(sx * (doorW / 2 + side / 2), -d / 2, side + T / 2, T, 0, TOP);
    const DOOR_H = 2.9;
    wall(0, -d / 2, doorW, T, DOOR_H, TOP - DOOR_H);
    // Timber framing on the outside faces: posts, the floor band, the eaves band, and braces.
    const faces: [number, number, number, boolean][] = [[0, -d / 2 - T / 2 - 0.02, w, true], [0, d / 2 + T / 2 + 0.02, w, true], [-w / 2 - T / 2 - 0.02, 0, d, false], [w / 2 + T / 2 + 0.02, 0, d, false]];
    for (const [cx, cz, len, alongX] of faces) {
      for (const y of [0.25, H + 0.15, TOP - 0.15]) bx(g, alongX ? len + 0.3 : 0.1, 0.22, alongX ? 0.1 : len + 0.3, M.darkWood, cx, y, cz);
      for (let u = -len / 2; u <= len / 2 + 1e-6; u += len / Math.round(len / 2)) {
        if (alongX && cz < 0 && Math.abs(u) < doorW / 2 + 0.2) continue;
        bx(g, alongX ? 0.18 : 0.1, TOP, alongX ? 0.1 : 0.18, M.darkWood, alongX ? cx + u : cx, TOP / 2, alongX ? cz : cz + u);
      }
    }
    // Windows: tall ground-floor ones (both faces, so they glow inside too) and the upper row.
    const windowAt = (alongX: boolean, sideSign: number, u: number, y: number, ww: number, hh: number, inside: boolean) => {
      const fx = alongX ? u : sideSign * (w / 2 + T / 2 + 0.035), fz = alongX ? sideSign * (d / 2 + T / 2 + 0.035) : u;
      const ix = alongX ? u : sideSign * (w / 2 - T / 2 - 0.035), iz = alongX ? sideSign * (d / 2 - T / 2 - 0.035) : u;
      bx(g, alongX ? ww : 0.03, hh, alongX ? 0.03 : ww, win, fx, y, fz);
      if (inside) bx(g, alongX ? ww : 0.03, hh, alongX ? 0.03 : ww, win, ix, y, iz);
      // Frame, mullion and transom, and a stone sill.
      const ox = alongX ? 0 : sideSign * 0.03, oz = alongX ? sideSign * 0.03 : 0;
      for (const dy of [-hh / 2, hh / 2]) bx(g, alongX ? ww + 0.16 : 0.08, 0.08, alongX ? 0.08 : ww + 0.16, trim, fx + ox, y + dy, fz + oz);
      for (const du of [-ww / 2, 0, ww / 2]) bx(g, alongX ? 0.07 : 0.07, hh, alongX ? 0.07 : 0.07, trim, fx + ox + (alongX ? du : 0), y, fz + oz + (alongX ? 0 : du));
      bx(g, alongX ? ww : 0.06, 0.06, alongX ? 0.06 : ww, trim, fx + ox, y + hh * 0.15, fz + oz);
      bx(g, alongX ? ww + 0.3 : 0.25, 0.1, alongX ? 0.25 : ww + 0.3, M.stone, fx + ox * 3, y - hh / 2 - 0.08, fz + oz * 3);
    };
    for (const u of [-6, -3.4, 3.4, 6]) { windowAt(true, -1, u, 2.0, 1.1, 1.9, true); windowAt(true, 1, u, 2.0, 1.1, 1.9, true); }
    for (const u of [-6, -3.4, 0, 3.4, 6]) { windowAt(true, -1, u, 5.9, 0.95, 1.4, false); windowAt(true, 1, u, 5.9, 0.95, 1.4, false); }
    for (const sx of [-1, 1]) for (const u of [-2.4, 2.4]) { windowAt(false, sx, u, 2.0, 1.1, 1.9, true); windowAt(false, sx, u, 5.9, 0.95, 1.4, false); }
    // The great hall's ceiling, with dark beams across it.
    bx(g, w - T, 0.12, d - T, M.darkWood, 0, H, 0);
    for (let x = -w / 2 + 1.5; x < w / 2; x += 2.2) bx(g, 0.22, 0.26, d - T, M.darkWood, x, H - 0.18, 0);

    // Roof: steep slate slabs on a ridge along the length, gable ends, three dormers, two chimneys.
    const slope = 0.72, over = 0.6, run = d / 2 + over, half = run / Math.cos(slope), rise = Math.tan(slope) * run;
    for (const sz of [-1, 1]) bx(g, w + 1.2, 0.2, half, slate, 0, TOP + rise / 2, sz * run / 2, sz * slope, 0, 0);
    bx(g, w + 1.3, 0.16, 0.34, M.darkWood, 0, TOP + rise + 0.06, 0); // ridge
    for (const sx of [-1, 1]) for (let i = 0, n = Math.ceil(rise / 0.3); i < n; i++) bx(g, 0.2, 0.3, (d + T) * (1 - (i + 0.5) / n), plaster, sx * (w / 2), TOP + 0.15 + i * 0.3, 0);
    for (const u of [-4, 0, 4]) {
      const dz = -run * 0.45, dy = TOP + rise * 0.55;
      bx(g, 1.4, 1.3, 1.4, plaster, u, dy, dz);
      bx(g, 0.8, 0.8, 0.04, win, u, dy - 0.05, dz - 0.71);
      for (const sx of [-1, 1]) bx(g, 1.1, 0.12, 1.6, slate, u + sx * 0.42, dy + 0.85, dz, 0, 0, -sx * 0.75);
    }
    for (const sx of [-1, 1]) {
      bx(g, 0.9, 3.4, 0.9, brick, sx * 5.2, TOP + rise - 0.2, d / 4);
      bx(g, 1.05, 0.15, 1.05, M.stone, sx * 5.2, TOP + rise + 1.5, d / 4);
    }

    // Round towers at the front corners, with conical slate roofs, gold finials and pennants.
    for (const sx of [-1, 1]) {
      const tx = sx * (w / 2 + 0.6), tz = -d / 2 - 0.6, TH = TOP + 1.8;
      mesh(new THREE.CylinderGeometry(1.75, 1.9, TH, 18).translate(0, TH / 2, 0), plaster, g).position.set(tx, 0, tz);
      mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 18).translate(0, 0.15, 0), M.stone, g).position.set(tx, 0, tz);
      mesh(new THREE.TorusGeometry(1.8, 0.09, 6, 22), M.darkWood, g).position.set(tx, TH, tz);
      (g.children.at(-1) as THREE.Mesh).rotation.x = Math.PI / 2;
      mesh(new THREE.ConeGeometry(2.25, 4.2, 18).translate(0, 2.1, 0), slate, g).position.set(tx, TH, tz);
      mesh(new THREE.SphereGeometry(0.16, 10, 8), gold, g).position.set(tx, TH + 4.35, tz);
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6).translate(0, 0.6, 0), gold, g).position.set(tx, TH + 4.4, tz);
      const flag = bx(g, 0.7, 0.4, 0.02, red, tx + 0.36, TH + 5.3, tz); void flag;
      for (const [a, y] of [[-0.5, 2.0], [0.5, 2.0], [-0.5, 5.9], [0.5, 5.9], [0, 8.2]] as const) {
        const ang = -Math.PI / 2 + a * sx * 0 + (sx < 0 ? a : -a) - Math.PI / 2 * 0;
        const wx = tx + Math.cos(ang - Math.PI / 2) * 1.77 * 0 + Math.sin(ang) * 1.79, wz = tz - Math.cos(ang) * 1.79;
        const pane = bx(g, 0.5, y > 7 ? 0.7 : 1.2, 0.04, win, wx, y, wz); pane.rotation.y = -ang;
      }
      col(tx, tz, 1.95);
    }

    // The portico: steps up from the garden, four columns, an entablature and a pediment.
    const pz = -d / 2 - 2.0;
    for (let i = 0; i < 4; i++) bx(g, 6.4 - i * 0.2, 0.3, 1.0 + (3 - i) * 0.45, M.stone, 0, -0.15 - (3 - i) * 0.3 + 0.3 * 0, pz - 0.3 - (3 - i) * 0.22);
    bx(g, 6.2, plH, 3.0, M.stone, 0, -plH / 2 + 0.02, pz + 0.5);
    for (const x of [-2.6, -0.95, 0.95, 2.6]) {
      mesh(new THREE.CylinderGeometry(0.2, 0.24, H + 0.3, 14).translate(0, (H + 0.3) / 2 + 0.05, 0), trim, g).position.set(x, 0, pz - 0.6);
      bx(g, 0.6, 0.18, 0.6, trim, x, 0.14, pz - 0.6); bx(g, 0.6, 0.18, 0.6, trim, x, H + 0.35, pz - 0.6);
      col(x, pz - 0.6, 0.3);
    }
    bx(g, 6.4, 0.5, 2.6, trim, 0, H + 0.68, pz + 0.3);
    const ped = new THREE.Shape(); ped.moveTo(-3.3, 0); ped.lineTo(3.3, 0); ped.lineTo(0, 1.5); ped.closePath();
    const pg = mesh(new THREE.ExtrudeGeometry(ped, { depth: 0.4, bevelEnabled: false }), trim, g); pg.position.set(0, H + 0.93, pz - 0.95);
    for (const sx of [-1, 1]) bx(g, 3.7, 0.16, 2.9, slate, sx * 1.55, H + 1.7, pz + 0.3, 0, 0, -sx * 0.43);
    mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 18), gold, g).position.set(0, H + 1.45, pz - 0.98); // a gilded wreath
    mesh(new THREE.SphereGeometry(0.12, 10, 8), gold, g).position.set(0, H + 1.45, pz - 0.98);
    // Lanterns either side of the door.
    for (const sx of [-1, 1]) {
      const lg = new THREE.Group(); lg.position.set(sx * (doorW / 2 + 0.7), 2.4, -d / 2 - T / 2 - 0.2); g.add(lg);
      bx(lg, 0.26, 0.38, 0.26, M.iron, 0, 0, 0);
      const fm = this.fire(lg, 0, 2.5, 7);
      bx(lg, 0.18, 0.28, 0.27, fm, 0, 0, 0);
    }

    // The door: a tall double-width oak door with gold furniture.
    const hinge = new THREE.Group(); hinge.position.set(-doorW / 2, 0, -d / 2); g.add(hinge);
    bx(hinge, doorW, DOOR_H - 0.05, 0.09, M.darkWood, doorW / 2, (DOOR_H - 0.05) / 2 + 0.05, 0);
    for (const [px, py] of [[0.45, 0.9], [1.35, 0.9], [0.45, 2.0], [1.35, 2.0]]) bx(hinge, 0.7, 0.85, 0.11, M.wood, px * doorW / 1.8, py, 0);
    for (const hy of [0.5, 2.4]) bx(hinge, doorW * 0.9, 0.07, 0.12, gold, doorW / 2, hy, 0);
    const knob = mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12), gold, hinge); knob.position.set(doorW - 0.25, 1.3, -0.08);
    bx(g, doorW + 0.5, 0.22, 0.4, trim, 0, DOOR_H + 0.1, -d / 2 - 0.05); // lintel
    const dw = toWorld(f, 0, -d / 2);
    const dcol: Collider = { x: dw.x, z: dw.z, r: 0.95 };
    this.colliders.push(dcol);
    this.roomDoors[h.id] = { hinge, open: false, angle: 0, col: dcol, home: { x: dw.x, z: dw.z }, outward: true };

    // Inside: the fireplace on the back wall, with a painting above it.
    const fp = new THREE.Group(); fp.position.set(f.hearth.x, 0.08, f.hearth.z); g.add(fp);
    bx(fp, 2.6, 2.1, 0.7, M.stone, 0, 1.05, 0.05);
    bx(fp, 3.0, 0.18, 0.9, trim, 0, 2.15, 0);
    bx(fp, 1.4, 1.1, 0.4, M.dark, 0, 0.6, -0.18);
    const ffm = this.fire(fp, 0.5, 3, 9);
    (fp.children.at(-1) as THREE.Object3D).position.set(0, 0.5, -0.8);
    const flames = mesh(new THREE.PlaneGeometry(1.0, 0.6), ffm, fp, false); flames.position.set(0, 0.45, -0.39); flames.rotation.y = Math.PI;
    bx(fp, 1.6, 1.1, 0.06, mat(0x3a5a3a, null, { r: 0.8 }), 0, 3.2, 0.32); // a landscape: the lake and mountains
    bx(fp, 1.75, 1.25, 0.05, gold, 0, 3.2, 0.34);
    // Four-poster bed with a red canopy.
    const bed = new THREE.Group(); bed.position.set(f.bed.x, 0.1, f.bed.z); g.add(bed);
    bx(bed, 1.9, 0.4, 2.4, M.darkWood, 0, 0.3, 0);
    bx(bed, 1.8, 0.2, 2.3, mat(0xf4efe4, 'cloth', { r: 0.95 }), 0, 0.6, 0);
    bx(bed, 1.85, 0.08, 1.6, red, 0, 0.72, -0.35);
    for (const sx of [-0.55, 0.55]) bx(bed, 0.6, 0.15, 0.35, mat(0xf4efe4, 'cloth', { r: 0.95 }), sx, 0.76, 0.85);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(bed, 0.1, 2.5, 0.1, M.darkWood, sx * 0.9, 1.25, sz * 1.15);
    bx(bed, 2.0, 0.08, 2.5, red, 0, 2.5, 0);
    for (const sx of [-1, 1]) bx(bed, 0.04, 0.5, 2.5, red, sx * 0.98, 2.25, 0);
    bx(bed, 2.0, 1.2, 0.08, M.darkWood, 0, 1.0, 1.2);
    col(f.bed.x, f.bed.z - 0.6, 0.85); col(f.bed.x, f.bed.z + 0.6, 0.85);
    // The lord's chest: iron-bound and gilded.
    const ch = new THREE.Group(); ch.position.set(f.chest.x, 0.1, f.chest.z); ch.rotation.y = Math.PI / 2; g.add(ch);
    bx(ch, 1.2, 0.6, 0.65, M.darkWood, 0, 0.3, 0);
    bx(ch, 1.25, 0.1, 0.7, gold, 0, 0.62, 0);
    for (const sx of [-0.4, 0.4]) bx(ch, 0.08, 0.62, 0.7, gold, sx, 0.31, 0);
    col(f.chest.x, f.chest.z, 0.6);
    // The long table, chairs, candelabras, and two chandeliers above it.
    const t = new THREE.Group(); t.position.set(f.table!.x, 0.1, f.table!.z); g.add(t);
    bx(t, 5.0, 0.1, 1.3, M.darkWood, 0, 0.8, 0);
    bx(t, 5.0, 0.02, 0.5, mat(0xf4efe4, 'cloth', { r: 0.95 }), 0, 0.86, 0);
    for (const [px, pz2] of [[-2.3, -0.5], [2.3, -0.5], [-2.3, 0.5], [2.3, 0.5]]) bx(t, 0.12, 0.78, 0.12, M.darkWood, px, 0.39, pz2);
    for (let i = 0; i < 4; i++) for (const sz of [-1, 1]) {
      const c = new THREE.Group(); c.position.set(-1.8 + i * 1.2, 0, sz * 1.0); t.add(c);
      bx(c, 0.5, 0.06, 0.5, M.wood, 0, 0.5, 0); bx(c, 0.5, 0.7, 0.06, M.wood, 0, 0.85, sz * 0.24);
      for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) bx(c, 0.05, 0.5, 0.05, M.wood, lx, 0.25, lz);
    }
    for (const x of [-1.4, 1.4]) {
      mesh(new THREE.CylinderGeometry(0.03, 0.08, 0.35, 8).translate(0, 1.03, 0), gold, t).position.x = x;
      for (const dx of [-0.12, 0, 0.12]) { const cnd = bx(t, 0.04, 0.16, 0.04, trim, x + dx, 1.28, 0); void cnd; }
    }
    for (let lx = -2.3; lx <= 2.3; lx += 0.9) for (const lz of [-0.6, 0.6]) col(f.table!.x + lx, f.table!.z + lz, 0.45);
    for (const x of [-1.6, 1.6]) {
      const ch2 = new THREE.Group(); ch2.position.set(x, H - 1.0, f.table!.z); g.add(ch2);
      mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.85, 4).translate(0, 0.45, 0), M.iron, ch2);
      const ring = mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 18), gold, ch2); ring.rotation.x = Math.PI / 2;
      const cm = this.fire(ch2, 0.1, 1.6, 8);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; bx(ch2, 0.05, 0.14, 0.05, cm, Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55); }
    }
    // Banners and a pair of tall bookcases on the side walls.
    for (const sx of [-1, 1]) {
      const bn = bx(g, 0.04, 2.0, 0.9, red, sx * (w / 2 - T / 2 - 0.04), 2.9, -1.0); void bn;
      bx(g, 0.05, 0.1, 1.0, gold, sx * (w / 2 - T / 2 - 0.05), 3.9, -1.0);
    }
    const shelf = (lx: number, lz: number) => {
      const s = new THREE.Group(); s.position.set(lx, 0.1, lz); s.rotation.y = Math.PI / 2; g.add(s);
      bx(s, 1.6, 2.6, 0.45, M.darkWood, 0, 1.3, 0);
      const cols = [0x8a2a24, 0x2a4a7a, 0x3a6a3a, 0x8a6a2a, 0x5a3a6a];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) bx(s, 0.13, 0.42, 0.3, mat(cols[(r * 3 + k) % 5], null, { r: 0.8 }), -0.65 + k * 0.165, 0.45 + r * 0.6, -0.07);
      col(f.x + 0, f.z + 0, 0); // placeholder (no-op)
    };
    shelf(-w / 2 + 0.4, 1.9 - 3.3 - 0.4); col(-w / 2 + 0.4, -1.8, 0.6);

    // Colliders: the walls (leaving the doorway).
    for (let lx = -w / 2; lx <= w / 2 + 1e-6; lx += 0.45) { col(lx, d / 2, 0.24); if (Math.abs(lx) > doorW / 2 + 0.2) col(lx, -d / 2, 0.24); }
    for (let lz = -d / 2; lz <= d / 2 + 1e-6; lz += 0.45) for (const sx of [-1, 1]) col(sx * w / 2, lz, 0.24);

    // The garden in front: a gravel walk from the gate to the steps around a fountain, hedges and
    // flowerbeds, topiary, lanterns, and a low wall with gate piers.
    const gz0 = pz - 2.0, gz1 = -d / 2 - 15;
    const walk = (lx: number, lz: number, ww: number, dd: number) => bx(g, ww, 0.06, dd, gravel, lx, 0.03 - (f.floor - heightAt(...Object.values(toWorld(f, lx, lz)) as [number, number])) * 0, lz);
    void walk;
    const gy = (lx: number, lz: number) => { const p = toWorld(f, lx, lz); return heightAt(p.x, p.z) - f.floor; };
    for (let lz = gz0; lz > gz1; lz -= 1) bx(g, 2.4, 0.08, 1.05, gravel, 0, gy(0, lz) + 0.04, lz);
    // Fountain halfway down the walk, with a circle of gravel round it.
    const fzc = (gz0 + gz1) / 2, fy = gy(0, fzc);
    mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.07, 28), gravel, g).position.set(0, fy + 0.045, fzc);
    mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.55, 26, 1, true).translate(0, 0.275, 0), M.stone, g).position.set(0, fy, fzc);
    mesh(new THREE.TorusGeometry(1.95, 0.12, 6, 26), trim, g).position.set(0, fy + 0.56, fzc);
    (g.children.at(-1) as THREE.Mesh).rotation.x = Math.PI / 2;
    const water = new THREE.MeshStandardMaterial({ color: 0x3a7aa0, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.85 });
    mesh(new THREE.CircleGeometry(1.9, 26), water, g).position.set(0, fy + 0.42, fzc);
    (g.children.at(-1) as THREE.Mesh).rotation.x = -Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 12).translate(0, 0.75, 0), trim, g).position.set(0, fy, fzc);
    mesh(new THREE.CylinderGeometry(0.75, 0.25, 0.25, 16).translate(0, 1.6, 0), trim, g).position.set(0, fy, fzc);
    mesh(new THREE.CircleGeometry(0.7, 16), water, g).position.set(0, fy + 1.73, fzc);
    (g.children.at(-1) as THREE.Mesh).rotation.x = -Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.16, 10, 8), gold, g).position.set(0, fy + 1.95, fzc);
    const spray = new THREE.MeshStandardMaterial({ color: 0xcfe8f8, transparent: true, opacity: 0.45, roughness: 0.1 });
    mesh(new THREE.ConeGeometry(0.5, 1.2, 12, 1, true), spray, g).position.set(0, fy + 1.15, fzc);
    col(0, fzc, 2.1);
    // Hedges along the walk (gaps for the fountain circle), flowerbeds behind them, topiary cones.
    const flowers = [0xd84a5a, 0xf2c84a, 0x9a6ad8, 0xf4f0ec, 0xe87a3a];
    for (const sx of [-1, 1]) for (const [a, b] of [[gz0, fzc + 3.3], [fzc - 3.3, gz1 + 1]] as const) {
      const len = Math.abs(a - b), mz = (a + b) / 2;
      bx(g, 0.6, 0.7, len, hedge, sx * 1.75, gy(sx * 1.75, mz) + 0.35, mz);
      for (let k = 0; k < len; k += 1) col(sx * 1.75, b + k + 0.5, 0.35);
      bx(g, 2.2, 0.15, len - 0.4, mat(0x4a3424, 'ground', { r: 1 }), sx * 3.3, gy(sx * 3.3, mz) + 0.08, mz);
      const rng = mulberry32(Math.round(mz * 13 + sx * 7));
      for (let k = 0; k < len * 4; k++) {
        const fx2 = sx * (2.4 + rng() * 1.8), fz2 = Math.min(a, b) + 0.3 + rng() * (len - 0.6);
        const fl = mesh(new THREE.SphereGeometry(0.09, 6, 4), mat(flowers[Math.floor(rng() * flowers.length)], null, { r: 0.7 }), g, false);
        fl.position.set(fx2, gy(fx2, fz2) + 0.26, fz2);
      }
      for (const tz of [a - 0.5 * Math.sign(a - b), b + 0.5 * Math.sign(a - b)]) {
        const cone = mesh(new THREE.ConeGeometry(0.55, 1.9, 10).translate(0, 1.25, 0), hedge, g); cone.position.set(sx * 4.8, gy(sx * 4.8, tz), tz);
        mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.4, 10).translate(0, 0.2, 0), M.stone, g).position.set(sx * 4.8, gy(sx * 4.8, tz), tz);
        col(sx * 4.8, tz, 0.55);
      }
    }
    // Lantern posts at the gate and by the fountain.
    for (const [lx, lz] of [[-1.6, gz1 + 0.6], [1.6, gz1 + 0.6], [-2.6, fzc], [2.6, fzc]] as const) {
      const lp = new THREE.Group(); lp.position.set(lx, gy(lx, lz), lz); g.add(lp);
      mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.4, 8).translate(0, 1.2, 0), M.iron, lp);
      bx(lp, 0.3, 0.4, 0.3, M.iron, 0, 2.55, 0);
      const lm = this.fire(lp, 2.55, 2, 7);
      bx(lp, 0.22, 0.3, 0.31, lm, 0, 2.55, 0);
      col(lx, lz, 0.2);
    }
    // A low garden wall across the front with stone gate piers topped by balls (the gate stands open).
    for (const sx of [-1, 1]) {
      for (let u = 1.6; u < 11; u += 1) bx(g, 1.02, 0.9, 0.4, M.stone, sx * (u + 0.5), gy(sx * (u + 0.5), gz1) + 0.45, gz1);
      for (let lz = gz1 + 0.5; lz < pz; lz += 1) bx(g, 0.4, 0.9, 1.02, M.stone, sx * 11, gy(sx * 11, lz) + 0.45, lz);
      for (let u = 1.6; u < 11; u += 0.6) col(sx * u, gz1, 0.25);
      for (let lz = gz1; lz < pz; lz += 0.6) col(sx * 11, lz, 0.25);
      const py = gy(sx * 1.4, gz1);
      bx(g, 0.7, 2.0, 0.7, M.stone, sx * 1.4, py + 1.0, gz1);
      mesh(new THREE.SphereGeometry(0.3, 12, 8), trim, g).position.set(sx * 1.4, py + 2.3, gz1);
      const gate = new THREE.Group(); gate.position.set(sx * 1.05, py, gz1); gate.rotation.y = sx * 1.9; g.add(gate);
      for (let k = 0; k < 6; k++) bx(gate, 0.04, 1.5, 0.04, M.iron, -sx * (0.1 + k * 0.16), 0.75, 0);
      for (const y of [0.3, 1.35]) bx(gate, 0.95, 0.05, 0.05, M.iron, -sx * 0.5, y, 0);
    }
    // A little fishing dock down on the lake, below the lawn: planks on posts, a bench and a lantern.
    {
      const P = MANOR_DOCK;
      const dk = new THREE.Group(); dk.position.set(P.x, 0, P.z); dk.rotation.y = Math.atan2(P.ux, P.uz); this.group.add(dk);
      for (let dd = 0; dd < P.length; dd += 0.5) bx(dk, P.width, 0.08, 0.46, M.plank, 0, P.deck - 0.04, dd + 0.25);
      for (let dd = 0.3; dd <= P.length; dd += 2.4) for (const sx of [-1, 1]) { const post = mesh(new THREE.CylinderGeometry(0.08, 0.09, 3, 7), M.darkWood, dk); post.position.set(sx * (P.width / 2 - 0.08), P.deck - 1.5, dd); }
      bx(dk, 1.3, 0.08, 0.4, M.wood, 0, P.deck + 0.45, P.length - 1.2); // bench at the end
      for (const sx of [-0.5, 0.5]) bx(dk, 0.08, 0.45, 0.35, M.darkWood, sx, P.deck + 0.22, P.length - 1.2);
      const lp = new THREE.Group(); lp.position.set(P.width / 2 - 0.15, P.deck, P.length - 0.2); dk.add(lp);
      mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6).translate(0, 0.9, 0), M.darkWood, lp);
      const lm = this.fire(lp, 1.9, 2, 7); bx(lp, 0.2, 0.26, 0.2, lm, 0, 1.9, 0);
      tag('Manor dock', 'Cast off the end', 'place', new THREE.Vector3(P.x + P.ux * P.length, P.deck + 2, P.z + P.uz * P.length), 25);
    }
    this.doorTag(h, DOOR_H + 0.8);
    const sign = toWorld(f, 0, gz1 - 1.5);
    tag('Lakeside Manor', `${MANOR_PRICE} g a week · the Lord’s seat · every workshop (+10% speed, +5 luck) · ${h.storage}-slot chest`, 'place', new THREE.Vector3(sign.x, heightAt(sign.x, sign.z) + TOP + 3, sign.z), 70);
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
  /** A little rowboat tied up beside a pier's far end. */
  private rowboat(P: typeof PIER, portal: string, name: string | null, sub: string | null): void {
    const end = PORTAL_BY_ID.get(portal)!.at;
    const g = new THREE.Group();
    // Beside the end of the pier, bow pointing out along it.
    g.position.set(end.x - P.uz * (P.width / 2 + 0.9), 0.3, end.z + P.ux * (P.width / 2 + 0.9));
    g.rotation.y = Math.atan2(P.ux, P.uz);
    this.group.add(g);
    const hull = mat(0x8a5a32, 'wood', { r: 0.8 }), trim = mat(0xe8e2d4, 'wood', { r: 0.8 });
    const shell = mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hull, g);
    shell.scale.set(0.62, 0.42, 1.55);
    (shell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const rim = mesh(new THREE.TorusGeometry(1, 0.035, 6, 24), trim, g); rim.rotation.x = Math.PI / 2; rim.scale.set(0.62, 1.55, 1);
    for (const z of [-0.5, 0.4]) bx(g, 1.1, 0.05, 0.22, M.plank, 0, -0.12, z); // thwarts
    for (const sx of [-1, 1]) { const oar = bx(g, 0.05, 0.05, 2.2, M.wood, sx * 0.5, 0.02, 0.1, 0, sx * 0.15, 0); void oar; }
    if (name) tag(name, sub, 'place', new THREE.Vector3(end.x, P.deck + 2.2, end.z), 30);
  }

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
      // Railing posts along the outer two thirds — except by the rowboat (the −X side at the end), so you can step in.
      if (d > P.length * 0.35 && !(sx < 0 && d > P.length - BOAT_GAP)) { bx(g, 0.07, 0.9, 0.07, M.darkWood, sx * (P.width / 2 - 0.1), P.deck + 0.45, d); }
    }
    bx(g, 0.06, 0.06, P.length * 0.65, M.wood, P.width / 2 - 0.1, P.deck + 0.85, P.length * 0.675);
    const railEnd = P.length - BOAT_GAP, railStart = P.length * 0.35;
    bx(g, 0.06, 0.06, railEnd - railStart, M.wood, -(P.width / 2 - 0.1), P.deck + 0.85, (railStart + railEnd) / 2);
    const lampPost = bx(g, 0.1, 2, 0.1, M.darkWood, P.width / 2 - 0.1, P.deck + 1, P.length - 0.2); void lampPost;
    const lamp = new THREE.Object3D(); lamp.position.set(P.width / 2 - 0.3, P.deck + 2, P.length - 0.2); g.add(lamp);
    this.fires.push({ light: lamp, mats: [], base: 3, color: 0xffb060, range: 9 });
    const end = new THREE.Vector3(P.x + P.ux * (P.length - 1), P.deck + 2.4, P.z + P.uz * (P.length - 1));
    tag('Fishing pier', 'Cast off the end · E at the end: rowboat to Saltfjorden', 'place', end, 30);
  }

  /** A split-rail fence around Bjørkvik's east side, open towards the paths and the lake. */
  /** Bjørkvik's gate on the road in from the crossroads: two posts, a beam and a name board. */
  private gate(): void {
    const g = this.place(TOWN_GATE.x, TOWN_GATE.z, VILLAGE.x, VILLAGE.z);
    for (const sx of [-1, 1]) bx(g, 0.28, 3.4, 0.28, M.darkWood, sx * 2.1, 1.7, 0);
    bx(g, 5.0, 0.3, 0.32, M.darkWood, 0, 3.35, 0);
    const board = canvasTex((c, n) => { c.fillStyle = '#5a3e26'; c.fillRect(0, 0, n, n); c.fillStyle = '#f2e6c4'; c.scale(0.25, 1); c.font = `bold ${n * 0.6}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BJØRKVIK', n * 2, n * 0.54); }, 256); // text squeezed: the board is 4:1
    for (const side of [-1, 1]) { const b = mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: board, roughness: 0.9 }), g); b.position.set(0, 2.85, side * 0.17); if (side < 0) b.rotation.y = Math.PI; }
    bx(g, 2.7, 0.75, 0.3, M.wood, 0, 2.85, 0);
    for (const sx of [-1, 1]) this.colliders.push({ x: TOWN_GATE.x + sx * 2.1 * Math.cos(g.rotation.y), z: TOWN_GATE.z - sx * 2.1 * Math.sin(g.rotation.y), r: 0.3 });
  }

  /** The fence round Bjørkvik: the east side and the back of the market, open by the lake and the north-west road, with the gate in it. */
  private fence(): void {
    for (const [a0, a1] of [[-1.95, -1.03], [-0.68, 2.1]]) this.fenceArc(31.5, a0, a1);
  }

  private fenceArc(r: number, a0: number, a1: number): void {
    const step = (a1 - a0) / Math.max(1, Math.round(((a1 - a0) * r) / 2.4));
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

  /** Saltfjorden: the gate back, and a fishing village — red boathouses, drying racks, a jetty. */
  private fjord(): void {
    const F = FJORD, vx = FJORD_VILLAGE.x, vz = FJORD_VILLAGE.z;
    this.rowboat(FJORD_PIER, 'fjord_out', 'Rowboat to Bjørkvik', 'E at the end of the jetty');
    const red = mat(0x8a2e24, 'wood', { r: 0.9 });
    const white = mat(0xe8e2d4, 'wood', { r: 0.9 });
    const shoreX = (lz: number) => F.x + fjordMid(lz) + 20; // roughly where the east shore meets the water
    // Three boathouses (naust) at the waterline, gable to the water.
    // Spread along the shore, clear of the jetty, each on a low timber footing (not a stone block).
    for (const lz of [FJORD_SPOTS.village.z - 14, FJORD_SPOTS.village.z + 9, FJORD_SPOTS.village.z + 17]) {
      const x = shoreX(lz) + 5, z = F.z + lz;
      const g = this.place(x, z, x - 10, z);
      let lo = Infinity, hi = -Infinity;
      for (const dx of [-2.75, 0, 2.75]) for (const dz of [-2, 2]) { const h0 = heightAt(x + dx, z + dz); lo = Math.min(lo, h0); hi = Math.max(hi, h0); }
      // Dug into the slope at the back, on short stilts at the front.
      const y = lo + (hi - lo) * 0.55; g.position.y = y;
      for (const dx of [-2.6, 0, 2.6]) for (const dz of [-1.9, 1.9]) bx(g, 0.22, y - lo + 0.4, 0.22, M.darkWood, dz, -(y - lo + 0.4) / 2 + 0.05, dx);
      bx(g, 4.2, 0.12, 5.7, M.plank, 0, 0.02, 0);
      bx(g, 4, 2.4, 5.5, red, 0, 1.2, 0);
      for (const sx of [-1, 1]) bx(g, 2.6, 0.12, 5.9, M.roof, sx * 1.05, 2.9, 0, 0, 0, sx * -0.68);
      bx(g, 2, 1.8, 0.06, white, 0, 0.95, -2.78); // doors to the water
      this.rectCollider(g, 4.1, 5.6);
    }
    // Drying racks with cod (stockfish).
    for (let i = 0; i < 2; i++) {
      const x = vx + 5 + i * 3, z = vz + 7;
      const g = this.place(x, z, vx, vz);
      for (const sx of [-1.2, 1.2]) bx(g, 0.12, 2, 0.12, M.darkWood, sx, 1, 0);
      bx(g, 2.6, 0.1, 0.1, M.darkWood, 0, 1.95, 0);
      for (let k = 0; k < 6; k++) { const f = mesh(new THREE.ConeGeometry(0.08, 0.6, 5), mat(0xc8b890, null, { r: 0.8 }), g); f.position.set(-1 + k * 0.4, 1.6, 0); f.rotation.x = Math.PI; }
    }
    // The jetty out into the fjord (walkable: see pierDeck), where the boat ties up.
    const P = FJORD_PIER;
    const jetty = new THREE.Group(); jetty.position.set(P.x, 0, P.z); jetty.rotation.y = Math.atan2(P.ux, P.uz); this.group.add(jetty);
    for (let d = 0; d < P.length; d += 0.5) bx(jetty, P.width, 0.08, 0.46, M.plank, 0, P.deck - 0.04, d + 0.25);
    for (let d = 0.3; d <= P.length; d += 2.2) for (const sx of [-1, 1]) { const post = mesh(new THREE.CylinderGeometry(0.09, 0.1, 4, 7), M.darkWood, jetty); post.position.set(sx * (P.width / 2 - 0.1), P.deck - 2, d); }
    this.signpost(vx - 2, vz - 10, [['Jetty · boat to Bjørkvik', P.x + P.ux * P.length, P.z], ['Deep water ≈', F.x + fjordMid(0), F.z]]);
    this.shipwreck();
    tag('Saltfjorden', 'Sea fishing · Fishing 8–28 · rare catches from the deeps', 'place', new THREE.Vector3(vx, heightAt(vx, vz) + 6, vz), 50);
  }

  /**
   * The wreck on the west shore: a longship run aground, listing, half in the water. Its deck is
   * walkable (see pierDeck's walkways); a gangplank climbs to it from the beach.
   */
  private shipwreck(): void {
    const S = SHIPWRECK, hull = mat(0x4a3a2a, 'wood', { r: 0.9 }), deckM = mat(0x6a5236, 'wood', { r: 0.9 }), rot = mat(0x2e2a22, 'wood', { r: 1 });
    const g = new THREE.Group(); g.position.set(S.x, 0, S.z); this.group.add(g);
    const L = S.length, W = S.width;
    // Deck planks (a ragged hole near the bow).
    for (let d = -L / 2; d < L / 2; d += 0.5) {
      if (d > -L / 2 + 3 && d < -L / 2 + 5 && true) { bx(g, W * 0.4, 0.1, 0.46, deckM, -W * 0.3, S.deck - 0.05, d + 0.25); continue; }
      bx(g, W, 0.1, 0.46, deckM, 0, S.deck - 0.05, d + 0.25);
    }
    // Hull sides: planks curving in towards bow and stern, down into the water.
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) {
      const d = -L / 2 + (i + 0.5) * (L / 9), taper = 1 - Math.pow(Math.abs(d) / (L / 2), 2) * 0.55;
      const side = bx(g, 0.18, S.deck + 1.2, L / 9 + 0.05, i % 3 === 1 ? rot : hull, sx * (W / 2) * taper, S.deck / 2 - 0.4, d, 0, 0, sx * 0.12);
      void side;
    }
    // Gunwale rails (broken in places) and bow/stern posts.
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) if ((i + (sx > 0 ? 1 : 0)) % 4 !== 0) {
      const d = -L / 2 + (i + 0.5) * (L / 9), taper = 1 - Math.pow(Math.abs(d) / (L / 2), 2) * 0.55;
      bx(g, 0.15, 0.6, L / 9, hull, sx * (W / 2) * taper, S.deck + 0.3, d);
    }
    for (const sz of [-1, 1]) { const post = bx(g, 0.3, 4, 0.3, hull, 0, S.deck + 0.4, sz * (L / 2 + 0.3), sz * -0.35, 0, 0); void post; }
    // A broken mast with a torn sail.
    bx(g, 0.35, 5, 0.35, rot, 0, S.deck + 2.5, -1, 0.12, 0, 0.05);
    const sail = mesh(new THREE.PlaneGeometry(2.6, 2), mat(0xc8b8a0, 'cloth', { r: 1 }), g); sail.position.set(0.4, S.deck + 3.4, -1.2); (sail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; sail.rotation.set(0.1, 0.3, 0.15);
    // Gangplank from the beach up to the deck.
    const pl = new THREE.Group(); this.group.add(pl);
    const x0 = S.plankFrom, x1 = S.x - W / 2 + 0.3, y0 = heightAt(x0, S.z), y1 = S.deck;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const plank = bx(pl, len, 0.1, 1.6, deckM, (x0 + x1) / 2, (y0 + y1) / 2 - 0.05, S.z, 0, 0, Math.atan2(y1 - y0, x1 - x0)); void plank;
    // Colliders: the hull sides (you walk on the deck, not through the hull).
    for (const sx of [-1, 1]) for (let d = -L / 2 + 1; d <= L / 2 - 1; d += 1.5) if (!(sx < 0 && Math.abs(d) < 1.2)) this.colliders.push({ x: S.x + sx * (W / 2 + 0.3), z: S.z + d, r: 0.5 });
    tag('The wreck', 'Drowned crew · the Drowned Captain (level 15 boss)', 'place', new THREE.Vector3(S.x, S.deck + 6, S.z), 50);
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

  /** Sjøgrotta's mouth: a dark cleft in a heap of wet, barnacled rock, with a lantern on a pole. */
  private grottoMouth(): void {
    const { x, z } = GROTTO_ENTRANCE;
    const g = this.place(x, z, x, z + 6);
    const wet = mat(0x4a5a5e, null, { r: 0.5 }), barnacle = mat(0xd8d0c0, null, { r: 0.8 });
    for (let i = 0; i < 8; i++) {
      const r = mesh(rockGeo(80 + i, 0.8), wet, g);
      const a = -0.7 + (i / 7) * 4.6;
      r.scale.setScalar(1.8 + (i % 3) * 0.6);
      r.position.set(Math.cos(a) * 3.2, 0.7 + (i % 2) * 1.3, Math.sin(a) * 3.2 + 1.6);
      for (let k = 0; k < 4; k++) mesh(new THREE.ConeGeometry(0.08, 0.1, 5), barnacle, g).position.set(r.position.x + Math.sin(i + k) * 0.8, r.position.y + 0.9 + k * 0.1, r.position.z - 0.9);
    }
    const hole = mesh(new THREE.PlaneGeometry(2.4, 3.0), new THREE.MeshBasicMaterial({ color: 0x03080a }), g, false);
    hole.position.set(0, 1.5, -0.2); hole.rotation.y = Math.PI;
    const glow = mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ color: 0x40d0c0, transparent: true, opacity: 0.35 }), g, false);
    glow.position.set(0, 0.25, -0.25); glow.rotation.y = Math.PI;
    const lp = new THREE.Group(); lp.position.set(1.9, 0, -1.0); g.add(lp);
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6).translate(0, 1.2, 0), M.darkWood, lp);
    const lm = this.fire(lp, 2.4, 3, 7); bx(lp, 0.22, 0.3, 0.22, lm, 0, 2.4, 0);
    tag('Sjøgrotta', 'Sea cave · walk in · levels 14–18 · the Kraken', 'place', new THREE.Vector3(x, heightAt(x, z) + 4.2, z), 45);
    for (const [dx, dz] of [[-2.5, 0.2], [2.5, 0.2], [-2.9, 1.8], [2.9, 1.8], [0, 3.2]]) this.colliders.push({ x: x + dx, z: z + dz, r: 1.2 });
  }

  /**
   * Only draw buildings, fences and props near you: everything in every region lives in one group,
   * so without this Gruben and Saltfjorden were drawn from Bjørkvik too (a kilometre away, but
   * inside the camera's far plane). Checked a couple of times a second.
   */
  private cullCentres: { o: THREE.Object3D; c: THREE.Vector3; r: number }[] | null = null;
  private nextCull = 0;
  cull(at: THREE.Vector3, range = 260): void {
    if (this.t < this.nextCull) return;
    this.nextCull = this.t + 0.5;
    if (!this.cullCentres) {
      const box = new THREE.Box3(), sph = new THREE.Sphere();
      this.cullCentres = this.group.children.filter((o) => !(o as THREE.Light).isLight).map((o) => { box.setFromObject(o); box.getBoundingSphere(sph); return { o, c: sph.center.clone(), r: Number.isFinite(sph.radius) ? sph.radius : 0 }; });
    }
    for (const e of this.cullCentres) e.o.visible = e.c.distanceTo(at) - e.r < range;
  }
  setShown(on: boolean): void { this.group.visible = on; }

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
