/**
 * Procedural adventurer, adapted from KontorLAN's makeSoldier: same proportions and limb/joint
 * structure, re-dressed as an RPG character (tunic, belt, boots, hood) holding a pickaxe.
 * Legs and arms live in their own groups so they animate; everything else is merged.
 */
import * as THREE from 'three';
import { ITEMS, PLAYER_COLORS, RACES, type Race } from '@kontor/shared';
import { mat, bx, ball, limb, mesh, mergeStatic, v3, lerp } from '../engine/procgen.js';

export interface Character {
  g: THREE.Group;
  /** Scaled body (everything but the name tag); rocks side to side for the dwarf waddle. */
  body: THREE.Group;
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
  /** Armour shown by applyGear (helm, chest plate, shield, greaves). */
  /** Plate/leather pieces, plus cloth's own shapes: a robe, a long skirt and a pointy wizard hat. */
  armour: { chest: THREE.Group; helm: THREE.Group; shield: THREE.Group; legs: THREE.Group[]; robe: THREE.Group; skirt: THREE.Group; hat: THREE.Group };
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

export function makeCharacter(colorIndex: number, name?: string, race: Race = 'human', face = 0): Character {
  const col = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const tunicColor = new THREE.Color(col).multiplyScalar(0.75).getHex();
  const M = {
    tunic: mat(tunicColor, 'cloth'),
    sleeve: mat(new THREE.Color(col).multiplyScalar(0.6).getHex(), 'cloth'),
    pants: mat(0x5b4a36, 'cloth'),
    belt: mat(0x3a2818, 'leather', { r: 0.7 }),
    buckle: mat(0xc8a860, null, { r: 0.28, m: 0.9 }),
    skin: mat(race === 'ogre' ? 0x9fa478 : 0xd1a582, null, { r: 0.55 }),
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
    const footLen = race === 'gnome' ? 0.37 : race === 'dwarf' ? 0.21 : 0.26; // long gnome feet, stubby dwarf feet
    bx(knee, 0.12 * W, 0.08, footLen * Wz, M.boot, 0, -shin - 0.09, -0.05 - (footLen - 0.26) * 0.5); // foot
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
  if (R.belly > 0) {
    // A round belly (dwarves, and even more for ogres), plus rounded flanks so the torso isn't a box.
    const b = R.belly;
    ball(upper, v3(0, 0.27, -0.06 - 0.03 * b), 0.2, M.tunic, 16).scale.set(1.02, 0.95, 0.72 + 0.3 * b);
    for (const sx of [-1, 1]) ball(upper, v3(sx * 0.12, 0.33, 0), 0.15, M.tunic, 12).scale.set(0.8, 1.2, 1);
    bx(upper, 0.44, 0.06, 0.2 + 0.18 * b, M.belt, 0, 0.16, -0.04 * b);
  }
  // Armour pieces live in their own groups (kept out of merging) and are shown by applyGear.
  const armour = { chest: new THREE.Group(), helm: new THREE.Group(), shield: new THREE.Group(), legs: [] as THREE.Group[], robe: new THREE.Group(), skirt: new THREE.Group(), hat: new THREE.Group() };
  {
    const a = armour.chest;
    a.userData.keep = true;
    const plate = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.5, metalness: 0.6 });
    bx(a, 0.43, 0.42, 0.27, plate, 0, 0.4, 0);
    if (R.belly > 0) ball(a, v3(0, 0.29, -0.07 - 0.03 * R.belly), 0.205, plate, 14).scale.set(1.02, 0.95, 0.72 + 0.3 * R.belly);
    bx(a, 0.47, 0.12, 0.28, plate, 0, 0.12, 0);
    a.traverse((o) => (o.userData.keep = true));
    a.visible = false;
    upper.add(a);
  }
  {
    // Cloth chest: a robe — a loose tunic with a flared hem down over the thighs, and a sash.
    const a = armour.robe;
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.95, side: THREE.DoubleSide });
    bx(a, 0.45, 0.46, 0.29, cloth, 0, 0.38, 0);
    if (R.belly > 0) ball(a, v3(0, 0.29, -0.07 - 0.03 * R.belly), 0.21, cloth, 14).scale.set(1.02, 0.95, 0.72 + 0.3 * R.belly);
    const hemTop = 0.2 * W + 0.04, hemLen = hipY * 0.62;
    const hem = mesh(new THREE.CylinderGeometry(hemTop, hemTop + 0.1, hemLen, 14, 1, true), cloth, a);
    hem.position.y = 0.16 - hemLen / 2; hem.scale.z = 0.8 * Wz;
    bx(a, 0.47, 0.06, 0.31, cloth, 0, 0.17, 0); // sash
    a.traverse((o) => (o.userData.keep = true));
    a.visible = false;
    upper.add(a);
  }
  {
    // Cloth legs: a long skirt from the waist almost to the ground, flaring out.
    const a = armour.skirt;
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.95, side: THREE.DoubleSide });
    const top = 0.2 * W + 0.03, len = hipY + 0.1;
    const sk = mesh(new THREE.CylinderGeometry(top, top + 0.16, len, 16, 1, true), cloth, a);
    sk.position.y = 0.14 - len / 2; sk.scale.z = 0.85 * Wz;
    a.traverse((o) => (o.userData.keep = true));
    a.visible = false;
    upper.add(a);
  }
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

  // Head: a skin ellipsoid with one of five faces, ears, and hair on the top and back only.
  const head = new THREE.Group();
  head.position.y = 0.79;
  upper.add(head);
  const skull = ball(head, v3(), 0.112, M.skin, 18);
  skull.scale.set(0.95, 1.12, 1);
  ball(head, v3(0.106, 0.0, 0.0), 0.024, M.skin, 8).scale.set(0.5, 1, 0.8);
  ball(head, v3(-0.106, 0.0, 0.0), 0.024, M.skin, 8).scale.set(0.5, 1, 0.8);
  buildFace(head, face, M.skin, M.hair, race);
  // Hair cap tilted towards the back, so its front edge sits high on the forehead.
  const hair = mesh(new THREE.SphereGeometry(0.121, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hair, head);
  hair.position.set(0, 0.03, 0.012);
  hair.rotation.x = 0.42;
  hair.scale.set(1.02, 1.08, 1.06);
  if (race === 'dwarf') {
    // A proper dwarf beard: a broad wedge with a forked tip, plus a moustache.
    const beardM = mat(0x8a4b26, 'cloth', { r: 0.95 });
    const beard = mesh(new THREE.ConeGeometry(0.11, 0.26, 7), beardM, head);
    beard.position.set(0, -0.16, -0.075); beard.rotation.x = Math.PI + 0.25; beard.scale.set(1.1, 1, 0.6);
    for (const sx of [-1, 1]) {
      const fork = mesh(new THREE.ConeGeometry(0.035, 0.12, 6), beardM, head);
      fork.position.set(sx * 0.03, -0.31, -0.04); fork.rotation.set(Math.PI + 0.3, 0, sx * 0.15);
    }
    for (const sx of [-1, 1]) bx(head, 0.055, 0.02, 0.025, beardM, sx * 0.03, -0.038, -0.112, 0, 0, sx * -0.35);
  }
  if (race === 'ogre') for (const sx of [-1, 1]) {
    const tusk = mesh(new THREE.ConeGeometry(0.012, 0.045, 6), mat(0xf0ead8, null, { r: 0.4 }), head);
    tusk.position.set(sx * 0.03, -0.055, -0.1); tusk.rotation.x = -0.25;
  }
  {
    // Helm: a domed cap with a nose guard, sized for the head.
    const h = armour.helm;
    // Double-sided: from behind or below you see the helmet's inside, not a hole through it.
    const plate = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    // Tilted back like the hair, so the front edge sits on the brow and the eyes stay visible.
    const cap = new THREE.Group(); cap.position.y = 0.035; cap.rotation.x = 0.32; h.add(cap);
    const dome = mesh(new THREE.SphereGeometry(0.134, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), plate, cap);
    dome.scale.set(1, 1.08, 1.05);
    bx(cap, 0.018, 0.06, 0.02, plate, 0, -0.012, -0.138); // nose guard, between the eyes
    const rim = mesh(new THREE.TorusGeometry(0.134, 0.01, 6, 20), plate, cap);
    rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.05, 1);
    h.traverse((o) => (o.userData.keep = true));
    h.visible = false;
    head.add(h);
  }
  {
    // Cloth head: a pointy wizard's hat with a wide brim and a tip that flops back.
    const h = armour.hat;
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.95, side: THREE.DoubleSide });
    const hat = new THREE.Group(); hat.position.y = 0.075; hat.rotation.x = 0.12; h.add(hat);
    mesh(new THREE.CylinderGeometry(0.235, 0.24, 0.016, 20), cloth, hat);
    mesh(new THREE.CylinderGeometry(0.075, 0.13, 0.2, 14).translate(0, 0.1, 0), cloth, hat);
    const tip = new THREE.Group(); tip.position.y = 0.2; tip.rotation.x = 0.55; hat.add(tip);
    mesh(new THREE.ConeGeometry(0.075, 0.2, 12).translate(0, 0.1, 0), cloth, tip);
    h.traverse((o) => (o.userData.keep = true));
    h.visible = false;
    head.add(h);
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
    if (sd < 0) {
      // Shield on the left forearm.
      const sh = armour.shield;
      const plate = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.5, metalness: 0.6 });
      const kite = mesh(new THREE.CylinderGeometry(0.2, 0.02, 0.5, 4, 1), plate, sh);
      kite.rotation.set(0, Math.PI / 4, 0); kite.scale.set(1, 1, 0.15);
      const boss = mesh(new THREE.SphereGeometry(0.05, 8, 6), plate, sh);
      boss.position.z = -0.03;
      sh.position.set(-0.07, -0.16, 0);
      sh.rotation.set(0, Math.PI / 2, 0);
      sh.traverse((o) => (o.userData.keep = true));
      sh.visible = false;
      elbow.add(sh);
    }
  }
  // Greaves over the shins.
  for (const leg of legs) {
    const gr = new THREE.Group();
    const plate = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.5, metalness: 0.6 });
    bx(gr, 0.15 * W, shin * 0.8, 0.16 * Wz, plate, 0, -shin * 0.45, -0.005);
    ball(gr, v3(0, 0, -0.02), 0.08 * W, plate, 10);
    gr.traverse((o) => (o.userData.keep = true));
    gr.visible = false;
    leg.knee.add(gr);
    armour.legs.push(gr);
  }
  mergeStatic(g);

  // Overall size per race. The body goes in its own scaled group so the name tag keeps a readable
  // size and just sits lower.
  const scale = R.scale;
  const body = new THREE.Group();
  body.add(...g.children);
  body.scale.setScalar(scale);
  g.add(body);

  const ch: Character = { g, body, legs, upper, head, arms, tool: null, pack, pauldrons, armour, race, hipY, stride: 1 / (scale * (0.35 + 0.65 * L)), ph: 0, swing: 0 };
  void name;
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
  // Riding spreads the legs (seatRider); back on foot they come together again.
  c.legs[0].hip.rotation.z = 0;
  c.legs[1].hip.rotation.z = 0;
  // Knees bend backwards (shin swings back), so the rotation is negative.
  c.legs[0].knee.rotation.x = -Math.max(0, Math.sin(c.ph + 1.2)) * amp * 1.2;
  c.legs[1].knee.rotation.x = -Math.max(0, Math.sin(c.ph + 1.2 + Math.PI)) * amp * 1.2;
  c.upper.position.y = c.hipY + Math.abs(Math.cos(c.ph)) * amp * 0.04;
  if (c.race === 'dwarf') {
    // Dwarves waddle: the whole body rocks onto the planted foot each step, with a little twist.
    const k = Math.min(1, speed / 3);
    c.body.rotation.z = Math.sin(c.ph) * 0.13 * k;
    c.body.position.x = Math.sin(c.ph) * 0.035 * k;
    c.upper.rotation.y = Math.sin(c.ph) * 0.12 * k;
    c.upper.rotation.z = -Math.sin(c.ph) * 0.05 * k;
  }
  c.head.rotation.x = THREE.MathUtils.clamp(-pitch * 0.6, -0.6, 0.6);

  // A swing, once started, always plays to the end (remote 'swing' flags are short).
  if (c.swing > 0 || swinging) {
    c.swing += dt / SWING_ANIM_SEC;
    if (c.swing >= 1) c.swing = swinging ? c.swing % 1 : 0;
  }
  const t = c.swing;
  // The model faces −Z: positive X rotation brings an arm forward, and elbows bend forward.
  if (t > 0 && ITEMS[c.heldId ?? '']?.tool === 'hatchet') {
    // Woodcutting: a sideways chop into the trunk. Draw the axe back out to the right with the
    // shoulders turned, then whip it across in front at chest height.
    const a = t < 0.42 ? THREE.MathUtils.smoothstep(t, 0, 0.42) : t < 0.56 ? 1 - ((t - 0.42) / 0.14) * 2 : -1 + THREE.MathUtils.smoothstep(t, 0.56, 1);
    const w = Math.abs(a);
    c.arms[1].shoulder.rotation.x = 0.35 + 0.95 * w + (a < 0 ? 0.25 * w : 0);
    c.arms[1].shoulder.rotation.z = 0.12 + a * 0.75;
    c.arms[1].shoulder.rotation.y = -a * 1.2; // roll the arm so the axe swings level, not overhead
    c.arms[1].elbow.rotation.x = 0.95 - 0.55 * w;
    c.arms[0].shoulder.rotation.x = 0.3 + 0.7 * w;
    c.arms[0].shoulder.rotation.z = -0.15 + Math.min(0, a) * 0.4;
    c.arms[0].elbow.rotation.x = 0.6;
    c.upper.rotation.x = 0;
    c.upper.rotation.y = a * 0.35;
  } else if (t > 0) {
    // Two-handed overhead chop: wind up behind the head, strike down in front, recover.
    const up = t < 0.5 ? THREE.MathUtils.smoothstep(t, 0, 0.5) : t < 0.66 ? 1 - THREE.MathUtils.smoothstep(t, 0.5, 0.66) : 0;
    const follow = t >= 0.5 ? (t < 0.75 ? THREE.MathUtils.smoothstep(t, 0.5, 0.66) : 1 - THREE.MathUtils.smoothstep(t, 0.75, 1)) : 0;
    // The strike ends with the arm out in front (not tucked in), so the tool head never ends up
    // inside the body on the follow-through.
    const sh = lerp(0.6, 2.75, up) + follow * 0.55;
    const el = lerp(0.5, 1.35, up) - follow * 0.3;
    c.arms[1].shoulder.rotation.x = sh;
    c.arms[1].elbow.rotation.x = el;
    c.arms[0].shoulder.rotation.x = sh * 0.88;
    c.arms[0].elbow.rotation.x = el + 0.2;
    c.arms[0].shoulder.rotation.z = -0.25 * (1 - up * 0.5); // left hand comes across to the haft
    c.arms[1].shoulder.rotation.z = 0.12; // tool arm a little out from the body, so the tool clears it
    c.arms[1].shoulder.rotation.y = 0;
    c.upper.rotation.x = -0.12 * up + 0.22 * follow; // lean back on the wind-up, into the strike
    if (c.race !== 'dwarf') c.upper.rotation.y = 0;
  } else {
    c.arms[0].shoulder.rotation.x = -sw * 0.8;
    c.arms[0].elbow.rotation.x = 0.25;
    c.arms[0].shoulder.rotation.z = 0;
    c.arms[1].shoulder.rotation.z = 0.12;
    c.arms[1].shoulder.rotation.y = 0;
    // Tool arm: carried with the forearm forward, a little out from the body.
    c.arms[1].shoulder.rotation.x = 0.3 + sw * 0.3;
    c.arms[1].elbow.rotation.x = 0.95;
    c.upper.rotation.x = 0;
    if (c.race !== 'dwarf') c.upper.rotation.y = 0;
  }
}

