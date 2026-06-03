# ADR-005: Canonical architecture reference

- **Status:** Accepted
- **Date:** 2026-06-03
- **Supersedes / relates to:** ADR-001 (LangGraph orchestration), ADR-002 (Gemini
  search grounding), ADR-003 (image preprocessing), ADR-004 (single-model
  monoculture risk).

## Context

This project is a reference implementation for an ethically-deployed, regulated
agentic AI workflow. Earlier ADRs each capture one decision; this ADR records the
**design as a whole** so the pattern can be reviewed and reused intact. The goal
is a small, inspectable codebase whose governance posture (disclaimers, compliance
cross-walk, threat model, cost control) is visible in the repository itself.

## Decision

The canonical shape is:

1. **Ports-and-adapters layering.** `domain/` (pure types, errors, fairness
   probe) ← `application/` (use-cases) ← `infrastructure/` (Gemini client, file
   scanner, report writer, cost meter, logger) ← `adapters/` (LangGraph wiring)
   ← `main/` (CLI composition root + handler). The orchestration framework is
   quarantined to `adapters/`.
2. **LangGraph fan-out / fan-in StateGraph.** `analyzeImages` (fan-out) →
   `aggregateSeries` (fan-in) → `analyzeEvolution`. See
   [docs/architecture.md](../../architecture.md).
3. **Bounded concurrency via `p-limit`.** Parallel image analysis is capped; the
   cap is property-tested (`tests/unit/concurrency.property.test.ts`).
4. **Structured, inspectable outputs.** Per-image JSON, per-series Markdown, and a
   combined evolution report — written to disk, never auto-actioned.
5. **A required disclaimer on every output type**, enforced at the TypeScript
   type level (`domain/types.ts`) and asserted by a walk-every-output test.
6. **Defensive operations as first-class concerns.** Optional `--max-cost-usd`
   cost cap from real token usage; zero-dependency structured logging with secret
   redaction (silent by default); SECURITY.md + supply-chain CI (SBOM, OSV-Scanner,
   Trivy, license allow-list).

## Consequences

- **Positive.** The domain and application layers are framework-agnostic and
  unit-testable; swapping orchestration or model backend touches only
  `adapters/` / `infrastructure/`. Governance is auditable from the repo. New
  capabilities (cost cap, logging) were added strictly additively.
- **Negative / trade-offs.** The layering is heavier than a single-file script;
  justified here because regulated/medical context makes inspectability the
  priority. Single-model dependence remains a risk tracked in ADR-004.

## Reusability

This design is intended as a template for similar agentic, regulation-aware tools:
the layering, the disclaimer-at-the-type-level pattern, the cost meter, and the
supply-chain CI baseline are the parts most worth copying.
