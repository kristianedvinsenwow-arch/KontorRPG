/**
 * Monsters and fighting. Mobs wander near their spawn, chase players who come close, give up past
 * their leash, and drop loot on the ground when they die. Players attack with left click (weapon
 * pace) and right click (the weapon's special on a 5–20 s cooldown). Projectiles land after their
 * flight time so the hit numbers match what players see.
 */
import {
  BURN, CORPSE_SEC, FREEZE_SEC, ITEMS, knifeBonus, knifeUses, levelOf, MOBS, PROJECTILE_SPEED, SLOW, SPAWNS, ST_ANGRY, ST_BURN, ST_DEAD, ST_FROZEN, ST_SLOW,
  attackInterval, attackRange, groundAt, incoming, inCaveRegion, regionAt, mitigate, outgoing, r2, r3, rollCraftRarity, rollEffects,
  specialCooldown, specialFor, hasShield, giantslayerMult, GUARD_SEC, SHIELD_THREAT_M, styleOf, weaponClass, type Drop, type MobState, type Rarity, type Stack,
} from '@kontor/shared';
import type { Mob, ServerPlayer } from './types.js';
import type { World } from './world.js';

/** Gear that can drop, per tier (crafted and sold items; not boss uniques). */
const GEAR_BY_TIER: Record<number, string[]> = {};
for (const d of Object.values(ITEMS)) {
  if (!d.slot || d.fixedRarity || d.kind === 'ammo' || d.kind === 'bag' || !d.tier) continue;
  if (d.weapon === 'fireStaff' || d.weapon === 'frostStaff') continue;
  if (d.weapon === 'warhammer' || d.weapon === 'halberd' || d.weapon === 'spear') continue; // only from plans
  (GEAR_BY_TIER[d.tier] ??= []).push(d.id);
}

/** A random piece of gear of this tier, with a rolled rarity (epics possible), as monsters drop it. */
export function rollGear(w: World, tier: number, luck: number): Stack {
  const pool = GEAR_BY_TIER[tier] ?? GEAR_BY_TIER[1];
  const id = pool[Math.floor(w.rand() * pool.length)];
  const r: Rarity = rollCraftRarity(luck, () => w.rand(), true);
  const st: Stack = { id, qty: 1 };
  if (r) { st.r = r; st.fx = rollEffects(ITEMS[id], r, () => w.rand()); }
  return st;
}

export const mobRadius = (m: Mob) => 0.45 * m.def.scale;

export function createMobs(w: World): Map<string, Mob> {
  const out = new Map<string, Mob>();
  for (const s of SPAWNS) {
    const def = MOBS[s.kind];
    const y = groundAt(s.x, s.z);
    out.set(s.id, {
      id: s.id, spawn: s, def, x: s.x, y, z: s.z, yaw: w.rand() * 6.28, hp: def.hp, dead: false, respawnAt: 0, target: null, returning: false,
      nextAtk: 0, nextSlam: 0, burn: null, slowUntil: 0, frozenUntil: 0, dmgBy: new Map(), act: undefined, actUntil: 0, wander: { x: s.x, z: s.z, at: 0 }, corpseUntil: 0, skinned: false,
    });
  }
  return out;
}

export function mobState(m: Mob, now: number): MobState {
  let st = 0;
  if (m.burn && m.burn.until > now) st |= ST_BURN;
  if (m.slowUntil > now) st |= ST_SLOW;
  if (m.frozenUntil > now) st |= ST_FROZEN;
  if (m.dead) st |= ST_DEAD;
  if (m.target) st |= ST_ANGRY;
  const sk = m.dead && m.def.skin && !m.skinned && now < m.corpseUntil ? 1 : undefined;
  return { id: m.id, k: m.def.kind, x: r2(m.x), y: r2(m.y), z: r2(m.z), yaw: r3(m.yaw), hp: Math.ceil(m.hp), mhp: m.def.hp, st, bs: m.burn && m.burn.until > now ? m.burn.stacks : undefined, act: now < m.actUntil ? m.act : undefined, sk };
}

const sameRegion = (a: { x: number; z: number }, b: { x: number; z: number }) => regionAt(a.x, a.z) === regionAt(b.x, b.z);

// ------------------------------------------------------------------ mob AI

