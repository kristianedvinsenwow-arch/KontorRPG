import { defaultBuild, validateBuild, type Bag, type CharacterBuild, type Equipment, type Race, type SkillId, type StationId } from '@kontor/shared';

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
  panel: 'none' | 'menu' | 'character' | 'pause' | 'inventory' | 'skills' | 'craft' | 'shop';
  /** Which station the crafting panel is for. */
  station: StationId;
  chatOpen: boolean;
  bossKey: boolean;
}

export interface Settings {
  name: string;
  color: number;
  sensitivity: number;
  /** Graphics quality: low = no shadows or post-processing (thin laptops), high = ambient occlusion too. */
  quality: 'low' | 'medium' | 'high';
  /** Character build from the creator. Kept in the browser until M1 stores characters on the server. */
  build: CharacterBuild;
}

const SETTINGS_KEY = 'kontorrpg.settings';

/** Settings are a per-browser convenience, so localStorage is the right home (wrapped: it can throw). */
export function loadSettings(): Settings {
  const d: Settings = { name: '', color: Math.floor(Math.random() * 8), sensitivity: 1, quality: 'high', build: defaultBuild() };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const s = { ...d, ...parsed } as Settings;
      if (parsed.lowGpu === true && !parsed.quality) s.quality = 'low'; // older saved setting
      if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'high';
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
export const uiStore = createStore<UiState>({ panel: 'menu', station: 'anvil', chatOpen: false, bossKey: false });

/** What the server says you own and know. Only changed by server messages. */
export interface GameState {
  bag: Bag;
  equip: Equipment;
  gold: number;
  xp: Partial<Record<SkillId, number>>;
  /** Crafting queue; `endsAt` is when the current item finishes (performance.now ms). */
  job: { recipe: string; done: number; total: number; endsAt: number; seconds: number } | null;
}
export const gameStore = createStore<GameState>({ bag: [], equip: {}, gold: 0, xp: {}, job: null });
export const settingsStore = createStore<Settings>(loadSettings());
settingsStore.subscribe(saveSettings);
