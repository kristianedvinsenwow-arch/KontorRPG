/** Server-side state shapes shared by the world and its systems. */
import type {
  AchievementState, Bag, Buff, CharacterBuild, Equipment, GroundItem, HoldSlot, MobDef, PlayerState, PlayerStats, QuestState,
  ServerMsg, SkillXp, Spawn, Stack, TalentAlloc,
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
  /** A non-fish catch, decided at the cast (its rarity too). */
  stack?: Stack;
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
  achievements: AchievementState;
  // live state
  held: HoldSlot;
  stats: PlayerStats;
  buffs: Buff[];
  hp: number;
  lastHurtAt: number;
  /** When this player last healed someone (adds go for healers). */
  lastHealAt?: number;
  /** Potion healing over time, and when the next potion can be drunk. */
  hot: { perSec: number; until: number; nextTick: number } | null;
  potionReadyAt: number;
  dead: boolean;
  lastGatherAt: number;
  job: CraftJob | null;
  nextAttackAt: number;
  nextSpecialAt: number;
  /** Shield guard: the next melee hit within `until` is cut by `pct`; `riposte` × a basic hit back. */
  guard?: { until: number; pct: number; riposte: number };
  /** Warding Light: overhealing kept as a shield that soaks damage. */
  shield?: { amt: number; until: number };
  fishing: Fishing | null;
  /** Aboard the fjord trawler until this time, in this place on deck. */
  trawler?: { until: number; seat: number };
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
  /** Frozen by someone with Brittle Frost: fire on it lands as 3 burn stacks at once. */
  brittleUntil?: number;
  /** Rend: a melee crit's bleed. */
  bleed?: { perSec: number; until: number; by: string; nextTick: number } | null;
  dmgBy: Map<string, number>;
  act: 'atk' | 'slam' | undefined;
  actUntil: number;
  wander: { x: number; z: number; at: number };
  /** Skinnable body: until when it stays, and whether someone has skinned it. */
  corpseUntil: number;
  skinned: boolean;
  /** Forced to fight this player until then (Shield Bash). */
  taunt?: { by: string; until: number };
  /** When it last looked for the closest attacker. */
  nextThreat?: number;
  /** A slam winding up: lands at this time. */
  slamAt?: number;
  /** The Kraken's next tentacle eruption. */
  nextErupt?: number;
  enraged?: boolean;
  /** Who killed it with fire (its meat drops cooked). */
  firedBy?: string;
  /** Has called its helpers this fight. */
  called?: boolean;
}

export interface Ground extends GroundItem { expires: number }

export interface NodeState { left: number; total: number; until: number }
