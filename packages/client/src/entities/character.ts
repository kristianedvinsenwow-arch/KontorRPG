/**
 * Procedural adventurer, adapted from KontorLAN's makeSoldier: same proportions and limb/joint
 * structure, re-dressed as an RPG character (tunic, belt, boots, hood) holding a pickaxe.
 * Legs and arms live in their own groups so they animate; everything else is merged.
 */
import * as THREE from 'three';
import { PLAYER_COLORS, RACES, type Race } from '@kontor/shared';
import { mat, bx, ball, limb, mesh, mergeStatic, nameSprite, v3, lerp } from '../engine/procgen.js';

export interface Character {
  g: THREE.Group;
  legs: { hip: THREE.Group; knee: THREE.Group }[];
  upper: THREE.Group;
  head: THREE.Group;
  arms: { shoulder: THREE.Group; elbow: THREE.Group }[];
  tool: THREE.Group | null;
  pack: THREE.Group;
  /** Item id currently in hand (tool or weapon). */
  heldId?: string;
  /** Shoulder tier currently shown (applyGear bookkeeping). */
  userData_sh?: string | null;
  tag?: THREE.Sprite;
  /** Pauldrons on each shoulder; hidden until something is equipped in the shoulders slot. */
  pauldrons: THREE.Group[];
  race: Race;
  /** Hip height in body space: lower for short-legged races. */
  hipY: number;
  /** Steps per metre relative to a human — short legs take more, quicker steps. */
  stride: number;
  ph: number;
  swing: number;
}

/** A stone-tier pickaxe: wooden haft, knapped stone head lashed on with leather. */
export function makePickaxe(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x8a6a44, 'wood', { r: 0.7 });
  const stone = mat(0x8d8a84, 'rock', { r: 0.85 });
  const lash = mat(0x5a3d24, 'leather');
  const haft = mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.72, 8), wood, g);
  haft.position.y = 0.36;
  const head = new THREE.Group();
  head.position.y = 0.68;
  g.add(head);
  const pickA = mesh(new THREE.ConeGeometry(0.035, 0.26, 6), stone, head);
  pickA.rotation.z = -Math.PI / 2; pickA.position.x = 0.15;
  const pickB = mesh(new THREE.ConeGeometry(0.035, 0.2, 6), stone, head);
  pickB.rotation.z = Math.PI / 2; pickB.position.x = -0.12;
  bx(head, 0.08, 0.07, 0.07, stone, 0, 0, 0);
  bx(head, 0.05, 0.1, 0.075, lash, 0, -0.02, 0);
  for (const o of head.children) if ((o as THREE.Mesh).material === stone) o.userData.metal = true;
  return g;
}

