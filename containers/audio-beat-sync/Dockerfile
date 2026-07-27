# syntax=docker/dockerfile:1
# PINNED TO 3.11, AND THE PIN IS ENFORCED IN .github/dependabot.yml, NOT HERE.
#
# numba (via librosa) supports only >=3.10,<3.14, the numba-cache warm step below hardcodes the
# python3.11 site-packages path, AND numpy==1.26.4 publishes no cp314 wheel -- so under 3.14 pip
# falls back to a source build and meson dies with "Unknown compiler(s)" because the slim image has
# no cc. Three independent reasons this cannot move.
#
# This comment used to say "Do NOT bump past 3.13" and that was not enough: dependabot does not read
# prose. PR #243 bumped it to 3.14 in a grouped update and the tag bake failed. A constraint a tool
# cannot see is a wish, so the real guard is now an `ignore` rule in dependabot.yml.
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NUMBA_CACHE_DIR=/app/numba-cache \
    MPLCONFIGDIR=/tmp/mpl-cache \
    LIBROSA_CACHE_DIR=/tmp/librosa-cache \
    HF_HUB_OFFLINE=1 \
    PORT=8000

# libsndfile backs soundfile (librosa's IO); ffmpeg covers MP3/AAC/OGG decode;
# libgomp1 is the OpenMP runtime numpy/numba link against.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY url_guard.py app.py .

# Eager-load librosa + JIT the beat tracker at build time so the first /analyze
# does not pay librosa's ~26s numba compile. The compiled kernels (cache=True)
# bake into NUMBA_CACHE_DIR=/app/numba-cache (an image layer), NOT /tmp, which
# the runtime wipes. The `touch` is load-bearing: numba stamps each cache entry
# with the source file's full-precision st_mtime, but buildkit truncates mtimes
# to whole seconds on layer export, so a sub-second mismatch would invalidate
# every kernel and force the full recompile on the first request despite the
# baked cache. Pinning librosa's sources to a whole-second mtime first makes the
# baked stamp match what the runtime sees. (See containers/image-prep for the
# same fix; this beat-sync path JITs on first request, not at bind, so unlike
# image-prep it never blocked activation, only first-request latency.)
RUN find /usr/local/lib/python3.11/site-packages/librosa -name '*.py' -exec touch -d '@1700000000' {} + \
    && python -c "import librosa, numpy; librosa.beat.beat_track(y=numpy.zeros(22050, dtype='float32'), sr=22050); print('warm OK')" \
    && test -d /app/numba-cache && echo "numba cache baked: $(find /app/numba-cache -name '*.nbi' | wc -l) kernels"

EXPOSE 8000
CMD ["python", "app.py"]
