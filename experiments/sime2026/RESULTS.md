# SIME 2026 — results and reproduction (paper #154)

**What this file is.** The single findings document for the SIME 2026 experiment pack: every
result we have, what it does and does not support, and the exact commands to reproduce it.
No number here is restated from memory or from another prose document — each one names the
tracked artefact it was read from, and every artefact named lives in this directory, in
[`docs/`](../../docs/) or in [`src/`](../../src/) unless the text says otherwise.

**Status: 2026-09-09 — FINAL.** All numbers below come from the final experiment build
(`.sime-dist/BUILD-STAMP.txt`: `final build frozen
2026-09-08T18:58:16Z`) and the final batch recorded in [`results.jsonl`](results.jsonl):
**62 rows, 61 exiting 0**, dated `2026-09-08T12:53:32Z` → `2026-09-09T08:04:35Z`. The 62nd row is
a deliberate quota-failure run, kept as failure-path evidence (§7). Nothing in this file is a
clinical claim.

**Two analysis-tooling defects were fixed on 2026-09-09** and the affected reports regenerated;
[`probe-results.md`](probe-results.md) and [`E5-label-agreement.md`](E5-label-agreement.md) below
are the post-fix versions. Both fixes, and what they changed, are recorded in §13.

**Paper numbers.** Do not copy numbers from here into the paper by hand.
[`fill-numbers.ts`](fill-numbers.ts) derives every macro from these same artefacts and prints the
source of each one:

```bash
node_modules/.bin/tsx experiments/sime2026/fill-numbers.ts \
  --template <paper-dir>/numbers.tex \
  --out <paper-dir>/numbers-generated.tex
```

`--template` is **required**: the LaTeX macro template (`numbers.tex`) lives next to the paper
source, outside this repository, so the script has no portable default and exits 1 without it. It
reads the template and never writes to it; `--out` gets the filled copy.

---

## 0. Scope and honesty statement

This is a **research and educational** software artefact. It is not a medical device, has no
regulatory clearance, was never evaluated by a clinician, and must not be used for diagnosis,
triage, screening or treatment. Every generated Markdown artefact carries a human-review gate and
every generated record carries the disclaimer (§11); that is a governance property, not a licence
to act on the output.

What is measured, and what is not:

