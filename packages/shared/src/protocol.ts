import type { CharacterBuild, Race } from './character.js';
import type { Bag, Equipment, Slot, Stack } from './items.js';
import type { SkillId, SkillXp } from './skills.js';
import type { TalentAlloc, TreeId } from './talents.js';
import type { MobKind } from './mobs.js';
import type { QuestState } from './quests.js';
import type { Buff } from './player.js';

/**
 * Wire protocol. JSON for now; the shapes are designed so a binary codec can replace encode/decode
 * later without touching game code. The server validates every client message (decodeClient).
 */

export interface PlayerState {
  id: string;
  name: string;
  color: number; // index into PLAYER_COLORS
  race: Race;
  face?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Horizontal speed in m/s, drives the walk animation. */
  spd: number;
  /** Action being played, shown to others. */
  act?: 'swing' | 'shoot' | 'cast' | 'spin' | 'fish';
  /** Visible gear: h = held item, s = shoulders, b = back, hd = head, c = chest, l = legs, o = off hand. */
  gear?: { h?: string; s?: string; b?: string; hd?: string; c?: string; l?: string; o?: string };
  hp?: number;
  mhp?: number;
  /** Riding this mount (item id). */
  mnt?: string;
  /** Chosen title (shown under the name). */
  title?: string;
}

/** Status flags on mobs. */
export const ST_BURN = 1, ST_SLOW = 2, ST_FROZEN = 4, ST_DEAD = 8, ST_ANGRY = 16;

export interface MobState { id: string; k: MobKind; x: number; y: number; z: number; yaw: number; hp: number; mhp: number; st: number; bs?: number; act?: 'atk' | 'slam'; /** A body that can still be skinned. */ sk?: 1 }

export interface GroundItem { id: number; item: Stack; x: number; y: number; z: number }

export type HoldSlot = 'mainHand' | 'pickaxe' | 'hatchet' | 'rod';

// ---------- client → server ----------
export type ClientMsg =
  /** `token` is the Supabase login token when accounts are enabled; omitted for guests. */
  | { t: 'hello'; name: string; color: number; proto: number; build: CharacterBuild; token?: string }
  | { t: 'input'; seq: number; x: number; y: number; z: number; yaw: number; pitch: number; act?: PlayerState['act'] }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number }
  | { t: 'mine'; node: string }
  | { t: 'chop'; node: string }
  | { t: 'pick'; node: string }
  | { t: 'cast'; x: number; z: number }
  | { t: 'reel'; ok: boolean }
  | { t: 'craft'; recipe: string; count: number; station: string }
  | { t: 'cancelCraft' }
  | { t: 'equip'; index: number }
  | { t: 'unequip'; slot: Slot }
  | { t: 'hold'; slot: HoldSlot }
  | { t: 'buy'; npc: string; item: string }
  | { t: 'sell'; npc: string; index: number; qty: number }
  | { t: 'drop'; index: number; qty: number }
  | { t: 'pickup'; id: number }
  | { t: 'attack'; target: string; special: boolean }
  | { t: 'eat'; index: number }
  | { t: 'talent'; tree: TreeId; node: string }
  | { t: 'respec'; tree: TreeId }
  | { t: 'rent'; weeks: number; home?: number }
  | { t: 'rest' }
  /** Mount up / get off (the mount in your mount slot). */
  | { t: 'mount' }
  /** Show an earned title under your name (achievement id), or none. */
  | { t: 'title'; id: string | null }
  /** Open or close your lodge room's door. */
  | { t: 'door'; home: number }
  | { t: 'storage'; op: 'put' | 'take'; index: number; qty: number }
  | { t: 'quest'; quest: string; op: 'accept' | 'turnin' | 'abandon' }
  | { t: 'imbue'; index: number; element: 'fire' | 'frost' | 'life' }
  | { t: 'heal'; target: string }
  | { t: 'travel'; portal: string }
  | { t: 'respawn' }
  | { t: 'skin'; target: string }
  | { t: 'repair'; slot: Slot };

