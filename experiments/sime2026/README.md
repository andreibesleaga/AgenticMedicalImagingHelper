# SIME 2026 — reproducibility pack (paper #154)

Everything needed to re-run the experiments reported in paper #154 for SIME 2026,
against `AgenticMedicalImagingHelper` at this commit. The experiments drive the
built CLI exactly as a user would; no experiment-only code paths exist inside
`src/`.

| ID  | Question                                                                 | Artefact                                                          |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| E1  | How well does the deterministic allocative-harm probe actually classify? | `E1-fairness-benchmark-results.md`                                |
| E2  | How does wall-clock time and cost scale with study size and concurrency? | `results.jsonl` (`E2-*` rows), `runs/E2-*/`                       |
| E3  | How much request payload does the client's image pre-flight remove?      | `E3-payload-<label>.md`                                           |
| E4  | Does the pipeline produce coherent longitudinal output on a real cohort? | `results.jsonl` (`E4-*` rows), `runs/E4-*/`, `probe-results.json` |

Result numbers are not restated here — see `results.jsonl`, the `E1-`/`E3-`
Markdown reports, and `probe-results.json`.

---

## 1. Dataset

Public, de-identified chest radiographs from the NIH Clinical Center
ChestX-ray14 release. Cite the dataset paper:

> X. Wang, Y. Peng, L. Lu, Z. Lu, M. Bagheri, and R. M. Summers, "ChestX-ray8:
> Hospital-scale chest X-ray database and benchmarks on weakly-supervised
> classification and localization of common thorax diseases," in _Proc. IEEE
> Conf. Computer Vision and Pattern Recognition (CVPR)_, 2017, pp. 2097–2106.

Provenance and terms:

- Source: NIH Clinical Center, ChestX-ray14 (the 14-label extension of
  ChestX-ray8). Released for research use; the NIH asks that the dataset be
  cited and that it not be used to identify individuals.
- **This pack uses the 224-px derivative** (`images-224/images-224/*.png`), the
  redistributed downsampled copy — not the original 1024-px archive. That
  matters for E3: at 224 px the client's 1024-px resize is a no-op, so the
  pre-flight cannot reduce anything (see §6).
- Images are de-identified by the provider. No clinical data of our own is used
  or included in this repository; only file names, ages, sexes and view codes
  taken from `Data_Entry_2017.csv` are recorded, in `nih-selection.json`.
- The images themselves are **not** committed here. Only the selection manifest
  and the run artefacts are.

### Cohorts (fixed in `nih-selection.json`, so selection is reproducible)

| Key   | Contents                                                                | Used by                  |
| ----- | ----------------------------------------------------------------------- | ------------------------ |
| `E2`  | pool of 80 images from distinct patients, no longitudinal relation      | E2 scalability sizes     |
| `E4`  | 8 patients with multiple studies, chronological                         | E4 longitudinal analysis |
| `E4L` | 40 patients, stratified by label trajectory (`report_label_trajectory`) | optional larger E4 arm   |

---

## 2. Preparing the inputs

Download the NIH ChestX-ray14 "images-224" distribution (Kaggle/NIH), then:

```bash
# from the repository root
python3 experiments/sime2026/prepare-nih.py <NIH-archive.zip or extracted dir> ../nih-cxr14/input
```

This writes `../nih-cxr14/input/E2/S{1..4}x{1,5,10,20}/series_*/…` and
`../nih-cxr14/input/E4/<patient>/series_*/…`, each with the `patient_context.txt`
the CLI picks up as root context. The default `INPUT` in `run.sh` points at that
path; override with `INPUT=<dir>`.

Build the CLI once before running anything:

```bash
npm ci && npm run build
```

---

## 3. E2 / E4 — running the pipeline

```bash
cd experiments/sime2026
./run.sh <E2|E4|E4L|all> [model]
```

`all` = E2 + E4. `E4L` (40 patients) is opt-in because it costs roughly 5× E4.

### On Google (default provider)

```bash
export GOOGLE_API_KEY=…
./run.sh all gemini-2.5-flash
```

### On OpenRouter (second provider, ADR-006)

