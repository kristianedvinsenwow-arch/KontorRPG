/**
 * Character and account storage. Two implementations behind one interface:
 *  - SupabaseStore: Postgres via Supabase's REST API with the server-only secret key.
 *    Browsers never touch the database; only this server does.
 *  - MemoryStore: for local development and tests; nothing survives a restart.
 * Plain fetch, no SDK, so the server bundle stays small.
 */
import {
  HOMES, STORAGE_MAX, SKILLS, sanitiseAchievements, type AchievementState, computeStats, sanitiseBag, sanitiseEquipment, sanitiseTalents,
  type Bag, type Stack, type CharacterBuild, type Equipment, type QuestState, type SkillXp, type TalentAlloc,
} from '@kontor/shared';
import type { Lease } from './types.js';
import type { Account, AccountStore, Accounts } from './accounts.js';

/** The chest always holds this many slots; how many you can fill depends on your home. */
export const STORAGE_SLOTS = STORAGE_MAX;

export interface StoredCharacter {
  userId: string;
  name: string;
  color: number;
  build: CharacterBuild;
  pos: { x: number; y: number; z: number; yaw: number } | null;
  gold: number;
  bag: Bag;
  equip: Equipment;
  xp: SkillXp;
  talents: TalentAlloc;
  respecs: number;
  quests: QuestState;
  lease: Lease | null;
  storage: Bag;
  achievements: AchievementState;
}

/** Everything that changes while playing. */
export type Progress = Omit<StoredCharacter, 'userId' | 'name' | 'color' | 'build' | 'pos'> & { pos: NonNullable<StoredCharacter['pos']> };

export interface CharacterStore extends AccountStore {
  readonly kind: 'supabase' | 'memory';
  /** Resolve a browser's login token to a user id, or null if it is invalid or expired. */
  verify(token: string): Promise<string | null>;
  load(userId: string): Promise<StoredCharacter | null>;
  create(c: StoredCharacter): Promise<void>;
  save(userId: string, p: Progress): Promise<void>;
  /** Delete the character (reset / reroll). The account stays. */
  remove(userId: string): Promise<void>;
  /** Every current inn lease (so rooms rented by offline players stay taken). */
  leases(): Promise<{ userId: string; name: string; lease: Lease }[]>;
  /** Shared world state (depleted nodes, respawn timers, ground items), kept across restarts. */
  loadWorld(): Promise<WorldSnapshot | null>;
  saveWorld(s: WorldSnapshot): Promise<void>;
}

/** What survives a restart. Times are wall-clock ms. */
export interface WorldSnapshot {
  v: 1;
  /** [node id, hits left, total hits, depleted until (0 = still standing)] */
  nodes: [string, number, number, number][];
  /** [mob id, respawn at] for dead mobs. */
  mobs: [string, number][];
  ground: { item: Stack; x: number; z: number; expires: number }[];
}

export function cleanSnapshot(raw: any): WorldSnapshot | null {
  if (!raw || raw.v !== 1) return null;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return {
    v: 1,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.filter((n: any) => Array.isArray(n) && typeof n[0] === 'string' && num(n[1]) && num(n[2]) && num(n[3])) : [],
    mobs: Array.isArray(raw.mobs) ? raw.mobs.filter((m: any) => Array.isArray(m) && typeof m[0] === 'string' && num(m[1])) : [],
    ground: Array.isArray(raw.ground) ? raw.ground.flatMap((g: any) => {
      const item = sanitiseBag([g?.item], 1)[0];
      return item && num(g.x) && num(g.z) && num(g.expires) ? [{ item, x: g.x, z: g.z, expires: g.expires }] : [];
    }) : [],
  };
}

function sanitiseXp(raw: unknown): SkillXp {
  const out: SkillXp = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of SKILLS) {
    const v = (raw as Record<string, unknown>)[s.id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[s.id] = Math.floor(v);
  }
  return out;
}

function sanitiseQuests(raw: unknown): QuestState {
  if (!raw || typeof raw !== 'object') return {};
  const out: QuestState = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!v || typeof v !== 'object') continue;
    out[k] = { active: v.active === true || undefined, progress: Number.isFinite(v.progress) ? v.progress : undefined, done: typeof v.done === 'string' ? v.done : undefined };
  }
  return out;
}

