/** Server-side state shapes shared by the world and its systems. */
import type {
  Bag, Buff, CharacterBuild, Equipment, GroundItem, HoldSlot, MobDef, PlayerState, PlayerStats, QuestState,
  ServerMsg, SkillXp, Spawn, TalentAlloc,
} from '@kontor/shared';

export interface Client {
  send(msg: ServerMsg): void;
  close(reason: string): void;
}

export interface CraftJob { recipe: string; station: string; total: number; done: number; nextAt: number; seconds: number }

export interface Fishing {
  x: number; z: number;
  /** Where the player stood when casting; walking away cancels. */
  fromX: number; fromZ: number;
  phase: 'wait' | 'bite';
  biteAt: number;
  item: string; xp: number; difficulty: number; rare: boolean;
}

export interface Lease { room: number; until: number }

export interface ServerPlayer {
  state: PlayerState;
  client: Client;
  /** Last position the server accepted, and when. Every new step is checked against it. */
  lastValid: { x: number; y: number; z: number; at: number };
  lastSeq: number;
  strikes: number;
  lastChatAt: number;
  actUntil: number;
  act: PlayerState['act'];
  build: CharacterBuild;
  userId: string | null;
  savedAt: number;
  dirty: boolean;
  // things worth saving
  bag: Bag;
  equip: Equipment;
  gold: number;
  xp: SkillXp;
  talents: TalentAlloc;
  respecs: number;
  quests: QuestState;
  lease: Lease | null;
  storage: Bag;
  // live state
  held: HoldSlot;
  stats: PlayerStats;
  buffs: Buff[];
  hp: number;
  lastHurtAt: number;
  dead: boolean;
  lastGatherAt: number;
  job: CraftJob | null;
  nextAttackAt: number;
  nextSpecialAt: number;
  fishing: Fishing | null;
}

export interface Mob {
  id: string;
  spawn: Spawn;
  def: MobDef;
  x: number; y: number; z: number; yaw: number;
  hp: number;
  dead: boolean;
  respawnAt: number;
  target: string | null;
  returning: boolean;
  nextAtk: number;
  nextSlam: number;
  burn: { stacks: number; until: number; perSec: number; by: string; nextTick: number } | null;
  slowUntil: number;
  frozenUntil: number;
  dmgBy: Map<string, number>;
  act: 'atk' | 'slam' | undefined;
  actUntil: number;
  wander: { x: number; z: number; at: number };
}

export interface Ground extends GroundItem { expires: number; ownedUntil: number }

export interface NodeState { left: number; total: number; until: number }