// ---------- server → client ----------
export type ServerMsg =
  | { t: 'welcome'; id: string; build: string; proto: number; tickHz: number; you: PlayerState; character: { name: string; color: number; build: CharacterBuild }; saved: boolean }
  | { t: 'snap'; tick: number; at: number; players: PlayerState[]; mobs: MobState[] }
  | { t: 'leave'; id: string }
  | { t: 'roster'; players: { id: string; name: string; color: number; race: Race; face?: number }[] }
  | { t: 'correct'; seq: number; x: number; y: number; z: number; reason: string }
  | { t: 'chat'; from: string; name: string; text: string; at: number }
  | { t: 'system'; text: string }
  | { t: 'pong'; at: number }
  | { t: 'reject'; reason: string }
  | { t: 'inv'; bag: Bag; equip: Equipment; gold: number; held: HoldSlot }
  | { t: 'skills'; xp: SkillXp }
  | { t: 'gain'; skill?: SkillId; xp?: number; item?: string; qty?: number; rare?: boolean; r?: number }
  /** Node changes (veins and trees): [id, 1] depleted, [id, 0] back. When it returns is never sent. */
  | { t: 'nodes'; depleted: [string, 0 | 1][] }
  /** How used-up a node is (shared by everyone hitting it). */
  | { t: 'node'; id: string; left: number; total: number }
  | { t: 'job'; recipe: string | null; done: number; total: number; seconds: number }
  | { t: 'notice'; text: string; kind: 'error' | 'info' | 'rare' }
  | { t: 'talents'; alloc: TalentAlloc; respecs: number }
  | { t: 'quests'; state: QuestState }
  | { t: 'lease'; room: number | null; until: number | null; storage: Bag }
  | { t: 'rooms'; taken: (string | null)[] }
  /** Which lodge room doors stand open (room ids). */
  | { t: 'doors'; open: number[] }
  | { t: 'ground'; add?: GroundItem[]; remove?: number[] }
  | { t: 'hp'; hp: number; max: number }
  | { t: 'buffs'; list: Buff[] }
  | { t: 'hit'; to: string; dmg: number; crit?: boolean; kind: 'phys' | 'magic' | 'burn' | 'heal' | 'block' | 'dodge'; from?: string }
  | { t: 'fx'; kind: 'arrow' | 'firebolt' | 'frostbolt' | 'spin' | 'nova' | 'ignite' | 'slam' | 'slamWarn' | 'magic' | 'guard' | 'heal' | 'mend'; from: string; to?: string }
  | { t: 'fish'; state: 'bite'; difficulty: number; seconds: number }
  | { t: 'fish'; state: 'cast' | 'lost' | 'caught' | 'cancel' }
  | { t: 'dead'; by: string }
  | { t: 'cooldown'; until: number }
  /** Potion cooldown: the next potion can be drunk at this time (epoch ms). */
  | { t: 'potion'; ready: number }
  /** You mounted (item id) or dismounted (null). */
  | { t: 'mounted'; id: string | null }
  /** Your achievement counters, finished achievements and chosen title. */
  | { t: 'achievements'; c: Record<string, number>; done: string[]; title: string | null };

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/** Round to centimetres / milliradians before sending: smaller packets, same visual result. */
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 40): v is string => typeof v === 'string' && v.length <= max;
const int = (v: unknown) => Math.floor(v as number);
const ACTS = ['swing', 'shoot', 'cast', 'spin', 'fish'];

/**
 * Parse and validate an untrusted client message. Anything malformed returns null and is dropped.
 * The server never trusts shape, size or values coming from a browser.
 */
