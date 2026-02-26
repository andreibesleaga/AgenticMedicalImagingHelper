# SPEC.md: AgenticMedicalImagingHelper — Technical Specification

<!-- Created by: api-design.skill + spec-writer.skill | Phase: S03 | Date: 2026-02-25 -->
<!-- Status: PENDING HUMAN APPROVAL before proceeding to S04 Task Decomposition -->
<!-- References: docs/PRD.md, docs/PLAN.md -->

---

## 1. TypeScript Interface Specifications

### 1.1 Core Domain Types (`src/domain/types.ts`)

```typescript
// ─── Input ───────────────────────────────────────────────────────────────────

/** A discovered series folder with its associated images and optional context file */
export interface SeriesInfo {
  seriesId: string;          // Folder name (e.g., "2024-01-chest-mri")
  imagePaths: string[];      // Absolute paths to image files in this series
  textContextPath?: string;  // Absolute path to .txt context file (if present)
}

// ─── Per-Image Analysis ───────────────────────────────────────────────────────

export type ImageQuality = "Poor" | "Fair" | "Good" | "Excellent";
export type Severity = "Normal" | "Mild" | "Moderate" | "Severe";

export interface Abnormality {
  name: string;
  severity: Severity;
  confidence: number;        // 0–100 (percentage)
  description: string;
}

export interface ImageAnalysis {
  imagePath: string;         // Absolute path to source image
  seriesId: string;          // Parent series ID
  status: "success" | "error";
  errorMessage?: string;     // Set when status = "error"
  modality?: string;         // "X-ray" | "MRI" | "CT" | "Ultrasound" | "Other"
  anatomyRegion?: string;    // Anatomical region identified
  quality?: ImageQuality;
  findings?: string[];       // List of key observations
  abnormalities?: Abnormality[];
  summary?: string;          // Patient-friendly short summary
  rawResponse?: string;      // Full Gemini markdown response
  processedAt: string;       // ISO 8601 timestamp
  disclaimer: string;        // Always present: educational use only text
}

// ─── Per-Series Aggregation ───────────────────────────────────────────────────

export interface SeriesSummary {
  seriesId: string;
  imageCount: number;
  successCount: number;
  failureCount: number;
  consistentFindings: string[];
  discrepancies: string[];
  primaryDiagnosis: string;
  differentialDiagnoses: string[];
  confidenceLevel: string;         // e.g., "High" | "Medium" | "Low"
  textContextUsed: boolean;
  textContextPath?: string;
  report: string;                  // Full markdown series report
  processedAt: string;             // ISO 8601 timestamp
  disclaimer: string;
}

// ─── Temporal Evolution ───────────────────────────────────────────────────────

export type ProgressionStatus =
  | "Improving"
  | "Stable"
  | "Worsening"
  | "Inconclusive"
  | "SingleSeries";            // When only 1 series, no temporal comparison

export interface TrendItem {
  finding: string;
  trend: "Improving" | "Stable" | "Worsening";
  details: string;
}

export interface TemporalAnalysis {
  seriesCount: number;
  seriesIds: string[];             // In processed order
  progression: ProgressionStatus;
  trends: TrendItem[];
  forecastedEvolution: string;
  treatmentRecommendations: string[];
  combinedReport: string;          // Full markdown evolution report
  processedAt: string;             // ISO 8601 timestamp
  disclaimer: string;
}

// ─── LangGraph State ─────────────────────────────────────────────────────────

export interface GraphState {
  inputDir: string;
  outputDir: string;
  series: SeriesInfo[];
  imageResults: ImageAnalysis[];      // Accumulated via fan-in
  seriesResults: SeriesSummary[];
  evolutionResult?: TemporalAnalysis;
  reportPaths?: string[];             // Output files written
  error?: string;                     // Fatal error if any
}

// ─── CLI Options ──────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  series?: string[];       // Filter to specific series names
  concurrency: number;     // Max parallel Gemini calls
  verbose: boolean;
}
```

### 1.2 Domain Errors (`src/domain/errors.ts`)

```typescript
export class MissingApiKeyError extends Error {
  constructor() {
    super("GOOGLE_API_KEY is required. Set it in your environment or .env file.");
    this.name = "MissingApiKeyError";
  }
}

export class FileScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileScanError";
  }
}

export class ImageAnalysisError extends Error {
  constructor(
    public readonly imagePath: string,
    public readonly cause: Error
  ) {
    super(`Failed to analyze image: ${imagePath} — ${cause.message}`);
    this.name = "ImageAnalysisError";
  }
}
```

### 1.3 Zod Schemas (runtime validation for Gemini responses)

```typescript
// Used to parse and validate Gemini structured output
import { z } from "zod";

export const ImageAnalysisSchema = z.object({
  modality: z.string().optional(),
  anatomyRegion: z.string().optional(),
  quality: z.enum(["Poor", "Fair", "Good", "Excellent"]).optional(),
  findings: z.array(z.string()).optional().default([]),
  abnormalities: z.array(z.object({
    name: z.string(),
    severity: z.enum(["Normal", "Mild", "Moderate", "Severe"]),
    confidence: z.number().min(0).max(100),
    description: z.string(),
  })).optional().default([]),
  summary: z.string().optional(),
});
```

