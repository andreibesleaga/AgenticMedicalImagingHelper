# ADR-004: Single-Model Gemini Today, with Documented Triggers for Hybrid SLM Routing

**Date**: 2026-05-12
**Status**: Accepted
**Deciders**: Claude Code, Project Owner

---

## Context

This project today calls **a single model**: `gemini-2.5-pro` via the `@google/generative-ai` SDK. [ADR-002](ADR-002-gemini-search-grounding.md) committed to Gemini for Google Search grounding; [ADR-003](ADR-003-image-preprocessing.md) optimised payloads for it. Both decisions assumed a one-model deployment.

That assumption needs to be made explicit, defensible today, and revisable on signal. This ADR records (a) why a single model is acceptable for the project's current scope and (b) the named triggers that would flip the decision toward a multi-model router.

---

## Options Considered

### Option A: Single-model Gemini (current state)

**Approach**: Continue calling `gemini-2.5-pro` directly through one client. No router, no fallback.

**Pros:**

- Simplest possible operational surface — one API key, one client, one billing relationship.
- Native Google Search grounding ([ADR-002](ADR-002-gemini-search-grounding.md)) is a _single-vendor feature_; switching mid-task would lose it.
- Image-token cost characteristics are predictable (one model, one pricing tier).
- Aligned with the "research / educational tool" positioning in [docs/COMPLIANCE.md](../../COMPLIANCE.md) — no clinical-deployment liability exposure that monoculture would magnify.
- Test surface is small and complete (see `tests/unit/infrastructure/gemini-client.test.ts`).

**Cons:**

- Direct exposure to any quality regression, safety-policy change, deprecation, outage, price shift, or geopolitical access change at one vendor.
- No automatic A/B comparison to catch silent quality drift across model versions.

---

### Option B: Hybrid SLM router

**Approach**: Front the model call with a router that picks between (e.g.) `gemini-2.5-pro` for the heavy temporal-synthesis step and a smaller, open-weights vision model (LLaVA, Qwen-VL, MedGemma) for per-image first-pass analysis. Reflection step compares outputs across families on a sample.

**Pros:**

- multiple foundation families behind one interface.
- Token-velocity gain: cheap small model for the bulk of fan-out work.
- Sustainability gain: smaller models on edge / NPU hardware; reserve cloud Gemini for the expensive temporal node.
- Vendor-shock resilience: an outage or policy change at one provider degrades but does not stop the pipeline.

**Cons:**

- 3–5× operational complexity today: two clients, two prompt families, two response parsers, two test surfaces.
- Per-image Google Search grounding ([ADR-002](ADR-002-gemini-search-grounding.md)) does not transfer — a smaller model would need an external retrieval step, undoing that ADR's simplification.
- Quality-equivalence is unproven for medical imaging at the smaller model sizes — would need a clinician-graded evaluation harness before trusting the router.
- Premature optimisation for a project whose stated scope is educational / single-maintainer.

---

### Option C: Mirror-call pattern (single user-visible path, dual-call shadow)

**Approach**: Route 100% of production traffic through Gemini, but for a small percentage of requests _also_ call a second model in shadow mode and log the divergence. No user-visible behaviour change.

**Pros:**

- Generates the data needed to know whether Option B would be worthwhile, without committing the full operational cost.
- Cheap to add; cheap to remove.
- Naturally produces the evidence base for Option B if/when the triggers below fire.

**Cons:**

- Doubles the cost on the shadow fraction; consumes a second API quota.
- Does not actually protect against vendor failure — it just measures the gap.
- Requires a divergence-analysis pipeline that the project does not yet have.

---

## Decision

**Adopt Option A (single-model Gemini) today.** Defer Option B until at least one of the **trigger conditions** below fires. Treat Option C as a possible interim step if the project ever takes a clinical-deployment turn before any trigger has fired.

The acceptable-for-now case rests on three facts about the project's _current_ scope:

