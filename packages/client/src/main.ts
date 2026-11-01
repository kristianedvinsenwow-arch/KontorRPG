/**
 * KontorRPG client entry: wires renderer, world, local player, network and UI, and runs the loop.
 * Left click does what you're pointing at (attack, mine, chop, cast); right click is your
 * weapon's special; E talks, uses stations and picks up loot.
 */
import './styles.css';
import * as THREE from 'three';
import {
  CAST_RANGE, knifeUses, EAT_LOCK_MS, pierDeck, heightAt as heightAtWorld, STATION_BY_ID, daylight, sunAt, weatherAt, HOMES, HOUSES, PORTALS, regionAt, homeAt, homeDoorway, innRoom, toWorld, EYE_HEIGHT, INPUT_HZ, ITEMS, MINE_RANGE, NPCS, PLAYER_COLORS, RACES, RECIPE_BY_ID, SPECIALS, specialFor,
  STATIONS, TREE_BY_ID, TREE_TYPES, USE_RANGE, VEIN_BY_ID, VEIN_TYPES, WATER_LEVEL,
  MOBS, groundAt, attackInterval, attackRange, computeStats, faceOf, inCaveRegion, isFishable, levelFromXp, skillLevel, r2, r3, swingSeconds, weaponClass,
  PICK_SEC, PLANT_BY_ID, PLANT_TYPES, type Plant, type CharacterBuild, type HoldSlot, type MobState, type PlayerStats, type Tree, type Vein,
} from '@kontor/shared';
import { createGfx } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { updateLabels, setLabelsVisible, floatText } from './engine/labels.js';
import { Terrain } from './world/terrain.js';
import { makeViewmodel, SWING_SEC, STRIKE_AT } from './entities/viewmodel.js';
import { gearFromEquip } from './entities/held.js';
import { Mobs } from './entities/mobs.js';
import { Veins } from './world/veins.js';
import { Plants } from './world/plants.js';
import { Precip } from './world/precip.js';
import { sound } from './engine/audio.js';
import { makeHorse, animateHorse, riderEyeLift, type Horse } from './entities/horse.js';
import { Places } from './world/places.js';
import { CaveView } from './world/cave.js';
import { Fx } from './world/fx.js';
import { initTrees, setTreesDepleted, animateTrees, targetTree } from './world/trees.js';
import { createLocalPlayer, stepPlayer, type LocalPlayer } from './physics/movement.js';
import { NetClient } from './net/client.js';
import { Remotes, remotePosition } from './net/remotes.js';
import { gameStore, netStore, settingsStore, uiStore, type UiState } from './state/store.js';
import { initHud } from './ui/hud.js';
import { initPause, initBossKey } from './ui/menu.js';
import { initCreator } from './ui/creator.js';
import { initAccount } from './ui/account.js';
import { Auth } from './net/auth.js';
import { CharacterPreview, fillCharacterPanel } from './ui/characterPanel.js';
import { initPanels } from './ui/panels.js';
import { initHotbar } from './ui/hotbar.js';
import { iconFor, rarityColor } from './ui/icons.js';
import { fishing } from './ui/fishing.js';
import { mapInfo, drawMinimap } from './ui/map.js';

const view = document.getElementById('view')!;
const gfx = createGfx(view, settingsStore.get().quality);
const { renderer, scene, cam, vmScene, vmCam } = gfx;
settingsStore.subscribe((s) => { if (s.quality !== gfx.quality) gfx.setQuality(s.quality); });

initTrees(scene);
const terrain = new Terrain(scene);
terrain.dense = settingsStore.get().quality !== 'low';
terrain.update(0, 0, 99); // build the spawn area up front
const veins = new Veins(scene);
const plants = new Plants(scene);
const precip = new Precip(scene);
const places = new Places(scene);
const caveView = new CaveView(scene);
const mobs = new Mobs(scene);
mobs.onVoice = (kind, mood, pos) => sound.voice(kind, mood, { x: pos.x, y: pos.y + 1, z: pos.z });
const fx = new Fx(scene);
const input = new Input(renderer.domElement);
const viewmodel = makeViewmodel(vmScene);
const preview = new CharacterPreview('preview', () => uiStore.get().panel === 'character' && uiStore.get().charTab === 'sheet');
const creatorPreview = new CharacterPreview('createPreview', () => uiStore.get().panel === 'menu');
preview.setEnvironment(scene.environment);
creatorPreview.setEnvironment(scene.environment);
const remotes = new Remotes(scene);
const net = new NetClient();
const auth = new Auth();

let me: LocalPlayer | null = null;
let myId: string | null = null;
let myBuild: CharacterBuild | null = null;
let stats: PlayerStats | null = null;
let eyeHeight = EYE_HEIGHT;
/** Your horse while riding (drawn under the first-person camera), and how far the camera is lifted. */
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
let nextMiniAt = 0;
let myHorse: Horse | null = null, mountLift = 0, myName = '', mountedNow = false, wasOnGround = true, nextAmbAt = 0;
let ambFire: THREE.Vector3 | null = null, ambWater = 0, nextSlowAt = 0;
/** Console/debug: shift the sky clock (ms) or force a weather. */
const debugSky: { offset: number; weather: ReturnType<typeof weatherAt> | null } = { offset: 0, weather: null };
let seq = 0;
let lastSent = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, at: 0 };
let castAt: THREE.Vector3 | null = null;

// ---------------------------------------------------------------- UI wiring
const hud = initHud((text) => net.send({ t: 'chat', text }));

const syncCreatorPreview = () => {
  const s = settingsStore.get();
  creatorPreview.setCharacter(s.color, s.build.race, faceOf(s.build));
};
function recomputeStats() {
  if (!myBuild) return;
  const g = gameStore.get();
  stats = computeStats(myBuild, g.equip, g.talents, g.xp, g.buffs);
}
/** Apply a character (from the creator, or the saved one the server sends back). */
function useCharacter(name: string, color: number, build: CharacterBuild) {
  myBuild = build;
  eyeHeight = RACES[build.race].eye;
  preview.setCharacter(color, build.race, faceOf(build));
  fillCharacterPanel(name, build);
  recomputeStats();
}
initCreator(
  (name0, color, build) => {
    // No name typed: use the account's username rather than "Adventurer".
    const name = name0.trim() || auth.username || name0;
    useCharacter(name, color, build);
    net.connect(name, color, build, () => auth.token);
    uiStore.set({ panel: 'none' });
    input.lock();
  },
  syncCreatorPreview,
);
void auth.init().then(() => {
  initAccount(auth);
  // Reloaded for a new version while playing: go straight back in.
  let again = false;
  try { again = sessionStorage.getItem('kontorrpg.autoEnter') === '1'; sessionStorage.removeItem('kontorrpg.autoEnter'); } catch { /* ignore */ }
  const enter = document.getElementById('enter') as HTMLButtonElement;
  if (again && (auth.character || !auth.enabled) && !enter.disabled) enter.click();
});
syncCreatorPreview();
initPause(() => { uiStore.set({ panel: 'none' }); input.lock(); });
initBossKey(() => input.unlock());

