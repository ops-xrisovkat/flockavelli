# Flockavelli — single-container app (API + static front end + SQLite)
FROM node:20-bookworm-slim

# better-sqlite3 ships prebuilt binaries for most platforms; build tools are a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV PORT=8080
ENV DB_PATH=/data/flockavelli.db
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8080) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
