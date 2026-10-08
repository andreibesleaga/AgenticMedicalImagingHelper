# SIME-FULL — the SIME 2026 experiments on the original NIH images

A post-publication follow-up to paper #154 (SIME 2026). The paper's pack in
[`../sime2026/`](../sime2026/) is **frozen** and unchanged. This folder repeats its
longitudinal experiment on the **original 1024 × 1024 NIH ChestX-ray14 images** of the
same patients, and on a documented 224-px copy made from those same files, so that
resolution is the only thing that changes between the two inputs.

This protocol was written on 2026-09-29, before any run in this folder. The runs
and their results are in [`RESULTS.md`](RESULTS.md) (generated tables in
[`ANALYSIS.md`](ANALYSIS.md)); every command is in [`REPLICATE.md`](REPLICATE.md).

A second batch on 2026-10-08, after all twelve NIH archives were downloaded and checked
against [`nih-archives.sha256`](nih-archives.sha256), added the 20-patient cohort
(E4L-20), the scaling test (E2) and two unchanged repeats of the E4 runs; see
`RESULTS.md` §8–§11.

## What it answers

The paper's main stated limit is that every image was a 224-px derivative. Two
questions follow, and this pack answers both on the paper's own cohort:

1. **Resolution:** with the model held fixed, does reading the original 1024-px image
   instead of a 224-px copy change the findings, the per-visit summary or the
   better/same/worse verdict?
2. **Model:** at full resolution, do the paper's four model families still disagree the
   way the paper reports, and how do a current Gemini model and a local medical model
   (MedGemma, run on the author's laptop) compare?

It does **not** answer whether any output is clinically correct. The labels are still
the NIH text-mined labels (about 90 % accurate), no clinician reviewed anything, and
the cohort is eight patients. See the scope statement in `RESULTS.md` when it exists.

## Data

- Source: NIH Clinical Center, ChestX-ray14, original archives from
  <https://nihcc.app.box.com/v/ChestXray-NIHCC>. No restrictions on use; cite
  Wang et al., CVPR 2017, and acknowledge the NIH Clinical Center.
- Selection: exactly the paper's files, from `../sime2026/nih-selection.json` (E4: 8
  patients, 31 studies) and `../sime2026/E4L20-patients.json` (E4L-20: 20 patients,
  72 studies, when the archives holding them are available).
- `prepare-nih-full.py` writes two trees from the same originals:
  `r1024/` (the original PNG, byte for byte) and `r224/` (224 × 224, Pillow LANCZOS).
  The paper's 224-px copy came from a third-party resize whose method is undocumented;
  `r224/` replaces it with a documented one.
- `selection-hashes.json` records the SHA-256 of every original used, so anyone can
  check they hold the same files. Images are not committed.

## Arms

| Arm | Model | Route | Cost |
| --- | --- | --- | --- |
| L | `medgemma1.5:4b` (Google MedGemma 1.5, 4B, 4-bit) | `AI_PROVIDER=local`, Ollama on a 6 GB laptop GPU | none |
| G | `google/gemma-4-31b-it` (the paper's Gemma model; the `:free` variant was tried first and refused with HTTP 429, see `free-tier-evidence/`) | OpenRouter | about USD 0.01 per resolution |
| M | `google/gemini-2.5-flash`, `anthropic/claude-sonnet-5`, `qwen/qwen3-vl-235b-a22b-instruct` (the paper's other three models) | OpenRouter | small |
| C | `google/gemini-3.8-flash`, `google/gemini-3.1-pro-preview` (current Gemini) | OpenRouter | small |

Every arm runs on `r1024` and `r224` for E4. Second batch (2026-10-08): E4L-20 and E2
with the paper's model (Gemini 2.5 Flash) and arm L at both sizes; E4L-20 also with
Qwen3-VL and Gemini 3.1 Pro at 1024 px; E4 repeated twice at 1024 px for the paper's
four models (`REP=2`, `REP=3`). Every invocation carries `--max-cost-usd`; the
whole pack is capped at USD 10 of provider-reported cost. Free-tier OpenRouter models
may log prompts; that is acceptable here only because the NIH images are public and
de-identified. MedGemma is used under Google's Health AI Developer Foundations terms,
for research only.

The model-aware image pre-flight runs as in the paper: for Gemma-family models
(including MedGemma) it resizes to 896 px, the size their vision encoder uses, so the
1024-px arm sends 896 px to those models and the full 1024 px to the others. The run
manifests record what was actually sent.

## Running

```bash
# once: build the CLI, then the inputs (archives directory, output directory)
npm ci && npm run build
python3 experiments/sime-full/prepare-nih-full.py ../nih-cxr14-full/archives ../nih-cxr14-full/input E4

cd experiments/sime-full
# local model (Ollama serving medgemma1.5:4b on 127.0.0.1:11434)
AI_PROVIDER=local RES=1024 ./run.sh E4 medgemma1.5:4b
AI_PROVIDER=local RES=224  ./run.sh E4 medgemma1.5:4b
# OpenRouter models (OPENROUTER_API_KEY in the environment)
AI_PROVIDER=openrouter RES=1024 ./run.sh E4 google/gemma-4-31b-it
AI_PROVIDER=openrouter RES=224  ./run.sh E4 google/gemma-4-31b-it
```

Run ids carry the resolution: `E4-<patient>-r1024-<provider>-<model>`. Results are
appended to `results.jsonl`; artefacts (reports, run manifests) go to `runs/<id>/`.
`verify-manifest` checks any run offline, exactly as for the paper's pack.