export function sanitiseLease(raw: any): Lease | null {
  if (!raw || !Number.isInteger(raw.room) || raw.room < 0 || raw.room >= HOMES.length || !Number.isFinite(raw.until)) return null;
  return { room: raw.room, until: raw.until };
}

/** Clean a stored character so content changes never crash a login. */
export function cleanCharacter(c: Omit<StoredCharacter, 'bag' | 'equip' | 'xp' | 'talents' | 'quests' | 'lease' | 'storage' | 'achievements'> & Record<string, any>): StoredCharacter {
  const equip = sanitiseEquipment(c.equip);
  const xp = sanitiseXp(c.xp);
  const talents = sanitiseTalents(c.talents, xp);
  const slots = computeStats(c.build, equip, talents, xp).bagSlots;
  return {
    userId: c.userId, name: c.name, color: c.color, build: c.build, pos: c.pos, gold: Math.max(0, Math.floor(c.gold ?? 0)),
    equip, xp, talents, bag: sanitiseBag(c.bag, slots), respecs: Math.max(0, Math.floor(c.respecs ?? 0)),
    quests: sanitiseQuests(c.quests), lease: sanitiseLease(c.lease), storage: sanitiseBag(c.storage, STORAGE_SLOTS),
    achievements: sanitiseAchievements(c.achievements),
  };
}

interface Row {
  user_id: string; name: string; color: number; race: CharacterBuild['race'];
  attrs: CharacterBuild['attrs']; major_perk: string; minor_perk: string; face: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null; yaw: number; gold: number;
  inventory: unknown; equipment: unknown; skills: unknown; talents: unknown; respecs: number | null;
  quests: unknown; lease: unknown; storage: unknown; achievements: unknown;
}

export class SupabaseStore implements CharacterStore {
  readonly kind = 'supabase' as const;
  /** Signs and checks login tokens (set by main.ts). */
  auth: Accounts | null = null;
  constructor(private readonly url: string, private readonly secretKey: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.secretKey, Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json', ...extra };
  }

  async verify(token: string): Promise<string | null> {
    return token && this.auth ? this.auth.verify(token) : null;
  }

  async findAccount(usernameLower: string): Promise<Account | null> {
    const r = await fetch(`${this.url}/rest/v1/accounts?username_lower=eq.${encodeURIComponent(usernameLower)}&select=id,username,pin_hash`, { headers: this.headers() });
    if (!r.ok) throw new Error(`find account: ${r.status} ${await r.text()}`);
    const row = ((await r.json()) as { id: string; username: string; pin_hash: string }[])[0];
    return row ? { id: row.id, username: row.username, pinHash: row.pin_hash } : null;
  }

  async accountName(id: string): Promise<string | null> {
    const r = await fetch(`${this.url}/rest/v1/accounts?id=eq.${encodeURIComponent(id)}&select=username`, { headers: this.headers() });
    if (!r.ok) throw new Error(`account name: ${r.status} ${await r.text()}`);
    return ((await r.json()) as { username: string }[])[0]?.username ?? null;
  }

  async createAccount(username: string, pinHash: string): Promise<Account | null> {
    const r = await fetch(`${this.url}/rest/v1/accounts`, {
      method: 'POST', headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify({ username, username_lower: username.toLowerCase(), pin_hash: pinHash }),
    });
    if (r.status === 409) return null; // taken
    if (!r.ok) throw new Error(`create account: ${r.status} ${await r.text()}`);
    const row = ((await r.json()) as { id: string; username: string }[])[0];
    return { id: row.id, username: row.username, pinHash };
  }

