# E4 + E4L longitudinal cohorts — qualitative validation

**Review date**: 2026-09-09. **Reviewer**: automated qualitative pass, _not_ a clinician.
**Nothing in this document is a clinical assessment or a claim of diagnostic accuracy.**

> **This document supersedes the 2026-09-08 version in full.** The earlier review was written
> against a pre-final build and a partly failed run set, and none of its numbers carry over.
> Four things changed underneath it, so every judgement had to be re-made from the artefacts:
>
> 1. **Zod-validated structured output** at all three stages (image, series, evolution). Every
>    stage now requests one JSON object and validates it with `safeParse`; `abnormalities[]`,
>    `references[]`, `trends[]`, `forecastedEvolution` and `treatmentRecommendations[]` are
>    populated from the validated record instead of being emitted empty, and a failure is
>    recorded per artefact as `validation: { ok: false, issues: [...] }` instead of aborting.
> 2. **The progression fallback fix.** When an evolution response fails validation the pipeline
>    now takes `progression` from the response's own partial JSON when it is one of the four enum
>    values, rather than keyword-scanning the whole blob. On the old rule the model's own
>    `Inconclusive` became a machine-readable `Worsening` for 00000008 and 00000148; that class
>    of artefact-level contradiction is gone (see §f.4).
> 3. **The context-consistency probe.** `findContextContradictions` now reads the operator's
>    `patient_context.txt` back through the run manifest and flags age/sex assertions in the
>    generated narrative that contradict it. The 2026-09-08 review found the 00000008 demographic
>    fabrication by hand; it is now machine-detected (§f.3).
> 4. **A fully re-run batch.** 62 runs, 61 exiting 0, one deliberate quota-evidence run. The
>    earlier review's three transport failures and its `-1` sentinel columns no longer exist:
>    every one of the 103 E4+E4L imaging sessions returned `status: "success"`.

**Scope**

| cohort  | patients | models | runs | imaging sessions                  | artefacts |
| ------- | -------- | ------ | ---- | --------------------------------- | --------- |
| **E4**  | 8        | 4      | 32   | 31 per model (124 image analyses) | 344       |
| **E4L** | 20       | 1      | 20   | 72                                | 204       |

**Artefacts reviewed**: `experiments/sime2026/runs/{E4,E4L}-<pid>-openrouter-<model>/output/`
(`series_k/*_analysis.json`, `series_k/series_summary.md`, `evolution_analysis.json`,
`combined_diagnostic_report.md`, `run_manifest.json`).
**Reference labels**: `experiments/sime2026/nih-selection.json` keys `E4` and `E4L`; strata and
trajectories in `experiments/sime2026/E4L-cohort.md`; the 20-patient subset in
`experiments/sime2026/E4L20-patients.json`.
**Inputs**: `../nih-cxr14/input-e4l20/E4/<pid>/` and `../nih-cxr14/input-e4l20/E4L/<pid>/`
(224 × 224 PNG + `patient_context.txt`).
**Method**: every evolution record, every per-session `findings[]` / `abnormalities[]` / `summary`,
and every Markdown artefact was read; input radiographs were opened and inspected directly to
adjudicate the claims quoted below; governance counts come from `experiments/sime2026/probe-results.md`
(regenerated 2026-09-09) plus a per-model artefact census; manifest integrity from
`verify-manifest` on a six-run sample; direction judgements were cross-checked against the
mechanical scores in `experiments/sime2026/E5-label-agreement.json`.

**Models**: `google/gemini-2.5-flash`, `google/gemma-4-31b-it`,
`qwen/qwen3-vl-235b-a22b-instruct`, `anthropic/claude-sonnet-5` — all via OpenRouter.

---

## 0. Caveats — read these before any number below

These come first deliberately. Every rate in sections (b)–(d) is meaningless without them.

1. **The reference labels are not ground truth.** NIH ChestX-ray14 labels were NLP-mined from
   free-text radiology reports and are reported at roughly **~90 % accuracy**
   (Wang et al., _ChestX-ray8_, CVPR 2017). They are noisy, incomplete, and were never intended as a
   per-image gold standard. E4L patient **00003980** is labelled `No Finding` at all four studies,
   yet the first radiograph plainly shows a looped indwelling line — the label is wrong, not the model.
2. **The images are below diagnostic resolution.** Every input is a **224 × 224** 8-bit PNG
   (~20 KB). The manifests confirm byte-for-byte passthrough at native size
   (`"action": "passthrough"`, `"estimatedImageTokens": 64–258`). Real chest radiographs are
   ~2000 × 2000 at 12–16 bits. Fine texture — the substrate of _Fibrosis_, _Infiltration_,
   _Emphysema_, small _Nodule_, thin _Pneumothorax_ lines — is physically absent from the pixels.
   Under-calls at this resolution are **expected and are not model errors**. Most of the E4L
   `worsening-like` disagreements in §c are exactly this.
3. **Single frontal view, no clinical history.** One frontal projection per session, no lateral,
   no priors, no windowing. `patient_context.txt` supplies only modality, view, cohort provenance,
   age at first study, and sex — no symptoms, no indication, no reports.
4. **The per-image and per-series prompts never see the patient context.** Verified in
   `src/infrastructure/gemini-client.ts`: `analyzeImage(imagePath, seriesId)` takes no context
   argument, and `rootContextText` is threaded only into `buildEvolutionPrompt`. Every demographic
   contradiction in §f.3 therefore arises at a stage where the model was never told the age or sex.
   This is an architectural finding, not a prompting one.
5. **The NIH label set is thoracic-only.** Genuine extrathoracic findings the models do see
   (gastric distension, bowel gas, ingested radiopaque objects, surgical clips, lines and tubes)
   cannot agree or disagree with a label — they fall outside the label vocabulary entirely, and
   several such studies are labelled `No Finding`. Patient 00000239 is the clearest case: three of
   four models call it `Worsening` on a progressive gastric/bowel gas finding that is real on the
   images and invisible to the label set.
6. **This is descriptive-direction agreement, never accuracy.** What is scored is whether the
   _direction of the narrative_ (Improving / Stable / Worsening) is consistent with the _direction
   of the label trajectory_. A model can agree on direction while being wrong about everything else
   — failure case **F1** (00000086 / gemini) does exactly that. Nothing here is sensitivity,
   specificity, PPV or diagnostic performance, and none of it may be reported as such.
7. **Direction is a four-way judgement, not a binary.** See the key in §b. In particular a
   directional label emitted from fewer than half the sessions' usable output is scored
   **no call**, because it is an assertion rather than a synthesis — this is the main systematic
   difference from the mechanical E5 scores (§e).

---

## (b) E4 — per patient × model

**Direction key**

| verdict      | meaning                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **agree**    | the model's `progression` matches the net direction of the NIH label trajectory                                                                                                             |
| **partial**  | endpoint-consistent but interval labels missed; or `Stable` against a fluctuating / non-monotonic trajectory; or the right direction reached via a finding outside the NIH label vocabulary |
| **disagree** | opposite or unrelated direction                                                                                                                                                             |
| **no call**  | `Inconclusive`; or a directional label emitted when fewer than half the sessions produced usable structured output                                                                          |

Notes flag: **fabrication**, **over-call**, **under-call**, **laterality error**, **invented
history**, **invented demographics**, **internal inconsistency**.

### 00000008 — F, 69 y · 3 sessions · NIH: Cardiomegaly → No Finding → Nodule (fluctuating)

| Model            | Progression  | Key finding per session (≤ 8 words)                                                                                 | Direction | Notes                                                                                                                                                                                                                        |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Improving    | S1 normal, metallic objects over abdomen · S2 elevated left hemidiaphragm (90 %) · S3 clear lungs, normal           | partial   | Endpoint called normal; the labelled S3 nodule is invisible at 224 px (**under-call**). The 2026-09-08 build's fabricated **dextrocardia and implanted defibrillator are gone** (see §e.1).                                  |
| gemma-4-31b-it   | Inconclusive | S1 no usable output · S2 clear lungs, normal heart · S3 clear lungs, sharp angles                                   | no call   | 1 of 3 records failed validation; the model declines a verdict, correctly.                                                                                                                                                   |
| qwen3-vl-235b    | Stable       | S1 normal (empty findings) · S2 normal (empty findings) · S3 clear lungs, normal silhouette                         | partial   | Zero trends emitted; `findings[]` empty in 2 of 3 sessions. Stable is defensible against a fluctuating trajectory but is asserted, not synthesised.                                                                          |
| claude-sonnet-5  | Worsening    | S1 "pediatric patient", clear lungs · S2 prominent cardiothymic silhouette · S3 new right lower zone opacity (45 %) | partial   | **Invented demographics** — failure case **F2**, reproduced. But the new right lower-zone opacity at S3 is endpoint-consistent with the labelled Nodule, and the evolution stage self-flags the demographic conflict (§f.3). |