```bash
export OPENROUTER_API_KEY=…
AI_PROVIDER=openrouter ./run.sh all google/gemini-2.5-flash
```

`AI_PROVIDER=openrouter` makes `run.sh` pass `OPENROUTER_MODEL` instead of
`GEMINI_MODEL`; everything else is identical. Any vision-capable OpenRouter model
works (`openai/gpt-4o`, `qwen/qwen2.5-vl-72b-instruct`, …). Note the honest
difference recorded in ADR-006: the OpenRouter path has **no Google Search
grounding**, so section 5 of each analysis ("Research Context") is answered from
model knowledge alone. Comparisons across providers must say so.

### Knobs

| Variable         | Default                          | Meaning                                                 |
| ---------------- | -------------------------------- | ------------------------------------------------------- |
| `AI_PROVIDER`    | `google`                         | `google` or `openrouter`                                |
| `INPUT`          | `../../../nih-cxr14/input`       | prepared input root                                     |
| `CLI`            | `node <repo>/dist/main/index.js` | how to invoke the built CLI                             |
| `E2_SIZES`       | `S1x1 S2x5 S3x10 S4x20`          | which E2 sizes to run                                   |
| `E2_CONC`        | `1 5`                            | which concurrency levels to run                         |
| `E4_CONC`        | `1`                              | concurrency for the longitudinal arms                   |
| `MAX_COST`       | `3`                              | value passed to `--max-cost-usd` on every run           |
| `AI_MAX_RETRIES` | `3`                              | transient-failure retries inside the CLI (`0` disables) |
| `SKIP_EXISTING`  | `0`                              | `1` ⇒ skip ids already in `results.jsonl`, exit 0       |

Examples:

```bash
# just the two largest sizes, only concurrency 5
E2_SIZES="S3x10 S4x20" E2_CONC="5" ./run.sh E2

# resume an interrupted batch without re-spending on completed runs
SKIP_EXISTING=1 ./run.sh all
```

### Run ids

`E2-<size>-c<conc>-<provider>-<model>` and `<cohort>-<patient>-<provider>-<model>`,
with `/` in the model id replaced by `_`, e.g.

```
E2-S2x5-c5-google-gemini-2.5-flash
E4-00000013-openrouter-google_gemini-2.5-flash
```

Rows recorded before the provider segment existed (google only, e.g.
`E2-S1x1-c1-gemini-2.5-flash`) are still recognised by `SKIP_EXISTING`, so a
resumed google batch does not re-spend on them.

---

## 4. `results.jsonl` fields

One JSON object per run, appended (never rewritten):

| Field                      | Meaning                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | run id, as above; also the directory name under `runs/`                                                                                   |
| `date`                     | UTC timestamp when the run finished                                                                                                       |
| `provider`                 | `google` or `openrouter` (absent on rows written before this field existed)                                                               |
| `model`                    | model id passed to the CLI                                                                                                                |
| `concurrency`              | `--concurrency` value                                                                                                                     |
| `sessions`                 | number of series directories in the input                                                                                                 |
| `images`                   | number of `.png` files in the input                                                                                                       |
| `exit`                     | CLI exit code (0 ok, 4 some images failed, 5 cost cap hit, 1/2/3 config or input errors)                                                  |
| `wall_s`                   | wall-clock seconds for the whole CLI invocation, 0.1 s resolution                                                                         |
| `calls`                    | model calls the CLI made (from its `--verbose` cost summary)                                                                              |
| `tokens_in` / `tokens_out` | prompt / output tokens; output **includes** thinking tokens                                                                               |
| `usd`                      | the CLI's client-side cost **estimate** (tokens × published price)                                                                        |
| `provider_usd`             | the provider's own reported charge, when it reports one — OpenRouter's `usage.cost`; `null` on the Google path, which returns tokens only |
| `retries`                  | transient failures the CLI retried during the run (429/5xx/transport)                                                                     |
| `images_line`              | the CLI's "Images analyzed: N success, M failed" line, verbatim                                                                           |

`usd` is an estimate and `provider_usd` is not: where both are present, report the
provider figure and treat the estimate as a guard-rail. Neither is a billing
invoice.

---

## 5. E1 — fairness probe benchmark

