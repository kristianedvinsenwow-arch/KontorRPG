/** HUD: location, connection, who's online, toasts, chat. Plain DOM; rendered from the stores. */
import { PLAYER_COLORS } from '@kontor/shared';
import { netStore, uiStore } from '../state/store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initHud(onSendChat: (text: string) => void) {
  const hud = $('hud');
  const coords = $('coords');
  const netdot = $('netdot'), nettext = $('nettext');
  const roster = $('roster');
  const toasts = $('toasts');
  const chatlog = $('chatlog');
  const chatin = $<HTMLInputElement>('chatin');
  const fps = $('fps');

  netStore.subscribe((n) => {
    const label = { offline: 'Offline', connecting: 'Connecting…', online: 'Online', restarting: 'Server restarting…', rejected: 'Disconnected' }[n.status];
    netdot.className = n.status === 'online' ? 'online' : n.status === 'connecting' || n.status === 'restarting' ? '' : 'bad';
    nettext.textContent = n.status === 'online' && n.pingMs != null ? `${label} · ${n.pingMs} ms` : label;
    roster.replaceChildren(...n.online.map((p) => {
      const d = document.createElement('div');
      d.textContent = p.id === n.myId ? `${p.name} (you)` : p.name;
      d.style.color = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
      return d;
    }));
  });

  uiStore.subscribe((u) => {
    hud.hidden = u.panel === 'menu';
    hud.classList.toggle('chatting', u.chatOpen);
    chatin.hidden = !u.chatOpen;
    if (u.chatOpen) setTimeout(() => chatin.focus(), 0);
  });

  chatin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const t = chatin.value.trim();
      if (t) onSendChat(t);
      chatin.value = '';
      uiStore.set({ chatOpen: false });
      e.preventDefault();
    } else if (e.key === 'Escape') {
      chatin.value = '';
      uiStore.set({ chatOpen: false });
      e.preventDefault();
    }
    e.stopPropagation();
  });

  function line(text: string, cls = '', color?: string, who?: string) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (who) {
      const b = document.createElement('b');
      b.textContent = `${who}: `;
      if (color) b.style.color = color;
      d.append(b);
    }
    d.append(document.createTextNode(text)); // never innerHTML for player text
    chatlog.append(d);
    while (chatlog.children.length > 8) chatlog.firstElementChild?.remove();
    setTimeout(() => d.classList.add('old'), 10_000);
  }

  let frames = 0, lastFps = performance.now();
  return {
    chat(name: string, color: number, text: string) { line(text, '', PLAYER_COLORS[color % PLAYER_COLORS.length], name); },
    system(text: string) { line(text, 'sys'); },
    toast(text: string, ms = 3500) {
      const d = document.createElement('div');
      d.className = 'toast';
      d.textContent = text;
      toasts.append(d);
      setTimeout(() => d.remove(), ms);
    },
    frame(x: number, z: number) {
      coords.textContent = `${x.toFixed(0)}, ${z.toFixed(0)}`;
      frames++;
      const now = performance.now();
      if (now - lastFps > 1000) { fps.textContent = `${frames} fps`; frames = 0; lastFps = now; }
    },
  };
}
