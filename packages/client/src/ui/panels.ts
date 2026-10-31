/**
 * Game panels: gear + bag in the character sheet (C / I), skills (K), talents (T), crafting at a
 * station (E), NPC dialogs (E: trader, quests, the inn and its storage chest, the imbuer), and the
 * world map (M). They only ever send requests; what you own changes when the server answers.
 */
import {
  ACHIEVEMENTS, titleOf, COMING_SKILLS, EQUIP_SLOTS, HOMES, IMBUE, INN, ITEMS, homeLabel, type Home, NPC_BY_ID, QUESTS, RECIPES, SKILLS, STATION_BY_ID, TALENT_TREE, TREES,
  canLearn, computeStats, xpMult, MAX_LEVEL, countItem, knifeRepair, knifeUses, recipeGroup, formatStat, levelFromXp, levelProgress, pointsLeft, questAvailable, recipeAt, respecCost, xpForLevel,
  type ClientMsg, type Stack, type StatKey, type TreeId,
} from '@kontor/shared';
import { gameStore, settingsStore, uiStore, type GameState } from '../state/store.js';
import { iconFor, rarityColor } from './icons.js';
import { attachTip, hideTip, itemTip } from './tooltip.js';
import { drawMap, mapTitle } from './map.js';

const $ = (id: string) => document.getElementById(id)!;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const btn = (text: string, cls = 'btn', onClick?: () => void) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.onclick = onClick; return b; };

export function icon(s: Stack, opts: { qty?: boolean } = {}): HTMLElement {
  const box = el('div', 'icon');
  const img = el('img');
  img.src = iconFor(s.id); img.alt = ITEMS[s.id]?.name ?? s.id; img.draggable = false;
  box.append(img);
  if ((s.r ?? ITEMS[s.id]?.fixedRarity ?? 0) > 0) box.style.boxShadow = `inset 0 0 0 2px ${rarityColor(s)}`;
  if (opts.qty !== false && s.qty > 1) box.append(el('span', 'qty', String(s.qty)));
  return box;
}

// ------------------------------------------------------------------ right-click menu

const menu = el('div');
menu.id = 'ctxmenu';
menu.hidden = true;
document.body.append(menu);
addEventListener('mousedown', (e) => { if (!menu.contains(e.target as Node)) menu.hidden = true; });

function contextMenu(e: MouseEvent, items: [string, () => void][]) {
  e.preventDefault();
  hideTip();
  menu.replaceChildren(...items.map(([t, f]) => btn(t, 'ctx', () => { menu.hidden = true; f(); })));
  menu.hidden = false;
  menu.style.transform = `translate(${Math.min(e.clientX, innerWidth - 170)}px, ${Math.min(e.clientY, innerHeight - items.length * 32 - 10)}px)`;
}

// ------------------------------------------------------------------ the bag grid

type BagMode = { kind: 'bag' } | { kind: 'shop'; npc: string } | { kind: 'storage' };

