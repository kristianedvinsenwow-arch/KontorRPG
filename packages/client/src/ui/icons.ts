/**
 * Item icons, painted once on a canvas and cached as data URLs — no image assets to ship.
 * Each kind of item has a simple silhouette; its `look` picks the colours.
 */
import { ITEMS, RARITY, type Stack } from '@kontor/shared';

const LOOK: Record<string, [string, string]> = {
  stone: ['#9b978e', '#5f5c56'],
  iron: ['#a6acb4', '#565b63'],
  silver: ['#e2e6ec', '#8a9098'],
  birch: ['#e2dccb', '#9c927c'],
  pine: ['#a4774a', '#5e4228'],
  leather: ['#9a7148', '#5c4026'],
  cloth: ['#8a7cb0', '#4e4470'],
  bone: ['#ece4cc', '#a49a7c'],
};
const cache = new Map<string, string>();
type G = CanvasRenderingContext2D;

function poly(g: G, pts: [number, number][], fill: string, stroke = 'rgba(0,0,0,.55)') {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
}
const line = (g: G, c: string, w: number, pts: [number, number][]) => {
  g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
};
const dot = (g: G, x: number, y: number, r: number, c: string) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

function lump(g: G, base: string, shade: string, flecks?: string) {
  poly(g, [[14, 40], [10, 28], [20, 16], [34, 12], [48, 20], [54, 34], [46, 48], [26, 52]], base);
  poly(g, [[26, 52], [46, 48], [54, 34], [40, 38], [28, 44]], shade, 'transparent');
  if (flecks) for (const [x, y, r] of [[24, 28, 4], [38, 24, 3], [34, 38, 4], [20, 40, 3]]) dot(g, x, y, r, flecks);
}
function gem(g: G, a: string, b: string) {
  poly(g, [[32, 8], [52, 26], [32, 56], [12, 26]], a);
  poly(g, [[32, 8], [52, 26], [32, 30]], b, 'transparent');
  poly(g, [[12, 26], [32, 30], [32, 56]], 'rgba(0,0,0,.2)', 'transparent');
  g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(24, 18, 4, 4);
}
function bar(g: G, a: string, b: string) {
  poly(g, [[10, 42], [18, 26], [50, 26], [56, 42]], a);
  poly(g, [[10, 42], [56, 42], [54, 46], [12, 46]], b);
}
function log(g: G, a: string, b: string) {
  poly(g, [[10, 26], [48, 18], [54, 34], [16, 42]], a);
  g.fillStyle = '#e8d2a4'; g.beginPath(); g.ellipse(51, 26, 5, 8, -0.2, 0, Math.PI * 2); g.fill(); g.strokeStyle = b; g.lineWidth = 2; g.stroke();
  line(g, b, 1.5, [[18, 30], [40, 25]]);
}
function fish(g: G, a: string, b: string, cooked = false) {
  g.fillStyle = a; g.beginPath(); g.ellipse(30, 32, 18, 9, -0.2, 0, Math.PI * 2); g.fill();
  poly(g, [[46, 28], [58, 20], [56, 40]], b);
  dot(g, 20, 29, 2.2, '#111');
  if (cooked) for (const x of [26, 32, 38]) line(g, '#5a3010', 2, [[x, 25], [x - 3, 38]]);
}
function pick(g: G, head: string) { line(g, '#7a5a3a', 6, [[16, 54], [42, 18]]); poly(g, [[22, 8], [44, 14], [58, 30], [46, 20], [26, 16]], head); }
function hatchet(g: G, head: string) { line(g, '#7a5a3a', 6, [[18, 56], [40, 14]]); poly(g, [[36, 10], [54, 14], [56, 30], [40, 24]], head); }
function rod(g: G, c: string) { line(g, c, 4, [[12, 56], [52, 10]]); line(g, '#ddd', 1, [[52, 10], [56, 40]]); dot(g, 18, 48, 5, '#555'); }
function sword(g: G, blade: string, long = false) {
  const tip: [number, number] = long ? [54, 6] : [48, 12];
  poly(g, [tip, [tip[0] + 6, tip[1] + 3], [26, 40], [22, 36]], blade);
  line(g, '#6a5434', 5, [[16, 34], [30, 48]]);
  line(g, '#3a2818', 5, [[22, 42], [10, 54]]);
}
function axe(g: G, head: string) {
  line(g, '#7a5a3a', 5, [[14, 58], [46, 8]]);
  poly(g, [[34, 10], [52, 4], [58, 22], [44, 28]], head);
  poly(g, [[28, 18], [18, 12], [16, 28], [30, 30]], head);
}
function bow(g: G, c: string) {
  g.strokeStyle = c; g.lineWidth = 5; g.beginPath(); g.arc(14, 32, 30, -1.05, 1.05); g.stroke();
  line(g, '#e8e0c8', 1.5, [[29, 6], [29, 58]]);
}
function staff(g: G, c: string, orb?: string) {
  line(g, c, 5, [[14, 58], [46, 14]]);
  dot(g, 48, 12, orb ? 8 : 5, orb ?? c);
  if (orb) dot(g, 46, 10, 3, 'rgba(255,255,255,.7)');
}
function armourPiece(g: G, slot: string, a: string, b: string) {
  switch (slot) {
    case 'head': g.fillStyle = a; g.beginPath(); g.arc(32, 36, 18, Math.PI, 0); g.lineTo(50, 40); g.lineTo(14, 40); g.fill(); g.strokeStyle = b; g.lineWidth = 2; g.stroke(); g.fillStyle = b; g.fillRect(30, 36, 4, 12); break;
    case 'shoulders': g.beginPath(); g.ellipse(32, 36, 22, 16, 0, Math.PI, 0); g.fillStyle = a; g.fill(); g.strokeStyle = b; g.stroke(); g.fillStyle = b; g.fillRect(10, 38, 44, 6); break;
    case 'chest': poly(g, [[14, 12], [24, 8], [32, 14], [40, 8], [50, 12], [52, 30], [46, 54], [18, 54], [12, 30]], a); line(g, b, 2, [[32, 16], [32, 50]]); break;
    case 'legs': poly(g, [[16, 10], [48, 10], [50, 56], [36, 56], [32, 24], [28, 56], [14, 56]], a); break;
    case 'hands': poly(g, [[18, 54], [18, 26], [24, 14], [30, 26], [34, 12], [40, 26], [46, 18], [48, 54]], a); break;
    case 'feet': poly(g, [[14, 14], [30, 14], [32, 40], [54, 44], [54, 54], [14, 54]], a); break;
    case 'offHand': poly(g, [[32, 6], [54, 14], [50, 40], [32, 58], [14, 40], [10, 14]], a); dot(g, 32, 28, 6, b); break;
    default: poly(g, [[16, 16], [48, 16], [48, 48], [16, 48]], a);
  }
}
function bag(g: G, a: string, big: boolean) {
  const w = big ? 40 : 32, x = 32 - w / 2;
  poly(g, [[x, 22], [x + w, 22], [x + w + 2, 54], [x - 2, 54]], a);
  poly(g, [[x - 1, 20], [x + w + 1, 20], [x + w - 2, 34], [x + 2, 34]], '#4a3420');
  g.strokeStyle = '#3a2818'; g.lineWidth = 3; g.beginPath(); g.arc(32, 20, 8, Math.PI, 0); g.stroke();
}
function arrows(g: G, head: string) {
  for (const dx of [-8, 0, 8]) { line(g, '#c8b48a', 3, [[18 + dx, 56], [42 + dx, 12]]); poly(g, [[42 + dx, 12], [46 + dx, 4], [47 + dx, 14]], head); }
}

