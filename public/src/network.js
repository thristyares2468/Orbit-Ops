export class NetworkClient {
  constructor() {
    this.socket = window.io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 5000 });
    this.listeners = new Map();
    this.connected = false;
    this.pingMs = null;
    this.jitterMs = 0;
    this.lastPingSample = null;
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
      const sample = Math.max(0, Date.now() - Number(payload.clientTime));
      // Smooth the reading so the number is stable enough to read, and track how
      // much consecutive samples disagree - jitter is what makes a connection
      // feel bad, and a steady 90ms plays better than one swinging 40-140ms.
      if (this.lastPingSample !== null) {
        const swing = Math.abs(sample - this.lastPingSample);
        this.jitterMs = Math.round(this.jitterMs * 0.7 + swing * 0.3);
      }
      this.lastPingSample = sample;
      this.pingMs = this.pingMs === null ? sample : Math.round(this.pingMs * 0.6 + sample * 0.4);
      this.emitLocal("network:ping", { pingMs: this.pingMs, jitterMs: this.jitterMs, serverTime: payload.serverTime });
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
    // Every second rather than every three: the readout should react while you
    // are watching it, and one tiny packet a second costs nothing.
    this.pingTimer = setInterval(ping, 1000);
  }
}
