/**
 * Water: a physically-based surface that reflects the sky environment map, with a procedurally
 * generated, tileable normal map scrolled in two directions for small moving ripples.
 */
import * as THREE from 'three';
import { WATER_LEVEL, WORLD_HALF } from '@kontor/shared';

function rippleNormalMap(size = 256): THREE.CanvasTexture {
  // Height field from a few tileable sine waves → normals via finite differences.
  const h = new Float32Array(size * size);
  const waves = [[3, 1, 0.5], [1, 4, 0.35], [5, -2, 0.25], [-4, 3, 0.2], [7, 5, 0.12], [-9, 2, 0.08]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, a] of waves) v += Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + kx) * a;
    h[y * size + x] = v;
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = at(x + 1, y) - at(x - 1, y), dy = at(x, y + 1) - at(x, y - 1);
    const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
    const i = (y * size + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255;
    img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly normal: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    const size = WORLD_HALF * 2 + 600;
    this.normal = rippleNormalMap();
    this.normal.repeat.set(size / 9, size / 9);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1f4a57,
      roughness: 0.06,
      metalness: 0,
      ior: 1.33,
      reflectivity: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      normalMap: this.normal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.3,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  animate(t: number): void {
    this.normal.offset.set(t * 0.012, t * 0.007);
  }
}