const panels = initPanels((m) => net.send(m), () => { if (me) input.lock(); }, () => 1 + (stats?.all.sell ?? 0), () => stats?.all.skillLvl ?? 0);
const hotbar = initHotbar(
  (slot) => net.send({ t: 'hold', slot }),
  (index) => { net.send({ t: 'eat', index }); if (ITEMS[gameStore.get().bag[index]?.id ?? '']?.food) sound.play('eat'); },
  () => { net.send({ t: 'respawn' }); input.lock(); },
);
const PANELS: UiState['panel'][] = ['character', 'skills', 'craft', 'npc', 'home', 'talents', 'map', 'achievements'];
function openPanel(panel: UiState['panel'], extra: Partial<UiState> = {}) {
  uiStore.set({ panel, ...extra });
  input.unlock();
}

renderer.domElement.addEventListener('click', () => {
  const p = uiStore.get().panel;
  if ((p === 'none' || p === 'pause') && me) { uiStore.set({ panel: 'none' }); input.lock(); }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// Audio may only start after the player clicks or presses a key.
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => sound.unlock());
sound.setVolumes(settingsStore.get().volume);
settingsStore.subscribe((st) => sound.setVolumes(st.volume));
// Soft clicks when game panels open and close.
let lastPanel = uiStore.get().panel;
uiStore.subscribe((u) => {
  const big = (p: string) => PANELS.includes(p as UiState['panel']);
  if (u.panel !== lastPanel) { if (big(u.panel)) sound.play('uiOpen'); else if (big(lastPanel)) sound.play('uiClose'); }
  lastPanel = u.panel;
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2 && input.locked && uiStore.get().panel === 'none') special();
});

/**
 * Pause only when the player let go of the mouse themselves (Escape). Closing a menu re-locks the
 * mouse, and browsers sometimes refuse or immediately drop that re-lock — that must not pause the
 * game; a click on the world picks the mouse back up.
 */
document.addEventListener('pointerlockchange', () => {
  const u = uiStore.get();
  if (input.locked || u.panel !== 'none' || u.chatOpen || u.bossKey || !me || gameStore.get().dead) return;
  if (performance.now() - input.lastLockChange < 1500) { hud.toast('Click to look around', 1600); return; }
  uiStore.set({ panel: 'pause' });
});
document.addEventListener('pointerlockerror', () => {
  if (uiStore.get().panel === 'none' && me) hud.toast('Click to look around', 1600);
});

input.onKey((code) => {
  const u = uiStore.get();
  if (u.panel === 'menu' || u.bossKey || u.chatOpen) return;
  // The character menu (C) holds the sheet, talents (T), achievements (J) and quests (L) as tabs.
  const charKey = ['KeyC', 'KeyI', 'KeyK', 'KeyT', 'KeyJ', 'KeyL'].includes(code);
  const tab: UiState['charTab'] = code === 'KeyT' ? 'talents' : code === 'KeyJ' ? 'achievements' : code === 'KeyL' ? 'quests' : 'sheet';
  const want: UiState['panel'] | null = charKey ? 'character' : code === 'KeyM' ? 'map' : null;
  if (PANELS.includes(u.panel)) {
    const close = code === 'Escape' || (want === u.panel && (want !== 'character' || u.charTab === tab)) || (code === 'KeyE' && (u.panel === 'craft' || u.panel === 'npc'));
    if (close) { uiStore.set({ panel: 'none' }); input.lock(); return; }
    if (want) openPanel(want, want === 'character' ? { charTab: tab } : {});
    return;
  }
  if (u.panel !== 'none' || !me) return;
  if (want) return openPanel(want, want === 'character' ? { charTab: tab } : {});
  if (code === 'KeyE') return use();
  if (code === 'Enter') { uiStore.set({ chatOpen: true }); input.unlock(); return; }
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
  if (n >= 0) return net.send({ t: 'hold', slot: (['mainHand', 'pickaxe', 'hatchet', 'rod'] as HoldSlot[])[n] });
  if (code === 'Digit5') { const g = gameStore.get(); const i = g.bag.findIndex((s) => s && ITEMS[s.id]?.food); if (i >= 0) { net.send({ t: 'eat', index: i }); if (Date.now() - g.hurtAt > EAT_LOCK_MS) sound.play('eat'); } }
  if (code === 'KeyR') { if (!gameStore.get().equip.mount) hud.toast('No mount — Eirik the stablemaster in Bjørkvik sells horses.', 2200, 'error'); else net.send({ t: 'mount' }); return; }
  if (code === 'Digit6') { const g = gameStore.get(); const i = g.bag.findIndex((s) => s && ITEMS[s.id]?.potion?.heal); if (i >= 0) net.send({ t: 'eat', index: i }); else hud.toast('No healing potion in your bag.', 1500, 'error'); }
});
document.getElementById('closeChar')!.onclick = () => { uiStore.set({ panel: 'none' }); input.lock(); };
uiStore.subscribe((u) => {
  document.getElementById('charPanel')!.hidden = u.panel !== 'character';
  setLabelsVisible(u.panel !== 'menu' && !u.bossKey);
  if (!u.chatOpen && u.panel === 'none' && me && !input.locked && document.activeElement?.id === 'chatin') input.lock();
});
gameStore.subscribe((g) => {
  recomputeStats();
  viewmodel.setHeld(g.equip[g.held]?.id);
  // The shield shows in first person with a one-handed weapon out.
  const off = g.equip.offHand, mh = g.equip.mainHand;
  viewmodel.setShield(g.held === 'mainHand' && off && ITEMS[off.id]?.armourType === 'metal' && !(mh && ITEMS[mh.id]?.twoHanded) ? off.id : undefined);
  preview.setGear(gearFromEquip(g.equip, g.held));
});

// ---------------------------------------------------------------- network events
const posOf = (id: string): THREE.Vector3 | null => {
  if (id === myId && me) return new THREE.Vector3(me.x, me.y + eyeHeight - 0.3, me.z);
  return mobs.position(id) ?? remotePosition(remotes, id);
};
let firstNodes = true;

