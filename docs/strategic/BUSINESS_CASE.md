# Business Case: AgenticMedicalImagingHelper

<!-- Created by: business-case.skill | Phase: S0 | Date: 2026-02-25 -->
<!-- Classification: Internal -->

---

## 1. Problem Definition

### Status Quo

Clinicians, radiologists, and clinical researchers who wish to apply AI-assisted analysis to medical imaging data currently face a fragmented, manual workflow:

- Tools like Google Gemini Vision exist but require per-image API calls with no batch automation.
- Multi-angle series (MRI slices, CT sequences, X-rays from different positions) must be analyzed individually with no cross-view correlation.
- Temporal comparison (baseline vs. follow-up sessions) is done manually by comparing PDF reports — slow and error-prone.
- Supplementary clinical text (existing diagnoses, lab results, patient history) cannot be automatically fused with image analysis.

**Quantified Impact (estimated per session):**
| Activity | Manual Time | Automated |
|---|---|---|
| 20-image batch analysis | ~60 min | ~3 min |
| Cross-series correlation | ~30 min | ~1 min (LLM synthesis) |
| Temporal evolution write-up | ~20 min | ~1 min |
| **Total per session** | **~110 min** | **~5 min** |

---

## 2. Strategic Alignment

**Primary User**: Radiologist or clinical researcher running analysis locally on a workstation.

**Secondary User**: Medical AI developer/researcher evaluating Gemini Vision for clinical pipelines.

**Project Goals:**
- Automate batch processing of entire medical image series with agentic AI
- Provide temporal evolution analysis (disease progression tracking)
- Deliver structured, explainable output (JSON + Markdown) for each series and combined view
- Keep the tool local, simple, and CLI-driven (no cloud deployment required)

**OKR Alignment:**
- O: Reduce time from image acquisition to AI-assisted report → KR: ≥90% reduction in manual analysis time per session
- O: Increase analysis completeness → KR: Per-image, per-series, and evolution reports generated for every run

---

## 3. Solution Options

### Option A — Do Nothing (Baseline)
Use Gemini Vision manually (Streamlit web app, single image at a time).

**Pros:** No development effort.
**Cons:** No batch processing, no series aggregation, no temporal analysis, no CLI, no text context fusion.
**Risk:** Low (status quo maintained).
**ROI:** 0%.

---

### Option B — Minimal Sequential CLI
A simple TypeScript CLI that processes images one by one, producing per-image output with no fan-out parallelism and no temporal analysis.

**Pros:** Simple to build (~1 week), CLI interface.
**Cons:** Slow for large batches (sequential), no cross-series analysis, limited value over baseline.
**Risk:** Medium (useful but incomplete).
**Estimated dev effort:** 1 developer × 1 week.

---

### Option C — Full Agentic Fan-Out/Fan-In CLI (Target)
TypeScript CLI with LangGraph.js orchestration:
- Parallel image analysis (Fan-Out via `Send` API)
- Per-series aggregation (Fan-In)
- Cross-series temporal evolution
- Text context fusion
- Google Search grounding for research citations

**Pros:** Full automation, maximum accuracy, temporal evolution, production-grade.
**Cons:** Higher development effort (~2 weeks).
**Risk:** Medium (LangGraph.js API surface, Gemini rate limits).
**Estimated dev effort:** 1 developer × 2 weeks.

**Decision: Option C** — The temporal evolution and parallel processing capabilities justify the additional effort. This is the only option that fully addresses the multi-series, multi-session clinical workflow.

---

## 4. Financial Analysis (ROI)

**Costs:**
- Development: 2 weeks × 1 developer (sunk cost, in-project)
- Infrastructure: $0 (local execution)
- API: Gemini API free tier = 1,500 requests/day → ~300 images/day at no cost
- Maintenance: ~2 hours/month

**Benefits (per user per month, assuming 5 sessions/week):**
- Time saved: 105 min/session × 20 sessions = 2,100 min = 35 hours
- At $150/hr (radiologist rate): **$5,250/month value created**

**ROI = (5,250 - ~0 ongoing cost) / ~0 ongoing cost = effectively unlimited for local use**
**Payback period: Immediate (no ongoing cost beyond API quota)**

---

## 5. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Gemini API rate limits slow batch | Medium | Medium | `p-limit` concurrency control (max 5 concurrent) |
| Medical liability from AI output | High | High | Mandatory educational-use-only disclaimer on all outputs |
| Image format diversity (DICOM) | Medium | Low | Phase 1 scope: PNG/JPG/JPEG only; DICOM deferred to v2 |
| LangGraph.js API instability | Low | Medium | Pin dependency version; unit-test graph wiring |
| Prompt injection via text context | Low | Medium | Sanitize + delimit text input with XML tags |

---

## 6. Recommendation

**Proceed with Option C** — Full Agentic Fan-Out/Fan-In CLI.

**Definition of Success:**
- A clinician can run `medical-imaging analyze ./input ./output` and receive:
  1. Per-image JSON analyses for every image in every series
  2. Per-series Markdown summaries with consistent findings + primary diagnosis
  3. A combined `combined_diagnostic_report.md` with temporal evolution, progression assessment, and treatment recommendations
- All in under 5 minutes for a 20-image, 2-series batch
- All outputs include educational-use-only disclaimer

---

*Prepared by: Claude Code (business-case.skill) | 2026-02-25*
*Classification: Internal | Not for patient-facing use*
