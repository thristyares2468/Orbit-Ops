export class NetworkClient {
  constructor() {
    this.socket = window.io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 5000 });
    this.listeners = new Map();
    this.connected = false;
    this.pingMs = null;
    this.serverInfo = null;
    this.pingTimer = null;

    this.socket.onAny((event, payload) => this.emitLocal(event, payload));
    this.socket.on("connect", () => {
      this.connected = true;
      this.emitLocal("network:connected", { socketId: this.socket.id });
      this.startPing();
    });
    this.socket.on("disconnect", (reason) => {
      this.connected = false;
      this.emitLocal("network:disconnected", { reason });
      clearInterval(this.pingTimer);
    });
    this.socket.on("connect_error", (error) => this.emitLocal("network:error", { message: error.message }));
    this.socket.on("connected", (payload) => {
      this.serverInfo = payload;
      this.emitLocal("server:ready", payload);
    });
    this.socket.on("pong", (payload) => {
      this.pingMs = Math.max(0, Date.now() - Number(payload.clientTime));
      this.emitLocal("network:ping", { pingMs: this.pingMs, serverTime: payload.serverTime });
    });
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emitLocal(event, payload) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  request(event, payload = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("The server connection is unavailable."));
        return;
      }
      const timer = setTimeout(() => reject(new Error(`${event} timed out.`)), timeoutMs);
      this.socket.emit(event, payload, (response) => {
        clearTimeout(timer);
        if (response?.ok === false) reject(new Error(response.error ?? "Request failed."));
        else resolve(response ?? { ok: true });
      });
    });
  }

  send(event, payload = {}) {
    if (this.connected) this.socket.emit(event, payload);
  }

  reconnect() {
    this.socket.connect();
  }

  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send("ping", { clientTime: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 3000);
  }
}
