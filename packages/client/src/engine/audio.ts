/**
 * All game sound, synthesised with WebAudio — no audio files to ship or load. Three buses
 * (master → effects, ambience) with volumes from settings. Sounds in the world are panned and
 * fade with distance from the listener (the camera).
 *
 * Monsters get voices: goblins chatter in squeaky gibberish, cackle when they spot you, go "oof!"
 * when hit and "bleeeh" when they drop; trolls grumble, draugs moan, wolves growl and howl.
 */

type V3 = { x: number; y: number; z: number };
type Wave = OscillatorType;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Vowel formants (Hz) for the goofy voices. */
const VOWELS: [number, number][] = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];

export type MobVoice = 'aggro' | 'attack' | 'hurt' | 'death' | 'idle';

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private vols = { master: 0.8, sfx: 0.9, amb: 0.6 };
  // Ambience loops.
  private loops: Record<string, { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }> = {};
  private nextBird = 0;
  private nextCricket = 0;
  private nextDrip = 0;
  private nextCrackle = 0;

  /** Browsers only allow audio after a click or key press; call this from one. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    for (const k of ['wind', 'rain', 'water', 'cave']) this.loop(k);
  }

  setVolumes(v: { master: number; sfx: number; amb: number }): void { this.vols = v; this.applyVolumes(); }
  private applyVolumes(): void {
    if (!this.ctx) return;
    // Overall level: 60% of the original mix (it was too loud at the office).
    this.master.gain.value = this.vols.master * 0.6;
    this.sfx.gain.value = this.vols.sfx;
    this.amb.gain.value = this.vols.amb;
  }

  setListener(x: number, y: number, z: number, yaw: number): void { Object.assign(this.listener, { x, y, z, yaw }); }

  // ---------------------------------------------------------------- building blocks

  /** Where a sound goes: straight to the bus, or panned and attenuated by distance. Null = too far. */
  private out(pos?: V3, range = 40, bus: 'sfx' | 'amb' = 'sfx'): AudioNode | null {
    const ctx = this.ctx!;
    const dest = bus === 'sfx' ? this.sfx : this.amb;
    if (!pos) return dest;
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, dy = pos.y - this.listener.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return null;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, 1.6 / (1 + d * 0.22)) * (1 - d / range);
    const p = ctx.createStereoPanner();
    // Right of the listener = positive pan (yaw 0 looks down −Z; right is +X).
    const rx = Math.cos(this.listener.yaw) * dx - Math.sin(this.listener.yaw) * dz;
    p.pan.value = Math.max(-0.85, Math.min(0.85, rx / Math.max(3, d)));
    g.connect(p).connect(dest);
    return g;
  }

  private tone(o: { f: number; f2?: number; dur: number; type?: Wave; vol?: number; at?: number; attack?: number; dest: AudioNode; vib?: [number, number]; filter?: [BiquadFilterType, number, number?] }): void {
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.05); }
    const a = o.attack ?? 0.01, v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = osc;
    if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter[0]; f.frequency.value = o.filter[1]; if (o.filter[2]) f.Q.value = o.filter[2]; node.connect(f); node = f; }
    node.connect(g).connect(o.dest);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  private noise(o: { dur: number; vol?: number; at?: number; attack?: number; dest: AudioNode; type?: BiquadFilterType; f?: number; f2?: number; q?: number }): void {
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.type ?? 'lowpass'; f.frequency.setValueAtTime(o.f ?? 2000, t); f.Q.value = o.q ?? 1;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ctx.createGain(), a = o.attack ?? 0.005, v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(o.dest);
    src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.05);
  }

  /** One sung syllable through two vowel formants: the basis of every silly voice. */
  private syllable(dest: AudioNode, at: number, f0: number, f1: number, dur: number, vol: number, type: Wave = 'sawtooth', vib = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + at;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 7 + Math.random() * 5; lg.gain.value = vib; l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
    const [F1, F2] = pick(VOWELS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [F, gain] of [[F1, 1], [F2, 0.6]] as const) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = F * (f0 > 400 ? 1.35 : 1); bp.Q.value = 6;
      const fg = ctx.createGain(); fg.gain.value = gain;
      osc.connect(bp).connect(fg).connect(g);
    }
    g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- named sounds

  private last = new Map<string, number>();
  private static readonly GAP: Record<string, number> = { heal: 2500, uiError: 300, pickup: 60, coins: 120, hit: 35, door: 200, uiRare: 400 };

  play(name: string, pos?: V3): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const gap = Audio.GAP[name];
    if (gap) { const now = performance.now(); if (now - (this.last.get(name) ?? 0) < gap) return; this.last.set(name, now); }
    const range = name.startsWith('ui') ? 0 : name === 'treeFall' || name === 'slam' || name === 'ignite' ? 70 : 40;
    const d = range ? this.out(pos, range) : this.sfx;
    if (!d) return;
    switch (name) {
      // movement
      case 'stepGrass': this.noise({ dest: d, dur: 0.12, vol: 0.09, type: 'bandpass', f: rnd(700, 1100), q: 0.8 }); break;
      case 'stepWood': this.noise({ dest: d, dur: 0.09, vol: 0.12, type: 'bandpass', f: rnd(350, 480), q: 3 }); this.tone({ dest: d, f: rnd(110, 140), dur: 0.08, vol: 0.08, type: 'triangle' }); break;
      case 'stepStone': this.noise({ dest: d, dur: 0.07, vol: 0.12, type: 'highpass', f: rnd(1800, 2600) }); break;
      case 'stepSnow': this.noise({ dest: d, dur: 0.18, vol: 0.1, type: 'bandpass', f: rnd(1600, 2200), q: 0.6, attack: 0.04 }); break;
      case 'hoof': this.tone({ dest: d, f: rnd(170, 210), f2: 90, dur: 0.09, vol: 0.22, type: 'triangle' }); this.noise({ dest: d, dur: 0.05, vol: 0.12, type: 'bandpass', f: 900, q: 2 }); break;
      case 'land': this.noise({ dest: d, dur: 0.16, vol: 0.18, type: 'lowpass', f: 400 }); break;
      case 'neigh': for (let i = 0; i < 5; i++) this.syllable(d, i * 0.09, 700 - i * 60, 600 - i * 70, 0.12, 0.12, 'sawtooth', 40); this.noise({ dest: d, dur: 0.4, at: 0.45, vol: 0.12, type: 'bandpass', f: 600 }); break;
      // combat
      case 'swing': this.noise({ dest: d, dur: 0.22, vol: 0.14, type: 'bandpass', f: 600, f2: 2400, q: 1.5, attack: 0.06 }); break;
      case 'hit': this.noise({ dest: d, dur: 0.12, vol: 0.32, type: 'lowpass', f: 900 }); this.tone({ dest: d, f: 130, f2: 60, dur: 0.12, vol: 0.25, type: 'sine' }); break;
      case 'crit': this.play('hit', pos); this.tone({ dest: d, f: 1800, f2: 900, dur: 0.18, vol: 0.12, type: 'square' }); break;
      case 'block': this.tone({ dest: d, f: 520, dur: 0.35, vol: 0.18, type: 'triangle' }); this.tone({ dest: d, f: 1310, dur: 0.25, vol: 0.08, type: 'sine' }); break;
      case 'dodge': this.noise({ dest: d, dur: 0.25, vol: 0.12, type: 'bandpass', f: 2400, f2: 500, q: 2, attack: 0.04 }); break;
      case 'hurt': this.tone({ dest: d, f: 220, f2: 140, dur: 0.18, vol: 0.18, type: 'sawtooth', filter: ['lowpass', 900] }); this.noise({ dest: d, dur: 0.1, vol: 0.2, type: 'lowpass', f: 700 }); break;
      case 'heal': [660, 880, 1320].forEach((f, i) => this.tone({ dest: d, f, dur: 0.3, vol: 0.06, at: i * 0.06 })); break;
      case 'bow': this.tone({ dest: d, f: 180, f2: 90, dur: 0.18, vol: 0.18, type: 'triangle' }); this.noise({ dest: d, dur: 0.3, vol: 0.08, type: 'bandpass', f: 3000, f2: 900, at: 0.02 }); break;
      case 'fire': this.noise({ dest: d, dur: 0.5, vol: 0.2, type: 'bandpass', f: 400, f2: 1500, q: 0.7, attack: 0.05 }); this.tone({ dest: d, f: 90, f2: 160, dur: 0.4, vol: 0.12, type: 'sawtooth', filter: ['lowpass', 500] }); break;
      case 'frost': [1760, 2350, 2790].forEach((f, i) => this.tone({ dest: d, f, f2: f * 0.8, dur: 0.4, vol: 0.05, at: i * 0.03 })); this.noise({ dest: d, dur: 0.35, vol: 0.08, type: 'highpass', f: 4000 }); break;
      case 'spin': this.noise({ dest: d, dur: 0.5, vol: 0.18, type: 'bandpass', f: 500, f2: 2500, q: 2, attack: 0.1 }); break;
      case 'nova': [1046, 1318, 1568, 2093].forEach((f, i) => this.tone({ dest: d, f, dur: 0.8, vol: 0.07, at: i * 0.04 })); this.noise({ dest: d, dur: 0.6, vol: 0.12, type: 'highpass', f: 3500 }); break;
      case 'ignite': this.noise({ dest: d, dur: 0.9, vol: 0.35, type: 'lowpass', f: 1800, f2: 200 }); this.tone({ dest: d, f: 70, f2: 35, dur: 0.8, vol: 0.3, type: 'sine' }); break;
      case 'slam': this.tone({ dest: d, f: 60, f2: 28, dur: 0.9, vol: 0.45, type: 'sine' }); this.noise({ dest: d, dur: 0.7, vol: 0.3, type: 'lowpass', f: 500, f2: 120 }); break;
      case 'zap': this.tone({ dest: d, f: 900, f2: 300, dur: 0.3, vol: 0.12, type: 'square', filter: ['lowpass', 2500] }); break;
      // gathering
      case 'mine': this.tone({ dest: d, f: rnd(1900, 2300), dur: 0.25, vol: 0.12, type: 'triangle' }); this.tone({ dest: d, f: rnd(3100, 3500), dur: 0.15, vol: 0.06 }); this.noise({ dest: d, dur: 0.12, vol: 0.2, type: 'highpass', f: 2000 }); break;
      case 'chop': this.tone({ dest: d, f: rnd(180, 230), f2: 120, dur: 0.12, vol: 0.28, type: 'triangle' }); this.noise({ dest: d, dur: 0.1, vol: 0.2, type: 'bandpass', f: 800, q: 1.5 }); break;
      case 'treeFall': this.noise({ dest: d, dur: 1.2, vol: 0.12, type: 'bandpass', f: 300, f2: 900, q: 8, attack: 0.3 }); this.noise({ dest: d, dur: 0.8, vol: 0.4, at: 1.3, type: 'lowpass', f: 600, f2: 100 }); this.tone({ dest: d, f: 55, f2: 30, dur: 0.7, vol: 0.35, at: 1.3 }); break;
      case 'pick': this.noise({ dest: d, dur: 0.25, vol: 0.12, type: 'bandpass', f: 2500, q: 0.8, attack: 0.05 }); this.noise({ dest: d, dur: 0.06, vol: 0.12, at: 0.2, type: 'highpass', f: 3000 }); break;
      case 'skin': this.noise({ dest: d, dur: 0.35, vol: 0.14, type: 'bandpass', f: 1400, f2: 700, q: 3, attack: 0.05 }); break;
      case 'cast': this.noise({ dest: d, dur: 0.3, vol: 0.1, type: 'bandpass', f: 800, f2: 3000, q: 2, attack: 0.08 }); break;
      case 'plop': this.tone({ dest: d, f: 600, f2: 180, dur: 0.15, vol: 0.2 }); this.noise({ dest: d, dur: 0.2, vol: 0.08, type: 'highpass', f: 2500, at: 0.04 }); break;
      case 'splash': this.noise({ dest: d, dur: 0.5, vol: 0.25, type: 'bandpass', f: 1500, f2: 600, q: 0.6 }); this.tone({ dest: d, f: 420, f2: 160, dur: 0.2, vol: 0.12 }); break;
      case 'reel': for (let i = 0; i < 8; i++) this.noise({ dest: d, dur: 0.03, vol: 0.05, at: i * 0.05, type: 'highpass', f: 4000 }); break;
      case 'lost': this.tone({ dest: d, f: 300, f2: 150, dur: 0.4, vol: 0.12, type: 'triangle' }); break;
      // crafting stations
      case 'anvil': this.tone({ dest: d, f: rnd(800, 900), dur: 0.6, vol: 0.18, type: 'triangle' }); this.tone({ dest: d, f: 2200, dur: 0.4, vol: 0.08 }); this.noise({ dest: d, dur: 0.05, vol: 0.2, type: 'highpass', f: 3000 }); break;
      case 'furnace': this.noise({ dest: d, dur: 0.9, vol: 0.25, type: 'lowpass', f: 300, f2: 900, attack: 0.15 }); break;
      case 'workbench': for (let i = 0; i < 4; i++) this.noise({ dest: d, dur: 0.12, vol: 0.12, at: i * 0.15, type: 'bandpass', f: i % 2 ? 1800 : 1200, q: 2, attack: 0.03 }); break;
      case 'cook': this.noise({ dest: d, dur: 0.9, vol: 0.12, type: 'highpass', f: 3500, attack: 0.1 }); break;
      case 'tanning': for (let i = 0; i < 3; i++) this.noise({ dest: d, dur: 0.18, vol: 0.12, at: i * 0.22, type: 'bandpass', f: 900, q: 1.5, attack: 0.05 }); break;
      case 'loom': for (let i = 0; i < 3; i++) { this.tone({ dest: d, f: 240, f2: 180, dur: 0.08, vol: 0.18, at: i * 0.25, type: 'triangle' }); this.noise({ dest: d, dur: 0.05, vol: 0.1, at: i * 0.25 + 0.1, type: 'bandpass', f: 1500 }); } break;
      case 'alchemy': for (let i = 0; i < 6; i++) this.tone({ dest: d, f: rnd(300, 700), f2: rnd(800, 1400), dur: 0.08, vol: 0.06, at: i * rnd(0.06, 0.14) }); break;
      // items and life
      case 'pickup': this.tone({ dest: d, f: 520, f2: 780, dur: 0.12, vol: 0.12, type: 'triangle' }); break;
      case 'coins': for (let i = 0; i < 4; i++) this.tone({ dest: d, f: rnd(2600, 3600), dur: 0.15, vol: 0.06, at: i * 0.05, type: 'triangle' }); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noise({ dest: d, dur: 0.08, vol: 0.14, at: i * 0.16, type: 'bandpass', f: 1200, q: 1.2 }); break;
      case 'drink': for (let i = 0; i < 3; i++) this.tone({ dest: d, f: 300 + i * 40, f2: 180, dur: 0.12, vol: 0.12, at: i * 0.18 }); break;
      case 'door': this.tone({ dest: d, f: 300, f2: 520, dur: 0.5, vol: 0.06, type: 'sawtooth', vib: [12, 30], filter: ['bandpass', 900, 4] }); this.noise({ dest: d, dur: 0.12, vol: 0.15, at: 0.45, type: 'lowpass', f: 500 }); break;
      case 'craftDone': this.tone({ dest: d, f: 880, dur: 0.15, vol: 0.08, type: 'triangle' }); break;
      // interface
      case 'uiOpen': this.tone({ dest: d, f: 440, f2: 660, dur: 0.08, vol: 0.05, type: 'triangle' }); break;
      case 'uiClose': this.tone({ dest: d, f: 660, f2: 440, dur: 0.08, vol: 0.05, type: 'triangle' }); break;
      case 'uiError': this.tone({ dest: d, f: 180, dur: 0.15, vol: 0.08, type: 'square', filter: ['lowpass', 900] }); break;
      case 'uiLevel': [523, 659, 784, 1046].forEach((f, i) => this.tone({ dest: d, f, dur: 0.35, vol: 0.1, at: i * 0.09, type: 'triangle' })); break;
      case 'uiFanfare': [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ dest: d, f, dur: i === 5 ? 0.8 : 0.25, vol: 0.1, at: i * 0.08, type: 'square', filter: ['lowpass', 2500] })); break;
      case 'uiRare': [1318, 1760, 2093, 2637].forEach((f, i) => this.tone({ dest: d, f, dur: 0.5, vol: 0.05, at: i * 0.05 })); break;
    }
  }

  // ---------------------------------------------------------------- monster voices

  voice(kind: string, mood: MobVoice, pos: V3): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const d = this.out(pos, kind === 'mine_king' || kind === 'troll' ? 60 : 35);
    if (!d) return;
    const goblin = kind === 'goblin' || kind === 'cave_goblin' || kind === 'cave_shaman';
    if (goblin) {
      // Squeaky gibberish. Shamans are higher and warble.
      const base = kind === 'cave_shaman' ? 760 : kind === 'cave_goblin' ? 520 : 620;
      const vib = kind === 'cave_shaman' ? 60 : 25;
      if (mood === 'aggro' || mood === 'idle') {
        // "Hehe! Nyeh-nyeh-nyeh!" — a cackle or some chatter.
        const n = mood === 'aggro' ? 5 : Math.floor(rnd(2, 5));
        for (let i = 0; i < n; i++) { const f = base * rnd(0.85, 1.35) * (mood === 'aggro' ? 1 - i * 0.05 : 1); this.syllable(d, i * rnd(0.09, 0.14), f, f * rnd(0.7, 1.3), rnd(0.08, 0.14), 0.22, 'square', vib); }
        if (mood === 'aggro') this.syllable(d, n * 0.12 + 0.05, base * 1.6, base * 2.2, 0.22, 0.2, 'square', 80); // "...HEE!"
      } else if (mood === 'attack') {
        this.syllable(d, 0, base * 1.3, base * 0.8, 0.16, 0.24, 'square', vib); // "Hyah!"
      } else if (mood === 'hurt') {
        this.syllable(d, 0, base * 1.5, base * 0.6, 0.18, 0.26, 'square', 0); // "Oof!"
        this.syllable(d, 0.16, base * 0.9, base * 0.85, 0.07, 0.14, 'square', 0);
      } else {
        // "Bleeeeehhh..." long, wobbly, sinking — then a tiny squeak.
        this.syllable(d, 0, base * 1.2, base * 0.35, 1.1, 0.25, 'sawtooth', 50);
        this.tone({ dest: d, f: 2400, f2: 3000, dur: 0.08, vol: 0.06, at: 1.15, type: 'square' });
      }
      if (kind === 'cave_shaman' && (mood === 'aggro' || mood === 'attack')) [1760, 2217, 2637].forEach((f, i) => this.tone({ dest: d, f, dur: 0.3, vol: 0.04, at: 0.1 + i * 0.05 }));
      return;
    }
    switch (kind) {
      case 'wolf':
        if (mood === 'aggro') { this.tone({ dest: d, f: 420, f2: 720, dur: 0.5, vol: 0.12, vib: [5, 8] }); this.tone({ dest: d, f: 720, f2: 520, dur: 0.9, vol: 0.12, at: 0.45, vib: [5, 10] }); }
        else if (mood === 'death') this.tone({ dest: d, f: 900, f2: 300, dur: 0.6, vol: 0.12, vib: [9, 30] });
        else if (mood === 'hurt') this.tone({ dest: d, f: 1100, f2: 700, dur: 0.18, vol: 0.12, type: 'triangle' });
        else this.noise({ dest: d, dur: 0.5, vol: 0.18, type: 'bandpass', f: 220, q: 3, attack: 0.08 });
        break;
      case 'lynx':
        if (mood === 'aggro' || mood === 'attack') this.noise({ dest: d, dur: 0.5, vol: 0.2, type: 'highpass', f: 2500, attack: 0.02 });
        else this.tone({ dest: d, f: 700, f2: 450, dur: 0.6, vol: 0.12, type: 'sawtooth', vib: [6, 30], filter: ['bandpass', 1400, 3] });
        break;
      case 'bat':
        for (let i = 0; i < (mood === 'death' ? 6 : 3); i++) this.tone({ dest: d, f: rnd(3500, 5000), f2: rnd(2500, 4000), dur: 0.05, vol: 0.07, at: i * 0.07 });
        break;
      case 'troll': case 'hill_troll': case 'mine_king': {
        const low = kind === 'mine_king' ? 85 : kind === 'troll' ? 70 : 95;
        if (mood === 'aggro' && kind === 'mine_king') { for (let i = 0; i < 3; i++) this.syllable(d, i * 0.28, low * 1.6, low * 1.3, 0.24, 0.3, 'sawtooth', 6); } // "HO HO HO"
        else if (mood === 'death') this.syllable(d, 0, low * 1.4, low * 0.5, 1.6, 0.35, 'sawtooth', 8);
        else if (mood === 'hurt') this.syllable(d, 0, low * 1.5, low, 0.25, 0.3, 'sawtooth', 0);
        else this.syllable(d, 0, low, low * rnd(0.8, 1.2), mood === 'aggro' ? 0.7 : 0.4, 0.32, 'sawtooth', 12); // "HUURRR"
        break;
      }
      case 'draug':
        if (mood === 'death') this.syllable(d, 0, 160, 70, 1.4, 0.2, 'sawtooth', 4);
        else if (mood === 'hurt') this.syllable(d, 0, 200, 140, 0.25, 0.2, 'sawtooth', 0);
        else this.syllable(d, 0, rnd(120, 150), rnd(100, 130), mood === 'aggro' ? 1.2 : 0.6, 0.18, 'sawtooth', 3); // "Ooohhh..."
        break;
      case 'wisp':
        [1318, 1661, 1976, 2637].slice(0, mood === 'death' ? 4 : 2).forEach((f, i) => this.tone({ dest: d, f: f * (mood === 'death' ? 1 - i * 0.05 : 1), dur: 0.6, vol: 0.05, at: i * 0.08 }));
        this.noise({ dest: d, dur: 0.4, vol: 0.04, type: 'highpass', f: 5000, attack: 0.1 });
        break;
    }
  }

  // ---------------------------------------------------------------- ambience

  private loop(k: string): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    gain.gain.value = 0;
    if (k === 'wind') { filter.type = 'bandpass'; filter.frequency.value = 400; filter.Q.value = 0.5; }
    if (k === 'rain') { filter.type = 'lowpass'; filter.frequency.value = 2200; filter.Q.value = 0.3; } // soft patter, not a hiss
    if (k === 'water') { filter.type = 'lowpass'; filter.frequency.value = 500; }
    if (k === 'cave') { filter.type = 'lowpass'; filter.frequency.value = 120; }
    src.connect(filter).connect(gain).connect(this.amb);
    src.start();
    this.loops[k] = { src, gain, filter };
  }

  /** Per frame: wind, rain, water, birds by day, crickets by night, drips underground, crackling fires. */
  ambience(o: { day: number; rain: number; snow: number; region: string; indoors: boolean; height: number; nearWater: number; fire?: V3 | null }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, set = (k: string, v: number) => this.loops[k]?.gain.gain.setTargetAtTime(v, t, 0.6);
    const cave = o.region === 'cave', shelter = o.indoors ? 0.35 : 1;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    set('wind', cave ? 0 : (0.025 + gust * 0.03 + Math.max(0, o.height - 8) * 0.004 + o.snow * 0.04 + (o.region === 'gruben' ? 0.02 : 0)) * shelter);
    if (this.loops.wind) this.loops.wind.filter.frequency.setTargetAtTime(300 + gust * 400, t, 0.8);
    set('rain', cave ? 0 : o.rain * 0.022 * (o.indoors ? 0.4 : 1));
    set('water', cave ? 0 : o.nearWater * 0.05);
    set('cave', cave ? 0.18 : 0);
    const now = performance.now();
    if (!cave && !o.indoors && o.rain < 0.3) {
      if (o.day > 0.5 && now > this.nextBird) { this.nextBird = now + rnd(2500, 9000); this.bird(); }
      if (o.day < 0.2 && now > this.nextCricket) { this.nextCricket = now + rnd(300, 900); this.cricket(); }
    }
    if (cave && now > this.nextDrip) { this.nextDrip = now + rnd(900, 3500); this.drip(); }
    if (o.fire && now > this.nextCrackle) { this.nextCrackle = now + rnd(60, 260); const d = this.out(o.fire, 12, 'amb'); if (d) this.noise({ dest: d, dur: 0.03, vol: rnd(0.08, 0.25), type: 'highpass', f: rnd(1500, 4000) }); }
  }

  private bird(): void {
    const d = this.amb, base = rnd(2200, 3800), n = Math.floor(rnd(2, 6)), pan = this.ctx!.createStereoPanner();
    pan.pan.value = rnd(-0.8, 0.8); pan.connect(d);
    for (let i = 0; i < n; i++) this.tone({ dest: pan, f: base * rnd(0.9, 1.15), f2: base * rnd(1.1, 1.5), dur: rnd(0.06, 0.14), vol: 0.03, at: i * rnd(0.09, 0.16) });
  }
  private cricket(): void {
    const pan = this.ctx!.createStereoPanner(); pan.pan.value = rnd(-0.9, 0.9); pan.connect(this.amb);
    for (let i = 0; i < 3; i++) this.tone({ dest: pan, f: 4600, dur: 0.03, vol: 0.012, at: i * 0.045, type: 'square', filter: ['bandpass', 4600, 10] });
  }
  private drip(): void {
    const pan = this.ctx!.createStereoPanner(); pan.pan.value = rnd(-0.8, 0.8); pan.connect(this.amb);
    this.tone({ dest: pan, f: rnd(900, 1500), f2: rnd(1800, 2600), dur: 0.12, vol: 0.06 });
  }
}

export const sound = new Audio();
