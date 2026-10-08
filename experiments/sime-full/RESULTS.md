# SIME-FULL — results

Runs of 2026-09-29 (first batch, §1–§7) and 2026-10-08 (second batch, §8–§11).
Every number below is taken from [`ANALYSIS.md`](ANALYSIS.md)
and [`analysis.json`](analysis.json), which `analyze.ts` regenerates from the
committed run records (`runs/`, `results.jsonl`). The protocol is in
[`README.md`](README.md); every command is in [`REPLICATE.md`](REPLICATE.md).

## 0. Scope and honesty statement

- **Descriptive, not diagnostic.** Eight patients (31 chest radiographs, 3–6
  sessions each), the paper's E4 cohort. "Agreement" is agreement with the NIH
  labels, which were text-mined from reports (about 90 % accurate). No clinician
  reviewed any image or output. Nothing here is diagnostic accuracy, and no
  model ranking follows from it.
- **One run per model, resolution and patient in the first batch.** Models answer
  non-deterministically at their default settings (as in the paper), so §4
  measures how much a repeat run changes before any resolution effect is read.
  The second batch repeated the E4 runs of the paper's four models twice more at
  1024 px, which measures that variability directly (§8) and corrects part of §4.
- **Same code, same prompts as the paper**, plus the post-paper guardrails
  (input guard, probes, sanitiser), which only record and clean; they do not
  change what the model is asked.
- **Author:** Andrei N. Besleaga, Independent Researcher and Software Architect.
  Research and education only; see [`DISCLAIMER.md`](../../DISCLAIMER.md).

## 1. What ran

| Item | Value |
| --- | --- |
| Runs | 112 = 7 models × 2 resolutions × 8 patients |
| Runs with exit 0 | 109 |
| Runs with exit 4 (partial) | 3, all `google/gemini-3.8-flash` at 1024 px: the model returned an empty answer for 3 of 31 images |
| Sealed run records that verify (`verify-manifest`) | 112 of 112 |
| Inputs checked against the fingerprint lists before upload (`--expect-hashes`) | 112 of 112 runs, 0 mismatches |
| Provider-reported cost, all runs | USD 5.04 (the account shows USD 5.08; the USD 0.04 difference is the calls of one run interrupted when the batch was restarted in parallel and then re-run from scratch) |
| Local model | `medgemma1.5:4b` on an RTX 3060 Laptop GPU (6 GB) through Ollama, USD 0 |

The free variant `google/gemma-4-31b-it:free` was tried first and refused with
HTTP 429 ("temporarily rate-limited upstream") six times on the first patient;
the evidence is kept in [`free-tier-evidence/`](free-tier-evidence/). The paid
variant, the paper's own model, was used instead (USD 0.03 for both
resolutions). Like the paper's Google free-tier result, a free quota is not a
dependable route for an experiment.

## 2. Data checks

- The 1024-px inputs are the NIH originals byte for byte; their SHA-256 values
  are in `selection-hashes.json`.
- The paper's 224-px images (a third-party resize) and this pack's 224-px copies
  (Lanczos, from the originals) are the same pictures: the largest mean absolute
  pixel difference over the 31 images is **0.68 on a 0–255 scale**, against
  **47.77** between two different patients.
- Every NIH original carries a PNG `tIME` (timestamp) chunk. The input guard
  recorded it and the image pre-flight stripped it in all **217** full-resolution
  uploads; the pixels sent were unchanged.

## 3. Per model and resolution (ANALYSIS Table 1)

Cost is provider-reported USD for all 8 patients. Wall time is not comparable
with the paper's Table I: the six cloud models ran in parallel here, sharing one
connection, while the paper ran them one at a time.

