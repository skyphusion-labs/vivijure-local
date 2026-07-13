# vivijure-local studio + module sidecar image
#
# Build context MUST be the parent directory containing sibling repos:
#   docker build -f vivijure-local/Dockerfile -t vivijure-local-studio:local ..
# compose.yaml sets context: .. and dockerfile: vivijure-local/Dockerfile

FROM node:22-bookworm-slim

WORKDIR /app/vivijure-local

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Sibling vivijure-core: copied into the image and linked at install (see npm pkg set below).
COPY vivijure-core /app/vivijure-core
RUN cd /app/vivijure-core && npm ci && npm run build

WORKDIR /app/vivijure-local
COPY vivijure-local/package.json vivijure-local/package-lock.json ./
# Match ci.yml: lock may pin registry ^0.9.x; always link the copied sibling.
RUN npm pkg set dependencies.@skyphusion-labs/vivijure-core=file:../vivijure-core \
  && npm ci --ignore-scripts

COPY vivijure-local .

ENV NODE_ENV=production
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8790/health || exit 1

CMD ["npm", "start"]