net.on((msg) => {
  switch (msg.t) {
    case 'welcome':
      myId = msg.id;
      myName = msg.character.name;
      useCharacter(msg.character.name, msg.character.color, msg.character.build);
      if (msg.saved) hud.system(`Welcome back, ${msg.character.name}.`);
      if (!me) me = createLocalPlayer(msg.you.x, msg.you.y, msg.you.z, msg.you.yaw);
      else { me.x = msg.you.x; me.y = msg.you.y; me.z = msg.you.z; }
      lastSent = { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, at: performance.now() };
      seq = 0;
      firstNodes = true;
      break;
    case 'snap': remotes.ingest(msg.at, msg.players); mobs.ingest(msg.mobs); break;
    case 'leave': remotes.remove(msg.id); break;
    case 'roster': netStore.set({ online: msg.players }); break;
    case 'correct':
      if (me) { me.x = msg.x; me.y = msg.y; me.z = msg.z; me.vx = me.vz = me.vy = 0; }
      if (msg.reason === 'locked') hud.toast('That room is locked.', 1500, 'error');
      if (msg.reason === 'teleport') { lastSent.at = 0; if (!inCaveRegion(msg.x, msg.z)) terrain.update(msg.x, msg.z, 99); }
      break;
    case 'chat': { const who = netStore.get().online.find((p) => p.id === msg.from); hud.chat(msg.name, who?.color ?? 0, msg.text); break; }
    case 'system':
      hud.system(msg.text);
      if (/reloading|restarting/i.test(msg.text)) hud.toast(msg.text, 5000);
      break;
    case 'inv': gameStore.set({ bag: msg.bag, equip: msg.equip, gold: msg.gold, held: msg.held }); break;
    case 'skills': gameStore.set({ xp: msg.xp }); break;
    case 'talents': gameStore.set({ talents: msg.alloc, respecs: msg.respecs }); break;
    case 'quests': gameStore.set({ quests: msg.state }); break;
    case 'achievements': gameStore.set({ ach: { c: msg.c, done: msg.done, title: msg.title } }); break;
    case 'lease': gameStore.set({ lease: { room: msg.room, until: msg.until, storage: msg.storage } }); break;
    case 'rooms': gameStore.set({ rooms: msg.taken }); places.setRooms(msg.taken); break;
    case 'doors': {
      const before = new Set(places.openDoors());
      for (const n of HOMES.map((h) => h.id)) if (before.has(n) !== msg.open.includes(n)) { const d = homeDoorway(n); sound.play('door', { x: d.x, y: groundAt(d.x, d.z) + 1, z: d.z }); }
      places.setDoors(msg.open);
      break;
    }
    case 'hp': gameStore.set({ hp: msg.hp, maxHp: msg.max, dead: msg.hp <= 0 && gameStore.get().dead }); break;
    case 'buffs': gameStore.set({ buffs: msg.list }); break;
    case 'dead':
      gameStore.set({ dead: true });
      fishing.stop(); fx.setBobber(null); castAt = null;
      input.unlock();
      break;
    case 'potion': gameStore.set({ potionReady: msg.ready }); sound.play('drink'); break;
    case 'mounted':
      if (msg.id) sound.play('neigh');
      gameStore.set({ mounted: msg.id });
      if (myHorse) { scene.remove(myHorse.g); myHorse = null; }
      if (msg.id) { myHorse = makeHorse(msg.id); scene.add(myHorse.g); }
      break;
    case 'cooldown': gameStore.set({ specialReady: msg.until }); break;
    case 'gain':
      if (msg.item) sound.play(msg.item === 'coins' ? 'coins' : msg.rare ? 'uiRare' : 'pickup');
      if (msg.item) {
        const name = msg.item === 'coins' ? 'gold' : ITEMS[msg.item]?.name ?? msg.item;
        pop(`+${msg.qty ?? 1} ${name}`, msg.rare ? 'rare' : '', msg.item, msg.r ? rarityColor({ id: msg.item, r: msg.r as 0 }) : undefined);
      }
      if (msg.item && msg.item !== 'coins' && gameStore.get().job) panels.noteMade(msg.item, msg.qty ?? 1, msg.r, msg.xp, msg.skill);
      if (msg.xp && msg.skill) setTimeout(() => pop(`+${msg.xp} ${msg.skill === 'combat' ? 'combat' : msg.skill![0].toUpperCase() + msg.skill!.slice(1)} XP`, 'xp'), 180);
      break;
    case 'nodes':
      veins.setDepleted(msg.depleted);
      plants.setDepleted(msg.depleted);
      if (!firstNodes) for (const [id, st] of msg.depleted) { const t = TREE_BY_ID.get(id); if (t && st === 1) sound.play('treeFall', { x: t.x, y: t.y + 1, z: t.z }); }
      setTreesDepleted(msg.depleted, !firstNodes);
      firstNodes = false;
      break;
    case 'node': {
      const v = VEIN_BY_ID.get(msg.id), t = TREE_BY_ID.get(msg.id), pl = PLANT_BY_ID.get(msg.id);
      const p = v ? new THREE.Vector3(v.x, v.y + 1.5 * v.r, v.z) : t ? new THREE.Vector3(t.x, t.y + 1.6, t.z) : pl ? new THREE.Vector3(pl.x, pl.y + 1.1, pl.z) : null;
      if (p) fx.nodeWear(msg.id, p, msg.left, msg.total);
      break;
    }
    case 'job': {
      const r = msg.recipe ? RECIPE_BY_ID.get(msg.recipe) : undefined;
      // A station sound for each item worked on.
      if (r) { const st = STATION_BY_ID.get(uiStore.get().station); const k = st?.kind; sound.play(k === 'furnace' ? 'furnace' : k === 'anvil' ? 'anvil' : k === 'workbench' ? 'workbench' : k === 'campfire' || k === 'stove' ? 'cook' : k === 'tanning' ? 'tanning' : k === 'loom' ? 'loom' : k === 'alchemy' ? 'alchemy' : 'craftDone', st ? { x: st.x, y: groundAt(st.x, st.z) + 1, z: st.z } : undefined); }
      const speed = r ? 1 + Math.max(0, (stats?.scoped as Record<string, { craftSpeed: number }> | undefined)?.[r.skill]?.craftSpeed ?? 0) : 1;
      gameStore.set({ job: r ? { recipe: r.id, done: msg.done, total: msg.total, seconds: Math.max(0.1, r.seconds / speed), endsAt: performance.now() + msg.seconds * 1000 } : null });
      break;
    }
    case 'notice':
      if (msg.kind === 'error') sound.play('uiError');
      else if (/earned “/.test(msg.text) && msg.text.startsWith(`${myName} earned`)) sound.play('uiFanfare');
      else if (/level up|reached level|Level \d+!/i.test(msg.text)) sound.play('uiLevel');
      else if (msg.kind === 'rare') sound.play('uiRare');
      hud.toast(msg.text, msg.kind === 'rare' ? 6000 : 3500, msg.kind);
      if (msg.kind !== 'error') hud.system(msg.text);
      break;
    case 'ground':
      if (msg.remove) fx.groundRemove(msg.remove);
      if (msg.add) fx.groundAdd(msg.add);
      break;
    case 'hit': {
      const mine = msg.to === myId;
      const p = mine && me ? new THREE.Vector3(me.x, me.y + eyeHeight + 0.2, me.z).add(new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)).multiplyScalar(1.4)) : posOf(msg.to);
      if (!p) break;
      const txt = msg.kind === 'dodge' ? 'Dodged' : msg.kind === 'block' ? `Blocked ${msg.dmg}` : msg.kind === 'heal' ? `+${msg.dmg}` : `${msg.dmg}${msg.crit ? '!' : ''}`;
      floatText(txt, `${msg.kind}${msg.crit ? ' crit' : ''}${mine ? ' me' : ''}`, p);
      if (msg.kind === 'heal') { if (mine) sound.play('heal'); }
      else if (msg.kind === 'dodge') sound.play('dodge', p);
      else if (msg.kind === 'block') sound.play('block', p);
      else if (mine) sound.play('hurt');
      else {
        sound.play(msg.crit ? 'crit' : 'hit', p);
        const mob = mobs.get(msg.to);
        if (mob && msg.kind !== 'burn' && mob.hp > 0 && Math.random() < 0.7) sound.voice(mob.k, 'hurt', p);
      }
      if (mine && msg.kind !== 'heal' && msg.kind !== 'dodge') { document.getElementById('hurt')?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 450 }); gameStore.set({ hurtAt: Date.now() }); }
      break;
    }
    case 'fx': {
      const from = posOf(msg.from);
      if (!from) break;
      sound.play(msg.kind === 'arrow' ? 'bow' : msg.kind === 'firebolt' ? 'fire' : msg.kind === 'frostbolt' ? 'frost' : msg.kind === 'magic' ? 'zap' : msg.kind === 'guard' ? 'block' : msg.kind === 'mend' ? 'heal' : msg.kind, from);
      if (msg.kind === 'arrow' || msg.kind === 'firebolt' || msg.kind === 'frostbolt' || msg.kind === 'magic' || msg.kind === 'heal') {
        const start = msg.from === myId && me ? new THREE.Vector3(me.x, me.y + eyeHeight - 0.2, me.z).add(new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)).multiplyScalar(0.6)) : from;
        const to = msg.to;
        fx.projectile(msg.kind, start, () => (to ? posOf(to) : null));
      } else if (msg.kind === 'spin') fx.ring(from.clone().setY(from.y - 1), 3.6, 0xe8e0c8);
      else if (msg.kind === 'nova') { const at = (msg.to ? posOf(msg.to) : null) ?? from; fx.ring(at.clone().setY(at.y - 1), 5, 0x9fdcff, 0.7); }
      else if (msg.kind === 'ignite') fx.flash(from, 0xff7a2a);
      else if (msg.kind === 'slam') fx.ring(from.clone().setY(from.y - 1.5), MOBS[mobs.get(msg.from)?.k ?? 'troll']?.slam?.r ?? 5, 0xb08a60, 0.6);
      else if (msg.kind === 'slamWarn') {
        // A slam is coming: a red ring on the ground where it will land. Get out!
        const k = mobs.get(msg.from)?.k, r = (k && MOBS[k].slam?.r) || 5;
        const gp = mobs.position(msg.from);
        if (gp) fx.warn(new THREE.Vector3(gp.x, groundAt(gp.x, gp.z), gp.z), r, 1.3);
        hud.toast(`${k ? MOBS[k].name : 'It'} raises its arms — get clear!`, 1300, 'error');
      }
      else if (msg.kind === 'mend') fx.ring(from.clone().setY(from.y - 1), 8, 0x7fe08a, 0.8);
      else if (msg.kind === 'guard') fx.ring(from.clone().setY(from.y - 1), 1.2, 0xc8d8ff, 0.5);
      break;
    }
    case 'fish':
      if (msg.state === 'cast') { if (castAt) { fx.setBobber(castAt); sound.play('plop', { x: castAt.x, y: 0, z: castAt.z }); } }
      else if (msg.state === 'bite') {
        fx.bite();
        if (castAt) sound.play('splash', { x: castAt.x, y: 0, z: castAt.z });
        const d = msg.difficulty;
        hud.toast(d >= 1 ? 'Something HUGE is on the line — this will be a fight!' : d >= 0.75 ? 'It pulls hard — something special?' : d >= 0.4 ? 'A bite! A lively one.' : 'A bite! Hold click to reel it in.', 2500, 'rare');
        fishing.start(msg.difficulty, msg.seconds, stats?.scoped.fishing.fishEase ?? 0, (ok) => net.send({ t: 'reel', ok }));
      } else {
        if (castAt) sound.play(msg.state === 'lost' ? 'lost' : 'splash', { x: castAt.x, y: 0, z: castAt.z });
        if (msg.state !== 'lost') sound.play('reel');
        fishing.stop(); fx.setBobber(null); castAt = null; if (msg.state === 'lost') hud.toast('It got away.', 2000);
      }
      break;
  }
});

