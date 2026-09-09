#!/usr/bin/env bash
# demo/run-demo.sh — guided demo pack for AgenticMedicalImagingHelper.
#
# Drives the built CLI on two showcase NIH ChestX-ray14 patients
# (demo/input/, populated by demo/prepare-demo.sh) through:
#   (A) the golden path — a normal run, its evolution report and manifest
#   (B) governance controls that are each expected to FAIL on purpose, with a
#       documented, asserted exit code
#   (C) the fairness-probe regression benchmark and the post-run governance
#       probe over the artefacts this script just produced
#   (D) the test suite, as a live quality gate
#
# See demo/README.md for prerequisites, expected duration/cost, and a
# narration-cue table mapping each banner below to one sentence of narration.
#
# Env:
#   DEMO_PROVIDER   openrouter (default) | google
#   DEMO_MODEL      model id (default google/gemini-2.5-flash; "google/" is
#                   stripped automatically when DEMO_PROVIDER=google)
#   DEMO_REVIEWER   --reviewer attestation name (default "Demo Presenter")
#   DEMO_PAUSE=1    pause for Enter between sections (default: no pauses)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$REPO_ROOT"

# ── Colours (skip when not a terminal, e.g. piped into a log file) ─────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
else
  C_RESET=""; C_BOLD=""; C_CYAN=""; C_GREEN=""; C_RED=""; C_YELLOW=""
fi

banner() {
  echo
  echo "${C_BOLD}${C_CYAN}================================================================${C_RESET}"
  echo "${C_BOLD}${C_CYAN}  $1${C_RESET}"
  echo "${C_BOLD}${C_CYAN}================================================================${C_RESET}"
  echo
}

pause() {
  if [[ "${DEMO_PAUSE:-0}" == "1" ]]; then
    read -r -p "-- press Enter to continue -- " _ignored || true
  fi
}

declare -a RESULTS=()
PASS_COUNT=0
FAIL_COUNT=0

check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "${C_GREEN}PASS${C_RESET} — $label (exit $actual)"
    RESULTS+=("PASS  $label (exit $actual)")
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "${C_RED}FAIL${C_RESET} — $label (exit $actual, expected $expected)"
    RESULTS+=("FAIL  $label (exit $actual, expected $expected)")
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

print_evolution_summary() {
  node -e '
    const fs = require("fs");
    const e = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    console.log(`  Progression: ${e.progression}`);
    console.log(`  Trends: ${e.trends.length}`);
    for (const t of e.trends) console.log(`    - ${t.finding}: ${t.trend}`);
    const recs = e.treatmentRecommendations || [];
    console.log("  Treatment recommendations (EXPERIMENTAL model output — not clinical advice):");
    if (recs.length === 0) console.log("    (none)");
    for (const r of recs) console.log(`    - ${r}`);
    const v = e.validation;
    console.log(
      "  Structured-output validation: " +
        (v ? (v.ok ? "ok" : "issues: " + (v.issues || []).join("; ")) : "n/a")
    );
  ' "$1"
}

print_manifest_totals() {
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const t = m.totals;
    const provider =
      t.providerUsd !== undefined ? `$${t.providerUsd.toFixed(4)}` : "n/a (provider reports tokens only)";
    console.log(`  Provider / model: ${m.provider} / ${m.model}`);
    console.log(`  Calls: ${t.calls}   Tokens in/out: ${t.tokensIn}/${t.tokensOut} (incl. thinking)`);
    console.log(`  Estimated USD: $${t.estimatedUsd.toFixed(4)}   Provider-reported USD: ${provider}`);
    console.log(`  Images: ${t.imagesSucceeded}/${t.images} succeeded   Series: ${t.series}`);
  ' "$1"
}

sum_manifest_costs() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    function findManifests(dir) {
      let out = [];
      if (!fs.existsSync(dir)) return out;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) out = out.concat(findManifests(p));
        else if (f === "run_manifest.json") out.push(p);
      }
      return out;
    }
    const manifests = findManifests("demo/output");
    let est = 0, prov = 0, haveProv = false;
    for (const m of manifests) {
      const j = JSON.parse(fs.readFileSync(m, "utf8"));
      est += j.totals.estimatedUsd || 0;
      if (j.totals.providerUsd !== undefined) { haveProv = true; prov += j.totals.providerUsd; }
    }
    console.log(
      `  ${manifests.length} manifest(s) written; estimated total $${est.toFixed(4)}` +
        (haveProv ? `; provider-reported total $${prov.toFixed(4)}` : "; this provider reports tokens only, no cost")
    );
  '
}

# ── Setup ────────────────────────────────────────────────────────────────
banner "Setup"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "Loaded .env"
fi