| Model | px | Usable images | Exact NIH-label match | Direction agrees with NIH labels | Cost USD |
| --- | --- | --- | --- | --- | --- |
| MedGemma 1.5 4B (local) | 224 | 29 / 31 | 0.345 | 4 / 8 | 0 |
| MedGemma 1.5 4B (local) | 1024 | 27 / 31 | 0.407 | 5 / 8 | 0 |
| Claude Sonnet 5 | 224 | 31 / 31 | 0.129 | 3 / 8 | 0.9635 |
| Claude Sonnet 5 | 1024 | 31 / 31 | 0.194 | 2 / 8 | 1.1108 |
| Gemini 2.5 Flash | 224 | 30 / 31 | 0.400 | 3 / 8 | 0.1047 |
| Gemini 2.5 Flash | 1024 | 31 / 31 | 0.290 | 1 / 8 | 0.1178 |
| Gemini 3.1 Pro (preview) | 224 | 31 / 31 | 0.323 | 2 / 8 | 0.9571 |
| Gemini 3.1 Pro (preview) | 1024 | 31 / 31 | 0.290 | 1 / 8 | 1.1039 |
| Gemini 3.8 Flash | 224 | 31 / 31 | 0.387 | 1 / 8 | 0.2933 |
| Gemini 3.8 Flash | 1024 | 27 / 31 | 0.333 | 2 / 8 | 0.2794 |
| Gemma 4 31B | 224 | 28 / 31 | 0.357 | 2 / 8 | 0.0140 |
| Gemma 4 31B | 1024 | 28 / 31 | 0.393 | 3 / 8 | 0.0133 |
| Qwen3-VL 235B | 224 | 31 / 31 | 0.452 | 1 / 8 | 0.0305 |
| Qwen3-VL 235B | 1024 | 31 / 31 | 0.452 | 2 / 8 | 0.0478 |

How to read it:
- *Exact NIH-label match* is the share of usable images whose detected NIH
  classes equal the image's NIH label set (computed by the paper's E5 code).
- *Direction agrees* is the paper's **mechanical** E5 measure (the model's
  better/same/worse verdict against the direction implied by the first and last
  NIH label sets). It is **not** the person-judged direction agreement the paper
  reports for E4 (3/8 fully, 7/8 fully or partly, for Gemini 2.5 Flash).
- *Usable* excludes schema-rejected answers and empty answers: MedGemma 2 and 4
  schema rejections; Gemma 4 3 at each resolution; Gemini 2.5 Flash 1 at 224;
  Gemini 3.8 Flash 1 rejection and 3 empty answers at 1024.
- The local model took about 5.1 min per patient at 224 px and 5.6 min at
  1024 px (2,457 s and 2,706 s for 8 patients) on the 6 GB laptop GPU, at no cost.

## 4. Resolution against the run-to-run noise floor (ANALYSIS Tables 2 and 3)

A resolution effect is only visible if it is larger than what a repeat run
changes. Table 3 compares the paper's 224-px run with this pack's 224-px run of
the same model (near-identical pictures, runs about three weeks apart); Table 2
compares 224 px with 1024 px within this pack.

| Model | Findings unchanged by a repeat run (mean Jaccard) | … by 224 → 1024 px | Verdicts unchanged by a repeat run | … by 224 → 1024 px |
| --- | --- | --- | --- | --- |
| Claude Sonnet 5 | 0.450 | 0.355 | 4 / 8 | 3 / 8 |
| Gemini 2.5 Flash | 0.804 | 0.604 | 3 / 8 | 4 / 8 |
| Gemma 4 31B | 0.622 | 0.603 | 2 / 8 | 5 / 8 |
| Qwen3-VL 235B | 0.968 | 0.806 | 7 / 8 | 5 / 8 |

(Findings = the set of NIH classes detected in each image's answer; 1.0 means
identical sets. Gemini 3.1 Pro, Gemini 3.8 Flash and MedGemma have no paper run,
so no noise floor: their 224 → 1024 values are 0.575, 0.531 and 0.583 for
findings, 7/8, 5/8 and 2/8 for verdicts.)

What this shows:
1. **The better/same/worse verdict is unstable even on a repeat run**: between
   2 and 7 of 8 patients kept their verdict when nothing but the run changed. With
   eight patients, no change in verdict can be attributed to resolution.
