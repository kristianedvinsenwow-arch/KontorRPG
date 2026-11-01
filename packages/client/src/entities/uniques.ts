/**
 * Boss and treasure uniques get their own looks instead of the plain model for their slot:
 * the Drowned Captain's pirate tricorn (with a little skull), his curved cutlass, Knut's cauldron-lid
 * belly plate, horned and crowned helms, glowing greaves, spiked pauldrons, a real anchor, a trident…
 *
 * Weapons replace the held model. Armour adds pieces on top of (or, for the hat, instead of) the
 * normal plate, attached to the character's head, chest, knees or shoulders.
 */
import * as THREE from 'three';
import { mat, mesh, bx, ball, v3 } from '../engine/procgen.js';
import type { Character } from './character.js';

const std = (color: number, metal = 0.6, rough = 0.4, emissive = 0, ei = 0) =>
  new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive, emissiveIntensity: ei });
const GOLD = () => std(0xd8a838, 0.8, 0.3);
const BONE = () => std(0xe8e0c8, 0, 0.7);
const DARK = () => std(0x1a1614, 0.1, 0.9);
const IRON = () => std(0x6a6c70, 0.7, 0.45);
const grip = () => mat(0x3a2818, 'leather', { r: 0.7 });

/** A tiny skull: cranium, jaw, two dark eyes and a nose hole. Faces −Z. */
function skull(parent: THREE.Object3D, x: number, y: number, z: number, s = 1): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g);
  const b = BONE(), d = DARK();
  ball(g, v3(0, 0.008, 0), 0.026, b, 10).scale.set(1, 0.95, 0.85);
  bx(g, 0.03, 0.014, 0.022, b, 0, -0.018, -0.004);
  for (const sx of [-1, 1]) ball(g, v3(sx * 0.0095, 0.008, -0.021), 0.0065, d, 6);
  bx(g, 0.004, 0.006, 0.004, d, 0, -0.004, -0.024);
  return g;
}

// ------------------------------------------------------------------ weapons

function cutlass(): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 8).translate(0, 0.075, 0), grip(), g);
  // Gold basket guard: a bowl over the knuckles and a quillon.
  const gold = GOLD();
  const bowl = mesh(new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold, g);
  bowl.position.y = 0.16; bowl.rotation.x = Math.PI; bowl.scale.set(1.1, 0.7, 0.8);
  bx(g, 0.16, 0.02, 0.03, gold, 0, 0.165, 0);
  ball(g, v3(0, -0.005, 0), 0.028, gold, 8); // pommel
  // A curved, single-edged blade: short segments, each a bit more bent.
  const steel = std(0xc8ccd2, 0.85, 0.25);
  let x = 0, y = 0.17, a = 0;
  for (let i = 0; i < 7; i++) {
    const len = 0.09, w = 0.05 - i * 0.003;
    const seg = bx(g, w, len + 0.005, 0.01, steel, x + Math.sin(a) * len / 2, y + Math.cos(a) * len / 2, 0, 0, 0, -a);
    void seg;
    x += Math.sin(a) * len; y += Math.cos(a) * len; a += 0.07;
  }
  const tip = mesh(new THREE.ConeGeometry(0.022, 0.08, 4), steel, g);
  tip.position.set(x + Math.sin(a) * 0.035, y + Math.cos(a) * 0.035, 0); tip.rotation.z = -a; tip.scale.z = 0.3;
  return g;
}

function harpoon(): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.02, 0.024, 1.75, 8).translate(0, 0.875, 0), mat(0x6a4a2c, 'wood', { r: 0.7 }), g);
  const iron = IRON();
  mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 6).translate(0, 1.9, 0), iron, g);
  const head = mesh(new THREE.ConeGeometry(0.05, 0.18, 4), iron, g); head.position.y = 2.12; head.scale.z = 0.35;
  for (const sx of [-1, 1]) { const barb = bx(g, 0.012, 0.11, 0.012, iron, sx * 0.045, 2.0, 0, 0, 0, sx * 0.6); void barb; }
  // A coil of rope lashed below the head.
  const rope = mat(0xc8b080, 'cloth', { r: 1 });
  for (let i = 0; i < 4; i++) { const r = mesh(new THREE.TorusGeometry(0.03, 0.008, 5, 12), rope, g); r.rotation.x = Math.PI / 2; r.position.y = 1.66 + i * 0.018; }
  return g;
}

