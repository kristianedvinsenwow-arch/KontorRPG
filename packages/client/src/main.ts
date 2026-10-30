/**
 * KontorRPG client entry: wires renderer, terrain, local player, network and UI, and runs the loop.
 */
import './styles.css';
import * as THREE from 'three';
import {
  EYE_HEIGHT, INPUT_HZ, ITEMS, MINE_RANGE, RACES, RECIPE_BY_ID, STATIONS, TRADING_POST, USE_RANGE, VEIN_TYPES,
  derive, levelFromXp, r2, r3, swingSeconds,
  type CharacterBuild, type StationId, type Vein,
} from '@kontor/shared';
import { createGfx } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { Terrain } from './world/terrain.js';
import { makeViewmodel, SWING_SEC, STRIKE_AT } from './entities/viewmodel.js';
import { heldOf } from './entities/held.js';
import { Veins } from './world/veins.js';
import { Camp } from './world/camp.js';
import { initPanels } from './ui/panels.js';
import { iconFor } from './ui/icons.js';
import { createLocalPlayer, stepPlayer, type LocalPlayer } from './physics/movement.js';
import { NetClient } from './net/client.js';
import { Remotes } from './net/remotes.js';
import { gameStore, netStore, settingsStore, uiStore } from './state/store.js';
import { initHud } from './ui/hud.js';
import { initPause, initBossKey } from './ui/menu.js';
import { initCreator } from './ui/creator.js';
import { initAccount } from './ui/account.js';
import { Auth } from './net/auth.js';
import { CharacterPreview, fillCharacterPanel, fillEquipment } from './ui/characterPanel.js';

const view = document.getElementById('view')!;
const gfx = createGfx(view, settingsStore.get().quality);
const { renderer, scene, cam, vmScene, vmCam } = gfx;
settingsStore.subscribe((s) => { if (s.quality !== gfx.quality) gfx.setQuality(s.quality); });

const terrain = new Terrain(scene);
terrain.dense = settingsStore.get().quality !== 'low';
terrain.update(0, 0, 99); // build the spawn area up front
const veins = new Veins(scene);
const camp = new Camp(scene);
const input = new Input(renderer.domElement);
const viewmodel = makeViewmodel(vmScene);
const preview = new CharacterPreview('preview', () => uiStore.get().panel === 'character');
const creatorPreview = new CharacterPreview('createPreview', () => uiStore.get().panel === 'menu');
preview.setEnvironment(scene.environment);
creatorPreview.setEnvironment(scene.environment);
const remotes = new Remotes(scene);
const net = new NetClient();
const auth = new Auth();

let me: LocalPlayer | null = null;
let myBuild: CharacterBuild | null = null;
let speedBonus = 0;
let eyeHeight = EYE_HEIGHT;
let seq = 0;
let lastSent = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, at: 0 };

// ---------------------------------------------------------------- UI wiring
const hud = initHud((text) => net.send({ t: 'chat', text }));

const syncCreatorPreview = () => {
  const s = settingsStore.get();
  creatorPreview.setCharacter(s.color, s.build.race);
};
/** Apply a character (from the creator, or the saved one the server sends back). */
function useCharacter(name: string, color: number, build: CharacterBuild) {
  myBuild = build;
  speedBonus = derive(build).speedBonus;
  eyeHeight = RACES[build.race].eye;
  preview.setCharacter(color, build.race);
  fillCharacterPanel(name, build);
}
initCreator(
  (name, color, build) => {
    useCharacter(name, color, build);
    net.connect(name, color, build, () => auth.token);
    uiStore.set({ panel: 'none' });
    input.lock();
  },
  syncCreatorPreview,
);
void auth.init().then(() => initAccount(auth));
syncCreatorPreview();
initPause(() => { uiStore.set({ panel: 'none' }); input.lock(); });
initBossKey(() => input.unlock());

const panels = initPanels((m) => net.send(m), () => { if (me) input.lock(); });
const GAME_PANELS = ['inventory', 'skills', 'craft', 'shop'];
function openPanel(panel: 'inventory' | 'skills' | 'craft' | 'shop', station?: StationId) {
  uiStore.set({ panel, ...(station ? { station } : {}) });
  input.unlock();
}

