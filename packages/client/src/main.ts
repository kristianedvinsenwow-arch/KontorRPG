/**
 * KontorRPG client entry: wires renderer, terrain, local player, network and UI, and runs the loop.
 */
import './styles.css';
import * as THREE from 'three';
import { EYE_HEIGHT, INPUT_HZ, RACES, derive, r2, r3, type CharacterBuild } from '@kontor/shared';
import { createGfx } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { Terrain } from './world/terrain.js';
import { makeViewmodel } from './entities/viewmodel.js';
import { createLocalPlayer, stepPlayer, type LocalPlayer } from './physics/movement.js';
import { NetClient } from './net/client.js';
import { Remotes } from './net/remotes.js';
import { netStore, settingsStore, uiStore } from './state/store.js';
import { initHud } from './ui/hud.js';
import { initPause, initBossKey } from './ui/menu.js';
import { initCreator } from './ui/creator.js';
import { CharacterPreview, fillCharacterPanel } from './ui/characterPanel.js';

const view = document.getElementById('view')!;
const gfx = createGfx(view, settingsStore.get().quality);
const { renderer, scene, cam, vmScene, vmCam } = gfx;
settingsStore.subscribe((s) => { if (s.quality !== gfx.quality) gfx.setQuality(s.quality); });

const terrain = new Terrain(scene);
terrain.dense = settingsStore.get().quality !== 'low';
terrain.update(0, 0, 99); // build the spawn area up front
const input = new Input(renderer.domElement);
const viewmodel = makeViewmodel(vmScene);
const preview = new CharacterPreview('preview', () => uiStore.get().panel === 'character');
const creatorPreview = new CharacterPreview('createPreview', () => uiStore.get().panel === 'menu');
const remotes = new Remotes(scene);
const net = new NetClient();

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
initCreator(
  (name, color, build) => {
    myBuild = build;
    speedBonus = derive(build).speedBonus;
    eyeHeight = RACES[build.race].eye;
    net.connect(name, color, build);
    preview.setCharacter(color, build.race);
    fillCharacterPanel(name, build);
    uiStore.set({ panel: 'none' });
    input.lock();
  },
  syncCreatorPreview,
);
syncCreatorPreview();
initPause(() => { uiStore.set({ panel: 'none' }); input.lock(); });
initBossKey(() => input.unlock());

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
    case 'system':
      hud.system(msg.text);
      if (/reloading|restarting/i.test(msg.text)) hud.toast(msg.text, 5000);
      break;
  }
});

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
  let swinging = false;

  let look = { dx: 0, dy: 0 };
  if (me) {
    look = input.consumeLook();
    if (playing) {
      const k = 0.0022 * settingsStore.get().sensitivity;
      me.yaw -= look.dx * k;
      me.pitch = THREE.MathUtils.clamp(me.pitch - look.dy * k, -1.5, 1.5);
      swinging = input.mouseDown;
    }
    stepPlayer(me, playing ? input.axes() : { forward: 0, right: 0, jump: false }, terrain.collidersNear(me.x, me.z), dt, speedBonus);
    sendInput(now, swinging);
    terrain.update(me.x, me.z);

    walkPh += dt * me.speed * 1.6;
    const bob = me.onGround ? Math.min(1, me.speed / 5) : 0;
    cam.position.set(me.x, me.y + eyeHeight + Math.abs(Math.sin(walkPh)) * 0.04 * bob * (eyeHeight / EYE_HEIGHT), me.z);
    cam.rotation.set(me.pitch, me.yaw, 0);
    gfx.follow(cam.position);
    hud.frame(me.x, me.z);
  } else {
    // Menu: slow flyover of the spawn clearing.
    flyT += dt * 0.04;
    cam.position.set(Math.cos(flyT) * 46, 20, Math.sin(flyT) * 46);
    cam.lookAt(0, 4, 0);
    gfx.follow(new THREE.Vector3(0, 0, 0));
  }

  remotes.update(dt);
  viewmodel.update(dt, me?.speed ?? 0, swinging, playing ? look.dx : 0, playing ? look.dy : 0);

  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);
  terrain.animate(clock.elapsedTime);
  gfx.renderWorld();
  if (me && u.panel !== 'character') {
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
  preview.render(renderer, dt);
  creatorPreview.render(renderer, dt);
}
frame();

// Exposed for automated smoke tests and debugging in the console.
(window as any).__kontor = { get me() { return me; }, get build() { return myBuild; }, remotes, net, terrain, netStore, uiStore, settingsStore };