1. **Educational scope, type-enforced.** Every output carries the `DISCLAIMER` constant — a misbehaving model is materially limited in the harm it can do, because no clinical decision is supposed to depend on it. See [docs/COMPLIANCE.md](../../COMPLIANCE.md).
2. **Fairness probe in place.** [tests/e2e/fairness.test.ts](../../../tests/e2e/fairness.test.ts) + [src/domain/fairness.ts](../../../src/domain/fairness.ts) will fire the moment a Gemini upgrade introduces demographic-anchored output. This is the most plausible monoculture-flavoured regression for this domain.
3. **Single maintainer, open source.** A two-model router with no clinician evaluation harness would be cargo-cult diversity. Better to be deliberately monocultural and _named_ about it than to be cosmetically diverse and untested.

---

## Trigger Conditions — Re-open This ADR When Any Fire

This is the part of the decision that matters. The single-model choice is reversible, _if_ we know when to reverse it.

| #      | Trigger                                                                                                                                                                                     | Where the signal comes from                                                      | First step on fire                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **T1** | Fairness regression in [tests/e2e/fairness.test.ts](../../../tests/e2e/fairness.test.ts) fires on a Gemini version bump and the demographic-anchored output is reproducible across two runs | CI; manual reproduction                                                          | Open ADR-005 to scope a second-family fallback for at least the per-image analysis node                          |
| **T2** | The project pivots from "educational" to any form of clinical-decision support (CE / FDA / SaMD claim)                                                                                      | Roadmap / stakeholder ask                                                        | Adopt Option B immediately; mitigation becomes mandatory under EU AI Act Art. 15 (robustness)                    |
| **T3** | Gemini quality regression measured across two consecutive model versions on a held-out medical-imaging eval set, ≥ 10% drop on the primary metric                                           | Clinician-graded eval harness (does not yet exist — itself a gap)                | Implement Option C first to quantify the divergence                                                              |
| **T4** | Gemini outage exceeds 8 hours within a 30-day window, or a regional access restriction blocks the deployment territory                                                                      | Operational alerting (does not yet exist)                                        | Implement Option B with at least one open-weights fallback (LLaVA / Qwen-VL / MedGemma) for graceful degradation |
| **T5** | Token cost per analysis grows by ≥ 50% across a single pricing change                                                                                                                       | Per-run cost ledger (roadmap item 4 in [COMPLIANCE.md](../../COMPLIANCE.md)) | Implement Option B routing fan-out work to a smaller, cheaper model                                              |
| **T6** | A second deployer of this codebase adopts it under a different jurisdiction (e.g., EU AI Act Art. 26 deployer obligations attach for Annex III use)                                         | External adoption signal                                                         | Adopt Option B; deployer obligations under Annex III effectively require it                                      |
| **T7** | A published vulnerability or alignment failure in `gemini-2.5-pro` (or its successors) affects medical-imaging outputs                                                                      | Vendor advisory; CVE; academic disclosure                                        | Hot-swap to Option B on the affected pathway only                                                                |

If none of these fire and the project remains educational, single-model is the right shape and this ADR holds.

---

## Consequences

**Positive:**

- Operational surface stays minimal — appropriate for a single-maintainer educational tool.
- ADR-002 (Google Search grounding) and ADR-003 (single-pipeline preprocessing) remain coherent.
- Decision is documented and revisable rather than implicit.

**Negative:**

- monoculture mandate is acknowledged as **deferred, not discharged**. The fairness regression catches the most likely failure mode; everything else (outage, deprecation, geopolitical access) is accepted risk for the current scope.
- If any T1–T7 fires unexpectedly, the project will be operating on borrowed time until Option B lands.

**Neutral:**

- Option C is held in reserve as a low-cost first move if a clinical pivot is contemplated.

---

## Y-Statement Summary

For an educational medical-imaging CLI that depends on Google Search grounding and writes a mandatory disclaimer into every output, sticking with single-model Gemini today is acceptable because the disclaimer caps downstream harm and the fairness probe catches the most likely regression — but we name seven triggers (fairness regression on upgrade, clinical-scope pivot, ≥10% quality drop, ≥8h outage, ≥50% cost shock, second deployer attracts Annex III obligations, or a vendor-side vulnerability) any of which immediately re-opens this decision in favour of a hybrid SLM router.

---

_ADR created by: Claude Code | 2026-05-12_
_Pairs with [docs/COMPLIANCE.md](../../COMPLIANCE.md) (EU AI Act Art. 15) and (NIST MEASURE 2.4)._
