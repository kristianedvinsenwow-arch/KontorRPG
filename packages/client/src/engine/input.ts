/** Keyboard + mouse with pointer lock. Gameplay reads `axes()`; UI keys go through `onKey`. */
export class Input {
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  mouseDown = false;
  private keyListeners: ((code: string, e: KeyboardEvent) => void)[] = [];

  constructor(private readonly canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!e.repeat) for (const f of this.keyListeners) f(e.code, e);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => { if (this.locked && e.button === 0) this.mouseDown = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
  }

  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  lock(): void { if (!this.locked) this.canvas.requestPointerLock?.(); }
  unlock(): void { if (this.locked) document.exitPointerLock(); }

  onKey(f: (code: string, e: KeyboardEvent) => void): void { this.keyListeners.push(f); }

  down(code: string): boolean { return this.keys.has(code); }

  axes() {
    if (!this.locked) return { forward: 0, right: 0, jump: false };
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    return {
      forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
      right: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft'),
      jump: this.keys.has('Space'),
    };
  }

  /** Mouse movement since the last call. */
  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
