import { defaultBuild, validateBuild, type Bag, type Buff, type CharacterBuild, type Equipment, type HoldSlot, type QuestState, type Race, type SkillXp, type TalentAlloc } from '@kontor/shared';

/**
 * Tiny subscribable store. Three layers live in the app (design doc §11):
 *  - net state: what the server told us (who is online, our id, ping) — only changed by server messages
 *  - sim state: positions and animation, rebuilt every frame (kept on the objects, not here)
 *  - UI state: open panels, settings
 */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: (s: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<(s: T) => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const f of subs) f(state);
    },
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
  };
}

export interface NetState {
  status: 'offline' | 'connecting' | 'online' | 'restarting' | 'rejected';
  myId: string | null;
  build: string | null;
  pingMs: number | null;
  online: { id: string; name: string; color: number; race: Race }[];
}

export interface UiState {
  panel: 'none' | 'menu' | 'character' | 'pause' | 'skills' | 'craft' | 'npc' | 'home' | 'talents' | 'map' | 'achievements';
  /** Tab in the character menu (C): the sheet itself, talents, achievements, or quests. */
  charTab: 'sheet' | 'talents' | 'achievements' | 'quests';
  /** Which home the door dialog is for (HOMES id). */
  home: number;
  /** Which station the crafting panel is for (station id). */
  station: string;
  /** Which NPC the dialog is for. */
  npc: string;
  chatOpen: boolean;
  bossKey: boolean;
}

export interface Settings {
  name: string;
  color: number;
  sensitivity: number;
  /** Graphics quality: low = no shadows or post-processing (thin laptops), high = ambient occlusion too. */
  quality: 'low' | 'medium' | 'high';
  /** Sound volumes 0..1. */
  volume: { master: number; sfx: number; amb: number };
  /** Character build from the creator. Kept in the browser until M1 stores characters on the server. */
  build: CharacterBuild;
}

const SETTINGS_KEY = 'kontorrpg.settings';

/** Settings are a per-browser convenience, so localStorage is the right home (wrapped: it can throw). */
export function loadSettings(): Settings {
  const d: Settings = { name: '', color: Math.floor(Math.random() * 8), sensitivity: 1, quality: 'high', volume: { master: 0.8, sfx: 0.9, amb: 0.6 }, build: defaultBuild() };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const s = { ...d, ...parsed } as Settings;
      if (parsed.lowGpu === true && !parsed.quality) s.quality = 'low'; // older saved setting
      if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'high';
      if (!s.volume || typeof s.volume.master !== 'number') s.volume = d.volume;
      if (validateBuild(s.build)) s.build = defaultBuild(); // rules changed since it was saved
      return s;
    }
  } catch { /* private window or blocked storage */ }
  return d;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const netStore = createStore<NetState>({ status: 'offline', myId: null, build: null, pingMs: null, online: [] });
export const uiStore = createStore<UiState>({ panel: 'menu', station: 'village_anvil', npc: 'ingrid', charTab: 'sheet', home: 0, chatOpen: false, bossKey: false });

/** What the server says you own and know. Only changed by server messages. */
export interface GameState {
  bag: Bag;
  equip: Equipment;
  gold: number;
  held: HoldSlot;
  xp: SkillXp;
  hp: number;
  maxHp: number;
  dead: boolean;
  buffs: Buff[];
  talents: TalentAlloc;
  respecs: number;
  quests: QuestState;
  lease: { room: number | null; until: number | null; storage: Bag };
  rooms: (string | null)[];
  /** When the next potion can be drunk (epoch ms). */
  potionReady: number;
  /** Achievement counters, finished ones and the chosen title. */
  ach: { c: Record<string, number>; done: string[]; title: string | null };
  /** Riding this mount (item id), or null. */
  mounted: string | null;
  /** Right-click ready again at (Date.now ms). */
  specialReady: number;
  /** When you last took damage (Date.now ms): food is locked for a while after. */
  hurtAt: number;
  /** Crafting queue; `endsAt` is when the current item finishes (performance.now ms). */
  job: { recipe: string; done: number; total: number; endsAt: number; seconds: number } | null;
}
export const gameStore = createStore<GameState>({
  bag: [], equip: {}, gold: 0, held: 'mainHand', xp: {}, hp: 1, maxHp: 1, dead: false, buffs: [], talents: {}, respecs: 0, quests: {},
  lease: { room: null, until: null, storage: [] }, rooms: [], potionReady: 0, ach: { c: {}, done: [], title: null }, mounted: null, specialReady: 0, hurtAt: 0, job: null,
});
export const settingsStore = createStore<Settings>(loadSettings());
settingsStore.subscribe(saveSettings);
