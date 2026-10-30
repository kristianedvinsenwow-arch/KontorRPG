/**
 * M1 panels: gear + bag inside the character sheet (C / I), skills (K), crafting at a station and
 * the trading post (both E).
 * They only ever send requests; what you own changes when the server answers (gameStore).
 */
import {
  EQUIP_SLOTS, ITEMS, RECIPES, SKILLS, STATIONS, TRADING_POST,
  countItem, levelFromXp, levelProgress, xpForLevel,
  type ClientMsg, type Stack,
} from '@kontor/shared';
import { gameStore, uiStore, type GameState } from '../state/store.js';
import { iconFor } from './icons.js';

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function itemLines(id: string): string[] {
  const d = ITEMS[id];
  if (!d) return [];
  const out = [d.blurb];
  if (d.toolPower) out.push(`Swing ${d.swingSec}s at Mining 1`);
  if (d.dps) out.push(`${d.dps} damage per second`);
  if (d.armour) out.push(`Armour ${d.armour}`);
  if (d.bagSlots) out.push(`+${d.bagSlots} bag slots`);
  if (d.sellValue) out.push(`Trader pays ${d.sellValue} g`);
  return out;
}

function icon(id: string, qty?: number, title = true): HTMLElement {
  const box = el('div', 'icon');
  const img = el('img');
  img.src = iconFor(id); img.alt = ITEMS[id]?.name ?? id; img.draggable = false;
  box.append(img);
  if (qty && qty > 1) box.append(el('span', 'qty', String(qty)));
  if (title) box.title = [ITEMS[id]?.name ?? id, ...itemLines(id)].join('\n');
  return box;
}

/** A bag grid. `onPick` gets the slot index; `hint` labels what clicking does. */
function bagGrid(g: GameState, onPick: (i: number, s: Stack, shift: boolean) => void, enabled: (s: Stack) => boolean): HTMLElement {
  const grid = el('div', 'bag');
  g.bag.forEach((s, i) => {
    const cell = el('button', 'cell');
    cell.type = 'button';
    if (s) {
      cell.append(icon(s.id, s.qty));
      cell.disabled = !enabled(s);
      cell.onclick = (e) => onPick(i, s, e.shiftKey);
    } else cell.disabled = true;
    grid.append(cell);
  });
  return grid;
}

function header(title: string, sub: string, closeKey: string): HTMLElement {
  const h = el('div', 'phead');
  const t = el('div');
  t.append(el('div', 'eyebrow', sub), el('h2', '', title));
  const close = el('button', 'btn ghost', `Close (${closeKey})`);
  close.type = 'button';
  close.onclick = () => uiStore.set({ panel: 'none' });
  h.append(t, close);
  return h;
}

function goldChip(g: GameState): HTMLElement {
  const used = g.bag.filter(Boolean).length;
  const d = el('div', 'goldline');
  d.append(el('span', 'gold', `${g.gold} g`), el('span', 'note', `Bag ${used} / ${g.bag.length}`));
  return d;
}

