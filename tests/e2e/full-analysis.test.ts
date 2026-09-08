/**
 * E2E pipeline tests — Scenarios 1, 2, 3, 4, 7, 8 from tests/e2e/scenarios.md.
 *
 * Strategy: exercise the real LangGraph pipeline + real report-writer + real
 * file-scanner against a temporary directory. The only mocked surface is the
 * GeminiClient interface — no real API calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as url from "url";

import { runMedicalImagingAgent } from "../../src/adapters/langgraph-agent.js";
import { createGeminiClient } from "../../src/infrastructure/gemini-client.js";
import { scanInputDirectory } from "../../src/infrastructure/file-scanner.js";
import { writeReports } from "../../src/infrastructure/report-writer.js";
import {
  DISCLAIMER,
  type ImageAnalysis,
  type SeriesSummary,
  type TemporalAnalysis,
} from "../../src/domain/types.js";
import type { GeminiClient } from "../../src/infrastructure/gemini-client.js";

// ─── Mock builders ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = jest.Mock<(...args: any[]) => Promise<any>>;

interface ClientMocks {
  client: GeminiClient;
  analyzeImage: AnyMock;
  synthesizeSeries: AnyMock;
  analyzeEvolution: AnyMock;
}

function makeImageAnalysis(
  imagePath: string,
  seriesId: string,
  overrides: Partial<ImageAnalysis> = {}
): ImageAnalysis {
  return {
    imagePath,
    seriesId,
    status: "success",
    modality: "X-ray",
    anatomyRegion: "Chest",
    quality: "Good",
    findings: ["Normal lung fields", "No acute abnormalities"],
    abnormalities: [],
    summary: "Routine chest x-ray, no abnormalities visualised.",
    rawResponse:
      "### 1. Image Type & Region\nModality: X-ray\n### 4. Patient-Friendly Explanation\nLooks clear.",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

function makeSeriesSummary(
  seriesId: string,
  overrides: Partial<SeriesSummary> = {}
): SeriesSummary {
  return {
    seriesId,
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: ["Normal lung fields"],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: `# Series ${seriesId}\n\nRoutine.`,
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

function makeTemporal(overrides: Partial<TemporalAnalysis> = {}): TemporalAnalysis {
  return {
    seriesCount: 1,
    seriesIds: ["series_1"],
    progression: "SingleSeries",
    trends: [],
    forecastedEvolution: "Only one series available; no temporal trend.",
    treatmentRecommendations: [],
    combinedReport: "# Combined diagnostic report\n\nSingle series, no trend.",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

function buildMockClient(): ClientMocks {
  const analyzeImage = jest.fn() as AnyMock;
  const synthesizeSeries = jest.fn() as AnyMock;
  const analyzeEvolution = jest.fn() as AnyMock;

  // Defaults — individual tests override as needed.
  analyzeImage.mockImplementation((imagePath: string, seriesId: string) =>
    Promise.resolve(makeImageAnalysis(imagePath, seriesId))
  );
  synthesizeSeries.mockImplementation((seriesId: string) =>
    Promise.resolve(makeSeriesSummary(seriesId))
  );
  analyzeEvolution.mockImplementation((summaries: SeriesSummary[]) =>
    Promise.resolve(
      makeTemporal({
        seriesCount: summaries.length,
        seriesIds: summaries.map((s) => s.seriesId),
        progression: summaries.length > 1 ? "Stable" : "SingleSeries",
      })
    )
  );

  return {
    client: {
      analyzeImage,
      synthesizeSeries,
      analyzeEvolution,
    } as unknown as GeminiClient,
    analyzeImage,
    synthesizeSeries,
    analyzeEvolution,
  };
}

// ─── Filesystem helpers ──────────────────────────────────────────────────────

async function makeInputDir(seriesSpec: {
  [seriesId: string]: { images: string[]; contextText?: string };
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-in-"));
  for (const [seriesId, spec] of Object.entries(seriesSpec)) {
    const seriesDir = path.join(dir, seriesId);
    await fs.mkdir(seriesDir, { recursive: true });
    for (const imageName of spec.images) {
      // Dummy file — mocked Gemini never reads pixels, just paths.
      await fs.writeFile(path.join(seriesDir, imageName), "PNG");
    }
    if (spec.contextText) {
      await fs.writeFile(path.join(seriesDir, "context.txt"), spec.contextText);
    }
  }
  return dir;
}

async function makeOutputDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "e2e-out-"));
}

async function rmrf(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, "utf-8");
  return JSON.parse(text) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runPipeline(
  inputDir: string,
  outputDir: string,
  mocks: ClientMocks,
  seriesFilter?: string[]
) {
  const series = await scanInputDirectory(inputDir, seriesFilter);
  const state = await runMedicalImagingAgent(inputDir, outputDir, series, mocks.client, {
    concurrency: 2,
    verbose: false,
    series: seriesFilter,
  });
  const reportPaths = await writeReports(state);
  state.reportPaths = reportPaths;
  return { state, reportPaths };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

describe("E2E — full pipeline against tmp directories", () => {
  let mocks: ClientMocks;
  let inputDir: string;
  let outputDir: string;

  beforeEach(() => {
    mocks = buildMockClient();
  });

  afterAll(async () => {
    // best-effort cleanup; individual tests also clean up their own dirs
  });

  // ── Scenario 1: Single series, multiple images ──────────────────────────
  describe("Scenario 1 — Single Series, Multiple Images", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: { images: ["test_image_1.png", "test_image_2.png", "test_image_3.png"] },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("writes per-image JSON for every image with status=success", async () => {
      const { state } = await runPipeline(inputDir, outputDir, mocks);
      expect(state.imageResults).toHaveLength(3);

      for (const i of [1, 2, 3]) {
        const jsonPath = path.join(outputDir, "series_1", `test_image_${i}_analysis.json`);
        expect(await exists(jsonPath)).toBe(true);
        const parsed = await readJson<ImageAnalysis>(jsonPath);
        expect(parsed.status).toBe("success");
        expect(parsed.disclaimer).toContain("educational");
      }
    });

    it("writes a series_summary.md containing the seriesId and disclaimer", async () => {
      await runPipeline(inputDir, outputDir, mocks);
      const summaryPath = path.join(outputDir, "series_1", "series_summary.md");
      expect(await exists(summaryPath)).toBe(true);
      const md = await fs.readFile(summaryPath, "utf-8");
      expect(md).toContain("series_1");
      expect(md.toLowerCase()).toContain("educational");
    });

    it("writes a combined_diagnostic_report.md with disclaimer and a SingleSeries evolution", async () => {
      await runPipeline(inputDir, outputDir, mocks);
      const combined = path.join(outputDir, "combined_diagnostic_report.md");
      expect(await exists(combined)).toBe(true);
      const md = await fs.readFile(combined, "utf-8");
      expect(md.toLowerCase()).toContain("educational");

      const evolutionJson = path.join(outputDir, "evolution_analysis.json");
      const evo = await readJson<TemporalAnalysis>(evolutionJson);
      expect(evo.progression).toBe("SingleSeries");
    });
  });

  // ── Scenario 2: Multiple series → temporal evolution ───────────────────
  describe("Scenario 2 — Multiple Series, Temporal Evolution", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: { images: ["test_image_1.png", "test_image_2.png"] },
        series_2: { images: ["test_image_1.png", "test_image_2.png"] },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("produces 4 per-image JSON files in the right subdirectories", async () => {
      await runPipeline(inputDir, outputDir, mocks);
      for (const seriesId of ["series_1", "series_2"]) {
        for (const i of [1, 2]) {
          const jsonPath = path.join(outputDir, seriesId, `test_image_${i}_analysis.json`);
          expect(await exists(jsonPath)).toBe(true);
        }
      }
    });

    it("evolution_analysis.json shows seriesCount=2 and progression !== SingleSeries", async () => {
      await runPipeline(inputDir, outputDir, mocks);
      const evo = await readJson<TemporalAnalysis>(path.join(outputDir, "evolution_analysis.json"));
      expect(evo.seriesCount).toBe(2);
      expect(evo.progression).not.toBe("SingleSeries");
    });

    it("combined_diagnostic_report.md references both series", async () => {
      await runPipeline(inputDir, outputDir, mocks);
      const md = await fs.readFile(path.join(outputDir, "combined_diagnostic_report.md"), "utf-8");
      // The combined-report writer prints the series IDs that were analysed.
      expect(md).toMatch(/series_1.*series_2|series_2.*series_1/s);
    });
  });

  // ── Scenario 3: Context-file injection ─────────────────────────────────
  describe("Scenario 3 — Context File Injection", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: {
          images: ["test_image_1.png", "test_image_2.png"],
          contextText: "Patient has known COPD",
        },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("passes the context file contents to synthesizeSeries", async () => {
      // Make the synthesizeSeries mock record that it saw the context and
      // set textContextUsed=true on its returned summary.
      mocks.synthesizeSeries.mockImplementation(
        (seriesId: string, _analyses: unknown, textContext?: string) =>
          Promise.resolve(
            makeSeriesSummary(seriesId, {
              textContextUsed: Boolean(textContext),
            })
          )
      );

      await runPipeline(inputDir, outputDir, mocks);

      expect(mocks.synthesizeSeries).toHaveBeenCalledTimes(1);
      const call = mocks.synthesizeSeries.mock.calls[0]!;
      expect(call[0]).toBe("series_1");
      expect(call[2]).toContain("Patient has known COPD");
    });

    it("writes textContextUsed=true into the series summary file", async () => {
      mocks.synthesizeSeries.mockImplementation(
        (seriesId: string, _analyses: unknown, textContext?: string) =>
          Promise.resolve(
            makeSeriesSummary(seriesId, {
              textContextUsed: Boolean(textContext),
            })
          )
      );

      const { state } = await runPipeline(inputDir, outputDir, mocks);
      expect(state.seriesResults[0]?.textContextUsed).toBe(true);
    });
  });

  // ── Scenario 4: Graceful degradation when one image fails ──────────────
  describe("Scenario 4 — Graceful Degradation on Image Failure", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: { images: ["test_image_1.png", "test_image_2.png", "test_image_3.png"] },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("marks the failing image as status=error and leaves the others succeeding", async () => {
      mocks.analyzeImage.mockImplementation((imagePath: string, seriesId: string) => {
        if (path.basename(imagePath).startsWith("test_image_2")) {
          return Promise.resolve(
            makeImageAnalysis(imagePath, seriesId, {
              status: "error",
              errorMessage: "Simulated Gemini failure",
              modality: undefined,
              findings: undefined,
              summary: undefined,
            })
          );
        }
        return Promise.resolve(makeImageAnalysis(imagePath, seriesId));
      });

      const { state } = await runPipeline(inputDir, outputDir, mocks);

      const failed = state.imageResults.find((r) =>
        path.basename(r.imagePath).startsWith("test_image_2")
      );
      expect(failed?.status).toBe("error");
      expect(failed?.errorMessage).toBeTruthy();

      const otherStatuses = state.imageResults
        .filter((r) => !path.basename(r.imagePath).startsWith("test_image_2"))
        .map((r) => r.status);
      expect(otherStatuses).toEqual(["success", "success"]);
    });

    it("still writes the series summary (does not abort the batch)", async () => {
      mocks.analyzeImage.mockImplementation((imagePath: string, seriesId: string) => {
        if (path.basename(imagePath).startsWith("test_image_2")) {
          return Promise.resolve(
            makeImageAnalysis(imagePath, seriesId, {
              status: "error",
              errorMessage: "Simulated Gemini failure",
            })
          );
        }
        return Promise.resolve(makeImageAnalysis(imagePath, seriesId));
      });

      await runPipeline(inputDir, outputDir, mocks);

      const summaryPath = path.join(outputDir, "series_1", "series_summary.md");
      expect(await exists(summaryPath)).toBe(true);
    });
  });

  // ── Scenario 7: --series filter flag ───────────────────────────────────
  describe("Scenario 7 — --series Filter Flag", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: { images: ["test_image_1.png"] },
        series_2: { images: ["test_image_1.png"] },
        series_3: { images: ["test_image_1.png"] },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("processes only the named series, leaving the others untouched", async () => {
      await runPipeline(inputDir, outputDir, mocks, ["series_1", "series_3"]);

      expect(await exists(path.join(outputDir, "series_1", "series_summary.md"))).toBe(true);
      expect(await exists(path.join(outputDir, "series_3", "series_summary.md"))).toBe(true);
      expect(await exists(path.join(outputDir, "series_2"))).toBe(false);
    });

    it("limits the evolution analysis to the filtered series", async () => {
      mocks.analyzeEvolution.mockImplementation((summaries: SeriesSummary[]) =>
        Promise.resolve(
          makeTemporal({
            seriesCount: summaries.length,
            seriesIds: summaries.map((s) => s.seriesId),
            progression: "Stable",
          })
        )
      );

      const { state } = await runPipeline(inputDir, outputDir, mocks, ["series_1", "series_3"]);

      expect(state.evolutionResult?.seriesCount).toBe(2);
      expect(state.evolutionResult?.seriesIds.sort()).toEqual(["series_1", "series_3"]);
    });
  });

  // ── Scenario 8: Disclaimer on every output ─────────────────────────────
  describe("Scenario 8 — Disclaimer in Every Output File (hard test)", () => {
    beforeAll(async () => {
      inputDir = await makeInputDir({
        series_1: { images: ["test_image_1.png", "test_image_2.png"] },
        series_2: { images: ["test_image_1.png"] },
      });
      outputDir = await makeOutputDir();
    });

    afterAll(async () => {
      await rmrf(inputDir);
      await rmrf(outputDir);
    });

    it("every JSON output file carries a non-empty `disclaimer` field", async () => {
      await runPipeline(inputDir, outputDir, mocks);

      async function* walkJson(root: string): AsyncGenerator<string> {
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
          const full = path.join(root, entry.name);
          if (entry.isDirectory()) {
            yield* walkJson(full);
          } else if (entry.name.endsWith(".json")) {
            yield full;
          }
        }
      }

      let count = 0;
      for await (const file of walkJson(outputDir)) {
        count++;
        const parsed = await readJson<{ disclaimer?: string }>(file);
        expect(parsed.disclaimer && parsed.disclaimer.length > 0).toBe(true);
      }
      expect(count).toBeGreaterThan(0);
    });

    it("every Markdown output file contains the phrase 'educational' (case-insensitive)", async () => {
      await runPipeline(inputDir, outputDir, mocks);

      async function* walkMd(root: string): AsyncGenerator<string> {
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
          const full = path.join(root, entry.name);
          if (entry.isDirectory()) {
            yield* walkMd(full);
          } else if (entry.name.endsWith(".md")) {
            yield full;
          }
        }
      }

      let count = 0;
      for await (const file of walkMd(outputDir)) {
        count++;
        const text = await fs.readFile(file, "utf-8");
        expect(text.toLowerCase()).toContain("educational");
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  // ── Scenario 9: structured outputs, end to end through the real client ─────
  //
  // Everything except the HTTP call is real here: the prompts, JSON mode, the
  // Zod schemas, the LangGraph pipeline and the report writer. The stub
  // ContentGenerator replies with the committed mock responses, so the artefacts
  // on disk show exactly which fields a validated model answer populates.
  describe("Scenario 9 — structured output populates the artefacts", () => {
    const __dirname9 = path.dirname(url.fileURLToPath(import.meta.url));
    const FIXTURES = path.resolve(__dirname9, "../fixtures");
    const MOCKS = path.join(FIXTURES, "mock-responses");

    let structuredInput: string;
    let structuredOutput: string;

    async function readMock(name: string): Promise<string> {
      return fs.readFile(path.join(MOCKS, name), "utf-8");
    }

    /** Route each stage's prompt to the mock response for that stage. */
    async function stubGenerator(reply: (stage: "image" | "series" | "evolution") => string) {
      return {
        generateContent: async (request: unknown) => {
          const req = request as { contents?: Array<{ parts: Array<{ text?: string }> }> };
          const text = (req.contents ?? [])
            .flatMap((c) => c.parts)
            .map((p) => p.text ?? "")
            .join("\n");
          const stage = text.includes("disease progression")
            ? "evolution"
            : text.includes("synthesizing findings")
              ? "series"
              : "image";
          return { response: { text: () => reply(stage) } };
        },
      };
    }

    beforeAll(async () => {
      structuredInput = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-struct-in-"));
      structuredOutput = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-struct-out-"));
      // Real PNGs — the client re-encodes them with sharp before sending.
      for (const seriesId of ["series_1", "series_2"]) {
        const dir = path.join(structuredInput, seriesId);
        await fs.mkdir(dir, { recursive: true });
        await fs.copyFile(path.join(FIXTURES, "test_image.png"), path.join(dir, "scan_1.png"));
      }
    });

    afterAll(async () => {
      await rmrf(structuredInput);
      await rmrf(structuredOutput);
    });

    async function runReal(reply: (stage: "image" | "series" | "evolution") => string) {
      const model = await stubGenerator(reply);
      const client = createGeminiClient(model);
      const series = await scanInputDirectory(structuredInput);
      const state = await runMedicalImagingAgent(
        structuredInput,
        structuredOutput,
        series,
        client,
        { concurrency: 2, verbose: false }
      );
      state.reportPaths = await writeReports(state);
      return state;
    }

    it("writes modality, region, quality, findings, abnormalities and validation into every image JSON", async () => {
      const mocks = {
        image: await readMock("image-analysis-success.txt"),
        series: await readMock("series-synthesis.txt"),
        evolution: await readMock("evolution-analysis.txt"),
      };
      await runReal((stage) => mocks[stage]);

      for (const seriesId of ["series_1", "series_2"]) {
        const parsed = await readJson<ImageAnalysis>(
          path.join(structuredOutput, seriesId, "scan_1_analysis.json")
        );
        expect(parsed.status).toBe("success");
        expect(parsed.modality).toBe("X-ray");
        expect(parsed.anatomyRegion).toContain("Chest");
        expect(parsed.quality).toBe("Good");
        expect(parsed.findings?.length).toBeGreaterThan(0);
        expect(parsed.abnormalities?.[0]?.severity).toBe("Mild");
        expect(parsed.abnormalities?.[0]?.confidence).toBe(62);
        expect(parsed.summary).toBeTruthy();
        expect(parsed.validation).toEqual({ ok: true });
        expect(parsed.disclaimer).toContain("educational");
      }
    });

    it("writes series consistentFindings / differentials and evolution trends, forecast and suggestions", async () => {
      const mocks = {
        image: await readMock("image-analysis-success.txt"),
        series: await readMock("series-synthesis.txt"),
        evolution: await readMock("evolution-analysis.txt"),
      };
      const state = await runReal((stage) => mocks[stage]);

      const summary = state.seriesResults[0]!;
      expect(summary.consistentFindings.length).toBeGreaterThan(0);
      expect(summary.discrepancies.length).toBeGreaterThan(0);
      expect(summary.differentialDiagnoses.length).toBeGreaterThan(0);
      expect(summary.confidenceLevel).toBe("High");
      expect(summary.validation).toEqual({ ok: true });

      const evo = await readJson<TemporalAnalysis & { validation?: { ok: boolean } }>(
        path.join(structuredOutput, "evolution_analysis.json")
      );
      expect(evo.progression).toBe("Stable");
      expect(evo.trends).toHaveLength(2);
      expect(evo.forecastedEvolution).not.toBe("");
      expect(evo.treatmentRecommendations).toHaveLength(2);
      expect(evo.validation).toEqual({ ok: true });

      const combined = await fs.readFile(
        path.join(structuredOutput, "combined_diagnostic_report.md"),
        "utf-8"
      );
      expect(combined).toContain(
        "## Treatment Suggestions (experimental — not clinical recommendations)"
      );
      expect(combined).toContain("- **Left basal atelectasis** — Stable");
      expect(combined).toContain("**Structured output**: schema-validated");

      const seriesMd = await fs.readFile(
        path.join(structuredOutput, "series_1", "series_summary.md"),
        "utf-8"
      );
      expect(seriesMd).toContain("**Structured output**: schema-validated");
    });

    it("records — and never crashes on — a model that answers in Markdown instead of JSON", async () => {
      const state = await runReal(
        () =>
          "### 1. Image Type & Region\n- Modality: MRI\n\n### 2. Key Findings\n- Nothing acute\n"
      );

      // The pipeline completed and every artefact says why validation failed.
      const failures: string[] = [];
      for (const seriesId of ["series_1", "series_2"]) {
        const parsed = await readJson<ImageAnalysis>(
          path.join(structuredOutput, seriesId, "scan_1_analysis.json")
        );
        expect(parsed.status).toBe("success");
        expect(parsed.modality).toBe("MRI"); // pattern fallback still fills what it can
        expect(parsed.validation?.ok).toBe(false);
        expect(parsed.validation?.issues?.length).toBeGreaterThan(0);
        failures.push(...(parsed.validation?.issues ?? []));
      }
      expect(failures.length).toBeGreaterThan(0);

      expect(state.seriesResults.every((s) => s.validation?.ok === false)).toBe(true);
      expect(state.evolutionResult?.validation?.ok).toBe(false);

      const combined = await fs.readFile(
        path.join(structuredOutput, "combined_diagnostic_report.md"),
        "utf-8"
      );
      expect(combined).toContain("schema validation FAILED");
      expect(combined.toLowerCase()).toContain("educational");
    });
  });
});
