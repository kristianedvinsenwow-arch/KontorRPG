/**
 * Models for things you hold (pickaxes, hatchets, rods, swords, longswords, battleaxes, bows,
 * staffs) and for worn armour. Held models are built along +Y from the grip end, so the hand and
 * the first-person grip work for every item. Material comes from the item's `look`.
 */
import * as THREE from 'three';
import { ITEMS, type PlayerState } from '@kontor/shared';
import { mat, mesh, bx } from '../engine/procgen.js';
import { makePickaxe, GEAR_COLORS, setHeld, setShoulders, type Character } from './character.js';

const lookMat = (look: string | undefined): THREE.Material => {
  const g = GEAR_COLORS[look ?? 'stone'] ?? GEAR_COLORS.stone;
  if (look === 'stone') return mat(g.color, 'rock', { r: g.rough });
  if (look === 'birch' || look === 'pine') return mat(g.color, 'wood', { r: g.rough });
  return new THREE.MeshStandardMaterial({ color: g.color, metalness: g.metal, roughness: g.rough });
};
const wood = () => mat(0x8a6a44, 'wood', { r: 0.7 });
const grip = () => mat(0x3a2818, 'leather', { r: 0.7 });

function haft(g: THREE.Group, len: number, r = 0.022, m: THREE.Material = wood()) {
  mesh(new THREE.CylinderGeometry(r, r * 1.15, len, 8).translate(0, len / 2, 0), m, g);
}

export function makeSword(look: string | undefined, long = false): THREE.Group {
  const g = new THREE.Group();
  const blade = lookMat(look);
  const guardM = new THREE.MeshStandardMaterial({ color: 0x6a5434, metalness: 0.4, roughness: 0.5 });
  const gl = long ? 0.26 : 0.16;
  mesh(new THREE.CylinderGeometry(0.022, 0.024, gl, 8).translate(0, gl / 2, 0), grip(), g);
  bx(g, long ? 0.26 : 0.2, 0.03, 0.05, guardM, 0, gl + 0.01, 0);
  const bl = long ? 0.95 : 0.6;
  if (look === 'stone') {
    const b = mesh(new THREE.CylinderGeometry(0.0, 0.06, bl, 4, 1).translate(0, gl + bl / 2, 0), blade, g);
    b.scale.set(1, 1, 0.35); b.rotation.y = Math.PI / 4;
  } else {
    mesh(new THREE.BoxGeometry(long ? 0.07 : 0.06, bl, 0.012).translate(0, gl + bl / 2, 0), blade, g);
    const tip = mesh(new THREE.ConeGeometry(0.048, 0.1, 4).translate(0, gl + bl + 0.05, 0), blade, g);
    tip.scale.set(1, 1, 0.26); tip.rotation.y = Math.PI / 4;
  }
  return g;
}

function makeBattleaxe(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.05, 0.026);
  const m = lookMat(look);
  for (const sd of [-1, 1]) {
    const b = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 3, 1, false, 0, Math.PI), m, g);
    b.rotation.set(Math.PI / 2, 0, sd > 0 ? 0 : Math.PI);
    b.position.set(sd * 0.02, 0.88, 0);
    b.scale.set(1, 1, 1.4);
  }
  bx(g, 0.07, 0.14, 0.06, m, 0, 0.88, 0);
  return g;
}

function makeHatchet(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 0.62);
  const m = lookMat(look);
  const b = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.018, 3, 1, false, 0, Math.PI * 0.8), m, g);
  b.rotation.set(Math.PI / 2, 0, -Math.PI * 0.4);
  b.position.set(0.04, 0.55, 0);
  bx(g, 0.07, 0.08, 0.05, m, 0, 0.56, 0);
  b.userData.metal = true;
  return g;
}

function makeRod(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  const m = lookMat(look);
  mesh(new THREE.CylinderGeometry(0.008, 0.02, 1.5, 6).translate(0, 0.75, 0), m, g);
  const reel = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.8, roughness: 0.4 }), g);
  reel.rotation.z = Math.PI / 2; reel.position.set(0.03, 0.14, 0);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.6, 3).translate(0, -0.3, 0), new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }));
  line.position.y = 1.5;
  g.add(line);
  return g;
}

