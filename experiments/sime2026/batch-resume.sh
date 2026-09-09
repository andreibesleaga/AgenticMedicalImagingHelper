#!/usr/bin/env bash
# batch-resume.sh — the two-pass driver the published batch was run with.
#
# It re-invokes run.sh for every arm twice. Pass 2 is the point: with
# SKIP_EXISTING=1, run.sh skips any arm whose output already exists, so a pass
# that was interrupted (a quota block, a dropped connection, a killed shell)
# is completed rather than restarted, and nothing already paid for is paid for
# again.
#
# Everything below is overridable, so this runs from a clone. Defaults:
#   REPO   the repository root, derived from this script's location
#   INPUT  ../nih-cxr14/input-e4l20 relative to the repo, i.e. the 20-patient
#          E4L tree described in docs/PAPER.md §3. Point it at
#          ../nih-cxr14/input to run all 40 E4L patients instead.
#   CLI    node dist/main/index.js — run `npm run build` first.
#
# Requires OPENROUTER_API_KEY (and GOOGLE_API_KEY for the google control arm).
# A local .env is sourced when present; it is gitignored and optional.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$HERE/../.." && pwd)}"
cd "$REPO"

if [[ -f ./.env ]]; then set -a; . ./.env; set +a; fi

export INPUT="${INPUT:-$REPO/../nih-cxr14/input-e4l20}"
export CLI="${CLI:-node $REPO/dist/main/index.js}"
export SKIP_EXISTING="${SKIP_EXISTING:-1}"
export AI_MAX_RETRIES="${AI_MAX_RETRIES:-4}"

R="$REPO/experiments/sime2026/run.sh"

for pass in 1 2; do
  echo "== pass $pass $(date -u +%FT%TZ)"
  AI_PROVIDER=openrouter "$R" E2 google/gemini-2.5-flash
  for m in google/gemini-2.5-flash google/gemma-4-31b-it \
           qwen/qwen3-vl-235b-a22b-instruct anthropic/claude-sonnet-5; do
    AI_PROVIDER=openrouter "$R" E4 "$m"
  done
  AI_PROVIDER=openrouter "$R" E4L google/gemini-2.5-flash
  # One Google-direct control arm at concurrency 1, kept small on purpose: the
  # free tier is 20 requests/day/model and this arm exists to record that.
  AI_PROVIDER=google E2_SIZES="S2x5" E2_CONC="1" "$R" E2 gemini-2.5-flash
done

# probe-outputs.ts writes its own .md and .json; do not redirect stdout into them.
node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts experiments/sime2026/runs
echo "== BATCH-RESUME-DONE $(date -u +%FT%TZ)"