### 00000067 — F, 62 y · 3 sessions · NIH: Fibrosis → Atelectasis → No Finding (improving)

| Model            | Progression | Key finding per session                                                                            | Direction | Notes                                                                                                                                                                                      |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gemini-2.5-flash | Stable      | S1 clear lungs, breasts unremarkable · S2 no acute pathology · S3 well-inflated, clear bilaterally | partial   | Endpoint normal, matching the label. 8 trends emitted, all `Stable` — the most structurally complete synthesis in the cohort. **Under-call** of fibrosis/atelectasis (expected at 224 px). |
| gemma-4-31b-it   | Stable      | S1 no usable output · S2 clear lungs, normal heart · S3 no usable output                           | no call   | 1 of 3 sessions usable; "Stable" rests on a single mid-series read.                                                                                                                        |
| qwen3-vl-235b    | Stable      | S1–S3 all "normal, reassuring" with empty `findings[]`                                             | partial   | Identical boilerplate at every session; zero trends. **Internal inconsistency**: a prose summary asserting normality with no findings to support it.                                       |
| claude-sonnet-5  | Stable      | S1 metallic marker upper-right of image · S2 grossly clear lungs · S3 clear, technique noted       | partial   | The 2026-09-08 **laterality error is gone**: Claude now describes the marker in image coordinates ("upper right portion of the image") rather than asserting patient-right (§e.1).         |

### 00000086 — M, 76 y · 3 sessions · NIH: No Finding → Emphysema → Atelectasis (worsening)

| Model            | Progression | Key finding per session                                                                                                                | Direction                | Notes                                                                                                                                                                                                                                   |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Worsening   | S1 right lower lobe consolidation (90 %) · S2 **4 cm cavitary lesions, right lung (95 %)** · S3 right multifocal opacity, cardiomegaly | agree _(direction only)_ | **Failure case F1, reproduced verbatim.** Direction matches the labels for entirely **fabricated** reasons; escalates to a TB/fungal/malignancy workup. `validation.ok: false` (a trend enum), progression recovered from partial JSON. |
| gemma-4-31b-it   | Worsening   | S1 no usable output · S2 no usable output · S3 right costophrenic angle obscured, effusion (90 %)                                      | no call                  | 1 of 3 sessions usable; a single `Pleural effusion → Worsening` trend from one image. The label happens to match; the reasoning does not exist.                                                                                         |
| qwen3-vl-235b    | Stable      | S1–S3 all normal, empty `findings[]`                                                                                                   | disagree                 | **Under-call** of emphysema and atelectasis; zero trends.                                                                                                                                                                               |
| claude-sonnet-5  | Improving   | S1 bilateral perihilar opacities (45 %) · S2 increased bronchovascular markings (45 %) · S3 possible bibasilar markings (45 %)         | disagree                 | "Improving" rests on softening language at S3; Claude flags the exposure change as a confound in the same record — an honest but circular inference.                                                                                    |

### 00000092 — F, 54 y · 4 sessions · NIH: No Finding → Effusion\|Fibrosis → Fibrosis → Fibrosis (worsening)

| Model            | Progression  | Key finding per session                                                                                                                                    | Direction | Notes                                                                                                                                                                            |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Worsening    | S1 right effusion + infiltrates (95 %) · S2 no acute findings · S3 bilateral effusions, right greater · S4 left hydropneumothorax (95 %)                   | agree     | **Over-call** at S1, a `No Finding` timepoint, at 95 % confidence. **Internal inconsistency**: the trend table carries `Cardiomegaly → Improving` inside an overall `Worsening`. |
| gemma-4-31b-it   | Inconclusive | S1 bilateral effusions (90 %) · S2 no usable output · S3 effusions + pneumoperitoneum (90 %) · S4 no usable output                                         | no call   | 2 of 4 sessions usable. Endpoint description matches the visible S4 feature; the model declines a verdict.                                                                       |
| qwen3-vl-235b    | Stable       | S1–S4 all normal, empty `findings[]`                                                                                                                       | disagree  | **Under-call**: misses the S4 air-fluid level that the other three models all describe and that is visible on the image.                                                         |
| claude-sonnet-5  | Worsening    | S1 support lines/tubes (55 %) · S2 bilateral diffuse opacity (55 %) · S3 cardiomegaly + right lower opacity (55 %) · S4 air-fluid level left thorax (62 %) | agree     | **Showcase case #1.** Graded confidences, explicit laterality tracking, named inflection points, differential rather than assertion.                                             |

### 00000148 — M, 59 y · 4 sessions · NIH: No Finding → Effusion → Effusion\|Fibrosis → No Finding (fluctuating, net stable)

| Model            | Progression | Key finding per session                                                                                                                                              | Direction | Notes                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gemini-2.5-flash | Improving   | S1 clear lungs · S2 right effusion + ring-like opacity (95 %) · S3 endobronchial valve, right upper lobe · S4 endobronchial valve                                    | partial   | **Invented history**: one unchanged ring-shaped object acquires a therapeutic-device identity ("subsequently identified as an endobronchial valve"). **Internal inconsistency**: `Mid-Lung Opacity/Endobronchial Valve → Worsening` inside an overall `Improving`, with the model itself noting the contradiction. |
| gemma-4-31b-it   | Improving   | S1 no usable output · S2 no usable output · S3 right hilar mass (85 %) + port-a-cath · S4 no usable output                                                           | no call   | 1 of 4 sessions usable; 3 validation failures in the run.                                                                                                                                                                                                                                                          |
| qwen3-vl-235b    | Stable      | S1 normal · S2 2 cm right upper lobe nodule (85 %) · S3 1.5 cm radiopaque object (92 %) · S4 radiopaque foreign body (95 %)                                          | partial   | **Best object tracking in the cohort**: correctly dates the object's first appearance to S2 and its persistence, and correctly declines malignancy. **Internal inconsistency**: reports 2 cm → 1.5 cm while calling the trend `Stable`.                                                                            |
| claude-sonnet-5  | Stable      | S1 left lower zone opacity (40 %) · S2 right hilar nodular opacity (58 %) · S3 radiopaque focus **left** mid-lung (45 %) · S4 ring density **right** mid-lung (55 %) | partial   | **Laterality error, reproduced**: the ring object is right-sided on the image; S3 calls it left and S4 calls it right — the model contradicts itself between its own two readings. `validation.ok: false`, progression recovered from partial JSON, trends dropped.                                                |

### 00000219 — M, 78 y · 4 sessions · NIH: Atelectasis → Atelectasis → No Finding → No Finding (improving)

| Model            | Progression | Key finding per session                                                                                                            | Direction | Notes                                                                                                                                                                                    |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Stable      | S1–S4 all "no acute cardiopulmonary pathology"                                                                                     | partial   | Endpoint normal, matching the label. 6 trends, all `Stable`. **Under-call** of the interval atelectasis.                                                                                 |
| gemma-4-31b-it   | Worsening   | S1 aortic tortuosity (85 %) · S2 external marker (85 %) · S3 surgical hardware + mediastinal shift (85 %) · S4 cardiomegaly (90 %) | disagree  | **Over-call** on a trajectory the labels call improving; a "mediastinal shift" at S3 that no other model sees.                                                                           |
| qwen3-vl-235b    | Stable      | S1–S4 all normal, empty `findings[]`                                                                                               | partial   | Zero trends; direction defensible, content absent.                                                                                                                                       |
| claude-sonnet-5  | Improving   | S1 clear lungs · S2 possible cardiomegaly (45 %) · S3 bilateral perihilar/basilar opacities (58 %) · S4 clear, CTR < 50 %          | agree     | **Showcase case #2.** Names an inflection at S3 and full resolution at S4, and reads it as "an acute, self-limited or treated event rather than a steadily progressive chronic process". |

### 00000239 — F, 42 y · 6 sessions · NIH: No Finding → No Finding → Infiltration → No Finding → No Finding → No Finding (net stable)

