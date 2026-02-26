import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { GraphState, SeriesSummary, TemporalAnalysis, AnalyzeOptions } from "../../../src/domain/types.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { GeminiClient } from "../../../src/infrastructure/gemini-client.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = jest.Mock<(...args: any[]) => Promise<any>>;

function makeSeriesSummary(seriesId: string): SeriesSummary {
  return {
    seriesId,
    imageCount: 2,
    successCount: 2,
    failureCount: 0,
    consistentFindings: [],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: `Series report for ${seriesId}`,
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

function makeTemporal(): TemporalAnalysis {
  return {
    seriesCount: 1,
    seriesIds: ["s1"],
    progression: "SingleSeries",
    trends: [],
    forecastedEvolution: "Stable.",
    treatmentRecommendations: [],
    combinedReport: "Combined report.",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runMedicalImagingAgent", () => {
  let mockClient: GeminiClient;
  let analyzeFn: AnyMock;
  let synthFn: AnyMock;
  let evolutionFn: AnyMock;

  beforeEach(() => {
    analyzeFn = jest.fn();
    synthFn = jest.fn();
    evolutionFn = jest.fn();

    const imageResult = {
      imagePath: "/tmp/in/s1/img.png",
      seriesId: "s1",
      status: "success" as const,
      rawResponse: "Image analysis",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
    analyzeFn.mockResolvedValue(imageResult);
    synthFn.mockResolvedValue(makeSeriesSummary("s1"));
    evolutionFn.mockResolvedValue(makeTemporal());

    mockClient = {
      analyzeImage: analyzeFn,
      synthesizeSeries: synthFn,
      analyzeEvolution: evolutionFn,
    } as unknown as GeminiClient;
  });

  it("returns a GraphState with evolutionResult populated", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    const result: GraphState = await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [
        {
          seriesId: "s1",
          imagePaths: ["/tmp/in/s1/img.png"],
          textContextPath: undefined,
        },
      ],
      mockClient,
      options
    );

    expect(result.evolutionResult).toBeDefined();
    expect(result.evolutionResult?.progression).toBe("SingleSeries");
  });

  it("calls analyzeImage for each image path", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    const imgResult = (imgPath: string) => ({
      imagePath: imgPath,
      seriesId: "s1",
      status: "success" as const,
      rawResponse: "ok",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    });
    analyzeFn.mockResolvedValueOnce(imgResult("/tmp/in/s1/img1.png"));
    analyzeFn.mockResolvedValueOnce(imgResult("/tmp/in/s1/img2.png"));

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [
        {
          seriesId: "s1",
          imagePaths: ["/tmp/in/s1/img1.png", "/tmp/in/s1/img2.png"],
        },
      ],
      mockClient,
      options
    );

    expect(analyzeFn).toHaveBeenCalledTimes(2);
    expect(analyzeFn).toHaveBeenCalledWith("/tmp/in/s1/img1.png", "s1");
    expect(analyzeFn).toHaveBeenCalledWith("/tmp/in/s1/img2.png", "s1");
  });

  it("calls synthesizeSeries once per series", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    synthFn.mockResolvedValueOnce(makeSeriesSummary("s1"));
    synthFn.mockResolvedValueOnce(makeSeriesSummary("s2"));

    const s2Analysis = {
      imagePath: "/tmp/in/s2/img.png",
      seriesId: "s2",
      status: "success" as const,
      rawResponse: "ok",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
    analyzeFn.mockResolvedValueOnce({
      imagePath: "/tmp/in/s1/img.png",
      seriesId: "s1",
      status: "success" as const,
      rawResponse: "ok",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    });
    analyzeFn.mockResolvedValueOnce(s2Analysis);

    evolutionFn.mockResolvedValue({
      ...makeTemporal(),
      seriesCount: 2,
      seriesIds: ["s1", "s2"],
      progression: "Stable",
    });

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [
        { seriesId: "s1", imagePaths: ["/tmp/in/s1/img.png"] },
        { seriesId: "s2", imagePaths: ["/tmp/in/s2/img.png"] },
      ],
      mockClient,
      options
    );

    expect(synthFn).toHaveBeenCalledTimes(2);
  });

  it("calls analyzeEvolution once with all series summaries", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [{ seriesId: "s1", imagePaths: ["/tmp/in/s1/img.png"] }],
      mockClient,
      options
    );

    expect(evolutionFn).toHaveBeenCalledTimes(1);
  });

  it("populates imageResults in returned state", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    const result = await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [{ seriesId: "s1", imagePaths: ["/tmp/in/s1/img.png"] }],
      mockClient,
      options
    );

    expect(result.imageResults).toHaveLength(1);
    expect(result.imageResults[0].seriesId).toBe("s1");
  });

  it("populates seriesResults in returned state", async () => {
    const { runMedicalImagingAgent } = await import(
      "../../../src/adapters/langgraph-agent.js"
    );

    const options: AnalyzeOptions = { concurrency: 2, verbose: false };
    const result = await runMedicalImagingAgent(
      "/tmp/in",
      "/tmp/out",
      [{ seriesId: "s1", imagePaths: ["/tmp/in/s1/img.png"] }],
      mockClient,
      options
    );

    expect(result.seriesResults).toHaveLength(1);
    expect(result.seriesResults[0].seriesId).toBe("s1");
  });
});