2. **Findings change more with resolution than with a repeat run for Gemini 2.5
   Flash (0.604 vs 0.804), Qwen3-VL (0.806 vs 0.968) and, less clearly, Claude
   (0.355 vs 0.450)**; for Gemma 4 the two are about equal (0.603 vs 0.622). So
   resolution does change what these models report, but on eight patients and
   without clinician review it cannot be said whether it changes it for the better.

   > **Corrected 2026-10-08 (§8).** Repeat runs measured directly at 1024 px change
   > the findings more than the 224-px comparison above suggested (mean Jaccard
   > 0.654 for Gemini 2.5 Flash, 0.827 for Qwen3-VL). Against that, the 224 → 1024
   > change of those two models (0.604, 0.806) is within run-to-run variability. For
   > Claude (0.355 against 0.525) and Gemma 4 (0.603 against 0.771) resolution does
   > change the findings more than a repeat run. Qwen's empty findings lists (§7.3)
   > remain a clear resolution effect: 4 of 31 in all three 1024-px runs.
3. Agreement with the NIH labels moved in both directions between resolutions
   (§3), and no model agreed on direction for more than 5 of 8 patients.

## 5. What the probes found (hand-checked)

| Probe | Hits | Reading |
| --- | --- | --- |
| Bias probe v2 | 1 (Claude, 1024 px) | **False alarm**: "a small round white spot … most likely a skin marker" — "white" is the brightness of an X-ray region, not a person's race. Colour words describing image brightness are a blind spot of the word rules; fix planned (clinical-homonym list for "white/black spot, area, shadow, opacity") and to be measured on the held-out benchmark before adoption |
| Unsupported measurement, ≥ 90 % confidence | 2 | MedGemma, 1024 px: "2.0 x 1.9 cm … consistent with a neoplasm" at 100 % on image 00000148_002, whose NIH labels are Effusion and Fibrosis. Gemini 3.1 Pro, 1024 px: "roughly 2.5 cm rounded radiopacity" at 95 % on image 00000148_000, labelled "No Finding". Neither size can be measured from a PNG, and both disagree with the NIH labels; without a clinician's read they cannot be settled as fabrications or label misses. This is the paper's failure case F1 pattern, now caught automatically |
| Unsupported measurement, all | 46 size claims in 8 of 14 arms (none from Gemini 2.5 Flash or Gemma 4 at either resolution; 1 to 10 in each of the others) | Every one is a model estimate stated as a measurement |
| Context consistency | 2 (Qwen, 1024 px, patient 00000148, age 59) | One real inconsistency ("This is a common pediatric finding" about a 59-year-old's oesophageal object) and one false alarm (a conditional: "if patient is a child") |

## 6. Conclusions this pack supports, and what it does not

Supported:
- The full-resolution NIH originals can be run through the same pipeline, on the
  same patients, with every input fingerprint-checked and every run verifiable.
- A 4B medical model runs the whole longitudinal pipeline locally on a 6 GB
  laptop GPU at no cost, about 5–6 minutes per patient.
- Resolution changes the findings of at least two of the paper's models more than
  a repeat run does. *(Corrected 2026-10-08: with repeat runs measured directly,
  the two are Claude Sonnet 5 and Gemma 4, not Gemini 2.5 Flash and Qwen3-VL; for
  Qwen the resolution effect is in how many images get no findings at all. See §8.)*
- The new probes catch the paper's F1 pattern automatically, and also produce
  false alarms, which are reported here.

Not supported:
- Any statement about diagnostic accuracy, any model ranking, and any claim that
  1024 px is better than 224 px for these models. Those need expert labels, more
  patients, repeated runs and clinician review: `docs/ROADMAP.md` §10.

## 7. How this study compares with the SIME 2026 paper

### 7.1 What is the same

| Aspect | Paper (E4) | This pack |
| --- | --- | --- |
| Patients and images | 8 patients, 31 radiographs, `nih-selection.json` | the same 8 patients and 31 files |
| Pipeline and prompts | tag `v1.1.0` | the same graph, prompts and schemas; the post-paper guardrails only record and clean |
| The four models | Gemini 2.5 Flash, Claude Sonnet 5, Qwen3-VL 235B, Gemma 4 31B, all through OpenRouter | the same four model ids through OpenRouter |
| Concurrency inside a run | 1 | 1 |
| Scoring code | `sime2026/label-agreement.ts` | the same code, imported unchanged |
| Labels | NIH text-mined labels | the same labels |

### 7.2 What is different

| Aspect | Paper | This pack | Consequence |
| --- | --- | --- | --- |
| 224-px images | third-party Kaggle resize, method undocumented | own Lanczos resize of the originals (mean pixel difference ≤ 0.68 / 255 from the paper's copies) | practically the same pictures; §4 uses the pair as a repeat-run noise floor |
| Full resolution | not run | original 1024-px NIH images, byte for byte | the paper's main stated limit is lifted for this cohort |
| Extra models | — | Gemini 3.8 Flash, Gemini 3.1 Pro (preview), MedGemma 1.5 4B on a local GPU | current models and a free on-device medical model added |
| Input verification | inputs hashed in the manifest after the run | every input checked against fingerprint lists before upload | proves every run used the original files |
| Scheduling | four models run one after another | six cloud models run in parallel | wall times are not comparable with the paper's |
| Date | runs of 2026-09-08/09 | runs of 2026-09-29 | the models behind the same ids may have been updated in between |
| Main direction measure reported | person-judged direction agreement (Gemini 2.5 Flash 3/8 fully, 7/8 fully or partly) | the paper's mechanical E5 measure only | the headline numbers of the paper and of this pack measure different things (§3) |

### 7.3 The paper's observations, re-checked

| Paper observation | Paper | This pack at 224 px | This pack at 1024 px |
| --- | --- | --- | --- |
| Mechanical direction agreement, E4 only (E5) | Claude 3/8, Gemini 2.5 Flash 3/8, Gemma 4 2/8, Qwen 2/8 | 3/8, 3/8, 2/8, 1/8 | 2/8, 1/8, 3/8, 2/8 |
| Exact NIH-label match, E4 only (E5) | Claude 0.258, Gemini 2.5 Flash 0.355, Gemma 4 0.389, Qwen 0.452 | 0.129, 0.400, 0.357, 0.452 | 0.194, 0.290, 0.393, 0.452 |
| Gemma 4 schema rejections | 13 of 31 images | 3 of 31 | 3 of 31 |
| Qwen empty findings lists | 27 of 31 images | 22 of 31 | **4 of 31** |
| Qwen "always the same" verdict | Stable for every patient | Stable 7, Inconclusive 1 | Stable 4, Improving 2, Worsening 1, Inconclusive 1 |
| Failure case F1 (invented 4 cm cavity, patient 00000086, Gemini 2.5 Flash) | present | not repeated | not repeated |
| Failure case F2 (69-year-old woman described as an infant, patient 00000008, Claude) | present | not repeated | not repeated |
| Cost of the four models for the cohort | USD 1.03 | USD 1.11 | USD 1.29 |

Reading this table:
- **The mechanical results reproduce closely at 224 px** (three of four models give the
  same direction count), which supports the paper's numbers as a fair description of
  the models at that time. The largest difference is Claude's exact-match rate (0.258
  against 0.129), consistent with the run-to-run variability shown in §4.
- **Gemma 4's schema rejections fell from 13 to 3 of 31** with the same prompts and
  schemas. The cause cannot be identified from these runs: the model or its hosting
  may have changed in three weeks. The paper's statement stays true of its own runs.
- **Qwen's empty findings are the clearest resolution effect found**: 22 of 31 images
  with no findings at 224 px against 4 of 31 at 1024 px, far beyond the repeat-run
  difference at 224 px (27 against 22). At full resolution Qwen also stopped calling
  every patient "Stable". The paper's caution about Qwen's 6/8 was right, and its
  behaviour was partly a resolution artefact.
- **The paper's two failure cases did not recur.** That does not show they are fixed:
  one run each cannot show absence, and new F1-pattern claims appeared in other models
  (§5), now caught automatically.
- **Nothing here changes the paper.** The camera-ready paper is unchanged; this pack
  is a post-publication follow-up that tests its main limit.

### 7.4 Also worth knowing

- **Free tiers are not dependable for experiments.** The paper found Google's free
  tier allowed 20 requests a day. Here the free OpenRouter Gemma variant was
  rate-limited upstream on the first patient. Both are recorded as findings.
- **The paper's default Google model is no longer open to new projects.** Google now
  limits the 2.5 models to earlier users, so the program's direct-Google default moved
  to a generally available model. The paper's runs and this pack name their models
  explicitly and are unaffected.
- **Local medical inference is practical at zero cost.** MedGemma 1.5 4B ran the whole
  longitudinal pipeline on a 6 GB laptop GPU. That is the route for data that may not
  leave the machine (roadmap §10).
- **Still to run:** the 20-patient cohort (E4L-20) and the scaling test (E2) at full
  resolution, when the remaining NIH archives are downloaded, and repeated runs so that
  run-to-run variability can be measured directly rather than inferred. *(Done
  2026-10-08: §8–§11.)*

## 8. Second batch: repeat runs, measured directly (ANALYSIS Table 4)

The E4 runs of the paper's four models were repeated twice at 1024 px with nothing
changed (run ids ending `-rep2`, `-rep3`), giving three runs per model and patient.
"Pairs" are every pair of the three runs.

| Model | Findings unchanged by a repeat (mean Jaccard, 1024 px) | … by 224 → 1024 px (Table 2) | Verdict the same in all three runs | Exact NIH-label match, runs 1 · 2 · 3 | Direction agrees, runs 1 · 2 · 3 |
| --- | --- | --- | --- | --- | --- |
| Claude Sonnet 5 | 0.525 | 0.355 | 2 / 8 | 0.194 · 0.200 · 0.267 | 2 · 2 · 2 of 8 |
| Gemini 2.5 Flash | 0.654 | 0.604 | 3 / 8 | 0.290 · 0.290 · 0.267 | 1 · 2 · 3 of 8 |
| Gemma 4 31B | 0.771 | 0.603 | 4 / 8 | 0.393 · 0.387 · 0.387 | 3 · 2 · 2 of 8 |
| Qwen3-VL 235B | 0.827 | 0.806 | 5 / 8 | 0.452 · 0.484 · 0.516 | 2 · 1 · 3 of 8 |

What this shows:
1. **The verdict is the least stable output.** Only 2 to 5 of 8 patients got the same
   better/same/worse verdict in three identical runs. One run per patient, as in the
   paper and in most published evaluations of these models, cannot support a
   per-patient verdict claim.
2. **The mechanical direction count moves by up to two patients between identical
   runs** (Gemini 2.5 Flash 1, 2 and 3 of 8). The paper's E4 counts (2–3 of 8) are
   inside that range.
3. **Resolution against repeat noise, corrected.** For Gemini 2.5 Flash and Qwen3-VL
   the 224 → 1024 change in findings is within repeat-run variability; for Claude and
   Gemma 4 it is larger. §4's first estimate used the paper's 224-px run against this
   pack's 224-px run, which turned out steadier than repeats at 1024 px.
4. **Two resolution effects survive the repeats.** Qwen3-VL left 4 of 31 images with
   no findings in each of the three 1024-px runs, against 22 at 224 px (and 27 in the
   paper). Gemma 4's schema rejections were 3, 0 and 0 of 31 at 1024 px, against 3 at
   224 px and 13 in the paper, so they vary between runs too.

Cost of the two repeats: USD 2.61 (Claude 2.26, Gemini 2.5 Flash 0.24, Qwen 0.08,
Gemma 0.03).

## 9. Second batch: the 20-patient cohort, E4L-20 (ANALYSIS Tables 6–9)

The paper's second longitudinal cohort: 20 patients, 72 studies, five per NIH-label
trajectory (worsening-like, improving-like, stable with pathology, stable normal). The
paper ran it with Gemini 2.5 Flash only, at 224 px. Here: Gemini 2.5 Flash and local
MedGemma at both sizes, and Gemini 3.1 Pro (preview) and Qwen3-VL at 1024 px.

| Model | px | Usable images | Exact NIH-label match | Direction agrees (mechanical) | Worsening-like | Cost USD |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini 2.5 Flash, **paper run** | 224 | — | — | 9 / 20 | 1 / 5 | 0.21 |
| Gemini 2.5 Flash | 224 | 70 / 72 | 0.429 | 7 / 20 | 1 / 5 | 0.20 |
| Gemini 2.5 Flash | 1024 | 71 / 72 | 0.465 | 8 / 20 | 1 / 5 | 0.23 |
| Gemini 3.1 Pro (preview) | 1024 | 72 / 72 | 0.528 | 7 / 20 | 0 / 5 | 2.22 |
| Qwen3-VL 235B | 1024 | 72 / 72 | 0.486 | 7 / 20 | 0 / 5 | 0.09 |
| MedGemma 1.5 4B (local) | 224 | 61 / 72 | 0.492 | 3 / 20 | 1 / 5 | 0 |
| MedGemma 1.5 4B (local) | 1024 | 66 / 72 | 0.455 | 2 / 20 | 0 / 5 | 0 |

(The paper's person-judged result for this cohort is 8/20 agree and 12/20 agree or
partly agree; the mechanical 9/20 is the same runs scored by the E5 code, as here.)

What this shows:
1. **Full resolution does not fix the worsening trajectories.** The paper reported 0/5
   (person-judged) and 1/5 (mechanical) on the worsening-like stratum and attributed it
   to changes "physically unresolvable at 224 px". At 1024 px Gemini 2.5 Flash still
   scores 1/5, and Gemini 3.1 Pro, Qwen3-VL and MedGemma score 0/5. Resolution is
   therefore not the explanation for these models; the remaining candidates are the
   models themselves and the labels (a worsening-like trajectory is defined by
   text-mined labels such as "No Finding → Infiltration", which may itself be label
   noise). Five patients per stratum and no clinician review: this narrows the
   question, it does not settle it.
2. **For Gemini 2.5 Flash, resolution moves the findings about as much as a repeat
   does**: 224 → 1024 mean Jaccard 0.748 with 12/20 verdicts kept (Table 7), against
   0.768 and 15/20 between the paper's 224-px run and this pack's (Table 8), the same
   pattern as on E4 (§8).
3. **The strongest current model is better on labels, not on direction.** Gemini 3.1
   Pro had the highest exact label match (0.528) and no unusable image, at about ten
   times the cost of Gemini 2.5 Flash and 24 times that of Qwen3-VL, with the same
   direction count as both (7/20).
4. **Most models default to "Stable".** Qwen3-VL called 15 of 20 patients Stable,
   Gemini 3.1 Pro 12, Gemini 2.5 Flash 10, MedGemma 7 (plus 6 Inconclusive).
5. **The local 4B model is weakest on direction** (2–3 of 20) and had the most
   schema rejections (6 at 1024 px, 11 at 224 px), at no cost and about 3.7 minutes
   per patient at 1024 px (4.1 at 224 px) on the laptop GPU.
6. **Probes:** no bias-probe sentence and no context contradiction in any E4L-20 run.
   Ten size claims, one at ≥ 90 % confidence: Qwen3-VL, 1024 px, "a round, radiopaque
   object measuring approximately 1–2 cm" on 00016493_001 at 95 %. The paper's own
   review records a real radiopaque disc in this patient, so this is a real object
   with an estimated size stated as a measurement, not an invented finding.

## 10. Second batch: the scaling test, E2 (ANALYSIS Table 5)

The paper's operational test: 80 images of different patients at four sizes (1 × 1 to
4 sessions × 20 images), each at concurrency 1 and 5. The paper ran it with Gemini 2.5
Flash at 224 px. Here: Gemini 2.5 Flash at both sizes and local MedGemma at 1024 px.
The local 224-px pass was not run: the owner capped the local runs at one more hour on
2026-10-08, and the queue stopped after the 1024-px pass.

