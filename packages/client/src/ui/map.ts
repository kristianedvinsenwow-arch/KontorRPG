/**
 * The world map (M): terrain painted from the shared height function (once, then cached), with
 * camp, Bjørkvik, mining spots, monster areas, the mine entrance, NPCs, you and other players.
 * Inside the mine it shows the mine's layout instead.
 */
import {
  CAVE, CAVE_ENTRANCE, CAVE_ROOMS, CAVE_TUNNELS, MINING_SPOTS, MOB_AREAS, MOBS, NPCS, VILLAGE, WATER_LEVEL, WORLD_HALF,
  FLAX_FIELDS, GRUBEN, GRUBEN_PASS, GRUBEN_SPOTS, HOMES, VEINS, caveClearance, heightAt, inCaveRegion, regionAt, type Region,
} from '@kontor/shared';

export const mapInfo: { me: { x: number; z: number; yaw: number } | null; others: { x: number; z: number; name: string; color: string }[] } = { me: null, others: [] };

const SIZE = 560;
const painted = new Map<string, HTMLCanvasElement>();
/** Square map area per outdoor region: centre and half-size. */
const AREA: Record<'valley' | 'gruben', { x: number; z: number; half: number }> = {
  valley: { x: 0, z: 0, half: WORLD_HALF },
  gruben: { x: GRUBEN.x, z: GRUBEN.z, half: GRUBEN.half },
};
let cave: HTMLCanvasElement | null = null;

function paintTerrain(r: 'valley' | 'gruben'): HTMLCanvasElement {
  const A = AREA[r];
  const c = document.createElement('canvas');
  const N = 280;
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = A.x - A.half + (i / N) * A.half * 2, z = A.z - A.half + (j / N) * A.half * 2;
    const h = heightAt(x, z), hx = heightAt(x + 1, z);
    const shade = 1 + (hx - h) * 0.12;
    let col: [number, number, number];
    if (h < WATER_LEVEL) col = [58 + h * 3, 98 + h * 4, 122 + h * 2];
    else if (h < 0.8) col = [166, 150, 118];
    else if (r === 'gruben' && h < 20) col = [100 + h * 2, 102 + h, 78];
    else if (h < 14) col = [95 + h * 2, 125 + h, 70];
    else if (h < (r === 'gruben' ? 26 : 20)) col = [124, 122, 116];
    else col = [226, 232, 236];
    const k = (j * N + i) * 4;
    img.data[k] = Math.min(255, col[0] * shade); img.data[k + 1] = Math.min(255, col[1] * shade); img.data[k + 2] = Math.min(255, col[2] * shade); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const X0 = -30, X1 = 45, Z0 = -96, Z1 = 14;
function paintCave(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const N = 220;
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = CAVE.x + X0 + (i / N) * (X1 - X0), z = CAVE.z + Z0 + (j / N) * (Z1 - Z0);
    const inside = caveClearance(x, z) > 0;
    const k = (j * N + i) * 4;
    img.data.set(inside ? [92, 86, 78, 255] : [22, 20, 18, 255], k);
  }
  g.putImageData(img, 0, 0);
  void CAVE_ROOMS; void CAVE_TUNNELS;
  return c;
}

export function drawMap(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mapwrap';
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.className = 'map';
  const g = c.getContext('2d')!;
  const region: Region = mapInfo.me ? regionAt(mapInfo.me.x, mapInfo.me.z) : 'valley';
  const under = region === 'cave';
  let toPx: (x: number, z: number) => [number, number];
  if (under) {
    cave ??= paintCave();
    g.imageSmoothingEnabled = true;
    g.drawImage(cave, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x - CAVE.x - X0) / (X1 - X0)) * SIZE, ((z - CAVE.z - Z0) / (Z1 - Z0)) * SIZE];
    for (const r of CAVE_ROOMS) { const [px, py] = toPx(CAVE.x + r.c[0], CAVE.z + r.c[1]); label(g, r.name, px, py, '#e8dcc0'); }
  } else {
    const r = region as 'valley' | 'gruben', A = AREA[r];
    if (!painted.has(r)) painted.set(r, paintTerrain(r));
    g.drawImage(painted.get(r)!, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x - A.x + A.half) / (A.half * 2)) * SIZE, ((z - A.z + A.half) / (A.half * 2)) * SIZE];
    const mark = (x: number, z: number, text: string, color: string, r = 5) => { const [px, py] = toPx(x, z); g.fillStyle = color; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); label(g, text, px, py - r - 4, '#fff'); };
    const here = (x: number, z: number) => regionAt(x, z) === r;
    if (r === 'valley') {
      mark(0, 0, 'Camp', '#f2a23a', 7);
      mark(VILLAGE.x, VILLAGE.z, 'Bjørkvik', '#f2a23a', 7);
      for (const s of MINING_SPOTS) mark(s.x, s.z, `⛏ ${s.name}`, '#b0b4bc');
      mark(CAVE_ENTRANCE.x, CAVE_ENTRANCE.z, 'The Old Mine (lv 5–12)', '#b77be8', 6);
      mark(GRUBEN_PASS.x, GRUBEN_PASS.z, 'Pass to Gruben (monsters lv 13–22)', '#b77be8', 6);
      for (const f of FLAX_FIELDS) mark(f.x, f.z, '✿ Flax', '#7a9ae8', 4);
    } else {
      const S = GRUBEN_SPOTS;
      mark(GRUBEN.x + S.arrival.x, GRUBEN.z + S.arrival.z, 'Gruben camp', '#f2a23a', 7);
      mark(GRUBEN.x + S.pit.x, GRUBEN.z + S.pit.z, 'The pit — the Mine King (lv 22)', '#b77be8', 7);
      for (const v of VEINS) if (here(v.x, v.z) && (v.type === 'silver' || v.type === 'coal')) { const [px, py] = toPx(v.x, v.z); g.fillStyle = v.type === 'coal' ? '#222' : '#e8eef4'; g.fillRect(px - 2, py - 2, 4, 4); }
    }
    for (const a of MOB_AREAS) if (here(a.x, a.z)) mark(a.x, a.z, `${a.name} (lv ${MOBS[a.kind].level})`, '#e8554e');
    for (const h of HOMES) if (h.house && here(h.house.x, h.house.z)) { const [px, py] = toPx(h.house.x, h.house.z); g.fillStyle = '#c8a070'; g.fillRect(px - 3, py - 3, 6, 6); }
    for (const n of NPCS) { if (!here(n.x, n.z)) continue; const [px, py] = toPx(n.x, n.z); g.fillStyle = '#ffe9a8'; g.fillRect(px - 2, py - 2, 4, 4); }
  }
  for (const o of mapInfo.others) {
    if (regionAt(o.x, o.z) !== region) continue;
    const [px, py] = toPx(o.x, o.z);
    g.fillStyle = o.color; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill();
    label(g, o.name, px, py - 8, o.color);
  }
  if (mapInfo.me) {
    const [px, py] = toPx(mapInfo.me.x, mapInfo.me.z);
    g.save(); g.translate(px, py); g.rotate(-mapInfo.me.yaw);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  wrap.append(c);
  return wrap;
}