| Model            | Progression | Key finding per session                                                                                                                                                                                                           | Direction | Notes                                                                                                                                                                              |
| ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Worsening   | S1–S2 clear · S3 intra-abdominal foreign bodies (95 %) · S4 radiopaque objects, pelvis (70 %) · S5 swallowed foreign bodies (95 %) · S6 gastric/intestinal distension (95 %)                                                      | disagree  | Direction driven entirely by an **extrathoracic** finding outside the NIH vocabulary (caveat 0.5). The finding itself is visible on the images.                                    |
| gemma-4-31b-it   | Worsening   | S1 clear · S2 gastric distension (85 %) · S3 no usable output · S4 gastric distension (90 %) · S5 no usable output · S6 gastric distension (95 %)                                                                                 | disagree  | Same extrathoracic driver; 4 of 6 sessions usable. Honestly separates `Gastric Distension → Worsening` from `Cardiopulmonary Status → Stable`.                                     |
| qwen3-vl-235b    | Stable      | S1–S6 all normal, empty `findings[]` in every session                                                                                                                                                                             | partial   | The label matches the thoracic trajectory, but six consecutive sessions with zero findings and zero trends is a default, not a reading. Misses the gastric finding all others see. |
| claude-sonnet-5  | Worsening   | S1 clear · S2 large air-fluid level, hiatal hernia? (65 %) · S3 gas-filled viscus, right lower chest (62 %) · S4 suspected diaphragmatic hernia (65 %) · S5 gastric distension (60 %) · S6 bilateral interstitial markings (40 %) | disagree  | Same extrathoracic driver, but the most specific and internally coherent reading of it in the cohort; five graded trends.                                                          |

### 00000296 — M, 62 y · 4 sessions · NIH: Pneumothorax → Emphysema → Pneumothorax → No Finding (improving)

| Model            | Progression  | Key finding per session                                                                                                   | Direction | Notes                                                                                                                                                                                                                                   |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemini-2.5-flash | Improving    | S1 nasogastric tube (98 %) · S2 looped central catheter (95 %) · S3 PICC in situ (98 %) · S4 clear lungs, no devices      | agree     | Endpoint normal. But the `Improving` verdict rests on `Catheter/Tube Presence and Positioning → Improving` — device removal read as clinical improvement (a **category error**), not on the labelled pneumothorax, which it never sees. |
| gemma-4-31b-it   | Inconclusive | S1 chest tube/pigtail catheter (95 %) · S2 no usable output · S3 indwelling chest tube (95 %) · S4 clear lungs            | no call   | 3 of 4 usable; declines a verdict. Zero trends emitted.                                                                                                                                                                                 |
| qwen3-vl-235b    | Stable       | S1–S4 all normal, empty `findings[]`                                                                                      | partial   | Misses the central line that all three other models describe.                                                                                                                                                                           |
| claude-sonnet-5  | Inconclusive | S1 indwelling CVC (55 %) · S2 CVC at cavoatrial junction (70 %) · S3 right basal opacity (55 %) · S4 well-expanded, clear | no call   | Declines a verdict while still emitting five graded trends, including `Right basal opacity → Worsening`. Honest degradation.                                                                                                            |

---

## (c) E4L — 20 patients × gemini-2.5-flash

This is the new evidence: the same model, the same pipeline, four pre-declared strata, five
patients each, none of them the eight E4 patients. It exists to test whether the 8-patient E4
result was a fluke.

| #   | patient  | stratum          | sex / age | n   | NIH trajectory                                                   | Model progression | Key finding per session (≤ 8 words)                                                                                                                                               | Direction | Notes                                                                                                                                                                                       |
| --- | -------- | ---------------- | --------- | --- | ---------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 00011264 | worsening-like   | M 40      | 3   | NF → NF → Infiltration                                           | Stable            | S1 clear · S2 clear · S3 no acute pathology                                                                                                                                       | disagree  | **Under-call** (Infiltration invisible at 224 px). Zero trends.                                                                                                                             |
| 2   | 00015192 | worsening-like   | F 40      | 3   | NF → Infiltration → Pleural_Thickening                           | Stable            | S1 clear · S2 clear · S3 clear                                                                                                                                                    | disagree  | **Under-call**. 6 trends, all `Stable`.                                                                                                                                                     |
| 3   | 00016012 | worsening-like   | M 8       | 3   | NF → NF → Infiltration                                           | Stable            | S1 clear · S2 clear · S3 clear                                                                                                                                                    | disagree  | **Under-call**. Zero trends.                                                                                                                                                                |
| 4   | 00016493 | worsening-like   | F 7       | 4   | NF → NF → Effusion → Effusion\|Infiltration                      | Worsening         | S1 nipple marker (100 %) · S2 clear · S3 **button battery** (95 %) · S4 radiopaque foreign body (85 %)                                                                            | partial   | Right direction, wrong entity: driven by a real radiopaque disc (verified on image), not the labelled effusion. **Over-call** in naming it a battery. `validation.ok: false`.               |
| 5   | 00022202 | worsening-like   | M 50      | 3   | NF → Atelectasis → Atelectasis                                   | Stable            | S1 clear · S2 clear · S3 clear                                                                                                                                                    | disagree  | **Under-call**. 5 trends, all `Stable`.                                                                                                                                                     |
| 6   | 00003158 | improving-like   | M 8       | 3   | Effusion → NF → NF                                               | Stable            | S1 clear · S2 cardiac implantable device (95 %) · S3 clear                                                                                                                        | partial   | Endpoint normal. **Category error**: `CIED → Worsening` — a device appearing scored as disease progression. Probe flags "adult" (false positive, §f.3).                                     |
| 7   | 00004946 | improving-like   | F 37      | 3   | Fibrosis → NF → NF                                               | Worsening         | S1 hyperinflation + bronchial thickening (90 %) · S2 interstitial markings + effusions (95 %) · S3 diffuse opacities + cardiomegaly (95 %)                                        | disagree  | **Over-call** at 90–95 % confidence on a trajectory ending `No Finding`. The single worst E4L over-call.                                                                                    |
| 8   | 00005852 | improving-like   | M 40      | 5   | Emphysema\|Pneumothorax → Pneumothorax → NF → NF → NF            | Improving         | S1 pulmonary opacities + catheters (90/95 %) · S2 clear, lines · S3–S5 clear                                                                                                      | agree     | Correctly separates `Bilateral pulmonary opacities → Improving` from `Vascular catheters → Stable`.                                                                                         |
| 9   | 00021807 | improving-like   | M 53      | 3   | Atelectasis\|Effusion\|Infiltration → Atelectasis\|Effusion → NF | Improving         | S1 interstitial opacities (90 %) + hilar prominence (75 %) · S2 clear · S3 clear                                                                                                  | agree     | **Showcase case #3.** Cleanest improving trajectory in either cohort.                                                                                                                       |
| 10  | 00022134 | improving-like   | F 6       | 3   | Infiltration → NF → NF                                           | Stable            | S1 calcified granuloma/artifact (75 %) · S2 clear · S3 metallic foreign body (85 %)                                                                                               | partial   | Endpoint normal, interval infiltrate missed. **Category error** again: `Metallic Foreign Body → Worsening`.                                                                                 |
| 11  | 00013880 | stable-pathology | M 51      | 4   | Effusion → Effusion\|PT → Atelectasis\|Effusion\|PT → Effusion   | Worsening         | S1 PICC line · S2 CVC · S3 left effusion + edema (95/90 %) · S4 left effusion + atelectasis + pacemaker (95/85/99 %)                                                              | disagree  | **Under-call** at S1–S2 manufactures a false worsening trend on a label-stable trajectory. `validation.ok: false`.                                                                          |
| 12  | 00015863 | stable-pathology | F 11      | 3   | Mass → Atelectasis\|Infiltration → Mass                          | Worsening         | S1 diffuse opacities + effusions + cardiomegaly (95/90/75 %) · S2 pulmonary nodules/masses (95 %) · S3 patchy opacities + effusions + cardiomegaly (90/85/75 %)                   | disagree  | **Internal inconsistency**: the S1 and S3 descriptions are near-identical yet all three trends read `Worsening`.                                                                            |
| 13  | 00019779 | stable-pathology | M 8       | 3   | Infiltration → Infiltration → Infiltration                       | Stable            | S1 clear · S2 clear · S3 thoracic scoliosis (90 %)                                                                                                                                | agree     | **Under-call** of the persistent infiltrate, but direction correct. `validation.ok: false`, progression recovered. Probe flags "adult" (false positive, §f.3).                              |
| 14  | 00027141 | stable-pathology | M 34      | 4   | Infiltration → Fibrosis\|PT → Infiltration → Infiltration        | Stable            | S1–S4 all "no acute cardiopulmonary abnormalities"                                                                                                                                | agree     | **Under-call**; zero trends. Direction correct by default.                                                                                                                                  |
| 15  | 00027230 | stable-pathology | F 41      | 4   | Consolidation\|Mass → Mass → Mass → Mass                         | Stable            | S1–S4 all clear                                                                                                                                                                   | agree     | **Under-call** of a persistent mass; zero trends.                                                                                                                                           |
| 16  | 00003295 | stable-normal    | M 34      | 6   | NF × 6                                                           | Stable            | S1 cardiac device (95 %) · S2 central venous catheter (95 %) · S3–S6 clear                                                                                                        | agree     | **Showcase case #4 (stable).** Longest series in either cohort; correctly reasons that devices are not disease.                                                                             |
| 17  | 00003980 | stable-normal    | M 46      | 4   | NF × 4                                                           | Inconclusive      | S1 effusions + cardiomegaly + CVC misplacement (95/80/99 %) · S2 NG tube malposition (85 %) · S3 CVC misplacement (95 %) · S4 interstitial changes + shoulder hardware (75/100 %) | no call   | Heaviest **over-call** in E4L — but the image does show a looped indwelling line, so the `No Finding` label is itself suspect (caveat 0.1). `validation.ok: false`, 3 trend enums rejected. |
| 18  | 00015553 | stable-normal    | M 7       | 5   | NF × 5                                                           | Improving         | S1 foreign body, left shoulder (95 %) · S2–S5 clear                                                                                                                               | partial   | Chest stable throughout. **Category error**: `Metallic foreign body in left shoulder → Improving`, explicitly because "it was not mentioned in subsequent series".                          |
| 19  | 00016054 | stable-normal    | F 5       | 3   | NF × 3                                                           | Stable            | S1–S3 all clear                                                                                                                                                                   | agree     | Zero trends; correct and empty.                                                                                                                                                             |
| 20  | 00026237 | stable-normal    | F 35      | 3   | NF × 3                                                           | Stable            | S1–S3 all clear                                                                                                                                                                   | agree     | 4 trends, all `Stable`.                                                                                                                                                                     |

