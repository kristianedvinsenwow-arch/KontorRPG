/**
 * The world map (M): terrain painted from the shared height function (once, then cached), with
 * camp, Bjørkvik, mining spots, monster areas, the mine entrance, NPCs, you and other players.
 * Inside the mine it shows the mine's layout instead.
 */
import {
  CAVE, CAVE_ENTRANCE, CAVE_ROOMS, GROTTO, GROTTO_ROOMS, GROTTO_ENTRANCE, caveAt, inGrottoPool, type CaveId, MINING_SPOTS, MOB_AREAS, MOBS, NPCS, VILLAGE, WATER_LEVEL, WORLD_HALF,
  ZONES, ZONE_LINKS, type ZonePlan, FLAX_FIELDS, GRUBEN, GRUBEN_PASS, GRUBEN_SPOTS, FJORD, FJORD_SPOTS, PORTAL_BY_ID, SHIPWRECK, FORD_Z, fjordMid, HOMES, VEINS, STONE_QUARRIES, MANOR, caveClearance, heightAt, inCaveRegion, regionAt, type Region,
} from '@kontor/shared';

export const mapInfo: { me: { x: number; z: number; yaw: number } | null; others: { x: number; z: number; name: string; color: string }[] } = { me: null, others: [] };

const SIZE = 560;
const painted = new Map<string, HTMLCanvasElement>();
/** Square map area per outdoor region: centre and half-size. */
const AREA: Record<'valley' | 'gruben' | 'fjord', { x: number; z: number; half: number }> = {
  valley: { x: 0, z: 0, half: WORLD_HALF },
  gruben: { x: GRUBEN.x, z: GRUBEN.z, half: GRUBEN.half },
  fjord: { x: FJORD.x, z: FJORD.z, half: FJORD.half },
};
type Outdoor = keyof typeof AREA;
const caves = new Map<CaveId, HTMLCanvasElement>();

function paintTerrain(r: Outdoor): HTMLCanvasElement {
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

/** The underground place you're in: its origin, the painted bounds, and its named chambers. */
const CAVE_MAPS: Record<CaveId, { O: { x: number; z: number }; X0: number; X1: number; Z0: number; Z1: number; rooms: { c: [number, number]; name: string }[]; title: string }> = {
  mine: { O: CAVE, X0: -30, X1: 45, Z0: -96, Z1: 14, rooms: CAVE_ROOMS, title: 'The Old Mine' },
  grotto: { O: GROTTO, X0: -36, X1: 36, Z0: -108, Z1: 14, rooms: GROTTO_ROOMS, title: 'Sjøgrotta — the Sea Grotto' },
};
const whichCave = (): CaveId => (mapInfo.me && caveAt(mapInfo.me.x, mapInfo.me.z)) || 'mine';
function paintCave(id: CaveId): HTMLCanvasElement {
  const { O, X0, X1, Z0, Z1 } = CAVE_MAPS[id];
  const c = document.createElement('canvas');
  const N = 220;
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = O.x + X0 + (i / N) * (X1 - X0), z = O.z + Z0 + (j / N) * (Z1 - Z0);
    const inside = caveClearance(x, z) > 0, water = id === 'grotto' && inGrottoPool(x, z);
    const k = (j * N + i) * 4;
    img.data.set(water ? [48, 150, 150, 255] : inside ? (id === 'grotto' ? [70, 88, 96, 255] : [92, 86, 78, 255]) : [22, 20, 18, 255], k);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** What the map shows: your zone (or one you clicked), or the whole world. Reset each time it opens. */
const view: { world: boolean; zone: Region | null } = { world: false, zone: null };
export function resetMapView(): void { view.world = false; view.zone = null; }
const hereRegion = (): Region => (mapInfo.me ? regionAt(mapInfo.me.x, mapInfo.me.z) : 'valley');

/** The map panel: right click zooms out to the world; click a zone there to zoom back in. */
export function drawMap(rerender: () => void): HTMLElement {
  const el = view.world ? drawWorld(rerender) : drawZone(view.zone ?? hereRegion());
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); view.world = !view.world; rerender(); });
  const hint = document.createElement('p');
  hint.className = 'note';
  hint.textContent = view.world ? 'Click a zone to look at it · right click to go back' : 'Right click to zoom out to the whole world';
  el.append(hint);
  return el;
}

