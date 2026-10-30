import type { CharacterBuild, Race } from './character.js';
import type { Bag, Equipment, Slot } from './items.js';
import type { SkillId } from './skills.js';

/**
 * Wire protocol. JSON for M0 (readable while we iterate); the shape is designed so it can move to a
 * binary codec later without touching game code — only encode/decode change.
 */

export interface PlayerState {
  id: string;
  name: string;
  color: number; // index into PLAYER_COLORS
  race: Race;
  /** Face index (FACES). */
  face?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Horizontal speed in m/s, used to drive the walk animation of remote players. */
  spd: number;
  /** Optional action being played (e.g. a pickaxe swing), shown to others. */
  act?: 'swing';
  /** Visible gear: t = tool, m = main hand, s = shoulders, b = back (bag). */
  gear?: { t?: string; m?: string; s?: string; b?: string };
}

// ---------- client → server ----------
export type ClientMsg =
  /** `token` is the Supabase login token when accounts are enabled; omitted for guests. */
  | { t: 'hello'; name: string; color: number; proto: number; build: CharacterBuild; token?: string }
  | { t: 'input'; seq: number; x: number; y: number; z: number; yaw: number; pitch: number; act?: 'swing' }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number }
  | { t: 'mine'; node: string }
  | { t: 'craft'; recipe: string; count: number }
  | { t: 'cancelCraft' }
  | { t: 'equip'; index: number }
  | { t: 'unequip'; slot: Slot }
  | { t: 'buy'; item: string }
  | { t: 'sell'; index: number; qty: number };

// ---------- server → client ----------
export type ServerMsg =
  /** `character` is what the server will use — for a saved account it may differ from what the client sent. */
  | { t: 'welcome'; id: string; build: string; proto: number; tickHz: number; you: PlayerState; character: { name: string; color: number; build: CharacterBuild }; saved: boolean }
  | { t: 'snap'; tick: number; at: number; players: PlayerState[] }
  | { t: 'leave'; id: string }
  /** Everyone online, wherever they are (snapshots only carry players inside your area of interest). */
  | { t: 'roster'; players: { id: string; name: string; color: number; race: Race; face?: number }[] }
  | { t: 'correct'; seq: number; x: number; y: number; z: number; reason: string }
  | { t: 'chat'; from: string; name: string; text: string; at: number }
  | { t: 'system'; text: string }
  | { t: 'pong'; at: number }
  | { t: 'reject'; reason: string }
  /** Your bag, equipment and gold (sent whenever they change). */
  | { t: 'inv'; bag: Bag; equip: Equipment; gold: number }
  | { t: 'skills'; xp: Partial<Record<SkillId, number>> }
  /** Something you gained: XP and/or an item (drives the pop-ups). */
  | { t: 'gain'; skill?: SkillId; xp?: number; item?: string; qty?: number; rare?: boolean }
  /** Vein changes: [id, 1] depleted, [id, 0] back. When it returns is deliberately not sent. */
  | { t: 'nodes'; depleted: [string, 0 | 1][] }
  /** Your crafting queue (recipe null = idle). */
  | { t: 'job'; recipe: string | null; done: number; total: number; seconds: number }
  | { t: 'notice'; text: string; kind: 'error' | 'info' | 'rare' };

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/** Round to centimetres / milliradians before sending: smaller packets, same visual result. */
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parse and validate an untrusted client message. Anything malformed returns null and is dropped.
 * The server never trusts shape, size or values coming from a browser.
 */
export function decodeClient(raw: string): ClientMsg | null {
  if (raw.length > 2048) return null;
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello':
      if (typeof m.name !== 'string' || !num(m.color) || !num(m.proto)) return null;
      // The build's contents are checked by validateBuild on the server; here only its shape.
      return { t: 'hello', name: m.name, color: m.color, proto: m.proto, build: m.build && typeof m.build === 'object' ? m.build : null, token: typeof m.token === 'string' ? m.token : undefined };
    case 'input':
      if (![m.seq, m.x, m.y, m.z, m.yaw, m.pitch].every(num)) return null;
      return { t: 'input', seq: m.seq, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, act: m.act === 'swing' ? 'swing' : undefined };
    case 'chat':
      if (typeof m.text !== 'string') return null;
      return { t: 'chat', text: m.text };
    case 'ping':
      if (!num(m.at)) return null;
      return { t: 'ping', at: m.at };
    case 'mine':
      return typeof m.node === 'string' && m.node.length < 40 ? { t: 'mine', node: m.node } : null;
    case 'craft':
      return typeof m.recipe === 'string' && num(m.count) ? { t: 'craft', recipe: m.recipe, count: Math.max(1, Math.min(100, Math.floor(m.count))) } : null;
    case 'cancelCraft':
      return { t: 'cancelCraft' };
    case 'equip':
      return num(m.index) ? { t: 'equip', index: Math.floor(m.index) } : null;
    case 'unequip':
      return typeof m.slot === 'string' ? { t: 'unequip', slot: m.slot as Slot } : null;
    case 'buy':
      return typeof m.item === 'string' ? { t: 'buy', item: m.item } : null;
    case 'sell':
      return num(m.index) && num(m.qty) ? { t: 'sell', index: Math.floor(m.index), qty: Math.max(1, Math.floor(m.qty)) } : null;
    default:
      return null;
  }
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const m = JSON.parse(raw);
    return m && typeof m.t === 'string' ? (m as ServerMsg) : null;
  } catch {
    return null;
  }
}