export function makeCharacter(colorIndex: number, name?: string, race: Race = 'human'): Character {
  const col = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const tunicColor = new THREE.Color(col).multiplyScalar(0.75).getHex();
  const M = {
    tunic: mat(tunicColor, 'cloth'),
    sleeve: mat(new THREE.Color(col).multiplyScalar(0.6).getHex(), 'cloth'),
    pants: mat(0x5b4a36, 'cloth'),
    belt: mat(0x3a2818, 'leather', { r: 0.7 }),
    buckle: mat(0xc8a860, null, { r: 0.28, m: 0.9 }),
    skin: mat(0xd1a582, null, { r: 0.55 }),
    boot: mat(0x3b2a1c, 'leather', { r: 0.6 }),
    hood: mat(0x46503f, 'cloth', { r: 0.95 }),
    hair: mat(0x4a3424, null, { r: 0.9 }),
    eye: mat(0x1a1612, null, { r: 0.3 }),
    pack: mat(0x6e5236, 'leather'),
  };
  const g = new THREE.Group();
  // Race proportions: L shortens the legs, W widens the body, H enlarges the head.
  const R = RACES[race], L = R.legs, W = R.width, H = R.head;
  const Wz = 1 + (W - 1) * 0.6;
  const thigh = 0.45 * L, shin = 0.36 * L;
  const hipY = 0.81 * L + 0.12; // feet stay on the ground whatever the leg length

  // Legs: hip → knee chain, as in KontorLAN.
  const legs: Character['legs'] = [];
  for (const sd of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sd * 0.11 * W, hipY, 0);
    g.add(hip);
    limb(hip, v3(0, 0.02, 0), v3(0, -thigh, 0), 0.09 * W, 0.075 * W, M.pants);
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    hip.add(knee);
    ball(knee, v3(), 0.073 * W, M.pants, 10);
    limb(knee, v3(), v3(0, -shin, 0), 0.07 * W, 0.06 * W, M.pants);
    bx(knee, 0.13 * W, 0.16, 0.15 * Wz, M.boot, 0, -shin - 0.02, -0.01); // boot shaft
    bx(knee, 0.12 * W, 0.08, 0.26 * Wz, M.boot, 0, -shin - 0.09, -0.05); // foot
    legs.push({ hip, knee });
  }

  // Torso (widened for stocky races; the head is counter-scaled below so it stays round).
  const upper = new THREE.Group();
  upper.position.y = hipY;
  upper.scale.set(W, 1, Wz);
  g.add(upper);
  bx(upper, 0.34, 0.16, 0.22, M.pants, 0, 0.05, 0);
  bx(upper, 0.4, 0.5, 0.24, M.tunic, 0, 0.36, 0); // tunic body
  bx(upper, 0.44, 0.14, 0.26, M.tunic, 0, 0.08, 0); // tunic skirt flare
  bx(upper, 0.42, 0.06, 0.26, M.belt, 0, 0.16, 0);
  bx(upper, 0.07, 0.06, 0.02, M.buckle, 0, 0.16, -0.135);
  bx(upper, 0.12, 0.1, 0.06, M.pack, 0.17, 0.12, -0.08); // belt pouch
  // Backpack: only shown while a bag is worn in the back slot (bigger bag, bigger pack).
  const pack = new THREE.Group();
  pack.position.set(0, 0.4, 0.19);
  upper.add(pack);
  bx(pack, 0.3, 0.34, 0.14, M.pack, 0, 0, 0);
  bx(pack, 0.26, 0.08, 0.15, M.belt, 0, 0.13, 0.005); // flap
  bx(pack, 0.2, 0.12, 0.05, M.pack, 0, -0.07, 0.09); // front pocket
  for (const sx of [-0.1, 0.1]) bx(pack, 0.04, 0.4, 0.03, M.belt, sx, 0.02, -0.08); // straps
  pack.traverse((o) => (o.userData.keep = true));
  pack.visible = false;
  limb(upper, v3(0, 0.6, 0), v3(0, 0.7, 0), 0.06, 0.055, M.skin, 10);

  // Head with hood.
  const head = new THREE.Group();
  head.position.y = 0.79;
  upper.add(head);
  const face = ball(head, v3(), 0.112, M.skin, 18);
  face.scale.set(0.95, 1.12, 1);
  ball(head, v3(0.04, 0.02, -0.1), 0.014, M.eye, 6);
  ball(head, v3(-0.04, 0.02, -0.1), 0.014, M.eye, 6);
  // Face details: brows, nose, ears and a little beard shadow give the head a readable silhouette.
  bx(head, 0.038, 0.011, 0.012, M.hair, 0.042, 0.047, -0.103, 0, 0, -0.12);
  bx(head, 0.038, 0.011, 0.012, M.hair, -0.042, 0.047, -0.103, 0, 0, 0.12);
  const nose = mesh(new THREE.ConeGeometry(0.018, 0.045, 6), M.skin, head);
  nose.position.set(0, -0.005, -0.118); nose.rotation.x = -Math.PI / 2 + 0.35;
  ball(head, v3(0.106, 0.0, 0.0), 0.024, M.skin, 8).scale.set(0.5, 1, 0.8);
  ball(head, v3(-0.106, 0.0, 0.0), 0.024, M.skin, 8).scale.set(0.5, 1, 0.8);
  bx(head, 0.05, 0.008, 0.01, mat(0x8c5a46, null, { r: 0.6 }), 0, -0.052, -0.104);
  // Hair: a cap over the top and back of the head, tilted back so the forehead and face stay open.
  const hair = mesh(new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), M.hair, head);
  hair.position.set(0, 0.012, 0.012);
  hair.rotation.x = -0.32;
  hair.scale.set(1, 1.05, 1.05);
  if (race === 'dwarf') {
    // A proper dwarf beard: a broad wedge with a forked tip, plus a moustache.
    const beardM = mat(0x8a4b26, 'cloth', { r: 0.95 });
    const beard = mesh(new THREE.ConeGeometry(0.11, 0.26, 7), beardM, head);
    beard.position.set(0, -0.15, -0.075); beard.rotation.x = Math.PI + 0.25; beard.scale.set(1.1, 1, 0.6);
    for (const sx of [-1, 1]) {
      const fork = mesh(new THREE.ConeGeometry(0.035, 0.12, 6), beardM, head);
      fork.position.set(sx * 0.03, -0.3, -0.04); fork.rotation.set(Math.PI + 0.3, 0, sx * 0.15);
    }
    bx(head, 0.11, 0.025, 0.03, beardM, 0, -0.035, -0.11);
  }
  if (race === 'gnome') {
    // Tall pointed hat in the player's colour, leaning back.
    const hat = mesh(new THREE.ConeGeometry(0.14, 0.42, 12), M.sleeve, head);
    hat.position.set(0, 0.27, 0.06); hat.rotation.x = 0.22;
  }
  head.scale.set(H / W, H, H / Wz);

  // Arms: shoulder → elbow chain; the right hand carries the tool.
  const arms: Character['arms'] = [];
  const pauldrons: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sd * 0.25, 0.56, 0);
    upper.add(shoulder);
    ball(shoulder, v3(), 0.075, M.sleeve, 12);
    // Pauldron: a domed plate over the shoulder with a rim, angled outwards. Its own group so it
    // survives draw-call merging and can be shown, hidden and recoloured per tier.
    const pad = new THREE.Group();
    pad.userData.keep = true;
    pad.position.set(sd * 0.02, 0.035, 0);
    pad.rotation.z = -sd * 0.35;
    const plateM = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6, metalness: 0.1 });
    const dome = mesh(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), plateM, pad);
    dome.scale.set(1.05, 0.62, 1.15);
    const rim = mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 18), plateM, pad);
    rim.rotation.x = Math.PI / 2; rim.scale.set(1.05, 1.15, 1);
    pad.traverse((o) => (o.userData.keep = true));
    pad.visible = false;
    shoulder.add(pad);
    pauldrons.push(pad);
    limb(shoulder, v3(), v3(0, -0.28, 0), 0.065, 0.055, M.sleeve);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    ball(elbow, v3(), 0.055, M.sleeve, 10);
    limb(elbow, v3(), v3(0, -0.24, 0), 0.05, 0.042, M.skin);
    ball(elbow, v3(0, -0.27, 0), 0.048, M.skin, 10);
    arms.push({ shoulder, elbow });
  }
  mergeStatic(g);

  // Overall size per race. The body goes in its own scaled group so the name tag keeps a readable
  // size and just sits lower.
  const scale = R.scale;
  const body = new THREE.Group();
  body.add(...g.children);
  body.scale.setScalar(scale);
  g.add(body);

  const ch: Character = { g, legs, upper, head, arms, tool: null, pack, pauldrons, race, hipY, stride: 1 / (scale * (0.35 + 0.65 * L)), ph: 0, swing: 0 };
  if (name) {
    ch.tag = nameSprite(name, col);
    ch.tag.position.y = R.height + 0.3;
    g.add(ch.tag);
  }
  return ch;
}