### Agreement per E4L stratum (gemini-2.5-flash, n = 5 each)

| stratum              | agree | partial | disagree | no call | agree    | agree + partial |
| -------------------- | ----- | ------- | -------- | ------- | -------- | --------------- |
| **worsening-like**   | 0     | 1       | 4        | 0       | 0/5      | 1/5             |
| **improving-like**   | 2     | 2       | 1        | 0       | 2/5      | 4/5             |
| **stable-pathology** | 3     | 0       | 2        | 0       | 3/5      | 3/5             |
| **stable-normal**    | 3     | 1       | 0        | 1       | 3/5      | 4/5             |
| **E4L total**        | **8** | **4**   | **7**    | **1**   | **8/20** | **12/20**       |

**The 8-patient E4 result was not a fluke, and the stratification explains it.** gemini scored
3/8 agree (7/8 agree+partial) on E4 and 8/20 agree (12/20 agree+partial) on E4L — the same
ballpark. More usefully, E4L shows _where_ the agreement lives: the model is usable on
**stable** trajectories (6/10 agree, 7/10 agree+partial) and on **improving** ones (2/5, 4/5),
and it is close to useless on **worsening-like** trajectories (0/5 agree). That single stratum
carries 4 of the 7 outright disagreements, and every one of them is the same failure: a
`No Finding → Infiltration`-class transition that is physically unresolvable at 224 px, so the
model reports three normal chests and calls it `Stable`. This is caveat 0.2 made visible, and it
is a property of the input resolution, not of the model.

---

## (d) Agreement summary

### Per model — E4 (8 patients each)

| Model                            | agree | partial | disagree | no call | **agree** | **agree + partial** |
| -------------------------------- | ----- | ------- | -------- | ------- | --------- | ------------------- |
| google/gemini-2.5-flash          | 3     | 4       | 1        | 0       | **3/8**   | **7/8**             |
| google/gemma-4-31b-it            | 0     | 0       | 2        | 6       | **0/8**   | **0/8**             |
| qwen/qwen3-vl-235b-a22b-instruct | 0     | 6       | 2        | 0       | **0/8**   | **6/8**             |
| anthropic/claude-sonnet-5        | 2     | 3       | 2        | 1       | **2/8**   | **5/8**             |
| **E4 total (32 judgements)**     | **5** | **13**  | **7**    | **7**   | 5/32      | 18/32               |

### Per model — E4L (20 patients, one model)

| Model                   | agree | partial | disagree | no call | **agree** | **agree + partial** |
| ----------------------- | ----- | ------- | -------- | ------- | --------- | ------------------- |
| google/gemini-2.5-flash | 8     | 4       | 7        | 1       | **8/20**  | **12/20**           |

Combined for gemini across both cohorts: **11/28 agree, 19/28 agree + partial**.

### Per stratum — E4 (strata derived in `E5-label-agreement.json`; all four models)

| stratum                | patients           | judgements | agree | partial | disagree | no call |
| ---------------------- | ------------------ | ---------- | ----- | ------- | -------- | ------- |
| mixed-pathology-change | 00000008           | 4          | 0     | 3       | 0        | 1       |
| improving              | 00000067, 219, 296 | 12         | 2     | 6       | 1        | 3       |
| worsening              | 00000086, 00000092 | 8          | 3     | 0       | 3        | 2       |
| stable-normal          | 00000148, 00000239 | 8          | 0     | 4       | 3        | 1       |

**Caveat, restated because these are counts and counts invite misuse.** Every cell above is
_descriptive-direction agreement against NLP-mined labels on 224 × 224 images_. It is not
sensitivity, not specificity, not accuracy, and not evidence of clinical utility. gemini's 7/8
agree+partial on E4 includes a run (00000086) whose entire justification is fabricated; qwen's
6/8 includes five runs that emitted no findings at all. A direction label can be right for no
reason. Read §e before quoting any of it.

---

## (e) Showcase and failure cases

### Showcase 1 — Worsening · 00000092 / claude-sonnet-5 · direction **agree**

NIH: `No Finding → Effusion|Fibrosis → Fibrosis → Fibrosis`. Model: `Worsening`.

> **Lung parenchymal opacity/haziness — Worsening:** "Series 1: lungs relatively clear. Series 2:
> new bilateral diffuse hazy opacification in mid-to-lower zones with possible mild right
> costophrenic blunting. Series 3: persistent right lower zone opacity with new left costophrenic
> blunting and interval cardiomegaly. Series 4: bilateral basal haziness (right>left) plus a new
> air-fluid level in the left lower hemithorax, raising concern for hiatal hernia vs
> hydropneumothorax. **Inflection point at series_2** (new opacities appear) with progressive
> complexity through series_3 and series_4."
>
> **Cardiac silhouette/size — Worsening:** "…Series 3: mild-to-moderate cardiomegaly with increased
> cardiothoracic ratio, a new finding. Series 4: heart size at upper limits of normal (**AP
> projection limits comparison**). Inflection point at series_3 suggesting possible evolving
> cardiac decompensation."

Why it is the best artefact in the batch: it separates four findings into independent trends,
names the session at which each turns, keeps a differential open (`hiatal hernia vs
hydropneumothorax`) instead of asserting, and discounts its own S4 cardiac reading because the
projection changed. Its confidences are 40–62 %, never 95 %.

### Showcase 2 — Improving · 00000219 / claude-sonnet-5 · direction **agree**

NIH: `Atelectasis → Atelectasis → No Finding → No Finding`. Model: `Improving`.

> **Overall cardiopulmonary status — Improving:** "The trajectory shows a transient episode of
> possible cardiac decompensation/congestion at series_3, following two relatively unremarkable
> baseline studies (series_1, series_2), with full resolution by series_4. This pattern suggests
> **an acute, self-limited or treated event rather than a steadily progressive chronic process**."

