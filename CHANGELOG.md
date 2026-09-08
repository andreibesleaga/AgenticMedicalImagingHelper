# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

All changes in this section are **backward-compatible** (`additive` or
`internal-only`): no public CLI flag, exit code, or output field was removed or
renamed.

### Changed

- Structured outputs validated with Zod at runtime (image, series, evolution):
  every stage now asks the model for one JSON object (Gemini
  `generationConfig.responseMimeType: "application/json"`, OpenRouter
  `response_format: {type:"json_object"}`) and validates it with `safeParse`
  against `ParsedImageResponseSchema` / `ParsedSeriesResponseSchema` /
  `ParsedEvolutionResponseSchema`. `anatomyRegion`, `quality`,
  `abnormalities[]` (severity + confidence), `references[]`,
  `consistentFindings[]`, `discrepancies[]`, `differentialDiagnoses[]`,
  `confidenceLevel`, `trends[]`, `forecastedEvolution` and
  `treatmentRecommendations[]` are populated from the validated record instead
  of being emitted empty. The raw model text is still kept (`rawResponse` /
  `report` / `combinedReport`) and the type-level `disclaimer` is unchanged.
- Validation failures recorded in artefacts: a response that is not valid JSON
  for its schema never aborts the run — the previous free-text extraction is
  used and the record carries
  `validation: { ok: false, issues: ["path: message", …] }` (successful
  validation records `{ ok: true }`), so failures are visible per artefact and
  countable per run (`experiments/sime2026/probe-outputs.ts`). A provider that
  refuses JSON mode (e.g. Gemini with Search grounding) is replayed once
  without it and then travels the same fallback path.
- Treatment suggestions labelled experimental: the combined Markdown report
  renders them under "Treatment Suggestions (experimental — not clinical
  recommendations)" with an explicit not-clinical-advice note, alongside new
  per-finding trend and forecast sections.
- OpenRouter key redacted in logs: `logger.ts` now treats `OPENROUTER_API_KEY`
  as a secret value (and `openrouter_api_key` / `openRouterApiKey` as redacted
  field names), closing a leak on the `AI_PROVIDER=openrouter` path.
- `experiments/sime2026/probe-outputs.ts` reads the emitted `progression` field
  (it previously read a non-existent `overallProgression`, leaving the column
  blank) and adds a per-run schema-validation-failure count; its audit is now
  exported as functions and unit-tested.
- Default model is now `gemini-2.5-flash`: `gemini-2.5-pro` returns HTTP 404
  ("no longer available to new users") on the Gemini API as of 2026-09.
  `GEMINI_MODEL` still overrides.
- Cost meter counts thinking tokens (`thoughtsTokenCount`) as output tokens,
  matching Google's billing, and selects published rates by model name
  (`GEMINI_PRICE_TABLE`); unknown models fall back to the highest known rate.
  Env overrides unchanged.
- Image pre-flight now detects the resolution to send instead of resizing every
  input to 1024 px and re-encoding it as PNG (ADR-003 update, 2026-09-08). The
  target long edge comes from a per-model-family table of published effective
  input resolutions — Gemini 1536 px (2 × 768 px tiles), Gemma 3/4 896 px,
  Claude 1568 px, Qwen-VL 1000 px, unknown models 1024 px as before — trimmed
  per image to the family's published visual-token budget (which reproduces the
  provider's own downscale targets: 1092×1092 and 1456×819 on Claude's
  1568-token standard tier, 2576×1449 on the 4784-token high-resolution tier)
  and tile-aligned for Gemini. A file already within the target that is PNG or
  JPEG, 8-bit and free of alpha is now sent **byte-for-byte with no re-encode**.
  This removes a measured **+129.4 %** payload growth on the 224-px NIH
  ChestX-ray14 cohort (31 images: 684,548 B on disk previously became
  1,570,313 B on the wire; it is now 678,332 B, −0.9 %), and raises large-plate
  submissions from 1024 px to 1536 px at identical Gemini image-token cost,
  since Gemini's tile count is aspect-driven and scale-invariant above 384 px.
  `prepareImageForGemini` is unchanged as an export and simply delegates.
- Media type follows the bytes actually sent: a passed-through JPEG is announced
  as `image/jpeg` on both providers instead of the previous constant
  `image/png`.

### Added

- `IMAGE_QUALITY` (`auto` | `max` | `economy`, default `auto`), `IMAGE_MAX_DIM`
  (hard override of the detected long edge) and `IMAGE_JPEG_FOR_PHOTO` (re-encode
  a JPEG source as JPEG q=90 rather than lossless PNG) — see `.env.example`.
- `ImageAnalysis.preprocessing`: per-image provenance for what was actually sent
  — native and sent pixel dimensions, bytes in/out, container and media type, the
  policy and target that chose it, the action taken
  (`passthrough` | `resized` | `reencoded`), a one-line reason, and a
  vendor-formula estimate of the image tokens the sent pixels cost (`null` for a
  model family with no published formula). Emitted on every analysis record,
  including error records where the image was prepared before the call failed,
  and logged once per image as a structured `image.prepared` line at `LOG_LEVEL=debug`.
