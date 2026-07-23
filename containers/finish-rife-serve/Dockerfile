# Homelab HTTP serve overlay for finish_clip (RIFE). Consumes the published RunPod backend
# image as GPU base; homelab wiring lives in vivijure-local, not vivijure-backend.
# Pin the base image here (no ARG) so CI cannot be steered at an arbitrary FROM.
FROM ghcr.io/skyphusion-labs/vivijure-backend:1.0.6

COPY runpod_http_serve.py serve.py /opt/vivijure/
CMD ["conda", "run", "--no-capture-output", "-n", "vivijure", "python", "-u", "/opt/vivijure/serve.py"]
