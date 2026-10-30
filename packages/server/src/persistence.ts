/**
 * Character storage. Two implementations behind one interface:
 *  - SupabaseStore: Postgres via Supabase's REST API with the server-only secret key.
 *    Browsers can read their own row (RLS) but never write — only this server does.
 *  - MemoryStore: for local development and tests; nothing survives a restart.
 * Plain fetch, no SDK, so the server bundle stays small.
 */
import {
  bagCapacity, derive, sanitiseBag, sanitiseEquipment, SKILLS,
  type Bag, type CharacterBuild, type Equipment, type SkillId,
} from '@kontor/shared';

export interface StoredCharacter {
  userId: string;
  name: string;
  color: number;
  build: CharacterBuild;
  pos: { x: number; y: number; z: number; yaw: number } | null;
  gold: number;
  bag: Bag;
  equip: Equipment;
  xp: Partial<Record<SkillId, number>>;
}

/** Everything that changes while playing. */
export type Progress = Pick<StoredCharacter, 'bag' | 'equip' | 'gold' | 'xp'> & { pos: NonNullable<StoredCharacter['pos']> };

export interface CharacterStore {
  readonly kind: 'supabase' | 'memory';
  /** Resolve a browser's login token to a user id, or null if it is invalid or expired. */
  verify(token: string): Promise<string | null>;
  load(userId: string): Promise<StoredCharacter | null>;
  create(c: StoredCharacter): Promise<void>;
  save(userId: string, p: Progress): Promise<void>;
}

interface Row {
  user_id: string; name: string; color: number; race: CharacterBuild['race'];
  attrs: CharacterBuild['attrs']; major_perk: string; minor_perk: string; face: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null; yaw: number; gold: number;
  inventory: unknown; equipment: unknown; skills: unknown;
}

function sanitiseXp(raw: unknown): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of SKILLS) {
    const v = (raw as Record<string, unknown>)[s.id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[s.id] = Math.floor(v);
  }
  return out;
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
    const rows = (await r.json()) as Row[];
    const row = rows[0];
    if (!row) return null;
    const build: CharacterBuild = { race: row.race, attrs: row.attrs, major: row.major_perk, minor: row.minor_perk, face: row.face ?? 0 };
    const equip = sanitiseEquipment(row.equipment);
    return {
      userId: row.user_id, name: row.name, color: row.color, gold: row.gold, build, equip,
      bag: sanitiseBag(row.inventory, bagCapacity(derive(build).bagBonus, equip)),
      xp: sanitiseXp(row.skills),
      pos: row.pos_x == null || row.pos_y == null || row.pos_z == null ? null : { x: row.pos_x, y: row.pos_y, z: row.pos_z, yaw: row.yaw },
    };
  }

  async create(c: StoredCharacter): Promise<void> {
    const body = {
      user_id: c.userId, name: c.name, color: c.color, race: c.build.race, attrs: c.build.attrs,
      major_perk: c.build.major, minor_perk: c.build.minor, face: c.build.face ?? 0, gold: c.gold,
      inventory: c.bag, equipment: c.equip, skills: c.xp,
    };
    const r = await fetch(`${this.url}/rest/v1/characters`, { method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`create character: ${r.status} ${await r.text()}`);
  }

  async save(userId: string, p: Progress): Promise<void> {
    const body = {
      pos_x: p.pos.x, pos_y: p.pos.y, pos_z: p.pos.z, yaw: p.pos.yaw,
      gold: p.gold, inventory: p.bag, equipment: p.equip, skills: p.xp,
      last_seen: new Date().toISOString(),
    };
    const r = await fetch(`${this.url}/rest/v1/characters?user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`save character: ${r.status} ${await r.text()}`);
  }
}

/** In-memory store. Tokens of the form "dev:<userId>" are accepted so tests can log in. */
export class MemoryStore implements CharacterStore {
  readonly kind = 'memory' as const;
  readonly rows = new Map<string, StoredCharacter>();
  async verify(token: string) { return token.startsWith('dev:') ? token.slice(4) : null; }
  async load(userId: string) { const r = this.rows.get(userId); return r ? structuredClone(r) : null; }
  async create(c: StoredCharacter) { this.rows.set(c.userId, structuredClone(c)); }
  async save(userId: string, p: Progress) { const r = this.rows.get(userId); if (r) Object.assign(r, structuredClone(p)); }
}
