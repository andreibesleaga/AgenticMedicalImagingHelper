# PRD: AgenticMedicalImagingHelper — Agentic Medical Imaging CLI

<!-- Created by: spec-writer.skill | Phase: S01 | Date: 2026-02-25 -->
<!-- Strategic Context: docs/strategic/BUSINESS_CASE.md -->
<!-- Status: PENDING HUMAN APPROVAL before proceeding to S02 Design -->

---

## 1. Feature Summary

**What:** A TypeScript CLI tool that batch-analyzes multiple series of medical images using Google Gemini Vision AI with agentic Fan-Out/Fan-In orchestration.

**Why:** Radiologists and clinical researchers spend 90+ minutes per session manually processing multi-angle, multi-session medical image series with no automated cross-series correlation or temporal evolution tracking.

**Who:** Radiologists, clinical researchers, and medical AI developers working locally on image datasets.

**Success Metric:** A 20-image, 2-series batch produces complete per-image JSON analyses, per-series Markdown summaries, and a combined evolution report in under 5 minutes.

**Strategic Context:** [docs/strategic/BUSINESS_CASE.md](docs/strategic/BUSINESS_CASE.md)

---

## 2. Problem Statement

Existing AI medical imaging tools (e.g., Streamlit-based Gemini Vision apps) require manual, one-image-at-a-time analysis with no batch automation, no aggregation across angles/slices, and no temporal tracking across multiple imaging sessions. This leaves clinicians doing repetitive manual work that AI can automate.

**Current behavior:** User uploads a single image to a web UI → receives one analysis → manually repeats for every image → manually compares reports from different sessions.

**Desired behavior:** User runs `medical-imaging analyze ./input ./output` → system automatically discovers all image series, analyzes all images in parallel, aggregates per-series findings, and synthesizes a temporal evolution report comparing all sessions.

---

## 3. User Stories

- As a **radiologist**, I want to run a single CLI command on a directory of image series, so that I receive structured AI analysis for every image without manual repetition.
- As a **clinical researcher**, I want the system to automatically compare imaging sessions over time, so that I can track disease progression or treatment response without manual review.
- As a **medical AI developer**, I want structured JSON output per image and per series, so that I can integrate the results into downstream data pipelines.
- As a **clinician**, I want supplementary text (existing diagnoses, lab notes) injected automatically into the AI analysis, so that the output is contextualized to the patient's history.

---

## 4. EARS Requirements

### 4.1 Ubiquitous Requirements (always applies)

```
THE SYSTEM SHALL accept a local directory path as CLI input and automatically discover all series sub-folders within it.

THE SYSTEM SHALL produce per-image analysis output as JSON files in an output directory mirroring the input directory structure.

THE SYSTEM SHALL produce a per-series Markdown summary file in the output directory for each series discovered.

THE SYSTEM SHALL produce a combined evolution Markdown report (`combined_diagnostic_report.md`) in the output directory root after all series are processed.

THE SYSTEM SHALL produce a structured evolution JSON (`evolution_analysis.json`) in the output directory root.

THE SYSTEM SHALL prepend an educational-use-only disclaimer to every generated Markdown report.

THE SYSTEM SHALL label all AI-generated content as AI-generated in every output file.

THE SYSTEM SHALL process images in parallel across all series, up to a configurable maximum concurrency limit (default: 5).
```

### 4.2 Event-Driven Requirements (triggered by an event)

```
WHEN a *.txt context file exists in a series folder,
THE SYSTEM SHALL read its contents and inject them into the Gemini prompt for that series' synthesis call, clearly delimited as <context> data.

WHEN an image fails to process (API error, unreadable file, unsupported format),
THE SYSTEM SHALL log the error with the image path and continue processing remaining images without aborting the batch.

WHEN GOOGLE_API_KEY environment variable is not set,
THE SYSTEM SHALL exit immediately with a human-readable error message and exit code 1.

WHEN the input directory does not exist or contains no image files,
THE SYSTEM SHALL exit with a descriptive error message and exit code 1.

WHEN the output directory does not exist,
THE SYSTEM SHALL create it automatically before writing results.

WHEN all images in a series are processed,
THE SYSTEM SHALL automatically trigger the series aggregation step for that series.

WHEN all series aggregations are complete,
THE SYSTEM SHALL automatically trigger the temporal evolution analysis step.
```

