# E5 — Label agreement (NIH ChestX-ray14 vs. model output)

Generated: 2026-09-09T09:00:29.874Z

Run ids included (62):

- `E2-S1x1-c1-openrouter-google_gemini-2.5-flash`
- `E2-S1x1-c5-openrouter-google_gemini-2.5-flash`
- `E2-S2x5-c1-google-gemini-2.5-flash`
- `E2-S2x5-c1-openrouter-google_gemini-2.5-flash`
- `E2-S2x5-c5-google-gemini-2.5-flash`
- `E2-S2x5-c5-openrouter-google_gemini-2.5-flash`
- `E2-S3x10-c1-openrouter-google_gemini-2.5-flash`
- `E2-S3x10-c5-openrouter-google_gemini-2.5-flash`
- `E2-S4x20-c1-openrouter-google_gemini-2.5-flash`
- `E2-S4x20-c5-openrouter-google_gemini-2.5-flash`
- `E4-00000008-openrouter-anthropic_claude-sonnet-5`
- `E4-00000008-openrouter-google_gemini-2.5-flash`
- `E4-00000008-openrouter-google_gemma-4-31b-it`
- `E4-00000008-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000067-openrouter-anthropic_claude-sonnet-5`
- `E4-00000067-openrouter-google_gemini-2.5-flash`
- `E4-00000067-openrouter-google_gemma-4-31b-it`
- `E4-00000067-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000086-openrouter-anthropic_claude-sonnet-5`
- `E4-00000086-openrouter-google_gemini-2.5-flash`
- `E4-00000086-openrouter-google_gemma-4-31b-it`
- `E4-00000086-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000092-openrouter-anthropic_claude-sonnet-5`
- `E4-00000092-openrouter-google_gemini-2.5-flash`
- `E4-00000092-openrouter-google_gemma-4-31b-it`
- `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000148-openrouter-anthropic_claude-sonnet-5`
- `E4-00000148-openrouter-google_gemini-2.5-flash`
- `E4-00000148-openrouter-google_gemma-4-31b-it`
- `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000219-openrouter-anthropic_claude-sonnet-5`
- `E4-00000219-openrouter-google_gemini-2.5-flash`
- `E4-00000219-openrouter-google_gemma-4-31b-it`
- `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000239-openrouter-anthropic_claude-sonnet-5`
- `E4-00000239-openrouter-google_gemini-2.5-flash`
- `E4-00000239-openrouter-google_gemma-4-31b-it`
- `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4-00000296-openrouter-anthropic_claude-sonnet-5`
- `E4-00000296-openrouter-google_gemini-2.5-flash`
- `E4-00000296-openrouter-google_gemma-4-31b-it`
- `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct`
- `E4L-00003158-openrouter-google_gemini-2.5-flash`
- `E4L-00003295-openrouter-google_gemini-2.5-flash`
- `E4L-00003980-openrouter-google_gemini-2.5-flash`
- `E4L-00004946-openrouter-google_gemini-2.5-flash`
- `E4L-00005852-openrouter-google_gemini-2.5-flash`
- `E4L-00011264-openrouter-google_gemini-2.5-flash`
- `E4L-00013880-openrouter-google_gemini-2.5-flash`
- `E4L-00015192-openrouter-google_gemini-2.5-flash`
- `E4L-00015553-openrouter-google_gemini-2.5-flash`
- `E4L-00015863-openrouter-google_gemini-2.5-flash`
- `E4L-00016012-openrouter-google_gemini-2.5-flash`
- `E4L-00016054-openrouter-google_gemini-2.5-flash`
- `E4L-00016493-openrouter-google_gemini-2.5-flash`
- `E4L-00019779-openrouter-google_gemini-2.5-flash`
- `E4L-00021807-openrouter-google_gemini-2.5-flash`
- `E4L-00022134-openrouter-google_gemini-2.5-flash`
- `E4L-00022202-openrouter-google_gemini-2.5-flash`
- `E4L-00026237-openrouter-google_gemini-2.5-flash`
- `E4L-00027141-openrouter-google_gemini-2.5-flash`
- `E4L-00027230-openrouter-google_gemini-2.5-flash`

**This report is regenerated, never hand-edited.** It reflects exactly the run directories present under `experiments/sime2026/runs/` at generation time — see the run-id list above for what was included. Re-run `node_modules/.bin/tsx experiments/sime2026/label-agreement.ts` to rebuild it and its `.json` sibling.

## Method and honest caveats — read before the tables

