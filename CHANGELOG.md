# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

All changes in this section are **backward-compatible** (`additive` or
`internal-only`): no public CLI flag, exit code, or output field was removed or
renamed.

### Added

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

## [1.0.0]

### Added

- Initial release: local TypeScript CLI for AI-powered medical image analysis
  with temporal evolution tracking, using Google Gemini and a LangGraph
  fan-out/fan-in StateGraph. Per-image JSON, per-series Markdown, and a combined
  evolution report — each carrying a mandatory medical disclaimer.

[Unreleased]: https://github.com/andreibesleaga/AgenticMedicalImagingHelper/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/andreibesleaga/AgenticMedicalImagingHelper/releases/tag/v1.0.0