function swordfishBlade(): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.18, 8).translate(0, 0.09, 0), grip(), g);
  // The fish's own bill: a long, flat, tapering spike of bone-grey, with a scaly base.
  const bill = std(0x8a9aa8, 0.3, 0.35), scale = std(0x2a4a68, 0.4, 0.4);
  ball(g, v3(0, 0.2, 0), 0.06, scale, 10).scale.set(1.1, 0.6, 0.7);
  const b = mesh(new THREE.ConeGeometry(0.045, 0.95, 6).translate(0, 0.475, 0), bill, g); b.position.y = 0.22; b.scale.z = 0.35;
  for (const sx of [-1, 1]) { const fin = mesh(new THREE.ConeGeometry(0.03, 0.12, 3), scale, g); fin.position.set(sx * 0.07, 0.2, 0); fin.rotation.z = sx * -1.9; fin.scale.z = 0.2; }
  return g;
}

function trident(): THREE.Group {
  const g = new THREE.Group();
  const shaft = std(0x2a7a78, 0.6, 0.3);
  mesh(new THREE.CylinderGeometry(0.02, 0.024, 1.7, 8).translate(0, 0.85, 0), shaft, g);
  const gold = GOLD();
  for (let i = 0; i < 4; i++) { const r = mesh(new THREE.TorusGeometry(0.026, 0.007, 5, 10), gold, g); r.rotation.x = Math.PI / 2; r.position.y = 0.3 + i * 0.4; }
  bx(g, 0.3, 0.035, 0.035, gold, 0, 1.72, 0);
  for (const sx of [-1, 0, 1]) {
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.26, 6).translate(0, 0.13, 0), gold, g).position.set(sx * 0.13, 1.72, 0);
    const tip = mesh(new THREE.ConeGeometry(0.03, 0.12, 4), gold, g); tip.position.set(sx * 0.13, 2.04, 0); tip.scale.z = 0.4;
    if (sx) { const barb = bx(g, 0.01, 0.06, 0.01, gold, sx * 0.105, 1.97, 0, 0, 0, sx * -0.5); void barb; }
  }
  ball(g, v3(0, 1.74, -0.02), 0.03, std(0x60e0ff, 0.2, 0.2, 0x40c0ff, 1.2), 8); // a sea-glass jewel
  return g;
}

function anchor(): THREE.Group {
  const g = new THREE.Group();
  // Held by a length of chain; the anchor itself hangs off the end like a hammer's head.
  const iron = std(0x4a4c50, 0.7, 0.55);
  for (let i = 0; i < 9; i++) { const l = mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 10), iron, g); l.position.y = 0.05 + i * 0.075; l.rotation.y = i % 2 ? Math.PI / 2 : 0; l.scale.y = 1.4; }
  const top = 0.72;
  mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12), iron, g).position.y = top + 0.05; // ring
  mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.8, 8).translate(0, top + 0.48, 0), iron, g); // shank
  bx(g, 0.34, 0.035, 0.035, iron, 0, top + 0.16, 0); // stock, by the ring
  // Arms at the far end (the crown), curving back towards the ring, with flukes pointing back.
  const arm = mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14, Math.PI), iron, g);
  arm.position.y = top + 0.68;
  for (const sx of [-1, 1]) { const fl = mesh(new THREE.ConeGeometry(0.06, 0.14, 3), iron, g); fl.position.set(sx * 0.2, top + 0.64, 0); fl.rotation.z = Math.PI - sx * 0.35; fl.scale.z = 0.35; }
  return g;
}

function jotunbane(): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.03, 0.034, 1.3, 8).translate(0, 0.65, 0), mat(0x2a2018, 'wood', { r: 0.7 }), g);
  const steel = std(0xd0d8e0, 0.9, 0.2), rune = std(0x80d0ff, 0.1, 0.3, 0x60c0ff, 1.6);
  // A huge double-bit head, each bit a half-disc.
  for (const sx of [-1, 1]) {
    const bit = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 16, 1, false, 0, Math.PI), steel, g);
    bit.rotation.set(Math.PI / 2, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2); bit.position.set(sx * 0.04, 1.18, 0);
    bx(g, 0.012, 0.16, 0.03, rune, sx * 0.14, 1.18, 0); // glowing rune line
  }
  bx(g, 0.1, 0.22, 0.07, steel, 0, 1.18, 0);
  const spike = mesh(new THREE.ConeGeometry(0.035, 0.2, 5), steel, g); spike.position.y = 1.4;
  return g;
}