export function stepMobs(w: World, dt: number, now: number): void {
  for (const m of w.mobs.values()) {
    if (m.dead) {
      if (now >= m.respawnAt) respawnMob(m, now);
      continue;
    }
    // Burn ticks once a second.
    if (m.burn) {
      if (m.burn.until <= now) m.burn = null;
      else if (now >= m.burn.nextTick) {
        m.burn.nextTick = now + 1000;
        const dmg = m.burn.perSec * m.burn.stacks;
        w.broadcastNear(m, { t: 'hit', to: m.id, dmg: Math.round(dmg * 10) / 10, kind: 'burn', from: m.burn.by });
        damageMob(w, m, dmg, m.burn.by, now);
        if (m.dead) continue;
      }
    }
    const frozen = m.frozenUntil > now;
    const speed = frozen ? 0 : m.def.speed * (m.slowUntil > now ? 1 - SLOW.pct : 1);
    let target = m.target ? w.players.get(m.target) : undefined;
    if (target && (target.dead || !sameRegion(m, target.state))) { target = undefined; m.target = null; }
    const home = Math.hypot(m.x - m.spawn.x, m.z - m.spawn.z);
    if (target && home > m.spawn.leash) { m.target = null; target = undefined; m.returning = true; }
    // Fight whoever is closest among those near it (a shield bearer counts as closer; a taunt wins).
    if (target && !m.returning && now >= (m.nextThreat ?? 0)) {
      m.nextThreat = now + 500;
      const t = m.taunt && m.taunt.until > now ? w.players.get(m.taunt.by) : undefined;
      if (t && !t.dead && sameRegion(m, t.state)) { target = t; m.target = t.state.id; }
      else {
        const eff = (p: ServerPlayer) => Math.hypot(p.state.x - m.x, p.state.z - m.z) - (hasShield(p.equip.offHand) ? SHIELD_THREAT_M : 0);
        let best = target, bd = eff(target) - 1; // a little stickiness so it doesn't flip-flop
        for (const p of w.players.values()) {
          if (p === target || p.dead || !sameRegion(m, p.state)) continue;
          const engaged = m.dmgBy.has(p.state.id) || Math.hypot(p.state.x - m.x, p.state.z - m.z) < m.def.aggro;
          if (!engaged) continue;
          const e = eff(p);
          if (e < bd) { bd = e; best = p; }
        }
        if (best !== target) { target = best; m.target = best.state.id; }
      }
    }
    if (!target && !m.returning) {
      // Look for someone to chase.
      let best: ServerPlayer | undefined, bd = m.def.aggro;
      for (const p of w.players.values()) {
        if (p.dead || !sameRegion(m, p.state)) continue;
        const d = Math.hypot(p.state.x - m.x, p.state.z - m.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { target = best; m.target = best.state.id; }
    }
    if (m.returning) {
      moveToward(m, m.spawn.x, m.spawn.z, m.def.speed * 1.4, dt);
      if (home < 1.5) { m.returning = false; m.hp = m.def.hp; m.dmgBy.clear(); m.burn = null; }
    } else if (target) {
      const d = Math.hypot(target.state.x - m.x, target.state.z - m.z);
      const reach = m.def.range + 0.35 + mobRadius(m) * 0.5;
      if (d > reach * 0.85) moveToward(m, target.state.x, target.state.z, speed, dt, reach * 0.8);
      else m.yaw = Math.atan2(-(target.state.x - m.x), -(target.state.z - m.z));
      if (!frozen && m.def.slam && now >= m.nextSlam && d < m.def.slam.r + 1) {
        m.nextSlam = now + m.def.slam.every * 1000;
        m.act = 'slam'; m.actUntil = now + 900;
        w.broadcastNear(m, { t: 'fx', kind: 'slam', from: m.id });
        for (const p of w.players.values()) {
          if (!p.dead && sameRegion(m, p.state) && Math.hypot(p.state.x - m.x, p.state.z - m.z) <= m.def.slam.r) hurtPlayer(w, p, m, m.def.dmg * m.def.slam.mult, false, now);
        }
      } else if (!frozen && d <= reach && now >= m.nextAtk) {
        m.nextAtk = now + m.def.interval * 1000;
        m.act = 'atk'; m.actUntil = now + 500;
        if (m.def.magic) {
          w.broadcastNear(m, { t: 'fx', kind: 'magic', from: m.id, to: target.state.id });
          const tgt = target;
          w.later(now + (d / PROJECTILE_SPEED) * 1000, () => { if (!m.dead && !tgt.dead) hurtPlayer(w, tgt, m, m.def.dmg, true, w.now()); });
        } else hurtPlayer(w, target, m, m.def.dmg, false, now);
      }
    } else if (now >= m.wander.at) {
      // Idle: amble to a nearby point now and then.
      const a = w.rand() * 6.28, r = w.rand() * Math.min(6, m.spawn.leash * 0.4);
      m.wander = { x: m.spawn.x + Math.cos(a) * r, z: m.spawn.z + Math.sin(a) * r, at: now + 4000 + w.rand() * 6000 };
    } else if (Math.hypot(m.wander.x - m.x, m.wander.z - m.z) > 0.5 && !frozen) {
      moveToward(m, m.wander.x, m.wander.z, speed * 0.35, dt);
    }
    m.y = groundAt(m.x, m.z);
  }
}

function moveToward(m: Mob, x: number, z: number, speed: number, dt: number, stopAt = 0): void {
  const dx = x - m.x, dz = z - m.z, d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  m.yaw = Math.atan2(-dx, -dz);
  const step = Math.min(speed * dt, Math.max(0, d - stopAt));
  const nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
  // Stay on walkable ground (cave walls, lake): don't step into deep water or out of the cave.
  if (inCaveRegion(nx, nz) ? true : groundAt(nx, nz) > -0.3) { m.x = nx; m.z = nz; }
}

function respawnMob(m: Mob, now: number): void {
  Object.assign(m, { dead: false, hp: m.def.hp, x: m.spawn.x, z: m.spawn.z, y: groundAt(m.spawn.x, m.spawn.z), target: null, returning: false, burn: null, slowUntil: 0, frozenUntil: 0, nextSlam: now + 4000 });
  m.dmgBy.clear();
}

function hurtPlayer(w: World, p: ServerPlayer, m: Mob, raw: number, magic: boolean, now: number): void {
  if (p.dead) return;
  const s = p.stats.all;
  if (!magic && w.rand() < Math.min(0.4, s.dodge)) return void p.client.send({ t: 'hit', to: p.state.id, dmg: 0, kind: 'dodge', from: m.id });
  let dmg = incoming(raw, magic, s);
  let kind: 'phys' | 'magic' | 'block' = magic ? 'magic' : 'phys';
  if (!magic && hasShield(p.equip.offHand) && w.rand() < Math.min(0.5, s.block)) { dmg *= 0.35; kind = 'block'; }
  // A raised guard (Parry, Shield Bash) takes the edge off the next melee hit — slams included.
  if (!magic && p.guard && p.guard.until > now) {
    dmg *= 1 - p.guard.pct;
    kind = 'block';
    const back = p.guard.riposte;
    p.guard = undefined;
    if (back > 0 && !m.dead) {
      const hit = Math.max(0.5, Math.round(mitigate(outgoing(p.equip.mainHand, undefined, s, back), false, m.def.armour, m.def.ward) * 10) / 10);
      w.broadcastNear(m, { t: 'hit', to: m.id, dmg: hit, crit: false, kind: 'phys', from: p.state.id });
      damageMob(w, m, hit, p.state.id, now);
    }
  }
  dmg = Math.max(0.5, Math.round(dmg * 10) / 10);
  p.hp -= dmg;
  p.lastHurtAt = now;
  w.dismount(p);
  w.broadcastNear(p.state, { t: 'hit', to: p.state.id, dmg, kind, from: m.id });
  if (s.thorns > 0 && !magic) damageMob(w, m, s.thorns, p.state.id, now);
  if (p.hp <= 0) w.kill(p, m.def.name);
  else w.sendHp(p);
}

// ------------------------------------------------------------------ player attacks

export function attack(w: World, p: ServerPlayer, targetId: string, special: boolean): void {
  if (p.dead) return;
  const now = w.now();
  const main = p.equip.mainHand, ammo = p.equip.ammo;
  const cls = weaponClass(main);
  const spDef = specialFor(main, p.equip.offHand);
  // Parry needs no target: raise the shield.
  if (special && spDef.kind === 'guard') {
    if (now < p.nextSpecialAt) return;
    p.nextSpecialAt = now + specialCooldown(spDef, p.stats.all) * 1000;
    p.client.send({ t: 'cooldown', until: Date.now() + (p.nextSpecialAt - now) });
    p.guard = { until: now + GUARD_SEC * 1000, pct: spDef.guard ?? 0.5, riposte: spDef.riposte ?? 0 };
    p.act = 'swing'; p.actUntil = now + 600;
    w.broadcastNear(p.state, { t: 'fx', kind: 'guard', from: p.state.id });
    return;
  }
  const m = w.mobs.get(targetId);
  if (!m || m.dead || !sameRegion(m, p.state)) return;
  const style = styleOf(cls);
  const s = p.stats.all;
  const d = Math.hypot(m.x - p.state.x, m.z - p.state.z);
  if (d > attackRange(main) + mobRadius(m) + 1) return w.notice(p, 'Out of range.', 'error');
  if (special) {
    if (now < p.nextSpecialAt) return;
    p.nextSpecialAt = now + specialCooldown(spDef, s) * 1000;
    p.client.send({ t: 'cooldown', until: Date.now() + (p.nextSpecialAt - now) });
  } else {
    if (now < p.nextAttackAt - 150) return;
    p.nextAttackAt = now + attackInterval(main) * 1000;
  }
  if (p.held !== 'mainHand') { p.held = 'mainHand'; w.refreshGear(p); }
  if (cls === 'bow') {
    if (!ammo || ammo.qty <= 0) return w.notice(p, 'No arrows — wear some in the ammo slot.', 'error');
    if (w.rand() >= s.arrowSave) { ammo.qty--; if (ammo.qty <= 0) delete p.equip.ammo; w.sendInv(p); p.dirty = true; }
  }
  p.act = style === 'melee' ? (special && spDef.kind === 'spin' ? 'spin' : 'swing') : style === 'ranged' ? 'shoot' : 'cast';
  p.actUntil = now + 600;
  const sp = special ? spDef : null;
  const magic = style === 'magic';
  const roll = (mult: number) => {
    const crit = w.rand() < s.crit;
    return { dmg: outgoing(main, ammo, s, mult) * (crit ? 1.5 : 1), crit };
  };
  const giant = !!(main && ITEMS[main.id]?.giantslayer);
  const strike = (t: Mob, mult: number, then?: (t: Mob) => void) => {
    const { dmg: d0, crit } = roll(mult);
    const dmg = giant ? d0 * giantslayerMult(t.def.scale) : d0;
    if (sp?.stun) t.frozenUntil = Math.max(t.frozenUntil, w.now() + sp.stun * 1000);
    if (sp?.taunt) { t.taunt = { by: p.state.id, until: w.now() + sp.taunt * 1000 }; t.target = p.state.id; }
    const final = Math.max(0.5, Math.round(mitigate(dmg, magic, t.def.armour, t.def.ward) * 10) / 10);
    w.broadcastNear(t, { t: 'hit', to: t.id, dmg: final, crit, kind: magic ? 'magic' : 'phys', from: p.state.id });
    then?.(t);
    damageMob(w, t, final, p.state.id, w.now());
  };
  const flight = (t: Mob) => (Math.hypot(t.x - p.state.x, t.z - p.state.z) / PROJECTILE_SPEED) * 1000;

  if (sp?.guard) p.guard = { until: now + GUARD_SEC * 1000, pct: sp.guard, riposte: sp.riposte ?? 0 };
  if (!sp || sp.kind === 'single' || sp.kind === 'shot') {
    // Frost power: longer freezes, and frostbolts hit harder (half the bonus).
    const mult = (sp ? sp.mult : 1) * (cls === 'frostStaff' ? 1 + s.frostPower / 2 : 1);
    if (style === 'melee') return strike(m, mult);
    const kind = cls === 'bow' ? 'arrow' : cls === 'fireStaff' ? 'firebolt' : 'frostbolt';
    w.broadcastNear(p.state, { t: 'fx', kind, from: p.state.id, to: m.id });
    w.later(now + flight(m), () => {
      if (m.dead) return;
      strike(m, mult, (t) => {
        if (cls === 'fireStaff') {
          const per = outgoing(main, undefined, s, 1) * BURN.perStackPerSec * (1 + s.burnDmg);
          const stacks = Math.min(BURN.maxStacks, (t.burn && t.burn.until > w.now() ? t.burn.stacks : 0) + 1);
          t.burn = { stacks, until: w.now() + BURN.sec * 1000, perSec: per, by: p.state.id, nextTick: t.burn?.nextTick ?? w.now() + 1000 };
        }
      });
    });
    return;
  }
  const near = (r: number) => [...w.mobs.values()].filter((x) => !x.dead && sameRegion(x, p.state) && Math.hypot(x.x - p.state.x, x.z - p.state.z) <= r + mobRadius(x));
  if (sp.kind === 'spin') {
    w.broadcastNear(p.state, { t: 'fx', kind: 'spin', from: p.state.id });
    for (const t of near(sp.radius ?? 3.5)) strike(t, sp.mult);
  } else if (sp.kind === 'cone') {
    // Everything within reach in front of you (±60° around the aimed target).
    w.broadcastNear(p.state, { t: 'fx', kind: 'spin', from: p.state.id });
    const ax = m.x - p.state.x, az = m.z - p.state.z, al = Math.hypot(ax, az) || 1;
    for (const t of near(sp.radius ?? 4.5)) {
      const bx = t.x - p.state.x, bz = t.z - p.state.z, bl = Math.hypot(bx, bz) || 1;
      if (t === m || (ax * bx + az * bz) / (al * bl) > 0.5) strike(t, sp.mult);
    }
  } else if (sp.kind === 'nova') {
    w.broadcastNear(p.state, { t: 'fx', kind: 'nova', from: p.state.id });
    for (const t of near(sp.radius ?? 6)) strike(t, sp.mult, (x) => { x.frozenUntil = w.now() + FREEZE_SEC * 1000 * (1 + s.frostPower); });
  } else if (sp.kind === 'ignite') {
    const burning = near(sp.radius ?? 22).filter((x) => x.burn && x.burn.until > now);
    if (!burning.length) { p.nextSpecialAt = now + 1000; p.client.send({ t: 'cooldown', until: Date.now() + 1000 }); return w.notice(p, 'Nothing is burning — hit them with firebolts first.', 'error'); }
    w.broadcastNear(p.state, { t: 'fx', kind: 'ignite', from: p.state.id });
    for (const t of burning) strike(t, sp.mult * t.burn!.stacks * (1 + s.burnDmg));
  }
}

export function damageMob(w: World, m: Mob, dmg: number, by: string, now: number): void {
  if (m.dead) return;
  m.hp -= dmg;
  m.dmgBy.set(by, (m.dmgBy.get(by) ?? 0) + dmg);
  if (!m.target && !m.returning && w.players.has(by)) m.target = by;
  if (m.hp > 0) return;
  m.dead = true;
  m.hp = 0;
  m.burn = null;
  const [lo, hi] = m.def.respawnSec;
  m.respawnAt = now + (lo + w.rand() * (hi - lo)) * 1000;
  if (m.def.skin) { m.corpseUntil = now + CORPSE_SEC * 1000; m.skinned = false; m.respawnAt = Math.max(m.respawnAt, m.corpseUntil + 2000); }
  // No parties: everyone who hurt it at all gets the full XP, quest and achievement credit.
  let top: ServerPlayer | undefined, topDmg = 0;
  for (const [pid, d] of m.dmgBy) {
    const p = w.players.get(pid);
    if (!p || d <= 0) continue;
    if (d > topDmg) { topDmg = d; top = p; }
    const xp = w.addXp(p, 'combat', m.def.xp);
    p.client.send({ t: 'gain', skill: 'combat', xp });
    w.questKill(p, m.def.kind);
    w.count(p, `kill:${m.def.kind}`);
    w.count(p, 'kills');
    if (m.def.kind === 'goblin' || m.def.kind === 'cave_goblin' || m.def.kind === 'cave_shaman') w.count(p, 'kill:goblins');
  }
  if (m.def.boss) w.broadcast({ t: 'notice', kind: 'rare', text: `${m.def.name} has fallen${top ? ` — ${top.state.name} struck hardest` : ''}!` });
  dropLoot(w, m, top);
}

function dropLoot(w: World, m: Mob, owner: ServerPlayer | undefined): void {
  const items: Stack[] = [];
  const gold = m.def.gold[0] + Math.floor(w.rand() * (m.def.gold[1] - m.def.gold[0] + 1));
  if (gold > 0) items.push({ id: 'coins', qty: gold });
  const luck = owner?.stats.all.luck ?? 0;
  for (const d of m.def.drops as Drop[]) {
    if (w.rand() >= d.chance) continue;
    if ('item' in d) {
      const def = ITEMS[d.item];
      const qty = d.qty[0] + Math.floor(w.rand() * (d.qty[1] - d.qty[0] + 1));
      items.push(def.fixedRarity ? { id: d.item, qty: 1, r: def.fixedRarity } : { id: d.item, qty });
    } else {
      const pool = GEAR_BY_TIER[d.gear] ?? [];
      if (!pool.length) continue;
      const id = pool[Math.floor(w.rand() * pool.length)];
      // Found gear can be epic (0.6%, a little more with luck), even from the first goblins.
      const r: Rarity = d.legendary && w.rand() < d.legendary ? 4 : rollCraftRarity(luck, () => w.rand(), true);
      const st: Stack = { id, qty: 1 };
      if (r) { st.r = r; st.fx = rollEffects(ITEMS[id], r, () => w.rand()); }
      items.push(st);
      if (r >= 3) w.broadcast({ t: 'notice', kind: 'rare', text: `${m.def.name} dropped a ${r === 4 ? 'LEGENDARY' : 'epic'} ${ITEMS[id].name}!` });
    }
  }
  items.forEach((it, i) => {
    const a = (i / Math.max(1, items.length)) * Math.PI * 2;
    w.spawnGround(it, m.x + Math.cos(a) * 0.8, m.z + Math.sin(a) * 0.8, m.def.boss ? 120 : 45);
  });
}

/**
 * Skin a body with the skinning knife you're wearing. The hide can be ruined (knife tier sets the
 * odds); either way the body is gone afterwards, for everyone. Each attempt uses up the knife.
 */
export function skin(w: World, p: ServerPlayer, targetId: string): void {
  const now = w.now();
  const m = w.mobs.get(targetId);
  if (!m || !m.dead || !m.def.skin || m.skinned || now >= m.corpseUntil) return w.notice(p, 'There’s nothing left to skin.', 'error');
  if (Math.hypot(m.x - p.state.x, m.z - p.state.z) > 3.2) return w.notice(p, 'Get closer to skin it.', 'error');
  const knife = p.equip.knife;
  const def = knife ? ITEMS[knife.id] : undefined;
  if (!knife || !def?.knife) return w.notice(p, 'You need a skinning knife (smith one at an anvil) in your knife slot.', 'error');
  if ((knife.d ?? knifeUses(knife)) <= 0) return w.notice(p, 'Your skinning knife is worn out — repair it at an anvil.', 'error');
  m.skinned = true;
  knife.d = (knife.d ?? knifeUses(knife)) - 1;
  p.act = 'swing'; p.actUntil = now + 600;
  if (w.rand() < def.knife.fail) {
    w.notice(p, `You ruined the ${m.def.name.toLowerCase()}’s hide.`, 'error');
  } else {
    const sk = m.def.skin;
    let qty = sk.qty[0] + Math.floor(w.rand() * (sk.qty[1] - sk.qty[0] + 1));
    if (w.rand() < knifeBonus(knife)) qty++;
    w.giveOrDrop(p, { id: sk.item, qty });
    w.count(p, 'pelts');
    const xp = w.addXp(p, 'leatherworking', 6 * (levelOf(p.xp, 'leatherworking') < 5 ? 1.5 : 1));
    p.client.send({ t: 'gain', skill: 'leatherworking', xp, item: sk.item, qty });
  }
  if (knife.d <= 0) {
    w.notice(p, 'Your skinning knife is worn out. Repair it at an anvil (right-click it in your bag, or use the anvil).', 'error');
  }
  p.dirty = true;
  w.sendInv(p);
}