- `src/infrastructure/image-policy.ts`: the resolution table, the preset and
  environment parsing, the tile-alignment and visual-token-budget rules, the
  vendor token estimators, and `preparePayload` — the single seam both clients
  and the E3 experiment use, so measured bytes are transmitted bytes.

- Second model provider, **OpenRouter** (`AI_PROVIDER=openrouter`,
  `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`), behind the same `GeminiClient`
  port via an OpenAI-compatible `chat/completions` shim
  (`src/infrastructure/openrouter-client.ts`, ADR-006). Lets the unchanged CLI
  run on any OpenRouter vision model to test the ADR-004 monoculture risk. No
  Google Search grounding on this path. Provider-reported cost (`usage.cost`,
  USD) is accumulated as `providerReportedUsd` next to the token estimate.
  Gemini via Google remains the default; no new runtime dependency.
- Bounded retry with exponential backoff and full jitter
  (`src/infrastructure/retry.ts`), shared by both provider adapters. Retries
  HTTP 429/500/502/503/504 and transport failures only; never 400/401/403/404 or
  Zod validation errors. Honours `Retry-After` and Google's
  `RetryInfo.retryDelay`. Defaults to 4 attempts, 2 s base, 30 s cap; configure
  with `AI_MAX_RETRIES` (`GEMINI_MAX_RETRIES` accepted as an alias, `0`
  disables). Retries are logged on the existing `--verbose` channel. The cost
  meter records the successful attempt once — a retry never double-counts its
  tokens — and additionally records a failed attempt's own usage when the error
  reports any, so the estimate and `--max-cost-usd` stay honest. Motivated by a
  reproducibility batch lost to a `429 … exceeded your current quota`.
- SIME 2026 reproducibility pack under `experiments/sime2026/` (scalability
  stress test, public NIH ChestX-ray14 longitudinal cohort, fairness-probe
  benchmark) with raw run logs, plus `experiments/sime2026/README.md` (dataset
  citation, commands, `results.jsonl` field reference, cost/quota notes).
  `run.sh` now supports `AI_PROVIDER=openrouter`, carries the provider and model
  in the run id, records `provider`, `provider_usd` and `retries` in
  `results.jsonl`, and adds `E2_SIZES` / `E2_CONC` / `E4_CONC` / `MAX_COST`
  selection and `SKIP_EXISTING=1` resumption. New E3 experiment
  `experiments/sime2026/measure-payload.ts` measures the request payload before
  and after the client's `sharp` pre-flight (bytes only — not diagnostic
  equivalence), with `--synthetic` large-plate stand-ins.

- `--max-cost-usd <n>` flag: optional client-side cost cap. The run aborts (exit
  code 5) once the estimated Gemini spend exceeds the cap. Absent ⇒ unlimited
  (unchanged default). Cost is estimated from real token usage; the provider
  invoice is authoritative.
- `npm run test:live` script for opt-in real-Gemini end-to-end tests.
- Fairness / allocative-harm probe (`src/domain/fairness.ts`) with regression
  tests.
- Compliance documentation: `docs/COMPLIANCE.md` (EU AI Act + NIST AI RMF
  cross-walk), `docs/PRODUCT.md`, and `ADR-004` (single-model monoculture risk).
