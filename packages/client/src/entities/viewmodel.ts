/**
 * First-person hands and tool, drawn in KontorLAN's separate viewmodel scene so the pickaxe never
 * clips into terrain. Bobs while walking and plays a swing on click.
 */
import * as THREE from 'three';
import { mat, limb, ball, v3 } from '../engine/procgen.js';
import { makePickaxe } from './character.js';

export interface Viewmodel {
  root: THREE.Group;
  update(dt: number, speed: number, swinging: boolean): void;
}

export function makeViewmodel(vmScene: THREE.Scene): Viewmodel {
  const root = new THREE.Group();
  vmScene.add(root);
  const sleeve = mat(0x46503f, 'cloth');
  const skin = mat(0xd1a582, null, { r: 0.65 });

  // Right forearm + hand gripping the haft.
  const arm = new THREE.Group();
  root.add(arm);
  limb(arm, v3(0.12, -0.26, 0.2), v3(0.05, -0.14, -0.02), 0.05, 0.044, sleeve);
  ball(arm, v3(0.04, -0.13, -0.04), 0.045, skin, 12);
  // Haft tilted forward and away from the camera, gripped near its base, so the stone head sits in
  // the lower right of the view instead of the haft filling the screen.
  const tool = makePickaxe();
  tool.scale.setScalar(0.72);
  tool.rotation.set(-1.2, 0, 0.3);
  tool.position.set(0.06, -0.18, 0.06);
  arm.add(tool);
  arm.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  const rest = new THREE.Vector3(0.3, -0.15, -0.36);
  let ph = 0, swing = 0, active = false;

  return {
    root,
    update(dt, speed, swinging) {
      ph += dt * speed * 1.6;
      const bob = Math.min(1, speed / 5);
      if (swinging && !active) { active = true; swing = 0; }
      if (active) {
        swing += dt * 2.6;
        if (swing >= 1) { swing = 0; active = swinging; } // keep swinging while the button is held
      }
      // Wind up (0 → 0.4), strike (0.4 → 0.6), recover (0.6 → 1).
      const s = active ? swing : 0;
      const wind = s < 0.4 ? s / 0.4 : s < 0.6 ? 1 - (s - 0.4) / 0.2 * 1.6 : -0.6 + (s - 0.6) / 0.4 * 0.6;
      arm.position.set(
        rest.x + Math.sin(ph) * 0.012 * bob,
        rest.y + Math.abs(Math.cos(ph)) * 0.012 * bob + wind * 0.06,
        rest.z,
      );
      arm.rotation.set(wind * 0.9, 0, -wind * 0.15);
    },
  };
}
