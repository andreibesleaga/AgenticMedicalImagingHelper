# E2E Test Scenarios: AgenticMedicalImagingHelper

<!-- Phase: S03 | Date: 2026-02-25 -->
<!-- These scenarios define acceptance test coverage; implemented in tests/e2e/full-analysis.test.ts -->

---

## Scenario 1: Single Series, Multiple Images

**Given**: `input/series_1/` contains 3 PNG images, no context file

**When**: `medical-imaging analyze ./input ./output` runs with mocked Gemini API

**Then**:
- `output/series_1/test_image_1_analysis.json` exists and has `status: "success"`
- `output/series_1/test_image_2_analysis.json` exists and has `status: "success"`
- `output/series_1/test_image_3_analysis.json` exists and has `status: "success"`
- `output/series_1/series_summary.md` exists, contains "series_1", contains disclaimer
- `output/combined_diagnostic_report.md` exists, contains disclaimer
- `output/evolution_analysis.json` exists and has `progression: "SingleSeries"`

**EARS Covered**: R01 (scan dir), R02 (parallel), R03 (per-image JSON), R04 (per-series Markdown), R05 (combined report), R10 (disclaimer)

---

## Scenario 2: Multiple Series — Temporal Evolution

**Given**: `input/` contains `series_1/` (2 images) and `series_2/` (2 images), no context files

**When**: `medical-imaging analyze ./input ./output` runs

**Then**:
- All 4 `*_analysis.json` files exist in correct subdirectories
- Both `series_summary.md` files exist
- `output/evolution_analysis.json` exists with `seriesCount: 2` and `progression` ≠ "SingleSeries"
- `output/combined_diagnostic_report.md` references both series

**EARS Covered**: R01, R02, R03, R04, R05, R08 (WHEN all series complete → trigger evolution)

---

## Scenario 3: Context File Injection

**Given**: `input/series_1/` contains 2 images and a `context.txt` file with content: "Patient has known COPD"

**When**: Analysis runs for series_1

**Then**:
- `output/series_1/series_summary.md` has `textContextUsed: true` in the corresponding JSON
- The Gemini `synthesizeSeries` call was invoked with prompt containing `<context>` tags
- The synthesis prompt includes "Patient has known COPD" (verifiable via mock call assertion)

**EARS Covered**: R06 (WHEN *.txt exists → inject into prompt)

---

## Scenario 4: Graceful Degradation on Image Failure

**Given**: `input/series_1/` contains 3 images; Gemini API mock throws error for image_2

**When**: Analysis runs

**Then**:
- `output/series_1/test_image_1_analysis.json` has `status: "success"`
- `output/series_1/test_image_2_analysis.json` has `status: "error"` and `errorMessage` set
- `output/series_1/test_image_3_analysis.json` has `status: "success"`
- Process exits with code 0 (not 2)
- Series summary is still generated (with `failureCount: 1`)

**EARS Covered**: R07 (WHEN image fails → log error, continue)

---

## Scenario 5: Missing API Key → Exit Code 1

**Given**: `GOOGLE_API_KEY` is not set in environment

**When**: `medical-imaging analyze ./input` runs

**Then**:
- Process exits with code 1
- stderr contains "GOOGLE_API_KEY is required"
- No files are created in output/

**EARS Covered**: R08 (WHEN GOOGLE_API_KEY not set → exit code 1)

---

## Scenario 6: Missing Input Directory → Exit Code 1

**Given**: `./nonexistent-dir` does not exist

**When**: `medical-imaging analyze ./nonexistent-dir` runs

**Then**:
- Process exits with code 1
- stderr contains descriptive error message about directory not found

**EARS Covered**: R09 (WHEN input dir not found → exit code 1)

---

## Scenario 7: --series Filter Flag

**Given**: `input/` contains `series_1/`, `series_2/`, `series_3/`

**When**: `medical-imaging analyze ./input --series series_1,series_3`

**Then**:
- `output/series_1/` and `output/series_3/` created and populated
- `output/series_2/` does NOT exist
- Evolution analysis covers only series_1 and series_3

**EARS Covered**: R11 (WHERE --series flag → process only named series)

---

## Scenario 8: Disclaimer in Every Output File

**Given**: Any successful analysis run

**When**: Any `.md` output file is checked

**Then**:
- File contains the string "educational purposes only"
- All JSON files contain `"disclaimer"` field with non-empty value

**EARS Covered**: R10 (disclaimer on all outputs)

---

## Fixture Setup

```
tests/fixtures/
├── series_1/
│   ├── test_image_1.png    <- 100×100 synthetic PNG
│   ├── test_image_2.png    <- 100×100 synthetic PNG
│   ├── test_image_3.png    <- 100×100 synthetic PNG
│   └── context.txt         <- "Patient has known COPD"
├── series_2/
│   ├── test_image_1.png
│   └── test_image_2.png
└── mock-responses/
    ├── image-analysis-success.txt   <- Sample Gemini response
    ├── series-synthesis.txt         <- Sample synthesis response
    └── evolution-analysis.txt       <- Sample evolution response
```

Synthetic PNG files can be generated in `beforeAll()` using `sharp` or `fs.writeFileSync` with a valid minimal PNG byte sequence.

---

*Created by: Claude Code (spec-writer.skill) | 2026-02-25*
*GABBE SDLC Phase: S03 — Specification*
