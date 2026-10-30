/**
 * Game panels: gear + bag in the character sheet (C / I), skills (K), talents (T), crafting at a
 * station (E), NPC dialogs (E: trader, quests, the inn and its storage chest, the imbuer), and the
 * world map (M). They only ever send requests; what you own changes when the server answers.
 */
import {
  COMING_SKILLS, EQUIP_SLOTS, IMBUE, INN, ITEMS, NPC_BY_ID, QUESTS, RECIPES, SKILLS, STATION_BY_ID, TALENT_TREE, TREES,
  canLearn, countItem, formatStat, levelFromXp, levelProgress, pointsLeft, questAvailable, recipeAt, respecCost, xpForLevel,
  type ClientMsg, type Stack, type StatKey, type TreeId,
} from '@kontor/shared';
import { gameStore, uiStore, type GameState } from '../state/store.js';
import { iconFor, rarityColor } from './icons.js';
import { attachTip, hideTip, itemTip } from './tooltip.js';
import { drawMap } from './map.js';

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
      if (d?.slot) actions.push(['Equip', () => send({ t: 'equip', index: i })]);
      if (mode.kind === 'shop' && d?.sellValue) { actions.push(['Sell one', () => send({ t: 'sell', npc: mode.npc, index: i, qty: 1 })]); if (s.qty > 1) actions.push([`Sell all ${s.qty}`, () => send({ t: 'sell', npc: mode.npc, index: i, qty: s.qty })]); }
      if (mode.kind === 'storage') actions.push([s.qty > 1 ? `Put all ${s.qty} in chest` : 'Put in chest', () => send({ t: 'storage', op: 'put', index: i, qty: s.qty })]);
      actions.push([s.qty > 1 ? 'Drop one' : 'Drop', () => send({ t: 'drop', index: i, qty: 1 })]);
      if (s.qty > 1) actions.push([`Drop all ${s.qty}`, () => send({ t: 'drop', index: i, qty: s.qty })]);
      // Left click does the obvious thing; right click shows everything.
      cell.onclick = (e) => {
        if (mode.kind === 'shop' && d?.sellValue) return send({ t: 'sell', npc: mode.npc, index: i, qty: e.shiftKey ? s.qty : 1 });
        if (mode.kind === 'storage') return send({ t: 'storage', op: 'put', index: i, qty: s.qty });
        if (d?.food) return send({ t: 'eat', index: i });
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
  function craft(g: GameState, stationId: string): HTMLElement[] {
    const st = STATION_BY_ID.get(stationId)!;
    const list = el('div', 'recipes');
    for (const r of RECIPES.filter((x) => recipeAt(x, st.kind))) {
      const lvl = levelFromXp(g.xp[r.skill] ?? 0);
      const can = Math.min(...r.inputs.map((i) => Math.floor(countItem(g.bag, i.item) / i.qty)));
      const locked = lvl < r.level;
      const row = el('div', locked ? 'recipe locked' : 'recipe');
      const out = ITEMS[r.output.item];
      const info = el('div', 'rinfo');
      const skillName = r.skill[0].toUpperCase() + r.skill.slice(1);
      info.append(el('b', '', r.output.qty > 1 ? `${out.name} ×${r.output.qty}` : out.name), el('span', 'note', `${skillName} ${r.level} · ${r.xp} XP · ${r.seconds}s${out.slot && out.kind !== 'ammo' ? ' · can roll a rarity' : ''}${r.burns ? ' · can burn' : ''}`));
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
    body.append(list, goldLine(g));
    return [header(st.name, { furnace: 'Smelt ore into bars', anvil: 'Shape stone, smith weapons and metal armour', workbench: 'Carpentry: shafts, arrows, bows, staffs, rods', campfire: 'Cook your catch', stove: 'Cook your catch (burns less)' }[st.kind], 'E'), body];
  }

  // ---------------------------------------------------------------- NPC dialogs

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
        info.append(el('b', '', d.name), el('span', 'note', d.blurb));
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
    // The inn.
    if (n.roles.includes('inn')) {
      const box = el('div', 'inn');
      const mine = g.lease.room != null && (g.lease.until ?? 0) > now;
      const free = g.rooms.filter((r) => !r).length;
      box.append(el('div', 'lbl', 'Rooms'));
      box.append(el('p', 'note', mine
        ? `You rent room ${g.lease.room! + 1} until ${new Date(g.lease.until!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Pay up to ${INN.maxWeeks} weeks ahead.`
        : `${free} of ${INN.rooms} rooms free. ${INN.pricePerWeek} g a week. One home at a time: renting somewhere new moves your chest with you.`));
      const rent = el('div', 'ract');
      for (const w of [1, 2, 4]) rent.append(btn(`${mine ? 'Extend' : 'Rent'} ${w} wk · ${w * INN.pricePerWeek} g`, 'btn', () => send({ t: 'rent', weeks: w })));
      box.append(rent);
      if (mine) {
        const two = el('div', 'pbody two');
        const left = el('div', 'pcol');
        left.append(el('div', 'lbl', `Your chest (${g.lease.storage.filter(Boolean).length}/${g.lease.storage.length})`));
        const chest = el('div', 'bag');
        g.lease.storage.forEach((s, i) => {
          const c = el('button', 'cell'); c.type = 'button';
          if (s) { c.append(icon(s)); attachTip(c, () => itemTip(s, sellMult())); c.onclick = () => send({ t: 'storage', op: 'take', index: i, qty: s.qty }); }
          else c.disabled = true;
          chest.append(c);
        });
        left.append(chest);
        const right = el('div', 'pcol'); right.append(el('div', 'lbl', 'Bag — click to store'), bagGrid(g, { kind: 'storage' }));
        two.append(left, right);
        box.append(two);
      }
      body.append(box);
    }
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

  // ---------------------------------------------------------------- render

  function render() {
    const u = uiStore.get(), g = gameStore.get();
    if (u.panel === 'character') $('charInv').replaceChildren(...inventory(g));
    const open = ['skills', 'craft', 'npc', 'talents', 'map'].includes(u.panel);
    root.hidden = !open;
    if (!open) return;
    card.className = `pcard ${u.panel}`;
    if (u.panel === 'skills') card.replaceChildren(...skills(g));
    else if (u.panel === 'craft') card.replaceChildren(...craft(g, u.station));
    else if (u.panel === 'npc') card.replaceChildren(...npc(g, u.npc));
    else if (u.panel === 'talents') card.replaceChildren(...talents(g));
    else if (u.panel === 'map') { const c = drawMap(); card.replaceChildren(header('Map', 'Mofjellet and Bjørkvik', 'M'), c); }
    hideTip();
  }

  let lastPanel = uiStore.get().panel;
  uiStore.subscribe((u) => {
    if (u.panel !== lastPanel) {
      const was = lastPanel;
      lastPanel = u.panel;
      if (['skills', 'craft', 'npc', 'talents', 'map', 'character'].includes(was) && u.panel === 'none') onClose();
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
