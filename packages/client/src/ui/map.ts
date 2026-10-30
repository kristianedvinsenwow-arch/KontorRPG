/**
 * The world map (M): terrain painted from the shared height function (once, then cached), with
 * camp, Bjørkvik, mining spots, monster areas, the mine entrance, NPCs, you and other players.
 * Inside the mine it shows the mine's layout instead.
 */
import {
  CAVE, CAVE_ENTRANCE, CAVE_ROOMS, CAVE_TUNNELS, MINING_SPOTS, MOB_AREAS, MOBS, NPCS, VILLAGE, WATER_LEVEL, WORLD_HALF,
  caveClearance, heightAt, inCaveRegion,
} from '@kontor/shared';

export const mapInfo: { me: { x: number; z: number; yaw: number } | null; others: { x: number; z: number; name: string; color: string }[] } = { me: null, others: [] };

const SIZE = 560;
let terrain: HTMLCanvasElement | null = null;
let cave: HTMLCanvasElement | null = null;

function paintTerrain(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const N = 280;
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -WORLD_HALF + (i / N) * WORLD_HALF * 2, z = -WORLD_HALF + (j / N) * WORLD_HALF * 2;
    const h = heightAt(x, z), hx = heightAt(x + 1, z);
    const shade = 1 + (hx - h) * 0.12;
    let col: [number, number, number];
    if (h < WATER_LEVEL) col = [58 + h * 3, 98 + h * 4, 122 + h * 2];
    else if (h < 0.8) col = [166, 150, 118];
    else if (h < 14) col = [95 + h * 2, 125 + h, 70];
    else if (h < 20) col = [124, 122, 116];
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
  const under = mapInfo.me ? inCaveRegion(mapInfo.me.x, mapInfo.me.z) : false;
  let toPx: (x: number, z: number) => [number, number];
  if (under) {
    cave ??= paintCave();
    g.imageSmoothingEnabled = true;
    g.drawImage(cave, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x - CAVE.x - X0) / (X1 - X0)) * SIZE, ((z - CAVE.z - Z0) / (Z1 - Z0)) * SIZE];
    for (const r of CAVE_ROOMS) { const [px, py] = toPx(CAVE.x + r.c[0], CAVE.z + r.c[1]); label(g, r.name, px, py, '#e8dcc0'); }
  } else {
    terrain ??= paintTerrain();
    g.drawImage(terrain, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE];
    const mark = (x: number, z: number, text: string, color: string, r = 5) => { const [px, py] = toPx(x, z); g.fillStyle = color; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); label(g, text, px, py - r - 4, '#fff'); };
    mark(0, 0, 'Camp', '#f2a23a', 7);
    mark(VILLAGE.x, VILLAGE.z, 'Bjørkvik', '#f2a23a', 7);
    for (const s of MINING_SPOTS) mark(s.x, s.z, `⛏ ${s.name}`, '#b0b4bc');
    for (const a of MOB_AREAS) mark(a.x, a.z, `${a.name} (lv ${MOBS[a.kind].level})`, '#e8554e');
    mark(CAVE_ENTRANCE.x, CAVE_ENTRANCE.z, 'The Old Mine (lv 5–12)', '#b77be8', 6);
    for (const n of NPCS) { const [px, py] = toPx(n.x, n.z); g.fillStyle = '#ffe9a8'; g.fillRect(px - 2, py - 2, 4, 4); }
  }
  for (const o of mapInfo.others) {
    if (inCaveRegion(o.x, o.z) !== under) continue;
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

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  g.font = '600 12px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
