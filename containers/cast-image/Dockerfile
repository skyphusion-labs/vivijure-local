# syntax=docker/dockerfile:1
# Local cast.image: FLUX.2 Klein 4B (Apache-2.0). Homelab GPU sidecar (local#269).
#
# NOT baked in CI by default (CUDA + multi-GB weights). Homelab:
#   docker compose --profile cast-image build cast-image
#   COMPOSE_PROFILES=cast-image docker compose -f compose.yaml -f compose.cast-image-nvidia.yaml up -d
#
# First /generate downloads ~8–16GB weights into the HF cache volume.

FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8785 \
    HF_HOME=/models/huggingface \
    CAST_IMAGE_MODEL=black-forest-labs/FLUX.2-klein-4B

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 8785
HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:8785/health || exit 1

CMD ["python", "app.py"]
