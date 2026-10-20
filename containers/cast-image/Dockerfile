# syntax=docker/dockerfile:1
# Local cast.image sidecar: FLUX.2 Klein 4B at the revision pinned in
# model_allowlist.py. Not baked in CI (CUDA image, multi-GB weights).
#
# Homelab build, from the repo root:
#   docker compose --profile cast-image build cast-image
#
# Or from this directory:
#   docker build -t vivijure-cast-image .
#
# The panel calls this sidecar when CAST_IMAGE_BACKEND_URL is set (local#269).

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

COPY model_allowlist.py app.py .

EXPOSE 8785
HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:8785/health || exit 1

CMD ["python", "app.py"]
