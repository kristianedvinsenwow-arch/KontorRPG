/**
 * Renderer, scenes, camera and lighting. Same layering as KontorLAN: the world scene, then a
 * separate viewmodel scene (hands and tool) drawn on top with a cleared depth buffer so the tool
 * never clips into walls.
 */
import * as THREE from 'three';
import { EYE_HEIGHT } from '@kontor/shared';

export interface Gfx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  vmScene: THREE.Scene;
  vmCam: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  setLowGpu(on: boolean): void;
  resize(): void;
  /** Keep the shadow frustum and sky centred on the player. */
  follow(pos: THREE.Vector3): void;
}

const SKY = { top: 0x4f7fb8, horizon: 0xd6e2e6, bottom: 0x7d8c84 };

function paintGradient(geo: THREE.BufferGeometry, R: number) {
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const t = new THREE.Color(SKY.top), h = new THREE.Color(SKY.horizon), b = new THREE.Color(SKY.bottom), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / R;
    if (y > 0) c.copy(h).lerp(t, Math.pow(y, 0.55));
    else c.copy(h).lerp(b, Math.min(1, -y * 4));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

export function createGfx(container: HTMLElement, lowGpu: boolean): Gfx {
  const renderer = new THREE.WebGLRenderer({ antialias: !lowGpu, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.horizon, 70, 230);
  scene.background = new THREE.Color(SKY.horizon);

  const cam = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
  cam.rotation.order = 'YXZ';
  cam.position.set(0, EYE_HEIGHT + 2, 0);

  // Northern light: a low, warm sun and a cool sky fill.
  const hemi = new THREE.HemisphereLight(0xdfe9f2, 0x4a4436, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
  sun.position.set(-40, 38, 26);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  paintGradient(skyGeo, 400);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3328, 1.6));
  const vmSun = new THREE.DirectionalLight(0xffffff, 2.2);
  vmSun.position.set(1.2, 2, 1.5);
  vmScene.add(vmSun);

  const sunOffset = sun.position.clone();
  const gfx: Gfx = {
    renderer, scene, cam, vmScene, vmCam, sun,
    setLowGpu(on) {
      renderer.setPixelRatio(on ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = !on;
      sun.castShadow = !on;
      scene.traverse((o) => { if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true; });
      gfx.resize();
    },
    resize() {
      const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      cam.aspect = vmCam.aspect = w / h;
      cam.updateProjectionMatrix();
      vmCam.updateProjectionMatrix();
    },
    follow(pos) {
      // Snap the shadow camera to a 2 m grid so shadows don't shimmer as you walk.
      const sx = Math.round(pos.x / 2) * 2, sz = Math.round(pos.z / 2) * 2;
      sun.target.position.set(sx, pos.y, sz);
      sun.position.set(sx + sunOffset.x, pos.y + sunOffset.y, sz + sunOffset.z);
      sky.position.copy(pos);
    },
  };
  gfx.setLowGpu(lowGpu);
  addEventListener('resize', () => gfx.resize());
  return gfx;
}
