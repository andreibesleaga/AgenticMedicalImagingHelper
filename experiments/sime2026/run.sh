#!/usr/bin/env bash
# Reproducibility runs for the experiment pack (E2 scalability, E4 longitudinal cohort).
#
# Inputs are prepared by prepare-nih.py into $INPUT (default ../../../nih-cxr14/input).
# The CLI is driven exactly as a user would drive it; nothing here is special-cased.
#
# Usage: ./run.sh <E2|E4|E4L|all> [model]
#   all = E2 + E4. E4L (the 40-patient stratified cohort, if prepared) is opt-in
#   because it is ~5x the cost of E4.
#   Results: runs/<id>/ (stdout, stderr, output artefacts) and results.jsonl
#
# Environment:
#   AI_PROVIDER=google|openrouter  Provider (default: google). openrouter sets
#                                  OPENROUTER_MODEL, google sets GEMINI_MODEL.
#   GOOGLE_API_KEY / OPENROUTER_API_KEY   Whichever the provider needs.
#   INPUT=<dir>          Prepared input root (default ../../../nih-cxr14/input).
#   CLI="node …"         Command that runs the built CLI.
#   E2_SIZES="S1x1 …"    E2 input sizes        (default "S1x1 S2x5 S3x10 S4x20").
#   E2_CONC="1 5"        E2 concurrency levels (default "1 5").
#   E4_CONC=1            E4 concurrency        (default 1).
#   MAX_COST=3           --max-cost-usd for every run (default 3).
#   AI_MAX_RETRIES=3     Transient-failure retries inside the CLI (0 disables).
#   SKIP_EXISTING=1      Skip run ids already present in results.jsonl (exit 0).
#
# Run ids carry the provider and the model with "/" replaced by "_", e.g.
#   E2-S2x5-c5-google-gemini-2.5-flash
#   E4-00000013-openrouter-google_gemini-2.5-flash
# Rows written before the provider segment existed (google only) are still
# recognised by SKIP_EXISTING, so a resumed google batch does not re-spend.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
INPUT="${INPUT:-$ROOT/../nih-cxr14/input}"; RUNS="$HERE/runs"; mkdir -p "$RUNS"
RESULTS="$HERE/results.jsonl"
CLI="${CLI:-node $ROOT/dist/main/index.js}"

PROVIDER="$(printf '%s' "${AI_PROVIDER:-google}" | tr '[:upper:]' '[:lower:]')"
if [[ "$PROVIDER" != "google" && "$PROVIDER" != "openrouter" ]]; then
  echo "AI_PROVIDER must be google or openrouter (got '$PROVIDER')" >&2; exit 2
fi

what="${1:-all}"
if [[ "$PROVIDER" == "openrouter" ]]; then default_model="google/gemini-2.5-flash"
else default_model="gemini-2.5-flash"; fi
model="${2:-$default_model}"
model_tag="${model//\//_}"          # "/" is not safe in a run-directory name

E2_SIZES="${E2_SIZES:-S1x1 S2x5 S3x10 S4x20}"
E2_CONC="${E2_CONC:-1 5}"
E4_CONC="${E4_CONC:-1}"
MAX_COST="${MAX_COST:-3}"
SKIP_EXISTING="${SKIP_EXISTING:-0}"

# Already recorded? (only consulted when SKIP_EXISTING=1)
recorded() { [[ -f "$RESULTS" ]] && grep -qF "\"id\":\"$1\"" "$RESULTS"; }