DEMO_PROVIDER="${DEMO_PROVIDER:-openrouter}"
DEMO_MODEL="${DEMO_MODEL:-google/gemini-2.5-flash}"
DEMO_REVIEWER="${DEMO_REVIEWER:-Demo Presenter}"

export AI_PROVIDER="$DEMO_PROVIDER"
case "$AI_PROVIDER" in
  openrouter)
    export OPENROUTER_MODEL="$DEMO_MODEL"
    ;;
  google)
    # GEMINI_MODEL takes a bare model id ("gemini-2.5-flash"), not the
    # OpenRouter-style "vendor/model" id — strip a leading "google/" if present.
    export GEMINI_MODEL="${DEMO_MODEL#google/}"
    ;;
  *)
    echo "DEMO_PROVIDER must be 'openrouter' or 'google' (got '$DEMO_PROVIDER')" >&2
    exit 1
    ;;
esac
echo "Provider: $AI_PROVIDER   Model: ${OPENROUTER_MODEL:-${GEMINI_MODEL:-}}   Reviewer: $DEMO_REVIEWER"

if [[ "$AI_PROVIDER" == "openrouter" && -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "Error: OPENROUTER_API_KEY is not set (.env or environment). Aborting." >&2
  exit 1
fi
if [[ "$AI_PROVIDER" == "google" && -z "${GOOGLE_API_KEY:-}${GEMINI_API_KEY:-}" ]]; then
  echo "Error: GOOGLE_API_KEY / GEMINI_API_KEY is not set (.env or environment). Aborting." >&2
  exit 1
fi

WORSENING="00011264"
IMPROVING="00003158"
if [[ ! -d "demo/input/$WORSENING" || ! -d "demo/input/$IMPROVING" ]]; then
  echo "Error: demo/input/ is missing the showcase patients." >&2
  echo "Run demo/prepare-demo.sh first (see demo/README.md)." >&2
  exit 1
fi

if [[ ! -d dist ]]; then
  echo "dist/ not found — building..."
  npm run build
else
  echo "dist/ present — skipping build (rm -rf dist to force a rebuild)."
fi
CLI=(node dist/main/index.js)

rm -rf demo/output demo/tmp
mkdir -p demo/output demo/tmp
DEMO_START=$(date +%s)

# ── (A) Golden path ─────────────────────────────────────────────────────
run_golden() {
  local patient="$1" label="$2"
  local out_dir="demo/output/$patient/output"

  banner "Golden path — $label patient ($patient)"
  pause
  mkdir -p "demo/output/$patient"

  set +e
  "${CLI[@]}" analyze "demo/input/$patient" "$out_dir" \
    --verbose --concurrency 2 --max-cost-usd 0.50 --reviewer "$DEMO_REVIEWER"
  local exit_code=$?
  set -e
  check "golden path — $label ($patient)" "$exit_code" "0"
  if [[ "$exit_code" -ne 0 ]]; then
    echo "Golden path did not exit 0 — aborting the rest of the demo." >&2
    exit "$exit_code"
  fi

  echo
  echo "${C_YELLOW}--- combined_diagnostic_report.md ---${C_RESET}"
  cat "$out_dir/combined_diagnostic_report.md"

  echo
  echo "${C_YELLOW}--- evolution_analysis.json (compact) ---${C_RESET}"
  print_evolution_summary "$out_dir/evolution_analysis.json"

  echo
  echo "${C_YELLOW}--- run_manifest.json totals ---${C_RESET}"
  print_manifest_totals "$out_dir/run_manifest.json"

  echo
  echo "${C_YELLOW}--- verify-manifest ---${C_RESET}"
  set +e
  "${CLI[@]}" verify-manifest "$out_dir"
  local vm_exit=$?
  set -e
  check "verify-manifest — $label ($patient)" "$vm_exit" "0"
}

run_golden "$WORSENING" "worsening-like"
run_golden "$IMPROVING" "improving-like"

# ── (B) Governance demos — each expected to FAIL on purpose ────────────────
banner "Governance demo — cost cap trip"
echo "--max-cost-usd 0.0001 on a single image (--series series_1 --concurrency 1)."
echo "The cap can only be checked AFTER a call completes (see"
echo "src/infrastructure/cost-meter.ts), so the first real call is made and"
echo "billed, then the run aborts before a second call. Expected exit: 5."
pause
set +e
"${CLI[@]}" analyze "demo/input/$WORSENING" "demo/output/govern-costcap" \
  --series series_1 --concurrency 1 --max-cost-usd 0.0001 --reviewer "$DEMO_REVIEWER" --verbose
exit_code=$?
set -e
check "cost cap trip (--max-cost-usd 0.0001)" "$exit_code" "5"

banner "Governance demo — DICOM input refusal"
mkdir -p demo/tmp/dicom/series_1
node -e '
  const fs = require("fs");
  const preamble = Buffer.alloc(128, 0);
  const magic = Buffer.from("DICM", "latin1");
  const rest = Buffer.from(
    "synthetic placeholder bytes for the demo -- not a real DICOM dataset",
    "latin1"
  );
  fs.writeFileSync("demo/tmp/dicom/series_1/fake.dcm", Buffer.concat([preamble, magic, rest]));
'
echo "Wrote demo/tmp/dicom/series_1/fake.dcm (128-byte preamble + DICM magic)."
pause
set +e
"${CLI[@]}" analyze demo/tmp/dicom demo/output/govern-dicom --reviewer "$DEMO_REVIEWER"
exit_code=$?
set -e
check "DICOM input refusal" "$exit_code" "2"

banner "Governance demo — PHI scan, --strict-phi"
mkdir -p demo/tmp/phi/series_1
cp "demo/input/$WORSENING/series_1/"*.png demo/tmp/phi/series_1/
cat >demo/tmp/phi/patient_context.txt <<'PHIEOF'
Patient name: John Doe, DOB: 01/02/1960, MRN 123456
PHIEOF
echo "Wrote demo/tmp/phi/patient_context.txt with a synthetic PHI-shaped line."
echo "--strict-phi must refuse before anything is uploaded. Expected exit: 7."
pause
set +e
"${CLI[@]}" analyze demo/tmp/phi demo/output/govern-phi-strict --strict-phi --reviewer "$DEMO_REVIEWER"
exit_code=$?
set -e
check "PHI strict refusal (--strict-phi)" "$exit_code" "7"

banner "Governance demo — PHI scan, --allow-phi (masked warning)"
echo "Same input as above. --allow-phi acknowledges the finding and continues"
echo "(masked excerpt on stderr + recorded in run_manifest.json warnings[])."
echo "--max-cost-usd 0.0001 + --series series_1 + --concurrency 1 then caps the"
echo "run the same way as the cost-cap demo above, so the observed exit here is"
echo "asserted rather than assumed — see demo/README.md 'What did not behave as"
echo "documented' if this is not 5 on your run."
pause
set +e
"${CLI[@]}" analyze demo/tmp/phi demo/output/govern-phi-allow \
  --allow-phi --series series_1 --concurrency 1 --max-cost-usd 0.0001 --reviewer "$DEMO_REVIEWER" --verbose
exit_code=$?
set -e
check "PHI --allow-phi (masked warning, then cost cap)" "$exit_code" "5"

# ── (C) Fairness probe + governance probe over produced artefacts ──────────
banner "Fairness probe — E1 regression benchmark"
# Captured to a file rather than piped straight into `head`: the benchmark's
# own stdout writer does not handle EPIPE, so `| head -30` on a report longer
# than 30 lines crashes it (Node's default 'unhandled error' behaviour).
node_modules/.bin/tsx scripts/fairness-benchmark.ts \
  --out demo/tmp/E1-fairness-benchmark-results.md >demo/tmp/fairness-benchmark-full.txt 2>&1
head -30 demo/tmp/fairness-benchmark-full.txt

banner "Governance probe over this demo's artefacts"
node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts demo/output \
  --out demo/tmp/probe-results.json

# ── (D) Quality gate ─────────────────────────────────────────────────────
banner "Quality gate — npm test"
# The suite is offline and asserts the *default* provider contract (e.g.
# "no API key → exit 1"). This script has exported AI_PROVIDER/model vars and
# sourced .env, so the gate is run with the provider environment cleared —
# the same clean environment CI uses. Full output is kept in demo/tmp/.
set +o pipefail
set +e
env -u AI_PROVIDER -u OPENROUTER_API_KEY -u OPENROUTER_MODEL \
  -u GOOGLE_API_KEY -u GEMINI_API_KEY -u GEMINI_MODEL \
  npm test 2>&1 | tee demo/tmp/npm-test.log | tail -5
test_exit=${PIPESTATUS[0]}
set -e
set -o pipefail
check "npm test (quality gate)" "$test_exit" "0"

# ── Summary ──────────────────────────────────────────────────────────────
banner "Summary"
DEMO_END=$(date +%s)
echo "Wall-clock duration: $((DEMO_END - DEMO_START))s"
echo
for r in "${RESULTS[@]}"; do
  if [[ "$r" == PASS* ]]; then
    echo "  ${C_GREEN}${r}${C_RESET}"
  else
    echo "  ${C_RED}${r}${C_RESET}"
  fi
done
echo
echo "Passed: $PASS_COUNT   Failed: $FAIL_COUNT"
echo
echo "Provider-reported cost across every run that reached the model:"
sum_manifest_costs
echo
echo "Research/educational software — see docs/COMPLIANCE.md §0. Outputs are"
echo "AI-generated and experimental, not a diagnosis; clinician review required."

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
