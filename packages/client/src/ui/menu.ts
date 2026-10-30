/** Start menu, pause/settings card and the boss key. */
import { PLAYER_COLORS, MAX_NAME_LEN } from '@kontor/shared';
import { netStore, settingsStore, uiStore } from '../state/store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initMenu(onEnter: (name: string, color: number) => void, onResume: () => void) {
  const menu = $('menu'), pause = $('pause');
  const nameIn = $<HTMLInputElement>('nameIn');
  const swatches = $('swatches');
  const enter = $<HTMLButtonElement>('enter');
  const lowGpu = $<HTMLInputElement>('lowGpu'), lowGpu2 = $<HTMLInputElement>('lowGpu2');
  const sens = $<HTMLInputElement>('sens');
  const menuNet = $('menuNet');

  const s = settingsStore.get();
  nameIn.value = s.name;
  nameIn.maxLength = MAX_NAME_LEN;
  sens.value = String(s.sensitivity);

  const renderSwatches = () => {
    const sel = settingsStore.get().color;
    swatches.replaceChildren(...PLAYER_COLORS.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'sw';
      b.style.background = c;
      b.setAttribute('aria-label', `Colour ${i + 1}`);
      b.setAttribute('aria-pressed', String(i === sel));
      b.onclick = () => { settingsStore.set({ color: i }); renderSwatches(); };
      return b;
    }));
  };
  renderSwatches();

  settingsStore.subscribe((st) => { lowGpu.checked = lowGpu2.checked = st.lowGpu; });
  lowGpu.onchange = () => settingsStore.set({ lowGpu: lowGpu.checked });
  lowGpu2.onchange = () => settingsStore.set({ lowGpu: lowGpu2.checked });
  sens.oninput = () => settingsStore.set({ sensitivity: Number(sens.value) });

  const go = () => {
    const name = nameIn.value.trim().slice(0, MAX_NAME_LEN) || 'Adventurer';
    settingsStore.set({ name });
    onEnter(name, settingsStore.get().color);
  };
  enter.onclick = go;
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
  $('resume').onclick = onResume;

  uiStore.subscribe((u) => {
    menu.hidden = u.panel !== 'menu';
    pause.hidden = u.panel !== 'pause';
    if (u.panel === 'menu') setTimeout(() => nameIn.focus(), 0);
  });
  netStore.subscribe((n) => {
    menuNet.textContent = n.status === 'online' ? 'Connected.' : n.status === 'offline' ? 'Pick a name and enter the world.' : 'Connecting to server…';
  });
}

/** F9 swaps the game for a dull-looking spreadsheet, and back. */
export function initBossKey(onShow: () => void) {
  const boss = $('boss');
  const cols = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const rows = ['Budget line', 'Licences', 'Travel', 'Training', 'Hardware', 'Consulting', 'Facilities', 'Coffee', 'Contingency', 'Total'];
  let html = '<div class="bar">Q4 budget review — Book1.xlsx</div><table><tr>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
  rows.forEach((r, i) => {
    html += `<tr><th>${i + 1}</th><td>${r}</td>` + [0, 1, 2, 3, 4, 5].map(() => `<td>${(1000 + Math.random() * 90000).toFixed(0)}</td>`).join('') + '</tr>';
  });
  for (let i = rows.length; i < 34; i++) html += `<tr><th>${i + 1}</th>` + '<td></td>'.repeat(7) + '</tr>';
  boss.innerHTML = html + '</table>';
  uiStore.subscribe((u) => { boss.hidden = !u.bossKey; });
  addEventListener('keydown', (e) => {
    if (e.code !== 'F9') return;
    e.preventDefault();
    const on = !uiStore.get().bossKey;
    uiStore.set({ bossKey: on });
    if (on) onShow();
  });
}
