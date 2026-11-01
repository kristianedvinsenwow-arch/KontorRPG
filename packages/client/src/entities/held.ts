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

function makeMace(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 0.55, 0.024);
  const m = lookMat(look);
  mesh(new THREE.IcosahedronGeometry(0.09, 0), m, g).position.y = 0.6;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const f = mesh(new THREE.BoxGeometry(0.03, 0.12, 0.05), m, g);
    f.position.set(Math.cos(a) * 0.08, 0.6, Math.sin(a) * 0.08); f.rotation.y = -a;
  }
  return g;
}

function makeWarhammer(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.1, 0.028);
  const m = lookMat(look);
  bx(g, 0.34, 0.15, 0.15, m, 0, 1.02, 0);
  bx(g, 0.05, 0.19, 0.19, m, 0.18, 1.02, 0);
  bx(g, 0.05, 0.19, 0.19, m, -0.18, 1.02, 0);
  return g;
}

function makeHalberd(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.7, 0.022);
  const m = lookMat(look);
  const blade = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.018, 3, 1, false, 0, Math.PI), m, g);
  blade.rotation.set(Math.PI / 2, 0, 0); blade.position.set(0.02, 1.55, 0); blade.scale.set(1, 1, 1.5);
  const tip = mesh(new THREE.ConeGeometry(0.04, 0.26, 4), m, g); tip.position.y = 1.83; tip.scale.z = 0.35;
  bx(g, 0.1, 0.03, 0.02, m, -0.07, 1.52, 0);
  return g;
}

function makeSpear(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.75, 0.02);
  const m = lookMat(look);
  const tip = mesh(new THREE.ConeGeometry(0.045, 0.3, 4), m, g); tip.position.y = 1.9; tip.scale.z = 0.4;
  return g;
}

function makeHatchet(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  haft(g, 0.62);
  const m = lookMat(look);
  // A proper axe head: a bearded blade flaring out from the eye, cutting edge facing away (+X).
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.035);
  shape.lineTo(0.06, 0.03);
  shape.quadraticCurveTo(0.1, 0.05, 0.13, 0.085);
  shape.quadraticCurveTo(0.15, 0.01, 0.135, -0.075);
  shape.quadraticCurveTo(0.09, -0.05, 0.06, -0.02);
  shape.lineTo(0, -0.025);
  shape.closePath();
  const blade = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }).translate(0, 0, -0.008), m, g);
  blade.position.set(0.0, 0.55, 0);
  blade.userData.metal = true;
  bx(g, 0.06, 0.075, 0.045, m, -0.005, 0.555, 0); // the eye around the haft
  bx(g, 0.035, 0.05, 0.035, m, -0.045, 0.555, 0); // the poll (back)
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

/** Point a thin cylinder (height 1 along Y) from a to b. */
function stretch(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(1, Math.max(1e-3, a.distanceTo(b)), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

/**
 * A recurve-ish bow: grip at the origin, limbs up and down (±Y) curving back towards the archer
 * (+Z), a string between the tips and a nocked arrow pointing forward (−Z). `userData.draw(k)`
 * pulls the string back (0 = rest, 1 = full draw) and `userData.arrow` shows/hides the arrow.
 */
function makeBow(look: string | undefined): THREE.Group {
  const g = new THREE.Group();
  const m = look === 'pine' ? mat(0x7a5232, 'wood', { r: 0.6 }) : mat(0xb89a70, 'wood', { r: 0.6 });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = -0.52 + (i / 16) * 1.04, a = Math.abs(y) / 0.52;
    pts.push(new THREE.Vector3(0, y, 0.15 * a ** 1.8));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.014, 6), m, g);
  mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.15, 8), grip(), g);
  const top = pts[16].clone(), bot = pts[0].clone();
  const strMat = new THREE.MeshBasicMaterial({ color: 0xece4cc });
  const sa = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 4), strMat), sb = sa.clone();
  g.add(sa, sb);
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.72, 5).translate(0, 0.36, 0), new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.7 }));
  shaft.rotation.x = -Math.PI / 2; // along −Z
  arrow.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.6 }));
  head.rotation.x = -Math.PI / 2; head.position.z = -0.75;
  arrow.add(head);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.1), new THREE.MeshStandardMaterial({ color: 0xd84a3a, side: THREE.DoubleSide }));
    f.rotation.set(-Math.PI / 2, r, 0); f.position.z = -0.06;
    arrow.add(f);
  }
  g.add(arrow);
  const draw = (k: number) => {
    const nock = new THREE.Vector3(0, 0.0, top.z + 0.34 * k);
    stretch(sa, top, nock); stretch(sb, bot, nock);
    arrow.position.copy(nock);
  };
  draw(0);
  g.userData.draw = draw;
  g.userData.arrow = arrow;
  g.userData.bow = true;
  return g;
}

