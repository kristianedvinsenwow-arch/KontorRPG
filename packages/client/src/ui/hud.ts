/** HUD: location, connection, who's online, toasts, chat. Plain DOM; rendered from the stores. */
import { WEATHER_LABEL, daylight, regionAt, type WeatherKind } from '@kontor/shared';
import { PLAYER_COLORS } from '@kontor/shared';
import { netStore, uiStore } from '../state/store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initHud(onSendChat: (text: string) => void) {
  const hud = $('hud');
  const coords = $('coords');
  const whereName = document.querySelector('#where b') as HTMLElement;
  const clock = document.createElement('span'); clock.className = 'clock';
  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
  document.getElementById('where')!.append(clock);
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
    toast(text: string, ms = 3500, kind = '') {
      const d = document.createElement('div');
      d.className = kind ? `toast ${kind}` : 'toast';
      while (toasts.children.length > 3) toasts.firstElementChild?.remove();
      d.textContent = text;
      toasts.append(d);
      setTimeout(() => d.remove(), ms);
    },
    /** Oslo clock and the weather, next to the place name. */
    setClock(ms: number, weather: WeatherKind | null) {
      const t = clockFmt.format(ms);
      const icon = weather ? { clear: daylight(ms) > 0.3 ? '☀' : '☾', cloudy: '☁', rain: '🌧', fog: '🌫', snow: '❄' }[weather] : '';
      const text = `${t}${weather ? ` · ${icon} ${WEATHER_LABEL[weather]}` : ''}`;
      if (clock.textContent !== text) clock.textContent = text;
    },
    frame(x: number, z: number) {
      coords.textContent = `${x.toFixed(0)}, ${z.toFixed(0)}`;
      const r = regionAt(x, z), name = r === 'cave' ? 'The Old Mine' : r === 'gruben' ? 'Gruben' : 'Mofjellet';
      if (whereName.textContent !== name) whereName.textContent = name;
      frames++;
      const now = performance.now();
      if (now - lastFps > 1000) { fps.textContent = `${frames} fps`; frames = 0; lastFps = now; }
    },
  };
}
