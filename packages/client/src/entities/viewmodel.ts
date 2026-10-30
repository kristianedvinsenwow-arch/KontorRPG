/**
 * First-person hand and tool, drawn in KontorLAN's separate viewmodel scene so the pickaxe never
 * clips into terrain.
 *
 * Built around a grip frame: the haft runs along the frame's Y axis and the fingers, thumb and palm
 * wrap around it, so the hand actually holds the tool. The whole arm hangs from an elbow pivot
 * below the screen, which is what the swing rotates — that gives a natural arc instead of the tool
 * spinning in place. On top: walk bob, a slow idle breath, and a little lag when you turn.
 */
import * as THREE from 'three';
import { mat, mesh, limb, ball, v3 } from '../engine/procgen.js';
import { makeHeld } from './held.js';

/** Length of one swing animation; the strike lands at STRIKE_AT of it. */
export const SWING_SEC = 0.62;
export const STRIKE_AT = 0.5;

export interface Viewmodel {
  root: THREE.Group;
  /** Play one swing (the caller paces them to the tool's swing time). */
  swing(): void;
  /** Show this item in hand (tool or weapon id), or nothing. */
  setHeld(id: string | undefined): void;
  update(dt: number, speed: number, lookDx: number, lookDy: number): void;
}

const HAFT_R = 0.022; // pickaxe haft radius before scaling

/** A hand closed around a cylinder of radius r lying along local Y. The palm sits on the −X side; fingers curl round the rest. */
function makeGrip(r: number, skin: THREE.Material, knuckle: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const fingerR = r + 0.012; // fingers sit just outside the haft surface
  const arc = Math.PI * 1.45; // fingers wrap most of the way round; the gap is where the palm is
  // Four fingers stacked along the haft, index on top, slightly shorter towards the little finger.
  for (let i = 0; i < 4; i++) {
    const tube = 0.0115 - i * 0.0008;
    const geo = new THREE.TorusGeometry(fingerR, tube, 8, 14, arc - i * 0.1);
    const f = mesh(geo, skin, g, false);
    f.rotation.x = Math.PI / 2; // torus axis → haft axis (Y)
    f.rotation.z = -(arc - i * 0.1) / 2; // centre the open gap on −X, where the palm presses on the haft
    f.position.y = 0.03 - i * 0.022;
  }
  void knuckle;
  // Palm: a rounded block on the +X side, behind the curled fingers.
  const palm = ball(g, v3(-(fingerR + 0.01), -0.004, 0.004), 0.034, skin, 14);
  palm.scale.set(0.55, 1.45, 1.05);
  palm.castShadow = palm.receiveShadow = false;
  const heel = ball(g, v3(-(fingerR + 0.004), -0.048, 0.01), 0.026, skin, 10);
  heel.scale.set(0.8, 0.7, 1);
  // Thumb: wraps over the top of the index finger from the palm side.
  const thumb = new THREE.Group();
  thumb.position.set(-fingerR * 0.6, 0.05, -fingerR * 0.9);
  g.add(thumb);
  limb(thumb, v3(0.012, -0.012, 0.02), v3(-0.006, 0.004, -0.004), 0.0125, 0.011, skin, 8);
  ball(thumb, v3(-0.008, 0.005, -0.006), 0.0115, skin, 8);
  return g;
}

