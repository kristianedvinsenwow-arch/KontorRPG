/**
 * Accounts: a username and a 4–6 digit PIN, checked by the game server (POST /api/login). The
 * username is remembered in this browser, so coming back is just the PIN. The PIN itself is never
 * stored. The login token (signed, 30 days) is kept in this browser too, so a reload — e.g. when a
 * new version goes live — keeps you logged in. "Log out" forgets it.
 */
import type { CharacterBuild, Equipment, SkillXp } from '@kontor/shared';

export interface ClientConfig { accounts: boolean; requireLogin: boolean }
export interface SavedCharacter { name: string; color: number; build: CharacterBuild; gold?: number; equip?: Equipment; xp?: SkillXp; title?: string | null }

const USER_KEY = 'kontorrpg.username';
const TOKEN_KEY = 'kontorrpg.token';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } } };

export class Auth {
  config: ClientConfig = { accounts: false, requireLogin: false };
  /** Logged in as … (null = guest / not yet). */
  username: string | null = null;
  character: SavedCharacter | null = null;
  private tokenValue: string | undefined;
  private listeners: (() => void)[] = [];

  async init(): Promise<void> {
    try {
      const r = await fetch('/config', { cache: 'no-store' });
      if (r.ok) this.config = await r.json();
    } catch { /* offline or dev without server: guests only */ }
    // Resume a saved login.
    const token = store.get(TOKEN_KEY);
    if (token && this.config.accounts) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
          if (r.status === 401) { store.set(TOKEN_KEY, null); break; }
          if (!r.ok) throw new Error(String(r.status));
          const b = await r.json();
          this.tokenValue = token; this.username = b.username; this.character = b.character ?? null;
          store.set(USER_KEY, b.username);
          break;
        } catch { await new Promise((ok) => setTimeout(ok, 1500)); } // server starting up: try again
      }
    }
  }

  onChange(f: () => void): void { this.listeners.push(f); }
  private emit(): void { for (const f of this.listeners) f(); }

  get enabled(): boolean { return this.config.accounts; }
  get token(): string | undefined { return this.tokenValue; }
  get loggedIn(): boolean { return !!this.tokenValue; }

  /** The username this browser used last (so you only type your PIN). */
  get remembered(): string {
    try { return localStorage.getItem(USER_KEY) ?? ''; } catch { return ''; }
  }
  forget(): void { try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ } this.emit(); }

  /** Log in, or create the account first. Returns an error message for the player, or null. */
  async login(user: string, pin: string, create: boolean): Promise<string | null> {
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, pin, create }) });
      const b = await r.json();
      if (!r.ok || !b.token) return b.error ?? 'Login failed.';
      this.tokenValue = b.token;
      this.username = b.username;
      this.character = b.character ?? null;
      store.set(USER_KEY, b.username);
      store.set(TOKEN_KEY, b.token);
      this.emit();
      return null;
    } catch {
      return 'Can’t reach the server.';
    }
  }

  /** Delete your character (PIN asked again). Returns an error message, or null. */
  async resetCharacter(pin: string): Promise<string | null> {
    if (!this.tokenValue || !this.username) return 'Log in first.';
    try {
      const r = await fetch('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: this.tokenValue, user: this.username, pin }) });
      const b = await r.json();
      if (!r.ok || !b.ok) return b.error ?? 'Reset failed.';
      this.character = null;
      this.emit();
      return null;
    } catch {
      return 'Can’t reach the server.';
    }
  }

  signOut(): void {
    store.set(TOKEN_KEY, null);
    this.tokenValue = undefined;
    this.username = null;
    this.character = null;
    this.emit();
  }

  /** Your saved character (sent by the server at login). */
  async loadCharacter(): Promise<SavedCharacter | null> { return this.character; }
}
