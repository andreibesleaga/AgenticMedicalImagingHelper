import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { writeReports } from "../../../src/infrastructure/report-writer.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type {
  GraphState,
  ImageAnalysis,
  SeriesSummary,
  TemporalAnalysis,
} from "../../../src/domain/types.js";

let tmpOutput: string;
let tmpInput: string;

const makeAnalysis = (
  imagePath: string,
  seriesId: string,
  status: "success" | "error" = "success"
): ImageAnalysis => ({
  imagePath,
  seriesId,
  status,
  errorMessage: status === "error" ? "API failed" : undefined,
  modality: "X-ray",
  anatomyRegion: "Chest",
  quality: "Good",
  findings: ["Clear lungs"],
  rawResponse: "### 1. Image Type\\nX-ray",
  summary: "Normal chest",
  processedAt: "2026-02-25T00:00:00.000Z",
  disclaimer: DISCLAIMER,
});

const makeSummary = (seriesId: string): SeriesSummary => ({
  seriesId,
  imageCount: 2,
  successCount: 2,
  failureCount: 0,
  consistentFindings: ["Clear lungs"],
  discrepancies: [],
  primaryDiagnosis: "Normal",
  differentialDiagnoses: [],
  confidenceLevel: "High",
  textContextUsed: false,
  report: `# ${seriesId} Summary\n\nNormal findings.`,
  processedAt: "2026-02-25T00:00:00.000Z",
  disclaimer: DISCLAIMER,
});

const makeEvolution = (): TemporalAnalysis => ({
  seriesCount: 2,
  seriesIds: ["series_1", "series_2"],
  progression: "Stable",
  trends: [],
  forecastedEvolution: "Expected to remain stable",
  treatmentRecommendations: ["Routine follow-up"],
  combinedReport: "# Evolution\n\nStable across sessions.",
  processedAt: "2026-02-25T00:00:00.000Z",
  disclaimer: DISCLAIMER,
});

