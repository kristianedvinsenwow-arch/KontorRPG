/**
 * Character panel. You play in first person, so this is where you see yourself: a third-person
 * render of your own character drawn into the panel's transparent window by the main renderer
 * (scissored viewport — no second WebGL context, no texture readback).
 */
import * as THREE from 'three';
import { makeCharacter, animateCharacter, type Character } from '../entities/character.js';
import { uiStore } from '../state/store.js';

export class CharacterPreview {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  private model: Character | null = null;
  private yaw = 0.5;
  private dragging = false;
  private readonly el: HTMLElement;

  constructor() {
    this.el = document.getElementById('preview')!;
    this.scene.add(new THREE.HemisphereLight(0xf2ece0, 0x3a332a, 1.8));
    const key = new THREE.DirectionalLight(0xffe7c4, 2.4);
    key.position.set(2, 3, -2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4);
    rim.position.set(-2, 2, 2);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f2c, roughness: 0.9 }));
    this.scene.add(floor);
    this.cam.position.set(0, 1.15, -4.2);
    this.cam.lookAt(0, 0.95, 0);

    this.el.addEventListener('pointerdown', (e) => { this.dragging = true; this.el.setPointerCapture(e.pointerId); });
    this.el.addEventListener('pointerup', () => (this.dragging = false));
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this.yaw += e.movementX * 0.012; });
  }

  setCharacter(color: number, name: string): void {
    if (this.model) this.scene.remove(this.model.g);
    this.model = makeCharacter(color);
    this.scene.add(this.model.g);
    document.getElementById('charName')!.textContent = name;
  }

  /** Draw into the preview window's rectangle on the main canvas. Call after the world render. */
  render(renderer: THREE.WebGLRenderer, dt: number): void {
    if (uiStore.get().panel !== 'character' || !this.model) return;
    const r = this.el.getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (!this.dragging) this.yaw += dt * 0.35;
    this.model.g.rotation.y = this.yaw;
    animateCharacter(this.model, 0, 0, false, dt);
    this.cam.aspect = r.width / r.height;
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
