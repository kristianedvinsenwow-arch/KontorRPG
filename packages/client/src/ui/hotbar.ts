/**
 * Action bar and status: weapon / pickaxe / hatchet / rod (1–4; the held one is highlighted and
 * the right-click cooldown sweeps over the weapon), food (5), healing potion (6), health, buffs, tracked quests, and
 * the "knocked out" screen.
 */
import { EAT_LOCK_MS, POTION_CD_MS, ITEMS, QUEST_BY_ID, SPECIALS, countItem, formatStat, weaponClass, type HoldSlot, type StatKey } from '@kontor/shared';
import { gameStore, type GameState } from '../state/store.js';
import { icon, el } from './panels.js';
import { attachTip, itemTip } from './tooltip.js';

const SLOTS: { key: string; slot: HoldSlot; label: string }[] = [
  { key: '1', slot: 'mainHand', label: 'Weapon' },
  { key: '2', slot: 'pickaxe', label: 'Pickaxe' },
  { key: '3', slot: 'hatchet', label: 'Hatchet' },
  { key: '4', slot: 'rod', label: 'Rod' },
];

export function initHotbar(onHold: (s: HoldSlot) => void, onEat: (index: number) => void, onRespawn: () => void) {
  const bar = el('div'); bar.id = 'hotbar';
  const hp = el('div'); hp.id = 'hpbox';
  const hpFill = el('i'); const hpText = el('span');
  const hpBar = el('div', 'hp'); hpBar.append(hpFill, hpText);
  const buffs = el('div', 'buffs');
  // Right-click ability: a bar that fills while it recharges.
  const sp = el('div', 'special');
  const spFill = el('i'), spText = el('span');
  sp.append(spFill, spText);
  hp.append(hpBar, sp, buffs);
  const tracker = el('div'); tracker.id = 'tracker';
  const dead = el('div'); dead.id = 'dead'; dead.hidden = true;
  const deadCard = el('div', 'card');
  deadCard.append(el('h2', '', 'Knocked out'), el('p', 'note', 'You keep everything you carry. You’ll wake at camp, weakened for 2 minutes.'));
  const wake = el('button', 'btn big', 'Wake up at camp'); wake.type = 'button'; wake.onclick = onRespawn;
  deadCard.append(wake);
  dead.append(deadCard);
  const hud = document.getElementById('hud')!;
  hud.append(bar, hp, tracker);
  document.body.append(dead);

  const cells: { cell: HTMLElement; cd: HTMLElement }[] = [];
  let foodLock: HTMLElement | null = null;
  let potionCd: HTMLElement | null = null;
  const build = (g: GameState) => {
    bar.replaceChildren();
    cells.length = 0;
    for (const s of SLOTS) {
      const st = g.equip[s.slot];
      const cell = el('button', `hcell${g.held === s.slot ? ' on' : ''}${st ? '' : ' empty'}`);
      cell.type = 'button';
      if (st) { cell.append(icon(st)); attachTip(cell, () => [...itemTip(st), ...(s.slot === 'mainHand' ? [el('div', 'tspecial', `Right click: ${SPECIALS[weaponClass(st)].name}`)] : [])]); }
      else if (s.slot === 'mainHand') cell.append(el('span', 'fist', '✊'));
      cell.append(el('kbd', '', s.key), el('small', '', s.label));
      const cd = el('div', 'cd');
      cell.append(cd);
      cell.onclick = () => onHold(s.slot);
      bar.append(cell);
      cells.push({ cell, cd });
    }
    // Food: the first food stack in the bag.
    const fi = g.bag.findIndex((s) => s && ITEMS[s.id]?.food);
    const food = fi >= 0 ? g.bag[fi]! : null;
    const fc = el('button', `hcell food${food ? '' : ' empty'}`);
    fc.type = 'button';
    if (food) { fc.append(icon({ ...food, qty: countItem(g.bag, food.id) })); attachTip(fc, () => itemTip(food)); fc.onclick = () => onEat(fi); }
    fc.append(el('kbd', '', '5'), el('small', '', 'Eat'));
    const lock = el('div', 'cd'); fc.append(lock);
    foodLock = lock;
    bar.append(fc);
    // Potion: the first healing potion in the bag (usable mid-fight, shared cooldown).
    const pi = g.bag.findIndex((s) => s && ITEMS[s.id]?.potion?.heal);
    const pot = pi >= 0 ? g.bag[pi]! : null;
    const pc = el('button', `hcell potion${pot ? '' : ' empty'}`);
    pc.type = 'button';
    if (pot) { pc.append(icon({ ...pot, qty: countItem(g.bag, pot.id) })); attachTip(pc, () => itemTip(pot)); pc.onclick = () => onEat(pi); }
    pc.append(el('kbd', '', '6'), el('small', '', 'Potion'));
    const pcd = el('div', 'cd'); pc.append(pcd);
    potionCd = pcd;
    bar.append(pc);
    // Health and buffs.
    hpFill.style.width = `${Math.max(0, Math.min(1, g.hp / g.maxHp)) * 100}%`;
    hpText.textContent = `${Math.ceil(g.hp)} / ${g.maxHp}`;
    hpBar.classList.toggle('low', g.hp / g.maxHp < 0.3);
    const now = Date.now();
    buffs.replaceChildren(...g.buffs.filter((b) => b.until > now).map((b) => {
      const d = el('span', b.name === 'Weakened' ? 'buff bad' : 'buff', b.name);
      attachTip(d, () => [el('div', 'tname', b.name), ...Object.entries(b.stats).map(([k, v]) => el('div', (v as number) < 0 ? 'tneg' : 'tfx', formatStat(k as StatKey, v as number)))]);
      return d;
    }));
    // Tracked quests.
    const active = Object.entries(g.quests).filter(([, s]) => s.active);
    tracker.replaceChildren(...active.map(([id, s]) => {
      const q = QUEST_BY_ID.get(id);
      if (!q) return el('div');
      const have = 'item' in q.need ? countItem(g.bag, q.need.item) : s.progress ?? 0;
      const d = el('div', have >= q.need.qty ? 'tq done' : 'tq');
      d.append(el('b', '', q.name), el('span', '', `${'item' in q.need ? ITEMS[q.need.item].name : `Defeat ${q.need.kill.replace('_', ' ')}s`}: ${Math.min(have, q.need.qty)}/${q.need.qty}`));
      return d;
    }));
    dead.hidden = !g.dead;
  };
  gameStore.subscribe(build);

  return {
    /** Per frame: right-click cooldown sweep on the weapon slot. */
    frame() {
      const g = gameStore.get();
      const now = Date.now();
      const left = g.specialReady - now;
      const special = SPECIALS[weaponClass(g.equip.mainHand)];
      const total = special.cd * 1000;
      const frac = left > 0 ? 1 - Math.min(1, left / total) : 1;
      spFill.style.width = `${frac * 100}%`;
      sp.classList.toggle('ready', left <= 0);
      const label = left > 0 ? `${special.name} · ${(left / 1000).toFixed(1)} s` : `Right click · ${special.name} ready`;
      if (spText.textContent !== label) spText.textContent = label;
      const c = cells[0];
      if (c) {
        if (left > 0) { c.cd.style.height = `${Math.min(1, left / total) * 100}%`; c.cd.textContent = String(Math.ceil(left / 1000)); }
        else if (c.cd.textContent) { c.cd.style.height = '0'; c.cd.textContent = ''; }
      }
      const pLeft = g.potionReady - now;
      if (potionCd) {
        if (pLeft > 0) { potionCd.style.height = `${(pLeft / POTION_CD_MS) * 100}%`; potionCd.textContent = String(Math.ceil(pLeft / 1000)); }
        else if (potionCd.textContent) { potionCd.style.height = '0'; potionCd.textContent = ''; }
      }
      // Food is locked for 10 s after taking damage.
      const lockLeft = g.hurtAt + EAT_LOCK_MS - now;
      if (foodLock) {
        if (lockLeft > 0) { foodLock.style.height = `${(lockLeft / EAT_LOCK_MS) * 100}%`; foodLock.textContent = String(Math.ceil(lockLeft / 1000)); }
        else if (foodLock.textContent) { foodLock.style.height = '0'; foodLock.textContent = ''; }
      }
    },
  };
}
