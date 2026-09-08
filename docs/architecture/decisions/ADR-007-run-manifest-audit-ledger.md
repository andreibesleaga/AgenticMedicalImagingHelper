# ADR-007: Per-run manifest sealed into a hash-chained audit ledger

- **Status:** Accepted
- **Date:** 2026-09-08
- **Relates to:** ADR-003 (image preprocessing — the manifest records which
  preset was in force), ADR-005 (canonical architecture reference),
  ADR-006 (second provider — the manifest records which one ran).
- **Obligations addressed:** EU AI Act **Art. 12** (record-keeping / automatic
  logging), **Art. 14** (human oversight), **Art. 15** (robustness), **Art. 26(6)**
  (deployer log retention); NIST AI RMF **MANAGE 4.1**, **MEASURE 2.7**,
  **MEASURE 2.12**; HIPAA **§164.312(b)** (audit controls);
  HIPAA **§164.514(b)** / GDPR **Art. 9** (de-identification, via the PHI scan).

## Context

Until this decision, the only record a run left behind was its output tree plus
whatever `--verbose` had written to a terminal that nobody kept.
[docs/COMPLIANCE.md](../../COMPLIANCE.md) recorded the consequences honestly:
Art. 12 was **Partial** with "structured, hash-chained run manifests" named as
the gap, MANAGE 4.1 was a flat **Gap**, and MEASURE 2.7 was **Partial** because
no automated PHI check existed. The SIME 2026 paper carries the same item as
future work.

Three things were missing, and they are different problems:

1. **Nothing was recorded.** Which model answered, at which price, over how
   many tokens, against which exact input bytes — all of it was inferable at
   best and gone at worst. An Art. 12 log that only exists as terminal
   scrollback is not a log.
2. **Nothing was verifiable.** Even a written record can be edited afterwards,
   and a research artefact whose numbers back a published table needs to be
   checkable by someone who was not there.
3. **Nothing looked at what was being uploaded.** The tool told the operator
   in prose that de-identification was their job, then uploaded whatever it was
   handed, including a `context.txt` with `Patient Name:` at the top.

## Decision

**Every run writes `<outputDir>/run_manifest.json`, sealed with a SHA-256 over
the canonical JSON of its own content, and optionally appended to a JSON-Lines
ledger that links it to the previous run's seal.**

- **`src/infrastructure/run-manifest.ts`** builds, seals, writes and verifies
  the manifest, and owns the chain file. It records: tool and schema version,
  start/finish timestamps, provider and model, the pricing table used, the
  settings that change results or cost (`concurrency`, `maxCostUsd`,
  `retries`, `IMAGE_QUALITY`), SHA-256 + byte length of every input image and
  context file, **one row per model call** (stage, timestamp, tokens in/out
  including thinking tokens, per-call USD estimate, provider-reported USD,
  retries consumed), SHA-256 of every artefact written, run totals, the exit
  code, the run's warnings, the human-review record, and `prevManifestHash`.
- **Canonical JSON** (keys sorted recursively, `undefined` dropped, arrays in
  order) is what gets hashed, so two structurally identical manifests hash
  identically and key order cannot silently change a digest.
- **Per-call rows come from the cost meter's existing `onCall` hook.** The
  meter's semantics are untouched — the CLI simply passes a listener that also
  feeds a `CallLedger`. Stage attribution comes from `withStageTracking`, a
  pass-through wrapper around the `GeminiClient` port that labels the ledger
  at each node boundary. No adapter, use-case or graph node changed.
- **`--manifest-chain <file>`** links the run into an append-only ledger; a
  file that does not exist yet starts the chain (`prevManifestHash: null`).
- **`--reviewer "<name>"`** records `humanReview.reviewedBy = {name, at}`.
  `humanReview.required` is a constant `true` and cannot be turned off.
- **`medical-imaging verify-manifest <outputDir> [--chain <file>]`** re-hashes
  the manifest, the input and output files still present, and the chain link.
  Exit **0** when everything checks out, **6** when it does not.
- **The manifest is written on every exit path from the point the run is
  admitted** — success (0), partial failure (4), cost-cap abort (5) and an
  unexpected throw alike — as a best-effort side effect that can never change
  the exit code or mask the original error. Pre-flight rejections (exit 1, 2,
  3, 7) happen before any output directory is created and deliberately leave
  nothing behind; that no-side-effect property is itself asserted by tests.
