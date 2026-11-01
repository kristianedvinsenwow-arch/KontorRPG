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
/** A short moment at the start where progress can't drain, so a slow first reaction isn't an instant loss. */
const GRACE = 0.5;
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
    // The bar starts at the bottom and the fish somewhere well above it: you have to go and get it.
    const fish = TRACK * (0.45 + Math.random() * 0.4);
    state = {
      difficulty, until: performance.now() + seconds * 1000, done,
      zone: 0, zoneV: 0, zoneH: Math.min(TRACK * 0.45, Math.max(22, 50 * (1 + ease) * (1.6 - difficulty * 0.9))),
      fish, fishV: 0, fishTarget: fish, nextMove: 0.3, progress: 0.3, t: 0,
    };
    box.hidden = false;
  },
  stop(): void { state = null; box.hidden = true; },
  update(dt: number, holding: boolean): void {
    const s = state;
    if (!s) return;
    s.t += dt;
    const d = s.difficulty;
    // Catch bar: lift while holding, heavy fall otherwise, a small bounce off the bottom.
    s.zoneV += (holding ? 900 : -760) * dt;
    s.zoneV *= 0.98;
    s.zone += s.zoneV * dt;
    if (s.zone < 0) { s.zone = 0; s.zoneV *= -0.25; }
    if (s.zone > TRACK - s.zoneH) { s.zone = TRACK - s.zoneH; s.zoneV *= -0.25; }
    // Fish: darts to a new spot now and then (harder catches: more often, further, faster).
    // Difficulty runs from ~0.05 (an old boot) and 0.15 (perch, gentle) to 0.85 (rare: hard work)
    // and 1.2 (a horse: nearly impossible).
    if (s.t >= s.nextMove) {
      const dart = Math.random() < 0.05 + d * 0.4;
      const jump = (Math.random() - 0.5) * TRACK * (dart ? 0.4 + d * 0.6 : 0.1 + d * 0.5);
      s.fishTarget = Math.max(4, Math.min(TRACK - 28, s.fish + jump));
      s.nextMove = s.t + Math.max(0.25, 1.4 - d * 0.9) * (0.35 + Math.random() * 0.9);
    }
    const accel = 30 + d * 330;
    s.fishV += Math.sign(s.fishTarget - s.fish) * accel * dt * 10;
    s.fishV += Math.sin(s.t * (4 + d * 7)) * (10 + d * 65) * dt * 10;
    s.fishV *= 0.86;
    s.fish += s.fishV * dt;
    s.fish = Math.max(0, Math.min(TRACK - 24, s.fish));
    const inside = s.fish + 12 >= s.zone && s.fish + 12 <= s.zone + s.zoneH;
    const grace = s.t < GRACE;
    s.progress += (inside ? 0.32 - d * 0.12 : grace ? 0 : -(0.08 + d * 0.3)) * dt;
    if (hintEl.dataset.g !== '1') hintEl.dataset.g = '1', hintEl.innerHTML = 'Hold <b>click</b> to raise the bar · keep the fish inside';
    zoneEl.style.height = `${s.zoneH}px`;
    zoneEl.style.bottom = `${s.zone}px`;
    zoneEl.classList.toggle('hit', inside);
    fishEl.style.bottom = `${s.fish}px`;
    meterEl.style.height = `${Math.max(0, Math.min(1, s.progress)) * 100}%`;
    if (s.progress >= 1) { const d = s.done; this.stop(); d(true); }
    else if (s.progress <= 0 || performance.now() > s.until) { const d = s.done; this.stop(); d(false); }
  },
};