function makeBow(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  const m = lookMat(look);
  const limbArc = mesh(new THREE.TorusGeometry(0.5, 0.016, 6, 24, Math.PI * 0.7), m, g);
  limbArc.rotation.z = Math.PI / 2 - Math.PI * 0.35;
  limbArc.position.set(-0.42, 0.05, 0);
  const a = Math.PI * 0.35, top = new THREE.Vector3(-0.42 + 0.5 * Math.cos(a), 0.05 + 0.5 * Math.sin(a), 0), bot = new THREE.Vector3(top.x, 0.05 - 0.5 * Math.sin(a), 0);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, top.distanceTo(bot), 3), new THREE.MeshBasicMaterial({ color: 0xe8e0c8 }));
  str.position.copy(top).add(bot).multiplyScalar(0.5);
  g.add(str);
  mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 8).translate(0, 0.05, 0), grip(), g);
  return g;
}

function makeStaff(look: string | undefined, element?: 'fire' | 'frost'): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.35, 0.022, lookMat(look));
  const knob = mesh(new THREE.DodecahedronGeometry(0.05, 0), lookMat(look), g);
  knob.position.y = 1.37;
  if (element) {
    const glow = new THREE.MeshStandardMaterial({ color: element === 'fire' ? 0xff7a2a : 0x8fd8ff, emissive: element === 'fire' ? 0xff5a10 : 0x4fb8ff, emissiveIntensity: 2.4, roughness: 0.3 });
    const orb = mesh(element === 'fire' ? new THREE.SphereGeometry(0.06, 12, 8) : new THREE.OctahedronGeometry(0.07, 0), glow, g, false);
    orb.position.y = 1.47;
    if (element === 'frost') orb.scale.set(0.7, 1.4, 0.7);
  }
  return g;
}

/** The held model for an item id, or null if it isn't something you hold. */
export function makeHeld(id: string | undefined): THREE.Group | null {
  const def = id ? ITEMS[id] : undefined;
  if (!def) return null;
  if (def.tool === 'pickaxe') {
    const g = makePickaxe();
    if (def.look !== 'stone') { const m = lookMat(def.look); g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.metal) (o as THREE.Mesh).material = m; }); }
    return g;
  }
  if (def.tool === 'hatchet') return makeHatchet(def.look);
  if (def.tool === 'rod') return makeRod(def.look);
  switch (def.weapon) {
    case 'sword': return makeSword(def.look);
    case 'longsword': return makeSword(def.look, true);
    case 'battleaxe': return makeBattleaxe(def.look);
    case 'bow': return makeBow(def.look);
    case 'staff': return makeStaff(def.look);
    case 'fireStaff': return makeStaff(def.look, 'fire');
    case 'frostStaff': return makeStaff(def.look, 'frost');
  }
  return null;
}

type Gear = PlayerState['gear'];

function tint(g: THREE.Object3D, look: string | undefined) {
  const c = GEAR_COLORS[look ?? 'iron'] ?? GEAR_COLORS.iron;
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.color) { m.color.setHex(c.color); m.metalness = c.metal; m.roughness = c.rough; }
  });
}

/** Dress a character from visible gear (cheap to call every snapshot: only changes rebuild). */
export function applyGear(c: Character, gear: Gear): void {
  const key = JSON.stringify(gear ?? {});
  if ((c as any)._gearKey === key) return;
  (c as any)._gearKey = key;
  const held = gear?.h;
  if (held !== c.heldId) setHeld(c, makeHeld(held), held);
  setShoulders(c, gear?.s ? ((ITEMS[gear.s]?.look ?? 'iron') as keyof typeof GEAR_COLORS) : null);
  c.pack.visible = !!gear?.b;
  c.pack.scale.setScalar(gear?.b === 'leather_backpack' ? 1.22 : 1);
  const show = (g: THREE.Object3D, id: string | undefined) => { g.visible = !!id; if (id) tint(g, ITEMS[id]?.look); };
  show(c.armour.helm, gear?.hd);
  show(c.armour.chest, gear?.c);
  for (const l of c.armour.legs) show(l, gear?.l);
  show(c.armour.shield, gear?.o);
}

/** Visible gear from your own equipment (for previews). */
export function gearFromEquip(e: Partial<Record<string, { id: string } | undefined>>, held: string): Gear {
  return { h: e[held]?.id, s: e.shoulders?.id, b: e.back?.id, hd: e.head?.id, c: e.chest?.id, l: e.legs?.id, o: held === 'mainHand' ? e.offHand?.id : undefined };
}
