import { defaultBuild, validateBuild, type CharacterBuild, type Race } from '@kontor/shared';

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
  panel: 'none' | 'menu' | 'character' | 'pause';
  chatOpen: boolean;
  bossKey: boolean;
}

export interface Settings {
  name: string;
  color: number;
  sensitivity: number;
  lowGpu: boolean;
  /** Character build from the creator. Kept in the browser until M1 stores characters on the server. */
  build: CharacterBuild;
}

const SETTINGS_KEY = 'kontorrpg.settings';

/** Settings are a per-browser convenience, so localStorage is the right home (wrapped: it can throw). */
export function loadSettings(): Settings {
  const d: Settings = { name: '', color: Math.floor(Math.random() * 8), sensitivity: 1, lowGpu: false, build: defaultBuild() };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = { ...d, ...JSON.parse(raw) } as Settings;
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
export const uiStore = createStore<UiState>({ panel: 'menu', chatOpen: false, bossKey: false });
export const settingsStore = createStore<Settings>(loadSettings());
settingsStore.subscribe(saveSettings);
