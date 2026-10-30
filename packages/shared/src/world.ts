/**
 * World content that client and server must agree on: ore veins, the camp's crafting stations and
 * the trading post, and the recipes made there. Veins are generated deterministically from the
 * terrain, so every client builds the same ones and the server can validate by id.
 */
import { CHUNK_SIZE, SPIKE_CHUNKS, WATER_LEVEL } from './constants.js';
import { heightAt, mulberry32 } from './terrain.js';

// ------------------------------------------------------------------ ore veins

export type VeinType = 'stone' | 'iron';

export interface VeinTypeDef {
  name: string;
  item: string;
  level: number;
  power: number;
  xp: number;
  respawnSec: number;
  swings: [number, number];
  gem: { item: string; chance: number };
}

export const VEIN_TYPES: Record<VeinType, VeinTypeDef> = {
  stone: { name: 'Stone vein', item: 'stone', level: 1, power: 1, xp: 8, respawnSec: 45, swings: [4, 7], gem: { item: 'quartz', chance: 1 / 300 } },
  iron: { name: 'Iron vein', item: 'iron_ore', level: 8, power: 1, xp: 20, respawnSec: 120, swings: [3, 6], gem: { item: 'sapphire', chance: 1 / 250 } },
};

export interface Vein { id: string; type: VeinType; x: number; y: number; z: number; r: number }

/** How close you must stand to mine (metres, horizontal). */
export const MINE_RANGE = 3.4;
/** How close you must stand to use a station or the trading post. */
export const USE_RANGE = 4;

function slopeY(x: number, z: number): number {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
  return (2 * e) / Math.hypot(dx, 2 * e, dz);
}

function generateVeins(): Vein[] {
  const out: Vein[] = [];
  const far = (x: number, z: number) => out.every((v) => Math.hypot(v.x - x, v.z - z) > 3.5);
  const add = (type: VeinType, x: number, z: number, id: string) => {
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + 0.6 || slopeY(x, z) < 0.6 || !far(x, z)) return false;
    out.push({ id, type, x, y, z, r: type === 'iron' ? 1.0 : 1.1 });
    return true;
  };
  // A starter cluster of stone veins a short walk north-east of camp.
  const rngC = mulberry32(4242);
  for (let i = 0, made = 0; i < 40 && made < 6; i++) {
    const a = rngC() * Math.PI * 2, d = rngC() * 7;
    if (add('stone', 26 + Math.cos(a) * d, -22 + Math.sin(a) * d, `camp-${made}`)) made++;
  }
  // Everywhere else: stone in the lowlands and hills, iron up on the higher ground.
  const half = SPIKE_CHUNKS / 2;
  for (let cz = -half; cz < half; cz++) for (let cx = -half; cx < half; cx++) {
    const rng = mulberry32((cx * 92821) ^ (cz * 68917) ^ 0xa11);
    let stone = 0, iron = 0;
    for (let i = 0; i < 14; i++) {
      const x = cx * CHUNK_SIZE + 4 + rng() * (CHUNK_SIZE - 8), z = cz * CHUNK_SIZE + 4 + rng() * (CHUNK_SIZE - 8);
      if (Math.hypot(x, z) < 20) continue;
      const h = heightAt(x, z);
      if (h > 8.5 && h < 18 && iron < 2 && Math.hypot(x, z) > 40) { if (add('iron', x, z, `${cx},${cz},${i}`)) iron++; }
      else if (h > 1.2 && h < 12 && stone < 2) { if (add('stone', x, z, `${cx},${cz},${i}`)) stone++; }
    }
  }
  return out;
}

export const VEINS: Vein[] = generateVeins();
export const VEIN_BY_ID: Map<string, Vein> = new Map(VEINS.map((v) => [v.id, v]));

/** Seconds per pickaxe swing: tool speed, then −1% per Mining level, then speed bonuses (Hardrock, DEX). */
export function swingSeconds(toolSwingSec: number, miningLevel: number, speedBonus: number): number {
  return (toolSwingSec * (1 - 0.01 * (miningLevel - 1))) / (1 + Math.max(0, speedBonus));
}

// ------------------------------------------------------------------ camp: stations and the trading post

export type StationId = 'furnace' | 'anvil';
export interface Place { name: string; x: number; z: number; r: number }

export const STATIONS: Record<StationId, Place> = {
  furnace: { name: 'Furnace', x: 6.5, z: -8, r: 1.2 },
  anvil: { name: 'Anvil', x: 10.5, z: -4, r: 0.8 },
};

export const TRADING_POST: Place & { sells: string[] } = {
  name: 'Mofjell Trading Post', x: -9, z: -7, r: 1.6,
  sells: ['stone_pickaxe', 'small_rucksack', 'leather_backpack'],
};

export interface Recipe {
  id: string;
  station: StationId;
  level: number;
  inputs: { item: string; qty: number }[];
  output: { item: string; qty: number };
  xp: number;
  seconds: number;
}

/** Every recipe above stone needs a lower-tier part too (design doc §6, cross-tier recipes). */
export const RECIPES: Recipe[] = [
  { id: 'shaped_stone', station: 'anvil', level: 1, inputs: [{ item: 'stone', qty: 2 }], output: { item: 'shaped_stone', qty: 1 }, xp: 6, seconds: 1.6 },
  { id: 'stone_sword', station: 'anvil', level: 2, inputs: [{ item: 'shaped_stone', qty: 4 }], output: { item: 'stone_sword', qty: 1 }, xp: 30, seconds: 3 },
  { id: 'stone_pauldrons', station: 'anvil', level: 4, inputs: [{ item: 'shaped_stone', qty: 6 }], output: { item: 'stone_pauldrons', qty: 1 }, xp: 45, seconds: 3.5 },
  { id: 'iron_bar', station: 'furnace', level: 8, inputs: [{ item: 'iron_ore', qty: 2 }], output: { item: 'iron_bar', qty: 1 }, xp: 15, seconds: 2 },
  { id: 'iron_pickaxe', station: 'anvil', level: 10, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'shaped_stone', qty: 1 }], output: { item: 'iron_pickaxe', qty: 1 }, xp: 100, seconds: 4 },
  { id: 'iron_sword', station: 'anvil', level: 10, inputs: [{ item: 'iron_bar', qty: 4 }, { item: 'shaped_stone', qty: 1 }], output: { item: 'iron_sword', qty: 1 }, xp: 100, seconds: 4 },
  { id: 'iron_pauldrons', station: 'anvil', level: 12, inputs: [{ item: 'iron_bar', qty: 6 }, { item: 'shaped_stone', qty: 2 }], output: { item: 'iron_pauldrons', qty: 1 }, xp: 150, seconds: 5 },
];
export const RECIPE_BY_ID: Map<string, Recipe> = new Map(RECIPES.map((r) => [r.id, r]));
