/** Pause/settings card and the boss key. (The start menu is the character creator, see creator.ts.) */
import { settingsStore, uiStore } from '../state/store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initPause(onResume: () => void) {
  const pause = $('pause');
  const quality2 = $<HTMLSelectElement>('quality2');
  const sens = $<HTMLInputElement>('sens');
  sens.value = String(settingsStore.get().sensitivity);
  settingsStore.subscribe((st) => { quality2.value = st.quality; });
  quality2.onchange = () => settingsStore.set({ quality: quality2.value as 'low' | 'medium' | 'high' });
  sens.oninput = () => settingsStore.set({ sensitivity: Number(sens.value) });
  $('resume').onclick = onResume;
  uiStore.subscribe((u) => { pause.hidden = u.panel !== 'pause'; });
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
