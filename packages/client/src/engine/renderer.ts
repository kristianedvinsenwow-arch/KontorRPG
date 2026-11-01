/**
 * Renderer, scenes, lighting and post-processing.
 *
 * Most of "looks nice" comes from here rather than the models:
 *  - a physical sky (Rayleigh/Mie scattering) that is also baked into an HDR environment map,
 *    so every PBR material gets matching ambient light and reflections
 *  - ACES filmic tone mapping in linear space, sRGB output
 *  - soft shadow maps that follow the player
 *  - post: ambient occlusion (GTAO), gentle bloom, colour grading + vignette, then tone mapping
 *
 * Three quality levels so office laptops stay smooth: low (no shadows, no post), medium (shadows,
 * bloom, grading), high (adds ambient occlusion and higher-res shadows).
 *
 * Same layering as KontorLAN: the first-person hands/tool are drawn in their own scene on top.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { NO_AO } from '../world/props.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EYE_HEIGHT } from '@kontor/shared';

export type Quality = 'low' | 'medium' | 'high';

export interface Gfx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  vmScene: THREE.Scene;
  vmCam: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  quality: Quality;
  setQuality(q: Quality): void;
  resize(): void;
  /** Keep the shadow frustum and sky centred on the player. */
  follow(pos: THREE.Vector3): void;
  /** Draw the world (through post-processing when enabled). */
  renderWorld(): void;
  /** Cave lighting: no sky, dark fog, dim fill light. */
  setUnderground(on: boolean): void;
  /** Outdoor mood per region: Gruben is greyer, colder and mistier. */
  setRegion(r: 'valley' | 'cave' | 'gruben' | 'fjord'): void;
  /** Time of day and weather (outdoors). */
  setAtmosphere(sunDir: { x: number; y: number; z: number }, day: number, w: { cloud: number; fog: number; rain: number; snow: number }): void;
}

/** Low northern sun from the south-west: long shadows, warm light. */
const SUN_DIR = new THREE.Vector3(-0.62, 0.42, 0.66).normalize();
const FOG = 0xbcccd3;