/** Metres from the centre of the minimap to its edge. */
const MINI_R = 42;
/**
 * The round minimap in the corner: north up, centred on you. Terrain, veins, NPCs, monsters (red),
 * other players (their colour) and you (the arrow).
 */
export function drawMinimap(c: HTMLCanvasElement, mobs: { x: number; z: number; boss?: boolean }[]): void {
  const g = c.getContext('2d')!;
  const S = c.width, R = S / 2;
  g.clearRect(0, 0, S, S);
  if (!mapInfo.me) return;
  const me = mapInfo.me, region: Region = regionAt(me.x, me.z);
  g.save();
  g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
  const k = R / MINI_R; // px per metre
  const toPx = (x: number, z: number): [number, number] => [R + (x - me.x) * k, R + (z - me.z) * k];
  if (region === 'cave') {
    cave ??= paintCave();
    const sx = cave.width / (X1 - X0), sz = cave.height / (Z1 - Z0);
    g.fillStyle = '#16140f'; g.fillRect(0, 0, S, S);
    g.drawImage(cave, (me.x - CAVE.x - X0 - MINI_R) * sx, (me.z - CAVE.z - Z0 - MINI_R) * sz, MINI_R * 2 * sx, MINI_R * 2 * sz, 0, 0, S, S);
  } else {
    const r = region as 'valley' | 'gruben', A = AREA[r];
    if (!painted.has(r)) painted.set(r, paintTerrain(r));
    const img = painted.get(r)!, px = img.width / (A.half * 2);
    g.fillStyle = '#2a3a2a'; g.fillRect(0, 0, S, S);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, (me.x - MINI_R - A.x + A.half) * px, (me.z - MINI_R - A.z + A.half) * px, MINI_R * 2 * px, MINI_R * 2 * px, 0, 0, S, S);
  }
  const near = (x: number, z: number) => Math.abs(x - me.x) < MINI_R + 2 && Math.abs(z - me.z) < MINI_R + 2 && regionAt(x, z) === region;
  for (const v of VEINS) if (near(v.x, v.z)) { const [x, y] = toPx(v.x, v.z); g.fillStyle = v.type === 'coal' ? '#222' : v.type === 'silver' ? '#e8eef4' : v.type === 'iron' ? '#c08a6a' : '#9a9a9a'; g.fillRect(x - 2.5, y - 2.5, 5, 5); }
  for (const n of NPCS) if (near(n.x, n.z)) { const [x, y] = toPx(n.x, n.z); g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  for (const m of mobs) if (near(m.x, m.z)) { const [x, y] = toPx(m.x, m.z); g.fillStyle = '#e8554e'; g.beginPath(); g.arc(x, y, m.boss ? 5 : 3, 0, Math.PI * 2); g.fill(); }
  for (const o of mapInfo.others) if (near(o.x, o.z)) { const [x, y] = toPx(o.x, o.z); g.fillStyle = o.color; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.stroke(); }
  g.restore();
  // You: an arrow in the middle, pointing where you look.
  g.save(); g.translate(R, R); g.rotate(-me.yaw);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(236,231,218,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ece7da'; g.font = '700 11px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.fillText('N', R, 12);
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  g.font = '600 12px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}

export function mapTitle(): string {
  const r = mapInfo.me ? regionAt(mapInfo.me.x, mapInfo.me.z) : 'valley';
  return r === 'cave' ? 'The Old Mine' : r === 'gruben' ? 'Gruben — the old mine valley' : 'Mofjellet and Bjørkvik';
}