---

## 2. CLI Specification (`src/main/index.ts`)

### 2.1 Command Structure

```
medical-imaging <command> [options]

Commands:
  analyze <input-dir> [output-dir]    Analyze all image series in a directory
  version                             Show version number

Global Options:
  --help                              Display help for command
```

### 2.2 `analyze` Command

```
Usage: medical-imaging analyze <input-dir> [output-dir] [options]

Arguments:
  input-dir          Path to directory containing series sub-folders
  output-dir         Path to output directory (default: ./output)

Options:
  --series <names>   Comma-separated series folder names to process
                     (default: all discovered series)
  --concurrency <n>  Max parallel Gemini API calls (default: 5)
  --verbose          Print per-image progress to stdout (default: false)

Environment Variables:
  GOOGLE_API_KEY     Required. Google AI Studio API key.
  GEMINI_MODEL       Optional. Gemini model name (default: gemini-2.5-pro).
  MAX_CONCURRENCY    Optional. Overridden by --concurrency flag.
  LOG_LEVEL          Optional. "debug" | "info" | "warn" | "error" (default: info).
```

### 2.3 Exit Codes

| Code | Meaning |
|---|---|
| 0 | All series processed (even if some images failed) |
| 1 | User error: missing API key, input dir not found, no images found |
| 2 | System error: unrecoverable LangGraph or file system failure |

### 2.4 stdout Output Format (--verbose)

```
AgenticMedicalImagingHelper v1.0.0

⚠️  DISCLAIMER: AI-generated output for educational use only.

📁 Scanning input directory: ./input
  Found 2 series: series_1 (3 images), series_2 (2 images)

🔬 Analyzing images [0/5]...
  ✓ [1/5] series_1/chest_ap.png — complete
  ✓ [2/5] series_1/chest_lat.png — complete
  ✗ [3/5] series_1/chest_oblique.png — ERROR: API timeout (continuing)
  ✓ [4/5] series_2/spine_sag.png — complete
  ✓ [5/5] series_2/spine_cor.png — complete

📊 Aggregating series [0/2]...
  ✓ series_1 — aggregation complete (2/3 images succeeded)
  ✓ series_2 — aggregation complete (2/2 images succeeded)

📈 Generating temporal evolution report...
  ✓ Evolution analysis complete (2 series compared)

📝 Writing reports to ./output...
  ✓ ./output/series_1/chest_ap_analysis.json
  ✓ ./output/series_1/chest_lat_analysis.json
  ✗ ./output/series_1/chest_oblique_analysis.json (error — no analysis)
  ✓ ./output/series_1/series_summary.md
  ✓ ./output/series_2/spine_sag_analysis.json
  ✓ ./output/series_2/spine_cor_analysis.json
  ✓ ./output/series_2/series_summary.md
  ✓ ./output/evolution_analysis.json
  ✓ ./output/combined_diagnostic_report.md

✅ Done. 4/5 images analyzed. Reports written to ./output
   Total time: 47s
```

---

## 3. Output File Schemas

### 3.1 Per-Image JSON (`output/<series-id>/<image-basename>_analysis.json`)

```json
{
  "imagePath": "/absolute/path/to/input/series_1/chest_ap.png",
  "seriesId": "series_1",
  "status": "success",
  "modality": "X-ray",
  "anatomyRegion": "Chest — Anteroposterior",
  "quality": "Good",
  "findings": [
    "Clear lung fields bilaterally",
    "Normal cardiac silhouette",
    "No pleural effusion"
  ],
  "abnormalities": [
    {
      "name": "Subtle increased opacity, right lower lobe",
      "severity": "Mild",
      "confidence": 65,
      "description": "Small area of increased density in right lower lobe, possibly early consolidation"
    }
  ],
  "summary": "Overall chest X-ray appears within normal limits with a minor area worth monitoring in the right lower lung.",
  "rawResponse": "### 1. Image Type & Region\n...",
  "processedAt": "2026-02-25T12:34:56.789Z",
  "disclaimer": "⚠️ This analysis is AI-generated for educational purposes only. Not a substitute for professional medical diagnosis."
}
```

### 3.2 Per-Series Markdown (`output/<series-id>/series_summary.md`)

```markdown
# Series Analysis: series_1

> ⚠️ DISCLAIMER: This report is AI-generated for educational and informational purposes only.
> It is NOT a substitute for professional medical diagnosis or treatment.
> All findings must be reviewed by a qualified healthcare professional.

**Analyzed**: 2026-02-25T12:35:00.000Z
**Images**: 3 submitted, 2 successfully analyzed, 1 failed
**Context file used**: No

## Primary Diagnosis
Early pneumonia (right lower lobe) — Confidence: Medium

## Differential Diagnoses
1. Atelectasis — right lower lobe
2. Early pleural effusion
3. Normal variant

## Consistent Findings Across All Views
- Increased opacity in right lower lobe (visible in 2/2 successful images)
- Normal cardiac silhouette
- No pneumothorax

## Discrepancies Between Views
- Lateral view shows greater opacity than AP view — suggests posterior consolidation

## Series Summary
[Full AI-generated synthesis text...]

---
*Generated by AgenticMedicalImagingHelper v1.0.0 | Educational use only*
```