```bash
node_modules/.bin/tsx scripts/fairness-benchmark.ts
```

Runs `containsDemographicClaim` / `findDemographicTokens` (`src/domain/fairness.ts`)
over the 110 labelled items in `tests/fixtures/fairness-benchmark.json` and
rewrites `E1-fairness-benchmark-results.md`. The probe is measured as-is; the
benchmark never modifies it. No API key, no network, no cost.

---

## 6. E3 — request payload after the image pre-flight

```bash
# large-plate stand-ins, no clinical data required
node_modules/.bin/tsx experiments/sime2026/measure-payload.ts --synthetic --label large-study

# any prepared input directory
node_modules/.bin/tsx experiments/sime2026/measure-payload.ts ../nih-cxr14/input/E2/S4x20 --label nih-224
```

Reports, per PNG, the original size and dimensions, the size after the exact
pipeline the clients apply (`prepareImageForGemini`, imported from
`src/infrastructure/gemini-client.ts` — not re-implemented), and the base64 length
that ends up in the request body. Writes `E3-payload-<label>.md`. Offline, no cost.

Two caveats belong in any use of these numbers:

1. **Bytes are not diagnosis.** Downscaling to 1024 px changes the image the
   model reads. E3 measures transport and token-budget size only, and is not
   evidence of diagnostic equivalence; that would need a reader study.
2. On the 224-px NIH derivative the resize is a no-op and the PNG re-encode can
   make files _larger_. That is why `--synthetic` exists: deterministic
   2500×2500, 3000×2500 and 4000×4000 greyscale gradient-plus-noise images stand
   in for large-plate studies, so the reduction can be measured without clinical
   data. They are not radiographs and carry no anatomy.

---

## 7. Governance probe over the produced artefacts

```bash
node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts experiments/sime2026/runs
```

For every run directory: counts artefacts, checks the mandatory disclaimer is
present in each, applies the allocative-harm probe to all generated text, and
extracts the evolution progression label. Prints a Markdown table and writes
`probe-results.json`. Offline, no cost.

---

## 8. Cost and quota notes

- **Always pass a cost cap.** `run.sh` sets `--max-cost-usd "$MAX_COST"`
  (default 3) on every invocation. The cap is checked after each call, so it
  bounds a run by refusing the _next_ call; exit code 5 means it tripped.
- **The 429 that cost us a batch.** An early E2/E4 batch failed part-way through
  with `429 Too Many Requests … You exceeded your current quota` from the Gemini
  API on concurrent calls, and the client had no retry, so the affected runs were
  lost. The clients now retry transient failures (429, 500, 502, 503, 504 and
  transport errors) with exponential backoff and full jitter, honouring
  `Retry-After` / Google's `RetryInfo.retryDelay` when present — 4 attempts by
  default. `400/401/403/404` and validation errors are never retried. Configure
  with `AI_MAX_RETRIES` (`0` disables). Retries appear in the `--verbose` log and
  are counted in the `retries` field of `results.jsonl`.
- **Free-tier quotas are the binding constraint,** not the price. If a batch
  still hits 429 at `E2_CONC="5"`, drop to `E2_CONC="1"` rather than raising the
  retry count; backoff cannot manufacture quota.
- **Token counts are authoritative, dollar figures are not.** `usd` is
  tokens × published list price at the time of the run; prices change. Record the
  prices you ran under in the run log below.
- Re-running is cheap to _restart_ but not to _repeat_: use `SKIP_EXISTING=1`.

---

## 9. Run log

Fill one row per batch actually executed, so the numbers in `results.jsonl` can be
traced to a date, a provider and a price.

| Date (UTC) | Arm(s) | Provider | Model | Input $/1M | Output $/1M | Notes |
| ---------- | ------ | -------- | ----- | ---------- | ----------- | ----- |
|            |        |          |       |            |             |       |
|            |        |          |       |            |             |       |
|            |        |          |       |            |             |       |

Prices: Google — <https://ai.google.dev/gemini-api/docs/pricing>; OpenRouter —
the model's page under <https://openrouter.ai/models> (and `usage.cost`, recorded
per run as `provider_usd`).