/** Colour grading in display space: lift/gamma/gain, saturation, a touch of warmth, vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    warmth: { value: 0.025 },
    lift: { value: 0.012 },
    gain: { value: 1.03 },
    vignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, warmth, lift, gain, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * gain + lift * (1.0 - c.rgb);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col += vec3(warmth, warmth * 0.35, -warmth);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

function makeSky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.25;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.84;
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(4000);
  return sky;
}

export function createGfx(container: HTMLElement, quality: Quality): Gfx {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 80, 260);

  const cam = new THREE.PerspectiveCamera(72, 1, 0.05, 6000);
  cam.rotation.order = 'YXZ';
  cam.position.set(0, EYE_HEIGHT + 2, 0);

  // Sky drawn as the background, and baked once into a prefiltered HDR environment map.
  const sky = makeSky();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const env = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.75;

  // Direct light: warm sun; a weak sky/ground fill on top of the environment map.
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0ee, 0x4a4632, 0.45);
  scene.add(hemi);

  // Viewmodel scene shares the same environment so the tool's reflections match the world.
  const vmScene = new THREE.Scene();
  vmScene.environment = env;
  vmScene.environmentIntensity = 0.45;
  const vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  const vmSun = new THREE.DirectionalLight(0xfff0d8, 1.5);
  vmSun.position.set(-0.6, 1.4, 0.6);
  vmScene.add(vmSun, new THREE.HemisphereLight(0xcfe0ee, 0x4a4632, 0.5));

  // Post-processing chain. Half-float target keeps HDR values for bloom; 4× MSAA replaces the
  // canvas antialiasing we turned off above.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, cam);
  const gtao = new GTAOPass(scene, cam, 1, 1);
  gtao.blendIntensity = 0.85;
  // Hide alpha-cut grass cards while the AO pass draws its depth/normals (it ignores alphaTest).
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (...args: Parameters<typeof gtaoRender>) => {
    const hidden: THREE.Object3D[] = [];
    for (const o of NO_AO) { if (!o.parent) { NO_AO.delete(o); continue; } if (o.visible) { o.visible = false; hidden.push(o); } }
    try { gtaoRender(...args); } finally { for (const o of hidden) o.visible = true; }
  };
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.55, 0.92);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  const sunOffset = sun.position.clone();
  // A dome of stars for clear nights.
  const stars = (() => {
    const n = 1400, pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 0.95), r = 3800;
      pos.set([Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r, Math.sin(v) * Math.sin(u) * r], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    pts.visible = false;
    scene.add(pts);
    return pts;
  })();
  const gfx: Gfx = {
    renderer, scene, cam, vmScene, vmCam, sun, quality,
    setUnderground(on) {
      if ((gfx as any)._under === on) return;
      (gfx as any)._under = on;
      sky.visible = !on;
      if (on) stars.visible = false;
      scene.background = on ? new THREE.Color(0x050506) : null;
      const fog = scene.fog as THREE.Fog;
      if (on) { fog.color.setHex(0x07080a); fog.near = 6; fog.far = 34; }
      else { fog.color.setHex(FOG); fog.near = 80; fog.far = 260; }
      scene.environmentIntensity = on ? 0.12 : 0.75;
      sun.intensity = on ? 0.15 : 3.0;
      hemi.intensity = on ? 0.35 : 0.45;
      hemi.color.setHex(on ? 0x6a7a90 : 0xcfe0ee);
    },
    setRegion(r) { (gfx as any)._region = r; },
    /**
     * Light for the time of day and weather, outdoors (the cave keeps its own). Called every
     * frame; cheap. Sun below the horizon → cool moonlight from the other side of the sky.
     */
    setAtmosphere(sunDir, day, w) {
      if ((gfx as any)._under) return;
      const grim = (gfx as any)._region === 'gruben', sea = (gfx as any)._region === 'fjord';
      const clear = 1 - w.cloud * 0.75;
      // Sky dome follows the real sun.
      sky.material.uniforms.sunPosition.value.set(sunDir.x, sunDir.y, sunDir.z).multiplyScalar(4000);
      sky.material.uniforms.rayleigh.value = 1.25 + w.cloud * 1.5;
      sky.material.uniforms.turbidity.value = 3.2 + w.cloud * 8;
      // Direct light: the sun by day, the moon (opposite side, never below 25°) by night.
      const night = 1 - day;
      const lightDir = day > 0.02 ? new THREE.Vector3(sunDir.x, Math.max(0.08, sunDir.y), sunDir.z).normalize()
        : new THREE.Vector3(-sunDir.x, Math.max(0.42, -sunDir.y), -sunDir.z).normalize();
      sunOffset.copy(lightDir).multiplyScalar(80);
      sun.intensity = (grim ? 2.1 : 3.0) * day * clear + 0.35 * night;
      const warm = Math.min(1, Math.max(0, 1 - sunDir.y * 4)); // low sun → orange
      sun.color.setRGB(1, 0.94 - warm * 0.25 * day, 0.85 - warm * 0.45 * day).lerp(new THREE.Color(0x9fb4e0), night);
      hemi.intensity = 0.2 + 0.28 * day;
      hemi.color.setHex(day > 0.5 ? 0xcfe0ee : 0x5a6a90);
      scene.environmentIntensity = 0.1 + 0.65 * day * (1 - w.cloud * 0.3);
      // Fog: colour from the sky at this hour, pulled in by fog and rain.
      const fog = scene.fog as THREE.Fog;
      const dayFog = new THREE.Color(grim ? 0x9aa3a8 : sea ? 0xa8bcc8 : FOG).lerp(new THREE.Color(0x9aa0a4), w.cloud * 0.6);
      fog.color.copy(new THREE.Color(0x0e1420).lerp(dayFog, Math.max(0.08, day)));
      const near = (grim ? 40 : sea ? 60 : 80) * (1 - w.fog * 0.85), far = (grim ? 170 : sea ? 220 : 260) * (1 - w.fog * 0.7) * (1 - w.rain * 0.25);
      fog.near = near; fog.far = far;
      // Starry night sky shows through when it's dark and clear.
      if (stars) { stars.visible = night > 0.3 && w.cloud < 0.7; (stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.3) * (1 - w.cloud) * 1.2; }
      renderer.toneMappingExposure = 0.95 + night * 0.08;
      grade.uniforms.saturation.value = (grim ? 0.82 : 1.08) * (1 - night * 0.35) * (1 - w.cloud * 0.2);
      grade.uniforms.warmth.value = grim ? -0.01 : 0.025 * day - 0.015 * night;
    },
    setQuality(q) {
      gfx.quality = q;
      renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1.5));
      renderer.shadowMap.enabled = q !== 'low';
      sun.castShadow = q !== 'low';
      const size = q === 'high' ? 4096 : 2048;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
      gtao.enabled = q === 'high';
      scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
      gfx.resize();
    },
    resize() {
      const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
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
      stars.position.copy(pos);
    },
    renderWorld() {
      if (gfx.quality === 'low') {
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, cam);
      } else {
        composer.render();
      }
    },
  };
  gfx.setQuality(quality);
  addEventListener('resize', () => gfx.resize());
  return gfx;
}
