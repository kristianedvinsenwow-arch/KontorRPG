/**
 * The reeling minigame. A fish darts up and down a vertical track; hold the mouse button (or
 * Space) to lift your catch bar, let go to drop it. While the fish is inside the bar the catch
 * meter fills; outside it drains. Fill it to land the fish, let it empty and it gets away.
 * Harder fish move faster and more erratically; better rods and talents give a bigger bar.
 */
const box = document.createElement('div');
box.id = 'fishgame';
box.hidden = true;
box.innerHTML = `<div class="track"><div class="zone"></div><div class="fish">🐟</div></div><div class="meter"><i></i></div><div class="hint">Hold <b>click</b> to raise the bar · keep the fish inside</div>`;
document.body.append(box);
const zoneEl = box.querySelector('.zone') as HTMLElement;
const fishEl = box.querySelector('.fish') as HTMLElement;
const meterEl = box.querySelector('.meter i') as HTMLElement;

const TRACK = 280;
/** Seconds at the start where the meter can't drain and the fish holds still: time to see what's going on. */
const GRACE = 1.8;
const hintEl = box.querySelector('.hint') as HTMLElement;

let state: null | {
  difficulty: number; until: number; done: (ok: boolean) => void;
  zone: number; zoneV: number; zoneH: number;
  fish: number; fishV: number; fishTarget: number; nextMove: number;
  progress: number; t: number;
} = null;

export const fishing = {
  get active() { return !!state; },
  /** Start reeling; `ease` is the catch bar bonus (rods, talents). */
  start(difficulty: number, seconds: number, ease: number, done: (ok: boolean) => void): void {
    state = {
      difficulty, until: performance.now() + seconds * 1000, done,
      zone: 40, zoneV: 0, zoneH: Math.min(TRACK * 0.55, 78 * (1 + ease) * (1.15 - difficulty * 0.35)),
      fish: 60, fishV: 0, fishTarget: 60, nextMove: GRACE, progress: 0.4, t: 0,
    };
    box.hidden = false;
  },
  stop(): void { state = null; box.hidden = true; },
  update(dt: number, holding: boolean): void {
    const s = state;
    if (!s) return;
    s.t += dt;
    // Catch bar: lift while holding, fall otherwise, bounce softly off the ends.
    const grace = s.t < GRACE;
    // During the grace period the bar floats gently so you can find the controls.
    s.zoneV += (holding ? 620 : grace ? -150 : -520) * dt;
    s.zoneV *= 0.985;
    s.zone += s.zoneV * dt;
    if (s.zone < 0) { s.zone = 0; s.zoneV *= -0.3; }
    if (s.zone > TRACK - s.zoneH) { s.zone = TRACK - s.zoneH; s.zoneV *= -0.3; }
    // Fish: picks a new spot every so often; harder fish more often, further and faster.
    if (s.t >= s.nextMove) {
      const d = s.difficulty;
      s.fishTarget = Math.max(6, Math.min(TRACK - 30, s.fish + (Math.random() - 0.5) * TRACK * (0.4 + d)));
      s.nextMove = s.t + (1.4 - d) * (0.4 + Math.random() * 0.9);
    }
    const accel = 40 + s.difficulty * 140;
    s.fishV += Math.sign(s.fishTarget - s.fish) * accel * dt * 10;
    s.fishV *= 0.86;
    s.fish += s.fishV * dt;
    s.fish = Math.max(0, Math.min(TRACK - 24, s.fish));
    const inside = s.fish + 12 >= s.zone && s.fish + 12 <= s.zone + s.zoneH;
    // Draining ramps in after the grace period instead of starting at full strength.
    const ramp = Math.min(1, Math.max(0, (s.t - GRACE) / 1.5));
    s.progress += (inside ? 0.34 : (-0.22 - s.difficulty * 0.1) * ramp) * dt;
    box.classList.toggle('grace', grace);
    if (hintEl.dataset.g !== String(grace)) hintEl.dataset.g = String(grace), hintEl.innerHTML = grace ? '<b>Get ready…</b> hold <b>click</b> to raise the bar' : 'Hold <b>click</b> to raise the bar · keep the fish inside';
    zoneEl.style.height = `${s.zoneH}px`;
    zoneEl.style.bottom = `${s.zone}px`;
    zoneEl.classList.toggle('hit', inside);
    fishEl.style.bottom = `${s.fish}px`;
    meterEl.style.height = `${Math.max(0, Math.min(1, s.progress)) * 100}%`;
    if (s.progress >= 1) { const d = s.done; this.stop(); d(true); }
    else if (s.progress <= 0 || performance.now() > s.until) { const d = s.done; this.stop(); d(false); }
  },
};
