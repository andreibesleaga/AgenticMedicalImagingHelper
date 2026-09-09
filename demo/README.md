# Conference demo pack

A self-contained, scripted demo of AgenticMedicalImagingHelper on two real
NIH ChestX-ray14 patients, built for the SIME 2026 paper #154 video (see
`/home/andrei/work/IEEE/SIME2026/camera-ready/DEMO-STRATEGY.md` §2 — demo 1
and demo 2). It runs the built CLI exactly as a user would; nothing here is
demo-only code inside `src/`.

⚠️ **Research/educational software, not a clinical tool.** Every output below
is AI-generated, experimental model output — not a diagnosis, not a clinical
recommendation. All findings must be reviewed by a qualified healthcare
professional. See [`../docs/COMPLIANCE.md` §0](../docs/COMPLIANCE.md).

## What this demo shows

1. **The golden path** — a normal run on a "worsening-like" and an
   "improving-like" patient (3 chronological studies each): the temporal
   evolution report, a compact view of the structured evolution JSON, the
   run manifest's cost/token totals, and `verify-manifest` passing.
2. **Governance controls, shown working, not described** — four
   demonstrations that each **fail on purpose** with a specific, asserted
   exit code: the client-side cost cap tripping, a DICOM file being refused,
   a PHI-shaped string in a context file being refused (`--strict-phi`), and
   the same PHI finding being acknowledged and masked (`--allow-phi`).
3. **The fairness-probe regression benchmark** (E1) and the **governance
   probe** that audits the artefacts this run just produced (disclaimer
   coverage, demographic-claim hits, progression label).
4. **The test suite**, run live, as a quality gate.

## Which patients, and why

Both patients come from `experiments/sime2026/E4L-cohort.md`, the 40-patient
stratified longitudinal cohort for paper #154, and both have exactly 3
studies (all frontal PA chest radiographs, 224-px NIH derivative):

| Role | Patient ID | Stratum | Sex / age at study 1 | Trajectory |
| --- | --- | --- | --- | --- |
| "worsening-like" | `00011264` | worsening-like | M / 40 | No Finding → No Finding → **Infiltration** |
| "improving-like" | `00003158` | improving-like | M / 8 | **Effusion** → No Finding → No Finding |

Selection criteria, applied on top of the cohort table: exactly 3 studies
(so the demo stays small and the narrative reads cleanly in a few seconds of
video), and a trajectory with a **single** finding change rather than a
multi-label jump — `00011264` gains exactly one new finding at the last
study; `00003158` clears its one finding by the second study. Several other
cohort members also qualify (e.g. `00002407`, `00007845` for worsening;
`00004946`, `00000049` for improving) — these two were picked first among
equally-valid candidates for the simplest single-finding story.

Total: 2 patients × 3 studies × 1 image = **6 images**, ~20 KB each (~130 KB
total). They are **not** committed: `demo/input/` is caught by the repository-wide `input/` rule in `.gitignore`, so you stage them yourself with `prepare-demo.sh` (below).

**Label-noise caveat** (inherited from the cohort, see
`experiments/sime2026/E4L-cohort.md`): ChestX-ray14 `Finding Labels` are
NLP-mined from radiology reports, not radiologist-adjudicated ground truth.
"Worsening-like" / "improving-like" describes the *report-derived* label
trajectory, not a verified clinical outcome.

## Prerequisites

- Node.js 20+, this repo built (`npm run build`, or let the script build it).
- An API key for the provider you'll use: `OPENROUTER_API_KEY` (default) or
  `GOOGLE_API_KEY` / `GEMINI_API_KEY`, in `.env` or exported.
- The showcase images already staged: `demo/input/00011264/` and
  `demo/input/00003158/` (gitignored — stage them yourself). To regenerate them from a
  local NIH ChestX-ray14 E4L preparation, run `demo/prepare-demo.sh`.

## How to run

