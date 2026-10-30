/**
 * Item icons, painted once on a canvas and cached as data URLs — no image assets to ship.
 * Each kind has a simple silhouette; tier picks the colour.
 */
import { ITEMS } from '@kontor/shared';

const TIER: Record<string, [string, string]> = {
  stone: ['#9b978e', '#5f5c56'],
  iron: ['#a6acb4', '#565b63'],
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

function lump(g: G, base: string, shade: string, flecks?: string) {
  poly(g, [[14, 40], [10, 28], [20, 16], [34, 12], [48, 20], [54, 34], [46, 48], [26, 52]], base);
  poly(g, [[26, 52], [46, 48], [54, 34], [40, 38], [28, 44]], shade, 'transparent');
  if (flecks) for (const [x, y, r] of [[24, 28, 4], [38, 24, 3], [34, 38, 4], [20, 40, 3]]) { g.fillStyle = flecks; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
}

function gem(g: G, a: string, b: string) {
  poly(g, [[32, 8], [52, 26], [32, 56], [12, 26]], a);
  poly(g, [[32, 8], [52, 26], [32, 30]], b, 'transparent');
  poly(g, [[12, 26], [32, 30], [32, 56]], 'rgba(0,0,0,.2)', 'transparent');
  g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(24, 18, 4, 4);
}

function pick(g: G, head: string) {
  g.strokeStyle = '#7a5a3a'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(16, 54); g.lineTo(42, 18); g.stroke();
  poly(g, [[22, 8], [44, 14], [58, 30], [46, 20], [26, 16]], head);
}

function sword(g: G, blade: string) {
  poly(g, [[44, 8], [52, 10], [26, 40], [22, 36]], blade);
  g.strokeStyle = '#6a5434'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(16, 34); g.lineTo(30, 48); g.stroke();
  g.strokeStyle = '#3a2818'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(22, 42); g.lineTo(12, 52); g.stroke();
}

function pauldron(g: G, a: string, b: string) {
  g.beginPath(); g.ellipse(32, 36, 22, 16, 0, Math.PI, 0); g.lineTo(54, 42); g.lineTo(10, 42); g.closePath();
  g.fillStyle = a; g.fill(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = b; g.fillRect(10, 40, 44, 6);
  for (const x of [18, 32, 46]) { g.fillStyle = '#d8c48a'; g.beginPath(); g.arc(x, 30, 2.4, 0, Math.PI * 2); g.fill(); }
}

function bag(g: G, a: string, big: boolean) {
  const w = big ? 40 : 32, x = 32 - w / 2;
  poly(g, [[x, 22], [x + w, 22], [x + w + 2, 54], [x - 2, 54]], a);
  poly(g, [[x - 1, 20], [x + w + 1, 20], [x + w - 2, 34], [x + 2, 34]], '#4a3420');
  g.strokeStyle = '#3a2818'; g.lineWidth = 3; g.beginPath(); g.arc(32, 20, 8, Math.PI, 0); g.stroke();
  g.fillStyle = '#c8a860'; g.fillRect(30, 32, 4, 5);
}

function bar(g: G, a: string, b: string) {
  poly(g, [[10, 42], [18, 26], [50, 26], [56, 42]], a);
  poly(g, [[18, 26], [50, 26], [46, 32], [22, 32]], 'rgba(255,255,255,.25)', 'transparent');
  poly(g, [[10, 42], [56, 42], [54, 46], [12, 46]], b);
}

/** Data URL for an item's icon. */
export function iconFor(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const [a, b] = TIER[def?.tier ?? 'stone'] ?? TIER.stone;
  switch (id) {
    case 'stone': lump(g, '#9b978e', '#6f6b64'); break;
    case 'iron_ore': lump(g, '#6a5a50', '#4a3e38', '#b0602e'); break;
    case 'quartz': gem(g, '#ece6f2', '#ffffff'); break;
    case 'sapphire': gem(g, '#3d64d8', '#7fa3ff'); break;
    case 'shaped_stone': poly(g, [[12, 24], [36, 14], [54, 22], [54, 42], [30, 52], [12, 42]], '#a19d94'); poly(g, [[30, 32], [54, 22], [54, 42], [30, 52]], '#6f6b64', 'transparent'); break;
    case 'iron_bar': bar(g, a, b); break;
    case 'small_rucksack': bag(g, '#7a5a3a', false); break;
    case 'leather_backpack': bag(g, '#6b4a2c', true); break;
    default:
      if (def?.slot === 'tool') pick(g, a);
      else if (def?.kind === 'weapon') sword(g, a);
      else if (def?.slot === 'shoulders') pauldron(g, a, b);
      else { g.fillStyle = '#555'; g.fillRect(16, 16, 32, 32); }
  }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