/** Seconds per third-person swing (matches the first-person one). */
const SWING_ANIM_SEC = 0.62;

/** Tier colours for metal gear (design doc §6). Leather is the starter look. */
export const GEAR_COLORS: Record<string, { color: number; metal: number; rough: number }> = {
  leather: { color: 0x8a6a48, metal: 0.05, rough: 0.7 },
  cloth: { color: 0x6d5f8a, metal: 0, rough: 0.95 },
  birch: { color: 0xd8d2c0, metal: 0, rough: 0.7 },
  pine: { color: 0x8a6440, metal: 0, rough: 0.7 },
  bone: { color: 0xe8e0c8, metal: 0, rough: 0.5 },
  goblin: { color: 0x6a7a3a, metal: 0, rough: 0.8 },
  lynx: { color: 0xa8875a, metal: 0, rough: 0.75 },
  linen: { color: 0xc8bc9c, metal: 0, rough: 0.95 },
  jute: { color: 0xa88a58, metal: 0, rough: 1 },
  ramie: { color: 0xd4d8c4, metal: 0, rough: 0.8 },
  cotton: { color: 0xe8e4da, metal: 0, rough: 0.95 },
  bamboo: { color: 0xb8c890, metal: 0, rough: 0.6 },
  silk: { color: 0x9fcfe2, metal: 0.1, rough: 0.5 },
  silversteel: { color: 0xcfdce8, metal: 1, rough: 0.18 },
  coal: { color: 0x2a2a2e, metal: 0.2, rough: 0.6 },
  gold: { color: 0xd8b04a, metal: 1, rough: 0.3 },
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

const FACE_M = {
  white: mat(0xf4efe6, null, { r: 0.35 }),
  iris: mat(0x2c3a46, null, { r: 0.25 }),
  mouth: mat(0x7a3530, null, { r: 0.6 }),
  teeth: mat(0xf2ede0, null, { r: 0.4 }),
  cheek: mat(0xe0907e, null, { r: 0.7 }),
  freckle: mat(0xa8664a, null, { r: 0.7 }),
};

/** One of five faces (FACES in shared): eyes, brows, nose and mouth, all on the −Z front of the head. */
function buildFace(head: THREE.Group, face: number, skin: THREE.Material, hair: THREE.Material, race: Race): void {
  const Z = -0.101; // just proud of the face surface at eye height
  const ZM = -0.108; // mouth line (the face is rounder lower down)
  const eye = (sx: number, r: number, sy: number, lid = 0) => {
    const w = ball(head, v3(sx * 0.038, 0.02, Z), r, FACE_M.white, 10);
    w.scale.set(1, sy, 0.55);
    const iris = ball(head, v3(sx * 0.038, 0.02 - (lid ? 0.003 : 0), Z - r * 0.5), r * 0.58, FACE_M.iris, 8);
    iris.scale.set(1, Math.min(1, sy * 1.1), 0.5);
    if (lid) {
      // Heavy upper eyelid: a skin dome over the top half of the eye.
      const l = mesh(new THREE.SphereGeometry(r * 1.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), skin, head);
      l.position.set(sx * 0.038, 0.02, Z + 0.001); l.rotation.x = -Math.PI / 2 + lid; l.scale.set(1, 1, 0.6);
    }
  };
  const brow = (tilt: number, y = 0.05, thick = 0.011) => {
    for (const sx of [-1, 1]) bx(head, 0.036, thick, 0.012, hair, sx * 0.04, y, Z - 0.006, 0, 0, sx * tilt);
  };
  /** Mouth as a torus arc: curve > 0 smiles, < 0 frowns. */
  const arcMouth = (w: number, curve: number, y = -0.052) => {
    const ang = Math.PI * 0.7;
    const m = mesh(new THREE.TorusGeometry(w, 0.0055, 5, 12, ang), FACE_M.mouth, head);
    m.position.set(0, y + (curve > 0 ? w * 0.75 : -w * 0.75), ZM);
    m.rotation.z = curve > 0 ? -Math.PI / 2 - ang / 2 : Math.PI / 2 - ang / 2;
    m.scale.set(1, Math.abs(curve), 1);
  };
  switch (face) {
    case 1: { // Stern
      eye(-1, 0.017, 0.6); eye(1, 0.017, 0.6);
      brow(-0.32, 0.044, 0.014);
      const n = bx(head, 0.022, 0.06, 0.03, skin, 0, -0.008, -0.112, 0.25, 0, 0);
      void n;
      bx(head, 0.046, 0.007, 0.01, FACE_M.mouth, 0, -0.058, ZM);
      if (race !== 'dwarf') for (const sx of [-1, 1]) bx(head, 0.04, 0.014, 0.016, hair, sx * 0.022, -0.04, -0.108, 0, 0, sx * -0.28);
      break;
    }
    case 2: { // Cheerful
      eye(-1, 0.022, 1.05); eye(1, 0.022, 1.05);
      brow(0.18, 0.058);
      ball(head, v3(0, -0.012, -0.118), 0.024, skin, 10);
      bx(head, 0.05, 0.022, 0.012, FACE_M.mouth, 0, -0.057, ZM + 0.002);
      bx(head, 0.044, 0.01, 0.01, FACE_M.teeth, 0, -0.051, ZM - 0.003);
      for (const sx of [-1, 1]) ball(head, v3(sx * 0.06, -0.022, -0.088), 0.017, FACE_M.cheek, 8).scale.set(1, 0.7, 0.4);
      break;
    }
    case 3: { // Weathered
      eye(-1, 0.017, 0.4); eye(1, 0.018, 0.45);
      brow(-0.1, 0.042, 0.013);
      const n = mesh(new THREE.BoxGeometry(0.03, 0.055, 0.04), skin, head);
      n.position.set(0.004, -0.01, -0.115); n.rotation.set(0.2, 0.2, 0.22);
      arcMouth(0.022, -0.6, -0.06);
      // Stubble: a darker shell over the jaw.
      const st = mesh(new THREE.SphereGeometry(0.113, 14, 8, 0, Math.PI * 2, Math.PI * 0.66, Math.PI * 0.26), mat(0xb08a72, null, { r: 0.95 }), head);
      st.scale.set(0.96, 1.12, 1.01);
      break;
    }
    case 4: { // Dreamy
      eye(-1, 0.019, 0.95, 0.35); eye(1, 0.019, 0.95, 0.35);
      brow(0.08, 0.056, 0.009);
      const n = mesh(new THREE.ConeGeometry(0.016, 0.05, 6), skin, head);
      n.position.set(0, -0.006, -0.124); n.rotation.x = -Math.PI / 2 + 0.25;
      const o = mesh(new THREE.TorusGeometry(0.011, 0.005, 6, 12), FACE_M.mouth, head);
      o.position.set(0, -0.056, ZM);
      for (const [x, y] of [[-0.06, -0.02], [-0.048, -0.03], [-0.067, -0.032], [0.06, -0.02], [0.05, -0.031], [0.068, -0.03]]) {
        ball(head, v3(x, y, -0.092), 0.0045, FACE_M.freckle, 5).scale.set(1, 1, 0.4);
      }
      break;
    }
    default: { // Friendly
      eye(-1, 0.019, 0.95); eye(1, 0.019, 0.95);
      brow(0.1, 0.052);
      ball(head, v3(0, -0.01, -0.118), 0.02, skin, 10).scale.set(1, 0.9, 1);
      arcMouth(0.024, 0.75);
    }
  }
}

/** Ranged poses for other players: drawing a bow (arms forward, string hand pulled back) or casting. */
export function aimPose(c: Character, kind: 'shoot' | 'cast'): void {
  if (kind === 'shoot') {
    c.arms[1].shoulder.rotation.set(1.45, 0, 0.15);
    c.arms[1].elbow.rotation.x = 0.05;
    c.arms[0].shoulder.rotation.set(1.35, 0, -0.45);
    c.arms[0].elbow.rotation.x = 1.5;
  } else {
    c.arms[1].shoulder.rotation.set(1.9, 0, 0.1);
    c.arms[1].elbow.rotation.x = 0.3;
    c.arms[0].shoulder.rotation.set(1.1, 0, -0.2);
    c.arms[0].elbow.rotation.x = 0.4;
  }
}
