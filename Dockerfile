# vivijure-local studio + module sidecar image
#
# Build context MUST be the parent directory containing sibling repos:
#   docker build -f vivijure-local/Dockerfile -t vivijure-local-studio:local ..
# compose.yaml sets context: .. and dockerfile: vivijure-local/Dockerfile

FROM node:22-bookworm-slim

WORKDIR /app/vivijure-local

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Sibling vivijure-core (file:../vivijure-core in package.json)
COPY vivijure-core /app/vivijure-core

COPY vivijure-local/package.json vivijure-local/package-lock.json ./
RUN npm ci

COPY vivijure-local .

ENV NODE_ENV=production
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8790/health || exit 1

CMD ["npm", "start"]
