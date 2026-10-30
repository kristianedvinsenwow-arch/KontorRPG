/**
 * Game socket. Reconnects with backoff (Render restarts the server on each deploy), measures ping,
 * and watches /version so a new deploy reloads every open tab — KontorLAN's checkVersion pattern.
 */
import { PROTOCOL_VERSION, decodeServer, encode, type ClientMsg, type ServerMsg } from '@kontor/shared';
import { netStore } from '../state/store.js';

type Handler = (msg: ServerMsg) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private retry = 0;
  private hello: { name: string; color: number } | null = null;
  private firstBuild: string | null = null;
  private pingTimer = 0;
  private versionTimer = 0;
  private reloadScheduled = false;

  constructor(private readonly url = defaultUrl()) {}

  on(h: Handler): void { this.handlers.push(h); }

  connect(name: string, color: number): void {
    this.hello = { name, color };
    this.open();
    clearInterval(this.versionTimer);
    this.versionTimer = window.setInterval(() => this.checkVersion(), 60_000);
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private open(): void {
    netStore.set({ status: netStore.get().status === 'restarting' ? 'restarting' : 'connecting' });
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.hello) this.send({ t: 'hello', name: this.hello.name, color: this.hello.color, proto: PROTOCOL_VERSION });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 3000);
    };
    ws.onmessage = (ev) => {
      const msg = decodeServer(String(ev.data));
      if (!msg) return;
      if (msg.t === 'welcome') {
        netStore.set({ status: 'online', myId: msg.id, build: msg.build });
        if (this.firstBuild && this.firstBuild !== msg.build) return this.reload('A new version is live — reloading…');
        this.firstBuild ??= msg.build;
      } else if (msg.t === 'pong') {
        netStore.set({ pingMs: Math.round(performance.now() - msg.at) });
      } else if (msg.t === 'reject') {
        netStore.set({ status: 'rejected' });
        if (msg.reason === 'outdated_client') this.reload('Your game is out of date — reloading…');
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      if (netStore.get().status === 'rejected') return;
      netStore.set({ status: ev.code === 1012 ? 'restarting' : 'connecting', online: [] });
      // 0.5 s, 1 s, 2 s … capped at 10 s.
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private async checkVersion(): Promise<void> {
    try {
      const r = await fetch('/version', { cache: 'no-store' });
      const j = await r.json();
      if (this.firstBuild && j.v && j.v !== this.firstBuild) this.reload('A new version is live — reloading…');
    } catch { /* offline: try again next time */ }
  }

  private reload(text: string): void {
    if (this.reloadScheduled) return;
    this.reloadScheduled = true;
    for (const h of this.handlers) h({ t: 'system', text });
    setTimeout(() => location.reload(), 3000);
  }
}

function defaultUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
