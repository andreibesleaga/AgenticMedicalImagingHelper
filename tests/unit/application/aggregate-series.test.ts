import { describe, it, expect, jest, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { aggregateSeriesUseCase } from "../../../src/application/aggregate-series.use-case.js";
import type { GraphState, ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";
import type { GeminiClient } from "../../../src/infrastructure/gemini-client.js";
import { DISCLAIMER } from "../../../src/domain/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = jest.Mock<(...args: any[]) => Promise<any>>;

function makeSynthFn(...returnValues: SeriesSummary[]): AnyMock {
  const fn: AnyMock = jest.fn();
  if (returnValues.length === 1) {
    fn.mockResolvedValue(returnValues[0]);
  } else {
    for (const v of returnValues) {
      fn.mockResolvedValueOnce(v);
    }
  }
  return fn;
}

function makeMockClient(synthesizeFn?: AnyMock): GeminiClient {
  const synthFn: AnyMock = synthesizeFn ?? jest.fn();
  return {
    analyzeImage: jest.fn() as AnyMock,
    synthesizeSeries: synthFn,
    analyzeEvolution: jest.fn() as AnyMock,
  } as unknown as GeminiClient;
}

function makeImageAnalysis(
  imagePath: string,
  seriesId: string,
  status: "success" | "error" = "success"
): ImageAnalysis {
  return {
    imagePath,
    seriesId,
    status,
    modality: "CT",
    anatomyRegion: "Chest",
    findings: ["clear lungs"],
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

function makeSeriesSummary(seriesId: string): SeriesSummary {
  return {
    seriesId,
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: ["clear lungs"],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: `Report for ${seriesId}`,
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("aggregateSeriesUseCase", () => {
  let tmpDir: string;
  let contextFile: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agg-test-"));
    contextFile = path.join(tmpDir, "context.txt");
    await fs.writeFile(contextFile, "Patient has COPD. History of smoking.", "utf-8");
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when imageResults is empty", async () => {
    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [],
      imageResults: [],
      seriesResults: [],
    };
    const client = makeMockClient();
    const result = await aggregateSeriesUseCase(state, client);
    expect(result).toEqual([]);
    expect(client.synthesizeSeries).not.toHaveBeenCalled();
  });

  it("calls synthesizeSeries once per unique seriesId", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_1"), makeSeriesSummary("series_2"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [
        { seriesId: "series_1", imagePaths: ["/tmp/a.png"] },
        { seriesId: "series_2", imagePaths: ["/tmp/b.png"] },
      ],
      imageResults: [
        makeImageAnalysis("/tmp/a.png", "series_1"),
        makeImageAnalysis("/tmp/b.png", "series_2"),
      ],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    const result = await aggregateSeriesUseCase(state, client);

    expect(result).toHaveLength(2);
    expect(synthFn).toHaveBeenCalledTimes(2);
  });

  it("groups multiple images from the same series together", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_1"));

    const img1 = makeImageAnalysis("/tmp/img1.png", "series_1");
    const img2 = makeImageAnalysis("/tmp/img2.png", "series_1");
    const img3 = makeImageAnalysis("/tmp/img3.png", "series_1");

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [{ seriesId: "series_1", imagePaths: ["/tmp/img1.png", "/tmp/img2.png", "/tmp/img3.png"] }],
      imageResults: [img1, img2, img3],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    await aggregateSeriesUseCase(state, client);

    expect(synthFn).toHaveBeenCalledTimes(1);
    const [, analyses] = synthFn.mock.calls[0] as [string, ImageAnalysis[], string | undefined];
    expect(analyses).toHaveLength(3);
  });

  it("reads context file and passes it to synthesizeSeries", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_1"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [{ seriesId: "series_1", imagePaths: ["/tmp/a.png"], textContextPath: contextFile }],
      imageResults: [makeImageAnalysis("/tmp/a.png", "series_1")],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    await aggregateSeriesUseCase(state, client);

    const [, , textContext] = synthFn.mock.calls[0] as [string, ImageAnalysis[], string | undefined];
    expect(textContext).toBe("Patient has COPD. History of smoking.");
  });

  it("passes undefined textContext when no textContextPath", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_1"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [{ seriesId: "series_1", imagePaths: ["/tmp/a.png"] }],
      imageResults: [makeImageAnalysis("/tmp/a.png", "series_1")],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    await aggregateSeriesUseCase(state, client);

    const [, , textContext] = synthFn.mock.calls[0] as [string, ImageAnalysis[], string | undefined];
    expect(textContext).toBeUndefined();
  });

  it("proceeds without context when context file is unreadable", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_1"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [{ seriesId: "series_1", imagePaths: ["/tmp/a.png"], textContextPath: "/nonexistent/context.txt" }],
      imageResults: [makeImageAnalysis("/tmp/a.png", "series_1")],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    const result = await aggregateSeriesUseCase(state, client);

    // Should not throw — graceful degradation
    expect(result).toHaveLength(1);
    const [, , textContext] = synthFn.mock.calls[0] as [string, ImageAnalysis[], string | undefined];
    expect(textContext).toBeUndefined();
  });

  it("passes correct seriesId to synthesizeSeries", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("series_abc"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [{ seriesId: "series_abc", imagePaths: ["/tmp/a.png"] }],
      imageResults: [makeImageAnalysis("/tmp/a.png", "series_abc")],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    await aggregateSeriesUseCase(state, client);

    const [seriesId] = synthFn.mock.calls[0] as [string, ImageAnalysis[], string | undefined];
    expect(seriesId).toBe("series_abc");
  });

  it("returns summaries from synthesizeSeries in order", async () => {
    const synthFn = makeSynthFn(makeSeriesSummary("s1"), makeSeriesSummary("s2"));

    const state: GraphState = {
      inputDir: "/tmp/in",
      outputDir: "/tmp/out",
      series: [
        { seriesId: "s1", imagePaths: ["/tmp/a.png"] },
        { seriesId: "s2", imagePaths: ["/tmp/b.png"] },
      ],
      imageResults: [
        makeImageAnalysis("/tmp/a.png", "s1"),
        makeImageAnalysis("/tmp/b.png", "s2"),
      ],
      seriesResults: [],
    };

    const client = makeMockClient(synthFn);
    const result = await aggregateSeriesUseCase(state, client);

    expect(result[0].seriesId).toBe("s1");
    expect(result[1].seriesId).toBe("s2");
  });
});
