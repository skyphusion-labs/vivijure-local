# vivijure-local studio + module sidecar image
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/vivijure-core/package.json packages/vivijure-core/
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8790/health || exit 1

CMD ["npm", "start"]
