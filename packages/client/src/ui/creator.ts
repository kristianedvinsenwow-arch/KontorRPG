/**
 * Character creator: name, race, colour, attributes (start at 5, move points between them),
 * one major and one minor perk, and the stats that result. Everything is checked with the same
 * shared rules the server uses, so "Enter the world" only lights up for a legal character.
 */
import {
  ATTRS, ATTR_MAX, ATTR_MIN, ATTR_START, MAJOR_PERKS, MINOR_PERKS, MAX_NAME_LEN, PLAYER_COLORS, RACES,
  derive, freePoints, maxSpeed, validateBuild,
  type AttrKey, type CharacterBuild, type Perk, type Race,
} from '@kontor/shared';
import { netStore, settingsStore, uiStore } from '../state/store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function initCreator(onEnter: (name: string, color: number, build: CharacterBuild) => void, onChange: () => void) {
  const nameIn = $<HTMLInputElement>('nameIn');
  const enter = $<HTMLButtonElement>('enter');
  const lowGpu = $<HTMLInputElement>('lowGpu');
  const menuNet = $('menuNet');
  nameIn.value = settingsStore.get().name;
  nameIn.maxLength = MAX_NAME_LEN;

  const build = (): CharacterBuild => structuredClone(settingsStore.get().build);
  const setBuild = (b: CharacterBuild) => { settingsStore.set({ build: b }); render(); onChange(); };

  function optionCard(title: string, lines: [string, string][], pressed: boolean, onClick: () => void) {
    const b = el('button', 'card-opt');
    b.setAttribute('aria-pressed', String(pressed));
    b.append(el('b', '', title));
    for (const [cls, text] of lines) b.append(el('small', cls, text));
    b.onclick = onClick;
    return b;
  }

  function renderRaces() {
    const cur = settingsStore.get().build.race;
    $('races').replaceChildren(...(Object.keys(RACES) as Race[]).map((r) =>
      optionCard(RACES[r].name, [['', RACES[r].blurb]], r === cur, () => setBuild({ ...build(), race: r }))));
  }

  function renderSwatches() {
    const sel = settingsStore.get().color;
    $('swatches').replaceChildren(...PLAYER_COLORS.map((c, i) => {
      const b = el('button', 'sw');
      b.style.background = c;
      b.setAttribute('aria-label', `Colour ${i + 1}`);
      b.setAttribute('aria-pressed', String(i === sel));
      b.onclick = () => { settingsStore.set({ color: i }); renderSwatches(); onChange(); };
      return b;
    }));
  }

  function renderAttrs() {
    const b = settingsStore.get().build;
    const free = freePoints(b.attrs);
    const pool = $('pool');
    pool.textContent = free > 0 ? `${free} point${free === 1 ? '' : 's'} to spend` : 'All points placed';
    pool.classList.toggle('has', free > 0);
    $('attrs').replaceChildren(...ATTRS.map(({ key, short, name, desc }) => {
      const v = b.attrs[key];
      const row = el('div', 'attr');
      const nm = el('div', 'nm');
      nm.append(el('b', '', short), el('small', '', name));
      const minus = el('button', '', '−');
      minus.setAttribute('aria-label', `Lower ${name}`);
      minus.disabled = v <= ATTR_MIN;
      minus.onclick = () => change(key, -1);
      const plus = el('button', '', '+');
      plus.setAttribute('aria-label', `Raise ${name}`);
      plus.disabled = v >= ATTR_MAX || free <= 0;
      plus.onclick = () => change(key, +1);
      const pips = el('div', 'pips');
      for (let i = 1; i <= ATTR_MAX; i++) {
        const p = el('i', (i <= v ? 'on' : '') + (i === ATTR_START ? ' base' : ''));
        pips.append(p);
      }
      row.append(nm, minus, pips, plus, el('span', 'val', String(v)), el('div', 'desc', desc));
      return row;
    }));
  }

  function change(key: AttrKey, d: number) {
    const b = build();
    const nv = b.attrs[key] + d;
    if (nv < ATTR_MIN || nv > ATTR_MAX) return;
    if (d > 0 && freePoints(b.attrs) <= 0) return;
    b.attrs[key] = nv;
    setBuild(b);
  }

  function renderPerks(target: string, list: Perk[], field: 'major' | 'minor') {
    const cur = settingsStore.get().build[field];
    $(target).replaceChildren(...list.map((p) =>
      optionCard(p.name, [['up', `+ ${p.plus}`], ['down', `− ${p.minus}`]], p.id === cur, () => setBuild({ ...build(), [field]: p.id }))));
  }

  function renderDerived() {
    $('derived').replaceChildren(...derivedTiles(settingsStore.get().build));
  }

  function renderEnter() {
    const b = settingsStore.get().build;
    const bad = validateBuild(b);
    const free = freePoints(b.attrs);
    enter.disabled = !!bad;
    enter.textContent = free > 0 ? `Place ${free} more point${free === 1 ? '' : 's'}` : 'Enter the world';
  }

  function render() {
    renderRaces();
    renderAttrs();
    renderPerks('majors', MAJOR_PERKS, 'major');
    renderPerks('minors', MINOR_PERKS, 'minor');
    renderDerived();
    renderEnter();
  }
  renderSwatches();
  render();

  settingsStore.subscribe((st) => { lowGpu.checked = st.lowGpu; });
  lowGpu.onchange = () => settingsStore.set({ lowGpu: lowGpu.checked });
  nameIn.oninput = () => { settingsStore.set({ name: nameIn.value.slice(0, MAX_NAME_LEN) }); onChange(); };

  const go = () => {
    const b = settingsStore.get().build;
    if (validateBuild(b)) return;
    const name = nameIn.value.trim().slice(0, MAX_NAME_LEN) || 'Adventurer';
    settingsStore.set({ name });
    onEnter(name, settingsStore.get().color, b);
  };
  enter.onclick = go;
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });

  uiStore.subscribe((u) => {
    $('menu').hidden = u.panel !== 'menu';
    if (u.panel === 'menu') setTimeout(() => nameIn.focus(), 0);
  });
  netStore.subscribe((n) => {
    menuNet.textContent = n.status === 'rejected' ? 'The server refused this character — check your points and perks.'
      : n.status === 'online' ? 'Connected.' : n.status === 'offline' ? 'Your character is saved in this browser until accounts arrive in M1.' : 'Connecting to server…';
  });
}

/** Stat tiles shared by the creator and the in-game character panel. */
export function derivedTiles(b: CharacterBuild): HTMLElement[] {
  const d = derive(b);
  const speed = Math.round((maxSpeed(1, d.speedBonus) / maxSpeed() - 1) * 100);
  const signed = (n: number, unit = '%') => (n > 0 ? `+${n}${unit}` : `${n}${unit}`);
  const tiles: [string, string, number][] = [
    ['HP', String(d.maxHp), d.maxHp - 25],
    ['Mana', String(d.mana), d.mana - 35],
    ['Carry', `${d.carryKg} kg`, d.carryKg - 40],
    ['Speed', signed(speed), speed],
    ['Melee', signed(d.meleePct), d.meleePct],
    ['Ranged', signed(d.rangedPct), d.rangedPct],
    ['Spell', signed(d.spellPct), d.spellPct],
    ['Crit', `${d.critPct}%`, d.critPct - 5],
  ];
  return tiles.map(([k, v, delta]) => {
    const t = el('div');
    t.append(el('span', '', k), el('b', delta > 0 ? 'up' : delta < 0 ? 'down' : '', v));
    return t;
  });
}