// ---------------------------------------------------------------- pop-ups and prompts
const pops = document.getElementById('pops')!;
let popRow = 0;
/** Where pop-ups appear: mid-screen, or — with a menu open (crafting, a shop) — just left of it (else right of it, else over its top). */
function placePops() {
  const card = document.getElementById('gameCard');
  const open = card && uiStore.get().panel !== 'none' && card.offsetParent;
  if (!open) { pops.style.left = '50%'; pops.style.top = '42%'; return; }
  const r = card.getBoundingClientRect();
  if (r.left > 240) { pops.style.left = `${r.left - 120}px`; pops.style.top = `${r.top + 90}px`; }
  else if (window.innerWidth - r.right > 240) { pops.style.left = `${r.right + 120}px`; pops.style.top = `${r.top + 90}px`; }
  else { pops.style.left = `${r.left + r.width / 2}px`; pops.style.top = `${r.top + 70}px`; }
}
function pop(text: string, cls = '', item?: string, color?: string) {
  placePops();
  const d = document.createElement('div');
  d.className = `pop ${cls}`;
  d.style.top = `${(popRow++ % 3) * 22}px`;
  if (color) d.style.color = color;
  if (item) { const img = document.createElement('img'); img.src = iconFor(item); d.append(img); }
  d.append(document.createTextNode(text));
  pops.append(d);
  setTimeout(() => d.remove(), 1700);
}

