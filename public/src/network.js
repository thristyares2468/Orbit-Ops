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
    this.connectionGeneration = 0;
    this.pendingRequests = new Set();

    this.socket.onAny((event, payload) => this.emitLocal(event, payload));
    this.socket.on("connect", () => {
      this.connectionGeneration += 1;
      this.connected = true;
      this.emitLocal("network:connected", { socketId: this.socket.id });
      this.startPing();
    });
    this.socket.on("disconnect", (reason) => {
      this.connectionGeneration += 1;
      this.connected = false;
      // Socket.IO acknowledgements from the old transport can never complete
      // reliably after a disconnect. Reject them now so a newly connected
      // generation can authenticate instead of waiting for the old timeout.
      const error = new Error("The server connection was interrupted.");
      error.code = "NETWORK_DISCONNECTED";
      for (const request of [...this.pendingRequests]) request.reject(error);
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
      const generation = this.connectionGeneration;
      let timer = null;
      let settled = false;
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingRequests.delete(pending);
        handler(value);
      };
      const pending = {
        reject: (error) => settle(reject, error)
      };
      this.pendingRequests.add(pending);
      timer = setTimeout(() => settle(reject, new Error(`${event} timed out.`)), timeoutMs);
      this.socket.emit(event, payload, (response) => {
        if (!this.connected || generation !== this.connectionGeneration) {
          const error = new Error("The server connection changed before the response arrived.");
          error.code = "NETWORK_DISCONNECTED";
          settle(reject, error);
        } else if (response?.ok === false) {
          settle(reject, new Error(response.error ?? "Request failed."));
        } else {
          settle(resolve, response ?? { ok: true });
        }
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
