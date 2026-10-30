/**
 * Accounts through Supabase Auth (email magic link — works for remote colleagues, no passwords).
 * The server tells us whether accounts are on via /config; if not, everyone is a guest.
 * The browser may only READ its own character (row-level security); the game server writes it.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { validateBuild, type CharacterBuild } from '@kontor/shared';

export interface ClientConfig { accounts: boolean; requireLogin: boolean; supabaseUrl: string | null; supabaseKey: string | null }

export interface SavedCharacter { name: string; color: number; build: CharacterBuild }

export class Auth {
  config: ClientConfig = { accounts: false, requireLogin: false, supabaseUrl: null, supabaseKey: null };
  private sb: SupabaseClient | null = null;
  session: Session | null = null;
  private listeners: (() => void)[] = [];

  async init(): Promise<void> {
    try {
      const r = await fetch('/config', { cache: 'no-store' });
      if (r.ok) this.config = await r.json();
    } catch { /* offline or dev without server: guests only */ }
    if (!this.config.accounts || !this.config.supabaseUrl || !this.config.supabaseKey) return;
    this.sb = createClient(this.config.supabaseUrl, this.config.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    const { data } = await this.sb.auth.getSession();
    this.session = data.session;
    this.sb.auth.onAuthStateChange((_e, s) => { this.session = s; this.emit(); });
    // Clean the login tokens out of the address bar after a magic-link redirect.
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  }

  onChange(f: () => void): void { this.listeners.push(f); }
  private emit(): void { for (const f of this.listeners) f(); }

  get enabled(): boolean { return !!this.sb; }
  get email(): string | null { return this.session?.user.email ?? null; }
  /** Always the freshest token (Supabase refreshes it in the background). */
  get token(): string | undefined { return this.session?.access_token; }

  async sendLink(email: string): Promise<string | null> {
    if (!this.sb) return 'Accounts are not enabled on this server.';
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    return error ? error.message : null;
  }

  async signOut(): Promise<void> {
    await this.sb?.auth.signOut();
    this.session = null;
    this.emit();
  }

  /** The player's saved character, read straight from the database (allowed by RLS for your own row). */
  async loadCharacter(): Promise<SavedCharacter | null> {
    if (!this.sb || !this.session) return null;
    const { data, error } = await this.sb.from('characters').select('name,color,race,attrs,major_perk,minor_perk').maybeSingle();
    if (error || !data) return null;
    const build: CharacterBuild = { race: data.race, attrs: data.attrs, major: data.major_perk, minor: data.minor_perk };
    return validateBuild(build) ? null : { name: data.name, color: data.color, build };
  }
}