function tentacleWhip(): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.2, 8).translate(0, 0.1, 0), BONE(), g);
  ball(g, v3(0, 0.21, 0), 0.04, GOLD(), 8);
  // The tentacle itself: tapering segments with suckers, swaying out to one side.
  const skin = std(0x8a3a4a, 0.05, 0.5), under = std(0xd89aa0, 0, 0.6);
  let parent: THREE.Object3D = g, r = 0.045;
  for (let i = 0; i < 9; i++) {
    const seg = new THREE.Group(); seg.position.y = i ? 0.13 : 0.22; seg.rotation.z = i ? 0.09 : 0; seg.rotation.x = i ? 0.04 : 0; parent.add(seg);
    mesh(new THREE.CylinderGeometry(r * 0.88, r, 0.14, 7).translate(0, 0.07, 0), skin, seg);
    if (i % 2 === 0) ball(seg, v3(0, 0.07, -r * 0.8), r * 0.35, under, 5);
    parent = seg; r *= 0.86;
  }
  return g;
}

function krakensTrident(): THREE.Group {
  const g = new THREE.Group();
  const coral = std(0xd86a5a, 0.2, 0.5), gold = GOLD(), skin = std(0x8a3a4a, 0.05, 0.5);
  mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.6, 8).translate(0, 0.8, 0), coral, g);
  // A tentacle wound up the shaft.
  for (let i = 0; i < 14; i++) { const a = i * 0.9; ball(g, v3(Math.cos(a) * 0.035, 0.25 + i * 0.085, Math.sin(a) * 0.035), 0.022, skin, 6); }
  bx(g, 0.26, 0.04, 0.04, gold, 0, 1.62, 0);
  for (const sx of [-1, 0, 1]) {
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.24, 6).translate(0, 0.12, 0), gold, g).position.set(sx * 0.11, 1.62, 0);
    const tip = mesh(new THREE.ConeGeometry(0.028, 0.11, 4), gold, g); tip.position.set(sx * 0.11, 1.92, 0); tip.scale.z = 0.4;
  }
  ball(g, v3(0, 1.66, -0.02), 0.04, std(0x3aa8ff, 0.2, 0.2, 0x2a90ff, 1.6), 10); // a bead of living water
  return g;
}

/** A unique weapon's model, or null to use the normal one for its type. */
export function makeUniqueHeld(id: string): THREE.Group | null {
  switch (id) {
    case 'captains_cutlass': return cutlass();
    case 'harpoon': return harpoon();
    case 'swordfish_blade': return swordfishBlade();
    case 'sea_kings_trident': return trident();
    case 'ships_anchor': return anchor();
    case 'jotunbane': return jotunbane();
    case 'tentacle_whip': return tentacleWhip();
    case 'krakens_trident': return krakensTrident();
  }
  return null;
}

// ------------------------------------------------------------------ armour

function pirateHat(): THREE.Group {
  const g = new THREE.Group();
  const felt = std(0x1e1a18, 0, 0.95), gold = GOLD();
  const hat = new THREE.Group(); hat.position.y = 0.085; hat.rotation.x = 0.18; g.add(hat);
  mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.1, 14).translate(0, 0.05, 0), felt, hat); // crown
  mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 3), felt, hat).rotation.y = Math.PI; // triangular brim, a point to the front
  // Three upturned flaps between the points, gold-edged.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2; // flap centres: back, and the two front-sides
    const f = new THREE.Group(); f.rotation.y = a; hat.add(f);
    bx(f, 0.27, 0.085, 0.012, felt, 0, 0.045, 0.1, -0.35, 0, 0);
    bx(f, 0.27, 0.012, 0.016, gold, 0, 0.088, 0.115, -0.35, 0, 0);
  }
  // The Jolly Roger: a little skull and crossbones on the front.
  const s = skull(hat, 0, 0.065, -0.128, 0.9);
  for (const sx of [-1, 1]) bx(s, 0.07, 0.008, 0.006, BONE(), 0, -0.03, 0.006, 0, 0, sx * 0.6);
  return g;
}

