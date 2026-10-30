/** Values both client and server must agree on. Change here, never inline. */

/** Server simulation and snapshot rate. */
export const TICK_HZ = 10;
/** Client sends its predicted position this often. */
export const INPUT_HZ = 10;
/** Remote players are rendered this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY_MS = 120;

/** Design doc §9: 5 m/s, no sprinting anywhere. */
export const WALK_SPEED = 5;
/** Mount multipliers (doc §8). Not used in M0, kept here so validation already knows the ceiling. */
export const HORSE_MULT = 1.75;
export const RARE_MOUNT_MULT = 2.25;
/** Non-mount speed bonuses (boots, food, traits) add together and cap at +30%. */
export const MAX_SPEED_BONUS = 0.3;

export const GRAVITY = 22;
export const JUMP_VELOCITY = 7.2;
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.62;

/** Terrain is built and streamed in square chunks of this many metres. */
export const CHUNK_SIZE = 64;
/** M0 spike area: CHUNKS_X × CHUNKS_Z chunks centred on the origin (the full game is ~94 × 94). */
export const SPIKE_CHUNKS = 4;
export const WORLD_HALF = (SPIKE_CHUNKS * CHUNK_SIZE) / 2;
export const WATER_LEVEL = 0;

/** Area of interest: players see others within this many chunks in each direction (3 × 3). */
export const AOI_CHUNKS = 1;

export const MAX_NAME_LEN = 16;
export const MAX_CHAT_LEN = 200;
export const PLAYER_COLORS = ['#e8554e', '#4ea1e8', '#6fcf5f', '#e8b84e', '#b77be8', '#43d6c6', '#f07fb4', '#e2e2dc'];

/** Bumped whenever the wire format changes; a mismatch forces the client to reload. */
export const PROTOCOL_VERSION = 2;
