# Experiments (SIME 2026, paper #154)

This is a short index of the experiments behind the SIME 2026 paper
("Agentic Multimodal Architectures for Medical Imaging: Orchestration,
Deterministic Fairness Probing, and Governance"). It points at where to
reproduce them and where to read the results — it does not restate numbers
itself, so it can't go stale the way a copied figure would.

- **How to reproduce:** [`experiments/sime2026/README.md`](../experiments/sime2026/README.md)
  — dataset provenance, environment setup, `run.sh` usage, and per-experiment
  commands.
- **Results:** `experiments/sime2026/RESULTS.md` (to be written) will hold the
  consolidated findings; until then see the per-experiment Markdown files in
  `experiments/sime2026/` (e.g. `E1-fairness-benchmark-results.md`,
  `E3-payload-large-study.md`, `E4L-cohort.md`) and `results.jsonl` for raw
  per-run figures. No numbers are duplicated here — see those files.

## What each experiment is

| ID                            | Name                        | Question                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1**                        | Fairness benchmark          | How well does the deterministic allocative-harm probe ([`src/domain/fairness.ts`](../src/domain/fairness.ts)) classify a labeled fixture of explicit / implicit / paraphrased / benign / negation / trap items?                         |
| **E2**                        | Scalability                 | How do wall-clock time, token usage and cost scale with study size (`1×1`, `2×5`, `3×10`, `4×20`) and concurrency?                                                                                                                      |
| **E3**                        | Payload reduction           | How much request payload does the client-side image pre-flight (`sharp` resize to 1024 px) remove, measured in bytes only (no diagnostic-equivalence claim)?                                                                            |
| **E4**                        | Longitudinal cohort         | Does the pipeline produce coherent longitudinal (multi-session) output on a real, small cohort of NIH ChestX-ray14 patients?                                                                                                            |
| **E4L**                       | Longitudinal cohort, larger | Same question as E4 on a larger, label-trajectory-stratified cohort — opt-in because it costs roughly 5× E4.                                                                                                                            |
| **Full-dataset offline scan** | Corpus sanity scan          | Offline, non-API scan of the full prepared dataset (`experiments/sime2026/full-dataset-scan.ts` / `.csv` / `.md`) — file counts, per-patient study counts, label distribution; no model calls.                                          |
| **Scanner stress**            | File-scanner stress test    | Exercises [`src/infrastructure/file-scanner.ts`](../src/infrastructure/file-scanner.ts) (`experiments/sime2026/scanner-stress.ts`) against a large synthetic input tree to check the scanner and path-traversal guard hold up at scale. |

## Dataset

All model-facing experiments (E2, E4, E4L) run against the public, de-identified
NIH Clinical Center ChestX-ray14 collection (Wang et al., CVPR 2017). See
[`experiments/sime2026/README.md` §1](../experiments/sime2026/README.md) for
citation, provenance, licence terms, and the exact derivative used (224-px
images). No accuracy claim is made against this dataset — see the paper's
§VI ("Operational Validation, Not Clinical") and [`docs/COMPLIANCE.md`](COMPLIANCE.md).

## Related documents

- [`docs/architecture/decisions/ADR-004-single-model-monoculture-risk.md`](architecture/decisions/ADR-004-single-model-monoculture-risk.md) — the single-model risk E2/E4 partly evidence.
- [`docs/architecture/decisions/ADR-006-openrouter-second-provider.md`](architecture/decisions/ADR-006-openrouter-second-provider.md) — the second-provider adapter these experiments can also be run against.
- [`docs/COMPLIANCE.md`](COMPLIANCE.md) — how the fairness probe (E1) maps to EU AI Act Art. 10/15 and NIST AI RMF MEASURE.