/** Put a model in the right hand (or empty it with null). */
export function setHeld(c: Character, model: THREE.Group | null, id?: string): void {
  if (c.tool) c.tool.parent?.remove(c.tool);
  c.tool = model;
  c.heldId = id;
  if (!model) return;
  model.position.set(0, -0.27, 0);
  // In forearm space: tilt the haft so it rises forward out of the fist, then spin it about its own
  // axis so the picks sit fore and aft (upright) instead of sideways. Grip ~8 cm up the haft.
  model.rotation.set(-2.15, Math.PI / 2, 0, 'XYZ');
  model.translateY(-0.08);
  c.arms[1].elbow.add(model);
}

/** Walk cycle + look + tool swing (KontorLAN's animSoldier, trimmed for RPG use). */
export function animateCharacter(c: Character, speed: number, pitch: number, swinging: boolean, dt: number): void {
  c.ph += dt * speed * 2.2 * c.stride;
  const amp = Math.min(0.7, speed * 0.13);
  const sw = Math.sin(c.ph) * amp;
  c.legs[0].hip.rotation.x = sw;
  c.legs[1].hip.rotation.x = -sw;
  // Knees bend backwards (shin swings back), so the rotation is negative.
  c.legs[0].knee.rotation.x = -Math.max(0, Math.sin(c.ph + 1.2)) * amp * 1.2;
  c.legs[1].knee.rotation.x = -Math.max(0, Math.sin(c.ph + 1.2 + Math.PI)) * amp * 1.2;
  c.upper.position.y = c.hipY + Math.abs(Math.cos(c.ph)) * amp * 0.04;
  c.head.rotation.x = THREE.MathUtils.clamp(-pitch * 0.6, -0.6, 0.6);

  // Arms swing opposite the legs; the tool arm lifts and strikes while swinging.
  c.swing = swinging ? (c.swing + dt * 2.4) % 1 : lerp(c.swing, 0, Math.min(1, dt * 8));
  const strike = swinging ? Math.sin(c.swing * Math.PI * 2) : 0;
  // The model faces −Z: positive X rotation brings an arm forward, and elbows bend forward.
  c.arms[0].shoulder.rotation.x = -sw * 0.8;
  c.arms[0].elbow.rotation.x = 0.25;
  // Tool arm: carried with the forearm forward; swinging lifts it overhead and chops down.
  c.arms[1].shoulder.rotation.x = swinging ? 1.6 + strike * 1.1 : 0.3 + sw * 0.3;
  c.arms[1].elbow.rotation.x = swinging ? 0.45 - strike * 0.3 : 0.95;
}