### 4.3 State-Driven Requirements (while in a state)

```
WHILE images are being processed,
THE SYSTEM SHALL maintain a count of completed/total images and expose it for progress display.

WHILE the --verbose flag is active,
THE SYSTEM SHALL display per-image progress lines to stdout, including image path, series ID, and status (started/complete/failed).
```

### 4.4 Optional Feature Requirements

```
WHERE the --series <names> flag is provided,
THE SYSTEM SHALL process only the named series and skip all others.

WHERE the --concurrency <n> flag is provided,
THE SYSTEM SHALL use n as the maximum concurrent Gemini API calls instead of the default.

WHERE the --verbose flag is set,
THE SYSTEM SHALL display per-image progress to stdout.
```

### 4.5 Unwanted Behaviors (negative requirements)

```
THE SYSTEM SHALL NOT store or transmit image data to any destination other than the Google Gemini API and the local output directory.

THE SYSTEM SHALL NOT log the GOOGLE_API_KEY value in any output, log file, or error message.

THE SYSTEM SHALL NOT make medical diagnostic claims — all output MUST include the disclaimer: "This analysis is AI-generated for educational purposes only. Do not make clinical decisions based solely on this output."

THE SYSTEM SHALL NOT block on a single failed image — it MUST continue with remaining images.

THE SYSTEM SHALL NOT expose raw stack traces to the user — errors must be caught and presented as human-readable messages.
```

---

## 5. Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | `input/series_1/` contains 3 PNG images | `medical-imaging analyze ./input ./output` runs | `output/series_1/` contains 3 `*_analysis.json` files and `series_summary.md` |
| AC-02 | `input/` contains 2 series folders | Analysis completes | `output/combined_diagnostic_report.md` and `output/evolution_analysis.json` exist |
| AC-03 | `input/series_1/context.txt` exists | Series 1 is synthesized | The synthesis Gemini prompt includes the text file contents wrapped in `<context>` tags |
| AC-04 | `GOOGLE_API_KEY` is not set | CLI starts | Process exits with code 1 and message "GOOGLE_API_KEY is required" |
| AC-05 | `input/` does not exist | CLI runs | Process exits with code 1 and descriptive message |
| AC-06 | One image in a batch returns a Gemini API error | Batch runs | That image's JSON shows `"status": "error"`, all other images complete successfully |
| AC-07 | 6 images exist across 2 series | Analysis runs | Gemini API is called at most `MAX_CONCURRENCY` times concurrently (verified by test mock) |
| AC-08 | `--verbose` flag is set | Analysis runs | Each image's start and completion are logged to stdout |
| AC-09 | `--series series_1` flag is set | Analysis runs | Only series_1 is processed; series_2 is skipped |
| AC-10 | Any output `.md` file is generated | — | File contains "This analysis is AI-generated for educational purposes only" |

---

## 6. Data Model (Sketch)

```
Input Directory:
  input/
    [series-id]/                    <- Series folder (e.g., "2024-01-chest-mri")
      [image].[png|jpg|jpeg]        <- Medical image files (1 to N)
      [context].[txt]               <- Optional: supplementary diagnostic text

Output Directory:
  output/
    [series-id]/
      [image-basename]_analysis.json  <- Per-image AI analysis
      series_summary.md               <- Per-series aggregated report
    evolution_analysis.json           <- Cross-series temporal analysis (structured)
    combined_diagnostic_report.md     <- Full human-readable evolution report
```

Key data structures (TypeScript — full spec in SPEC.md):
- `ImageAnalysis`: imagePath, seriesId, modality, anatomyRegion, quality, findings[], abnormalities[], summary, rawResponse
- `SeriesSummary`: seriesId, imageCount, consistentFindings[], primaryDiagnosis, differentialDiagnoses[], textContextUsed, report
- `TemporalAnalysis`: seriesCount, progression, trends[], forecastedEvolution, treatmentRecommendations[], combinedReport

---

## 7. CLI Surface

