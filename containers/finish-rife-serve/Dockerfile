# Homelab HTTP serve overlay for finish_clip (RIFE). Consumes the published RunPod backend
# image as GPU base; homelab wiring lives in vivijure-local, not vivijure-backend.
ARG BACKEND_IMAGE=ghcr.io/skyphusion-labs/vivijure-backend:1.0.6
FROM ${BACKEND_IMAGE}

COPY runpod_http_serve.py serve.py /opt/vivijure/
CMD ["conda", "run", "--no-capture-output", "-n", "vivijure", "python", "-u", "/opt/vivijure/serve.py"]