/** Tier colours for metal gear (design doc §6). Leather is the starter look. */
export const GEAR_COLORS: Record<string, { color: number; metal: number; rough: number }> = {
  leather: { color: 0x8a6a48, metal: 0.05, rough: 0.7 },
  stone: { color: 0x8d8a84, metal: 0, rough: 0.85 },
  iron: { color: 0x7e8288, metal: 0.8, rough: 0.42 },
  steel: { color: 0xb4bac2, metal: 0.9, rough: 0.3 },
  silver: { color: 0xd8dde4, metal: 1, rough: 0.2 },
  mithril: { color: 0x9fc6e8, metal: 0.95, rough: 0.22 },
  grubenSteel: { color: 0x4d5a52, metal: 0.9, rough: 0.35 },
  somnaminium: { color: 0xc89cf0, metal: 1, rough: 0.15 },
};

/** Show pauldrons of a tier, or hide them with null. */
export function setShoulders(c: Character, tier: keyof typeof GEAR_COLORS | null): void {
  for (const pad of c.pauldrons) {
    pad.visible = !!tier;
    if (!tier) continue;
    const g = GEAR_COLORS[tier];
    pad.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m) { m.color.setHex(g.color); m.metalness = g.metal; m.roughness = g.rough; }
    });
  }
}