This is the single clearest instance in the batch of a model reading a _shape_ out of a series
rather than comparing endpoints. Note it reaches `Improving` through a transient it invents an
occasion for — the NIH labels put the abnormality at S1–S2, not S3.

The E4L replication of the same behaviour, on a different patient and a cheaper model
(00021807 / gemini, `Atelectasis|Effusion|Infiltration → Atelectasis|Effusion → No Finding`):

> **Interstitial Opacities — Improving:** "Marked improvement from Series 1 (diffuse interstitial
> opacities) to Series 2 and 3 (healthy-appearing lungs, no focal opacities)."
> **Hilar Prominence — Improving:** "Bilateral hilar prominence noted in Series 1 resolved in
> Series 2 and 3, which describe hila as unremarkable."

### Showcase 3 — Stable · 00003295 / gemini-2.5-flash (E4L, 6 sessions) · direction **agree**

NIH: `No Finding × 6`. Model: `Stable`.

> **Cardiopulmonary findings — Stable:** "Across all 6 series, no acute cardiopulmonary
> abnormalities are identified. All reports consistently state normal lung fields,
> cardiomediastinal silhouettes, diaphragms, and costophrenic angles."
>
> **Medical devices/artifacts — Stable:** "Series 1 notes a cardiac pacemaker/ICD lead system.
> Series 2 notes a central venous catheter. Series 5 and 6 note external artifacts (ECG
> lead/metallic marker over the left shoulder). These are consistent with external/implanted
> devices that are stable and appropriately positioned or external artifacts, **not indicating
> disease progression or worsening condition**."

The second trend is the interesting one, and it is the _counter-example_ to the category errors
listed in §c (00003158, 00015553, 00022134, 00000296): here the model explicitly refuses to score
device presence as disease. The same model makes the opposite call on four other patients. The
behaviour is not stable across patients.

### Failure case F1 — fabrication · 00000086 / gemini-2.5-flash, series_2 · **REPRODUCED**

The 2026-09-08 review's first failure case. Verbatim from
`runs/E4-00000086-openrouter-google_gemini-2.5-flash/output/series_2/00000086_001_analysis.json`:

> `"findings"`: "**Right lung: Multiple cavitary lesions are noted**, predominantly in the right
> mid and lower lung zones. These lesions exhibit thick, irregular walls. Surrounding parenchymal
> opacities suggest inflammatory or infiltrative changes. **The largest cavity measures
> approximately 4 cm in diameter.**"
>
> `"abnormalities"`: `{ "name": "Right Lung Cavitations", "severity": "Severe",` **`"confidence": 95`** `, "description": "Multiple cavitary lesions are present in the right mid and lower lung fields. These cavities have thick, irregular walls…" }`
>
> `"summary"`: "This X-ray shows multiple abnormal air-filled spaces, called cavities, in the right
> lung… **The largest cavity is about 1.5 inches across.**"

and from the same run's `series_2/series_summary.md`:

> **Primary Diagnosis**: Cavitary Lung Disease, likely infectious or inflammatory, in the right
> lung. — Confidence: High
> **Differential Diagnoses**: 1. Pulmonary Tuberculosis · 2. Necrotizing Pneumonia · 3.
> Granulomatosis with polyangiitis (Wegener's) · 4. Metastatic disease with cavitation · 5. Septic emboli
> **Structured output**: schema-validated

**Verdict: F1 still occurs on this build, unchanged in kind and in confidence.** The image was
opened and inspected: it is an adult chest with a small metallic marker over the left shoulder,
mildly coarse right basal markings, and no cavitation of any size. The other three models describe
this session as, respectively, no usable output, a normal chest, and increased bronchovascular
markings at 45 % confidence. Two governance observations follow:

- The Zod layer marked this artefact **`schema-validated`**. Validation is structural, not factual;
  it cannot and does not catch a well-formed fabrication. Nothing in the new build claims otherwise,
  but the phrase "Structured output: schema-validated" in a rendered report is easy to over-read.
- The run's _evolution_ record does carry `validation.ok: false` — but for an unrelated reason
  (`trends.1.trend` was `Inconclusive`, outside the enum). The progression `Worsening` was recovered
  from the response's own partial JSON by the new fallback rule, which is the correct behaviour and
  is recorded in `validation.issues` as `progression: taken from partial JSON ("Worsening")`.

### Failure case F2 — invented demographics · 00000008 / claude-sonnet-5 · **REPRODUCED, now detected**

The 2026-09-08 review's second failure case. Context supplied to the run: _"Patient age at first
study: 69 years; sex: female."_ Verbatim from series_1 and series_2:

> series_1 `findings[0]`: "**Frontal chest radiograph of a pediatric patient**"
> series_1 `summary`: "This is a **chest X-ray of a child**, taken from the front… There is some
> slight rotation in how **the child** was positioned during the X-ray…"
>
> series_2 `findings[0]`: "AP supine chest radiograph of a **pediatric patient**"
> series_2 `findings[2]`: "**Cardiothymic silhouette** is prominent, appearing mildly enlarged,
> which can be a normal variant **in infants due to thymic shadow**"
> series_2 `findings[5]`: "**Umbilical line** or feeding tube artifact visible at lower chest/upper abdomen"
> series_2 `summary`: "This is a chest X-ray of **an infant or young child** taken from the front
> while lying down… this is very common **in babies** because the thymus gland… **standard for
> monitoring young patients**."

**Verdict: F2 still occurs at the image-analysis stage — but three things about it are new.**

1. **It is now machine-detected.** `probe-results.md` scores this run `6 (pediatric, child,
infants, infant, paediatric, neonatal)` in the context-contradictions column. It is the only
   genuine demographic contradiction in all 62 runs.
2. **The evolution stage catches it itself.** The evolution prompt is the only stage that receives
   `patient_context.txt`, and the resulting `combined_diagnostic_report.md` opens with:

   > "Note: metadata context indicates images are from a de-identified adult dataset (69-year-old
   > female), though series descriptions use **pediatric-style templated language; this discrepancy
   > should be clarified with the imaging source before clinical use**."

3. **The cause is now located.** Per caveat 0.4, `analyzeImage` receives no context at all — the
   per-image stage was never told the patient's age. The fix is architectural (thread
   `rootContextText` into the image and series prompts), not a prompt tweak, and it is not in this
   build.

The image was inspected: it is an adult female chest with breast shadows, adult thoracic
proportions and monitoring cables across the lower abdomen. There is no ambiguity.

### Two 2026-09-08 failures that did **not** reproduce

Reported here because the brief asks for a direct before/after, and negative results count:

1. **00000008 / gemini — fabricated dextrocardia and implanted defibrillator: gone.** On this build
   gemini reads S1 as a normal chest with metallic objects over the abdomen, S2 as an elevated left
   hemidiaphragm (90 %), S3 as clear. No dextrocardia, no ICD, and the run's `validation.ok` is
   `true` at every stage. The previous build's _artefact-level_ contradiction — structured field
   `Worsening` against prose saying `Inconclusive` — is also gone; that was exactly the case the
   progression-fallback fix targeted, and gemini's E4-00000008 evolution now validates cleanly and
   reads `Improving` throughout.
2. **00000067 / claude — laterality error on the shoulder marker: gone.** Claude now writes "Small
   metallic marker/artifact noted in the **upper right portion of the image** (likely external
   marker or jewelry)" — image coordinates, not a patient-laterality assertion. The marker is over
   the patient's left shoulder; the new phrasing is not wrong. **But laterality is not fixed in
   general**: on 00000148 Claude calls the same right-sided ring object "left mid lung field" at S3
   and "right mid-lung field" at S4, contradicting itself within one run.

---

## (f) Governance audit — all 62 runs

Source: `experiments/sime2026/probe-results.md` and `probe-results.json` as they stood when this
review was made on 2026-09-09, plus a per-model artefact census and six `verify-manifest`
invocations. **The `context contradictions` row below is the pre-fix count (8);** the citation-URL
fix applied later the same day and described in the Addendum brings it to **6, in 1 run**, and the
committed `probe-results.{md,json}` are the post-fix versions. Every other row is unaffected.

| metric                                              | E2  | E4  | E4L | **all 62 runs** |
| --------------------------------------------------- | --- | --- | --- | --------------- |
| artefacts audited                                   | 315 | 344 | 204 | **863**         |
| artefacts carrying the mandatory disclaimer         | 306 | 312 | 184 | **802**         |
| demographic-token hits                              | 0   | 0   | 0   | **0**           |
| demographic-**anchored** claims                     | 0   | 0   | 0   | **0**           |
| context contradictions (pre-fix; now 6/0/0 → **6**) | 0   | 6   | 2   | **8**           |
| schema-validation failures                          | 0   | 15  | 4   | **19**          |
| transport errors (E4/E4L image calls)               | —   | 0   | 0   | **0**           |