1. **Descriptive agreement, never accuracy.** The cohorts measure whether the _direction of a
   narrative_ (Improving / Stable / Worsening) and the _free-text findings_ are consistent with a
   reference label trajectory. That is not sensitivity, specificity or diagnostic performance, and
   none of it may be reported as such ([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §0.6;
   [`E5-label-agreement.md`](E5-label-agreement.md), "Method and honest caveats").
2. **The reference labels are not ground truth.** NIH ChestX-ray14 "Finding Labels" were NLP-mined
   from free-text reports (DNorm/NegBio) at roughly **~90 % accuracy** (Wang et al., CVPR 2017);
   they are noisy and were never intended as a per-image gold standard
   ([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §0.1; [`E4L-cohort.md`](E4L-cohort.md) line 70).
3. **The images are below diagnostic resolution.** Every input is a **224 × 224** 8-bit PNG
   (median 21,864 bytes on disk, [`full-dataset-scan.md`](full-dataset-scan.md)). Clinical chest
   radiographs are ~2000 × 2000 at 12–16 bits. Fibrosis, infiltration, emphysema, small nodules
   and thin pneumothorax lines are physically absent from these pixels; under-calls are expected
   and are a property of the data, not of the model
   ([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §0.2).
4. **No clinical history.** `patient_context.txt` carries modality, view, cohort provenance, age at
   first study and sex — no symptoms, no indication, no priors, no reports
   ([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §0.3).
5. **Single frontal view per session**, no lateral, no windowing, no prior comparison.
6. **Small n, no adjudication.** E4 = 8 patients × 31 sessions × 4 models; E4L-20 = 20 patients,
   one model. No clinician read any image or any output.
7. **The probes are heuristics with measured blind spots**, not detectors. E1 (§3) reports the
   fairness probe's own recall of 0.436 on a labelled benchmark; it is a regression guard for one
   explicit failure mode.

Providers, models, prices and dates:

| Item                             | Value                                                                                                               | Source                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Route for all reported live runs | **OpenRouter** (`AI_PROVIDER=openrouter`)                                                                           | [`run.sh`](run.sh), `batch-resume.sh`                    |
| Models                           | `google/gemini-2.5-flash`, `google/gemma-4-31b-it`, `qwen/qwen3-vl-235b-a22b-instruct`, `anthropic/claude-sonnet-5` | `batch-resume.sh`, `provider`/`model` in `results.jsonl` |
| Google-direct control            | `gemini-2.5-flash`, `E2_SIZES="S2x5"` only                                                                          | `batch-resume.sh`                                        |
| Figure quoted everywhere below   | **`provider_usd`** / `totals.providerUsd` (the provider's own `usage.cost`)                                         | `runs/<id>/output/run_manifest.json`                     |
| Build                            | `final build frozen 2026-09-08T18:58:16Z`                                                                           | `.sime-dist/BUILD-STAMP.txt` — the authors' frozen build directory, gitignored and **not** in a clone; quoted here so the batch has a dated provenance line, not as something a reader can open |
| Dates                            | 2026-09-08T12:53:32Z → 2026-09-09T08:04:35Z                                                                         | [`results.jsonl`](results.jsonl)                         |

**Never quote `usd` (the built-in estimate) for the open-weight routes.** Reconciled against the
per-run manifests' `totals.providerUsd`, the estimator overstates **gemma by 22.5×** ($0.303626
estimated vs $0.013494 charged) and **qwen by 9.6×** ($0.211528 vs $0.021984); it is accurate for
gemini-via-OpenRouter (1.0 %: $0.674415 vs $0.667671) and 17.5 % high for claude ($1.057460 vs
$0.899898). Sums over the 61 committed `run_manifest.json` files.

---

## 1. Software quality

Caveat first: a green suite says the pipeline behaves as specified offline. It says nothing about
clinical validity, and the experiment scripts it covers are tested against synthetic fixtures, not
against the live batch.

Source: `npm run test:coverage` on the local tree, 2026-09-09, Node 22.

| Metric               | Value                 | Note                                                                   |
| -------------------- | --------------------- | ---------------------------------------------------------------------- |
| Test suites          | **34**                | all green                                                              |
| Tests                | **814**               | 4 snapshots                                                            |
| Statements / lines   | **99.18 % / 99.18 %** | threshold 97 / 97 in [`jest.config.js`](../../jest.config.js)          |
| Branches / functions | **98.78 % / 98.25 %** | threshold 92 / 94                                                      |
| Live tests           | opt-in only           | [`tests/live/`](../../tests/live/) runs only under `npm run test:live` |

```bash
npm run typecheck && npm run lint && npm run build
npm test                 # 34 suites, 814 tests, offline, no API key
npm run test:coverage
npm run format:check
```

The experiment scripts are covered by the same suite, not treated as throwaway code:
[`tests/unit/experiments/probe-outputs.test.ts`](../../tests/unit/experiments/probe-outputs.test.ts),
[`tests/unit/experiments/label-agreement.test.ts`](../../tests/unit/experiments/label-agreement.test.ts)
and [`tests/unit/experiments/fill-numbers.test.ts`](../../tests/unit/experiments/fill-numbers.test.ts)
all run against offline fixtures.

---

## 2. Experiment inventory

Nine experiments. "Committed artefact" is the file a reader can open; where there is none, the row
says so.

| #   | Experiment                             | What it measures                                                               | Cost | Committed artefact                                                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Fairness-probe labelled benchmark      | The allocative-harm probe's own precision/recall on 110 labelled items         | free | [`E1-fairness-benchmark-results.md`](E1-fairness-benchmark-results.md)                                                              |
| —   | Full-dataset offline scan              | Scanner + sharp + CSV join over all 112,120 images; no model call              | free | [`full-dataset-scan.md`](full-dataset-scan.md)                                                                                      |
| —   | Scanner stress                         | Scanner behaviour on 500-patient and 5,000-image-in-one-series trees           | free | **none — not run** (§5)                                                                                                             |
| E3  | Request-payload policy                 | Bytes and estimated image tokens sent, per image-policy decision               | free | [`E3-payload-e4-224px.md`](E3-payload-e4-224px.md), [`E3-payload-large-study.md`](E3-payload-large-study.md)                        |
| E2  | Operational scaling                    | Wall time and calls at 4 sizes × 2 concurrencies, plus a Google-direct control | paid | [`results.jsonl`](results.jsonl) E2 rows + `runs/E2-*/output/run_manifest.json`                                                     |
| E4  | Longitudinal cohort, 8 pat. × 4 models | Direction agreement and narrative quality across four models, same inputs      | paid | [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §b/§d/§g, [`qualitative-agreement.json`](qualitative-agreement.json)               |
| E4L | Stratified longitudinal, 20 pat.       | Whether the E4 result survives on a disjoint, pre-stratified cohort            | paid | [`E4L-cohort.md`](E4L-cohort.md), [`E4L20-patients.json`](E4L20-patients.json), [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §c |
| E5  | Label agreement                        | Mechanical agreement of free text and direction labels with the NIH labels     | free | [`E5-label-agreement.md`](E5-label-agreement.md) / [`.json`](E5-label-agreement.json)                                               |
| —   | Governance probe                       | Disclaimer, demographic anchoring, schema failures, context contradictions     | free | [`probe-results.md`](probe-results.md) / [`.json`](probe-results.json)                                                              |

Cohort definitions are in [`nih-selection.json`](nih-selection.json): **E4** 8 patients / 31
studies, **E4L** 40 patients / 145 studies (of which 20 patients / 72 studies were executed, see
§9), **E2** a flat pool of 80 single-image records.

**What is tracked, and what is not.** The 62 run directories under `experiments/sime2026/runs/`
**are committed** — all 863 per-run evidence files, 3.1 MB: the 61 `run_manifest.json`, and every
`combined_diagnostic_report.md`, `evolution_analysis.json`, `series_summary.md` and per-image
`*_analysis.json`. So are [`results.jsonl`](results.jsonl) and `batch-resume.sh`, the orchestration
script §15.2 quotes. **Ignored** are only the raw console transcripts `stdout.txt` and `stderr.txt`
(124 files) — every figure drawn from them is already in the manifests and reports above, and they
carry one machine's absolute paths and wall-clock noise — plus `experiments/sime2026/*.csv`,
`*.csv.gz`, `experiments/sime2026/batch-resume.log` and `.sime-dist/` (the frozen build), which are
bulky or regenerable. Ignored paths are named as plain code spans rather than links, deliberately;
everything this file links to is committed, and so is every file under `runs/` that is not a
`stdout.txt` or a `stderr.txt`.

---

## 3. E1 — fairness-probe labelled benchmark

**Caveat first.** This measures **the probe**, not a model and not the pipeline. It makes no
allocative-harm claim about any model ([`src/domain/fairness.ts`](../../src/domain/fairness.ts)
line 56 says so in the source). It is offline and free.

Source: [`E1-fairness-benchmark-results.md`](E1-fairness-benchmark-results.md) (dated
`2026-09-08`), over the 110 labelled items in
[`tests/fixtures/fairness-benchmark.json`](../../tests/fixtures/fairness-benchmark.json), run by
[`scripts/fairness-benchmark.ts`](../../scripts/fairness-benchmark.ts).

| Category    | Expected | n       | TP     | FP     | TN     | FN     | Category rate |
| ----------- | -------- | ------- | ------ | ------ | ------ | ------ | ------------- |
| explicit    | true     | 20      | 20     | 0      | 0      | 0      | recall 1.000  |
| paraphrase  | true     | 20      | 4      | 0      | 0      | 16     | recall 0.200  |
| implicit    | true     | 15      | 0      | 0      | 0      | 15     | recall 0.000  |
| benign      | false    | 20      | 0      | 0      | 20     | 0      | FP rate 0.000 |
| negation    | false    | 15      | 0      | 8      | 7      | 0      | FP rate 0.533 |
| trap        | false    | 20      | 0      | 12     | 8      | 0      | FP rate 0.600 |
| **overall** | —        | **110** | **24** | **20** | **35** | **31** | —             |

Overall: **precision 0.545, recall 0.436, F1 0.485, specificity 0.636, accuracy 0.536** (55
positives, 55 negatives). The report enumerates all 31 false negatives and all 20 false positives
by id.

What that means, in the report's own words: explicit anchoring with a listed token and a listed
justifier is caught 20/20; paraphrased anchoring is missed 16/20; implicit/proxy reasoning is
missed 15/15; 25 of the 31 false negatives contain no listed token at all. The report's conclusion
is the honest one — the probe is _"a conservative regression guard for the explicit failure mode it
was designed for, not a general detector of demographic reasoning."_

**Do not read the batch-wide "0 anchored claims" of §11 as "no bias".** It means the probe found
none of the pattern it can find, on a probe whose recall is 0.436 against paraphrase and 0.000
against implicit reasoning.

---

## 4. Full-dataset offline scan

**Caveat first.** This exercises **the file scanner + sharp preprocessing + CSV metadata join
only.** No model call is made anywhere in the script; it is a deterministic offline pass.

Source: [`full-dataset-scan.md`](full-dataset-scan.md), produced by
[`full-dataset-scan.ts`](full-dataset-scan.ts).

| Metric                             | Value                                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| Images found / with metadata match | **112,120 / 112,120**                                           |
| Errors                             | **0**                                                           |
| Workers                            | 8                                                               |
| Scan wall time                     | **453.19 s** (455.27 s including CSV I/O)                       |
| Throughput                         | **247.4 images/s**                                              |
| Dimensions                         | 224 × 224 at min, median, p95 and max — the archive is uniform  |
| Bytes on disk (min/med/p95/max)    | 5,226 / 21,864 / 24,212 / 34,157                                |
| Bytes after preprocessing          | 6,147 / 50,872 / 58,730 / 75,257                                |
| Unique patients                    | **30,805** (17,503 of them with a single study)                 |
| Label mix                          | `No Finding` **60,412 (53.88 %)**; multi-label 20,735 (18.49 %) |

**The headline is a negative result, and it is reported as one.** Preprocessing _increased_ total
bytes by **+131.06 %** (2,418,547,683 B → 5,588,200,613 B), because the public archive is already
downscaled to ~224 px, so `resize(1024, 1024, { fit: "inside", withoutEnlargement: true })` is a
no-op and the PNG re-encode is pure overhead. The report states plainly that the task's
"≈ 0 %-or-negative expectation does NOT hold for this specific low-resolution, pre-compressed
archive". This is the measurement that motivated the model-aware pre-flight of §6 and
[ADR-003](../../docs/architecture/decisions/ADR-003-image-preprocessing.md).

The per-image CSV the script also writes (`full-dataset-scan.csv`, 7,947,702 B) is **not
committed** — it is a derived index of a public dataset, regenerable in ~455 s.

---

## 5. Scanner stress — not run, no numbers

**Caveat first, and it is the whole section: there are no scanner-stress results.**
[`scanner-stress.ts`](scanner-stress.ts) exists and is offline and free, but it prints to stdout
and no output file has ever been committed. Its own source declares the two trees it builds:
`TOP_N_PATIENTS = 500` (the 500 patients with the most studies, one image per series) and
`SINGLE_SERIES_IMAGE_COUNT = 5000` (one series folder holding 5,000 images).

No figure from this experiment may be quoted anywhere until it is run to a file:

```bash
node_modules/.bin/tsx experiments/sime2026/scanner-stress.ts | tee experiments/sime2026/scanner-stress.md
```

---

## 6. E3 — request-payload policy (model-aware image pre-flight)

**Caveat first**, quoted from the artefact: _"This measures bytes and estimates tokens; it does not
measure diagnosis. It is not evidence that a resized image supports the same diagnosis as the
original."_ Establishing that would need a reader study against ground truth, which is out of scope.

Both runs use `preparePayload()` from
[`src/infrastructure/image-policy.ts`](../../src/infrastructure/image-policy.ts) with
`IMAGE_QUALITY=auto`, long-edge target 1536 px, tile-aligned to 768 px, for `google` /
`gemini-2.5-flash`.

| Measurement                                 | Real E4 inputs (224 px)                            | Synthetic large plates                                   |
| ------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| Artefact                                    | [`E3-payload-e4-224px.md`](E3-payload-e4-224px.md) | [`E3-payload-large-study.md`](E3-payload-large-study.md) |
| Images                                      | 31                                                 | 3                                                        |
| Policy actions                              | **30 passthrough, 1 re-encoded**                   | **3 resized**                                            |
| Bytes on disk → bytes sent                  | 684,548 → 678,332                                  | 45,551,868 → 6,066,209                                   |
| Reduction                                   | **0.9 %**                                          | **86.7 %**                                               |
| Base64 characters in the request body       | 904,492                                            | 8,088,284                                                |
| Estimated image tokens sent                 | **7,998**                                          | **3,096**                                                |
| Estimated image tokens at native resolution | **7,998**                                          | **3,096**                                                |

Two findings, both in the artefacts:

1. **Token cost is unchanged in both directions.** On the Gemini path the tile count derives from
   `floor(min(w, h) / 1.5)`, so above the 384-px flat-rate threshold the cost depends on aspect
   ratio alone, not resolution: _"On that path the pre-flight buys bytes and latency, not tokens."_
2. **The floor is now 0 %, not a penalty.** The old unconditional `resize(1024).png()` made small
   pre-compressed inputs _larger_ (§4's +131 %). The current policy detects that and forwards the
   original bytes untouched (`action: passthrough`). The single re-encode in the E4 set,
   `00000086/series_2/00000086_001.png`, saved 22.1 % (27.5 KiB → 21.4 KiB) at unchanged
   dimensions.

The large-study inputs are **synthetic** (8-bit greyscale gradient plus seeded noise at
2500 × 2500, 3000 × 2500 and 4000 × 4000): _"they are not radiographs and carry no anatomy; only
their compressibility is meant to be representative."_

---

## 7. E2 — operational scaling

**Caveat first.** Wall time here is dominated by provider rate limiting and network latency, not by
the pipeline's own work. These are 10 single runs, not a benchmark with repeats and confidence
intervals; treat the speedups as an order-of-magnitude property of the fan-out, nothing finer.

Source: the 10 `E2-*` rows of [`results.jsonl`](results.jsonl) and the 9 corresponding
`runs/E2-*/output/run_manifest.json` files. Sizes are `S<sessions>x<images-per-session>`.

| Size   | c1 wall | c5 wall | Speedup   | Calls |
| ------ | ------- | ------- | --------- | ----- |
| 1 × 1  | 7.6 s   | 4.8 s   | **1.58×** | 2     |
| 2 × 5  | 53.5 s  | 30.0 s  | **1.78×** | 13    |
| 3 × 10 | 152.1 s | 54.9 s  | **2.77×** | 34    |
| 4 × 20 | 361.4 s | 114.2 s | **3.16×** | 85    |

The call-count structure holds exactly at every size: **calls = images + sessions, plus one
evolution call once a study has ≥ 2 sessions** (2, 13, 34, 85 — the 1 × 1 run makes no evolution
call). E2 totals across the 10 rows: 262 images, 279 calls, 54 retries, and
$0.3693 `provider_usd` over the 8 OpenRouter rows (the Google-direct endpoint reports no cost). All 8 OpenRouter E2 runs exited 0 with zero failed images.

**The Google-direct control is the interesting row, and it is a negative result.**

- `E2-S2x5-c1-google-gemini-2.5-flash` **succeeded** (exit 0, 10/10 images) but took **316.5 s
  against 53.5 s for the byte-identical OpenRouter run — 5.9× slower — with 14 retries vs 0.**
- `E2-S2x5-c5-google-gemini-2.5-flash` is **the batch's only non-zero exit** (code 4): 39 retries,
  0 calls, **0 success / 10 failed**, 241.0 s. Its
  `runs/E2-S2x5-c5-google-gemini-2.5-flash/output/combined_diagnostic_report.md` preserves the
  provider's verbatim body: `[429 Too Many Requests] … Quota exceeded for metric:
generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20`. It wrote **no
  `run_manifest.json`** because nothing completed, and it is the only report in the batch with no
  treatment content and no human-review banner — correct degradation, retained on purpose.
- 53 of the batch's 62 retries (85 %) are on those two Google-direct rows.

Quota, not price, is why the reported runs go through OpenRouter. The second recorded reason is
[`evidence/gemini-2.5-pro-404.txt`](evidence/gemini-2.5-pro-404.txt): the submission-time default
model was retired mid-project (`[404 Not Found] This model models/gemini-2.5-pro is no longer
available to new users`, 2026-09-08T18:42:38Z).

---

## 8. E4 — longitudinal cohort, 8 patients × 4 models

**Caveat first.** n = 8 patients, 31 imaging sessions per model, no clinician adjudication, noisy
labels, one 224-px frontal view per session. The "agree" columns are _descriptive-direction
agreement_, not accuracy — and a direction label can be right for fabricated reasons (failure case
F1 below). Read [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §e before quoting any cell.

**Scale and cost** (32 runs, 124 image analyses, 344 artefacts;
`run_manifest.json` → `totals.providerUsd`, per
[`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §g.3):

| Model                            | Mean USD / patient | min      | max      | Cohort total |
| -------------------------------- | ------------------ | -------- | -------- | ------------ |
| anthropic/claude-sonnet-5        | **$0.11249**       | $0.07145 | $0.18039 | $0.8999      |
| google/gemini-2.5-flash          | **$0.01166**       | $0.00784 | $0.01682 | $0.0933      |
| qwen/qwen3-vl-235b-a22b-instruct | **$0.00275**       | $0.00183 | $0.00480 | $0.0220      |
| google/gemma-4-31b-it            | **$0.00169**       | $0.00071 | $0.00277 | $0.0135      |

E4 total **$1.02865**; with E4L (§9) the two longitudinal cohorts — 52 runs, 103 imaging
sessions — cost **$1.23375** (exact sums over the 52 manifests; the per-model column above is
rounded to 4 dp and adds to $1.0287, which is the figure
[`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §g.3 quotes). claude is 9.6× gemini, 41× qwen and
67× gemma per patient.

**Human-adjudicated direction agreement** ([`qualitative-agreement.json`](qualitative-agreement.json),
transcribed in [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §d; `partial` is a human category
the mechanical E5 score has no equivalent for):

| Model                            | agree | partial | disagree | no call | **agree** | **agree + partial** |
| -------------------------------- | ----- | ------- | -------- | ------- | --------- | ------------------- |
| google/gemini-2.5-flash          | 3     | 4       | 1        | 0       | **3/8**   | **7/8**             |
| google/gemma-4-31b-it            | 0     | 0       | 2        | 6       | **0/8**   | **0/8**             |
| qwen/qwen3-vl-235b-a22b-instruct | 0     | 6       | 2        | 0       | **0/8**   | **6/8**             |
| anthropic/claude-sonnet-5        | 2     | 3       | 2        | 1       | **2/8**   | **5/8**             |
| **E4 total (32 judgements)**     | **5** | **13**  | **7**    | **7**   | 5/32      | 18/32               |

**The strongest E4 result is about disagreement, not agreement.** Across the four models the eight
patients drew **1 unanimous verdict, and 3+ distinct verdicts on 5 of 8** patients; on 00000008 all
four models returned a different `progression` ([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md)
§g.1). Any deployment reporting a progression label without naming the model is reporting noise.

**Verbosity differs by an order of magnitude and is invisible to any direction score**
([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §g.2): findings per session run
claude **7.0** · gemini 5.6 · gemma 2.9 · qwen **0.6**, and qwen returned an empty `findings[]` in
**27 of 31** sessions while having the batch's best validation record (0 failures). Schema validity
and informational content are orthogonal.

**Named cases**, all reproduced against the final build:

- **F1 — fabrication, 00000086 / gemini, series_2.** A fabricated 4 cm cavitary lesion at 95 %
  stated confidence with a TB differential. It **passed schema validation** and its direction label
  is scored `agree`. Detail in [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §e.
- **F2 — invented demographics, 00000008 / claude-sonnet-5.** A 69-year-old woman described as an
  infant with a normal thymic shadow. Now machine-detected: the run's `run_manifest.json` is the
  only one in the batch with a non-empty `warnings[]` (a context-consistency summary plus 5 `[age]`
  findings — `neonatal`, `infant`, `infants`, `child`, `pediatric`), and it is the only run the
  governance probe flags (§11). The probe's own count is **6 artefacts**, a different unit: the
  manifest records distinct terms found in the pipeline's own collected narrative, the probe
  records how many files carry at least one contradiction.
- Two 2026-09-08 failures (fabricated dextrocardia; an implanted defibrillator) **did not
  reproduce** on the final build.

---

## 9. E4L-20 — stratified longitudinal cohort

**Caveat first, twice over.** (i) [`E4L-cohort.md`](E4L-cohort.md) _defines_ 40 patients / 145
studies; **only 20 patients / 72 studies were executed**
([`E4L20-patients.json`](E4L20-patients.json), and 72 sessions in the E4L rows of
[`results.jsonl`](results.jsonl)). The executed 20 are **12 M / 8 F**, not the 5 M / 5 F per
stratum the 40-patient design achieves — quote the executed composition, never the designed one.
(ii) The strata are derived from the same NLP-mined labels as everything else, so a stratum is a
label trajectory, not a clinical course.

One model (`google/gemini-2.5-flash`), 20 runs, 204 artefacts, **$0.20510** total, mean
**$0.01025 per patient** — within 14 % of the same model's E4 mean, a useful sanity check that per-patient
cost tracks session count rather than cohort.

Human adjudication per stratum, 5 patients each
([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §c):

| Stratum          | agree | partial | disagree | no call | **agree** | **agree + partial** |
| ---------------- | ----- | ------- | -------- | ------- | --------- | ------------------- |
| worsening-like   | 0     | 1       | 4        | 0       | **0/5**   | 1/5                 |
| improving-like   | 2     | 2       | 1        | 0       | **2/5**   | 4/5                 |
| stable-pathology | 3     | 0       | 2        | 0       | **3/5**   | 3/5                 |
| stable-normal    | 3     | 1       | 0        | 1       | **3/5**   | 4/5                 |
| **E4L total**    | **8** | **4**   | **7**    | **1**   | **8/20**  | **12/20**           |

**This is the result the paper should lead with, and it is a limitation, not a capability.** The
model is usable on stable trajectories (6/10 agree) and improving ones (2/5), and on the stratum
built to test progression tracking — `worsening-like` — it scored **0/5 agree** by human
adjudication. Four of the five are the same failure: a `No Finding → Infiltration`-class transition
that is physically unresolvable at 224 px, so three normal chests are read as `Stable`. That is
caveat §0.3 made visible.

> The mechanical E5 score (§10) puts E4L `worsening-like` at **1/5** rather than 0/5, because it
> credits 00016493's `Worsening` — which the human review scored `partial`, since the direction is
> driven by a real radiopaque disc rather than the labelled effusion. The two views differ on that
> one case by design; see §10 and [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §h.

The E4 result was not a fluke: gemini scored 3/8 agree (7/8 agree + partial) on E4 and 8/20 (12/20)
on a disjoint, pre-stratified cohort.

---

## 10. E5 — label agreement (mechanical)

**Caveat first**, from the report's own "Method and honest caveats": the NIH labels are NLP-mined
(~90 % accurate), the images are 224 px, and `CLASS_SYNONYMS` is a heuristic negation-aware text
matcher, not a validated NLP labeller. _"Do not report F1/precision/recall figures as
sensitivity/specificity"_. Differences **between** models are internally comparable (same mapper,
same labels, same images) even where the absolute numbers are not trustworthy in isolation.

Source: [`E5-label-agreement.md`](E5-label-agreement.md) and
[`E5-label-agreement.json`](E5-label-agreement.json), regenerated 2026-09-09 over all 62 run
directories (0 skipped): **458 per-image rows** (435 `ok`, 13 `invalid`, 10 `error`) and **52
direction rows**, of which **52 are now scorable** (§13 explains why that number changed).

**Per-image agreement**, all rows with matched ground truth:

| Model (provider/model)                      | usable / total | Exact-set match  | Mean Jaccard |
| ------------------------------------------- | -------------- | ---------------- | ------------ |
| openrouter/google/gemini-2.5-flash          | 345 / 345      | **48.4 %** (167) | 0.505        |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | 31 / 31        | **45.2 %** (14)  | 0.452        |
| openrouter/google/gemma-4-31b-it            | 18 / 31        | **38.9 %** (7)   | 0.444        |
| openrouter/anthropic/claude-sonnet-5        | 31 / 31        | **25.8 %** (8)   | 0.271        |
| google/gemini-2.5-flash (direct control)    | 10 / 20        | 50.0 % (5)       | 0.500        |

These four numbers must be read against §8's verbosity table, not on their own: qwen's 45.2 % is
largely the arithmetic of returning empty findings on a cohort where `No Finding` is the most
common label, and claude's 25.8 % is the cost of being the only model that always says something.
gemma's 18 usable rows are what remains after 13 of its 31 image records failed validation. Per-class
precision/recall/F1 tables — including the degenerate macro averages that arise when a model
predicts almost no classes — are in [`E5-label-agreement.md`](E5-label-agreement.md) rather than
restated here.

**Direction agreement** (E4 + E4L, 52 rows, all scorable):

| Model                                       | Patients | Agreement rate  | of which recovered |
| ------------------------------------------- | -------- | --------------- | ------------------ |
| openrouter/google/gemini-2.5-flash          | 28       | **42.9 %** (12) | 5                  |
| openrouter/anthropic/claude-sonnet-5        | 8        | **37.5 %** (3)  | 1                  |
| openrouter/google/gemma-4-31b-it            | 8        | **25.0 %** (2)  | 0                  |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | 8        | **25.0 %** (2)  | 0                  |
| **all models**                              | **52**   | **36.5 %** (19) | **6**              |

"Recovered" counts rows whose evolution record failed Zod validation on a sibling field while its
top-level `progression` was a clean enum value taken from the response's own partial JSON. Those
rows are scored normally and flagged `recovered` in the per-patient table; see §13.

Per direction bucket, gemini across both cohorts: `stable-pathology` **0.600**, `worsening`
**0.429**, `stable-normal` **0.429**, `improving` **0.375**, `mixed-pathology-change` 0.000. On
E4L alone the ordering is the one §9 describes: `stable-normal` 3/5, `stable-pathology` 3/5,
`improving` 2/5, `worsening` **1/5**.

**The mechanical and adjudicated views differ, and both are needed.** E5 has no `partial` category,
treats `Inconclusive` as scorable, and cannot see _why_ a direction matched — its `agree` for
00000086/gemini and this review's are the same cell, but only
[`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §e records that the justification is a fabricated
cavity. Neither number should ever be quoted without the other.

---

## 11. Governance audit

**Caveat first.** These are properties of the _system_, not of the model: an artefact carrying a
disclaimer says nothing about whether its content is true (§12b). And a probe reporting zero says
only that it found none of what it can find (§3).

Source: [`probe-results.md`](probe-results.md) / [`probe-results.json`](probe-results.json),
regenerated 2026-09-09 over all 62 run directories, plus the 61 committed `run_manifest.json`
files.

| Metric                                          | Value                                                          |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Runs audited                                    | **62** (61 exit 0)                                             |
| Artefacts audited                               | **863**                                                        |
| Artefacts carrying the mandatory disclaimer     | **802** — 100 % of content artefacts                           |
| Files without it                                | **61**, all of them `run_manifest.json` (provenance, no prose) |
| Demographic-token hits / anchored claims        | **0 / 0**                                                      |
| Context contradictions                          | **6**, all in one run (§13)                                    |
| Schema-validation failures                      | **19**                                                         |
| Images succeeded / failed across 61 exit-0 runs | **448 / 0**                                                    |

**Integrity.** All 61 manifests record `manifestVersion: "1.0"`, `exitCode: 0` and a
`manifestHash`, over 448 hashed inputs, 61 hashed context files and 788 hashed outputs.
`verify-manifest` was run on a 6-run sample spanning all four models and both cohorts and exited 0
on every one, passing all five integrity checks — and reported the same sixth line on every one:
`[SKIP] human review: no reviewer attestation recorded (review is still required)`. That is the
accurate state of every artefact in this batch
([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §f.7).

**Schema-validation failures, 19.** 13 of them are `google/gemma-4-31b-it` at the image stage —
42 % of its 31 image records, spread across **7 of its 8 runs** (only `E4-00000219` is clean); all
of gemma's evolution records validate. In three of those runs — `00000067`, `00000086` and
`00000148` — fewer than half the sessions survived validation, which is why §8 scores them
`no call`; gemma's other three `no call` verdicts (`00000008`, `00000092`, `00000296`) are the
model answering `Inconclusive`, not a usability failure.

The other 6 failures are evolution records, all the same defect: a fifth value in
`trends[].trend`, whose enum is `"Improving" | "Stable" | "Worsening"`. In all six the top-level
`progression` was itself valid and the pipeline's fallback took it verbatim, recording
`progression: taken from partial JSON ("…")` in `validation.issues`. The cost is that `trends[]`,
`forecastedEvolution` and `treatmentRecommendations[]` are emitted empty in those six runs; the
narrative survives in `combinedReport`. A validation failure never aborted a run.

**Context contradictions, 6, all in `E4-00000008-openrouter-anthropic_claude-sonnet-5`** — failure
case F2, a 69-year-old woman described as an infant, across 6 of that run's artefacts (terms
`infant`, `infants`, `child`, `pediatric`, `neonatal`). Every other run in the batch scores 0.
**Every one of these arises at a stage where the model was never told the age or the sex** — see
§12a.

**Labelling and human review.** 61 of 61 successful runs render treatment content under the
pipeline's own heading `## Treatment Suggestions (experimental — not clinical recommendations)`
and open with the four-line human-review banner; 34 additionally show a model-authored heading
demoted to `#### … (model text — experimental, not clinical recommendations)`. The only report
without either is the quota-failure run of §7, which produced no treatment content at all
([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §f.6).

---

## 12. Known limitations of the tooling

These are limitations of **this pack's own code and provenance**, distinct from the data caveats in
§0. They are recorded rather than hidden, and none of them is fixed by anything above.

### (a) Per-image and per-series prompts never receive `patient_context.txt`

Verified in [`src/infrastructure/gemini-client.ts`](../../src/infrastructure/gemini-client.ts):
`analyzeImage(imagePath, seriesId)` (line 337, interface line 192) takes **no context argument**,
and `synthesizeSeries` (line 414, interface line 193) takes none either. Only
`analyzeEvolution(summaries, rootContext)` (line 481, interface line 198) threads the operator's
text, into `buildEvolutionPrompt` (line 100), which wraps it as
`<context source="user-provided context">`.

The consequence is architectural, not a prompting mistake: an invented-demographics failure like F2
**necessarily occurs at the per-image stage**, where the model has never been told the patient's age
or sex, and can only be caught after the fact by the context-consistency probe. Every one of the 6
contradictions in §11 is of that shape.

**This is listed as future work and is deliberately not fixed here.** Threading the context into the
image and series prompts would change what every model was asked, invalidating the frozen batch;
it is a change for the next build, together with a re-run.

### (b) Schema validation is structural, not factual

The pipeline validates every model response against a Zod schema and records the outcome per
artefact. That guarantees shape, not truth. **The single most dangerous output in the batch — F1's
fabricated 4 cm cavitary lesion at 95 % stated confidence with a TB differential (00000086 /
gemini, series_2) — passed validation cleanly**, and its run's direction label is scored `agree` by
E5. qwen makes the converse point: the batch's best validation record (0 failures) belongs to the
model that returned an empty `findings[]` in 27 of 31 sessions. Any claim that validation makes
output trustworthy is false, and this pack contains the counter-example.

### (c) Manifest `toolVersion` provenance: one binary, two version strings

**17 of the 61 manifests record `toolVersion: 1.0.0` and 44 record `1.1.0`, while all 62 report
footers say `v1.0.0`.** This looks like two builds in one batch. It is not.

- Every run was produced by the same frozen binary,
  `.sime-dist/BUILD-STAMP.txt` → `final build frozen
2026-09-08T18:58:16Z`.
- The manifest writer reads `version` from the repository's
  [`package.json`](../../package.json) **at run time**, and that file was bumped 1.0.0 → 1.1.0
  between the 2026-09-08 evening runs and the 2026-09-09 morning runs. The 1.0.0/1.1.0 split is
  therefore a clock, not a build boundary (1.0.0: 6 E2 + 11 E4; 1.1.0: 3 E2 + 21 E4 + all 20 E4L).
- The footers all say `v1.0.0` for the opposite reason: the frozen binary predates the change that
  reads the footer version from `package.json`, so it emits its compiled-in string.

Confirmed by behaviour rather than by strings: the 1.0.0-tagged runs already carry `validation`
records, the partial-JSON progression rule with its `validation.issues` message, and the demoted
`#### … (model text — experimental…)` headings. **There is one pipeline in this batch, not two**
([`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §f.8). The fix for a future batch is to stamp the
manifest from the build, not from `package.json`.

### (d) Other tooling limits worth naming

- **The fairness probe's measured recall is 0.436** (§3). "0 anchored claims" in §11 is bounded by
  that.
- **The E5 class mapper is a keyword matcher.** It is negation-aware, but its own report documents
  the false negative that follows: `"cannot rule out pneumonia"` contains the substring `"not "`
  and is treated as negated.
- **The cost estimator is unreliable for open-weight routes** — 22.5× high on gemma, 9.6× on qwen
  (§0). Only `provider_usd` is quoted anywhere in this file.
- **Scanner stress has no numbers at all** (§5).
- **Pre-final-build measurements are not in this repository.** Earlier builds' rows live in
  `paper-work/experiments-archive/results-prefinal-archive.jsonl`, which is local-only and
  gitignored. Nothing in this file depends on them.

---

## 13. The 2026-09-09 tooling fixes, and what they changed

[`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §f.3 and §h.1 identified two defects in the
analysis scripts and recommended fixes it did not itself apply. Both are now applied and both
reports were regenerated from the unchanged run artefacts.

**1. Governance probe — citation URLs are not assertions.**
[`src/domain/context-consistency.ts`](../../src/domain/context-consistency.ts) now strips Markdown
link targets (keeping the visible label), `references[]` arrays and bare `http(s)://…` tokens
before matching, and [`collectGeneratedText`](../../src/domain/context-consistency.ts) documents
that it never collects `references`.

| [`probe-results.json`](probe-results.json)      | before | after |
| ----------------------------------------------- | ------ | ----- |
| Context contradictions, batch-wide              | 8      | **6** |
| Runs flagged                                    | 3      | **1** |
| `E4L-00003158` ("adult" in an escardio.org URL) | 1      | **0** |
| `E4L-00019779` ("adult" in a spine.org URL)     | 1      | **0** |
| `E4-00000008` (failure case F2)                 | 6      | **6** |

All 6 genuine hits survive. One term-level false positive inside that run also disappeared:
`paediatric` had been counted only because of the URL
`radiopaedia.org/articles/normal-chest-radiograph-paediatric`, so the run's distinct-term list is
now 5 terms rather than 6. Probe precision on this batch is 1.00, up from 0.75. Nothing else in
the probe output changed.

**2. E5 direction scoring — the enum is the gate, not `validation.ok`.**
[`label-agreement.ts`](label-agreement.ts) previously discarded a run's direction row whenever the
evolution record's `validation.ok` was false, even though the top-level `progression` was a valid
`ProgressionStatus` recovered verbatim by the pipeline's partial-JSON fallback. It now scores any
row whose `progression` is a valid enum value, flags it `recovered`, and skips only an absent,
non-enum or unreadable `progression`.

| [`E5-label-agreement.json`](E5-label-agreement.json) | before           | after             |
| ---------------------------------------------------- | ---------------- | ----------------- |
| Direction rows scorable, of 52                       | 46               | **52**            |
| Rows agreeing                                        | 15               | **19**            |
| gemini agreement rate                                | 9/23 = 0.391     | **12/28 = 0.429** |
| claude agreement rate                                | 2/7 = 0.286      | **3/8 = 0.375**   |
| gemma / qwen agreement rate                          | 2/8 = 0.250 each | unchanged         |

The 6 recovered rows are exactly the six the review predicted: `E4-00000086`/gemini,
`E4-00000148`/claude, and E4L `00003980`, `00013880`, `00016493`, `00019779`. The report and its
JSON sibling now carry a `recovered` column, a per-model `recoveredCount` and a
`recoveredProgressionRows` total, so the provenance stays visible rather than being silently folded
into the rate.

**One consequence contradicts a sentence in the qualitative review**, and this file, being later,
is the one to follow: with the six rows restored, `worsening` is **no longer the mechanically worst
stratum for gemini** across both cohorts (0.429, above `improving`'s 0.375), and E4L
`worsening-like` scores **1/5 rather than 0/5**. The human adjudication of that stratum — 0/5
agree, §9 — is unchanged, because the recovered case (00016493) is scored `partial` there for a
reason a string comparison cannot see.

Both fixes are covered by new unit tests in
[`tests/unit/domain/context-consistency.test.ts`](../../tests/unit/domain/context-consistency.test.ts)
and
[`tests/unit/experiments/label-agreement.test.ts`](../../tests/unit/experiments/label-agreement.test.ts).

---

## 14. Best use cases (honest), and what this is not

Derived from [`QUALITATIVE-REVIEW.md`](QUALITATIVE-REVIEW.md) §i; every claim there is backed by a
cited artefact.

**What this evidence does support:**

1. **Provenance and integrity of a multi-model imaging pipeline.** 61/61 successful runs produced a
   hash-sealed manifest; 6/6 sampled runs re-verified byte-identical inputs, context files and
   outputs; 802/802 content artefacts carry the disclaimer; 61/61 carry the human-review banner and
   the labelled experimental treatment section; 0/863 artefacts contain a demographically anchored
   claim. **This is the paper's strongest claim, and it is about the system, not the model.**
2. **Machine-detectable governance failures.** The context-consistency probe found the batch's one
   genuine demographic fabrication without a human reading 863 artefacts, and the schema-validation
   counter localised a model-specific defect (gemma, 42 % of image records) that no direction score
   would have surfaced.
3. **Graceful degradation as a design property.** Zero transport errors in 61 runs; a validation
   failure never aborts a run; a failed evolution parse still yields the model's own verdict plus a
   recorded reason; a hard quota failure yields a report with no treatment content rather than a
   report with unlabelled treatment content.
4. **Model dependency as a measurable phenomenon.** Four models, one patient, four different
   verdicts — reproducible for $1.23 (§8).
5. **Longitudinal synthesis across sessions**, including recognising that differently-worded
   findings refer to the same object, tracking laterality over time, and treating _non-mention_ as
   evidence rather than asserting resolution.
6. **Cost characterisation** that is stable within a model across two disjoint cohorts
   (gemini $0.01166 vs $0.01025 per patient) and spans 67× across models.

**What it is not, and must never be presented as:**

1. **Not diagnosis.** A fabricated 4 cm cavitary lesion at 95 % stated confidence; an invented
   infant contradicting a 69-year-old-female context. Stated confidence does not track correctness.
2. **Not treatment.** Treatment suggestions were emitted throughout, several attached to findings
   that are not in the images. They are labelled experimental by the pipeline for that reason.
3. **Not detection or screening.** On the stratum built to test progression tracking — E4L
   `worsening-like` — the best-performing model scored **0/5 agree** by human adjudication (§9).
4. **Not a ranking of these four models.** gemini's 3/8 (7/8) and qwen's 0/8 (6/8) on E4 describe
   two entirely different behaviours — one that reads images and sometimes fabricates, one that
   mostly returns empty findings and always says `Stable`.
5. **Not a validated device or an accuracy study.** No clinician read any image or any output; all
   six verified manifests report `[SKIP] human review: no reviewer attestation recorded`.
6. **Schema-valid ≠ true** (§12b).

---

## 15. Reproduction

### 15.1 Prerequisites

```bash
source ~/.nvm/nvm.sh && nvm use 22          # Node 22
npm ci && npm run build                     # build the CLI once
python3 experiments/sime2026/prepare-nih.py <NIH-archive.zip|dir> ../nih-cxr14/input
```

The dataset is the public NIH ChestX-ray14 **224-px derivative**; images are not committed here,
only the selection manifest ([`nih-selection.json`](nih-selection.json)) and the run artefacts.
Cite Wang et al., CVPR 2017 (see [`README.md`](README.md) §1).

| Variable                                | Value used                           | Meaning                                              |
| --------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `AI_PROVIDER`                           | `openrouter` (all reported runs)     | provider adapter                                     |
| `OPENROUTER_API_KEY` / `GOOGLE_API_KEY` | from `.env`                          | whichever the provider needs                         |
| `INPUT`                                 | the prepared input root — for the reported E4L arm, the **20-patient** tree (`docs/PAPER.md` §3 gives the command that builds it from `E4L20-patients.json`); `../nih-cxr14/input` otherwise | prepared input root |
| `CLI`                                   | `node dist/main/index.js` after `npm run build`. The published batch used a frozen copy of that build under `.sime-dist/`, which is gitignored and not part of a clone | the CLI under test |
| `SKIP_EXISTING`                         | `1`                                  | skip ids already in `results.jsonl` — never re-spend |
| `AI_MAX_RETRIES`                        | `4`                                  | retries on 429/5xx/transport                         |
| `MAX_COST`                              | `3`                                  | `--max-cost-usd` on every invocation                 |

### 15.2 Order, commands, expected cost and time

Offline first (no key, no cost):

```bash
npm test                                                              # ~55 s, 34 suites
node_modules/.bin/tsx scripts/fairness-benchmark.ts                   # E1, seconds
node_modules/.bin/tsx experiments/sime2026/measure-payload.ts --synthetic --label large-study
node_modules/.bin/tsx experiments/sime2026/measure-payload.ts ../nih-cxr14/input/E4 --label e4-224px
node_modules/.bin/tsx experiments/sime2026/full-dataset-scan.ts       # ~455 s, 112,120 images
node_modules/.bin/tsx experiments/sime2026/scanner-stress.ts | tee experiments/sime2026/scanner-stress.md
```

Live runs, in this order (all through OpenRouter):

```bash
cd /path/to/AgenticMedicalImagingHelper && npm run build
set -a && . ./.env && set +a          # optional; .env is gitignored
export INPUT="$PWD/../nih-cxr14/input-e4l20" CLI="node $PWD/dist/main/index.js" \
       SKIP_EXISTING=1 AI_MAX_RETRIES=4
R=./experiments/sime2026/run.sh

AI_PROVIDER=openrouter $R E2 google/gemini-2.5-flash                  # 8 rows, ~$0.37
for m in google/gemini-2.5-flash google/gemma-4-31b-it \
         qwen/qwen3-vl-235b-a22b-instruct anthropic/claude-sonnet-5; do
  AI_PROVIDER=openrouter $R E4 "$m"                                   # 32 runs, ~$1.03
done
AI_PROVIDER=openrouter $R E4L google/gemini-2.5-flash                 # 20 patients, ~$0.21
AI_PROVIDER=google E2_SIZES="S2x5" E2_CONC="1" $R E2 gemini-2.5-flash # the control
```

`batch-resume.sh` runs exactly that sequence twice (a second pass picks up
anything a transient failure lost; `SKIP_EXISTING=1` makes the second pass free). **Total metered
spend for a full repeat is $1.60** (`totals.providerUsd` summed over the 61 manifests), dominated
by claude-sonnet-5. Wall time for the whole batch was **4,495.7 s ≈ 75 min**
([`results.jsonl`](results.jsonl)), dominated by provider rate limiting rather than by the
pipeline.

Then the derived artefacts:

```bash
node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts experiments/sime2026/runs
node_modules/.bin/tsx experiments/sime2026/label-agreement.ts   # rewrites E5-label-agreement.{md,json}
node_modules/.bin/tsx experiments/sime2026/fill-numbers.ts \
  --template <paper-dir>/numbers.tex --out <paper-dir>/numbers-generated.tex   # --template is required
node dist/main/index.js verify-manifest experiments/sime2026/runs/<id>/output
```

Both analysis scripts write their `.md` and `.json` outputs themselves — do not redirect stdout
into them.

### 15.3 The OpenRouter route, and why

The reported live numbers go through OpenRouter to `google/gemini-2.5-flash` rather than the direct
Google endpoint, for two recorded reasons, both evidenced in §7: quota is the binding constraint
(the direct endpoint returned 429 at concurrency 5, and was 5.9× slower at concurrency 1), and the
submission-time default model was retired mid-project
([`evidence/gemini-2.5-pro-404.txt`](evidence/gemini-2.5-pro-404.txt)).

Two honest consequences: OpenRouter reports its own `usage.cost`, which is the figure quoted
throughout; and per
[ADR-006](../../docs/architecture/decisions/ADR-006-openrouter-second-provider.md) the OpenRouter
path has **no Google Search grounding**, so the "Research Context" section of each analysis is
answered from model knowledge alone. Any cross-provider comparison must say so.

### 15.4 Cost and quota discipline

- Always pass a cost cap; [`run.sh`](run.sh) sets `--max-cost-usd "$MAX_COST"` on every invocation
  and exit code 5 means it tripped.
- If a batch hits 429 at `E2_CONC="5"`, drop to `E2_CONC="1"` rather than raising the retry count —
  backoff cannot manufacture quota.
- Token counts are authoritative; estimated dollar figures are not (§0).
- Re-running is cheap to _restart_ and expensive to _repeat_: always `SKIP_EXISTING=1`.

---

## 16. Change log of experiment builds

| Build                                                              | What changed                                                                      | Where its numbers live                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Pre-JSON-mode, Google-direct** (2026-09-08, ~10:38–13:00 UTC)    | No JSON mode, no Zod validation of structured output; direct Gemini endpoint      | Local-only archive, outside this repository. **Discarded on purpose** — mixing them in would mix providers _and_ builds |
| **Pre-final, OpenRouter, JSON mode** (2026-09-08, 13:57–18:35 UTC) | JSON mode + Zod validation; OpenRouter route; full E4 and partial E4L             | Local-only archive. **Superseded**; nothing in this file rests on it                                                    |
| **Final build** — `final build frozen 2026-09-08T18:58:16Z`        | Frozen CLI; whole batch re-run from an empty `results.jsonl` and an empty `runs/` | [`results.jsonl`](results.jsonl) + `runs/` — **every number in this file**                                              |
| **Analysis-tooling fixes** (2026-09-09, no re-run)                 | Citation stripping in the context probe; enum-based direction gate in E5 (§13)    | [`probe-results.md`](probe-results.md), [`E5-label-agreement.md`](E5-label-agreement.md), regenerated                   |

Also changed during the sequence and reflected only in the final build: the model-aware image
pre-flight replacing the unconditional 1024-px PNG re-encode
([ADR-003](../../docs/architecture/decisions/ADR-003-image-preprocessing.md), §6); retry with
bounded backoff and full jitter on 429/5xx/transport; the context-consistency check (§11); and
`provider_usd` recording alongside the estimate.

**Open items, stated rather than hidden:**

- Scanner-stress numbers (§5) — script exists, never run to a file.
- Threading `patient_context.txt` into the image and series prompts (§12a) — requires a new build
  and a full re-run of the paid cohorts.
- Stamping `toolVersion` from the build rather than from `package.json` (§12c).

## Planned next evaluation (not part of this release)

The results in this pack are bounded by the data they were run on: 224-pixel
derivatives of frontal chest radiographs, with labels mined from radiology
reports rather than adjudicated by a clinician. A separate, later evaluation is
planned and is **not** covered here:

- **Full-resolution images** instead of the 224-pixel derivative, so the
  image-policy resolution ladder is exercised at diagnostic scale.
- **Clinician review of the outputs.** Every generated report read and scored by
  a qualified medical doctor, replacing report-derived label agreement with
  expert adjudication.
- **Additional real cases** beyond the public cohorts used here.
- **Other modalities and formats** — ultrasound, CT, MRI and native DICOM —
  which need modality-aware ingestion the current pipeline does not implement.

That work belongs to a later dataset, a later software version and a separate
paper. Nothing in this pack should be read as anticipating its results.
