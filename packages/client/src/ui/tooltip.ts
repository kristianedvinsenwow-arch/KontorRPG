/**
 * Item tooltips: name in its rarity colour, type, combat/tool numbers, armour, effects, food, the
 * blurb and what the trader pays. One floating element follows the mouse.
 */
import {
  ARMOUR_PIECES, ITEMS, KIND_LABEL, RARITY, SPECIALS, formatStat, itemStats, weaponHit, type Stack, type StatKey,
} from '@kontor/shared';

const tip = document.createElement('div');
tip.id = 'tooltip';
tip.hidden = true;
document.body.append(tip);

const SLOT_LABEL: Record<string, string> = {
  mainHand: 'Main hand', offHand: 'Off hand', head: 'Head', shoulders: 'Shoulders', chest: 'Body', legs: 'Legs', hands: 'Hands', feet: 'Feet',
  back: 'Back', neck: 'Neck', ring: 'Ring', pickaxe: 'Pickaxe', hatchet: 'Hatchet', rod: 'Fishing rod', ammo: 'Ammo',
};

function row(text: string, cls = ''): HTMLElement {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  return d;
}

export function itemTip(s: Stack, sellMult = 1): HTMLElement[] {
  const d = ITEMS[s.id];
  if (!d) return [row(s.id)];
  const r = s.r ?? d.fixedRarity ?? 0;
  const out: HTMLElement[] = [];
  const name = row(s.qty > 1 ? `${d.name} ×${s.qty}` : d.name, 'tname');
  name.style.color = RARITY[r].color;
  out.push(name);
  const type = [r ? RARITY[r].name : '', d.armourType ? `${d.armourType[0].toUpperCase()}${d.armourType.slice(1)}` : '', KIND_LABEL[d.kind], d.slot ? `· ${SLOT_LABEL[d.slot] ?? d.slot}` : '', d.tier ? `· tier ${d.tier}` : ''].filter(Boolean).join(' ');
  out.push(row(type, 'ttype'));
  if (d.weapon) {
    const hit = weaponHit(s);
    out.push(row(`${Math.round(hit * 10) / 10} damage per hit · every ${d.interval}s (${Math.round((hit / (d.interval ?? 1.6)) * 10) / 10} DPS)`, 'tmain'));
    out.push(row(`Reach ${d.range} m${d.twoHanded ? ' · two-handed' : ''}`, 'tdim'));
    const sp = SPECIALS[d.weapon];
    out.push(row(`Right click — ${sp.name}: ${sp.blurb} ${sp.cd}s cooldown.`, 'tspecial'));
  }
  if (d.tool) {
    if (d.swingSec) out.push(row(`Power ${d.power} · ${d.swingSec}s per swing at level 1`, 'tmain'));
    else out.push(row(`Power ${d.power}`, 'tmain'));
  }
  if (d.ammoDmg) out.push(row(`+${d.ammoDmg} damage per arrow`, 'tmain'));
  // Base armour/ward and side effects (metal slows, leather speeds), then rolled effects.
  const base = itemStats({ id: s.id, qty: 1, r: s.r });
  for (const [k, v] of Object.entries(base) as [StatKey, number][]) {
    const rolled = (s.fx ?? []).find(([fk]) => fk === k);
    const left = v - (rolled ? rolled[1] : 0);
    if (left) out.push(row(formatStat(k, left), left < 0 ? 'tneg' : 'tbase'));
  }
  for (const [k, v] of s.fx ?? []) out.push(row(formatStat(k, v), 'tfx'));
  if (d.food) {
    out.push(row(`Eat: heals ${d.food.heal} HP`, 'tmain'));
    if (d.food.buff) out.push(row(`${d.food.buff.name}, ${Math.round(d.food.buff.sec / 60)} min: ${Object.entries(d.food.buff.stats).map(([k, v]) => formatStat(k as StatKey, v as number)).join(', ')}`, 'tfx'));
  }
  if (d.bagSlots) out.push(row(`+${d.bagSlots} bag slots`, 'tmain'));
  out.push(row(d.blurb, 'tblurb'));
  const value = d.sellValue > 0 ? Math.max(1, Math.round(d.sellValue * (1 + r * 0.5) * sellMult)) : 0;
  out.push(row(value ? `Trader pays ${value} g${s.qty > 1 ? ` each (${value * s.qty} g)` : ''}` : 'The trader won’t buy this', 'tvalue'));
  if (d.buyPrice) out.push(row(`Ingrid sells it for ${d.buyPrice} g`, 'tdim'));
  return out;
}

void ARMOUR_PIECES;

let current: HTMLElement | null = null;

/** Show `content()` while the mouse is over `el`. */
export function attachTip(el: HTMLElement, content: () => HTMLElement[] | null): void {
  el.addEventListener('mouseenter', () => {
    const c = content();
    if (!c) return;
    tip.replaceChildren(...c);
    tip.hidden = false;
    current = el;
  });
  el.addEventListener('mouseleave', () => { if (current === el) { tip.hidden = true; current = null; } });
}

export const hideTip = () => { tip.hidden = true; current = null; };

addEventListener('mousemove', (e) => {
  if (tip.hidden) return;
  if (current && !current.isConnected) { hideTip(); return; }
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const x = e.clientX + 16 + w > innerWidth ? e.clientX - w - 12 : e.clientX + 16;
  const y = Math.min(innerHeight - h - 8, e.clientY + 12);
  tip.style.transform = `translate(${x}px, ${y}px)`;
});
