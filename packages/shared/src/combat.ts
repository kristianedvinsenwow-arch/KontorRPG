/**
 * Combat rules shared by server (authority) and client (cooldowns, tooltips, predictions).
 * Left click: basic attack at the weapon's pace. Right click: the weapon's special on a 5–20 s
 * cooldown; longer cooldowns hit harder.
 */
import { ITEMS, weaponHit, type Stack, type WeaponClass } from './items.js';
import { reduction, type Stats } from './stats.js';

export type Style = 'melee' | 'ranged' | 'magic';

export interface Special {
  name: string;
  cd: number;
  mult: number;
  kind: 'single' | 'spin' | 'shot' | 'ignite' | 'nova';
  radius?: number;
  blurb: string;
}

export const SPECIALS: Record<WeaponClass | 'fists', Special> = {
  fists: { name: 'Shove', cd: 6, mult: 1.5, kind: 'single', blurb: 'A hard shove.' },
  sword: { name: 'Heavy Strike', cd: 8, mult: 2.5, kind: 'single', blurb: '2.5× damage.' },
  longsword: { name: 'Whirlwind', cd: 12, mult: 2, kind: 'spin', radius: 3.6, blurb: 'Spin: 2× damage to everything within 3.6 m.' },
  battleaxe: { name: 'Executioner', cd: 18, mult: 4, kind: 'single', blurb: '4× damage to one target.' },
  bow: { name: 'Power Shot', cd: 10, mult: 3, kind: 'shot', blurb: '3× damage arrow.' },
  staff: { name: 'Bonk', cd: 6, mult: 1.8, kind: 'single', blurb: 'A clumsy two-handed bonk.' },
  fireStaff: { name: 'Ignite', cd: 12, mult: 0.45, kind: 'ignite', radius: 22, blurb: 'Every burning enemy within 22 m takes 45% of a firebolt per burn stack (up to 135% at 3 stacks).' },
  frostStaff: { name: 'Frost Nova', cd: 15, mult: 0.8, kind: 'nova', radius: 6, blurb: 'Freeze everything within 6 m for 2.5 s.' },
};

/** Burn: per stack, per second, as a share of one firebolt. 3 stacks ≈ as much damage as the bolts themselves. */
export const BURN = { maxStacks: 3, perStackPerSec: 0.16, sec: 4 };
export const SLOW = { pct: 0.25, sec: 3 };
export const FREEZE_SEC = 2.5;
export const PROJECTILE_SPEED = 30;
/** No eating to heal for this long after taking damage (no food mid-fight). */
export const EAT_LOCK_MS = 10_000;

export function weaponClass(main: Stack | undefined): WeaponClass | 'fists' {
  return (main && ITEMS[main.id]?.weapon) || 'fists';
}

export function styleOf(c: WeaponClass | 'fists'): Style {
  return c === 'bow' ? 'ranged' : c === 'fireStaff' || c === 'frostStaff' ? 'magic' : 'melee';
}

export function attackRange(main: Stack | undefined): number {
  return (main && ITEMS[main.id]?.range) || 2.2;
}

export function attackInterval(main: Stack | undefined): number {
  return (main && ITEMS[main.id]?.interval) || 1.4;
}

export const specialCooldown = (c: WeaponClass | 'fists', s: Stats) => SPECIALS[c].cd * (1 - Math.min(0.4, s.cdr));

/** Outgoing damage before the target's armour: weapon hit × style bonus (+arrow damage). */
export function outgoing(main: Stack | undefined, ammo: Stack | undefined, s: Stats, special: number): number {
  const c = weaponClass(main);
  const style = styleOf(c);
  let base = weaponHit(main);
  if (c === 'bow') base += ammo ? ITEMS[ammo.id]?.ammoDmg ?? 0 : 0;
  const bonus = 1 + s.allDmg + (style === 'melee' ? s.meleeDmg : style === 'ranged' ? s.rangedDmg : s.magicDmg) + (special > 1 ? s.specialDmg : 0);
  return base * Math.max(0.1, bonus) * special;
}

/** After the target's armour (physical) or ward (magic). */
export const mitigate = (dmg: number, magic: boolean, armour: number, ward: number) => dmg * (1 - reduction(magic ? ward : armour));

/** Damage a player takes from a hit, after armour, reductions and metal's magic penalty. */
export function incoming(dmg: number, magic: boolean, s: Stats): number {
  if (magic) return dmg * (1 - reduction(s.ward)) * (1 - Math.min(0.6, s.magicRed)) * (1 + s.magicTaken);
  return dmg * (1 - reduction(s.armour)) * (1 - Math.min(0.6, s.physRed));
}
