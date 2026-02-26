# AgenticMedicalImagingHelper

> AI-powered medical image analysis with temporal evolution tracking
> First complete project powered by [GABBE](https://github.com/andreibesleaga/GABBE)

A TypeScript CLI tool that uses Google Gemini 2.5 Pro and LangGraph.js to analyze series of medical images, detect findings, and track how conditions evolve over time across multiple imaging sessions.

⚠️ **DISCLAIMER**: This tool is for **educational and informational purposes only**. It is NOT a substitute for professional medical diagnosis or treatment. All findings must be reviewed by a qualified healthcare professional.

---

## Features

- **Multi-series analysis** — processes multiple series of images (CT, MRI, X-ray, Ultrasound, etc.) in parallel
- **Fan-Out/Fan-In architecture** — LangGraph StateGraph with p-limit concurrency control
- **Temporal evolution tracking** — compares series across time and reports progression (Improving/Stable/Worsening)
- **Context integration** — reads `.txt` files alongside images for additional clinical context
- **Research grounding** — Gemini built-in Google Search for literature citations
- **Structured reports** — per-image JSON + per-series Markdown + combined evolution report

## Input Structure

```
input/
├── patient_context.txt          # Optional: overall patient context
├── series_1/                    # First imaging session
│   ├── image_001.png
│   ├── image_002.jpg
│   └── clinical_notes.txt       # Optional: series-specific context
├── series_2/                    # Second imaging session (later date)
│   ├── image_001.png
│   └── image_002.png
└── series_n/
    └── ...
```

## Output Structure

```
output/
├── series_1/
│   ├── image_001_analysis.json  # Per-image AI analysis
│   ├── image_002_analysis.json
│   └── series_summary.md        # Aggregated series report
├── series_2/
│   ├── image_001_analysis.json
│   └── series_summary.md
├── evolution_analysis.json      # Temporal comparison data
└── combined_diagnostic_report.md  # Full evolution narrative
```

## Prerequisites

- Node.js 20+
- Google Gemini API key with access to `gemini-2.5-pro`

## Installation

```bash
# Clone the repository
git clone https://github.com/andreibesleaga/AgenticMedicalImagingHelper.git
cd AgenticMedicalImagingHelper

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your API key
echo "GOOGLE_API_KEY=your-api-key-here" > .env
```

## Usage

```bash
# Build
npm run build

# Analyze images (default: ./input → ./output)
npm run dev -- analyze ./input

# With options
npm run dev -- analyze ./input ./output --concurrency 3 --verbose

# Analyze only specific series
npm run dev -- analyze ./input --series series_1 series_2

# Using the built binary
./dist/main/index.js analyze ./input --verbose
```

### CLI Options

```
analyze <inputDir> [outputDir]

Arguments:
  inputDir              Path to input directory with series sub-folders
  outputDir             Output path (default: ./output)

Options:
  -s, --series <ids...> Process only specified series IDs
  -c, --concurrency <n> Max parallel Gemini API calls (default: 5)
  -v, --verbose         Print progress to stderr
  -h, --help            Show help
      --version         Show version
```

### Exit Codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | All images analyzed successfully                    |
| 1    | Missing or invalid API key                          |
| 2    | Input directory not found or unreadable             |
| 3    | No image series found in input directory            |
| 4    | Partial failure — some images could not be analyzed |
| 99   | Unexpected internal error                           |

## Environment Variables

| Variable         | Required          | Description              |
| ---------------- | ----------------- | ------------------------ |
| `GOOGLE_API_KEY` | Yes               | Google Gemini API key    |
| `GEMINI_API_KEY` | Yes (alternative) | Alternative env var name |

## Development

```bash
# Run tests
npm test

# Run tests with coverage report
npm test -- --coverage

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Docker

```bash
# Build image
docker build -t medical-imaging .

# Run (mount input/output directories)
docker run --rm \
  -e GOOGLE_API_KEY=your-key \
  -v $(pwd)/input:/app/input:ro \
  -v $(pwd)/output:/app/output \
  medical-imaging analyze /app/input /app/output --verbose
```

## Architecture

```
src/
├── domain/          # Business entities, types, error classes
├── application/     # Use cases (analyze-image, aggregate-series, analyze-evolution)
├── infrastructure/  # External adapters (Gemini API, file scanner, report writer)
├── adapters/        # LangGraph StateGraph orchestrator
└── main/            # CLI entry point (Commander.js)
```

The system uses the **LangGraph Fan-Out/Fan-In** pattern:

1. `scanInputDirectory` discovers all image series
2. `analyzeImages` node fans out — analyzes all images concurrently (p-limit)
3. `aggregateSeries` node fans in — synthesizes per-series summaries
4. `analyzeEvolution` node — compares series for temporal progression
5. `writeReports` writes structured output files

## Security

- API key required via environment variable; never logged
- Path traversal protection on all file operations
- Context truncated to 2000 characters to prevent prompt injection
- Images resized to max 1024px before API submission
- All output includes mandatory medical disclaimer

See [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) for full security audit.

## License

GPL v3 — see [LICENSE](LICENSE) for details.