function tinyKraken(): THREE.Group {
  // A little kraken sitting on your head, arms draped down round your ears, big eyes looking ahead.
  const g = new THREE.Group();
  const skin = std(0x9a4458, 0.05, 0.5), under = std(0xe0a8b0, 0, 0.6), eyeW = std(0xf8f0d0, 0, 0.4), pupil = std(0x101010, 0, 0.5);
  const body = ball(g, v3(0, 0.19, 0.02), 0.12, skin, 14); body.scale.set(1, 1.15, 1.05);
  ball(g, v3(0, 0.3, 0.06), 0.08, skin, 10).scale.set(0.9, 1.1, 1);
  for (const sx of [-1, 1]) { ball(g, v3(sx * 0.05, 0.2, -0.1), 0.032, eyeW, 8); ball(g, v3(sx * 0.05, 0.2, -0.128), 0.014, pupil, 6); }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const arm = new THREE.Group(); arm.position.set(Math.sin(a) * 0.1, 0.12, Math.cos(a) * 0.1 + 0.02); arm.rotation.y = a; g.add(arm);
    let parent: THREE.Object3D = arm, r = 0.022;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group(); seg.position.y = i ? -0.05 : 0; seg.rotation.x = i ? -0.35 : 1.4; parent.add(seg);
      mesh(new THREE.CylinderGeometry(r * 0.85, r, 0.055, 6).translate(0, -0.027, 0), i % 2 ? under : skin, seg);
      parent = seg; r *= 0.82;
    }
  }
  return g;
}

function barrowCrown(): THREE.Group {
  // The barrow-king's helm: a rusted iron circlet of spikes over the helm.
  const g = new THREE.Group();
  const iron = std(0x5a4a3a, 0.6, 0.7);
  const band = new THREE.Group(); band.position.y = 0.06; band.rotation.x = 0.32; g.add(band);
  const ring = mesh(new THREE.TorusGeometry(0.14, 0.014, 6, 20), iron, band); ring.rotation.x = Math.PI / 2;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const sp = mesh(new THREE.ConeGeometry(0.018, k % 2 ? 0.07 : 0.11, 5), iron, band);
    sp.position.set(Math.sin(a) * 0.14, 0.04, Math.cos(a) * 0.14);
  }
  return g;
}

function shamanHorns(): THREE.Group {
  // Bone horns curling up from the sides, and a band of teeth.
  const g = new THREE.Group();
  const b = BONE();
  for (const sx of [-1, 1]) {
    let x = sx * 0.12, y = 0.05, a = sx * 1.2;
    for (let i = 0; i < 5; i++) {
      const r = 0.028 - i * 0.004;
      const seg = mesh(new THREE.CylinderGeometry(r * 0.85, r, 0.06, 6), b, g);
      seg.position.set(x, y, 0.01); seg.rotation.z = -a;
      x += Math.sin(a) * 0.05; y += Math.cos(a) * 0.05; a -= sx * 0.35;
    }
  }
  for (let k = -3; k <= 3; k++) { const t = mesh(new THREE.ConeGeometry(0.009, 0.035, 4), b, g); t.position.set(k * 0.03, 0.0, -0.135 + Math.abs(k) * 0.006); t.rotation.x = Math.PI; }
  return g;
}

function cauldronLid(): THREE.Group {
  // Knut's belly plate: a big dented iron lid strapped over the gut, with a knob and rivets.
  const g = new THREE.Group();
  const iron = std(0x3a3a3c, 0.7, 0.6);
  const lid = mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.04, 18), iron, g);
  lid.rotation.x = Math.PI / 2; lid.position.set(0, 0.3, -0.17);
  const knob = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.05, 10), iron, g); knob.rotation.x = Math.PI / 2; knob.position.set(0, 0.3, -0.21);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ball(g, v3(Math.cos(a) * 0.17, 0.3 + Math.sin(a) * 0.17, -0.192), 0.011, std(0x8a8a88, 0.8, 0.4), 6); }
  for (const sx of [-1, 1]) bx(g, 0.04, 0.5, 0.3, mat(0x4a3220, 'leather', { r: 0.8 }), sx * 0.2, 0.33, -0.01); // straps
  return g;
}