export function decodeClient(raw: string): ClientMsg | null {
  if (raw.length > 2048) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello':
      if (typeof m.name !== 'string' || !num(m.color) || !num(m.proto)) return null;
      return { t: 'hello', name: m.name, color: m.color, proto: m.proto, build: m.build && typeof m.build === 'object' ? m.build : null, token: typeof m.token === 'string' ? m.token : undefined };
    case 'input':
      if (![m.seq, m.x, m.y, m.z, m.yaw, m.pitch].every(num)) return null;
      return { t: 'input', seq: m.seq, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, act: ACTS.includes(m.act) ? m.act : undefined };
    case 'chat': return typeof m.text === 'string' ? { t: 'chat', text: m.text } : null;
    case 'ping': return num(m.at) ? { t: 'ping', at: m.at } : null;
    case 'mine': case 'chop': case 'pick': return str(m.node) ? { t: m.t, node: m.node } : null;
    case 'cast': return num(m.x) && num(m.z) ? { t: 'cast', x: m.x, z: m.z } : null;
    case 'reel': return { t: 'reel', ok: m.ok === true };
    case 'craft':
      return str(m.recipe) && num(m.count) && str(m.station) ? { t: 'craft', recipe: m.recipe, station: m.station, count: Math.max(1, Math.min(100, int(m.count))) } : null;
    case 'cancelCraft': return { t: 'cancelCraft' };
    case 'equip': return num(m.index) ? { t: 'equip', index: int(m.index) } : null;
    case 'unequip': return str(m.slot, 12) ? { t: 'unequip', slot: m.slot as Slot } : null;
    case 'hold': return ['mainHand', 'pickaxe', 'hatchet', 'rod'].includes(m.slot) ? { t: 'hold', slot: m.slot } : null;
    case 'buy': return str(m.npc) && str(m.item) ? { t: 'buy', npc: m.npc, item: m.item } : null;
    case 'sell': return str(m.npc) && num(m.index) && num(m.qty) ? { t: 'sell', npc: m.npc, index: int(m.index), qty: Math.max(1, int(m.qty)) } : null;
    case 'drop': return num(m.index) && num(m.qty) ? { t: 'drop', index: int(m.index), qty: Math.max(1, int(m.qty)) } : null;
    case 'pickup': return num(m.id) ? { t: 'pickup', id: int(m.id) } : null;
    case 'attack': return str(m.target) ? { t: 'attack', target: m.target, special: m.special === true } : null;
    case 'eat': return num(m.index) ? { t: 'eat', index: int(m.index) } : null;
    case 'talent': return str(m.tree, 16) && str(m.node) ? { t: 'talent', tree: m.tree, node: m.node } : null;
    case 'respec': return str(m.tree, 16) ? { t: 'respec', tree: m.tree } : null;
    case 'rent': return num(m.weeks) ? { t: 'rent', weeks: Math.max(1, Math.min(4, int(m.weeks))), home: num(m.home) ? int(m.home) : undefined } : null;
    case 'rest': return { t: 'rest' };
    case 'mount': return { t: 'mount' };
    case 'title': return m.id === null || (typeof m.id === 'string' && m.id.length < 40) ? { t: 'title', id: m.id } : null;
    case 'door': return num(m.home) ? { t: 'door', home: int(m.home) } : null;
    case 'storage': return (m.op === 'put' || m.op === 'take') && num(m.index) && num(m.qty) ? { t: 'storage', op: m.op, index: int(m.index), qty: Math.max(1, int(m.qty)) } : null;
    case 'quest': return str(m.quest) && ['accept', 'turnin', 'abandon'].includes(m.op) ? { t: 'quest', quest: m.quest, op: m.op } : null;
    case 'imbue': return num(m.index) && (m.element === 'fire' || m.element === 'frost' || m.element === 'life') ? { t: 'imbue', index: int(m.index), element: m.element } : null;
    case 'heal': return str(m.target) ? { t: 'heal', target: m.target } : null;
    case 'travel': return typeof m.portal === 'string' && m.portal.length < 24 ? { t: 'travel', portal: m.portal } : null;
    case 'respawn': return { t: 'respawn' };
    case 'skin': return str(m.target) ? { t: 'skin', target: m.target } : null;
    case 'repair': return str(m.slot, 12) ? { t: 'repair', slot: m.slot as Slot } : null;
    default: return null;
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