beforeAll(async () => {
  tmpInput = await fs.mkdtemp(path.join(os.tmpdir(), "medical-input-"));
  tmpOutput = await fs.mkdtemp(path.join(os.tmpdir(), "medical-output-"));
  await fs.mkdir(path.join(tmpInput, "series_1"), { recursive: true });
  await fs.mkdir(path.join(tmpInput, "series_2"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpOutput, { recursive: true });
  await fs.rm(tmpInput, { recursive: true });
});

describe("writeReports", () => {
  it("creates output directory if it does not exist", async () => {
    const newOutput = path.join(tmpOutput, "new-subdir");
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: newOutput,
      series: [],
      imageResults: [],
      seriesResults: [],
    };

    await writeReports(state);
    const stat = await fs.stat(newOutput);
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes per-image JSON files in the correct subdirectory", async () => {
    const imagePath = path.join(tmpInput, "series_1", "image_001.png");
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [makeAnalysis(imagePath, "series_1")],
      seriesResults: [],
    };

    await writeReports(state);

    const jsonPath = path.join(tmpOutput, "series_1", "image_001_analysis.json");
    const content = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
    expect(content.status).toBe("success");
    expect(content.seriesId).toBe("series_1");
    expect(content.disclaimer).toBe(DISCLAIMER);
  });

  it("writes per-series Markdown summary files", async () => {
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [makeSummary("series_1")],
    };

    await writeReports(state);

    const mdPath = path.join(tmpOutput, "series_1", "series_summary.md");
    const content = await fs.readFile(mdPath, "utf-8");
    expect(content).toContain("series_1 Summary");
    expect(content).toContain(DISCLAIMER);
  });

  it("writes evolution_analysis.json when evolutionResult is present", async () => {
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [],
      evolutionResult: makeEvolution(),
    };

    await writeReports(state);

    const jsonPath = path.join(tmpOutput, "evolution_analysis.json");
    const content = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
    expect(content.progression).toBe("Stable");
    expect(content.disclaimer).toBe(DISCLAIMER);
  });

  it("writes combined_diagnostic_report.md when evolutionResult is present", async () => {
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [],
      evolutionResult: makeEvolution(),
    };

    await writeReports(state);

    const mdPath = path.join(tmpOutput, "combined_diagnostic_report.md");
    const content = await fs.readFile(mdPath, "utf-8");
    expect(content).toContain("Evolution");
    expect(content).toContain(DISCLAIMER);
  });

  it("returns an array of written file paths", async () => {
    const imagePath = path.join(tmpInput, "series_2", "scan.png");
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [makeAnalysis(imagePath, "series_2")],
      seriesResults: [makeSummary("series_2")],
      evolutionResult: makeEvolution(),
    };

    const paths = await writeReports(state);
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => typeof p === "string")).toBe(true);
  });

  it("disclaimer appears in every Markdown output file", async () => {
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [makeSummary("series_1")],
      evolutionResult: makeEvolution(),
    };

    await writeReports(state);

    const seriesMd = await fs.readFile(
      path.join(tmpOutput, "series_1", "series_summary.md"),
      "utf-8"
    );
    const combinedMd = await fs.readFile(
      path.join(tmpOutput, "combined_diagnostic_report.md"),
      "utf-8"
    );
    expect(seriesMd).toContain("AI-generated");
    expect(combinedMd).toContain("educational purposes only");
  });

  it("renders 'Yes' for textContextUsed=true in series summary", async () => {
    const summary: SeriesSummary = { ...makeSummary("series_ctx"), textContextUsed: true };
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [summary],
    };
    await writeReports(state);
    const content = await fs.readFile(
      path.join(tmpOutput, "series_ctx", "series_summary.md"),
      "utf-8"
    );
    expect(content).toContain("**Context file used**: Yes");
  });

  it("renders fallback when consistentFindings is empty", async () => {
    const summary: SeriesSummary = { ...makeSummary("series_nof"), consistentFindings: [] };
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [summary],
    };
    await writeReports(state);
    const content = await fs.readFile(
      path.join(tmpOutput, "series_nof", "series_summary.md"),
      "utf-8"
    );
    expect(content).toContain("_No consistent findings extracted_");
  });

  it("renders fallback when treatmentRecommendations is empty", async () => {
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [],
      evolutionResult: { ...makeEvolution(), treatmentRecommendations: [] },
    };
    await writeReports(state);
    const content = await fs.readFile(
      path.join(tmpOutput, "combined_diagnostic_report.md"),
      "utf-8"
    );
    expect(content).toContain("_See full report above_");
  });

  it("renders non-empty differentialDiagnoses and discrepancies in series summary", async () => {
    const summary: SeriesSummary = {
      ...makeSummary("series_dx"),
      differentialDiagnoses: ["Pneumonia", "Emphysema"],
      discrepancies: ["PA view shows opacity absent on lateral view"],
    };
    const state: GraphState = {
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [summary],
    };

    await writeReports(state);

    const mdPath = path.join(tmpOutput, "series_dx", "series_summary.md");
    const content = await fs.readFile(mdPath, "utf-8");
    expect(content).toContain("1. Pneumonia");
    expect(content).toContain("2. Emphysema");
    expect(content).toContain("PA view shows opacity absent on lateral view");
  });
});