- **`src/domain/phi-scan.ts`** scans context files for MRN-like ids, SSNs,
  phone numbers, emails, dates of birth, patient-name lines and postal
  addresses **before the first upload**. Default: warn on stderr and record in
  `warnings[]`. `--allow-phi` acknowledges; `--strict-phi` exits **7** before
  anything leaves the machine.
- **`src/infrastructure/file-scanner.ts`** refuses DICOM by extension _and_ by
  Part-10 magic bytes, and enforces `MAX_IMAGES_PER_RUN` (500) and
  `MAX_IMAGE_BYTES` (50 MB), all as exit-code-2 refusals.

## Alternatives considered

- **A signed manifest (detached signature over the digest).** Rejected for now:
  a signature is only worth its key management, and a research CLI has nowhere
  safe to keep a private key on the same disk as the thing it signs. The seal
  is deliberately a _hash_, and the ADR says so rather than implying more
  assurance than exists. If the tool is ever productised, signing over an HSM
  or an external transparency log is the upgrade path, and the manifest schema
  already has the shape for it.
- **Reusing the structured logger (`logger.ts`) for the audit trail.** Rejected:
  a log line stream answers "what happened while I watched", a manifest answers
  "what did this run consist of, and is that still true". The logger stays
  silent by default; the manifest is always written.
- **Deriving the call stage by counting calls per node.** Rejected as fragile —
  a retry that records usage from a failed attempt, or any future node, would
  shift the arithmetic. Wrapping the port is explicit and cannot drift.
- **Failing verification when a referenced file has been deleted.** Rejected:
  inputs live outside the tool's control and are routinely cleaned up. A
  missing file is reported and skipped; a _changed_ file fails. The distinction
  is in the report, so a reader can see exactly what was and was not checked.
- **A stronger PHI detector (NER model, DICOM de-identification toolkit).**
  Out of scope, and arguably out of role: the tool should surface a likely
  breach of the operator's obligation, not appear to discharge it.

## Consequences

- **Positive.**
  - Art. 12 moves from Partial to Met for the research scope, MANAGE 4.1 from
    Gap to Met, MEASURE 2.7 and MEASURE 2.12 gain a concrete artefact (the
    per-call token ledger is also the input a CO₂ estimate would need).
  - Every number in the paper's cost and token tables is now re-derivable from
    a file that is checkable by a third party.
  - Reproducibility: the input hashes state exactly which bytes produced a
    given report, which the file names alone never did.
  - Verification is offline, dependency-free, and costs no API calls.
- **Negative / honest limits.**
  - **Tamper-evident, not tamper-proof.** The ledger sits on the same disk as
    the manifests. A local attacker with write access who rewrites a manifest
    _and_ every subsequent ledger entry leaves no trace. This is recorded as
    THREAT_MODEL **T9** with that residual risk stated, not mitigated away.
  - **The PHI scan is a heuristic.** It has false positives (an
    accession-shaped token in a protocol note) and false negatives (a bare
    surname, a non-English layout, anything burned into the pixels). A clean
    scan means "nothing obvious", never "de-identified" — the code, the
    warning text and the docs all say so.
  - **Images are not scanned for PHI.** Burned-in annotations and EXIF are out
    of scope; the image pre-flight (ADR-003) re-encodes and thereby drops
    ancillary metadata as a side effect, which is asserted by test but is not
    a de-identification guarantee.
  - **DICOM is refused, not converted**, which is a usability cost paid
    deliberately: converting it would strip neither the tags nor the burned-in
    annotations, and would move the operator's obligation somewhere it cannot
    be discharged.
  - Two new exit codes (6, 7) widen the CLI contract; both are additive and
    documented in [SPEC](../../SPEC.md) and the README.
  - The cost meter is now constructed on every run rather than only under
    `--max-cost-usd`/`--verbose`. Its cap behaviour is unchanged
    (`undefined` cap still never throws) and its verbose line is still gated,
    but the "default path is byte-identical" property recorded in ADR-006's
    wake no longer holds: every run now also writes one JSON file.

## Verification

- `tests/unit/infrastructure/run-manifest.test.ts` — canonicalisation
  determinism, seal detection, chain linkage and every verification branch.
- `tests/unit/domain/phi-scan.test.ts` — each pattern family, overlap
  resolution, and the invariant that no finding ever carries a raw value.
- `tests/unit/infrastructure/file-scanner-limits.test.ts` — DICOM by extension
  and by magic bytes, byte and count limits.
- `tests/e2e/governance.test.ts` — the whole CLI offline: manifest contents,
  chaining across two runs, tamper detection through `verify-manifest`, the
  PHI exit paths, a failing run that still leaves a record, and the assertion
  that image metadata does not reach the wire.
