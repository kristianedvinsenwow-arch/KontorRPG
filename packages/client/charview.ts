import * as THREE from 'three';
import { Terrain } from './src/world/terrain.js';
import { Places } from './src/world/places.js';
const q = new URLSearchParams(location.search);
const cx = +(q.get('x') ?? -78), cz = +(q.get('z') ?? 102);
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color(q.get('night') ? 0x0a1020 : 0x88aacc);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, q.get('night') ? 0.25 : 1.6)); const d = new THREE.DirectionalLight(0xffffff, q.get('night') ? 0.2 : 2); d.position.set(30, 60, -40); scene.add(d);
const t = new Terrain(scene); for (let i = 0; i < 60; i++) t.update(cx, cz, 99); t.followWater(cx, cz); const P = new Places(scene);
if (q.get('night')) P.setNight(1);
if (q.get('in')) { /* light the hall */ const l = new THREE.PointLight(0xffd0a0, 40, 30, 1.2); l.position.set(cx, 8, cz); scene.add(l); }
const c = new THREE.PerspectiveCamera(+(q.get('fov') ?? 55), 1.1, 0.1, 800); c.position.set(+q.get('px')!, +q.get('py')!, +q.get('pz')!); c.lookAt(cx, +(q.get('ly') ?? 6), cz);
r.render(scene, c);
(window as any).done = true;
