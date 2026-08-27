#!/bin/sh
set -u

# Start the actual game server first. The public tunnel is deliberately
# fail-open: if Serveo is unavailable, Railway continues serving the game on
# its normal hostname instead of taking multiplayer offline.
node server.js &
SERVER_PID=$!

TUNNEL_ALIAS="${PUBLIC_TUNNEL_ALIAS:-james-garden-care-play-2026}"
LOCAL_PORT="${PORT:-3000}"

start_tunnel_loop() {
  # Give the HTTP/WebSocket server a moment to begin listening.
  sleep 3

  while kill -0 "$SERVER_PID" 2>/dev/null; do
    echo "[public-tunnel] requesting https://${TUNNEL_ALIAS}.serveo.net"

    ssh \
      -p 443 \
      -N \
      -T \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R "${TUNNEL_ALIAS}:80:127.0.0.1:${LOCAL_PORT}" \
      serveo.net || true

    if kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "[public-tunnel] disconnected; retrying in 5 seconds"
      sleep 5
    fi
  done
}

start_tunnel_loop &
TUNNEL_PID=$!

shutdown() {
  kill "$TUNNEL_PID" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$TUNNEL_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}

trap shutdown INT TERM EXIT
wait "$SERVER_PID"
STATUS=$?
exit "$STATUS"
