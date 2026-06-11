# Single-stage image — simple and reliable for the better-sqlite3 native module.
# Good enough for a ~15-person pool; optimize later if you ever need to.
FROM node:22-bookworm-slim

# build tools for the better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# app source + production build
COPY . .
RUN npm run build

ENV NODE_ENV=production
# the host should mount a persistent volume at /data and set DB_PATH=/data/app.db
# (no Docker VOLUME directive — Railway manages volumes and rejects it)
ENV DB_PATH=/data/app.db
EXPOSE 3000

# self-seeds, persists a session secret on the volume, then starts the server
CMD ["node", "scripts/docker-start.mjs"]
