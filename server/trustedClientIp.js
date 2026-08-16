export function configureTrustedProxy(app, rawHops = 0) {
  const parsed = Number.parseInt(String(rawHops), 10);
  const hops = Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 0;
  app.set("trust proxy", hops);
  return hops;
}

export function resolveTrustedClientIp(app, request) {
  if (!request) return "unknown";
  const hadOwnApp = Object.prototype.hasOwnProperty.call(request, "app");
  const previousApp = request.app;
  request.app = app;
  try {
    // Express delegates this getter to proxy-addr using the configured
    // `trust proxy fn`. That prevents a client-controlled left-most forwarded
    // value from being treated as authoritative.
    return Reflect.get(app.request, "ip", request) || "unknown";
  } finally {
    if (hadOwnApp) request.app = previousApp;
    else delete request.app;
  }
}

export function attachTrustedClientIp(io, app) {
  io.use((socket, next) => {
    try {
      socket.data.clientIp = resolveTrustedClientIp(app, socket.request);
      next();
    } catch (error) {
      next(error);
    }
  });
}