- `docs/architecture.md` with a Mermaid diagram of the LangGraph StateGraph.
- Governance & supply-chain: `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `CONTRIBUTING.md`, `.github/dependabot.yml`.
- CI: `.github/workflows/ci.yml` (Node 20 + 22 matrix) and
  `.github/workflows/security-baseline.yml` (OSV-Scanner, Trivy, CycloneDX 1.6
  SBOM, license allow-list, `npm audit`).
- Structured logging (pino) at LangGraph node transitions, with secret redaction
  (off by default; enable with `LOG_LEVEL`).

### Changed

- Dependencies pinned to exact versions for reproducibility (resolution
  unchanged).
- `package.json` `license` corrected to `GPL-3.0` to match the bundled `LICENSE`
  file (was inconsistently declared `CC-BY-SA-4.0`).
- `src/main` split into a slim composition root (`index.ts`) and a testable
  handler (`run-analyze.ts`).

### Added — governance controls (2026-09-08)

All additive: no existing CLI flag, exit code or output field was removed or
renamed. Recorded in
[ADR-007](docs/architecture/decisions/ADR-007-run-manifest-audit-ledger.md).

- **Per-run manifest** (`src/infrastructure/run-manifest.ts`): every admitted
  run writes `<outputDir>/run_manifest.json`, sealed with a SHA-256 over the
  canonical JSON (keys sorted recursively) of its own content. It records the
  schema and tool version, start/finish timestamps, provider and model, the
  pricing table used, the settings that change results or cost (`concurrency`,
  `maxCostUsd`, `retries`, `IMAGE_QUALITY`), the SHA-256 and byte length of
  every input image and context file, **one row per model call** (stage,
  timestamp, tokens in/out including thinking tokens, per-call USD estimate,
  provider-reported USD, retries consumed), the SHA-256 of every artefact
  written, run totals, the exit code, the run's warnings, `humanReview` and
  `prevManifestHash`. Closes the EU AI Act Art. 12 and NIST MANAGE 4.1 gaps
  tracked in `docs/COMPLIANCE.md`, and delivers future-work item 3 of the
  SIME 2026 paper.
- **Hash-chained ledger**: `analyze --manifest-chain <file>` appends the run to
  an append-only JSON-Lines ledger linked to the previous run's hash. A file
  that does not exist yet starts the chain (`prevManifestHash: null`).
- **New subcommand** `medical-imaging verify-manifest <outputDir> [--chain
<file>]`: re-computes the manifest hash, re-hashes the input and output files
  still present, and validates the chain link, printing PASS / FAIL / SKIP per
  check. **New exit code 6** on a missing, unparseable, altered or unlinked
  manifest. A referenced file that no longer exists is reported as skipped, not
  failed — inputs live outside the tool's control.
- **Human oversight (Art. 14)**: every Markdown report now opens with a
  "Requires review by a qualified clinician before any use" block, before the
  title. Every manifest carries `humanReview: { required: true, reviewedBy }`,
  where `required` is a constant that cannot be switched off, and
  `analyze --reviewer "<name>"` records an attestation of _who reviewed_,
  never of clinical validity.
- **PHI/PII pre-flight** (`src/domain/phi-scan.ts`): context `.txt` files are
  scanned before the first upload for MRN-like identifiers, US SSNs, telephone
  numbers, email addresses, dates of birth, patient-name lines and postal
  addresses. Default behaviour is a warning on stderr plus an entry in the
  manifest's `warnings[]`; `--allow-phi` acknowledges it and `--strict-phi`
  refuses to upload anything (**new exit code 7**, before the first request).
  Findings carry **masked** excerpts only — the first character and the
  punctuation shape, every other letter and digit starred (`123-45-6789` →
  `1**-**-****`) — with no surrounding text, so a warning can never become a
  second disclosure. Asserted by test against both stderr and the manifest.
- **DICOM refusal** (`src/infrastructure/file-scanner.ts`): `.dcm` / `.dicom`
  files, and any file carrying a DICOM Part-10 preamble whatever its extension,
  are refused with exit code 2 and a message that says what to do instead.
  DICOM carries PHI in its tags and often burned into its pixels; converting it
  silently would strip neither. DICOM ingestion with tag-level de-identification
  is named as future work.
- **Input limits**: `MAX_IMAGES_PER_RUN` (default 500) and `MAX_IMAGE_BYTES`
  (default 50 MB), enforced before any upload as exit-code-2 refusals. Closes
  the two items left open under THREAT_MODEL T6. A blank, zero or non-integer
  override falls back to the default rather than failing the run.
- **Threat model**: new **T9** (run-record tampering — mitigated by the hash
  chain and `verify-manifest`, with the local-write residual risk accepted and
  stated) and **T10** (PHI in context files), plus a dated update to T6.
- **Docs**: `SECURITY.md` extended (provider-key redaction, run-record
  integrity, an accurate account of what CI does and does not block);
  `docs/COMPLIANCE.md` §2.1 addendum with dated additive edits to Art. 12,
  Art. 14, Art. 15, MEASURE 2.7, MEASURE 2.12, MANAGE 4.1 and HIPAA Safe
  Harbor; `docs/SPEC.md` §2.3.1 authoritative exit-code table;
  `docs/architecture.md`; README "Governance controls".

### Changed — governance controls (2026-09-08)

- The cost meter is now constructed on **every** run, not only under
  `--max-cost-usd` or `--verbose`, because its `onCall` stream is what feeds the
  manifest's per-call ledger. Cap semantics are unchanged (an absent cap still
  never throws) and the verbose line is still gated on `--verbose`, but the
  "default path is byte-identical" property no longer holds: every run now also
  writes one JSON file. Stage attribution comes from `withStageTracking`, a
  pass-through wrapper around the `GeminiClient` port — no adapter, use-case or
  graph node changed.
- The manifest is written on **every exit path from the point the run is
  admitted**, including partial failure (4), a cost-cap abort (5) and an
  unexpected throw, as a best-effort side effect that can never change the exit
  code or mask the original error. Pre-flight rejections (1, 2, 3, 7) happen
  before the output directory is created and deliberately leave nothing behind.
- `.dicom` files are **refused** rather than silently ignored (previous
  behaviour: skipped as an unsupported extension).

## [1.0.0]

### Added

- Initial release: local TypeScript CLI for AI-powered medical image analysis
  with temporal evolution tracking, using Google Gemini and a LangGraph
  fan-out/fan-in StateGraph. Per-image JSON, per-series Markdown, and a combined
  evolution report — each carrying a mandatory medical disclaimer.

[Unreleased]: https://github.com/andreibesleaga/AgenticMedicalImagingHelper/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/andreibesleaga/AgenticMedicalImagingHelper/releases/tag/v1.0.0