/** Data URL for an item's icon. */
export function iconFor(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const d = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const [a, b] = LOOK[d?.look ?? 'stone'] ?? LOOK.stone;
  const special: Record<string, () => void> = {
    stone: () => lump(g, '#9b978e', '#6f6b64'),
    iron_ore: () => lump(g, '#6a5a50', '#4a3e38', '#b0602e'),
    silver_ore: () => lump(g, '#7a7a80', '#55555c', '#e8eef4'),
    quartz: () => gem(g, '#ece6f2', '#ffffff'),
    sapphire: () => gem(g, '#3d64d8', '#7fa3ff'),
    garnet: () => gem(g, '#a8202c', '#e85a66'),
    shaped_stone: () => { poly(g, [[12, 24], [36, 14], [54, 22], [54, 42], [30, 52], [12, 42]], '#a19d94'); poly(g, [[30, 32], [54, 22], [54, 42], [30, 52]], '#6f6b64', 'transparent'); },
    coins: () => { for (const [x, y] of [[24, 40], [36, 36], [30, 28]]) { dot(g, x, y, 11, '#f2cc5a'); dot(g, x, y, 7, '#d8a830'); } },
    small_rucksack: () => bag(g, '#7a5a3a', false),
    leather_backpack: () => bag(g, '#6b4a2c', true),
    arrow_shaft: () => { for (const dx of [-8, 0, 8]) line(g, '#c8b48a', 3, [[18 + dx, 56], [42 + dx, 10]]); },
    stone_arrowheads: () => { for (const [x, y] of [[20, 24], [40, 20], [30, 42]]) poly(g, [[x, y - 10], [x + 7, y + 6], [x - 7, y + 6]], '#8d8a84'); },
    iron_arrowheads: () => { for (const [x, y] of [[20, 24], [40, 20], [30, 42]]) poly(g, [[x, y - 10], [x + 7, y + 6], [x - 7, y + 6]], '#a6acb4'); },
    burnt_fish: () => fish(g, '#2a2420', '#1a1412'),
    old_boot: () => armourPiece(g, 'feet', '#5a4a36', '#3a2a1a'),
    golden_perch: () => fish(g, '#f2cc5a', '#d8a030'),
    wolf_pelt: () => poly(g, [[12, 20], [26, 12], [40, 14], [54, 22], [50, 50], [30, 56], [14, 46]], '#8a8478'),
    goblin_trinket: () => { dot(g, 32, 36, 14, '#c8a040'); dot(g, 32, 36, 6, '#4a8a3a'); line(g, '#6a5434', 2, [[32, 22], [32, 8]]); },
    bat_wing: () => poly(g, [[8, 20], [56, 14], [50, 30], [42, 26], [36, 40], [28, 30], [18, 42]], '#4a3a40'),
    troll_tooth: () => poly(g, [[24, 10], [40, 10], [44, 30], [32, 56], [22, 30]], '#ece4cc'),
    trolltooth_necklace: () => { g.strokeStyle = '#6a5434'; g.lineWidth = 3; g.beginPath(); g.arc(32, 24, 18, 0, Math.PI); g.stroke(); poly(g, [[28, 40], [36, 40], [34, 58], [30, 58]], '#ece4cc'); },
  };
  if (special[id]) special[id]();
  else if (d?.kind === 'bar') bar(g, a, b);
  else if (d?.kind === 'log') log(g, a, b);
  else if (d?.kind === 'fish') fish(g, '#8aa0a8', '#5a7078');
  else if (d?.kind === 'food') fish(g, '#c8884a', '#8a5428', true);
  else if (d?.kind === 'ammo') arrows(g, a);
  else if (d?.tool === 'pickaxe') pick(g, a);
  else if (d?.tool === 'hatchet') hatchet(g, a);
  else if (d?.tool === 'rod') rod(g, a);
  else if (d?.weapon === 'sword') sword(g, a);
  else if (d?.weapon === 'longsword') sword(g, a, true);
  else if (d?.weapon === 'battleaxe') axe(g, a);
  else if (d?.weapon === 'bow') bow(g, a);
  else if (d?.weapon === 'staff') staff(g, a);
  else if (d?.weapon === 'fireStaff') staff(g, a, '#ff7a2a');
  else if (d?.weapon === 'frostStaff') staff(g, a, '#8fd8ff');
  else if (d?.slot) armourPiece(g, d.slot, a, b);
  else { g.fillStyle = '#555'; g.fillRect(16, 16, 32, 32); }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}

export const rarityColor = (s: Pick<Stack, 'id' | 'r'>) => RARITY[s.r ?? ITEMS[s.id]?.fixedRarity ?? 0].color;