| Size | Paper, c1 → c5 (speed-up) | Gemini 2.5 Flash, 224 px | Gemini 2.5 Flash, 1024 px | MedGemma, 1024 px (local) |
| --- | --- | --- | --- | --- |
| 1 × 1 | 7.6 → 4.8 s (1.58×) | 5.0 → 7.2 s (0.69×) | 11.1 → 7.9 s (1.41×) | 47.4 → 46.1 s (1.03×) |
| 2 × 5 | 53.5 → 30.0 s (1.78×) | 61.6 → 31.3 s (1.97×) | 89.9 → 29.8 s (3.02×) | 305.0 → 252.7 s (1.21×) |
| 3 × 10 | 152.1 → 54.9 s (2.77×) | 145.1 → 49.9 s (2.91×) | 181.2 → 54.4 s (3.33×) | 576.4 → 606.4 s (0.95×) |
| 4 × 20 | 361.4 → 114.2 s (3.16×) | 371.3 → 91.9 s (4.04×) | 452.5 → 293.7 s (1.54×) | 497.7 → 985.6 s (0.50×) |

| | Paper (224 px) | Gemini 2.5 Flash, 224 px | Gemini 2.5 Flash, 1024 px | MedGemma, 1024 px |
| --- | --- | --- | --- | --- |
| Runs with exit 0 | 8 / 8 (OpenRouter rows) | 8 / 8 | 8 / 8 | 8 / 8 |
| Calls (all sizes, both concurrencies) | 268 | 268 | 268 | 268 |
| Usable image answers | 242 / 242 | 242 / 242 | 242 / 242 | 206 / 242 (36 schema-rejected) |
| Retries | 1 | 0 | 0 | 5 |
| Cost USD | 0.369 | 0.357 | 0.450 | 0 |

