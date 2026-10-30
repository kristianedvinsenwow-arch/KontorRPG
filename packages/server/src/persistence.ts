/**
 * Character storage. Two implementations behind one interface:
 *  - SupabaseStore: Postgres via Supabase's REST API with the server-only secret key.
 *    Browsers can read their own row (RLS) but never write — only this server does.
 *  - MemoryStore: for local development and tests; nothing survives a restart.
 * Plain fetch, no SDK, so the server bundle stays small.
 */
import {
  INN, SKILLS, computeStats, sanitiseBag, sanitiseEquipment, sanitiseTalents,
  type Bag, type CharacterBuild, type Equipment, type QuestState, type SkillXp, type TalentAlloc,
} from '@kontor/shared';
import type { Lease } from './types.js';

export const STORAGE_SLOTS = 24;

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
}

/** Everything that changes while playing. */
export type Progress = Omit<StoredCharacter, 'userId' | 'name' | 'color' | 'build' | 'pos'> & { pos: NonNullable<StoredCharacter['pos']> };

export interface CharacterStore {
  readonly kind: 'supabase' | 'memory';
  /** Resolve a browser's login token to a user id, or null if it is invalid or expired. */
  verify(token: string): Promise<string | null>;
  load(userId: string): Promise<StoredCharacter | null>;
  create(c: StoredCharacter): Promise<void>;
  save(userId: string, p: Progress): Promise<void>;
  /** Every current inn lease (so rooms rented by offline players stay taken). */
  leases(): Promise<{ userId: string; name: string; lease: Lease }[]>;
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
  if (!raw || !Number.isInteger(raw.room) || raw.room < 0 || raw.room >= INN.rooms || !Number.isFinite(raw.until)) return null;
  return { room: raw.room, until: raw.until };
}

/** Clean a stored character so content changes never crash a login. */
export function cleanCharacter(c: Omit<StoredCharacter, 'bag' | 'equip' | 'xp' | 'talents' | 'quests' | 'lease' | 'storage'> & Record<string, any>): StoredCharacter {
  const equip = sanitiseEquipment(c.equip);
  const xp = sanitiseXp(c.xp);
  const talents = sanitiseTalents(c.talents, xp);
  const slots = computeStats(c.build, equip, talents, xp).bagSlots;
  return {
    userId: c.userId, name: c.name, color: c.color, build: c.build, pos: c.pos, gold: Math.max(0, Math.floor(c.gold ?? 0)),
    equip, xp, talents, bag: sanitiseBag(c.bag, slots), respecs: Math.max(0, Math.floor(c.respecs ?? 0)),
    quests: sanitiseQuests(c.quests), lease: sanitiseLease(c.lease), storage: sanitiseBag(c.storage, STORAGE_SLOTS),
  };
}

interface Row {
  user_id: string; name: string; color: number; race: CharacterBuild['race'];
  attrs: CharacterBuild['attrs']; major_perk: string; minor_perk: string; face: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null; yaw: number; gold: number;
  inventory: unknown; equipment: unknown; skills: unknown; talents: unknown; respecs: number | null;
  quests: unknown; lease: unknown; storage: unknown;
}

export class SupabaseStore implements CharacterStore {
  readonly kind = 'supabase' as const;
  constructor(private readonly url: string, private readonly publishableKey: string, private readonly secretKey: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.secretKey, Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json', ...extra };
  }

  async verify(token: string): Promise<string | null> {
    if (!token || token.length > 4096) return null;
    const r = await fetch(`${this.url}/auth/v1/user`, { headers: { apikey: this.publishableKey, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: string };
    return typeof u.id === 'string' ? u.id : null;
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
      quests: row.quests, lease: row.lease, storage: row.storage,
    });
  }

  async create(c: StoredCharacter): Promise<void> {
    const body = {
      user_id: c.userId, name: c.name, color: c.color, race: c.build.race, attrs: c.build.attrs,
      major_perk: c.build.major, minor_perk: c.build.minor, face: c.build.face ?? 0, gold: c.gold,
      inventory: c.bag, equipment: c.equip, skills: c.xp, talents: c.talents, quests: c.quests, storage: c.storage,
    };
    const r = await fetch(`${this.url}/rest/v1/characters`, { method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`create character: ${r.status} ${await r.text()}`);
  }

  async save(userId: string, p: Progress): Promise<void> {
    const body = {
      pos_x: p.pos.x, pos_y: p.pos.y, pos_z: p.pos.z, yaw: p.pos.yaw,
      gold: p.gold, inventory: p.bag, equipment: p.equip, skills: p.xp, talents: p.talents, respecs: p.respecs,
      quests: p.quests, lease: p.lease, storage: p.storage,
      last_seen: new Date().toISOString(),
    };
    const r = await fetch(`${this.url}/rest/v1/characters?user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`save character: ${r.status} ${await r.text()}`);
  }

  async leases() {
    const r = await fetch(`${this.url}/rest/v1/characters?lease=not.is.null&select=user_id,name,lease`, { headers: this.headers() });
    if (!r.ok) throw new Error(`load leases: ${r.status} ${await r.text()}`);
    const rows = (await r.json()) as { user_id: string; name: string; lease: unknown }[];
    return rows.map((x) => ({ userId: x.user_id, name: x.name, lease: sanitiseLease(x.lease) })).filter((x): x is { userId: string; name: string; lease: Lease } => !!x.lease);
  }
}

/** In-memory store. Tokens of the form "dev:<userId>" are accepted so tests can log in. */
export class MemoryStore implements CharacterStore {
  readonly kind = 'memory' as const;
  readonly rows = new Map<string, StoredCharacter>();
  async verify(token: string) { return token.startsWith('dev:') ? token.slice(4) : null; }
  async load(userId: string) { const r = this.rows.get(userId); return r ? cleanCharacter(structuredClone(r)) : null; }
  async create(c: StoredCharacter) { this.rows.set(c.userId, structuredClone(c)); }
  async save(userId: string, p: Progress) { const r = this.rows.get(userId); if (r) Object.assign(r, structuredClone(p)); }
  async leases() {
    return [...this.rows.values()].filter((r) => r.lease).map((r) => ({ userId: r.userId, name: r.name, lease: r.lease! }));
  }
}