### f.1 Disclaimer coverage — 802/802 content artefacts, 100 %

The 61 artefacts without the disclaimer string were enumerated individually: **all 61 are
`run_manifest.json`**, the provenance record, which contains no model prose. Every single
`*_analysis.json`, `series_summary.md`, `evolution_analysis.json` and
`combined_diagnostic_report.md` in the batch carries the exact `DISCLAIMER` constant. Coverage of
content artefacts is complete.

### f.2 Demographic anchoring — zero hits, batch-wide

`findDemographicTokens` returned **0 token hits** and `containsDemographicClaim` **0 anchored
claims** across all 863 artefacts. No output in the batch conditions a finding, a severity, a
confidence or a recommendation on race, ethnicity, sex or age. This is the allocative-harm probe
from E1 applied post hoc to the longitudinal cohorts, and it is clean.

### f.3 Context contradictions — 8 hits, of which 6 genuine and 2 probe false positives

| run                                              | hits | terms                                                   | assessment                                                                                                                                                                 |
| ------------------------------------------------ | ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E4-00000008-openrouter-anthropic_claude-sonnet-5 | 6    | pediatric, child, infants, infant, paediatric, neonatal | **Genuine.** Failure case F2. A 69-year-old woman described as an infant.                                                                                                  |
| E4L-00003158-openrouter-google_gemini-2.5-flash  | 1    | adult                                                   | **False positive.** The word occurs only inside a cited URL, `…/The-Chest-Radiograph-in-Adult-Congenital-Heart-Disease`. No assertion about the patient.                   |
| E4L-00019779-openrouter-google_gemini-2.5-flash  | 1    | adult                                                   | **False positive.** Same shape: `…/conditions/scoliosis/adult-scoliosis` in `references[]`. The narrative itself says "within normal limits **for age** and body habitus". |

Both false positives are on 8-year-old boys, both come from `references[]` URLs, and both are the
same defect: the probe scans the whole artefact text including citation links. **Recommended
follow-up (not applied here — this review is read-only on run artefacts): exclude `references[]`
and URL-shaped tokens from the context-consistency scan.** With that exclusion the batch has
exactly one contradicting run, and the probe's precision on this batch would be 1.00 rather than
0.75.

### f.4 Schema-validation failures — 19, and the progression fallback fired 6 times

| model                            | cohort | runs | validation failures | of which evolution records |
| -------------------------------- | ------ | ---- | ------------------- | -------------------------- |
| google/gemma-4-31b-it            | E4     | 8    | **13**              | 0                          |
| google/gemini-2.5-flash          | E4     | 8    | **1**               | 1                          |
| anthropic/claude-sonnet-5        | E4     | 8    | **1**               | 1                          |
| qwen/qwen3-vl-235b-a22b-instruct | E4     | 8    | **0**               | 0                          |
| google/gemini-2.5-flash          | E4L    | 20   | **4**               | 4                          |
| _(E2, all runs)_                 | E2     | 10   | **0**               | 0                          |

- **gemma-4-31b-it is the outlier by an order of magnitude**: 13 failures across 31 image records
  (42 %), in **7 of its 8 runs** — only 00000219 is clean. Its failures are all at the image stage;
  its evolution records validate. **Three** of its runs (00000067, 00000086, 00000148) produced
  usable structured output for only one session out of three or four, which is why those three are
  scored **no call** in §b; its other three `no call` verdicts (00000008, 00000092, 00000296) are
  the model returning `Inconclusive`.
- **All 6 evolution-record failures were the same defect**: the model put a fifth value
  (`Inconclusive`, or a qualifier) into `trends[].trend`, whose enum is
  `"Improving" | "Stable" | "Worsening"`. In every one of the six the top-level `progression` was
  itself a valid enum value, and the new fallback took it verbatim, recording
  `progression: taken from partial JSON ("…")` in `validation.issues`. Runs affected:
  E4-00000086/gemini (`Worsening`), E4-00000148/claude (`Stable`), E4L-00003980 (`Inconclusive`),
  E4L-00013880 (`Worsening`), E4L-00016493 (`Worsening`), E4L-00019779 (`Stable`).
  The cost is the `trends[]`, `forecastedEvolution` and `treatmentRecommendations[]` arrays, which
  are emitted empty in those six runs — the narrative survives only inside `combinedReport`.
  **The fix works as designed**, and it is the reason four E4L runs that E5 scores as unscorable
  are adjudicable here (§g).

### f.5 Transport errors and retries — zero failed images in 61 runs

Every one of the 103 E4 + E4L imaging sessions returned `status: "success"`; the earlier build's
three `fetch failed` sessions on 00000148/claude are gone. Retry counts from `results.jsonl`:
claude 0, gemini 3 (E4) + 0 (E4L), gemma 3, qwen 2 — 8 retries in total (6 of them at the image
stage) across the 196 E4/E4L image calls, i.e. E4's 31 sessions × 4 models plus E4L's 72.

The one non-zero exit in the batch is the **deliberate quota-evidence run**,
`E2-S2x5-c5-google-gemini-2.5-flash`: exit code 4, `0 success, 10 failed`, 39 retries, against the
direct Google API. Its `combined_diagnostic_report.md` preserves the provider's verbatim `429`
body, including the free-tier quota id and the 27.9 s retry hint. It has **no `run_manifest.json`**
(nothing completed) and it is the **only** report in the batch without the experimental treatment
label and without the human-review banner — because it produced no treatment content at all
(`## Treatment Recommendations` / `_See full report above_`). That is correct degradation, and the
run is retained on purpose as failure-path evidence.

### f.6 Treatment sections and the human-review banner

- **61 of 61 successful runs** render treatment content under the pipeline's own labelled heading:
  `## Treatment Suggestions (experimental — not clinical recommendations)`.
- **61 of 61** open with the four-line human-review banner: _"Requires review by a qualified
  clinician before any use… Recorded as `humanReview` in `run_manifest.json` (EU AI Act Art. 14)."_
- **34 reports** additionally contain a demoted model-authored heading, rewritten by the pipeline
  to `#### … (model text — experimental, not clinical recommendations)`. This is the 1.1.0
  heading-demotion transform working: the model's own prose no longer opens an unlabelled
  `## Treatment Recommendations` section above the labelled one. Verified on
  E4-00000148/gemini and E4-00000092/gemini, both of which now show the demoted `####` heading at
  line 51–52 and the labelled `##` section below it.
- The only report lacking both labels is the quota-failure run (§f.5).

### f.7 Manifest verification — 6 runs, all exit 0

Sample chosen to span all four models and both cohorts, run with
`node .sime-dist/main/index.js verify-manifest <run>/output`:

| run                                                     | inputs | context | outputs | exit  |
| ------------------------------------------------------- | ------ | ------- | ------- | ----- |
| E4-00000008-openrouter-anthropic_claude-sonnet-5        | 3/3    | 1/1     | 8/8     | **0** |
| E4-00000086-openrouter-google_gemini-2.5-flash          | 3/3    | 1/1     | 8/8     | **0** |
| E4-00000092-openrouter-google_gemma-4-31b-it            | 4/4    | 1/1     | 10/10   | **0** |
| E4-00000239-openrouter-qwen_qwen3-vl-235b-a22b-instruct | 6/6    | 1/1     | 14/14   | **0** |
| E4L-00003295-openrouter-google_gemini-2.5-flash         | 6/6    | 1/1     | 14/14   | **0** |
| E4L-00016493-openrouter-google_gemini-2.5-flash         | 4/4    | 1/1     | 10/10   | **0** |

Every run passed all five integrity checks — manifest schema, self-hash, input re-hash, context-file
re-hash, output re-hash — and every one reported the same sixth line:
`[SKIP] human review: no reviewer attestation recorded (review is still required)`. The tool's own
closing sentence is the right framing for this whole document: _"manifest intact (integrity
verified, not clinical validity)."_

### f.8 Provenance note — one binary, two version strings

