import { NET, PROTOCOL_VERSION, encodeMsg, type ClientMsg, type ServerMsg } from '@zona/shared';

/** WebSocket connection to the game server with ping/RTT tracking. */
export class Net {
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  rtt = 0;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(name: string, token: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        window.clearInterval(this.pingTimer);
        this.send({ t: 'join', name, protocol: PROTOCOL_VERSION, ...(token ? { token } : {}) });
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping', t0: performance.now(), rtt: this.rtt }), NET.PING_INTERVAL_MS);
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'pong') {
          const sample = performance.now() - m.t0;
          this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
        }
        this.onMessage(m);
      };
      ws.onclose = () => {
        if (!opened) {
          reject(new Error('connect failed'));
          return;
        }
        // A socket replaced by a newer connection (e.g. after a reconnect) is not "our" connection.
        if (ws !== this.ws) return;
        window.clearInterval(this.pingTimer);
        this.onClose();
      };
      ws.onerror = () => {
        // onclose follows.
      };
    });
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMsg(m));
  }

  close(): void {
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
