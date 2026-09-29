# Prior-art and defensive-publication notice

**Author:** Andrei N. Besleaga, Independent Researcher and Software Architect, Romania
**Repository:** <https://github.com/andreibesleaga/AgenticMedicalImagingHelper>
**Notice first written:** 2026-09-29

## Purpose

This document is a **defensive publication**. It discloses, publicly and with
dates, the technical elements of this system and of its planned successor, so
that they are part of the state of the art from the dates below and can be found
and cited by anyone, including patent examiners. The author has not filed a
patent on any of them and publishes them so that they remain free for everyone
to use under the repository's licence (GNU GPL v3.0).

What establishes prior art is the **dated, public, accessible disclosure** of
the elements themselves, not any claim of being first. The novelty statement
below is therefore made only to the author's knowledge, after the literature
survey cited in the SIME 2026 paper and in `docs/ROADMAP.md`; it is not a legal
opinion and does not assert that no earlier work exists.

## Dated public disclosures

| Date | Disclosure | Identifier |
| --- | --- | --- |
| 2026-02-26 | First public commit of the repository | commit `f104a54` / `8336ad1` |
| 2026 | First version of the program presented as chapter companion code in the Wiley book *Agentic AI Architectures* by Andrei Besleaga (forthcoming) | book and its companion material |
| 2026-09-09 | Preprint of the SIME 2026 paper | DOI [10.5281/zenodo.20762929](https://doi.org/10.5281/zenodo.20762929) |
| 2026-09-10 | Release described in the paper | tag `v1.1.0` |
| 2026-09 | IEEE SIME 2026, paper #154 (accepted; presented 2–4 November 2026) | conference proceedings |
| 2026-09-29 | Full-evaluation programme, local-inference design, guardrails described below | `docs/ROADMAP.md` §10–11, `docs/architecture/LOCAL-INFERENCE.md`, `docs/architecture/TARGET-ARCHITECTURE.md`, this file, and the commits that add them |

Every later change is dated by its commit and tag in the public history.

## Elements disclosed

Each element is described in the files named, which are the disclosure.

### A. Implemented (v1.1.0 and later)

1. **Longitudinal agentic imaging pipeline**: a fixed state graph that fans out
   one model call per image with a concurrency limit, fans in per imaging
   session into a validated summary, then compares sessions over time into a
   better/same/worse verdict, per-finding trends, a forecast and labelled
   experimental treatment ideas (`src/adapters/langgraph-agent.ts`, `docs/architecture.md`).
2. **Schema validation per stage with a partial-JSON fallback** that records
   the failure instead of aborting the run (`src/domain/structured-output.ts`).
3. **Provider port** with interchangeable Gemini, OpenRouter and local
   OpenAI-compatible adapters (Ollama, vLLM, llama.cpp), model-aware image
   pre-flight sized to each model family's vision encoder, and zero-pricing for
   local models (`src/infrastructure/*`).
4. **Hash-sealed, chained run manifest** recording every model call (stage,
   tokens, cost, retries, input and output hashes), the human-review record and
   the previous run's hash, with offline verification (`src/infrastructure/run-manifest.ts`, ADR-007).
5. **Type-enforced disclaimer and clinician-review block** on every artefact;
   treatment headings in model text relabelled as experimental
   (`src/infrastructure/report-writer.ts`).
6. **Deterministic output-level fairness probe**, version 1 (published figures)
   and version 2: demographic and social attribute classes, justifier phrases,
   sentence scope, negation handling, clinical-homonym masking, and the rule that
   a stereotype phrase cannot be its own justification; with a held-out labelled
   benchmark written before evaluation (`src/domain/fairness*.ts`, `tests/fixtures/fairness-benchmark*.json`).
7. **Context-consistency probe** comparing generated demographics with the
   supplied patient note (`src/domain/context-consistency.ts`).
8. **Unsupported-measurement probe**: absolute sizes in output flagged because
   PNG/JPEG inputs carry no pixel spacing; sized findings at ≥ 90 % model
   confidence ranked first (`src/domain/measurement-probe.ts`).
9. **Input guard**: content-type sniffing against the extension, detection of
   embedded PNG/JPEG metadata with mandatory stripping by re-encode, and
   detection of instruction-like text in context files, warn-by-default with a
   refusing `--secure` mode (`src/domain/input-guard.ts`).
10. **Input-integrity check** against a list of SHA-256 digests of the expected
    original dataset files before any upload (`--expect-hashes`).
11. **Output sanitisation** of model text before report rendering (HTML escape,
    unsafe link removal, control-character removal).
12. **PHI pre-flight on context text** with masked excerpts, DICOM refusal by
    extension and magic bytes, cost cap, bounded retry, and deterministic exit
    codes for every refusal (`src/domain/phi-scan.ts`, `docs/SPEC.md` §2.3).
13. **Traceability matrices** mapping EU AI Act articles and NIST AI RMF
    functions to code and tests, and a threat model (`docs/COMPLIANCE.md`,
    `docs/architecture/THREAT_MODEL.md`).
14. **Reproducibility packs** in which every published number is regenerated
    from committed run records (`experiments/sime2026/`, `experiments/sime-full/`).

### B. Designed and published, not yet implemented

15. **Quality-first router**: two models in parallel, cross-checked, with
    disagreement surfaced; an economy mode; fallback chain across cloud and local.
16. **In-graph human-review gate** that suspends the graph before the
    longitudinal step until an attested approval.
17. **Decision port using Jev (TypeSafe AI)** or a local equivalent: typed,
    text-only decisions consulted by probes, the gate, the router and the
    evaluation harness, never reading images or writing findings, each decision
    recorded in the manifest.
18. **Profiles** (`research`, `physionet`, `clinical-research`) enforcing
    provider allow-lists, zero-retention configurations and loopback-only local
    endpoints for credentialed data.
19. **Evidence-driven architecture evolution**: fitness criteria fixed in
    advance, candidates evaluated on development splits, one-time held-out
    evaluation of the winner, adoption by decision record.
20. **Library, HTTP service and MCP interfaces** with a machine-readable control
    register that fails CI when a claimed control lacks a passing test.
21. **Bias governance**: group error rates with confidence intervals,
    counterfactual patient-note tests, demographic-shortcut tests, per-dataset
    datasheets.
22. **Evaluation programme** on original-resolution NIH images, PhysioNet
    longitudinal and expert-labelled sets, and open expert-labelled datasets,
    with a clinician reader study (`docs/ROADMAP.md` §10).

## Statement of novelty (to the author's knowledge)

To the author's knowledge, as of the dates above, no earlier publicly available
system surveyed in the SIME 2026 paper or in the roadmap combines elements 1, 4,
6, 8 and 9 (a longitudinal fan-out/fan-in agentic imaging pipeline, a
hash-chained per-call audit record, deterministic fairness and measurement
probes, and input and output guards) in one open, tested implementation, together
with the published evaluation and the designs in part B. This statement is
limited to the works the author surveyed and will be revised if earlier work is
found.

## How to cite

Please cite the SIME 2026 paper and this repository (see `CITATION.cff`). Works
that build on these elements are asked to cite them; patent applicants and
examiners are asked to consider this document and the dated commits as prior art.

See `NOTICE` for copyright and `DISCLAIMER.md` for use restrictions.