/** Overview of every zone (built and planned), laid out as in the world plan, with the ways between them. */
function drawWorld(rerender: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mapwrap';
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.className = 'map';
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a2026'; g.fillRect(0, 0, SIZE, SIZE);
  const pad = 14, cw = (SIZE - pad * 2) / 3, rh = [150, 190, 170], ry = [pad, pad + rh[0], pad + rh[0] + rh[1]];
  const rect = (z: ZonePlan) => ({ x: pad + z.col * cw + 4, y: ry[z.row] + 4, w: z.w * cw - 8, h: rh[z.row] - 8 });
  const here = hereRegion();
  const outdoorHere = here === 'cave' ? 'valley' : here;
  for (const z of ZONES) {
    const r = rect(z), built = !!z.region;
    if (built) {
      const reg = z.region as Outdoor;
      if (!painted.has(reg)) painted.set(reg, paintTerrain(reg));
      g.save(); g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 8); g.clip();
      const img = painted.get(reg)!, side = Math.max(r.w, r.h);
      g.drawImage(img, r.x + (r.w - side) / 2, r.y + (r.h - side) / 2, side, side);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(r.x, r.y, r.w, r.h);
      g.restore();
    } else {
      g.fillStyle = '#262c32'; g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
    }
    g.strokeStyle = z.region === outdoorHere ? '#f2a23a' : built ? 'rgba(236,231,218,.6)' : 'rgba(236,231,218,.18)';
    g.lineWidth = z.region === outdoorHere ? 3 : 1.5; g.setLineDash(built ? [] : [6, 5]);
    g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke(); g.setLineDash([]);
    g.textAlign = 'center';
    g.fillStyle = built ? '#f2a23a' : '#6a7078'; g.font = '800 28px "Saira Condensed", sans-serif';
    g.fillText(String(z.tier), r.x + r.w / 2, r.y + r.h / 2 - 6);
    label(g, z.name, r.x + r.w / 2, r.y + r.h / 2 + 18, built ? '#fff' : '#8a9098');
    g.font = '400 11px "IBM Plex Mono", monospace'; g.fillStyle = built ? '#d8d4c8' : '#6a7078';
    z.blurb.split(' · ').forEach((line, i) => { g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(line, r.x + r.w / 2, r.y + r.h / 2 + 36 + i * 14); g.fillText(line, r.x + r.w / 2, r.y + r.h / 2 + 36 + i * 14); });
    if (z.region === outdoorHere) label(g, '● you are here', r.x + r.w / 2, r.y + 18, '#f2a23a');
  }
  // The ways between zones: a short arrow across the shared edge.
  for (const [a, b] of ZONE_LINKS) {
    const A = rect(ZONES.find((z) => z.id === a)!), B = rect(ZONES.find((z) => z.id === b)!);
    const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
    // Midpoint of the shared edge, nudged towards the overlap of the two boxes.
    const ox = Math.max(A.x, B.x) + (Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)) / 2;
    const oy = Math.max(A.y, B.y) + (Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)) / 2;
    const horiz = Math.abs(bx - ax) > Math.abs(by - ay) && Math.min(A.y + A.h, B.y + B.h) > Math.max(A.y, B.y);
    const mx = horiz ? (ax < bx ? A.x + A.w + 4 : A.x - 4) : ox, my = horiz ? oy : (ay < by ? A.y + A.h + 4 : A.y - 4);
    const dx = horiz ? Math.sign(bx - ax) : 0, dy = horiz ? 0 : Math.sign(by - ay);
    g.strokeStyle = '#f2a23a'; g.fillStyle = '#f2a23a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(mx - dx * 12, my - dy * 12); g.lineTo(mx + dx * 8, my + dy * 8); g.stroke();
    g.beginPath(); g.moveTo(mx + dx * 14, my + dy * 14); g.lineTo(mx + dx * 4 - dy * 7, my + dy * 4 + dx * 7); g.lineTo(mx + dx * 4 + dy * 7, my + dy * 4 - dx * 7); g.closePath(); g.fill();
  }
  c.addEventListener('click', (e) => {
    const b = c.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * SIZE, y = ((e.clientY - b.top) / b.height) * SIZE;
    const z = ZONES.find((zz) => { const r = rect(zz); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; });
    if (!z?.region) return; // planned zones can't be opened yet
    view.world = false; view.zone = z.region; rerender();
  });
  c.style.cursor = 'pointer';
  wrap.append(c);
  return wrap;
}