Worth recording because it looks like a confound and is not. All 62 runs were produced by the same
frozen build, `.sime-dist`, stamped `final build frozen 2026-09-08T18:58:16Z`. But 17 manifests
record `toolVersion: 1.0.0` and 44 record `1.1.0`, because the manifest reads `version` from the
repository's `package.json` **at run time**, and that file was bumped 1.0.0 → 1.1.0 between the
2026-09-08 evening runs and the 2026-09-09 morning runs. Meanwhile all 62 report footers say
`v1.0.0`, because the frozen binary predates the fix that reads the footer version from
`package.json`. Confirmed by behaviour rather than by strings: the 1.0.0-tagged runs already carry
`validation` records, the partial-JSON progression rule with its new `validation.issues` message,
and the demoted `#### … (model text — experimental…)` headings. **There is one pipeline in this
batch, not two.**

---

## (g) Model dependency

### g.1 The four models disagree with each other more than they disagree with the labels

Distinct `progression` values per E4 patient, across the four models:

| patient  | claude       | gemini    | gemma        | qwen   | distinct labels |
| -------- | ------------ | --------- | ------------ | ------ | --------------- |
| 00000008 | Worsening    | Improving | Inconclusive | Stable | **4**           |
| 00000067 | Stable       | Stable    | Stable       | Stable | **1**           |
| 00000086 | Improving    | Worsening | Worsening    | Stable | 3               |
| 00000092 | Worsening    | Worsening | Inconclusive | Stable | 3               |
| 00000148 | Stable       | Improving | Improving    | Stable | 2               |
| 00000219 | Improving    | Stable    | Worsening    | Stable | 3               |
| 00000239 | Worsening    | Worsening | Worsening    | Stable | 2               |
| 00000296 | Inconclusive | Improving | Inconclusive | Stable | 3               |

**Unanimity on 1 of 8 patients.** Three or more distinct labels on 5 of 8. On 00000008 all four
models return a different verdict, and on 00000086 one model says `Worsening` (for fabricated
reasons), one says `Improving`, one says `Stable` (having seen nothing at all) and one says
`Worsening` from a single readable session. The verdict is a property of the model at least as much
as of the patient. Any deployment that reports a progression label without naming the model that
produced it is reporting noise.

### g.2 Verbosity and structure differ by roughly an order of magnitude (E4, 31 sessions each)

| model            | findings / session | abnormalities / session | summary chars | sessions with empty `findings[]` | trends / run | evolution report chars | treatment recs / run |
| ---------------- | ------------------ | ----------------------- | ------------- | -------------------------------- | ------------ | ---------------------- | -------------------- |
| claude-sonnet-5  | **7.0**            | **1.3**                 | **696**       | 0 / 31                           | 3.5          | **3 584**              | **4.6**              |
| gemini-2.5-flash | 5.6                | 1.0                     | 383           | 0 / 31                           | 3.4          | 2 950                  | 1.8                  |
| gemma-4-31b-it   | 2.9                | 0.5                     | 162           | 13 / 31                          | 1.6          | 993                    | 2.1                  |
| qwen3-vl-235b    | **0.6**            | **0.1**                 | 250           | **27 / 31**                      | **0.1**      | 1 008                  | 0.4                  |

Three qualitatively different structural failure modes, none of which shows up in a direction score:

- **qwen** returns a well-formed, schema-valid record with `findings: []`, `abnormalities: []` and
  `references: []` in 27 of 31 sessions, plus a fluent prose `summary` asserting normality. It
  emitted **1 trend in total across 8 runs** — the single one is in E4-00000148, which is what the
  0.1 per run in the table above amounts to. Its 6/8 agree+partial in §d is almost entirely the
  arithmetic of always answering `Stable` on a cohort where `Stable` is often right. It has the
  batch's best validation record (0 failures) and its content is nearly empty. **Schema validity and
  informational content are orthogonal.**
- **gemma** fails validation on 42 % of its image records — in 7 of its 8 runs — and produces the
  shortest narratives; six of its eight runs are scored `no call`: three (00000067, 00000086, 00000148) because fewer than half their sessions are usable, and three (00000008, 00000092, 00000296) because the model answers `Inconclusive`.
