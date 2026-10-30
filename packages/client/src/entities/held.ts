/**
 * Models for things you hold: pickaxes and swords per tier. All built along +Y from the grip end
 * (like makePickaxe), so the hand and first-person grip code work for every item.
 */
import * as THREE from 'three';
import { ITEMS } from '@kontor/shared';
import { mat, mesh, bx } from '../engine/procgen.js';
import { makePickaxe, GEAR_COLORS, setHeld, setShoulders, type Character } from './character.js';
import type { PlayerState } from '@kontor/shared';

function headMat(tier: string | undefined): THREE.Material {
  const g = GEAR_COLORS[tier ?? 'stone'] ?? GEAR_COLORS.stone;
  return tier === 'stone' ? mat(g.color, 'rock', { r: g.rough }) : new THREE.MeshStandardMaterial({ color: g.color, metalness: g.metal, roughness: g.rough });
}

export function makeSword(tier: string | undefined): THREE.Group {
  const g = new THREE.Group();
  const grip = mat(0x3a2818, 'leather', { r: 0.7 });
  const guardM = new THREE.MeshStandardMaterial({ color: 0x6a5434, metalness: 0.4, roughness: 0.5 });
  const blade = headMat(tier);
  mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.16, 8).translate(0, 0.08, 0), grip, g);
  mesh(new THREE.SphereGeometry(0.032, 8, 6), guardM, g).position.y = -0.01;
  bx(g, 0.2, 0.03, 0.05, guardM, 0, 0.17, 0);
  if (tier === 'stone') {
    // A knapped stone blade: wide, faceted, a little crude.
    const b = mesh(new THREE.CylinderGeometry(0.0, 0.055, 0.62, 4, 1).translate(0, 0.5, 0), blade, g);
    b.scale.set(1, 1, 0.35);
    b.rotation.y = Math.PI / 4;
  } else {
    const b = mesh(new THREE.BoxGeometry(0.06, 0.6, 0.012).translate(0, 0.48, 0), blade, g);
    void b;
    const tip = mesh(new THREE.ConeGeometry(0.043, 0.1, 4).translate(0, 0.83, 0), blade, g);
    tip.scale.set(1, 1, 0.28);
    tip.rotation.y = Math.PI / 4;
  }
  return g;
}

/** A pickaxe in the tier's material. */
export function makeTieredPickaxe(tier: string | undefined): THREE.Group {
  const g = makePickaxe();
  if (tier && tier !== 'stone') {
    const m = headMat(tier);
    g.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh && o.userData.metal) mm.material = m;
    });
  }
  return g;
}

/** The held model for an item id, or null if it isn't something you hold. */
export function makeHeld(id: string | undefined): THREE.Group | null {
  const def = id ? ITEMS[id] : undefined;
  if (!def) return null;
  if (def.slot === 'tool') return makeTieredPickaxe(def.tier);
  if (def.kind === 'weapon') return makeSword(def.tier);
  return null;
}

/** What a character shows in hand: the tool if one is equipped, otherwise the main-hand weapon. */
export function heldOf(gear: PlayerState['gear']): string | undefined {
  return gear?.t ?? gear?.m;
}

/** Dress a character model from visible gear (cheap to call every snapshot: only changes rebuild). */
export function applyGear(c: Character, gear: PlayerState['gear']): void {
  const held = heldOf(gear);
  if (held !== c.heldId) setHeld(c, makeHeld(held), held);
  const sh = gear?.s ? (ITEMS[gear.s]?.tier ?? null) : null;
  if (c.userData_sh !== sh) { setShoulders(c, sh as keyof typeof GEAR_COLORS | null); c.userData_sh = sh; }
  c.pack.visible = !!gear?.b;
  c.pack.scale.setScalar(gear?.b === 'leather_backpack' ? 1.22 : 1);
}