one() { # id inputdir concurrency model
  local id="$1" in="$2" conc="$3" m="$4" out="$RUNS/$1"
  if [[ "$SKIP_EXISTING" == "1" ]]; then
    if recorded "$id" || { [[ "$PROVIDER" == "google" ]] && recorded "${id/-google-/-}"; }; then
      echo "skip $id (already in results.jsonl)" >&2; return 0
    fi
  fi
  rm -rf "$out"; mkdir -p "$out"

  local t0 t1 rc
  t0=$(date +%s%N)
  if [[ "$PROVIDER" == "openrouter" ]]; then
    env AI_PROVIDER=openrouter OPENROUTER_MODEL="$m" \
      $CLI analyze "$in" "$out/output" --verbose --concurrency "$conc" --max-cost-usd "$MAX_COST" \
      >"$out/stdout.txt" 2>"$out/stderr.txt"
  else
    env AI_PROVIDER=google GEMINI_MODEL="$m" \
      $CLI analyze "$in" "$out/output" --verbose --concurrency "$conc" --max-cost-usd "$MAX_COST" \
      >"$out/stdout.txt" 2>"$out/stderr.txt"
  fi
  rc=$?
  t1=$(date +%s%N)

  # Wall clock to 0.1 s, integer arithmetic only (no python/awk dependency).
  local ms=$(( (t1 - t0) / 1000000 ))
  local wall="$(( ms / 1000 )).$(( (ms % 1000) / 100 ))"

  # The CLI's --verbose cost summary, e.g.
  #   Estimated OpenRouter cost: $0.0031 over 2 call(s) (1877 in / 2644 out tokens
  #   incl. thinking; provider openrouter, model google/gemini-2.5-flash at …
  #   ; provider-reported $0.0029)
  local line calls tin tout usd pusd retries imgs sessions ok
  line=$(grep -oE 'Estimated (Gemini|OpenRouter) cost:.*' "$out/stderr.txt" | tail -1)
  calls=$(grep -oE 'over [0-9]+ call' <<<"$line" | grep -oE '[0-9]+')
  tin=$(grep -oE '\([0-9]+ in' <<<"$line" | grep -oE '[0-9]+')
  tout=$(grep -oE '/ [0-9]+ out' <<<"$line" | grep -oE '[0-9]+')
  usd=$(grep -oE 'cost: \$[0-9.]+' <<<"$line" | grep -oE '[0-9.]+')
  # Provider-reported charge: OpenRouter's usage.cost. Absent on the Google path.
  pusd=$(grep -oE 'provider-reported \$[0-9.]+' <<<"$line" | grep -oE '[0-9.]+')
  # Transient failures the CLI retried (429/5xx/transport), from the verbose log.
  retries=$(grep -c 'call failed (attempt' "$out/stderr.txt")

  imgs=$(find "$in" -name '*.png' | wc -l); imgs=$(( imgs ))
  sessions=$(find "$in" -mindepth 1 -maxdepth 1 -type d | wc -l); sessions=$(( sessions ))
  ok=$(grep -o 'Images analyzed:.*' "$out/stdout.txt" | head -1)

  printf '{"id":"%s","date":"%s","provider":"%s","model":"%s","concurrency":%s,"sessions":%s,"images":%s,"exit":%s,"wall_s":%s,"calls":%s,"tokens_in":%s,"tokens_out":%s,"usd":%s,"provider_usd":%s,"retries":%s,"images_line":"%s"}\n' \
    "$id" "$(date -u +%FT%TZ)" "$PROVIDER" "$m" "$conc" "$sessions" "$imgs" "$rc" "$wall" \
    "${calls:-null}" "${tin:-null}" "${tout:-null}" "${usd:-null}" "${pusd:-null}" \
    "${retries:-0}" "$ok" | tee -a "$RESULTS"
}

if [[ "$what" == "E2" || "$what" == "all" ]]; then
  # shellcheck disable=SC2086  # E2_SIZES/E2_CONC are space-separated lists on purpose
  for size in $E2_SIZES; do
    for conc in $E2_CONC; do
      one "E2-${size}-c${conc}-${PROVIDER}-${model_tag}" "$INPUT/E2/$size" "$conc" "$model"
    done
  done
fi

# One arm per longitudinal cohort directory; the directory name is the id prefix.
cohort() { # cohort-dir-name
  local cohort="$1" p pid
  if [[ ! -d "$INPUT/$cohort" ]]; then
    echo "no $cohort cohort under $INPUT (run prepare-nih.py first)" >&2; return 0
  fi
  for p in "$INPUT/$cohort"/*/; do
    pid=$(basename "$p")
    one "${cohort}-${pid}-${PROVIDER}-${model_tag}" "$p" "$E4_CONC" "$model"
  done
}

if [[ "$what" == "E4" || "$what" == "all" ]]; then cohort E4; fi
if [[ "$what" == "E4L" ]]; then cohort E4L; fi