export function initPanels(send: (m: ClientMsg) => void, onClose: () => void, sellMult: () => number) {
  const root = $('gamePanel');
  const card = $('gameCard');

  function bagGrid(g: GameState, mode: BagMode): HTMLElement {
    const grid = el('div', 'bag');
    g.bag.forEach((s, i) => {
      const cell = el('button', 'cell');
      cell.type = 'button';
      if (!s) { cell.disabled = true; grid.append(cell); return; }
      const d = ITEMS[s.id];
      cell.append(icon(s));
      attachTip(cell, () => itemTip(s, sellMult()));
      const actions: [string, () => void][] = [];
      if (d?.food) actions.push(['Eat', () => send({ t: 'eat', index: i })]);
      if (d?.potion) actions.push(['Drink', () => send({ t: 'eat', index: i })]);
      if (d?.slot) actions.push(['Equip', () => send({ t: 'equip', index: i })]);
      if (mode.kind === 'shop' && d?.sellValue) { actions.push(['Sell one', () => send({ t: 'sell', npc: mode.npc, index: i, qty: 1 })]); if (s.qty > 1) actions.push([`Sell all ${s.qty}`, () => send({ t: 'sell', npc: mode.npc, index: i, qty: s.qty })]); }
      if (mode.kind === 'storage') actions.push([s.qty > 1 ? `Put all ${s.qty} in chest` : 'Put in chest', () => send({ t: 'storage', op: 'put', index: i, qty: s.qty })]);
      actions.push([s.qty > 1 ? 'Drop one' : 'Drop', () => send({ t: 'drop', index: i, qty: 1 })]);
      if (s.qty > 1) actions.push([`Drop all ${s.qty}`, () => send({ t: 'drop', index: i, qty: s.qty })]);
      // Left click does the obvious thing; right click shows everything.
      cell.onclick = (e) => {
        if (mode.kind === 'shop' && d?.sellValue) return send({ t: 'sell', npc: mode.npc, index: i, qty: e.shiftKey ? s.qty : 1 });
        if (mode.kind === 'storage') return send({ t: 'storage', op: 'put', index: i, qty: s.qty });
        if (d?.food || d?.potion) return send({ t: 'eat', index: i });
        if (d?.slot) return send({ t: 'equip', index: i });
        contextMenu(e, actions);
      };
      cell.oncontextmenu = (e) => contextMenu(e, actions);
      grid.append(cell);
    });
    return grid;
  }

  function goldLine(g: GameState): HTMLElement {
    const d = el('div', 'goldline');
    d.append(el('span', 'gold', `${g.gold} g`), el('span', 'note', `Bag ${g.bag.filter(Boolean).length} / ${g.bag.length}`));
    return d;
  }

  function header(title: string, sub: string, closeKey: string): HTMLElement {
    const h = el('div', 'phead');
    const t = el('div');
    t.append(el('div', 'eyebrow', sub), el('h2', '', title));
    h.append(t, btn(`Close (${closeKey})`, 'btn ghost', () => uiStore.set({ panel: 'none' })));
    return h;
  }

  // ---------------------------------------------------------------- character sheet: gear + bag

  function inventory(g: GameState): HTMLElement[] {
    const eq = el('div', 'gear');
    for (const { slot, label } of EQUIP_SLOTS) {
      const st = g.equip[slot];
      const b = el('button', st ? 'gslot worn' : 'gslot');
      b.type = 'button';
      if (st) {
        b.append(icon(st));
        attachTip(b, () => [...itemTip(st, sellMult()), el('div', 'tdim', 'Click to take off.')]);
        b.onclick = () => send({ t: 'unequip', slot });
      } else b.disabled = true;
      b.append(el('span', '', label));
      eq.append(b);
    }
    return [el('div', 'lbl', 'Equipment'), eq, goldLine(g), bagGrid(g, { kind: 'bag' }),
      el('p', 'note', 'Click gear to wear it, food to eat it. Right-click for more (drop). Hover for details.')];
  }

  // ---------------------------------------------------------------- skills

  /** Compact skill list for the left side of the character sheet. */
  function skillList(g: GameState): HTMLElement[] {
    const list = el('div', 'skills compact');
    for (const s of SKILLS) {
      const xp = g.xp[s.id] ?? 0, lvl = levelFromXp(xp);
      const row = el('div', 'skill');
      const top = el('div', 'srow');
      top.append(el('b', '', s.name), el('span', 'lvl', `${lvl}`));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(levelProgress(xp) * 100)}%`;
      bar.append(fill);
      row.append(top, bar);
      attachTip(row, () => [el('div', 'tname', `${s.name} · level ${lvl}`), el('div', 'tdim', `${xp.toLocaleString('en')} XP · ${(xpForLevel(lvl + 1) - xp).toLocaleString('en')} to level ${lvl + 1}`), el('div', '', s.blurb)]);
      list.append(row);
    }
    return [el('div', 'eyebrow', 'Skills'), list, el('p', 'note', `Every level gives a talent point (T). Coming later: ${COMING_SKILLS.join(', ')}.`)];
  }

  function skills(g: GameState): HTMLElement[] {
    const list = el('div', 'skills');
    for (const s of SKILLS) {
      const xp = g.xp[s.id] ?? 0, lvl = levelFromXp(xp);
      const row = el('div', 'skill');
      const top = el('div', 'srow');
      top.append(el('b', '', s.name), el('span', 'lvl', `Level ${lvl}`));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(levelProgress(xp) * 100)}%`;
      bar.append(fill);
      row.append(top, bar, el('p', 'note', `${xp.toLocaleString('en')} XP · ${(xpForLevel(lvl + 1) - xp).toLocaleString('en')} to level ${lvl + 1}. ${s.blurb}`));
      list.append(row);
    }
    list.append(el('p', 'note', `Coming later: ${COMING_SKILLS.join(', ')}.`));
    return [header('Skills', 'Every level gives a talent point (T)', 'K'), list];
  }

  // ---------------------------------------------------------------- talents

  let tree: TreeId = 'mining';
  // ---------------------------------------------------------------- achievements

  function achievements(g: GameState): HTMLElement[] {
    const a = g.ach;
    const body = el('div', 'pbody');
    // Title picker.
    const earned = ACHIEVEMENTS.filter((x) => x.title && a.done.includes(x.id));
    const tbox = el('div', 'titles');
    tbox.append(el('div', 'lbl', 'Your title (shown under your name)'));
    const row = el('div', 'ract');
    row.append(btn('None', a.title ? 'btn ghost' : 'btn', () => send({ t: 'title', id: null })));
    for (const x of earned) row.append(btn(x.title!, a.title === x.id ? 'btn' : 'btn ghost', () => send({ t: 'title', id: x.id })));
    if (!earned.length) row.append(el('span', 'note', 'Earn an achievement with a title to wear it.'));
    tbox.append(row);
    body.append(tbox);
    for (const group of ['Gathering', 'Crafting', 'Combat', 'Life'] as const) {
      const list = el('div', 'achs');
      list.append(el('div', 'lbl', group));
      for (const x of ACHIEVEMENTS.filter((y) => y.group === group)) {
        const have = Math.min(a.c[x.key] ?? 0, x.goal), done = a.done.includes(x.id);
        const r = el('div', done ? 'ach done' : 'ach');
        const info = el('div', 'rinfo');
        info.append(el('b', '', `${done ? '★ ' : ''}${x.name}`), el('span', 'note', `${x.text}${x.title ? ` Title: “${x.title}”.` : ''}`));
        const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = `${(have / x.goal) * 100}%`; bar.append(fill);
        const prog = el('div', 'aprog'); prog.append(el('span', 'note', `${have.toLocaleString('en')} / ${x.goal.toLocaleString('en')}`), bar);
        r.append(info, prog);
        list.append(r);
      }
      body.append(list);
    }
    return [header('Achievements', `${a.done.length} of ${ACHIEVEMENTS.length} earned`, 'J'), body];
  }

  function talents(g: GameState): HTMLElement[] {
    const tabs = el('div', 'tabs');
    for (const t of TREES) {
      const left = pointsLeft(g.talents, g.xp, t.id);
      const b = btn(`${t.name}${left > 0 ? ` (${left})` : ''}`, t.id === tree ? 'tab on' : 'tab', () => { tree = t.id; render(); });
      tabs.append(b);
    }
    const T = TALENT_TREE[tree];
    const left = pointsLeft(g.talents, g.xp, tree);
    const alloc = g.talents[tree] ?? {};
    const W = 560, H = 470, cx = (x: number) => W / 2 + x * 120, cy = (y: number) => 50 + y * 100;
    const board = el('div', 'tree');
    board.style.width = `${W}px`; board.style.height = `${H}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const n of T.nodes) for (const r of n.req) {
      const p = T.nodes.find((x) => x.id === r)!;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(cx(p.x))); line.setAttribute('y1', String(cy(p.y)));
      line.setAttribute('x2', String(cx(n.x))); line.setAttribute('y2', String(cy(n.y)));
      line.setAttribute('class', (alloc[p.id] ?? 0) >= p.ranks ? 'on' : '');
      svg.append(line);
    }
    board.append(svg);
    for (const n of T.nodes) {
      const have = alloc[n.id] ?? 0;
      const why = canLearn(g.talents, g.xp, tree, n.id);
      const b = el('button', `node r${n.ranks}${have >= n.ranks ? ' max' : have ? ' some' : ''}${!why ? ' can' : ''}`);
      b.type = 'button';
      b.style.left = `${cx(n.x)}px`; b.style.top = `${cy(n.y)}px`;
      b.append(el('b', '', n.name), el('span', '', `${have}/${n.ranks}`));
      attachTip(b, () => [
        el('div', 'tname', n.name),
        el('div', 'ttype', n.ranks === 1 ? 'Notable — one point' : 'Three ranks'),
        ...Object.entries(n.fx).map(([k, v]) => el('div', 'tfx', `${formatStat(k as StatKey, v as number)}${n.ranks > 1 ? ' per rank' : ''}`)),
        el('div', 'tdim', why ?? 'Click to learn.'),
      ]);
      b.onclick = () => send({ t: 'talent', tree, node: n.id });
      board.append(b);
    }
    const foot = el('div', 'tfoot');
    const spent = Object.values(alloc).reduce((a, b) => a + b, 0);
    foot.append(el('span', 'note', `${left} point${left === 1 ? '' : 's'} to spend · ${T.skill === 'combat' ? 'combat trees share points from your player level' : `from ${T.name} levels`}`));
    if (spent) foot.append(btn(`Reset tree (${respecCost(g.respecs)} g)`, 'btn ghost', () => send({ t: 'respec', tree })));
    return [header('Talents', 'Max a node to unlock the ones below it', 'T'), tabs, board, foot];
  }

  // ---------------------------------------------------------------- crafting

  const want = new Map<string, number>();
  const craftTab = new Map<string, string>();
  function craft(g: GameState, stationId: string): HTMLElement[] {
    const st = STATION_BY_ID.get(stationId)!;
    const list = el('div', 'recipes');
    // Tabs by material tier or food type, so long recipe lists stay short.
    const here = RECIPES.filter((x) => recipeAt(x, st.kind));
    const groups = [...new Set(here.map(recipeGroup))];
    const tab = groups.includes(craftTab.get(st.kind) ?? '') ? craftTab.get(st.kind)! : groups[0];
    const tabs = el('div', 'tabs');
    if (groups.length > 1) for (const gname of groups) {
      const n = here.filter((r) => recipeGroup(r) === gname && levelFromXp(g.xp[r.skill] ?? 0) >= r.level && r.inputs.every((i) => countItem(g.bag, i.item) >= i.qty)).length;
      tabs.append(btn(n ? `${gname} (${n})` : gname, gname === tab ? 'tab on' : 'tab', () => { craftTab.set(st.kind, gname); render(); }));
    }
    // Skill progress at the top: where you are in the level, and how far to the next.
    const ps = computeStats(settingsStore.get().build, g.equip, g.talents, g.xp, g.buffs);
    const prog = el('div', 'craftskills');
    for (const sk of [...new Set(here.map((r) => r.skill))]) {
      const xp = g.xp[sk] ?? 0, lvl = levelFromXp(xp);
      const name = sk[0].toUpperCase() + sk.slice(1);
      const row = el('div', 'skill');
      const top = el('div', 'srow');
      const max = lvl >= MAX_LEVEL;
      const a = xpForLevel(lvl), b = xpForLevel(lvl + 1);
      top.append(el('b', '', `${name} ${lvl}`), el('span', 'note', max ? 'Max level' : `${(xp - a).toLocaleString('en')} / ${(b - a).toLocaleString('en')} XP · ${(b - xp).toLocaleString('en')} to level ${lvl + 1}`));
      const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = `${Math.round(levelProgress(xp) * 100)}%`; bar.append(fill);
      row.append(top, bar);
      prog.append(row);
    }
    /** How many more of this recipe to the next level (with your XP bonuses). */
    const moreFor = (r: (typeof here)[number]) => {
      const xp = g.xp[r.skill] ?? 0, lvl = levelFromXp(xp);
      if (lvl >= MAX_LEVEL) return '';
      const per = Math.max(1, Math.round(r.xp * xpMult(ps, r.skill)));
      const n = Math.ceil((xpForLevel(lvl + 1) - xp) / per);
      return ` · ${n} more for level ${lvl + 1}`;
    };
    for (const r of here.filter((x) => recipeGroup(x) === tab)) {
      const lvl = levelFromXp(g.xp[r.skill] ?? 0);
      const can = Math.min(...r.inputs.map((i) => Math.floor(countItem(g.bag, i.item) / i.qty)));
      const locked = lvl < r.level;
      const row = el('div', locked ? 'recipe locked' : 'recipe');
      const out = ITEMS[r.output.item];
      const info = el('div', 'rinfo');
      const skillName = r.skill[0].toUpperCase() + r.skill.slice(1);
      info.append(el('b', '', r.output.qty > 1 ? `${out.name} ×${r.output.qty}` : out.name), el('span', 'note', `${skillName} ${r.level} · ${Math.max(1, Math.round(r.xp * xpMult(ps, r.skill)))} XP${locked ? '' : moreFor(r)} · ${r.seconds}s${out.slot && out.kind !== 'ammo' ? ' · can roll a rarity' : ''}${r.burns ? ' · can burn' : ''}`));
      const ins = el('div', 'inputs');
      for (const i of r.inputs) {
        const have = countItem(g.bag, i.item);
        const chip = el('span', have >= i.qty ? 'in ok' : 'in short');
        chip.append(icon({ id: i.item, qty: 1 }), el('span', '', `${have}/${i.qty} ${ITEMS[i.item].name}`));
        ins.append(chip);
      }
      info.append(ins);
      const act = el('div', 'ract');
      const n = el('input');
      n.type = 'number'; n.min = '1'; n.max = '100';
      n.value = String(Math.max(1, Math.min(want.get(r.id) ?? Math.max(1, can), 100)));
      n.oninput = () => want.set(r.id, Number(n.value) || 1);
      n.onkeydown = (e) => e.stopPropagation();
      const go = btn(locked ? `Level ${r.level}` : 'Make', 'btn', () => send({ t: 'craft', recipe: r.id, station: st.id, count: Math.max(1, Math.min(100, Number(n.value) || 1)) }));
      go.disabled = locked || can < 1 || !!g.job;
      const all = btn('All', 'btn ghost', () => send({ t: 'craft', recipe: r.id, station: st.id, count: Math.min(100, can) }));
      all.disabled = go.disabled;
      act.append(n, go, all);
      const ic = icon({ id: r.output.item, qty: r.output.qty });
      attachTip(ic, () => itemTip({ id: r.output.item, qty: r.output.qty }, sellMult()));
      row.append(ic, info, act);
      list.append(row);
    }
    const body = el('div', 'pbody');
    if (g.job) {
      const j = g.job;
      const q = el('div', 'queue');
      const rr = RECIPES.find((r) => r.id === j.recipe)!;
      q.append(el('span', '', `Making ${ITEMS[rr.output.item].name} — ${j.done} of ${j.total}`));
      const bar = el('div', 'bar'); const fill = el('i'); fill.id = 'craftFill'; bar.append(fill);
      q.append(bar, btn('Stop', 'btn ghost', () => send({ t: 'cancelCraft' })));
      body.append(q);
    }
    // Repairs at the anvil: worn skinning knives (equipped or in the bag).
    if (st.kind === 'anvil') {
      const worn: [string, Stack][] = [];
      if (g.equip.knife) worn.push(['knife', g.equip.knife]);
      g.bag.forEach((s, i) => { if (s && ITEMS[s.id]?.knife) worn.push([String(i), s]); });
      for (const [slot, s] of worn) {
        const max = knifeUses(s), left = s.d ?? max;
        if (left >= max) continue;
        const cost = knifeRepair(s.id);
        const row = el('div', 'recipe');
        const info = el('div', 'rinfo');
        info.append(el('b', '', `Repair ${ITEMS[s.id].name}`), el('span', 'note', `${left}/${max} uses left · costs ${cost.qty} × ${ITEMS[cost.item].name} (you have ${countItem(g.bag, cost.item)})`));
        const b = btn('Repair', 'btn', () => send({ t: 'repair', slot: slot as never }));
        b.disabled = countItem(g.bag, cost.item) < cost.qty;
        const act = el('div', 'ract'); act.append(b);
        row.append(icon(s), info, act);
        list.prepend(row);
      }
    }
    body.prepend(prog);
    if (groups.length > 1) body.append(tabs);
    body.append(list, goldLine(g));
    return [header(st.name, { furnace: 'Smelt ore into bars', anvil: 'Shape stone, smith weapons and metal armour', workbench: 'Carpentry: shafts, arrows, bows, staffs, rods', campfire: 'Cook your catch', stove: 'Cook your catch (burns less)', tanning: 'Leatherworking: tan hides, make leather armour', loom: 'Tailoring: spin, weave, make cloth armour', alchemy: 'Alchemy: brew potions and elixirs (vials from Ragna)' }[st.kind] ?? '', 'E'), body];
  }

  // ---------------------------------------------------------------- NPC dialogs

  /**
   * Renting and your chest. `h` = a specific home (at its door), or null for Hilde's lodge rooms.
   */
  function homeBox(g: GameState, h: Home | null): HTMLElement {
    const now = Date.now();
    const box = el('div', 'inn');
    const mineId = g.lease.room != null && (g.lease.until ?? 0) > now ? g.lease.room : null;
    const mine = mineId != null ? HOMES[mineId] : null;
    const until = g.lease.until ? new Date(g.lease.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const target = h ?? (mine?.kind === 'room' ? mine : null);
    const here = !!mine && (h ? mine.id === h.id : mine.kind === 'room');
    const holder = h ? g.rooms[h.id] : null;
    const price = (h ?? HOMES[0]).price;
    box.append(el('div', 'lbl', h ? 'Rent' : 'Lodge rooms'));
    const sizes = h ? `${h.storage}-slot chest · resting gives +${Math.round(h.rest.xp * 100)}% XP for 30 min` : `24-slot chest · resting gives +5% XP for 30 min`;
    let text: string;
    if (here) text = `${target ? homeLabel(target) : 'It'} is yours until ${until}. Pay up to ${INN.maxWeeks} weeks ahead.`;
    else if (holder && h) text = `${holder} lives here.`;
    else if (h) text = `Free · ${price} g a week · ${sizes}.${mine ? ` Renting here moves you out of the ${homeLabel(mine).toLowerCase()}; your chest comes with you.` : ''}`;
    else text = `${HOMES.filter((x) => x.kind === 'room' && !g.rooms[x.id]).length} of ${INN.rooms} rooms free · ${price} g a week · ${sizes}. One home at a time${mine ? ` — you live in the ${homeLabel(mine).toLowerCase()} now` : ''}. Cottages (Bjørkvik) and miners’ huts (Gruben) are rented at their doors.`;
    box.append(el('p', 'note', text));
    if (!(holder && h && !here) && !(!h && mine && mine.kind !== 'room')) {
      const rent = el('div', 'ract');
      for (const w of [1, 2, 4]) rent.append(btn(`${here ? 'Extend' : 'Rent'} ${w} wk · ${w * price} g`, 'btn', () => send({ t: 'rent', weeks: w, home: h ? h.id : undefined })));
      box.append(rent);
    }
    if (here && !h) box.append(el('p', 'note', 'Your chest is in your room, at the foot of the bed. Open your door with E — only you can.'));
    if (here && h) {
      const cap = target?.storage ?? 24;
      const act = el('div', 'ract');
      act.append(btn('Rest (Rested buff)', 'btn ghost', () => send({ t: 'rest' })));
      box.append(act);
      const two = el('div', 'pbody two');
      const left = el('div', 'pcol');
      left.append(el('div', 'lbl', `Your chest (${g.lease.storage.filter(Boolean).length}/${cap})`));
      const chest = el('div', 'bag');
      g.lease.storage.forEach((s, i) => {
        if (i >= cap && !s) return;
        const c = el('button', i >= cap ? 'cell over' : 'cell'); c.type = 'button';
        if (s) { c.append(icon(s)); attachTip(c, () => itemTip(s, sellMult())); c.onclick = () => send({ t: 'storage', op: 'take', index: i, qty: s.qty }); }
        else c.disabled = true;
        chest.append(c);
      });
      left.append(chest);
      const right = el('div', 'pcol'); right.append(el('div', 'lbl', 'Bag — click to store'), bagGrid(g, { kind: 'storage' }));
      two.append(left, right);
      box.append(two);
    }
    return box;
  }

  function homePanel(g: GameState, id: number): HTMLElement[] {
    const h = HOMES[id];
    const body = el('div', 'pbody');
    body.append(homeBox(g, h));
    return [header(homeLabel(h), h.kind === 'room' ? 'Bjørkvik Lodge' : h.kind === 'cottage' ? 'A cottage on Bjørkvik’s green' : 'A miners’ hut at Gruben camp', 'Esc'), body];
  }

  function npc(g: GameState, id: string): HTMLElement[] {
    const n = NPC_BY_ID.get(id)!;
    const body = el('div', 'pbody');
    const now = Date.now();
    // Quests.
    const qs = QUESTS.filter((q) => q.npc === id);
    if (qs.length) {
      const box = el('div', 'quests');
      box.append(el('div', 'lbl', 'Work'));
      for (const q of qs) {
        const st = g.quests[q.id] ?? {};
        const row = el('div', st.active ? 'quest active' : 'quest');
        const need = 'item' in q.need ? `${q.need.qty} × ${ITEMS[q.need.item].name}` : `Defeat ${q.need.qty}`;
        const have = 'item' in q.need ? countItem(g.bag, q.need.item) : st.progress ?? 0;
        const info = el('div', 'rinfo');
        info.append(el('b', '', q.name), el('span', 'note', q.text), el('span', 'note', `${need} · reward ${q.reward.gold} g + ${q.reward.xp[1]} ${q.reward.xp[0] === 'combat' ? 'player' : q.reward.xp[0]} XP · ${q.period.replace('-', ' ')}`));
        const act = el('div', 'ract');
        if (st.active) {
          act.append(el('span', have >= q.need.qty ? 'in ok' : 'in short', `${Math.min(have, q.need.qty)}/${q.need.qty}`));
          const t = btn('Hand in', 'btn', () => send({ t: 'quest', quest: q.id, op: 'turnin' }));
          t.disabled = have < q.need.qty;
          act.append(t, btn('Drop', 'btn ghost', () => send({ t: 'quest', quest: q.id, op: 'abandon' })));
        } else if (questAvailable(q, g.quests, now)) act.append(btn('Accept', 'btn', () => send({ t: 'quest', quest: q.id, op: 'accept' })));
        else act.append(el('span', 'note', 'Done — resets later'));
        row.append(info, act);
        box.append(row);
      }
      body.append(box);
    }
    // Shop.
    if (n.roles.includes('shop') && n.sells) {
      const wares = el('div', 'wares');
      for (const itemId of n.sells) {
        const d = ITEMS[itemId];
        const row = el('div', 'ware');
        const info = el('div', 'rinfo');
        const facts = [EQUIP_SLOTS.find((x) => x.slot === d.slot)?.label, d.armour ? `Armour ${d.armour}` : '', d.ward ? `Ward ${d.ward}` : ''].filter(Boolean).join(' · ');
        info.append(el('b', '', d.name), ...(facts ? [el('span', 'wfacts', facts)] : []), el('span', 'wblurb', d.blurb));
        const buy = btn(`${d.buyPrice} g`, 'btn', () => send({ t: 'buy', npc: id, item: itemId }));
        buy.disabled = g.gold < (d.buyPrice ?? Infinity);
        const ic = icon({ id: itemId, qty: 1 });
        attachTip(ic, () => itemTip({ id: itemId, qty: 1 }, sellMult()));
        row.append(ic, info, buy);
        wares.append(row);
      }
      const two = el('div', 'pbody two');
      const left = el('div', 'pcol'); left.append(el('div', 'lbl', 'For sale'), wares);
      const right = el('div', 'pcol'); right.append(goldLine(g), bagGrid(g, { kind: 'shop', npc: id }), el('p', 'note', 'Click to sell one, Shift-click for the stack. Greyed items aren’t wanted.'));
      two.append(left, right);
      body.append(two);
    }
    // The inn: Hilde rents lodge rooms (and shows your chest if you live here).
    if (n.roles.includes('inn')) body.append(homeBox(g, null));
    // The imbuer.
    if (n.roles.includes('imbuer')) {
      const box = el('div', 'quests');
      box.append(el('div', 'lbl', 'Imbue a staff'), el('p', 'note', 'Bring a staff from the workbench, a gem and gold, and Ragna makes it magical: fire burns (stacks to 3, Ignite), frost slows (25%, Frost Nova).'));
      let any = false;
      g.bag.forEach((s, i) => {
        const rule = s ? IMBUE[s.id] : undefined;
        if (!s || !rule) return;
        any = true;
        const row = el('div', 'quest');
        const info = el('div', 'rinfo');
        info.append(el('b', '', ITEMS[s.id].name), el('span', 'note', `Costs 1 ${ITEMS[rule.gem].name} (you have ${countItem(g.bag, rule.gem)}) and ${rule.gold} g`));
        const act = el('div', 'ract');
        const ok = countItem(g.bag, rule.gem) > 0 && g.gold >= rule.gold;
        for (const e of ['fire', 'frost'] as const) { const b = btn(e === 'fire' ? 'Fire' : 'Frost', 'btn', () => send({ t: 'imbue', index: i, element: e })); b.disabled = !ok; act.append(b); }
        row.append(icon(s), info, act);
        box.append(row);
      });
      if (!any) box.append(el('p', 'note', 'You have no plain staff in your bag. Make a birch staff at a workbench (Carpentry 4).'));
      body.append(box);
    }
    return [header(n.name, n.title, 'E'), body];
  }

  // ---------------------------------------------------------------- the character menu (C)

  const CHAR_TABS: [typeof uiStore extends { get(): infer U } ? U extends { charTab: infer T } ? T : never : never, string, string][] = [
    ['sheet', 'Character', 'C'], ['talents', 'Talents', 'T'], ['achievements', 'Achievements', 'J'], ['quests', 'Quests', 'L'],
  ];

  /** Every quest you have going, and what's done this period, with who gives it. */
  function questLog(g: GameState): HTMLElement[] {
    const now = Date.now();
    const body = el('div', 'pbody');
    const active = QUESTS.filter((q) => g.quests[q.id]?.active);
    const box = el('div', 'quests');
    box.append(el('div', 'lbl', `Active (${active.length})`));
    if (!active.length) box.append(el('p', 'note', 'No quests yet. Talk to villagers with a “!” over their heads.'));
    for (const q of active) {
      const st = g.quests[q.id] ?? {};
      const have = 'item' in q.need ? countItem(g.bag, q.need.item) : st.progress ?? 0;
      const row = el('div', 'quest active');
      const info = el('div', 'rinfo');
      const need = 'item' in q.need ? `${Math.min(have, q.need.qty)} / ${q.need.qty} ${ITEMS[q.need.item].name}` : `${Math.min(have, q.need.qty)} / ${q.need.qty} defeated`;
      info.append(el('b', '', q.name), el('span', 'note', `${q.text} — ${NPC_BY_ID.get(q.npc)?.name}, ${q.period}. ${need}. Reward ${q.reward.gold} g.`));
      const act = el('div', 'ract');
      act.append(btn('Abandon', 'btn ghost', () => send({ t: 'quest', quest: q.id, op: 'abandon' })));
      row.append(info, act);
      box.append(row);
    }
    body.append(box);
    const avail = QUESTS.filter((q) => !g.quests[q.id]?.active && questAvailable(q, g.quests, now));
    const box2 = el('div', 'quests');
    box2.append(el('div', 'lbl', `Available now (${avail.length})`));
    for (const q of avail) {
      const row = el('div', 'quest');
      const info = el('div', 'rinfo');
      info.append(el('b', '', q.name), el('span', 'note', `${NPC_BY_ID.get(q.npc)?.name} (${NPC_BY_ID.get(q.npc)?.title}) · ${q.period} · ${q.reward.gold} g`));
      row.append(info);
      box2.append(row);
    }
    body.append(box2);
    return [header('Quests', 'Your quest log', 'L'), body];
  }

  function renderCharacter(tab: (typeof CHAR_TABS)[number][0], g: GameState) {
    const tabs = $('charTabs');
    tabs.replaceChildren(...CHAR_TABS.map(([id, name, key]) => btn(`${name} (${key})`, id === tab ? 'tab on' : 'tab', () => uiStore.set({ charTab: id }))));
    const sheet = tab === 'sheet';
    $('charWrap').hidden = !sheet;
    $('charTabBody').hidden = sheet;
    if (sheet) {
      $('charInv').replaceChildren(...inventory(g));
      $('charSkills').replaceChildren(...skillList(g));
      const t = titleOf(g.ach.title);
      $('charTitle').textContent = t ? `“${t}”` : 'No title';
      // Title picker right on the sheet.
      const earned = ACHIEVEMENTS.filter((x) => x.title && g.ach.done.includes(x.id));
      const pickEl = $('charTitlePick');
      if (earned.length) {
        const sel = document.createElement('select');
        sel.append(new Option('No title', ''), ...earned.map((x) => new Option(x.title!, x.id, false, x.id === g.ach.title)));
        sel.value = g.ach.title ?? '';
        sel.onchange = () => send({ t: 'title', id: sel.value || null });
        pickEl.replaceChildren(el('span', 'lbl', 'Title'), sel, el('span', 'note', `${g.ach.done.length} of ${ACHIEVEMENTS.length} achievements`));
      } else pickEl.replaceChildren(el('span', 'note', `Earn achievements (J) to unlock titles · ${g.ach.done.length} of ${ACHIEVEMENTS.length}`));
    } else {
      const parts = tab === 'talents' ? talents(g) : tab === 'achievements' ? achievements(g) : questLog(g);
      $('charTabBody').replaceChildren(...parts);
    }
  }

  // ---------------------------------------------------------------- render

  function render() {
    const u = uiStore.get(), g = gameStore.get();
    if (u.panel === 'character') renderCharacter(u.charTab, g);
    const open = ['skills', 'craft', 'npc', 'home', 'talents', 'map', 'achievements'].includes(u.panel);
    root.hidden = !open;
    if (!open) return;
    card.className = `pcard ${u.panel}`;
    if (u.panel === 'skills') card.replaceChildren(...skills(g));
    else if (u.panel === 'craft') card.replaceChildren(...craft(g, u.station));
    else if (u.panel === 'npc') card.replaceChildren(...npc(g, u.npc));
    else if (u.panel === 'home') card.replaceChildren(...homePanel(g, u.home));
    else if (u.panel === 'talents') card.replaceChildren(...talents(g));
    else if (u.panel === 'achievements') card.replaceChildren(...achievements(g));
    else if (u.panel === 'map') { const c = drawMap(); card.replaceChildren(header('Map', mapTitle(), 'M'), c); }
    hideTip();
  }

  let lastPanel = uiStore.get().panel;
  uiStore.subscribe((u) => {
    if (u.panel !== lastPanel) {
      const was = lastPanel;
      lastPanel = u.panel;
      if (['skills', 'craft', 'npc', 'home', 'talents', 'map', 'achievements', 'character'].includes(was) && u.panel === 'none') onClose();
    }
    render();
  });
  let pending = false;
  gameStore.subscribe(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; if (uiStore.get().panel !== 'map') render(); });
  });

  return {
    render,
    frame() {
      const j = gameStore.get().job;
      const f = document.getElementById('craftFill');
      if (f && j) f.style.width = `${Math.round(100 * Math.min(1, Math.max(0, 1 - (j.endsAt - performance.now()) / (j.seconds * 1000))))}%`;
    },
  };
}