function makeStaff(look: string | undefined, element?: 'fire' | 'frost' | 'life'): THREE.Group {
  const g = new THREE.Group();
  haft(g, 1.35, 0.022, lookMat(look));
  const knob = mesh(new THREE.DodecahedronGeometry(0.05, 0), lookMat(look), g);
  knob.position.y = 1.37;
  if (element) {
    const col = { fire: [0xff7a2a, 0xff5a10], frost: [0x8fd8ff, 0x4fb8ff], life: [0x9ff0a0, 0x3fd060] }[element];
    const glow = new THREE.MeshStandardMaterial({ color: col[0], emissive: col[1], emissiveIntensity: 2.4, roughness: 0.3 });
    const orb = mesh(element === 'frost' ? new THREE.OctahedronGeometry(0.07, 0) : new THREE.SphereGeometry(0.06, 12, 8), glow, g, false);
    if (element === 'life') for (const sx of [-1, 1]) { const leaf = mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshStandardMaterial({ color: 0x5fae4a, roughness: 0.7 }), g); leaf.scale.set(0.35, 1, 0.15); leaf.position.set(sx * 0.05, 1.41, 0); leaf.rotation.z = -sx * 0.7; }
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
    case 'mace': return makeMace(def.look);
    case 'warhammer': return makeWarhammer(def.look);
    case 'halberd': return makeHalberd(def.look);
    case 'spear': return makeSpear(def.look);
    case 'bow': return makeBow(def.look);
    case 'staff': return makeStaff(def.look);
    case 'fireStaff': return makeStaff(def.look, 'fire');
    case 'frostStaff': return makeStaff(def.look, 'frost');
    case 'lifeStaff': return makeStaff(def.look, 'life');
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
  c.pack.scale.setScalar(gear?.b ? 1 + Math.min(0.5, ((ITEMS[gear.b]?.bagSlots ?? 4) - 4) * 0.028) : 1); // bigger bag, bigger pack
  const show = (g: THREE.Object3D, id: string | undefined) => { g.visible = !!id; if (id) tint(g, ITEMS[id]?.look); };
  // Cloth has its own shapes: a pointy hat, a robe, a skirt.
  const cloth = (id: string | undefined) => !!id && ITEMS[id]?.armourType === 'cloth';
  const pick = (id: string | undefined, isCloth: boolean) => (cloth(id) === isCloth ? id : undefined);
  show(c.armour.helm, pick(gear?.hd, false));
  show(c.armour.hat, pick(gear?.hd, true));
  show(c.armour.chest, pick(gear?.c, false));
  show(c.armour.robe, pick(gear?.c, true));
  for (const sl of c.armour.sleeves) show(sl, pick(gear?.c, true));
  for (const l of c.armour.legs) show(l, pick(gear?.l, false));
  show(c.armour.skirt, pick(gear?.l, true));
  show(c.armour.shield, gear?.o);
}

/** Visible gear from your own equipment (for previews). */
export function gearFromEquip(e: Partial<Record<string, { id: string } | undefined>>, held: string): Gear {
  return { h: e[held]?.id, s: e.shoulders?.id, b: e.back?.id, hd: e.head?.id, c: e.chest?.id, l: e.legs?.id, o: held === 'mainHand' ? e.offHand?.id : undefined };
}