### 3.3 Evolution JSON (`output/evolution_analysis.json`)

```json
{
  "seriesCount": 2,
  "seriesIds": ["series_1", "series_2"],
  "progression": "Worsening",
  "trends": [
    {
      "finding": "Right lower lobe opacity",
      "trend": "Worsening",
      "details": "Area of increased density expanded from 2cm to 4cm between series_1 and series_2"
    }
  ],
  "forecastedEvolution": "Without treatment, consolidation is likely to progress to complete right lower lobe involvement within 1-2 weeks.",
  "treatmentRecommendations": [
    "Immediate antibiotic therapy — community-acquired pneumonia protocol",
    "Follow-up chest X-ray in 4-6 weeks to confirm resolution",
    "Pulmonary function testing if symptoms persist"
  ],
  "processedAt": "2026-02-25T12:35:30.000Z",
  "disclaimer": "⚠️ AI-generated for educational purposes only. Professional clinical review required."
}
```

---

## 4. Input Directory Contract

```
input/                                         <- Root input directory
├── <series-id>/                               <- Series folder (alphanumeric, hyphens, underscores)
│   ├── <image-name>.[png|jpg|jpeg]            <- Medical image files (1 to N)
│   └── <any-name>.txt                         <- Optional: single .txt context file (first found)
└── <text-about-all-series>.txt                <- Optional: root-level context for all series
```

**Rules:**
- Series folders are direct children of input dir only (no nested series)
- Supported image formats: PNG, JPG, JPEG (case-insensitive)
- If multiple `.txt` files exist in a series folder, the first one (alphabetically) is used
- A root-level `.txt` file in `input/` applies to the evolution analysis call
- Non-image, non-txt files in series folders are silently ignored
- Empty series folders (no images) are skipped with a warning

---

## 5. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_API_KEY` | Yes | — | Google AI Studio API key |
| `GEMINI_MODEL` | No | `gemini-2.5-pro` | Gemini model name to use |
| `MAX_CONCURRENCY` | No | `5` | Max parallel Gemini API calls (overridden by `--concurrency`) |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

---

## 6. Testing Strategy

### Unit Tests (Jest + ts-jest, mock all external I/O)

| Test File | What Is Tested |
|---|---|
| `tests/unit/infrastructure/file-scanner.test.ts` | Directory scanning, series discovery, image filtering, path traversal detection |
| `tests/unit/infrastructure/gemini-client.test.ts` | API call construction, image prep (sharp), response parsing, error handling |
| `tests/unit/infrastructure/report-writer.test.ts` | JSON serialization, Markdown generation, directory creation, disclaimer presence |
| `tests/unit/application/analyze-image.test.ts` | Use case orchestration, error propagation |
| `tests/unit/application/aggregate-series.test.ts` | Result grouping by seriesId, context injection |
| `tests/unit/application/analyze-evolution.test.ts` | Single vs. multi-series logic |
| `tests/unit/adapters/langgraph-agent.test.ts` | Graph wiring, fan-out count, state accumulation |

### Integration Tests (real file system, mock Gemini API)

| Test File | What Is Tested |
|---|---|
| `tests/integration/analyze-pipeline.test.ts` | Full pipeline with temp directories; mocked Gemini returns fixture JSON |

### E2E Tests (fixture images, no API calls)

| Test File | What Is Tested |
|---|---|
| `tests/e2e/full-analysis.test.ts` | CLI invocation with real fixture images (stored in `tests/fixtures/`); mock Gemini SDK |

### Test Fixtures

```
tests/fixtures/
├── series_1/
│   ├── test_image_1.png    <- 100x100 PNG (synthetic, not real medical image)
│   ├── test_image_2.png
│   └── context.txt
├── series_2/
│   ├── test_image_1.png
│   └── test_image_2.png
└── mock-responses/
    ├── image-analysis-response.txt    <- Sample Gemini response for unit tests
    └── series-synthesis-response.txt
```

### Coverage Target

≥96% line coverage on all `src/` files (per AGENTS.md quality gate 3).

---

## 7. ADR Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](architecture/decisions/ADR-001-langgraph-orchestration.md) | LangGraph.js for orchestration | Accepted |
| [ADR-002](architecture/decisions/ADR-002-gemini-search-grounding.md) | Gemini Google Search Grounding | Accepted |
| [ADR-003](architecture/decisions/ADR-003-image-preprocessing.md) | sharp for image preprocessing | Accepted |

---

## 8. Approval

| Role | Name | Status | Date |
|---|---|---|---|
| Product | Human (project owner) | **PENDING** | — |
| Engineering | Claude Code | APPROVED | 2026-02-25 |

**Human approval required before proceeding to S04 Task Decomposition.**

---

*Created by: Claude Code (api-design.skill + spec-writer.skill) | 2026-02-25*
*GABBE SDLC Phase: S03 — Specification*