  async load(userId: string): Promise<StoredCharacter | null> {
    const r = await fetch(`${this.url}/rest/v1/characters?user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: this.headers() });
    if (!r.ok) throw new Error(`load character: ${r.status} ${await r.text()}`);
    const row = ((await r.json()) as Row[])[0];
    if (!row) return null;
    return cleanCharacter({
      userId: row.user_id, name: row.name, color: row.color, gold: row.gold,
      build: { race: row.race, attrs: row.attrs, major: row.major_perk, minor: row.minor_perk, face: row.face ?? 0 },
      pos: row.pos_x == null || row.pos_y == null || row.pos_z == null ? null : { x: row.pos_x, y: row.pos_y, z: row.pos_z, yaw: row.yaw },
      bag: row.inventory, equip: row.equipment, xp: row.skills, talents: row.talents, respecs: row.respecs ?? 0,
      quests: row.quests, lease: row.lease, storage: row.storage, achievements: row.achievements,
    });
  }

  async create(c: StoredCharacter): Promise<void> {
    const body = {
      user_id: c.userId, name: c.name, color: c.color, race: c.build.race, attrs: c.build.attrs,
      major_perk: c.build.major, minor_perk: c.build.minor, face: c.build.face ?? 0, gold: c.gold,
      inventory: c.bag, equipment: c.equip, skills: c.xp, talents: c.talents, quests: c.quests, storage: c.storage, achievements: c.achievements,
    };
    const r = await fetch(`${this.url}/rest/v1/characters`, { method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`create character: ${r.status} ${await r.text()}`);
  }

  async save(userId: string, p: Progress): Promise<void> {
    const body = {
      pos_x: p.pos.x, pos_y: p.pos.y, pos_z: p.pos.z, yaw: p.pos.yaw,
      gold: p.gold, inventory: p.bag, equipment: p.equip, skills: p.xp, talents: p.talents, respecs: p.respecs,
      quests: p.quests, lease: p.lease, storage: p.storage, achievements: p.achievements,
      last_seen: new Date().toISOString(),
    };
    const r = await fetch(`${this.url}/rest/v1/characters?user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`save character: ${r.status} ${await r.text()}`);
  }

  async remove(userId: string): Promise<void> {
    const r = await fetch(`${this.url}/rest/v1/characters?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) });
    if (!r.ok) throw new Error(`delete character: ${r.status} ${await r.text()}`);
  }

  async leases() {
    const r = await fetch(`${this.url}/rest/v1/characters?lease=not.is.null&select=user_id,name,lease`, { headers: this.headers() });
    if (!r.ok) throw new Error(`load leases: ${r.status} ${await r.text()}`);
    const rows = (await r.json()) as { user_id: string; name: string; lease: unknown }[];
    return rows.map((x) => ({ userId: x.user_id, name: x.name, lease: sanitiseLease(x.lease) })).filter((x): x is { userId: string; name: string; lease: Lease } => !!x.lease);
  }

  async loadWorld(): Promise<WorldSnapshot | null> {
    const r = await fetch(`${this.url}/rest/v1/world_state?key=eq.main&select=data`, { headers: this.headers() });
    if (!r.ok) throw new Error(`load world: ${r.status} ${await r.text()}`);
    const row = ((await r.json()) as { data: unknown }[])[0];
    return row ? cleanSnapshot(row.data) : null;
  }

  async saveWorld(s: WorldSnapshot): Promise<void> {
    const r = await fetch(`${this.url}/rest/v1/world_state?on_conflict=key`, {
      method: 'POST', headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key: 'main', data: s, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`save world: ${r.status} ${await r.text()}`);
  }
}

/** In-memory store. Tokens of the form "dev:<userId>" are accepted so tests can log in. */
export class MemoryStore implements CharacterStore {
  readonly kind = 'memory' as const;
  readonly rows = new Map<string, StoredCharacter>();
  auth: Accounts | null = null;
  private accounts = new Map<string, Account>();
  async verify(token: string) { return token.startsWith('dev:') ? token.slice(4) : this.auth?.verify(token) ?? null; }
  async findAccount(k: string) { return this.accounts.get(k) ?? null; }
  async accountName(id: string) { for (const a of this.accounts.values()) if (a.id === id) return a.username; return null; }
  async createAccount(username: string, pinHash: string) {
    const k = username.toLowerCase();
    if (this.accounts.has(k)) return null;
    const a = { id: `acc-${this.accounts.size + 1}-${k}`, username, pinHash };
    this.accounts.set(k, a);
    return a;
  }
  async load(userId: string) { const r = this.rows.get(userId); return r ? cleanCharacter(structuredClone(r)) : null; }
  async create(c: StoredCharacter) { this.rows.set(c.userId, structuredClone(c)); }
  async save(userId: string, p: Progress) { const r = this.rows.get(userId); if (r) Object.assign(r, structuredClone(p)); }
  async remove(userId: string) { this.rows.delete(userId); }
  world: WorldSnapshot | null = null;
  async loadWorld() { return this.world ? cleanSnapshot(structuredClone(this.world)) : null; }
  async saveWorld(s: WorldSnapshot) { this.world = structuredClone(s); }
  async leases() {
    return [...this.rows.values()].filter((r) => r.lease).map((r) => ({ userId: r.userId, name: r.name, lease: r.lease! }));
  }
}