What this shows:
1. **The paper's E2 result reproduces at 224 px**: the same call structure (calls =
   images + sessions + one evolution call), no failures, the same cost within 4 %,
   and speed-ups of the same order (up to 4.0× against the paper's 3.2×).
2. **At 1024 px the cloud run costs 26 % more and is slower at concurrency 1**
   (452.5 s against 371.3 s for 4 × 20). One concurrency-5 run (4 × 20, 293.7 s)
   was much slower than the others; single runs cannot tell provider load from a
   resolution effect, as the paper's own caveat says.
3. **Concurrency does not help a single local GPU.** The model server answers one
   request at a time, so concurrency 5 only queues requests: speed-ups of 0.5× to
   1.2×. One local run (4 × 20 at concurrency 1) generated text more than twice as
   fast as the others for reasons these runs cannot show; it is reported as measured.
4. **The local 4B model is usable for batch work but rejects more**: 36 of 242 answers
   failed the schema (15 %), against none for Gemini 2.5 Flash.

## 11. Second batch: what it adds to the conclusions

Runs of 2026-10-08: **208** (E4 repeats 64, E4L-20 120, E2 24), all exit 0, all 208
sealed records verify, all inputs matched the fingerprint lists. Cloud cost USD 6.16
(provider-reported; the OpenRouter account shows USD 6.1563 for the month, the same); local model 48 runs, 3.5 hours on the laptop GPU, USD 0. With
the first batch: **320 runs, USD 11.19.**

Supported, in addition to §6:
- **Run-to-run variability is large and must be measured, not assumed.** Three
  identical runs kept the same verdict for only 2–5 of 8 patients, and the direction
  count moved by up to two patients. Single-run verdict comparisons, including the
  paper's, describe one draw.
- **Full resolution does not resolve the worsening trajectories** of E4L-20 for any
  model tried (0–1 of 5), so the paper's explanation of its worst result (224 px) is
  not supported; the model or the labels remain the candidates.
- **Resolution has two robust, model-specific effects**: Qwen3-VL leaves far fewer
  images without findings (4 against 22 of 31, in three runs out of three), and
  Claude and Gemma 4 change their findings more with resolution than between repeats.
- **The paper's operational results (E2) reproduce** at 224 px; full resolution costs
  about a quarter more.
- **Local inference covers the whole pipeline at zero cost**, with more schema
  rejections and no benefit from concurrency on one GPU.

Still not supported: any statement about diagnostic accuracy, any model ranking, and
any claim that 1024 px is better than 224 px. Those need expert labels, more patients
and clinician review (`docs/ROADMAP.md` §10).

Not run: MedGemma on E2 at 224 px (time cap above); E4L-20 at 224 px for Qwen3-VL and
Gemini 3.1 Pro (no paper run to compare with; only Gemini 2.5 Flash has one).