- **NIH labels are not ground truth.** The 14 ChestX-ray14 "Finding Labels" were mined from radiology report text with NLP (DNorm/NegBio), not assigned by a radiologist looking at each image. Wang et al., CVPR 2017 report ~90% label accuracy for the NLP mining step, so a portion of the "disagreements" below are actually errors in the reference labels, not the model.
- **The images are 224px downsampled**, well below diagnostic resolution (clinical CXR is typically read at 2000+ px). Findings that require fine detail (small nodules, subtle interstitial change) are not fairly assessable at this resolution, by a model or a human.
- **The synonym mapping (`CLASS_SYNONYMS`) is a heuristic text-matcher**, not a clinically validated NLP labeler. It is negation-aware (skips a phrase preceded, anywhere in its current clause/sentence, by cues like "no ", "without", "not ") but that is a blunt instrument — e.g. "cannot rule out pneumonia" contains the substring "not " and would be (incorrectly) treated as a negated mention.
- **Source text = `findings[]` + `abnormalities[].name`/`.description` + `summary` only — never `rawResponse`**, to avoid counting the same sentence twice (rawResponse is the raw JSON the structured fields were parsed from).
- **"No Finding" rows**: when the mapper detects zero of the 14 classes in a report, the prediction is "No Finding" per the E5 spec, regardless of how confidently or hedgingly the model phrased its normal read.
- **This is descriptive agreement between free text and a keyword-mined label set, NOT a diagnostic-accuracy or clinical-validation study.** Do not report F1/precision/recall figures below as sensitivity/specificity of the underlying vision-language model at detecting disease — they measure agreement with an imperfect, NLP-derived reference under a heuristic text mapper, on sub-diagnostic-resolution images.
- Per-image rows whose artefact `status` is `invalid` (structured output failed the app's Zod schema — seen with `google/gemma-4-31b-it`) or `error` (the API call itself failed) are **excluded from all metric tables** below (they are not real predictions) but are still listed in the full per-image table, flagged, for transparency.

## Per-image results (full table, grouped by model)

### google/gemini-2.5-flash

| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |
|---|---|---|---|---|---|---|---|---|---|---|
| 00000623_005.png | 00000623 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | Atelectasis, Effusion, Pneumothorax | ok | no | 0.00 | Atelectasis, Effusion, Pneumothorax | — |
| 00007040_002.png | 00007040 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00013464_000.png | 00013464 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | Infiltration | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00013795_000.png | 00013795 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | Cardiomegaly, Hernia | ok | no | 0.00 | Cardiomegaly, Hernia | — |
| 00013795_000.png | 00013795 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00019169_019.png | 00019169 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | Pleural_Thickening | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00019238_009.png | 00019238 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | Atelectasis, Emphysema, Mass | No Finding | ok | no | 0.00 | — | Atelectasis, Emphysema, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | Atelectasis, Emphysema, Mass | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S2x5-c1-google-gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S2x5-c5-google-gemini-2.5-flash` | No Finding | — | error ([GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googl…) | — | — | — | — |

### openrouter/anthropic/claude-sonnet-5

| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |
|---|---|---|---|---|---|---|---|---|---|---|
| 00000008_000.png | 00000008 | E4 | `E4-00000008-openrouter-anthropic_claude-sonnet-5` | Cardiomegaly | No Finding | ok | no | 0.00 | — | Cardiomegaly |
| 00000008_001.png | 00000008 | E4 | `E4-00000008-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000008_002.png | 00000008 | E4 | `E4-00000008-openrouter-anthropic_claude-sonnet-5` | Nodule | Atelectasis, Consolidation, Effusion | ok | no | 0.00 | Atelectasis, Consolidation, Effusion | Nodule |
| 00000067_000.png | 00000067 | E4 | `E4-00000067-openrouter-anthropic_claude-sonnet-5` | Fibrosis | No Finding | ok | no | 0.00 | — | Fibrosis |
| 00000067_001.png | 00000067 | E4 | `E4-00000067-openrouter-anthropic_claude-sonnet-5` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000067_002.png | 00000067 | E4 | `E4-00000067-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000086_000.png | 00000086 | E4 | `E4-00000086-openrouter-anthropic_claude-sonnet-5` | No Finding | Edema | ok | no | 0.00 | Edema | — |
| 00000086_001.png | 00000086 | E4 | `E4-00000086-openrouter-anthropic_claude-sonnet-5` | Emphysema | Edema | ok | no | 0.00 | Edema | Emphysema |
| 00000086_002.png | 00000086 | E4 | `E4-00000086-openrouter-anthropic_claude-sonnet-5` | Atelectasis | Edema | ok | no | 0.00 | Edema | Atelectasis |
| 00000092_000.png | 00000092 | E4 | `E4-00000092-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000092_001.png | 00000092 | E4 | `E4-00000092-openrouter-anthropic_claude-sonnet-5` | Effusion, Fibrosis | Consolidation, Edema, Effusion, Pneumonia | ok | no | 0.20 | Consolidation, Edema, Pneumonia | Fibrosis |
| 00000092_002.png | 00000092 | E4 | `E4-00000092-openrouter-anthropic_claude-sonnet-5` | Fibrosis | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pleural_Thickening, Pneumonia | ok | no | 0.00 | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pleural_Thickening, Pneumonia | Fibrosis |
| 00000092_003.png | 00000092 | E4 | `E4-00000092-openrouter-anthropic_claude-sonnet-5` | Fibrosis | Atelectasis, Effusion, Hernia | ok | no | 0.00 | Atelectasis, Effusion, Hernia | Fibrosis |
| 00000148_000.png | 00000148 | E4 | `E4-00000148-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000148_001.png | 00000148 | E4 | `E4-00000148-openrouter-anthropic_claude-sonnet-5` | Effusion | Cardiomegaly, Nodule | ok | no | 0.00 | Cardiomegaly, Nodule | Effusion |
| 00000148_002.png | 00000148 | E4 | `E4-00000148-openrouter-anthropic_claude-sonnet-5` | Effusion, Fibrosis | Nodule | ok | no | 0.00 | Nodule | Effusion, Fibrosis |
| 00000148_003.png | 00000148 | E4 | `E4-00000148-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000219_000.png | 00000219 | E4 | `E4-00000219-openrouter-anthropic_claude-sonnet-5` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_001.png | 00000219 | E4 | `E4-00000219-openrouter-anthropic_claude-sonnet-5` | Atelectasis | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | Atelectasis |
| 00000219_002.png | 00000219 | E4 | `E4-00000219-openrouter-anthropic_claude-sonnet-5` | No Finding | Cardiomegaly, Edema | ok | no | 0.00 | Cardiomegaly, Edema | — |
| 00000219_003.png | 00000219 | E4 | `E4-00000219-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_000.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_001.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | No Finding | Hernia | ok | no | 0.00 | Hernia | — |
| 00000239_002.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | Infiltration | Hernia | ok | no | 0.00 | Hernia | Infiltration |
| 00000239_003.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | No Finding | Hernia, Mass | ok | no | 0.00 | Hernia, Mass | — |
| 00000239_004.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | No Finding | Cardiomegaly, Effusion | ok | no | 0.00 | Cardiomegaly, Effusion | — |
| 00000239_005.png | 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | No Finding | Cardiomegaly, Edema, Fibrosis, Mass | ok | no | 0.00 | Cardiomegaly, Edema, Fibrosis, Mass | — |
| 00000296_000.png | 00000296 | E4 | `E4-00000296-openrouter-anthropic_claude-sonnet-5` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00000296_001.png | 00000296 | E4 | `E4-00000296-openrouter-anthropic_claude-sonnet-5` | Emphysema | Pneumothorax | ok | no | 0.00 | Pneumothorax | Emphysema |
| 00000296_002.png | 00000296 | E4 | `E4-00000296-openrouter-anthropic_claude-sonnet-5` | Pneumothorax | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pneumothorax | ok | no | 0.20 | Atelectasis, Cardiomegaly, Consolidation, Effusion | — |
| 00000296_003.png | 00000296 | E4 | `E4-00000296-openrouter-anthropic_claude-sonnet-5` | No Finding | No Finding | ok | yes | 1.00 | — | — |

### openrouter/google/gemini-2.5-flash

| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |
|---|---|---|---|---|---|---|---|---|---|---|
| 00000008_000.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemini-2.5-flash` | Cardiomegaly | No Finding | ok | no | 0.00 | — | Cardiomegaly |
| 00000008_001.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemini-2.5-flash` | No Finding | Atelectasis, Effusion | ok | no | 0.00 | Atelectasis, Effusion | — |
| 00000008_002.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemini-2.5-flash` | Nodule | No Finding | ok | no | 0.00 | — | Nodule |
| 00000067_000.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemini-2.5-flash` | Fibrosis | No Finding | ok | no | 0.00 | — | Fibrosis |
| 00000067_001.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000067_002.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000086_000.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemini-2.5-flash` | No Finding | Consolidation, Effusion, Infiltration, Pneumonia | ok | no | 0.00 | Consolidation, Effusion, Infiltration, Pneumonia | — |
| 00000086_001.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00000086_002.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemini-2.5-flash` | Atelectasis | Atelectasis, Cardiomegaly, Effusion, Fibrosis, Pleural_Thickening, Pneumonia | ok | no | 0.17 | Cardiomegaly, Effusion, Fibrosis, Pleural_Thickening, Pneumonia | — |
| 00000092_000.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly, Consolidation, Effusion | ok | no | 0.00 | Cardiomegaly, Consolidation, Effusion | — |
| 00000092_001.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemini-2.5-flash` | Effusion, Fibrosis | No Finding | ok | no | 0.00 | — | Effusion, Fibrosis |
| 00000092_002.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemini-2.5-flash` | Fibrosis | Atelectasis, Consolidation, Effusion, Pneumothorax | ok | no | 0.00 | Atelectasis, Consolidation, Effusion, Pneumothorax | Fibrosis |
| 00000092_003.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemini-2.5-flash` | Fibrosis | Atelectasis, Consolidation, Effusion | ok | no | 0.00 | Atelectasis, Consolidation, Effusion | Fibrosis |
| 00000148_000.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000148_001.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemini-2.5-flash` | Effusion | Effusion | ok | yes | 1.00 | — | — |
| 00000148_002.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemini-2.5-flash` | Effusion, Fibrosis | Emphysema | ok | no | 0.00 | Emphysema | Effusion, Fibrosis |
| 00000148_003.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemini-2.5-flash` | No Finding | Emphysema | ok | no | 0.00 | Emphysema | — |
| 00000219_000.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_001.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_002.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000219_003.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_000.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_001.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_002.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00000239_003.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_004.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_005.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000296_000.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemini-2.5-flash` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00000296_001.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00000296_002.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemini-2.5-flash` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00000296_003.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000623_005.png | 00000623 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00001177_000.png | 00001177 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00001177_000.png | 00001177 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002027_000.png | 00002027 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002027_000.png | 00002027 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002037_000.png | 00002037 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002037_000.png | 00002037 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002046_004.png | 00002046 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | Consolidation, Effusion, Infiltration, Pleural_Thickening, Pneumonia | ok | no | 0.20 | Consolidation, Effusion, Pleural_Thickening, Pneumonia | — |
| 00002046_004.png | 00002046 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | Consolidation, Effusion, Pneumonia | ok | no | 0.00 | Consolidation, Effusion, Pneumonia | Infiltration |
| 00002275_000.png | 00002275 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00002275_000.png | 00002275 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Infiltration | Fibrosis | ok | no | 0.00 | Fibrosis | Infiltration |
| 00002275_000.png | 00002275 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00002275_000.png | 00002275 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00002427_000.png | 00002427 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002427_000.png | 00002427 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002737_000.png | 00002737 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00002737_000.png | 00002737 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003158_000.png | 00003158 | E4L | `E4L-00003158-openrouter-google_gemini-2.5-flash` | Effusion | No Finding | ok | no | 0.00 | — | Effusion |
| 00003158_001.png | 00003158 | E4L | `E4L-00003158-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003158_002.png | 00003158 | E4L | `E4L-00003158-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_000.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_001.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_002.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_003.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_004.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003295_005.png | 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003940_000.png | 00003940 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003940_000.png | 00003940 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003940_000.png | 00003940 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003940_000.png | 00003940 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003980_000.png | 00003980 | E4L | `E4L-00003980-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly, Edema | ok | no | 0.00 | Cardiomegaly, Edema | — |
| 00003980_001.png | 00003980 | E4L | `E4L-00003980-openrouter-google_gemini-2.5-flash` | No Finding | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pneumothorax | ok | no | 0.00 | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pneumothorax | — |
| 00003980_002.png | 00003980 | E4L | `E4L-00003980-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00003980_003.png | 00003980 | E4L | `E4L-00003980-openrouter-google_gemini-2.5-flash` | No Finding | Edema, Fibrosis | ok | no | 0.00 | Edema, Fibrosis | — |
| 00004231_000.png | 00004231 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00004231_000.png | 00004231 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | Effusion, Pneumonia, Pneumothorax | ok | no | 0.00 | Effusion, Pneumonia, Pneumothorax | — |
| 00004349_000.png | 00004349 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | Effusion | ok | no | 0.00 | Effusion | — |
| 00004349_000.png | 00004349 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | Nodule | ok | no | 0.00 | Nodule | — |
| 00004349_000.png | 00004349 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00004349_000.png | 00004349 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00004738_004.png | 00004738 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Edema, Mass | Atelectasis, Cardiomegaly, Consolidation, Fibrosis | ok | no | 0.00 | Atelectasis, Cardiomegaly, Consolidation, Fibrosis | Edema, Mass |
| 00004738_004.png | 00004738 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Edema, Mass | Atelectasis | ok | no | 0.00 | Atelectasis | Edema, Mass |
| 00004946_000.png | 00004946 | E4L | `E4L-00004946-openrouter-google_gemini-2.5-flash` | Fibrosis | Emphysema | ok | no | 0.00 | Emphysema | Fibrosis |
| 00004946_001.png | 00004946 | E4L | `E4L-00004946-openrouter-google_gemini-2.5-flash` | No Finding | Edema, Effusion, Fibrosis | ok | no | 0.00 | Edema, Effusion, Fibrosis | — |
| 00004946_002.png | 00004946 | E4L | `E4L-00004946-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly, Edema, Effusion | ok | no | 0.00 | Cardiomegaly, Edema, Effusion | — |
| 00005852_000.png | 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | Emphysema, Pneumothorax | Atelectasis, Consolidation | ok | no | 0.00 | Atelectasis, Consolidation | Emphysema, Pneumothorax |
| 00005852_001.png | 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00005852_002.png | 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00005852_003.png | 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00005852_004.png | 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00006186_005.png | 00006186 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00006186_005.png | 00006186 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00006186_005.png | 00006186 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | Effusion, Pneumonia, Pneumothorax | ok | no | 0.00 | Effusion, Pneumonia, Pneumothorax | — |
| 00006186_005.png | 00006186 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | Effusion, Pneumonia, Pneumothorax | ok | no | 0.00 | Effusion, Pneumonia, Pneumothorax | — |
| 00006249_006.png | 00006249 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00006249_006.png | 00006249 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00006587_000.png | 00006587 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00006587_000.png | 00006587 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00006642_042.png | 00006642 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00006642_042.png | 00006642 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | Edema | ok | no | 0.00 | Edema | Atelectasis |
| 00006759_001.png | 00006759 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Pneumonia | Cardiomegaly, Edema, Effusion | ok | no | 0.00 | Cardiomegaly, Edema, Effusion | Pneumonia |
| 00006759_001.png | 00006759 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Pneumonia | Cardiomegaly, Edema, Effusion | ok | no | 0.00 | Cardiomegaly, Edema, Effusion | Pneumonia |
| 00007040_002.png | 00007040 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007040_002.png | 00007040 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007046_000.png | 00007046 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007046_000.png | 00007046 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007251_000.png | 00007251 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007251_000.png | 00007251 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00007461_000.png | 00007461 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Emphysema | Atelectasis | ok | no | 0.00 | Atelectasis | Emphysema |
| 00007461_000.png | 00007461 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00009136_000.png | 00009136 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00009136_000.png | 00009136 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00009918_001.png | 00009918 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Infiltration | Consolidation, Pneumonia | ok | no | 0.00 | Consolidation, Pneumonia | Infiltration |
| 00009918_001.png | 00009918 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Infiltration | Atelectasis, Consolidation, Infiltration, Nodule, Pneumonia | ok | no | 0.20 | Atelectasis, Consolidation, Nodule, Pneumonia | — |
| 00009918_001.png | 00009918 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00009918_001.png | 00009918 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00010479_018.png | 00010479 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010479_018.png | 00010479 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010531_038.png | 00010531 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010693_004.png | 00010693 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010727_000.png | 00010727 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00010752_002.png | 00010752 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00010752_002.png | 00010752 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00010980_004.png | 00010980 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Consolidation, Infiltration, Nodule | Cardiomegaly, Effusion | ok | no | 0.00 | Cardiomegaly, Effusion | Consolidation, Infiltration, Nodule |
| 00010980_004.png | 00010980 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Consolidation, Infiltration, Nodule | Cardiomegaly, Effusion, Fibrosis, Pleural_Thickening | ok | no | 0.00 | Cardiomegaly, Effusion, Fibrosis, Pleural_Thickening | Consolidation, Infiltration, Nodule |
| 00010980_004.png | 00010980 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Consolidation, Infiltration, Nodule | No Finding | ok | no | 0.00 | — | Consolidation, Infiltration, Nodule |
| 00010980_004.png | 00010980 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Consolidation, Infiltration, Nodule | Cardiomegaly, Edema, Effusion, Fibrosis | ok | no | 0.00 | Cardiomegaly, Edema, Effusion, Fibrosis | Consolidation, Infiltration, Nodule |
| 00011065_000.png | 00011065 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011065_000.png | 00011065 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011121_008.png | 00011121 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011121_008.png | 00011121 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011264_000.png | 00011264 | E4L | `E4L-00011264-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011264_001.png | 00011264 | E4L | `E4L-00011264-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011264_002.png | 00011264 | E4L | `E4L-00011264-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00011538_000.png | 00011538 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | Atelectasis, Effusion | ok | no | 0.00 | Atelectasis, Effusion | — |
| 00011538_000.png | 00011538 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011558_013.png | 00011558 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011558_013.png | 00011558 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011823_001.png | 00011823 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011823_001.png | 00011823 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011823_001.png | 00011823 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00011823_001.png | 00011823 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012359_000.png | 00012359 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012359_000.png | 00012359 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012359_000.png | 00012359 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012359_000.png | 00012359 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012566_000.png | 00012566 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00012566_000.png | 00012566 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00013244_004.png | 00013244 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Mass | No Finding | ok | no | 0.00 | — | Mass |
| 00013244_004.png | 00013244 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Mass | No Finding | ok | no | 0.00 | — | Mass |
| 00013464_000.png | 00013464 | E2 | `E2-S1x1-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S1x1-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013464_000.png | 00013464 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00013795_000.png | 00013795 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00013795_000.png | 00013795 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00013795_000.png | 00013795 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00013795_000.png | 00013795 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00013795_000.png | 00013795 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00013795_000.png | 00013795 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00013880_000.png | 00013880 | E4L | `E4L-00013880-openrouter-google_gemini-2.5-flash` | Effusion | No Finding | ok | no | 0.00 | — | Effusion |
| 00013880_001.png | 00013880 | E4L | `E4L-00013880-openrouter-google_gemini-2.5-flash` | Effusion, Pleural_Thickening | No Finding | ok | no | 0.00 | — | Effusion, Pleural_Thickening |
| 00013880_002.png | 00013880 | E4L | `E4L-00013880-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion, Pleural_Thickening | Cardiomegaly, Edema, Effusion | ok | no | 0.20 | Cardiomegaly, Edema | Atelectasis, Pleural_Thickening |
| 00013880_003.png | 00013880 | E4L | `E4L-00013880-openrouter-google_gemini-2.5-flash` | Effusion | Atelectasis, Effusion | ok | no | 0.50 | Atelectasis | — |
| 00013917_025.png | 00013917 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Consolidation | Effusion, Mass | ok | no | 0.00 | Effusion, Mass | Consolidation |
| 00013917_025.png | 00013917 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Consolidation | Consolidation, Effusion, Mass | ok | no | 0.33 | Effusion, Mass | — |
| 00014531_000.png | 00014531 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014531_000.png | 00014531 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014666_000.png | 00014666 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014666_000.png | 00014666 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014666_000.png | 00014666 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014666_000.png | 00014666 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00014948_001.png | 00014948 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Nodule | No Finding | ok | no | 0.00 | — | Nodule |
| 00014948_001.png | 00014948 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Nodule | No Finding | ok | no | 0.00 | — | Nodule |
| 00015068_007.png | 00015068 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015068_007.png | 00015068 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015068_007.png | 00015068 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015068_007.png | 00015068 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015192_000.png | 00015192 | E4L | `E4L-00015192-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015192_001.png | 00015192 | E4L | `E4L-00015192-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00015192_002.png | 00015192 | E4L | `E4L-00015192-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00015553_000.png | 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015553_001.png | 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015553_002.png | 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015553_003.png | 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015553_004.png | 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00015628_002.png | 00015628 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00015628_002.png | 00015628 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00015863_000.png | 00015863 | E4L | `E4L-00015863-openrouter-google_gemini-2.5-flash` | Mass | Cardiomegaly, Effusion | ok | no | 0.00 | Cardiomegaly, Effusion | Mass |
| 00015863_001.png | 00015863 | E4L | `E4L-00015863-openrouter-google_gemini-2.5-flash` | Atelectasis, Infiltration | No Finding | ok | no | 0.00 | — | Atelectasis, Infiltration |
| 00015863_002.png | 00015863 | E4L | `E4L-00015863-openrouter-google_gemini-2.5-flash` | Mass | Atelectasis, Cardiomegaly, Edema, Mass, Pneumonia | ok | no | 0.20 | Atelectasis, Cardiomegaly, Edema, Pneumonia | — |
| 00016012_000.png | 00016012 | E4L | `E4L-00016012-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016012_001.png | 00016012 | E4L | `E4L-00016012-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016012_002.png | 00016012 | E4L | `E4L-00016012-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00016054_000.png | 00016054 | E4L | `E4L-00016054-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016054_001.png | 00016054 | E4L | `E4L-00016054-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016054_002.png | 00016054 | E4L | `E4L-00016054-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016291_006.png | 00016291 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Edema, Effusion, Infiltration | Edema, Pneumonia | ok | no | 0.25 | Pneumonia | Effusion, Infiltration |
| 00016291_006.png | 00016291 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Edema, Effusion, Infiltration | No Finding | ok | no | 0.00 | — | Edema, Effusion, Infiltration |
| 00016351_000.png | 00016351 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016351_000.png | 00016351 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016414_002.png | 00016414 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Cardiomegaly | Cardiomegaly, Fibrosis | ok | no | 0.50 | Fibrosis | — |
| 00016414_002.png | 00016414 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Cardiomegaly | Edema, Fibrosis | ok | no | 0.00 | Edema, Fibrosis | Cardiomegaly |
| 00016493_000.png | 00016493 | E4L | `E4L-00016493-openrouter-google_gemini-2.5-flash` | No Finding | Nodule | ok | no | 0.00 | Nodule | — |
| 00016493_001.png | 00016493 | E4L | `E4L-00016493-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00016493_002.png | 00016493 | E4L | `E4L-00016493-openrouter-google_gemini-2.5-flash` | Effusion | No Finding | ok | no | 0.00 | — | Effusion |
| 00016493_003.png | 00016493 | E4L | `E4L-00016493-openrouter-google_gemini-2.5-flash` | Effusion, Infiltration | No Finding | ok | no | 0.00 | — | Effusion, Infiltration |
| 00017443_004.png | 00017443 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00017443_004.png | 00017443 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00017802_001.png | 00017802 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00017802_001.png | 00017802 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00018610_009.png | 00018610 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Consolidation, Mass, Pneumothorax | ok | no | 0.00 | Consolidation, Mass, Pneumothorax | Atelectasis, Effusion |
| 00018610_009.png | 00018610 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Effusion, Emphysema, Mass | ok | no | 0.25 | Emphysema, Mass | Atelectasis |
| 00018680_015.png | 00018680 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00018680_015.png | 00018680 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00018960_008.png | 00018960 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00018960_008.png | 00018960 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00019169_019.png | 00019169 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019169_019.png | 00019169 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Pleural_Thickening | No Finding | ok | no | 0.00 | — | Pleural_Thickening |
| 00019238_009.png | 00019238 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Atelectasis, Cardiomegaly, Consolidation, Edema, Effusion | ok | no | 0.14 | Cardiomegaly, Consolidation, Edema, Effusion | Emphysema, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Effusion, Emphysema | ok | no | 0.25 | Effusion | Atelectasis, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Consolidation, Emphysema, Pneumothorax | ok | no | 0.20 | Consolidation, Pneumothorax | Atelectasis, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Effusion, Pneumothorax | ok | no | 0.00 | Effusion, Pneumothorax | Atelectasis, Emphysema, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Atelectasis, Effusion, Pneumothorax | ok | no | 0.20 | Effusion, Pneumothorax | Emphysema, Mass |
| 00019238_009.png | 00019238 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema, Mass | Atelectasis, Cardiomegaly, Edema, Effusion, Mass | ok | no | 0.33 | Cardiomegaly, Edema, Effusion | Emphysema |
| 00019274_000.png | 00019274 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00019274_000.png | 00019274 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00019610_007.png | 00019610 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema | Pneumonia | ok | no | 0.00 | Pneumonia | Atelectasis, Emphysema |
| 00019610_007.png | 00019610 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Emphysema | No Finding | ok | no | 0.00 | — | Atelectasis, Emphysema |
| 00019779_000.png | 00019779 | E4L | `E4L-00019779-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00019779_001.png | 00019779 | E4L | `E4L-00019779-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00019779_002.png | 00019779 | E4L | `E4L-00019779-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00019926_000.png | 00019926 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration, Mass | No Finding | ok | no | 0.00 | — | Infiltration, Mass |
| 00019926_000.png | 00019926 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration, Mass | Pneumonia | ok | no | 0.00 | Pneumonia | Infiltration, Mass |
| 00019939_000.png | 00019939 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00019939_000.png | 00019939 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00019940_000.png | 00019940 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00019940_000.png | 00019940 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | Atelectasis, Infiltration | ok | no | 0.50 | Atelectasis | — |
| 00021748_002.png | 00021748 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00021748_002.png | 00021748 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00021748_002.png | 00021748 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00021748_002.png | 00021748 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00021807_000.png | 00021807 | E4L | `E4L-00021807-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion, Infiltration | No Finding | ok | no | 0.00 | — | Atelectasis, Effusion, Infiltration |
| 00021807_001.png | 00021807 | E4L | `E4L-00021807-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | No Finding | ok | no | 0.00 | — | Atelectasis, Effusion |
| 00021807_002.png | 00021807 | E4L | `E4L-00021807-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00022134_000.png | 00022134 | E4L | `E4L-00022134-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00022134_001.png | 00022134 | E4L | `E4L-00022134-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00022134_002.png | 00022134 | E4L | `E4L-00022134-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00022202_000.png | 00022202 | E4L | `E4L-00022202-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00022202_001.png | 00022202 | E4L | `E4L-00022202-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00022202_002.png | 00022202 | E4L | `E4L-00022202-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00022369_010.png | 00022369 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Atelectasis, Cardiomegaly, Consolidation, Edema, Effusion, Pneumothorax | ok | no | 0.33 | Cardiomegaly, Consolidation, Edema, Pneumothorax | — |
| 00022369_010.png | 00022369 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Consolidation, Edema, Effusion, Infiltration, Pneumonia | ok | no | 0.17 | Consolidation, Edema, Infiltration, Pneumonia | Atelectasis |
| 00022519_004.png | 00022519 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00022519_004.png | 00022519 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00022519_004.png | 00022519 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | Fibrosis | ok | no | 0.00 | Fibrosis | Infiltration |
| 00022519_004.png | 00022519 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00022682_000.png | 00022682 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | Infiltration |
| 00022682_000.png | 00022682 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00022764_006.png | 00022764 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Effusion | Hernia, Mass | ok | no | 0.00 | Hernia, Mass | Effusion |
| 00022764_006.png | 00022764 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Effusion | Hernia, Mass | ok | no | 0.00 | Hernia, Mass | Effusion |
| 00022764_006.png | 00022764 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Effusion | Atelectasis, Hernia, Mass | ok | no | 0.00 | Atelectasis, Hernia, Mass | Effusion |
| 00022764_006.png | 00022764 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Effusion | Hernia, Mass, Pneumothorax | ok | no | 0.00 | Hernia, Mass, Pneumothorax | Effusion |
| 00023092_000.png | 00023092 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023092_000.png | 00023092 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023092_000.png | 00023092 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023092_000.png | 00023092 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023143_000.png | 00023143 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023143_000.png | 00023143 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00023143_000.png | 00023143 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | Effusion, Pneumonia, Pneumothorax | ok | no | 0.00 | Effusion, Pneumonia, Pneumothorax | — |
| 00023143_000.png | 00023143 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024149_000.png | 00024149 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024149_000.png | 00024149 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024258_000.png | 00024258 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024258_000.png | 00024258 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024750_000.png | 00024750 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024750_000.png | 00024750 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024750_000.png | 00024750 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00024750_000.png | 00024750 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00025495_004.png | 00025495 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Atelectasis, Edema, Effusion, Pneumonia, Pneumothorax | ok | no | 0.40 | Edema, Pneumonia, Pneumothorax | — |
| 00025495_004.png | 00025495 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Effusion | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pneumothorax | ok | no | 0.40 | Cardiomegaly, Consolidation, Pneumothorax | — |
| 00026237_000.png | 00026237 | E4L | `E4L-00026237-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00026237_001.png | 00026237 | E4L | `E4L-00026237-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00026237_002.png | 00026237 | E4L | `E4L-00026237-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00026714_000.png | 00026714 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00026714_000.png | 00026714 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00026971_015.png | 00026971 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00026971_015.png | 00026971 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027141_000.png | 00027141 | E4L | `E4L-00027141-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00027141_001.png | 00027141 | E4L | `E4L-00027141-openrouter-google_gemini-2.5-flash` | Fibrosis, Pleural_Thickening | No Finding | ok | no | 0.00 | — | Fibrosis, Pleural_Thickening |
| 00027141_002.png | 00027141 | E4L | `E4L-00027141-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00027141_003.png | 00027141 | E4L | `E4L-00027141-openrouter-google_gemini-2.5-flash` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00027163_000.png | 00027163 | E2 | `E2-S2x5-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S2x5-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027163_000.png | 00027163 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027230_000.png | 00027230 | E4L | `E4L-00027230-openrouter-google_gemini-2.5-flash` | Consolidation, Mass | No Finding | ok | no | 0.00 | — | Consolidation, Mass |
| 00027230_001.png | 00027230 | E4L | `E4L-00027230-openrouter-google_gemini-2.5-flash` | Mass | No Finding | ok | no | 0.00 | — | Mass |
| 00027230_002.png | 00027230 | E4L | `E4L-00027230-openrouter-google_gemini-2.5-flash` | Mass | No Finding | ok | no | 0.00 | — | Mass |
| 00027230_003.png | 00027230 | E4L | `E4L-00027230-openrouter-google_gemini-2.5-flash` | Mass | No Finding | ok | no | 0.00 | — | Mass |
| 00027706_037.png | 00027706 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00027706_037.png | 00027706 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | Effusion, Pneumonia, Pneumothorax | ok | no | 0.00 | Effusion, Pneumonia, Pneumothorax | — |
| 00028504_001.png | 00028504 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00028504_001.png | 00028504 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00028504_001.png | 00028504 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00028504_001.png | 00028504 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00028530_000.png | 00028530 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00028530_000.png | 00028530 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | No Finding | Pneumonia, Pneumothorax | ok | no | 0.00 | Pneumonia, Pneumothorax | — |
| 00029278_002.png | 00029278 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00029278_002.png | 00029278 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00029278_002.png | 00029278 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00029278_002.png | 00029278 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00029872_000.png | 00029872 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Consolidation | No Finding | ok | no | 0.00 | — | Consolidation |
| 00029872_000.png | 00029872 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Consolidation | No Finding | ok | no | 0.00 | — | Consolidation |
| 00029872_000.png | 00029872 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Consolidation | Emphysema, Fibrosis | ok | no | 0.00 | Emphysema, Fibrosis | Consolidation |
| 00029872_000.png | 00029872 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Consolidation | No Finding | ok | no | 0.00 | — | Consolidation |
| 00029998_005.png | 00029998 | E2 | `E2-S3x10-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Pneumothorax | Atelectasis, Effusion, Pleural_Thickening | ok | no | 0.25 | Effusion, Pleural_Thickening | Pneumothorax |
| 00029998_005.png | 00029998 | E2 | `E2-S3x10-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Pneumothorax | Atelectasis, Cardiomegaly, Edema, Effusion, Pneumothorax | ok | no | 0.40 | Cardiomegaly, Edema, Effusion | — |
| 00029998_005.png | 00029998 | E2 | `E2-S4x20-c1-openrouter-google_gemini-2.5-flash` | Atelectasis, Pneumothorax | Atelectasis, Cardiomegaly, Effusion, Pneumothorax | ok | no | 0.50 | Cardiomegaly, Effusion | — |
| 00029998_005.png | 00029998 | E2 | `E2-S4x20-c5-openrouter-google_gemini-2.5-flash` | Atelectasis, Pneumothorax | Atelectasis, Cardiomegaly, Consolidation, Effusion, Pneumonia, Pneumothorax | ok | no | 0.33 | Cardiomegaly, Consolidation, Effusion, Pneumonia | — |

### openrouter/google/gemma-4-31b-it

| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |
|---|---|---|---|---|---|---|---|---|---|---|
| 00000008_000.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemma-4-31b-it` | Cardiomegaly | — | invalid | — | — | — | — |
| 00000008_001.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000008_002.png | 00000008 | E4 | `E4-00000008-openrouter-google_gemma-4-31b-it` | Nodule | No Finding | ok | no | 0.00 | — | Nodule |
| 00000067_000.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemma-4-31b-it` | Fibrosis | — | invalid | — | — | — | — |
| 00000067_001.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemma-4-31b-it` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000067_002.png | 00000067 | E4 | `E4-00000067-openrouter-google_gemma-4-31b-it` | No Finding | — | invalid | — | — | — | — |
| 00000086_000.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemma-4-31b-it` | No Finding | — | invalid | — | — | — | — |
| 00000086_001.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemma-4-31b-it` | Emphysema | — | invalid | — | — | — | — |
| 00000086_002.png | 00000086 | E4 | `E4-00000086-openrouter-google_gemma-4-31b-it` | Atelectasis | Effusion | ok | no | 0.00 | Effusion | Atelectasis |
| 00000092_000.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemma-4-31b-it` | No Finding | Edema, Effusion, Fibrosis | ok | no | 0.00 | Edema, Effusion, Fibrosis | — |
| 00000092_001.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemma-4-31b-it` | Effusion, Fibrosis | — | invalid | — | — | — | — |
| 00000092_002.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemma-4-31b-it` | Fibrosis | Cardiomegaly, Effusion | ok | no | 0.00 | Cardiomegaly, Effusion | Fibrosis |
| 00000092_003.png | 00000092 | E4 | `E4-00000092-openrouter-google_gemma-4-31b-it` | Fibrosis | — | invalid | — | — | — | — |
| 00000148_000.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemma-4-31b-it` | No Finding | — | invalid | — | — | — | — |
| 00000148_001.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemma-4-31b-it` | Effusion | — | invalid | — | — | — | — |
| 00000148_002.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemma-4-31b-it` | Effusion, Fibrosis | Mass | ok | no | 0.00 | Mass | Effusion, Fibrosis |
| 00000148_003.png | 00000148 | E4 | `E4-00000148-openrouter-google_gemma-4-31b-it` | No Finding | — | invalid | — | — | — | — |
| 00000219_000.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemma-4-31b-it` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_001.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemma-4-31b-it` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_002.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000219_003.png | 00000219 | E4 | `E4-00000219-openrouter-google_gemma-4-31b-it` | No Finding | Cardiomegaly | ok | no | 0.00 | Cardiomegaly | — |
| 00000239_000.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_001.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_002.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | Infiltration | — | invalid | — | — | — | — |
| 00000239_003.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_004.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | No Finding | — | invalid | — | — | — | — |
| 00000239_005.png | 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000296_000.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemma-4-31b-it` | Pneumothorax | Effusion, Pneumothorax | ok | no | 0.50 | Effusion | — |
| 00000296_001.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemma-4-31b-it` | Emphysema | — | invalid | — | — | — | — |
| 00000296_002.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemma-4-31b-it` | Pneumothorax | Effusion, Pneumothorax | ok | no | 0.50 | Effusion | — |
| 00000296_003.png | 00000296 | E4 | `E4-00000296-openrouter-google_gemma-4-31b-it` | No Finding | No Finding | ok | yes | 1.00 | — | — |

### openrouter/qwen/qwen3-vl-235b-a22b-instruct

| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |
|---|---|---|---|---|---|---|---|---|---|---|
| 00000008_000.png | 00000008 | E4 | `E4-00000008-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Cardiomegaly | No Finding | ok | no | 0.00 | — | Cardiomegaly |
| 00000008_001.png | 00000008 | E4 | `E4-00000008-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000008_002.png | 00000008 | E4 | `E4-00000008-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Nodule | No Finding | ok | no | 0.00 | — | Nodule |
| 00000067_000.png | 00000067 | E4 | `E4-00000067-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Fibrosis | No Finding | ok | no | 0.00 | — | Fibrosis |
| 00000067_001.png | 00000067 | E4 | `E4-00000067-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000067_002.png | 00000067 | E4 | `E4-00000067-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000086_000.png | 00000086 | E4 | `E4-00000086-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000086_001.png | 00000086 | E4 | `E4-00000086-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00000086_002.png | 00000086 | E4 | `E4-00000086-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000092_000.png | 00000092 | E4 | `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000092_001.png | 00000092 | E4 | `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Effusion, Fibrosis | No Finding | ok | no | 0.00 | — | Effusion, Fibrosis |
| 00000092_002.png | 00000092 | E4 | `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Fibrosis | No Finding | ok | no | 0.00 | — | Fibrosis |
| 00000092_003.png | 00000092 | E4 | `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Fibrosis | No Finding | ok | no | 0.00 | — | Fibrosis |
| 00000148_000.png | 00000148 | E4 | `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000148_001.png | 00000148 | E4 | `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Effusion | Nodule | ok | no | 0.00 | Nodule | Effusion |
| 00000148_002.png | 00000148 | E4 | `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Effusion, Fibrosis | Nodule | ok | no | 0.00 | Nodule | Effusion, Fibrosis |
| 00000148_003.png | 00000148 | E4 | `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000219_000.png | 00000219 | E4 | `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_001.png | 00000219 | E4 | `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Atelectasis | No Finding | ok | no | 0.00 | — | Atelectasis |
| 00000219_002.png | 00000219 | E4 | `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000219_003.png | 00000219 | E4 | `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_000.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_001.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_002.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Infiltration | No Finding | ok | no | 0.00 | — | Infiltration |
| 00000239_003.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_004.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000239_005.png | 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |
| 00000296_000.png | 00000296 | E4 | `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00000296_001.png | 00000296 | E4 | `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Emphysema | No Finding | ok | no | 0.00 | — | Emphysema |
| 00000296_002.png | 00000296 | E4 | `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | Pneumothorax | No Finding | ok | no | 0.00 | — | Pneumothorax |
| 00000296_003.png | 00000296 | E4 | `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | No Finding | No Finding | ok | yes | 1.00 | — | — |

## Per-class metrics per model

### google/gemini-2.5-flash

Images: 20 total, 10 usable for metrics (excluded: 0 invalid-output, 10 API error, 0 malformed, 0 missing ground truth).

Exact-set match rate: **50.0%** (5/10). Mean Jaccard: **0.500**.

"No Finding" sensitivity (of truly-normal images, % predicted normal): **71.4%**. "No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **0.0%**.

| class | TP | FP | FN | TN | support | precision | recall | F1 |
|---|---|---|---|---|---|---|---|---|
| Atelectasis | 0 | 1 | 1 | 8 | 1 | 0.000 | 0.000 | — |
| Cardiomegaly | 0 | 1 | 0 | 9 | 0 | 0.000 | — | — |
| Effusion | 0 | 1 | 0 | 9 | 0 | 0.000 | — | — |
| Infiltration | 0 | 0 | 1 | 9 | 1 | — | 0.000 | — |
| Mass | 0 | 0 | 1 | 9 | 1 | — | 0.000 | — |
| Nodule | 0 | 0 | 0 | 10 | 0 | — | — | — |
| Pneumonia | 0 | 0 | 0 | 10 | 0 | — | — | — |
| Pneumothorax | 0 | 1 | 0 | 9 | 0 | 0.000 | — | — |
| Consolidation | 0 | 0 | 0 | 10 | 0 | — | — | — |
| Edema | 0 | 0 | 0 | 10 | 0 | — | — | — |
| Emphysema | 0 | 0 | 1 | 9 | 1 | — | 0.000 | — |
| Fibrosis | 0 | 0 | 0 | 10 | 0 | — | — | — |
| Pleural_Thickening | 0 | 0 | 1 | 9 | 1 | — | 0.000 | — |
| Hernia | 0 | 1 | 0 | 9 | 0 | 0.000 | — | — |
| **macro avg** | | | | | | 0.000 | 0.000 | — |
| **micro avg** | | | | | | 0.000 | 0.000 | — |

### openrouter/anthropic/claude-sonnet-5

Images: 31 total, 31 usable for metrics (excluded: 0 invalid-output, 0 API error, 0 malformed, 0 missing ground truth).

Exact-set match rate: **25.8%** (8/31). Mean Jaccard: **0.271**.

"No Finding" sensitivity (of truly-normal images, % predicted normal): **57.1%**. "No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **70.6%**.

| class | TP | FP | FN | TN | support | precision | recall | F1 |
|---|---|---|---|---|---|---|---|---|
| Atelectasis | 0 | 4 | 4 | 23 | 4 | 0.000 | 0.000 | — |
| Cardiomegaly | 0 | 7 | 1 | 23 | 1 | 0.000 | 0.000 | — |
| Effusion | 1 | 5 | 2 | 23 | 3 | 0.167 | 0.333 | 0.222 |
| Infiltration | 0 | 0 | 1 | 30 | 1 | — | 0.000 | — |
| Mass | 0 | 2 | 0 | 29 | 0 | 0.000 | — | — |
| Nodule | 0 | 2 | 1 | 28 | 1 | 0.000 | 0.000 | — |
| Pneumonia | 0 | 2 | 0 | 29 | 0 | 0.000 | — | — |
| Pneumothorax | 1 | 1 | 1 | 28 | 2 | 0.500 | 0.500 | 0.500 |
| Consolidation | 0 | 4 | 0 | 27 | 0 | 0.000 | — | — |
| Edema | 0 | 6 | 0 | 25 | 0 | 0.000 | — | — |
| Emphysema | 0 | 0 | 2 | 29 | 2 | — | 0.000 | — |
| Fibrosis | 0 | 1 | 5 | 25 | 5 | 0.000 | 0.000 | — |
| Pleural_Thickening | 0 | 1 | 0 | 30 | 0 | 0.000 | — | — |
| Hernia | 0 | 4 | 0 | 27 | 0 | 0.000 | — | — |
| **macro avg** | | | | | | 0.056 | 0.104 | 0.361 |
| **micro avg** | | | | | | 0.049 | 0.105 | 0.067 |

### openrouter/google/gemini-2.5-flash

Images: 345 total, 345 usable for metrics (excluded: 0 invalid-output, 0 API error, 0 malformed, 0 missing ground truth).

Exact-set match rate: **48.4%** (167/345). Mean Jaccard: **0.505**.

"No Finding" sensitivity (of truly-normal images, % predicted normal): **86.9%**. "No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **36.4%**.

| class | TP | FP | FN | TN | support | precision | recall | F1 |
|---|---|---|---|---|---|---|---|---|
| Atelectasis | 11 | 14 | 31 | 289 | 42 | 0.440 | 0.262 | 0.328 |
| Cardiomegaly | 1 | 28 | 2 | 314 | 3 | 0.034 | 0.333 | 0.063 |
| Effusion | 8 | 35 | 16 | 286 | 24 | 0.186 | 0.333 | 0.239 |
| Infiltration | 3 | 2 | 51 | 289 | 54 | 0.600 | 0.056 | 0.102 |
| Mass | 2 | 8 | 16 | 319 | 18 | 0.200 | 0.111 | 0.143 |
| Nodule | 0 | 3 | 7 | 335 | 7 | 0.000 | 0.000 | — |
| Pneumonia | 0 | 19 | 2 | 324 | 2 | 0.000 | 0.000 | — |
| Pneumothorax | 3 | 16 | 5 | 321 | 8 | 0.158 | 0.375 | 0.222 |
| Consolidation | 1 | 18 | 10 | 316 | 11 | 0.053 | 0.091 | 0.067 |
| Edema | 1 | 17 | 3 | 324 | 4 | 0.056 | 0.250 | 0.091 |
| Emphysema | 2 | 5 | 15 | 323 | 17 | 0.286 | 0.118 | 0.167 |
| Fibrosis | 0 | 11 | 7 | 327 | 7 | 0.000 | 0.000 | — |
| Pleural_Thickening | 0 | 4 | 10 | 331 | 10 | 0.000 | 0.000 | — |
| Hernia | 0 | 4 | 0 | 341 | 0 | 0.000 | — | — |
| **macro avg** | | | | | | 0.144 | 0.148 | 0.158 |
| **micro avg** | | | | | | 0.148 | 0.155 | 0.151 |

### openrouter/google/gemma-4-31b-it

Images: 31 total, 18 usable for metrics (excluded: 13 invalid-output, 0 API error, 0 malformed, 0 missing ground truth).

Exact-set match rate: **38.9%** (7/18). Mean Jaccard: **0.444**.

"No Finding" sensitivity (of truly-normal images, % predicted normal): **77.8%**. "No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **55.6%**.

| class | TP | FP | FN | TN | support | precision | recall | F1 |
|---|---|---|---|---|---|---|---|---|
| Atelectasis | 0 | 0 | 4 | 14 | 4 | — | 0.000 | — |
| Cardiomegaly | 0 | 2 | 0 | 16 | 0 | 0.000 | — | — |
| Effusion | 0 | 5 | 1 | 12 | 1 | 0.000 | 0.000 | — |
| Infiltration | 0 | 0 | 0 | 18 | 0 | — | — | — |
| Mass | 0 | 1 | 0 | 17 | 0 | 0.000 | — | — |
| Nodule | 0 | 0 | 1 | 17 | 1 | — | 0.000 | — |
| Pneumonia | 0 | 0 | 0 | 18 | 0 | — | — | — |
| Pneumothorax | 2 | 0 | 0 | 16 | 2 | 1.000 | 1.000 | 1.000 |
| Consolidation | 0 | 0 | 0 | 18 | 0 | — | — | — |
| Edema | 0 | 1 | 0 | 17 | 0 | 0.000 | — | — |
| Emphysema | 0 | 0 | 0 | 18 | 0 | — | — | — |
| Fibrosis | 0 | 1 | 2 | 15 | 2 | 0.000 | 0.000 | — |
| Pleural_Thickening | 0 | 0 | 0 | 18 | 0 | — | — | — |
| Hernia | 0 | 0 | 0 | 18 | 0 | — | — | — |
| **macro avg** | | | | | | 0.167 | 0.200 | 1.000 |
| **micro avg** | | | | | | 0.167 | 0.200 | 0.182 |

### openrouter/qwen/qwen3-vl-235b-a22b-instruct

Images: 31 total, 31 usable for metrics (excluded: 0 invalid-output, 0 API error, 0 malformed, 0 missing ground truth).

Exact-set match rate: **45.2%** (14/31). Mean Jaccard: **0.452**.

"No Finding" sensitivity (of truly-normal images, % predicted normal): **100.0%**. "No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **11.8%**.

| class | TP | FP | FN | TN | support | precision | recall | F1 |
|---|---|---|---|---|---|---|---|---|
| Atelectasis | 0 | 0 | 4 | 27 | 4 | — | 0.000 | — |
| Cardiomegaly | 0 | 0 | 1 | 30 | 1 | — | 0.000 | — |
| Effusion | 0 | 0 | 3 | 28 | 3 | — | 0.000 | — |
| Infiltration | 0 | 0 | 1 | 30 | 1 | — | 0.000 | — |
| Mass | 0 | 0 | 0 | 31 | 0 | — | — | — |
| Nodule | 0 | 2 | 1 | 28 | 1 | 0.000 | 0.000 | — |
| Pneumonia | 0 | 0 | 0 | 31 | 0 | — | — | — |
| Pneumothorax | 0 | 0 | 2 | 29 | 2 | — | 0.000 | — |
| Consolidation | 0 | 0 | 0 | 31 | 0 | — | — | — |
| Edema | 0 | 0 | 0 | 31 | 0 | — | — | — |
| Emphysema | 0 | 0 | 2 | 29 | 2 | — | 0.000 | — |
| Fibrosis | 0 | 0 | 5 | 26 | 5 | — | 0.000 | — |
| Pleural_Thickening | 0 | 0 | 0 | 31 | 0 | — | — | — |
| Hernia | 0 | 0 | 0 | 31 | 0 | — | — | — |
| **macro avg** | | | | | | 0.000 | 0.000 | — |
| **micro avg** | | | | | | 0.000 | 0.000 | — |

## Per-patient trajectory direction agreement (E4 / E4L only)

Direction is derived from the first vs. last study's NIH labels for the patient's cohort sequence (worsening: normal→pathology; improving: pathology→normal; stable-normal: normal throughout; stable-pathology: pathology at both ends with class overlap; mixed-pathology-change: pathology at both ends with no overlapping class — an extension beyond the spec's four named buckets, mapped to "Inconclusive" below since it is neither a clean worsening nor improving nor a repeat finding). E4L reuses the pre-computed `stratum` from `nih-selection.json` when present; E4 always derives.

**A row is scored whenever the evolution artefact's top-level `progression` is a valid `ProgressionStatus` value, even if `validation.ok` is false.** When a sibling field (in practice `trends[].trend`) carries an out-of-enum value the whole record fails Zod validation, but the pipeline's partial-JSON fallback still takes the model's own top-level verdict verbatim, so that verdict is a real direction label and is scored here. Such rows are flagged `recovered` in the table below and counted in `directionByModel[].recoveredCount` in the JSON sibling. Only an absent `progression`, a non-enum value, or an unreadable artefact leaves a row unscored ("(no valid evolution artefact)").

Direction rows scored via that recovered path: **6** of 52.

### Per-patient table

| patient | cohort | run id | model | stratum source | direction | expected progression | model progression | progression source | agree |
|---|---|---|---|---|---|---|---|---|---|
| 00000008 | E4 | `E4-00000008-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | mixed-pathology-change | Inconclusive | Worsening | validated | no |
| 00000008 | E4 | `E4-00000008-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | mixed-pathology-change | Inconclusive | Improving | validated | no |
| 00000008 | E4 | `E4-00000008-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | mixed-pathology-change | Inconclusive | Inconclusive | validated | yes |
| 00000008 | E4 | `E4-00000008-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | mixed-pathology-change | Inconclusive | Stable | validated | no |
| 00000067 | E4 | `E4-00000067-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | improving | Improving | Stable | validated | no |
| 00000067 | E4 | `E4-00000067-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | improving | Improving | Stable | validated | no |
| 00000067 | E4 | `E4-00000067-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | improving | Improving | Stable | validated | no |
| 00000067 | E4 | `E4-00000067-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | improving | Improving | Stable | validated | no |
| 00000086 | E4 | `E4-00000086-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | worsening | Worsening | Improving | validated | no |
| 00000086 | E4 | `E4-00000086-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | worsening | Worsening | Worsening | recovered | yes |
| 00000086 | E4 | `E4-00000086-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | worsening | Worsening | Worsening | validated | yes |
| 00000086 | E4 | `E4-00000086-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | worsening | Worsening | Stable | validated | no |
| 00000092 | E4 | `E4-00000092-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | worsening | Worsening | Worsening | validated | yes |
| 00000092 | E4 | `E4-00000092-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | worsening | Worsening | Worsening | validated | yes |
| 00000092 | E4 | `E4-00000092-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | worsening | Worsening | Inconclusive | validated | no |
| 00000092 | E4 | `E4-00000092-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | worsening | Worsening | Stable | validated | no |
| 00000148 | E4 | `E4-00000148-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | stable-normal | Stable | Stable | recovered | yes |
| 00000148 | E4 | `E4-00000148-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | stable-normal | Stable | Improving | validated | no |
| 00000148 | E4 | `E4-00000148-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | stable-normal | Stable | Improving | validated | no |
| 00000148 | E4 | `E4-00000148-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | stable-normal | Stable | Stable | validated | yes |
| 00000219 | E4 | `E4-00000219-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | improving | Improving | Improving | validated | yes |
| 00000219 | E4 | `E4-00000219-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | improving | Improving | Stable | validated | no |
| 00000219 | E4 | `E4-00000219-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | improving | Improving | Worsening | validated | no |
| 00000219 | E4 | `E4-00000219-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | improving | Improving | Stable | validated | no |
| 00000239 | E4 | `E4-00000239-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | stable-normal | Stable | Worsening | validated | no |
| 00000239 | E4 | `E4-00000239-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | stable-normal | Stable | Worsening | validated | no |
| 00000239 | E4 | `E4-00000239-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | stable-normal | Stable | Worsening | validated | no |
| 00000239 | E4 | `E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | stable-normal | Stable | Stable | validated | yes |
| 00000296 | E4 | `E4-00000296-openrouter-anthropic_claude-sonnet-5` | openrouter/anthropic/claude-sonnet-5 | derived | improving | Improving | Inconclusive | validated | no |
| 00000296 | E4 | `E4-00000296-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | derived | improving | Improving | Improving | validated | yes |
| 00000296 | E4 | `E4-00000296-openrouter-google_gemma-4-31b-it` | openrouter/google/gemma-4-31b-it | derived | improving | Improving | Inconclusive | validated | no |
| 00000296 | E4 | `E4-00000296-openrouter-qwen_qwen3-vl-235b-a22b-instruct` | openrouter/qwen/qwen3-vl-235b-a22b-instruct | derived | improving | Improving | Stable | validated | no |
| 00003158 | E4L | `E4L-00003158-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | improving | Improving | Stable | validated | no |
| 00003295 | E4L | `E4L-00003295-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-normal | Stable | Stable | validated | yes |
| 00003980 | E4L | `E4L-00003980-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-normal | Stable | Inconclusive | recovered | no |
| 00004946 | E4L | `E4L-00004946-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | improving | Improving | Worsening | validated | no |
| 00005852 | E4L | `E4L-00005852-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | improving | Improving | Improving | validated | yes |
| 00011264 | E4L | `E4L-00011264-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | worsening | Worsening | Stable | validated | no |
| 00013880 | E4L | `E4L-00013880-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-pathology | Stable | Worsening | recovered | no |
| 00015192 | E4L | `E4L-00015192-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | worsening | Worsening | Stable | validated | no |
| 00015553 | E4L | `E4L-00015553-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-normal | Stable | Improving | validated | no |
| 00015863 | E4L | `E4L-00015863-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-pathology | Stable | Worsening | validated | no |
| 00016012 | E4L | `E4L-00016012-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | worsening | Worsening | Stable | validated | no |
| 00016054 | E4L | `E4L-00016054-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-normal | Stable | Stable | validated | yes |
| 00016493 | E4L | `E4L-00016493-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | worsening | Worsening | Worsening | recovered | yes |
| 00019779 | E4L | `E4L-00019779-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-pathology | Stable | Stable | recovered | yes |
| 00021807 | E4L | `E4L-00021807-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | improving | Improving | Improving | validated | yes |
| 00022134 | E4L | `E4L-00022134-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | improving | Improving | Stable | validated | no |
| 00022202 | E4L | `E4L-00022202-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | worsening | Worsening | Stable | validated | no |
| 00026237 | E4L | `E4L-00026237-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-normal | Stable | Stable | validated | yes |
| 00027141 | E4L | `E4L-00027141-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-pathology | Stable | Stable | validated | yes |
| 00027230 | E4L | `E4L-00027230-openrouter-google_gemini-2.5-flash` | openrouter/google/gemini-2.5-flash | provided | stable-pathology | Stable | Stable | validated | yes |

### Agreement rate per model

| model | patients | agreement rate | of which recovered |
|---|---|---|---|
| openrouter/anthropic/claude-sonnet-5 | 8 | 37.5% | 1 |
| openrouter/google/gemini-2.5-flash | 28 | 42.9% | 5 |
| openrouter/google/gemma-4-31b-it | 8 | 25.0% | 0 |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | 8 | 25.0% | 0 |

### Agreement rate per model × derived direction bucket

| model | direction bucket | patients | agreement rate | of which recovered |
|---|---|---|---|---|
| openrouter/anthropic/claude-sonnet-5 | improving | 3 | 33.3% | 0 |
| openrouter/anthropic/claude-sonnet-5 | mixed-pathology-change | 1 | 0.0% | 0 |
| openrouter/anthropic/claude-sonnet-5 | stable-normal | 2 | 50.0% | 1 |
| openrouter/anthropic/claude-sonnet-5 | worsening | 2 | 50.0% | 0 |
| openrouter/google/gemini-2.5-flash | improving | 8 | 37.5% | 0 |
| openrouter/google/gemini-2.5-flash | mixed-pathology-change | 1 | 0.0% | 0 |
| openrouter/google/gemini-2.5-flash | stable-normal | 7 | 42.9% | 1 |
| openrouter/google/gemini-2.5-flash | stable-pathology | 5 | 60.0% | 2 |
| openrouter/google/gemini-2.5-flash | worsening | 7 | 42.9% | 2 |
| openrouter/google/gemma-4-31b-it | improving | 3 | 0.0% | 0 |
| openrouter/google/gemma-4-31b-it | mixed-pathology-change | 1 | 100.0% | 0 |
| openrouter/google/gemma-4-31b-it | stable-normal | 2 | 0.0% | 0 |
| openrouter/google/gemma-4-31b-it | worsening | 2 | 50.0% | 0 |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | improving | 3 | 0.0% | 0 |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | mixed-pathology-change | 1 | 0.0% | 0 |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | stable-normal | 2 | 100.0% | 0 |
| openrouter/qwen/qwen3-vl-235b-a22b-instruct | worsening | 2 | 0.0% | 0 |

### Confusion matrix per model (expected progression → model progression)

**openrouter/anthropic/claude-sonnet-5**

| expected \ model | Improving | Stable | Worsening | Inconclusive | (no valid evolution artefact) |
|---|---|---|---|---|---|
| Improving | 1 | 1 | 0 | 1 | 0 |
| Stable | 0 | 1 | 1 | 0 | 0 |
| Worsening | 1 | 0 | 1 | 0 | 0 |
| Inconclusive | 0 | 0 | 1 | 0 | 0 |

**openrouter/google/gemini-2.5-flash**

| expected \ model | Improving | Stable | Worsening | Inconclusive | (no valid evolution artefact) |
|---|---|---|---|---|---|
| Improving | 3 | 4 | 1 | 0 | 0 |
| Stable | 2 | 6 | 3 | 1 | 0 |
| Worsening | 0 | 4 | 3 | 0 | 0 |
| Inconclusive | 1 | 0 | 0 | 0 | 0 |

**openrouter/google/gemma-4-31b-it**

| expected \ model | Improving | Stable | Worsening | Inconclusive | (no valid evolution artefact) |
|---|---|---|---|---|---|
| Improving | 0 | 1 | 1 | 1 | 0 |
| Stable | 1 | 0 | 1 | 0 | 0 |
| Worsening | 0 | 0 | 1 | 1 | 0 |
| Inconclusive | 0 | 0 | 0 | 1 | 0 |

**openrouter/qwen/qwen3-vl-235b-a22b-instruct**

| expected \ model | Improving | Stable | Worsening | Inconclusive | (no valid evolution artefact) |
|---|---|---|---|---|---|
| Improving | 0 | 3 | 0 | 0 | 0 |
| Stable | 0 | 2 | 0 | 0 | 0 |
| Worsening | 0 | 2 | 0 | 0 | 0 |
| Inconclusive | 0 | 1 | 0 | 0 | 0 |

## What this shows / what it does not

**Shows:** how often each model's free-text chest X-ray read, passed through a heuristic keyword mapper, lands on the same 14-class label set (or the same coarse worsening/improving/stable trajectory) as the NLP-mined NIH ChestX-ray14 labels for the same 224px image. Differences between models/providers in this report are internally comparable (same mapper, same reference labels, same images) even where the absolute numbers are not trustworthy in isolation.
**Does not show:** diagnostic accuracy, sensitivity/specificity of disease detection in any clinical sense, or a validated comparison to radiologist ground truth. It also cannot show performance at the image resolution used in real clinical workflows, since every image here is the 224px NIH release copy.
