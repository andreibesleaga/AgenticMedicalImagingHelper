/**
 * Property test (R5): the fan-out node must never exceed the configured
 * `p-limit(concurrency)` cap, regardless of how many images are queued.
 */
import { describe, it, expect } from "@jest/globals";
import { runMedicalImagingAgent } from "../../src/adapters/langgraph-agent.js";
import { DISCLAIMER } from "../../src/domain/types.js";
import type {
  AnalyzeOptions,
  ImageAnalysis,
  SeriesInfo,
  SeriesSummary,
  TemporalAnalysis,
} from "../../src/domain/types.js";
import type { GeminiClient } from "../../src/infrastructure/gemini-client.js";

// A client that tracks how many analyzeImage calls are in flight at once.
function makeTrackingClient(): { client: GeminiClient; getMaxInFlight: () => number } {
  let inFlight = 0;
  let maxInFlight = 0;

  const analyzeImage = async (imagePath: string, seriesId: string): Promise<ImageAnalysis> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield to the event loop so concurrent calls actually overlap.
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return {
      imagePath,
      seriesId,
      status: "success",
      rawResponse: "ok",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
  };

  const synthesizeSeries = async (seriesId: string): Promise<SeriesSummary> => ({
    seriesId,
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: [],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: "report",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  });

  const analyzeEvolution = async (summaries: SeriesSummary[]): Promise<TemporalAnalysis> => ({
    seriesCount: summaries.length,
    seriesIds: summaries.map((s) => s.seriesId),
    progression: "Stable",
    trends: [],
    forecastedEvolution: "",
    treatmentRecommendations: [],
    combinedReport: "combined",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  });

  const client: GeminiClient = { analyzeImage, synthesizeSeries, analyzeEvolution };
  return { client, getMaxInFlight: () => maxInFlight };
}

function manyImagesSeries(imageCount: number): SeriesInfo[] {
  return [
    {
      seriesId: "s1",
      imagePaths: Array.from({ length: imageCount }, (_, i) => `/tmp/in/s1/img${i}.png`),
    },
  ];
}

describe("p-limit concurrency cap (property)", () => {
  for (const concurrency of [1, 2, 3, 5]) {
    it(`never exceeds ${concurrency} in-flight analyzeImage calls`, async () => {
      const { client, getMaxInFlight } = makeTrackingClient();
      const options: AnalyzeOptions = { concurrency, verbose: false };

      await runMedicalImagingAgent("/tmp/in", "/tmp/out", manyImagesSeries(12), client, options);

      expect(getMaxInFlight()).toBeGreaterThan(0);
      expect(getMaxInFlight()).toBeLessThanOrEqual(concurrency);
    });
  }
});
