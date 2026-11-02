/**
 * Screen-space labels: name tags, NPC titles, mob health bars, node wear rings, floating damage
 * numbers and loot names. Plain DOM positioned over the canvas each frame. (Name tags used to be
 * sprites in the 3D scene; ambient occlusion drew a dark square behind them.)
 */
import * as THREE from 'three';

export interface Label {
  el: HTMLElement;
  /** World position getter (called every frame). */
  at: () => THREE.Vector3 | null;
  /** Hide beyond this distance (metres). */
  max: number;
  /** Scale the element with distance (rings) instead of a fixed size. */
  scale?: boolean;
  visible: boolean;
  /** Place signs keep their own range (they're few and you navigate by them). */
  sign?: boolean;
}

const layer = document.createElement('div');
layer.id = 'labels';
document.body.append(layer);

const labels = new Set<Label>();
/** Name tags, speech and health bars never show further than the longest weapon reach (staffs, 26 m): fewer
 *  DOM updates each frame, and less clutter. */
export const LABEL_RANGE = 26;
const v = new THREE.Vector3();
const camPos = new THREE.Vector3();

export function addLabel(el: HTMLElement, at: Label['at'], max = 40, scale = false): Label {
  const l: Label = { el, at, max, scale, visible: true, sign: el.classList.contains('place') };
  el.classList.add('lbl3d');
  layer.append(el);
  labels.add(l);
  return l;
}

export function removeLabel(l: Label | undefined | null): void {
  if (!l) return;
  l.el.remove();
  labels.delete(l);
}

/** A number or word that floats up from a point and fades out. */
export function floatText(text: string, cls: string, pos: THREE.Vector3): void {
  const el = document.createElement('div');
  el.className = `float ${cls}`;
  el.textContent = text;
  const p = pos.clone();
  p.x += (Math.random() - 0.5) * 0.5;
  const born = performance.now();
  const l = addLabel(el, () => { const t = (performance.now() - born) / 1000; return p.clone().setY(p.y + t * 1.1); }, 50);
  setTimeout(() => removeLabel(l), 1300);
}

export function setLabelsVisible(on: boolean): void { layer.hidden = !on; }

export function updateLabels(cam: THREE.PerspectiveCamera): void {
  const w = innerWidth, h = innerHeight;
  cam.getWorldPosition(camPos);
  for (const l of labels) {
    const p = l.at();
    let show = !!p;
    if (p) {
      const d = p.distanceTo(camPos);
      // Cheap distance test first; only project what's close enough to show.
      show = d < (l.sign ? l.max : Math.min(l.max, LABEL_RANGE));
      if (show) { v.copy(p).project(cam); show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2; }
      if (show) {
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        const s = l.scale ? Math.max(0.25, Math.min(2.5, 9 / Math.max(1, d))) : Math.max(0.6, Math.min(1, 14 / Math.max(1, d)));
        l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
      }
    }
    if (show !== l.visible) { l.el.style.display = show ? '' : 'none'; l.visible = show; }
  }
}