function drawZone(region: Region): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mapwrap';
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.className = 'map';
  const g = c.getContext('2d')!;
  const under = region === 'cave';
  let toPx: (x: number, z: number) => [number, number];
  if (under) {
    const id = whichCave(), M = CAVE_MAPS[id];
    if (!caves.has(id)) caves.set(id, paintCave(id));
    g.imageSmoothingEnabled = true;
    g.drawImage(caves.get(id)!, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x - M.O.x - M.X0) / (M.X1 - M.X0)) * SIZE, ((z - M.O.z - M.Z0) / (M.Z1 - M.Z0)) * SIZE];
    for (const r of M.rooms) { const [px, py] = toPx(M.O.x + r.c[0], M.O.z + r.c[1]); label(g, r.name, px, py, '#e8dcc0'); }
  } else {
    const r = region as Outdoor, A = AREA[r];
    if (!painted.has(r)) painted.set(r, paintTerrain(r));
    g.drawImage(painted.get(r)!, 0, 0, SIZE, SIZE);
    toPx = (x, z) => [((x - A.x + A.half) / (A.half * 2)) * SIZE, ((z - A.z + A.half) / (A.half * 2)) * SIZE];
    const mark = (x: number, z: number, text: string, color: string, r = 5) => { const [px, py] = toPx(x, z); g.fillStyle = color; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); label(g, text, px, py - r - 4, '#fff'); };
    const here = (x: number, z: number) => regionAt(x, z) === r;
    if (r === 'valley') {
      mark(VILLAGE.x, VILLAGE.z, 'Bjørkvik', '#f2a23a', 7);
      mark(MANOR.x, MANOR.z, 'Lakeside Manor', '#e8c46a', 6);
      for (const s of MINING_SPOTS) mark(s.x, s.z, `⛏ ${s.name} (iron, coal)`, '#b0b4bc');
      for (const q of STONE_QUARRIES) mark(q.x, q.z, '⛏ Stone (mountain quarry)', '#d8d8d0');
      mark(CAVE_ENTRANCE.x, CAVE_ENTRANCE.z, 'The Old Mine (lv 5–12)', '#b77be8', 6);
      mark(GRUBEN_PASS.x, GRUBEN_PASS.z, 'Pass to Gruben (monsters lv 13–22)', '#b77be8', 6);
      for (const f of FLAX_FIELDS) mark(f.x, f.z, '✿ Flax', '#7a9ae8', 4);
      { const b = PORTAL_BY_ID.get('fjord')!.at; mark(b.x, b.z, 'Rowboat to Saltfjorden (sea fishing)', '#b77be8', 5); }
    } else if (r === 'fjord') {
      mark(FJORD.x + FJORD_SPOTS.village.x, FJORD.z + FJORD_SPOTS.village.z, 'Fishing village', '#f2a23a', 7);
      { const b = PORTAL_BY_ID.get('fjord_out')!.at; mark(b.x, b.z, 'Rowboat to Bjørkvik', '#b77be8', 5); }
      mark(SHIPWRECK.x, SHIPWRECK.z, 'The wreck — the Drowned Captain (lv 15)', '#b77be8', 6);
      mark(GROTTO_ENTRANCE.x, GROTTO_ENTRANCE.z, 'Sjøgrotta — sea cave, lv 14–18, the Kraken', '#b77be8', 6);
      mark(FJORD.x + fjordMid(FORD_Z), FJORD.z + FORD_Z, 'The ford', '#d8c890', 4);
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
  if (mapInfo.me && regionAt(mapInfo.me.x, mapInfo.me.z) === region) {
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
    const id = caveAt(me.x, me.z) ?? 'mine', M = CAVE_MAPS[id];
    if (!caves.has(id)) caves.set(id, paintCave(id));
    const img = caves.get(id)!;
    const sx = img.width / (M.X1 - M.X0), sz = img.height / (M.Z1 - M.Z0);
    g.fillStyle = '#16140f'; g.fillRect(0, 0, S, S);
    g.drawImage(img, (me.x - M.O.x - M.X0 - MINI_R) * sx, (me.z - M.O.z - M.Z0 - MINI_R) * sz, MINI_R * 2 * sx, MINI_R * 2 * sz, 0, 0, S, S);
  } else {
    const r = region as Outdoor, A = AREA[r];
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
  if (view.world) return 'The world — zones by the order you reach them';
  const r = view.zone ?? hereRegion();
  return r === 'cave' ? CAVE_MAPS[whichCave()].title : r === 'gruben' ? 'Gruben — the old mine valley' : r === 'fjord' ? 'Saltfjorden — the fishing fjord' : 'Mofjellet and Bjørkvik';
}