describe("writeReports — structured fields and labelling", () => {
  const write = async (state: Partial<GraphState>): Promise<void> => {
    await writeReports({
      inputDir: tmpInput,
      outputDir: tmpOutput,
      series: [],
      imageResults: [],
      seriesResults: [],
      ...state,
    });
  };

  const readSeries = (id: string): Promise<string> =>
    fs.readFile(path.join(tmpOutput, id, "series_summary.md"), "utf-8");
  const readCombined = (): Promise<string> =>
    fs.readFile(path.join(tmpOutput, "combined_diagnostic_report.md"), "utf-8");

  it("labels treatment suggestions as experimental, not clinical recommendations", async () => {
    await write({ evolutionResult: makeEvolution() });
    const content = await readCombined();

    expect(content).toContain(
      "## Treatment Suggestions (experimental — not clinical recommendations)"
    );
    expect(content).toContain("They are not clinical recommendations and must not be acted on.");
    expect(content).toContain("- Routine follow-up");
    // The old, unqualified heading must not survive anywhere.
    expect(content).not.toContain("## Treatment Recommendations\n");
  });

  it("renders per-finding trends, with and without details", async () => {
    await write({
      evolutionResult: {
        ...makeEvolution(),
        trends: [
          { finding: "Effusion", trend: "Improving", details: "Smaller than prior" },
          { finding: "Nodule", trend: "Stable", details: "" },
        ],
      },
    });
    const content = await readCombined();

    expect(content).toContain("- **Effusion** — Improving: Smaller than prior");
    expect(content).toContain("- **Nodule** — Stable\n");
  });

  it("renders the fallback when no trends were extracted", async () => {
    await write({ evolutionResult: makeEvolution() });
    expect(await readCombined()).toContain("_No per-finding trends extracted_");
  });

  it("renders the forecast, and a fallback when it is empty", async () => {
    await write({ evolutionResult: makeEvolution() });
    expect(await readCombined()).toContain("Expected to remain stable");

    await write({ evolutionResult: { ...makeEvolution(), forecastedEvolution: "" } });
    expect(await readCombined()).toContain("_Not extracted_");
  });

  it("states that the structured output was schema-validated", async () => {
    await write({
      seriesResults: [{ ...makeSummary("series_ok"), validation: { ok: true } }],
      evolutionResult: { ...makeEvolution(), validation: { ok: true } },
    });

    expect(await readSeries("series_ok")).toContain("**Structured output**: schema-validated");
    expect(await readCombined()).toContain("**Structured output**: schema-validated");
  });

  it("states the validation failure and lists its issues", async () => {
    await write({
      seriesResults: [
        {
          ...makeSummary("series_bad"),
          validation: { ok: false, issues: ["quality: invalid enum value", "summary: required"] },
        },
      ],
      evolutionResult: {
        ...makeEvolution(),
        validation: { ok: false, issues: ["(root): response is not a JSON object"] },
      },
    });

    const series = await readSeries("series_bad");
    expect(series).toContain("**Structured output**: schema validation FAILED (2 issue(s))");
    expect(series).toContain("> - quality: invalid enum value");
    expect(series).toContain("> - summary: required");

    const combined = await readCombined();
    expect(combined).toContain("**Structured output**: schema validation FAILED (1 issue(s))");
    expect(combined).toContain("> - (root): response is not a JSON object");
  });

  it("renders a validation failure that carries no issue list", async () => {
    await write({
      seriesResults: [{ ...makeSummary("series_noissue"), validation: { ok: false } }],
    });

    const series = await readSeries("series_noissue");
    expect(series).toContain("**Structured output**: schema validation FAILED (0 issue(s))");
    expect(series).not.toContain("> -");
  });

  it("says nothing about validation when no model response was validated", async () => {
    await write({
      seriesResults: [makeSummary("series_silent")],
      evolutionResult: makeEvolution(),
    });

    expect(await readSeries("series_silent")).not.toContain("Structured output");
    expect(await readCombined()).not.toContain("Structured output");
  });

  it("keeps the disclaimer in every Markdown file on the validation-failure path", async () => {
    await write({
      seriesResults: [
        { ...makeSummary("series_disc"), validation: { ok: false, issues: ["x: y"] } },
      ],
      evolutionResult: { ...makeEvolution(), validation: { ok: false, issues: ["x: y"] } },
    });

    expect((await readSeries("series_disc")).toLowerCase()).toContain("educational");
    expect((await readCombined()).toLowerCase()).toContain("educational");
  });

  it("writes the per-image structured fields and validation outcome into the JSON", async () => {
    const imagePath = path.join(tmpInput, "series_1", "structured.png");
    await write({
      imageResults: [
        {
          ...makeAnalysis(imagePath, "series_1"),
          abnormalities: [
            { name: "Nodule", description: "8 mm", severity: "Moderate", confidence: 71 },
          ],
          references: ["https://example.org/ref"],
          validation: { ok: true },
        },
      ],
    });

    const parsed = JSON.parse(
      await fs.readFile(path.join(tmpOutput, "series_1", "structured_analysis.json"), "utf-8")
    ) as ImageAnalysis;
    expect(parsed.anatomyRegion).toBe("Chest");
    expect(parsed.quality).toBe("Good");
    expect(parsed.abnormalities).toHaveLength(1);
    expect(parsed.references).toEqual(["https://example.org/ref"]);
    expect(parsed.validation).toEqual({ ok: true });
  });
});