const promptEl = document.getElementById('prompt')!;
const purse = { gold: document.getElementById('goldtext')!, bag: document.getElementById('bagtext')! };
const job = { box: document.getElementById('jobbar')!, text: document.getElementById('jobtext')!, fill: document.getElementById('jobfill')! };
function setPrompt(html: string | null) {
  if (!html) { promptEl.hidden = true; return; }
  if (promptEl.innerHTML !== html) promptEl.innerHTML = html; // only our own fixed strings, never player text
  promptEl.hidden = false;
}

// ---------------------------------------------------------------- what you're pointing at / standing by
type Near = { kind: 'npc'; id: string; name: string } | { kind: 'boat'; id: string; name: string } | { kind: 'home' | 'door' | 'bed'; id: number; name: string } | { kind: 'station'; id: string; name: string } | { kind: 'loot'; id: number; name: string } | { kind: 'corpse'; id: string; name: string } | null;
type Aim = { kind: 'mob'; m: MobState } | { kind: 'ally'; id: string } | { kind: 'vein'; v: Vein } | { kind: 'plant'; p: Plant } | { kind: 'tree'; t: Tree } | { kind: 'water'; p: THREE.Vector3 } | null;
let near: Near = null;
let aimed: Aim = null;
let nextSwingAt = 0, swingUntil = 0, nextAttackAt = 0, spinT = 0, travelAt = 0;
const fwd = new THREE.Vector3();

/** The home (lodge room, cottage or hut) you rent right now, if any. */
function myRoom(): number | null {
  const l = gameStore.get().lease;
  return l.room != null && (l.until ?? 0) > Date.now() ? l.room : null;
}

function use() {
  if (!near || !me) return;
  if (near.kind === 'loot') net.send({ t: 'pickup', id: near.id });
  else if (near.kind === 'corpse') { net.send({ t: 'skin', target: near.id }); sound.play('skin'); }
  else if (near.kind === 'npc') openPanel('npc', { npc: near.id });
  else if (near.kind === 'home') openPanel('home', { home: near.id });
  else if (near.kind === 'bed') net.send({ t: 'rest' });
  else if (near.kind === 'door') {
    // Your own room: open/close it. Anyone else's: see who lives there / rent it.
    if (myRoom() === near.id) net.send({ t: 'door', home: near.id });
    else openPanel('home', { home: near.id });
  }
  else if (near.kind === 'station') openPanel('craft', { station: near.id });
  else if (near.kind === 'boat') { net.send({ t: 'travel', portal: near.id }); sound.play('splash'); }
}

const PLANT_LOOK = 8;
/** Close enough to pick (the same reach as before). */
const plantClose = (p: Plant) => !!me && Math.hypot(p.x - me.x, p.z - me.z) < 2.6;

function blocker(a: NonNullable<Aim>): string | null {
  const g = gameStore.get();
  if (a.kind === 'plant') {
    const type = PLANT_TYPES[a.p.kind], lvl = skillLevel(g.xp, type.skill, stats?.all.skillLvl);
    if (plants.isDepleted(a.p.id)) return `${type.name} — picked clean`;
    if (lvl < type.level) return `${type.name} — needs ${type.skill[0].toUpperCase() + type.skill.slice(1)} ${type.level} (you have ${lvl})`;
    return null;
  }
  if (a.kind !== 'vein' && a.kind !== 'tree') return null;
  const type = a.kind === 'vein' ? VEIN_TYPES[a.v.type] : TREE_TYPES[a.t.kind];
  const slot = type.skill === 'mining' ? 'pickaxe' : 'hatchet';
  const tool = g.equip[slot] ? ITEMS[g.equip[slot]!.id] : null;
  if (a.kind === 'vein' && veins.isDepleted(a.v.id)) return `${type.name} — mined out`;
  if (!tool) return `You need a ${slot} — <b>Ingrid</b> in Bjørkvik’s market sells one`;
  if ((tool.power ?? 0) < type.power) return `You need a stronger ${slot}`;
  const lvl = skillLevel(g.xp, type.skill, stats?.all.skillLvl);
  if (lvl < type.level) return `${type.name} — needs ${type.skill === 'mining' ? 'Mining' : 'Woodcutting'} ${type.level} (you have ${lvl})`;
  return null;
}

function special() {
  if (!me || gameStore.get().dead) return;
  const g = gameStore.get();
  const sp = specialFor(g.equip.mainHand, g.equip.offHand);
  if (Date.now() < g.specialReady) return hud.toast(`${sp.name} is cooling down.`, 1200, 'error');
  let target = aimed?.kind === 'mob' ? aimed.m : null;
  if (!target && (sp.kind === 'spin' || sp.kind === 'nova' || sp.kind === 'ignite')) {
    // Area specials don't need aiming: use the nearest enemy in range.
    let bd = (sp.kind === 'ignite' ? 22 : sp.kind === 'nova' ? attackRange(g.equip.mainHand) : sp.radius ?? 3) + 1; // Nova lands on a target, so: anything in staff range
    for (const m of mobs.all()) { if (m.st & 8) continue; const d = Math.hypot(m.x - me.x, m.z - me.z); if (d < bd) { bd = d; target = m; } }
  }
  if (sp.kind === 'guard' || sp.kind === 'mend') {
    if (sp.kind === 'guard') viewmodel.guard();
    // Raise the shield: no target needed.
    net.send({ t: 'attack', target: target?.id ?? 'none', special: true });
    viewmodel.swing();
    swingUntil = performance.now() + SWING_SEC * 1000;
    return;
  }
  if (!target) return hud.toast(`${sp.name}: aim at an enemy.`, 1400, 'error');
  net.send({ t: 'attack', target: target.id, special: true });
  if (sp.guard) viewmodel.guard();
  viewmodel.swing();
  swingUntil = performance.now() + SWING_SEC * 1000;
  if (sp.kind === 'spin') spinT = 0.45;
}