renderer.domElement.addEventListener('click', () => {
  const p = uiStore.get().panel;
  if ((p === 'none' || p === 'pause') && me) { uiStore.set({ panel: 'none' }); input.lock(); }
});

document.addEventListener('pointerlockchange', () => {
  const u = uiStore.get();
  if (!input.locked && u.panel === 'none' && !u.chatOpen && !u.bossKey && me) uiStore.set({ panel: 'pause' });
});

input.onKey((code) => {
  const u = uiStore.get();
  if (u.panel === 'menu' || u.bossKey) return;
  if (GAME_PANELS.includes(u.panel)) {
    const closeKey = { inventory: 'KeyI', skills: 'KeyK', craft: 'KeyE', shop: 'KeyE' }[u.panel as 'inventory'];
    if (code === 'Escape' || code === closeKey || (code === 'KeyI' && u.panel === 'shop')) { uiStore.set({ panel: 'none' }); return; }
    if (code === 'KeyI') { openPanel('inventory'); return; }
    if (code === 'KeyK') { openPanel('skills'); return; }
    return;
  }
  if (u.panel === 'none' && !u.chatOpen && me) {
    if (code === 'KeyI') return openPanel('inventory');
    if (code === 'KeyK') return openPanel('skills');
    if (code === 'KeyE' && near) return near.kind === 'shop' ? openPanel('shop') : openPanel('craft', near.station);
  }
  if (code === 'KeyC') {
    if (u.panel === 'character') { uiStore.set({ panel: 'none' }); input.lock(); }
    else { uiStore.set({ panel: 'character' }); input.unlock(); }
  } else if (code === 'Enter' && !u.chatOpen && u.panel === 'none') {
    uiStore.set({ chatOpen: true });
    input.unlock();
  } else if (code === 'Escape' && u.panel === 'character') {
    uiStore.set({ panel: 'none' });
  }
});
document.getElementById('closeChar')!.onclick = () => { uiStore.set({ panel: 'none' }); input.lock(); };
uiStore.subscribe((u) => {
  document.getElementById('charPanel')!.hidden = u.panel !== 'character';
  // Chat closed again → back into the game.
  if (!u.chatOpen && u.panel === 'none' && me && !input.locked && document.activeElement?.id === 'chatin') input.lock();
});

// ---------------------------------------------------------------- network events
net.on((msg) => {
  switch (msg.t) {
    case 'welcome':
      useCharacter(msg.character.name, msg.character.color, msg.character.build);
      if (msg.saved) hud.system(`Welcome back, ${msg.character.name}.`);
      if (!me) me = createLocalPlayer(msg.you.x, msg.you.y, msg.you.z, msg.you.yaw);
      else { me.x = msg.you.x; me.y = msg.you.y; me.z = msg.you.z; } // reconnect: server's spawn wins
      lastSent = { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, at: performance.now() };
      seq = 0;
      break;
    case 'snap':
      remotes.ingest(msg.at, msg.players);
      break;
    case 'leave':
      remotes.remove(msg.id);
      break;
    case 'roster':
      netStore.set({ online: msg.players });
      break;
    case 'correct':
      if (me) { me.x = msg.x; me.y = msg.y; me.z = msg.z; me.vx = me.vz = me.vy = 0; }
      break;
    case 'chat': {
      const who = netStore.get().online.find((p) => p.id === msg.from);
      hud.chat(msg.name, who?.color ?? 0, msg.text);
      break;
    }
    case 'inv': {
      gameStore.set({ bag: msg.bag, equip: msg.equip, gold: msg.gold });
      const gear = { t: msg.equip.tool, m: msg.equip.mainHand, s: msg.equip.shoulders, b: msg.equip.back };
      viewmodel.setHeld(heldOf(gear));
      preview.setGear(gear);
      fillEquipment(msg.equip);
      break;
    }
    case 'skills':
      gameStore.set({ xp: msg.xp });
      break;
    case 'gain':
      if (msg.item) pop(`+${msg.qty ?? 1} ${ITEMS[msg.item]?.name ?? msg.item}`, msg.rare ? 'rare' : '', msg.item);
      if (msg.xp && msg.skill) setTimeout(() => pop(`+${msg.xp} ${msg.skill![0].toUpperCase()}${msg.skill!.slice(1)} XP`, 'xp'), 180);
      break;
    case 'nodes':
      veins.setDepleted(msg.depleted);
      break;
    case 'job':
      gameStore.set({ job: msg.recipe ? { recipe: msg.recipe, done: msg.done, total: msg.total, seconds: RECIPE_BY_ID.get(msg.recipe)?.seconds ?? msg.seconds, endsAt: performance.now() + msg.seconds * 1000 } : null });
      break;
    case 'notice':
      hud.toast(msg.text, msg.kind === 'rare' ? 6000 : 3500, msg.kind);
      if (msg.kind !== 'error') hud.system(msg.text);
      break;
    case 'system':
      hud.system(msg.text);
      if (/reloading|restarting/i.test(msg.text)) hud.toast(msg.text, 5000);
      break;
  }
});

