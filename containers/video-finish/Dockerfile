# syntax=docker/dockerfile:1
# PINNED TO 3.11 FOR DUAL-PANEL INTERPRETER PARITY WITH vivijure-cf (local#316).
#
# Trace (local#316): a 2026-07 precaution for OTHER finish containers (lipsync/upscale)
# rolled video-finish back to 3.11 on both doors; dependabot later bumped THIS door to
# 3.14 twice with clean real builds (no numba / no hardcoded site-packages path). cf never
# revisited and stayed on 3.11. Measured that 3.14 builds here is not a reason to *prefer*
# 3.14: nothing in requirements.txt or app.py needs it, and the /frames path must run the
# same interpreter family on both doors (cf#278 phase 1). Align with cf until a measured
# reason requires otherwise. Enforced by dependabot ignore + tests/video-finish-python-316.test.ts.
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

# ffmpeg ships ffprobe too. fonts-dejavu-core provides DejaVu Sans at
# /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf, which ffmpeg drawtext needs.
#
# THE LIVE CONSUMER IS /film-titles (_title_card_filter / _credits_card_filter in
# app.py), which builds drawtext filters with font="DejaVu Sans" -- a NAME, not a
# fontfile= path. fontconfig supplies the runtime alias resolution that turns that
# name into a file, so BOTH packages are load-bearing and removing either breaks
# title and credit cards.
#
# This rationale used to name the /overlay route (#190) exclusively. That route is
# RETIRED (410), so anyone trimming this image would have read the justification,
# seen the route was gone, and dropped the packages -- breaking /film-titles, which
# needs them for the identical reason. A justification pointing at a dead consumer
# is worse than none: it invites the removal it looks like it is guarding against.
#
# NOTE on aliases: a caller passing font=Arial relies on Debian fontconfig's
# metric-alias mapping Arial -> DejaVu Sans / Liberation Sans. If that alias is ever
# absent, drawtext errors; the fix is to pass "DejaVu Sans" or fontfile= explicitly.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY url_guard.py inspect_core.py app.py .

# Build-time libx264 sanity-encode. ffmpeg has no JIT/model cache to bake (unlike
# the numba/pymatting fix the audio + image-prep containers needed), so the only
# "warm" that makes sense is proving the encoder links and paging it in: encode a
# 1-frame testsrc with the exact codec /finish uses. Fails the build fast if a
# slim-image ffmpeg ever ships without libx264, and the first real /finish then
# pays no encoder-load cost. Bind is immediate at runtime: app.py registers
# /health and binds :8000 before any ffmpeg subprocess (no startup warm thread to
# starve the port-ready check). Worker side still wraps /finish in a warm-/health
# + retry-on-503 cold-start guard (see callVideoFinish).
RUN ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=24:duration=0.1 \
        -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart /tmp/warm.mp4 \
    && ffprobe -v error -show_entries stream=codec_name -of csv=p=0 /tmp/warm.mp4 | grep -q h264 \
    && rm -f /tmp/warm.mp4 \
    && echo "libx264 sanity-encode OK"

# Build-time drawtext sanity-check: prove DejaVuSans.ttf is reachable at
# the expected path and that ffmpeg drawtext can burn text. Fails fast if
# fonts-dejavu-core is ever dropped or moves its files. Uses fontfile= here
# (explicit path) rather than font= so the check is path-exact, independent
# of fontconfig alias resolution.
RUN ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=24:duration=0.1 \
        -vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='vivijure':fontsize=24:fontcolor=white:x=10:y=10" \
        -c:v libx264 -preset ultrafast -pix_fmt yuv420p /tmp/drawtext_warm.mp4 \
    && rm -f /tmp/drawtext_warm.mp4 \
    && echo "drawtext sanity-encode OK"

# Build-time subtitles (libass) sanity-check: the /subtitle route burns captions
# via `-vf subtitles=<srt>`, which needs ffmpeg built WITH libass. Debian's ffmpeg
# is, but prove it: write a 1-cue SRT and burn it. Fails the build fast if a slim
# image ever ships an ffmpeg without the subtitles filter, instead of every
# /subtitle call erroring at runtime. force_style exercises the same font path
# (fontconfig -> DejaVu Sans) the module uses.
RUN printf '1\n00:00:00,000 --> 00:00:00,100\nvivijure\n' > /tmp/warm.srt \
    && ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=24:duration=0.1 \
        -vf "subtitles=/tmp/warm.srt:force_style='FontName=DejaVu Sans,FontSize=18'" \
        -c:v libx264 -preset ultrafast -pix_fmt yuv420p /tmp/subs_warm.mp4 \
    && rm -f /tmp/warm.srt /tmp/subs_warm.mp4 \
    && echo "subtitles (libass) sanity-encode OK"

EXPOSE 8000
CMD ["python", "app.py"]
