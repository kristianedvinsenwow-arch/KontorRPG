/**
 * Third-person character previews. You play in first person, so this is where you see yourself:
 * in the creator (live, as you change race and colour) and in the in-game character panel (C).
 * Drawn by the main renderer into a transparent window in the page (scissored viewport — no second
 * WebGL context, no texture readback).
 */
import * as THREE from 'three';
import { PERKS, RACES, type CharacterBuild, type PlayerState, type Race } from '@kontor/shared';
import { makeCharacter, animateCharacter, setShoulders, type Character, type GEAR_COLORS } from '../entities/character.js';
import { applyGear } from '../entities/held.js';
import { derivedTiles } from './creator.js';

export class CharacterPreview {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private model: Character | null = null;
  private key = '';
  private yaw = 0;
  /** When the player last let go after dragging; the model turns back to face you a moment later. */
  private releasedAt = 0;
  private dragging = false;
  private readonly el: HTMLElement;

  constructor(elId: string, private readonly isVisible: () => boolean) {
    this.el = document.getElementById(elId)!;
    this.scene.add(new THREE.HemisphereLight(0xf2ece0, 0x3a332a, 1.8));
    const key = new THREE.DirectionalLight(0xffe7c4, 2.4);
    key.position.set(2, 3, -2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4);
    rim.position.set(-2, 2, 2);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f2c, roughness: 0.9 }));
    this.scene.add(floor);
    // A human-height marker post makes the gnome's size readable.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.8 }));
    post.position.set(0.75, 0, 0.35);
    this.scene.add(post);

    this.el.addEventListener('pointerdown', (e) => { this.dragging = true; this.el.setPointerCapture(e.pointerId); });
    this.el.addEventListener('pointerup', () => { this.dragging = false; this.releasedAt = performance.now(); });
    this.el.addEventListener('pointercancel', () => { this.dragging = false; this.releasedAt = performance.now(); });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this.yaw += e.movementX * 0.012; });
  }

  /** Rebuilds the model only when colour or race changed. */
  setCharacter(color: number, race: Race, face = 0): void {
    const k = `${color}|${race}|${face}`;
    if (k === this.key) return;
    const faceChanged = this.key && this.key.split('|')[2] !== String(face);
    this.key = k;
    if (faceChanged) this.zoomUntil = performance.now() + 2600; // show the new face up close
    if (this.model) this.scene.remove(this.model.g);
    this.model = makeCharacter(color, undefined, race, face);
    if (this.gear) applyGear(this.model, this.gear);
    this.scene.add(this.model.g);
  }

  private gear: PlayerState['gear'] | null = null;
  /** Until when the camera zooms in on the face (after picking one). */
  private zoomUntil = 0;
  private zoom = 0;
  /** Debug/preview: play the tool swing. */
  swinging = false;
  /** Debug/preview: walk in place at this speed (m/s). */
  speed = 0;
  /** Dress the preview in your worn gear. */
  setGear(gear: PlayerState['gear']): void {
    this.gear = gear;
    if (this.model) applyGear(this.model, gear);
  }

  /** Use the world's sky environment so metal gear reflects the same light as in the game. */
  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.7;
  }

  /** Show shoulder gear on the preview model (e.g. to preview a tier). */
  setShoulders(tier: keyof typeof GEAR_COLORS | null): void {
    if (this.model) setShoulders(this.model, tier);
  }

  render(renderer: THREE.WebGLRenderer, dt: number): void {
    if (!this.isVisible() || !this.model) return;
    const r = this.el.getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const zoomed = performance.now() < this.zoomUntil;
    this.zoom += ((zoomed ? 1 : 0) - this.zoom) * Math.min(1, dt * 5);
    // Face the viewer. Dragging turns the model; let go and it eases back after a moment.
    if (!this.dragging && (zoomed || performance.now() - this.releasedAt > 1500)) {
      const home = Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2;
      this.yaw += (home - this.yaw) * Math.min(1, dt * 4);
    }
    this.model.g.rotation.y = this.yaw;
    animateCharacter(this.model, this.speed, 0, this.swinging, dt);
    this.cam.aspect = r.width / r.height;
    // Face height for this race (eye level), so the zoom lands on the face for gnomes too.
    const eyeY = RACES[this.model.race].eye;
    const z = this.zoom;
    this.cam.position.set(0, 1.2 + (eyeY + 0.06 - 1.2) * z, -4.6 + 3.55 * z);
    this.cam.lookAt(0, 0.92 + (eyeY + 0.03 - 0.92) * z, 0);
    this.cam.updateProjectionMatrix();
    const x = r.left - canvas.left, y = canvas.bottom - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setClearColor(0x151a1b, 1);
    renderer.clear(true, true);
    renderer.render(this.scene, this.cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
  }
}

/** Fill the in-game character panel's text from the build. */
export function fillCharacterPanel(name: string, build: CharacterBuild): void {
  document.getElementById('charName')!.textContent = name;
  document.getElementById('charRace')!.textContent = `${RACES[build.race].name} · STR ${build.attrs.str} · DEX ${build.attrs.dex} · INT ${build.attrs.int} · STA ${build.attrs.sta}`;
  document.getElementById('charStats')!.replaceChildren(...derivedTiles(build));
  const perks = document.getElementById('charPerks')!;
  perks.replaceChildren(...[build.major, build.minor].map((id) => {
    const p = PERKS[id];
    const d = document.createElement('div');
    const kind = document.createElement('em'); kind.textContent = p.kind;
    const nm = document.createElement('b'); nm.textContent = p.name;
    const up = document.createElement('span'); up.className = 'up'; up.textContent = `+ ${p.plus}  `;
    const dn = document.createElement('span'); dn.className = 'down'; dn.textContent = `− ${p.minus}`;
    d.append(kind, nm, up, dn);
    return d;
  }));
}