// ---------------------------------------------------------------- mining & interaction
const pops = document.getElementById('pops')!;
let popRow = 0;
function pop(text: string, cls = '', item?: string) {
  const d = document.createElement('div');
  d.className = `pop ${cls}`;
  d.style.top = `${(popRow++ % 3) * 22}px`;
  if (item) { const img = document.createElement('img'); img.src = iconFor(item); d.append(img); }
  d.append(document.createTextNode(text));
  pops.append(d);
  setTimeout(() => d.remove(), 1700);
}

/** What's in front of you or next to you this frame. */
let near: { kind: 'shop' } | { kind: 'craft'; station: StationId } | null = null;
let aimed: Vein | null = null;
let nextSwingAt = 0;
let swingUntil = 0;
const promptEl = document.getElementById('prompt')!;
const purse = { gold: document.getElementById('goldtext')!, bag: document.getElementById('bagtext')! };
const job = { box: document.getElementById('jobbar')!, text: document.getElementById('jobtext')!, fill: document.getElementById('jobfill')! };
const fwd = new THREE.Vector3();

function setPrompt(html: string | null) {
  if (!html) { promptEl.hidden = true; return; }
  if (promptEl.innerHTML !== html) promptEl.innerHTML = html; // only our own fixed strings, never player text
  promptEl.hidden = false;
}

/** Why you can't mine this vein right now, or null if you can. */
function mineBlocker(v: Vein): string | null {
  const g = gameStore.get();
  const type = VEIN_TYPES[v.type];
  const tool = g.equip.tool ? ITEMS[g.equip.tool] : null;
  if (veins.isDepleted(v.id)) return `${type.name} — depleted, back in ${veins.secondsLeft(v.id)}s`;
  if (!tool) return `You need a pickaxe — <b>Trader Ingrid</b> at the trading post sells one`;
  if ((tool.toolPower ?? 0) < type.power) return 'You need a stronger pickaxe';
  const lvl = levelFromXp(g.xp.mining ?? 0);
  if (lvl < type.level) return `${type.name} — needs Mining ${type.level} (you have ${lvl})`;
  return null;
}