function chaplainTabard(): THREE.Group {
  // A white tabard over the plate with a teal prayer-ring, and a string of prayer beads.
  const g = new THREE.Group();
  const cloth = std(0xe8e4d8, 0, 0.95), teal = std(0x2a8a88, 0.2, 0.6);
  bx(g, 0.2, 0.62, 0.012, cloth, 0, 0.28, -0.142);
  bx(g, 0.2, 0.025, 0.014, teal, 0, -0.02, -0.143);
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16), teal, g); ring.position.set(0, 0.4, -0.15);
  bx(g, 0.008, 0.08, 0.008, teal, 0, 0.4, -0.15);
  for (let k = 0; k < 9; k++) { const a = -0.5 + k * 0.125; ball(g, v3(Math.sin(a) * 0.22, 0.58 - Math.cos(a) * 0.1 - 0.05, -0.15), 0.012, std(0x6a4a2a, 0.1, 0.5), 6); }
  return g;
}

function kneeSpikes(): THREE.Group {
  // Troll-iron: a heavy knee cap with three blunt spikes.
  const g = new THREE.Group();
  const iron = std(0x3a3c40, 0.7, 0.7);
  ball(g, v3(0, 0, -0.06), 0.07, iron, 8).scale.set(1, 1, 0.7);
  for (const [x, y] of [[0, 0.03], [-0.04, -0.02], [0.04, -0.02]]) { const sp = mesh(new THREE.ConeGeometry(0.018, 0.06, 5), iron, g); sp.position.set(x, y, -0.11); sp.rotation.x = -Math.PI / 2; }
  return g;
}

function wispStuds(): THREE.Group {
  // Blue wisp-light glowing from the knee and down the shin.
  const g = new THREE.Group();
  const glow = std(0x9fe0ff, 0.1, 0.3, 0x60c8ff, 2.2);
  ball(g, v3(0, 0, -0.085), 0.03, glow, 8);
  for (let i = 1; i <= 3; i++) ball(g, v3(0, -i * 0.08, -0.088), 0.014, glow, 6);
  return g;
}

function kingSpikes(): THREE.Group {
  // The Mine King's pauldrons: gold-trimmed, with three tall spikes.
  const g = new THREE.Group();
  const steel = std(0xc0c8d0, 0.85, 0.3), gold = GOLD();
  const rim = mesh(new THREE.TorusGeometry(0.115, 0.016, 6, 18), gold, g); rim.rotation.x = Math.PI / 2; rim.scale.set(1.05, 1.15, 1);
  for (const [x, h] of [[-0.05, 0.12], [0, 0.16], [0.05, 0.12]]) { const sp = mesh(new THREE.ConeGeometry(0.02, h, 5), steel, g); sp.position.set(x, 0.07 + h / 2, 0); }
  return g;
}

/** Hats that replace the normal helm entirely. */
export const REPLACES_HELM = new Set(['captains_hat', 'tiny_kraken']);

/**
 * Put unique armour pieces on a character (and take off the ones it no longer wears). Cheap to
 * call: only rebuilds when the set of worn uniques changes.
 */
export function dressUniques(c: Character, head: string | undefined, chest: string | undefined, legs: string | undefined, shoulders: string | undefined): void {
  const key = `${head}|${chest}|${legs}|${shoulders}`;
  const st = c as Character & { _uniqKey?: string; _uniq?: THREE.Object3D[] };
  if (st._uniqKey === key) return;
  st._uniqKey = key;
  for (const o of st._uniq ?? []) o.parent?.remove(o);
  const added: THREE.Object3D[] = [];
  const put = (parent: THREE.Object3D, o: THREE.Object3D | null) => { if (!o) return; o.traverse((x) => (x.userData.keep = true)); parent.add(o); added.push(o); };
  put(c.head, head === 'captains_hat' ? pirateHat() : head === 'tiny_kraken' ? tinyKraken() : head === 'barrow_helm' ? barrowCrown() : head === 'trollshaman_helm' ? shamanHorns() : null);
  put(c.upper, chest === 'knuts_bellyplate' ? cauldronLid() : chest === 'chaplains_breastplate' ? chaplainTabard() : null);
  for (const l of c.legs) put(l.knee, legs === 'trolliron_greaves' ? kneeSpikes() : legs === 'wisplit_greaves' ? wispStuds() : null);
  if (shoulders === 'mine_kings_pauldrons') for (const p of c.pauldrons) put(p, kingSpikes());
  st._uniq = added;
}