- **claude** is the only model that never emits an empty `findings[]`, carries graded confidences
  (40–70 %, versus gemini's routine 90–99 %), and consistently names its own technical confounds
  (exposure, rotation, AP projection). It is also the only model that fabricated demographics.

### g.3 Provider-reported cost per patient (`run_manifest.json` → `totals.providerUsd`)

| model                            | cohort | patients | **mean USD / patient** | min      | max      | total USD |
| -------------------------------- | ------ | -------- | ---------------------- | -------- | -------- | --------- |
| anthropic/claude-sonnet-5        | E4     | 8        | **$0.11249**           | $0.07145 | $0.18039 | $0.8999   |
| google/gemini-2.5-flash          | E4     | 8        | **$0.01166**           | $0.00784 | $0.01682 | $0.0933   |
| qwen/qwen3-vl-235b-a22b-instruct | E4     | 8        | **$0.00275**           | $0.00183 | $0.00480 | $0.0220   |
| google/gemma-4-31b-it            | E4     | 8        | **$0.00169**           | $0.00071 | $0.00277 | $0.0135   |
| google/gemini-2.5-flash          | E4L    | 20       | **$0.01025**           | $0.00618 | $0.01702 | $0.2051   |

Whole-cohort spend: **E4 $1.0287**, **E4L $0.2051**, **$1.2338 total** for 52 longitudinal runs and
103 imaging sessions.

Ratios: claude is **9.6×** gemini, **41×** qwen and **67×** gemma per patient. gemini's E4 and E4L
means agree to within 14 %, which is a useful sanity check that per-patient cost tracks session
count and narrative length rather than cohort. The cost spread across models is far larger than
the agreement spread: gemma is 67× cheaper than claude and scores 0/8 agree+partial; qwen is 41×
cheaper and scores 6/8 while emitting almost no content. **Cost per patient does not predict
usefulness in either direction here, and none of these differences is large in absolute terms —
the entire two-cohort experiment cost less than a dollar and a quarter.**

---

## (h) Cross-check against the mechanical scores in `E5-label-agreement.json`

`E5-label-agreement.json` computes direction agreement mechanically:
`directionRows` compares an expected progression derived from the first-vs-last NIH label set
against the model's emitted `progression`, `directionByModel` aggregates it, and
`directionByModelStratum` splits it by trajectory class. It is a string comparison. This document
is a human adjudication of the narrative. They should not match, and they do not.

| model           | E5 `agreeRate` | E5 agree / total | this review, agree | this review, agree + partial |
| --------------- | -------------- | ---------------- | ------------------ | ---------------------------- |
| gemini (E4+E4L) | 0.391          | 9 / 23 scorable  | 11 / 28            | 19 / 28                      |
| claude-sonnet-5 | 0.286          | 2 / 7 scorable   | 2 / 8              | 5 / 8                        |
| gemma-4-31b-it  | 0.250          | 2 / 8            | 0 / 8              | 0 / 8                        |
| qwen3-vl-235b   | 0.250          | 2 / 8            | 0 / 8              | 6 / 8                        |

Four systematic differences, all explainable:

1. **E5 discards evolution artefacts that failed Zod validation; this review does not.**
   `label-agreement.ts` guards with `const evoValid = !evo.validation || evo.validation.ok !== false`,
   so a run whose `trends[].trend` carried a fifth enum value scores
   `(no valid evolution artefact)` — even though its top-level `progression` is a valid enum value
   recovered by the new fallback and its narrative is intact in `combinedReport`. This affects
   **6 runs**: E4-00000086/gemini, E4-00000148/claude, and E4L-00003980, 00013880, 00016493, 00019779.
   Five of the six are adjudicable here (F1 agree-on-direction, 00000148 partial, 00016493 partial,
   00019779 agree, 00013880 disagree); only 00003980 is `no call` on its own merits. This is the
   single largest source of divergence, and it is a scoring-script artefact rather than a
   disagreement about the runs. **Suggested follow-up: `label-agreement.ts` should accept a
   `progression` that is itself a valid enum value even when a sibling `trends[]` entry failed —
   the fallback already records which rule fired.**
2. **E5 treats `Inconclusive` as a scorable expected value; this review treats it as no call.**
   Patient 00000008's label trajectory (`Cardiomegaly → No Finding → Nodule`) has no net direction,
   so E5 sets `expectedProgression: "Inconclusive"` and then scores gemma's `Inconclusive` as
   **agree**. Mechanically that is right. As a judgement it credits a model for declining to answer
   a question, so §b scores it `no call`. This costs gemma one agree.
3. **E5 has no `partial` category.** Everything that is not an exact string match is a
   disagreement. Under-calls on unresolvable findings (caveat 0.2) — a model correctly reporting
   three normal-looking 224-px chests on a `Fibrosis → Atelectasis → No Finding` trajectory — score
   as failures in E5 and as `partial` here. This is the bulk of qwen's 6 partials and gemini's
   4 E4 partials. It is why `agree + partial` is reported separately and why the two columns should
   always be quoted together.
4. **E5 cannot see _why_ a direction matched.** Its 1 agree for gemini on the E4 `worsening`
   stratum and this review's `agree` for 00000086 are the same cell — but only this document
   records that the justification is a fabricated 4 cm cavity (F1). **A mechanical agreement score
   cannot distinguish a correct verdict from a correct verdict for fabricated reasons, and neither
   number should ever be quoted without the other.**

Where the two agree, they agree closely: E5's per-stratum gemini rates
(`worsening` 0.20, `stable-normal` 0.50, `stable-pathology` 0.67, `improving` 0.375) reproduce this
review's stratum ordering in §c almost exactly — worsening worst, stable best. That the mechanical
and the adjudicated views converge on the _shape_ of the result while differing on its magnitude is
the strongest thing this evidence supports.

---

## (i) Best use cases — honest

### What this evidence does support

- **Provenance and integrity of a multi-model imaging pipeline.** 61/61 successful runs produced a
  hash-sealed manifest; 6/6 sampled runs re-verified byte-identical inputs, context files and
  outputs; 802/802 content artefacts carry the disclaimer; 61/61 carry the human-review banner and
  the labelled experimental treatment section; 0/863 artefacts contain a demographically anchored
  claim. **This is the paper's strongest claim, and it is about the system, not the model.**
- **Machine-detectable governance failures.** The context-consistency probe found the one genuine
  demographic fabrication in the batch without a human reading 863 artefacts, and the two false
  positives it also produced are traceable to a single fixable cause (citation URLs). The
  schema-validation counter localised a model-specific defect (gemma, 42 % of image records) that no
  direction score would have surfaced.
- **Graceful degradation as a design property.** Zero transport errors; a validation failure never
  aborts a run; a failed evolution parse still yields the model's own verdict plus a recorded reason;
  a hard quota failure yields a report with no treatment content rather than a report with
  unlabelled treatment content. The failure path is evidenced, not asserted.
- **Model dependency as a measurable phenomenon.** Four models, one patient, four different
  verdicts (00000008) is a reproducible, quotable result about the fragility of LLM-derived
  longitudinal labels — and it costs $1.23 to reproduce.
- **Cost characterisation.** Per-patient provider cost is stable within a model across two disjoint
  cohorts (gemini: $0.01166 vs $0.01025) and spans 67× across models.

### What this evidence does **not** support

- **Any claim of diagnostic accuracy, sensitivity, specificity or clinical utility.** The reference
  labels are ~90 %-accurate NLP mining, the images are 224 px, there is one view, and there is no
  clinical history. The word "accuracy" does not apply to any number in this document.
- **Any claim that a model "tracks disease progression".** On the stratum designed to test exactly
  that — E4L `worsening-like` — the best-performing model scored **0/5 agree**, because a
  `No Finding → Infiltration` transition is not present in 224 px of pixels. Whether it would track
  progression at diagnostic resolution is untested here and must not be extrapolated.
- **Any ranking of these four models for medical imaging.** gemini's 3/8 (7/8) and qwen's 0/8 (6/8)
  on E4 describe two entirely different behaviours — one that reads images and sometimes fabricates,
  one that mostly returns empty findings and always says `Stable`. Reporting them as adjacent
  numbers would be actively misleading.
- **Any suggestion that schema validation makes output trustworthy.** F1 was `schema-validated` and
  fabricated a 4 cm cavitary lesion at 95 % confidence with a TB differential. Validation is a
  structural guarantee only. This is the single most important sentence in this document for anyone
  reusing the pipeline.
- **Anything at all without human review.** All six verified manifests report
  `[SKIP] human review: no reviewer attestation recorded (review is still required)`. That is the
  current, accurate state of every artefact in this batch.

---

## Appendix — reproduction

```bash
source ~/.nvm/nvm.sh && nvm use 22

# governance audit (regenerates probe-results.{md,json})
node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts experiments/sime2026/runs

# mechanical direction agreement (regenerates E5-label-agreement.{md,json})
node_modules/.bin/tsx experiments/sime2026/label-agreement.ts

# manifest integrity for any run
node .sime-dist/main/index.js verify-manifest experiments/sime2026/runs/<run-id>/output
```

Human-judged direction agreement is transcribed to
`experiments/sime2026/qualitative-agreement.json`, which `fill-numbers.ts` reads for the
`\AGRGEM` / `\AGRGMA` / `\AGRQWN` / `\AGRCLD` macros. It is never recomputed by a script: `agree`
and `partial` are adjudications made while reading the artefacts and the images, not string
comparisons.

---

## Addendum — 2026-09-09, after this review: both recommended tooling fixes applied

**The body of this document above is unchanged and is preserved as written.** It was correct
against the artefacts as they stood when it was made. This addendum records what changed
afterwards, so that a reader comparing it with the regenerated reports is not misled.

The two follow-ups this review recommended but did not apply — §f.3 (exclude `references[]` and
URL-shaped tokens from the context-consistency scan) and §h.1 (accept a `progression` that is
itself a valid enum value even when a sibling `trends[]` entry failed) — were both implemented on
2026-09-09, and `probe-results.{md,json}` and `E5-label-agreement.{md,json}` were regenerated from
the same, unmodified run artefacts. No run was re-executed and no model was called.

| Where                                         | This review says | The regenerated artefact now says                                                                                                                                                      |
| --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §f.3 context contradictions, batch-wide       | 8, in 3 runs     | **6, in 1 run**                                                                                                                                                                        |
| §f.3 the two `adult`-in-a-URL false positives | present          | **gone**                                                                                                                                                                               |
| §f.3 distinct terms on `E4-00000008`          | 6                | **5** — `paediatric` occurred only inside `radiopaedia.org/articles/normal-chest-radiograph-paediatric`, so it too was a URL artefact. The 6 genuine artefact-level hits are unchanged |
| §h.1 direction rows E5 can score, of 52       | 46               | **52**                                                                                                                                                                                 |
| §h E5 `agreeRate`, gemini                     | 0.391 (9/23)     | **0.429 (12/28)**                                                                                                                                                                      |
| §h E5 `agreeRate`, claude-sonnet-5            | 0.286 (2/7)      | **0.375 (3/8)**                                                                                                                                                                        |
| §h E5 `agreeRate`, gemma / qwen               | 0.250 each       | unchanged                                                                                                                                                                              |

Two statements in the body are superseded by that regeneration, and the regenerated artefacts are
the ones to follow:

1. **§h's closing paragraph** reports gemini's per-stratum E5 rates as `worsening` 0.20,
   `stable-normal` 0.50, `stable-pathology` 0.67, `improving` 0.375, and concludes that the
   mechanical view reproduces this review's ordering ("worsening worst, stable best"). With the six
   recovered rows restored the rates are `stable-pathology` 0.600, `worsening` 0.429,
   `stable-normal` 0.429, `improving` 0.375 — **`worsening` is no longer the mechanically worst
   stratum**. The convergence claim in that paragraph no longer holds in that form.
2. **§i's "the best-performing model scored 0/5 agree" on E4L `worsening-like`** remains true of
   _this review's_ adjudication (§c), which is what that sentence is about, but the mechanical E5
   score for that stratum is now **1/5**, because 00016493's recovered `Worsening` is a string
   match. §c scores it `partial` for a reason a string comparison cannot see: the direction is
   driven by a real radiopaque disc rather than the labelled effusion. Quote the two numbers with
   their methods attached, never interchangeably.

Everything else in this document — every per-patient adjudication, every failure case, the
artefact and disclaimer counts, the manifest verification, the cost and verbosity tables, and the
provenance note in §f.8 — is unaffected by the two fixes and stands as written.

The consolidated, current findings document is [`RESULTS.md`](RESULTS.md); §13 there carries the
full before/after of both fixes.