```
medical-imaging analyze <input-dir> [output-dir] [options]

Arguments:
  input-dir          Directory containing series sub-folders with images
  output-dir         Output directory (default: ./output)

Options:
  --series <names>   Comma-separated series names to process (default: all)
  --concurrency <n>  Max parallel Gemini API calls (default: 5)
  --verbose          Show per-image progress (default: false)
  --help             Show help

Environment:
  GOOGLE_API_KEY     Required: Google AI Studio API key
  GEMINI_MODEL       Optional: model name (default: gemini-2.5-pro)
  MAX_CONCURRENCY    Optional: max concurrent calls (overridden by --concurrency)

Exit Codes:
  0   Success
  1   User error (missing args, missing API key, input dir not found)
  2   System error (unrecoverable API failure)
```

---

## 8. UI/UX Notes

**Interface**: Terminal CLI only — no web UI.

**Key interactions:**
- On start: display banner with disclaimer + config summary
- During processing: spinner + progress counter (`[3/20] Analyzing series_2/image_003.png...`)
- On completion: summary table (series → image count → status → output path)
- On error: clear error message + suggestion (e.g., "Check GOOGLE_API_KEY is valid")

**Accessibility:** N/A (terminal tool; no graphical interface).

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | 20 images across 2 series processed in ≤5 minutes (API latency limited) |
| **Concurrency** | Up to 5 concurrent Gemini Vision API calls (configurable) |
| **Availability** | Local tool — no uptime SLO; graceful degradation on API failures |
| **Security** | GOOGLE_API_KEY never logged; input paths validated to prevent traversal |
| **Accuracy** | Use gemini-2.5-pro (highest available Gemini vision capability) + Google Search grounding |
| **Scalability** | Must handle 100+ images without OOM; stream-process large batches |
| **Portability** | Runs on Linux, macOS, Windows (Node.js 20+); Docker option provided |

---

## 10. Security & Privacy Considerations

**Data classification:** Confidential (may contain de-identified medical images)

**PII involved:** Potentially — medical images may contain embedded patient metadata (EXIF/DICOM tags). Mitigation: strip metadata before API submission (or document as out of scope for v1).

**Threat model required:** Yes — see `docs/architecture/THREAT_MODEL.md` (S02 artifact).

**Regulatory compliance:** Educational use only. HIPAA: users must ensure images are appropriately de-identified before use. This is explicitly documented in the disclaimer.

**Authentication:** None (local tool). API key stored in `.env` (never committed).

**Authorization:** All local file access; user is responsible for input directory permissions.

---

## 11. Out of Scope (v1)

- **DICOM file parsing** — PNG/JPG/JPEG only; DICOM deferred to v2
- **Real-time video analysis** — static images only
- **Web UI or REST API** — CLI only
- **Authentication/authorization** — local tool, no multi-user support
- **Patient data anonymization** — users must pre-anonymize inputs
- **Cloud deployment / serverless** — local execution only (Docker provided)
- **FHIR integration** — future version
- **Report comparison with previous runs** — evolution within one run only

**Future considerations (v2+):**
- DICOM support via `dcmjs` or `cornerstone`
- FHIR R4 report export
- Incremental analysis (skip already-analyzed images)
- Web dashboard for reviewing reports

---

## 12. Open Questions

| # | Question | Owner | Resolution |
|---|---|---|---|
| 1 | Should EXIF/metadata be stripped from images before Gemini API submission? | Engineering | OPEN — document as user responsibility in v1, add to v2 |
| 2 | What if a series folder contains sub-folders? | Engineering | RESOLVED — scan only top-level images in each series folder |
| 3 | Should series ordering for temporal analysis be alphabetical or date-based? | Product | RESOLVED — alphabetical by series folder name; users name folders with dates (e.g., 2024-01-...) |

---

## 13. Approval

| Role | Name | Status | Date |
|---|---|---|---|
| Product | Human (project owner) | **PENDING** | — |
| Engineering | Claude Code | APPROVED | 2026-02-25 |
| Security | Claude Code (threat model in S02) | PENDING (S02) | — |

**Human approval required before proceeding to Design phase (S02).**

---

*Created by: Claude Code (spec-writer.skill) | 2026-02-25*
*GABBE SDLC Phase: S01 — Requirements*
