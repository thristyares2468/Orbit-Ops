# Last updated: 6 August 2026
FROM node:22-alpine

WORKDIR /app

# OpenSSH provides the reverse-tunnel client used by start-with-public-tunnel.sh.
# The tunnel is fail-open, so the game server still starts if Serveo is down.
RUN apk add --no-cache openssh-client

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN chmod +x /app/start-with-public-tunnel.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["/app/start-with-public-tunnel.sh"]
