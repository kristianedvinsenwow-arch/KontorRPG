/**
 * Rain and snow around the camera: a box of falling streaks (rain) or drifting flakes (snow) that
 * follows you and wraps around, so it looks endless. How much is drawn follows the weather.
 */
import * as THREE from 'three';

const N = 900, BOX = 30, HIGH = 16;

export class Precip {
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rp: Float32Array;
  private sp: Float32Array;
  private drift: Float32Array;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.rp = new Float32Array(N * 6);
    this.sp = new Float32Array(N * 3);
    this.drift = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * BOX, y = Math.random() * HIGH, z = (Math.random() - 0.5) * BOX;
      this.rp.set([x, y, z, x + 0.03, y - 0.55, z + 0.03], i * 6);
      this.sp.set([x, y, z], i * 3);
      this.drift[i] = Math.random() * 6.28;
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbd0, transparent: true, opacity: 0.45, depthWrite: false }));
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3));
    // Round, soft flakes (a plain square point looks like confetti up close).
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.02 }));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
  }

  /** `rain`/`snow` 0..1; `sheltered` hides both (indoors, underground). */
  update(dt: number, at: THREE.Vector3, rain: number, snow: number, sheltered: boolean): void {
    this.t += dt;
    const nr = sheltered ? 0 : Math.floor(N * rain), ns = sheltered ? 0 : Math.floor(N * 0.7 * snow);
    this.rain.visible = nr > 0; this.snow.visible = ns > 0;
    const wrap = (v: number, c: number) => { const h = BOX / 2; let d = v - c; d = ((d + h) % BOX + BOX) % BOX - h; return c + d; };
    if (nr > 0) {
      const p = this.rp;
      for (let i = 0; i < nr; i++) {
        const o = i * 6;
        let y = p[o + 1] - dt * 22;
        if (y < at.y - 4) y += HIGH;
        const x = wrap(p[o], at.x), z = wrap(p[o + 2], at.z);
        p[o] = x; p[o + 1] = y; p[o + 2] = z;
        p[o + 3] = x + 0.03; p[o + 4] = y - 0.55; p[o + 5] = z + 0.03;
      }
      this.rain.geometry.setDrawRange(0, nr * 2);
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (ns > 0) {
      const p = this.sp;
      for (let i = 0; i < ns; i++) {
        const o = i * 3;
        let y = p[o + 1] - dt * 1.6;
        if (y < at.y - 4) y += HIGH;
        p[o] = wrap(p[o] + Math.sin(this.t * 0.8 + this.drift[i]) * dt * 0.6, at.x);
        p[o + 1] = y;
        p[o + 2] = wrap(p[o + 2] + Math.cos(this.t * 0.6 + this.drift[i]) * dt * 0.5, at.z);
      }
      this.snow.geometry.setDrawRange(0, ns);
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}