export function initPanels(send: (m: ClientMsg) => void, onClose: () => void) {
  const root = $('gamePanel');
  const card = $('gameCard');

  function render() {
    const u = uiStore.get(), g = gameStore.get();
    if (u.panel === 'character') $('charInv').replaceChildren(...inventory(gameStore.get()));
    const open = u.panel === 'skills' || u.panel === 'craft' || u.panel === 'shop';
    root.hidden = !open;
    if (!open) return;
    card.className = `pcard ${u.panel}`;
    if (u.panel === 'skills') card.replaceChildren(...skills(g));
    else if (u.panel === 'craft') card.replaceChildren(...craft(g, u.station));
    else card.replaceChildren(...shop(g));
  }

  /** Gear and bag, rendered into the character sheet. */
  function inventory(g: GameState): HTMLElement[] {
    const eq = el('div', 'gear');
    for (const { slot, label } of EQUIP_SLOTS) {
      const id = g.equip[slot];
      const b = el('button', id ? 'gslot worn' : 'gslot');
      b.type = 'button';
      b.title = id ? `${ITEMS[id].name} — click to take off\n${itemLines(id).join('\n')}` : `${label}: empty`;
      if (id) { b.append(icon(id, 1, false)); b.onclick = () => send({ t: 'unequip', slot }); }
      else b.disabled = true;
      b.append(el('span', '', label));
      eq.append(b);
    }
    return [el('div', 'lbl', 'Equipment'), eq, goldChip(g), bagGrid(g, (i) => send({ t: 'equip', index: i }), () => true),
      el('p', 'note', 'Click gear in your bag to wear it, and worn gear to take it off. Sell at the trading post.')];
  }

  function skills(g: GameState): HTMLElement[] {
    const list = el('div', 'skills');
    for (const s of SKILLS) {
      const xp = g.xp[s.id] ?? 0, lvl = levelFromXp(xp);
      const row = el('div', s.live ? 'skill' : 'skill soon');
      const top = el('div', 'srow');
      top.append(el('b', '', s.name), el('span', 'lvl', s.live ? `Level ${lvl}` : 'Soon'));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(levelProgress(xp) * 100)}%`;
      bar.append(fill);
      row.append(top, bar, el('p', 'note', s.live ? `${xp.toLocaleString('en')} XP · ${(xpForLevel(lvl + 1) - xp).toLocaleString('en')} to level ${lvl + 1}. ${s.blurb}` : s.blurb));
      list.append(row);
    }
    return [header('Skills', 'Slow and steady', 'K'), list];
  }

  const want = new Map<string, number>();
  function craft(g: GameState, station: keyof typeof STATIONS): HTMLElement[] {
    const lvl = levelFromXp(g.xp.smithing ?? 0);
    const list = el('div', 'recipes');
    for (const r of RECIPES.filter((r) => r.station === station)) {
      const can = Math.min(...r.inputs.map((i) => Math.floor(countItem(g.bag, i.item) / i.qty)));
      const locked = lvl < r.level;
      const row = el('div', locked ? 'recipe locked' : 'recipe');
      const out = ITEMS[r.output.item];
      const info = el('div', 'rinfo');
      info.append(el('b', '', out.name), el('span', 'note', `Smithing ${r.level} · ${r.xp} XP · ${r.seconds}s each`));
      const ins = el('div', 'inputs');
      for (const i of r.inputs) {
        const have = countItem(g.bag, i.item);
        const chip = el('span', have >= i.qty ? 'in ok' : 'in short');
        chip.append(icon(i.item, 0), el('span', '', `${have}/${i.qty} ${ITEMS[i.item].name}`));
        ins.append(chip);
      }
      info.append(ins);
      const act = el('div', 'ract');
      const n = el('input');
      n.type = 'number'; n.min = '1'; n.max = '100';
      n.value = String(Math.max(1, Math.min(want.get(r.id) ?? can, 100)));
      n.oninput = () => want.set(r.id, Number(n.value) || 1);
      n.onkeydown = (e) => e.stopPropagation();
      const go = el('button', 'btn', locked ? `Level ${r.level}` : 'Make');
      go.type = 'button';
      go.disabled = locked || can < 1 || !!g.job;
      go.onclick = () => send({ t: 'craft', recipe: r.id, count: Math.max(1, Math.min(100, Number(n.value) || 1)) });
      const all = el('button', 'btn ghost', 'All');
      all.type = 'button';
      all.disabled = go.disabled;
      all.onclick = () => send({ t: 'craft', recipe: r.id, count: Math.min(100, can) });
      act.append(n, go, all);
      row.append(icon(r.output.item, r.output.qty), info, act);
      list.append(row);
    }
    const body = el('div', 'pbody');
    if (g.job) {
      const j = g.job;
      const q = el('div', 'queue');
      q.append(el('span', '', `Making ${ITEMS[RECIPES.find((r) => r.id === j.recipe)!.output.item].name} — ${j.done} of ${j.total}`));
      const bar = el('div', 'bar'); const fill = el('i'); fill.id = 'craftFill'; bar.append(fill);
      const cancel = el('button', 'btn ghost', 'Stop');
      cancel.type = 'button';
      cancel.onclick = () => send({ t: 'cancelCraft' });
      q.append(bar, cancel);
      body.append(q);
    }
    body.append(list, goldChip(g));
    const sub = station === 'furnace' ? 'Smelt ore into bars' : 'Shape stone and smith gear';
    return [header(STATIONS[station].name, `${sub} · Smithing ${lvl}`, 'E'), body];
  }

  function shop(g: GameState): HTMLElement[] {
    const wares = el('div', 'wares');
    for (const id of TRADING_POST.sells) {
      const d = ITEMS[id];
      const row = el('div', 'ware');
      const info = el('div', 'rinfo');
      info.append(el('b', '', d.name), el('span', 'note', itemLines(id)[0]));
      const buy = el('button', 'btn', `Buy · ${d.buyPrice} g`);
      buy.type = 'button';
      buy.disabled = g.gold < (d.buyPrice ?? Infinity);
      buy.onclick = () => send({ t: 'buy', item: id });
      row.append(icon(id), info, buy);
      wares.append(row);
    }
    const right = el('div', 'pcol');
    right.append(goldChip(g),
      bagGrid(g, (i, s, shift) => send({ t: 'sell', index: i, qty: shift ? s.qty : 1 }), (s) => (ITEMS[s.id]?.sellValue ?? 0) > 0),
      el('p', 'note', 'Click to sell one, Shift-click to sell the stack. Greyed-out items aren’t wanted here — smith them into something.'));
    const left = el('div', 'pcol');
    left.append(el('div', 'lbl', 'For sale'), wares);
    const body = el('div', 'pbody two');
    body.append(left, right);
    return [header(TRADING_POST.name, 'Trader Ingrid', 'E'), body];
  }

  let lastPanel = uiStore.get().panel;
  uiStore.subscribe((u) => {
    if (u.panel !== lastPanel) {
      const was = lastPanel;
      lastPanel = u.panel;
      if (['skills', 'craft', 'shop'].includes(was) && u.panel === 'none') onClose();
    }
    render();
  });
  gameStore.subscribe(render);

  /** Per-frame: the crafting progress bar fills smoothly between server updates. */
  return {
    frame() {
      const j = gameStore.get().job;
      const f = document.getElementById('craftFill');
      if (f && j) f.style.width = `${Math.round(100 * Math.min(1, Math.max(0, 1 - (j.endsAt - performance.now()) / (j.seconds * 1000))))}%`;
    },
  };
}