export function makeViewmodel(vmScene: THREE.Scene): Viewmodel {
  const root = new THREE.Group();
  vmScene.add(root);
  const sleeve = mat(0x46503f, 'cloth');
  const cuff = mat(0x3a2818, 'leather', { r: 0.7 });
  const skin = mat(0xb98364, null, { r: 0.72 });
  const knuckle = mat(0xa87358, null, { r: 0.72 });

  // Elbow pivot sits below and to the right of the screen; everything else hangs from it.
  const elbow = new THREE.Group();
  root.add(elbow);

  // The grip frame: haft along local Y, tilted up and slightly in, so the head sits upper right.
  const grip = new THREE.Group();
  elbow.add(grip);
  grip.position.set(-0.1, 0.19, -0.22);
  const up = new THREE.Vector3(-0.2, 0.9, -0.36).normalize();
  const fwd = new THREE.Vector3(0, 0, -1);
  const side = new THREE.Vector3().crossVectors(up, fwd).normalize(); // haft frame X: to the right of the haft
  const back = new THREE.Vector3().crossVectors(side, up).normalize();
  grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, back));

  const s = 0.62;
  let tool: THREE.Group | null = null;
  let heldId: string | undefined;

  const hand = makeGrip(HAFT_R * s, skin, knuckle);
  grip.add(hand);

  // Forearm: from the wrist (just below the palm) back down to the elbow.
  const wrist = new THREE.Vector3(-0.03, -0.075, 0.03).applyQuaternion(grip.quaternion).add(grip.position);
  limb(elbow, v3(0.02, -0.02, 0.06), wrist, 0.05, 0.036, skin, 10);
  limb(elbow, v3(0.02, -0.04, 0.09), wrist.clone().lerp(v3(0.02, -0.04, 0.09), 0.38), 0.062, 0.056, sleeve, 12);
  const cuffRing = mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 18), cuff, elbow, false);
  const cuffAt = wrist.clone().lerp(v3(0.02, -0.04, 0.09), 0.38);
  cuffRing.position.copy(cuffAt);
  cuffRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wrist.clone().sub(cuffAt).normalize());

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  const rest = new THREE.Vector3(0.37, -0.39, -0.24);
  const sway = new THREE.Vector2();
  let ph = 0, breath = 0, swing = 0, active = false;
  root.visible = false;

  return {
    root,
    swing() { if (!active) { active = true; swing = 0; } },
    setHeld(id) {
      if (id === heldId) return;
      heldId = id;
      if (tool) grip.remove(tool);
      tool = makeHeld(id);
      root.visible = !!tool;
      if (!tool) return;
      tool.scale.setScalar(s);
      tool.position.y = id?.includes('sword') ? -0.03 : -0.09; // grip near the end of the haft
      // Turn the head into the swing plane: the pick points forward, away from you, so it strikes with
      // the point instead of slapping with the flat. A slight twist keeps it readable on screen.
      tool.rotation.y = -Math.PI / 2 + 0.28;
      tool.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      grip.add(tool);
    },
    update(dt, speed, lookDx, lookDy) {
      ph += dt * speed * 1.6;
      breath += dt;
      const bob = Math.min(1, speed / 5);

      // Turning drags the tool slightly behind the view, then it settles.
      sway.x += (-lookDx * 0.0009 - sway.x) * Math.min(1, dt * 6);
      sway.y += (lookDy * 0.0009 - sway.y) * Math.min(1, dt * 6);
      sway.clampScalar(-0.05, 0.05);

      if (active) {
        swing += dt / SWING_SEC;
        if (swing >= 1) { swing = 0; active = false; }
      }
      // Swing curve around the elbow: wind up over the shoulder, fast strike, slow recovery.
      let lift = 0;
      if (active) {
        const t = swing;
        if (t < 0.42) lift = THREE.MathUtils.smoothstep(t, 0, 0.42) * 0.95;
        else if (t < 0.56) lift = 0.95 - ((t - 0.42) / 0.14) * 1.55;
        else lift = -0.6 + THREE.MathUtils.smoothstep(t, 0.56, 1) * 0.6;
      }

      elbow.position.set(
        rest.x + Math.sin(ph) * 0.012 * bob + sway.x,
        rest.y + Math.abs(Math.cos(ph)) * 0.014 * bob + Math.sin(breath * 1.6) * 0.004 + sway.y,
        rest.z,
      );
      elbow.rotation.set(lift + Math.sin(breath * 1.6) * 0.008, -lift * 0.12, -lift * 0.1 + sway.x * 1.5);
    },
  };
}