function interact(now: number, playing: boolean) {
  if (!me) return;
  // Stations and the trader: walk up to them and press E.
  near = null;
  const d = (p: { x: number; z: number }) => Math.hypot(me!.x - p.x, me!.z - p.z);
  let best = USE_RANGE;
  if (d(TRADING_POST) < best) { near = { kind: 'shop' }; best = d(TRADING_POST); }
  for (const id of Object.keys(STATIONS) as StationId[]) if (d(STATIONS[id]) < best) { near = { kind: 'craft', station: id }; best = d(STATIONS[id]); }

  cam.getWorldDirection(fwd);
  aimed = veins.target(cam.position, fwd, MINE_RANGE + 0.6);
  veins.setHighlight(aimed?.id ?? null);
  const blocked = aimed ? mineBlocker(aimed) : null;
  const g = gameStore.get();
  const tool = g.equip.tool ? ITEMS[g.equip.tool] : null;

  if (playing && input.mouseDown && now >= nextSwingAt && (tool || g.equip.mainHand)) {
    if (aimed && !blocked && tool) {
      const lvl = levelFromXp(g.xp.mining ?? 0);
      const ms = swingSeconds(tool.swingSec ?? 2.6, lvl, myBuild ? derive(myBuild).miningSpeed : 0) * 1000;
      nextSwingAt = now + Math.max(ms, SWING_SEC * 1000);
      const target = aimed.id;
      viewmodel.swing();
      setTimeout(() => { net.send({ t: 'mine', node: target }); veins.hit(target); }, SWING_SEC * STRIKE_AT * 1000);
    } else {
      nextSwingAt = now + SWING_SEC * 1000; // swinging at air
      viewmodel.swing();
    }
    swingUntil = now + SWING_SEC * 1000;
  }

  if (!playing) setPrompt(null);
  else if (aimed) setPrompt(blocked ? `<span class="bad">${blocked}</span>` : `Hold <b>click</b> to mine ${VEIN_TYPES[aimed.type].name.toLowerCase()}`);
  else if (near?.kind === 'shop') setPrompt(`<b>E</b> Trade with Ingrid`);
  else if (near?.kind === 'craft') setPrompt(`<b>E</b> Use the ${STATIONS[near.station].name.toLowerCase()}`);
  else setPrompt(null);

  // HUD purse and crafting bar.
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

function sendInput(now: number, swinging: boolean) {
  if (!me || now - lastSent.at < 1000 / INPUT_HZ) return;
  const moved = Math.abs(me.x - lastSent.x) + Math.abs(me.y - lastSent.y) + Math.abs(me.z - lastSent.z) > 0.01;
  const turned = Math.abs(me.yaw - lastSent.yaw) + Math.abs(me.pitch - lastSent.pitch) > 0.01;
  if (!moved && !turned && !swinging && now - lastSent.at < 1000) return;
  net.send({ t: 'input', seq: ++seq, x: r2(me.x), y: r2(me.y), z: r2(me.z), yaw: r3(me.yaw), pitch: r3(me.pitch), act: swinging ? 'swing' : undefined });
  lastSent = { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, at: now };
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();
  const u = uiStore.get();
  if (u.bossKey) return; // nothing drawn while the spreadsheet is up

  const playing = u.panel === 'none' && !u.chatOpen && input.locked;

  let look = { dx: 0, dy: 0 };
  if (me) {
    look = input.consumeLook();
    if (playing) {
      const k = 0.0022 * settingsStore.get().sensitivity;
      me.yaw -= look.dx * k;
      me.pitch = THREE.MathUtils.clamp(me.pitch - look.dy * k, -1.5, 1.5);
    }
    const colliders = terrain.collidersNear(me.x, me.z).concat(veins.collidersNear(me.x, me.z), camp.colliders);
    stepPlayer(me, playing ? input.axes() : { forward: 0, right: 0, jump: false }, colliders, dt, speedBonus);
    sendInput(now, now < swingUntil);
    terrain.update(me.x, me.z);

    walkPh += dt * me.speed * 1.6;
    const bob = me.onGround ? Math.min(1, me.speed / 5) : 0;
    cam.position.set(me.x, me.y + eyeHeight + Math.abs(Math.sin(walkPh)) * 0.04 * bob * (eyeHeight / EYE_HEIGHT), me.z);
    cam.rotation.set(me.pitch, me.yaw, 0);
    gfx.follow(cam.position);
    hud.frame(me.x, me.z);
    interact(now, playing);
  } else {
    // Menu: slow flyover of the spawn clearing.
    flyT += dt * 0.04;
    cam.position.set(Math.cos(flyT) * 46, 20, Math.sin(flyT) * 46);
    cam.lookAt(0, 4, 0);
    gfx.follow(new THREE.Vector3(0, 0, 0));
  }

  remotes.update(dt);
  viewmodel.update(dt, me?.speed ?? 0, playing ? look.dx : 0, playing ? look.dy : 0);
  veins.animate(dt);
  camp.animate(dt);
  panels.frame();

  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);
  terrain.animate(clock.elapsedTime);
  gfx.renderWorld();
  if (me && u.panel !== 'character' && viewmodel.root.visible) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
  preview.render(renderer, dt);
  creatorPreview.render(renderer, dt);
}
frame();

// Exposed for automated smoke tests and debugging in the console.
(window as any).__kontor = { get me() { return me; }, get build() { return myBuild; }, get aimed() { return aimed; }, remotes, net, terrain, veins, netStore, uiStore, gameStore, settingsStore, creatorPreview, preview, auth, openPanel };