```bash
# from the repository root
npm run demo
# equivalently:
bash demo/run-demo.sh
```

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_PROVIDER` | `openrouter` | `openrouter` or `google` |
| `DEMO_MODEL` | `google/gemini-2.5-flash` | model id (the `google/` prefix is stripped automatically when `DEMO_PROVIDER=google`) |
| `DEMO_REVIEWER` | `Demo Presenter` | `--reviewer` human-oversight attestation recorded in the manifest |
| `DEMO_PAUSE` | unset (no pauses) | set to `1` to pause for Enter between sections — useful when screen-recording |

```bash
# Google direct instead of OpenRouter
DEMO_PROVIDER=google DEMO_MODEL=gemini-2.5-flash npm run demo

# paced for a screen recording
DEMO_PAUSE=1 npm run demo
```

Output and scratch files land in `demo/output/` and `demo/tmp/`
(git-ignored — see `demo/.gitignore`); re-running the script deletes and
recreates both.

## Expected duration and cost

Measured on one live OpenRouter run (`google/gemini-2.5-flash`), see
[`SAMPLE-RUN.md`](./SAMPLE-RUN.md) for the full console output:

- **Duration:** ~2–3 minutes end to end, including `npm test`.
- **Cost:** a few cents total (provider-reported), across the two golden-path
  runs (3 images each) plus the two single-image governance calls. Exact
  figures are in the Summary section at the end of `SAMPLE-RUN.md` and in
  each run's `run_manifest.json`.

The DICOM refusal and `--strict-phi` demos are pre-flight rejections — no
model call, no cost, no output directory. The cost-cap and `--allow-phi`
demos are each restricted to one image (`--series series_1 --concurrency 1`)
specifically to keep the demo's cost bounded.

## Narration cues (for the video)

One sentence per banner the script prints, in order:

| Banner | Narration cue |
| --- | --- |
| Setup | "We're running the built CLI on real, de-identified NIH chest X-rays, provider-agnostic — OpenRouter or Gemini." |
| Golden path — worsening-like patient | "Three chronological studies, one patient — the pipeline fans out per image, aggregates per series, then compares series over time." |
| Golden path — improving-like patient | "Same pipeline, a patient whose finding clears over time — the progression label and the narrative should say so." |
| Governance demo — cost cap trip | "A client-side spending cap: it can only check cost *after* a call, so exactly one call is billed before the run aborts." |
| Governance demo — DICOM input refusal | "DICOM carries PHI in its tags and its pixels — the tool refuses it outright rather than silently converting it." |
| Governance demo — PHI scan, --strict-phi | "A PHI-shaped string in a context file, and strict mode refuses to upload anything at all." |
| Governance demo — PHI scan, --allow-phi | "The same finding, acknowledged instead of refused — masked in the warning, recorded in the manifest, never re-disclosed." |
| Fairness probe — E1 regression benchmark | "The same deterministic allocative-harm probe from the paper, run live as a regression guard." |
| Governance probe over this demo's artefacts | "Every artefact this run just produced, audited for the mandatory disclaimer and for demographic-anchored claims." |
| Quality gate — npm test | "And the test suite, run live, not just claimed in a badge." |
| Summary | "Every run — success or deliberate failure — left a hash-sealed, verifiable manifest. That's the audit trail." |

## What did not behave as documented

- **`--allow-phi` with a tiny `--max-cost-usd` still bills one real call.**
  The plan assumed "no real call completes" when combining `--allow-phi`
  with `--max-cost-usd 0.0001`. Reading `src/infrastructure/cost-meter.ts`
  shows the cap is checked *after* a call completes ("you cannot know a
  call's cost before making it") — so with `--allow-phi`, the PHI scan just
  warns and the pipeline proceeds to its first real model call, which is
  billed, *then* the cumulative-cost check throws and the run aborts before
  a second call. The script therefore restricts this demo to
  `--series series_1 --concurrency 1` (one image only) and asserts the
  **observed** exit code rather than assuming zero calls happened — see the
  Summary in `SAMPLE-RUN.md` for what that run actually recorded.
- Everything else (exit codes 5 for the cost cap, 2 for DICOM, 7 for
  `--strict-phi`, 0 for the golden path and `verify-manifest`, and the
  layout `demo/output/<patient>/output/…` that
  `experiments/sime2026/probe-outputs.ts` expects) matched the design as
  written — see `SAMPLE-RUN.md` for the live run that confirmed it.