function interact(now: number, playing: boolean) {
  if (!me) return;
  const g = gameStore.get();
  // Things you can use with E: loot at your feet, or the body, NPC or station you're looking at.
  cam.getWorldDirection(fwd);
  near = null;
  const loot = fx.nearestLoot(me.x, me.z, 2.2);
  // Bodies only count when you could actually skin them (a knife with uses left), and with a
  // tighter hitbox, so the meat and drops around a body are easy to pick up without one.
  const knife = g.equip.knife;
  const canSkin = !!knife && !!ITEMS[knife.id]?.knife && (knife.d ?? knifeUses(knife)) > 0;
  const body = canSkin ? mobs.pick(cam.position, fwd, 2.8, 0, true) : null;
  if (body) near = { kind: 'corpse', id: body.id, name: MOBS[body.k].name.toLowerCase() };
  else if (loot) near = { kind: 'loot', id: loot.id, name: `${ITEMS[loot.item.id]?.name ?? loot.item.id}${loot.item.qty > 1 ? ` ×${loot.item.qty}` : ''}` };
  else {
    // Ray vs. a slim upright cylinder per NPC/station: you have to look at them, not just stand near.
    let best = Infinity;
    const look = (x: number, z: number, r: number, h0: number, h1: number) => {
      if (Math.hypot(me!.x - x, me!.z - z) > USE_RANGE) return Infinity;
      const ox = cam.position.x - x, oz = cam.position.z - z;
      const a = fwd.x * fwd.x + fwd.z * fwd.z, b = 2 * (ox * fwd.x + oz * fwd.z), c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c;
      if (a < 1e-6 || disc < 0) return Infinity;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) return Infinity;
      const y = cam.position.y + fwd.y * t, g = groundAt(x, z);
      return y >= g + h0 && y <= g + h1 ? t : Infinity;
    };
    for (const n of NPCS) {
      const t = look(n.x, n.z, 0.42, 0, RACES[n.race].height + 0.1);
      if (t < best) { best = t; near = { kind: 'npc', id: n.id, name: `${n.name} the ${n.title.toLowerCase()}` }; }
    }
    for (const s of STATIONS) {
      const t = look(s.x, s.z, s.r + 0.15, -0.2, 2.2);
      if (t < best) { best = t; near = { kind: 'station', id: s.id, name: s.name.toLowerCase() }; }
    }
    // Homes. Lodge rooms: the door (open/close or rent), and inside your room the chest and bed.
    // Cottages and huts: the door.
    for (const h of HOMES) {
      const d = homeDoorway(h.id);
      const td = look(d.x, d.z, 0.55, 0, 2.2);
      if (td < best) { best = td; near = { kind: 'door', id: h.id, name: h.kind === 'room' ? `room ${h.id + 1}` : `the ${h.name.toLowerCase()}` }; }
      if (homeAt(me.x, me.z) !== h.id) continue;
      const f = h.kind === 'room' ? innRoom(h.id) : null, hf = HOUSES.find((x) => x.id === h.id);
      const chest = f ? f.chest : h.chest, bed = f ? f.bed : toWorld(hf!, hf!.bed.x, hf!.bed.z);
      const tc = look(chest.x, chest.z, 0.45, -0.3, 0.7);
      if (tc < best) { best = tc; near = { kind: 'home', id: h.id, name: 'chest' }; }
      const tb = look(bed.x, bed.z, 0.6, -0.3, 0.8);
      if (tb < best) { best = tb; near = { kind: 'bed', id: h.id, name: 'bed' }; }
    }
    // A rowboat at the end of the pier: stand at the end and press E.
    if (!near) for (const p of PORTALS) if (p.use && regionAt(p.at.x, p.at.z) === regionAt(me.x, me.z) && Math.hypot(me.x - p.at.x, me.z - p.at.z) < p.at.r + 0.6) near = { kind: 'boat', id: p.id, name: p.name };
  }
  // Portals (the mine, the Gruben pass): walk in. (Rowboats are taken with E.)
  if (now > travelAt) {
    const portal = PORTALS.find((p) => !p.use && regionAt(p.at.x, p.at.z) === regionAt(me!.x, me!.z) && Math.hypot(me!.x - p.at.x, me!.z - p.at.z) < p.at.r);
    if (portal) { net.send({ t: 'travel', portal: portal.id }); travelAt = now + 3000; }
  }

  // What's under the crosshair.
  const main = g.equip.mainHand;
  const reach = attackRange(main);
  const ranged = reach > 6;
  aimed = null;
  const healer = weaponClass(main) === 'lifeStaff';
  const ally = healer ? remotes.pick(cam.position, fwd, reach) : null;
  const m = ally ? null : mobs.pick(cam.position, fwd, ranged ? reach : reach + 0.6, ranged ? 0.1 : 0.25);
  if (ally) aimed = { kind: 'ally', id: ally };
  else if (m) aimed = { kind: 'mob', m };
  else {
    const v = veins.target(cam.position, fwd, MINE_RANGE + 0.6);
    // Plants are named from a few metres away (so you can tell what's pickable), picked up close.
    const pl = v ? null : plants.target(cam.position, fwd, PLANT_LOOK);
    if (v) aimed = { kind: 'vein', v };
    else if (pl) aimed = { kind: 'plant', p: pl };
    else {
      const t = targetTree(cam.position, fwd, MINE_RANGE + 0.4);
      if (t) aimed = { kind: 'tree', t };
      else if (g.equip.rod && fwd.y < -0.02) {
        const dist = (WATER_LEVEL - cam.position.y) / fwd.y;
        if (dist > 0 && dist < CAST_RANGE + 4) {
          const p = cam.position.clone().addScaledVector(fwd, dist);
          if (isFishable(p.x, p.z) && Math.hypot(p.x - me.x, p.z - me.z) <= CAST_RANGE) aimed = { kind: 'water', p };
        }
      }
    }
  }
  veins.setHighlight(aimed?.kind === 'vein' ? aimed.v.id : null);
  plants.setHighlight(aimed?.kind === 'plant' ? aimed.p.id : null);
  mobs.setTarget(aimed?.kind === 'mob' ? aimed.m.id : null);
  const block = aimed ? blocker(aimed) : null;

  // Left click.
  if (playing && input.mouseDown && !fishing.active) {
    if (healer && (aimed?.kind === 'ally' || (!aimed && gameStore.get().hp < gameStore.get().maxHp))) {
      // Life staff: heal whoever you aim at, or yourself.
      if (now >= nextAttackAt) {
        nextAttackAt = now + attackInterval(main, stats?.all) * 1000;
        net.send({ t: 'heal', target: aimed?.kind === 'ally' ? aimed.id : 'self' });
        viewmodel.swing();
        swingUntil = now + SWING_SEC * 1000;
      }
    } else if (aimed?.kind === 'mob') {
      if (now >= nextAttackAt) {
        nextAttackAt = now + attackInterval(main, stats?.all) * 1000;
        net.send({ t: 'attack', target: aimed.m.id, special: false });
        if (attackRange(main) < 6) sound.play('swing');
        viewmodel.swing();
        swingUntil = now + SWING_SEC * 1000;
      }
    } else if ((aimed?.kind === 'vein' || aimed?.kind === 'tree') && !block && now >= nextSwingAt) {
      const skill = aimed.kind === 'vein' ? 'mining' : 'woodcutting';
      const slot = skill === 'mining' ? 'pickaxe' : 'hatchet';
      const def = ITEMS[g.equip[slot]!.id];
      const lvl = skillLevel(g.xp, skill, stats?.all.skillLvl);
      const sp = stats ? (skill === 'mining' ? stats.scoped.mining.miningSpeed : stats.scoped.woodcutting.woodSpeed) : 0;
      nextSwingAt = now + Math.max(swingSeconds(def.swingSec ?? 2.6, lvl, sp) * 1000, SWING_SEC * 1000);
      const id = aimed.kind === 'vein' ? aimed.v.id : aimed.t.id;
      if (g.held !== slot) net.send({ t: 'hold', slot });
      viewmodel.swing();
      sound.play('swing');
      setTimeout(() => { net.send(skill === 'mining' ? { t: 'mine', node: id } : { t: 'chop', node: id }); if (skill === 'mining') veins.hit(id); sound.play(skill === 'mining' ? 'mine' : 'chop'); }, SWING_SEC * STRIKE_AT * 1000);
      swingUntil = now + SWING_SEC * 1000;
    } else if (aimed?.kind === 'plant' && !block && plantClose(aimed.p) && now >= nextSwingAt) {
      const lvl = skillLevel(g.xp, PLANT_TYPES[aimed.p.kind].skill, stats?.all.skillLvl);
      nextSwingAt = now + Math.max(PICK_SEC * (1 - 0.01 * (lvl - 1)) * 1000, SWING_SEC * 1000);
      const id = aimed.p.id;
      setTimeout(() => { net.send({ t: 'pick', node: id }); plants.hit(id); sound.play('pick'); }, 250);
      swingUntil = now + SWING_SEC * 1000;
    } else if (aimed?.kind === 'water' && !castAt && now >= nextSwingAt) {
      castAt = aimed.p.clone();
      nextSwingAt = now + 1200;
      net.send({ t: 'cast', x: r2(castAt.x), z: r2(castAt.z) });
      sound.play('cast');
      viewmodel.swing();
    } else if (!aimed && now >= nextSwingAt && g.equip[g.held]) {
      nextSwingAt = now + SWING_SEC * 1000;
      sound.play('swing');
      viewmodel.swing();
      swingUntil = now + SWING_SEC * 1000;
    }
  }

  // Prompt under the crosshair.
  if (!playing || fishing.active) setPrompt(null);
  else if (near?.kind === 'boat') setPrompt(`<b>E</b> Travel — ${near.name}`);
  else if (castAt) setPrompt('Waiting for a bite… (walk away to stop)');
  else if (aimed?.kind === 'ally') setPrompt(`<b>Click</b> heal · <b>Right click</b> Mending Circle`);
  else if (aimed?.kind === 'mob') setPrompt(`<b>Click</b> attack · <b>Right click</b> ${specialFor(main, gameStore.get().equip.offHand).name}`);
  else if (aimed?.kind === 'vein' || aimed?.kind === 'tree') {
    const name = aimed.kind === 'vein' ? VEIN_TYPES[aimed.v.type].name.toLowerCase() : TREE_TYPES[aimed.t.kind].name.toLowerCase();
    setPrompt(block ? `<span class="bad">${block}</span>` : `Hold <b>click</b> to ${aimed.kind === 'vein' ? 'mine' : 'chop'} ${name}`);
  } else if (aimed?.kind === 'plant') {
    const type = PLANT_TYPES[aimed.p.kind], skill = type.skill[0].toUpperCase() + type.skill.slice(1);
    const what = `<b>${type.name}</b> <span class="dim">· ${skill} ${type.level} · gives ${ITEMS[type.item]?.name ?? type.item}</span>`;
    setPrompt(block ? `<span class="bad">${block}</span>` : plantClose(aimed.p) ? `Hold <b>click</b> to pick · ${what}` : `${what} · walk closer to pick`);
  } else if (aimed?.kind === 'water') setPrompt('<b>Click</b> to cast');
  else if (near) setPrompt(`<b>E</b> ${near.kind === 'loot' ? `Pick up ${near.name}` : near.kind === 'corpse' ? `Skin the ${near.name}` : near.kind === 'npc' ? `Talk to ${near.name}` : near.kind === 'home' ? (near.name === 'chest' ? 'Open your chest' : `Knock on the ${near.name}`) : near.kind === 'bed' ? 'Rest (Rested: more XP for 30 min)' : near.kind === 'door' ? (myRoom() === near.id ? `${places.doorOpen(near.id) ? 'Close' : 'Open'} your door` : `Knock on ${near.name}`) : `Use the ${near.name}`}`);
  else setPrompt(null);

  // Purse and crafting bar.
  purse.gold.textContent = `${g.gold} g`;
  purse.bag.textContent = `Bag ${g.bag.filter(Boolean).length}/${g.bag.length}`;
  const j = g.job;
  job.box.hidden = !j;
  if (j) {
    job.text.textContent = `${ITEMS[RECIPE_BY_ID.get(j.recipe)!.output.item].name} ${j.done + 1}/${j.total}`;
    job.fill.style.width = `${Math.round(100 * Math.min(1, Math.max(0, 1 - (j.endsAt - now) / (j.seconds * 1000))))}%`;
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let walkPh = 0;
let flyT = 0;

function sendInput(now: number, act: 'swing' | 'shoot' | 'cast' | 'spin' | undefined) {
  if (!me || now - lastSent.at < 1000 / INPUT_HZ) return;
  const moved = Math.abs(me.x - lastSent.x) + Math.abs(me.y - lastSent.y) + Math.abs(me.z - lastSent.z) > 0.01;
  const turned = Math.abs(me.yaw - lastSent.yaw) + Math.abs(me.pitch - lastSent.pitch) > 0.01;
  if (!moved && !turned && !act && now - lastSent.at < 1000) return;
  net.send({ t: 'input', seq: ++seq, x: r2(me.x), y: r2(me.y), z: r2(me.z), yaw: r3(me.yaw), pitch: r3(me.pitch), act });
  lastSent = { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, at: now };
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();
  const u = uiStore.get();
  if (u.bossKey) return;

  const dead = gameStore.get().dead;
  const playing = u.panel === 'none' && !u.chatOpen && input.locked && !dead;
  let look = { dx: 0, dy: 0 };
  if (me) {
    look = input.consumeLook();
    if (playing) {
      const k = 0.0022 * settingsStore.get().sensitivity;
      me.yaw -= look.dx * k;
      me.pitch = THREE.MathUtils.clamp(me.pitch - look.dy * k, -1.5, 1.5);
    }
    places.updateDoors(dt, me.x, me.z, myRoom());
    const colliders = terrain.collidersNear(me.x, me.z).concat(veins.collidersNear(me.x, me.z), places.colliders);
    const moveIn = playing && !fishing.active ? input.axes() : { forward: 0, right: 0, jump: false };
    const mounted = gameStore.get().mounted;
    mountedNow = !!mounted;
    stepPlayer(me, moveIn, colliders, dt, stats?.all.moveSpeed ?? 0, mounted ? ITEMS[mounted]?.mount?.mult ?? 1 : 1);
    mountLift += ((mounted && myBuild ? riderEyeLift(mounted, myBuild.race) : 0) - mountLift) * Math.min(1, dt * 6);
    if (myHorse) {
      myHorse.g.position.set(me.x, me.y, me.z);
      myHorse.g.rotation.y = me.yaw;
      animateHorse(myHorse, me.speed, dt);
    }
    const g = gameStore.get();
    const style = weaponClass(g.equip.mainHand);
    const act = now < swingUntil ? (spinT > 0 ? 'spin' : g.held === 'mainHand' ? (style === 'bow' ? 'shoot' : style === 'fireStaff' || style === 'frostStaff' ? 'cast' : 'swing') : 'swing') : undefined;
    sendInput(now, act);
    const under = inCaveRegion(me.x, me.z);
    gfx.setUnderground(under);
    const region = regionAt(me.x, me.z);
    gfx.setRegion(region);
    // Time of day and weather (the same for everyone: worked out from the clock).
    const ms = Date.now() + debugSky.offset, sunDir = sunAt(ms), day = daylight(ms), weather = debugSky.weather ?? weatherAt(region, ms);
    // Sky, fog, clock and ambience change slowly: a few updates a second is plenty.
    const slow = now >= nextSlowAt;
    if (slow) {
      nextSlowAt = now + 200;
      gfx.setAtmosphere(sunDir, day, weather);
      places.setNight(1 - day);
      hud.setClock(ms, under ? null : weather.kind);
    }
    precip.update(dt, cam.position, weather.rain, weather.snow, under || homeAt(me.x, me.z) >= 0);
    caveView.setVisible(under);
    if (!under) { terrain.update(me.x, me.z); terrain.followWater(me.x, me.z); }

    // Footsteps (hooves when riding): one per half stride, by what's underfoot.
    const prevPh = walkPh;
    walkPh += dt * me.speed * 1.6;
    if (me.onGround && me.speed > 0.6 && Math.floor(walkPh / Math.PI) !== Math.floor(prevPh / Math.PI)) {
      const onWood = homeAt(me.x, me.z) >= 0 || (pierDeck(me.x, me.z) != null && me.y > 0.6);
      const kind = mountedNow ? 'hoof' : onWood ? 'stepWood' : under ? 'stepStone' : region === 'gruben' && weather.snow > 0.5 ? 'stepSnow' : 'stepGrass';
      sound.play(kind);
      if (mountedNow) setTimeout(() => sound.play('hoof'), 110);
    }
    if (me.onGround && !wasOnGround) sound.play('land');
    wasOnGround = me.onGround;
    // Sound: listener at the camera; ambience follows weather, hour and place.
    sound.setListener(cam.position.x, cam.position.y, cam.position.z, me.yaw);
    if (now > nextAmbAt) {
      nextAmbAt = now + 400;
      const fires = places.firePositions();
      let fire: THREE.Vector3 | null = null, fd = 12;
      for (const f of fires) { const d2 = Math.hypot(f.x - me.x, f.z - me.z); if (d2 < fd) { fd = d2; fire = f; } }
      let water = 0;
      if (!under) for (let a = 0; a < 8; a++) { const wx = me.x + Math.cos(a * 0.785) * 10, wz = me.z + Math.sin(a * 0.785) * 10; if (heightAtWorld(wx, wz) < WATER_LEVEL) water += 0.125; }
      ambFire = fire; ambWater = water;
    }
    if (slow) sound.ambience({ day, rain: weather.rain, snow: weather.snow, region, indoors: homeAt(me.x, me.z) >= 0, height: me.y, nearWater: ambWater, fire: ambFire });
    const bob = me.onGround ? Math.min(1, me.speed / 5) : 0;
    cam.position.set(me.x, me.y + eyeHeight + mountLift + Math.abs(Math.sin(walkPh)) * 0.04 * bob * (eyeHeight / EYE_HEIGHT), me.z);
    cam.rotation.set(me.pitch, me.yaw + (spinT > 0 ? (1 - spinT / 0.45) * Math.PI * 2 : 0), 0, 'YXZ');
    spinT = Math.max(0, spinT - dt);
    gfx.follow(cam.position);
    hud.frame(me.x, me.z);
    interact(now, playing);
    fishing.update(dt, input.mouseDown || input.down('Space'));
    mapInfo.me = { x: me.x, z: me.z, yaw: me.yaw };
    mapInfo.others = netStore.get().online.filter((p) => p.id !== myId).map((p) => {
      const pos = remotePosition(remotes, p.id);
      return pos ? { x: pos.x, z: pos.z, name: p.name, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    if (castAt && Math.hypot(me.x - castAt.x, me.z - castAt.z) > CAST_RANGE + 3) { castAt = null; fx.setBobber(null); }
    if (now >= nextMiniAt) { nextMiniAt = now + 250; drawMinimap(minimap, mobs.all().filter((m) => !(m.st & 8)).map((m) => ({ x: m.x, z: m.z, boss: MOBS[m.k].boss }))); }
  } else {
    flyT += dt * 0.04;
    cam.position.set(Math.cos(flyT) * 46, 20, Math.sin(flyT) * 46);
    cam.lookAt(0, 4, 0);
    gfx.follow(new THREE.Vector3(0, 0, 0));
  }

  remotes.update(dt);
  mobs.update(dt);
  fx.update(dt);
  viewmodel.update(dt, me?.speed ?? 0, playing ? look.dx : 0, playing ? look.dy : 0);
  veins.animate(dt);
  plants.animate(dt, performance.now() / 1000, cam.position);
  animateTrees(dt);
  places.animate(dt, cam.position);
  caveView.animate(dt);
  panels.frame();
  hotbar.frame();

  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);
  terrain.animate(clock.elapsedTime);
  gfx.renderWorld();
  if (me && u.panel !== 'character' && viewmodel.root.visible && !dead) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
  preview.render(renderer, dt);
  creatorPreview.render(renderer, dt);
  updateLabels(cam);
}
frame();

// Exposed for automated smoke tests and debugging in the console.
(window as any).__kontor = {
  get me() { return me; }, get build() { return myBuild; }, get aimed() { return aimed; }, get near() { return near; }, get stats() { return stats; },
  trees: TREE_BY_ID, remotes, net, terrain, veins, mobs, places, debugSky, sound, fx, viewmodel, netStore, uiStore, gameStore, settingsStore, creatorPreview, preview, auth, openPanel, fishing, use, special,
};
