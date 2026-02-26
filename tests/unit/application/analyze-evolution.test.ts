import { describe, it, expect, jest } from "@jest/globals";
import { analyzeEvolutionUseCase } from "../../../src/application/analyze-evolution.use-case.js";
import type { GraphState, SeriesSummary, TemporalAnalysis } from "../../../src/domain/types.js";
import type { GeminiClient } from "../../../src/infrastructure/gemini-client.js";
import { DISCLAIMER } from "../../../src/domain/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = jest.Mock<(...args: any[]) => Promise<any>>;

function makeEvolutionFn(returnValue: TemporalAnalysis): AnyMock {
  const fn: AnyMock = jest.fn();
  fn.mockResolvedValue(returnValue);
  return fn;
}

function makeMockClient(evolutionFn?: AnyMock): GeminiClient {
  const fn: AnyMock = evolutionFn ?? jest.fn();
  return {
    analyzeImage: jest.fn() as AnyMock,
    synthesizeSeries: jest.fn() as AnyMock,
    analyzeEvolution: fn,
  } as unknown as GeminiClient;
}

function makeSeriesSummary(seriesId: string): SeriesSummary {
  return {
    seriesId,
    imageCount: 2,
    successCount: 2,
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

function makeTemporal(progression: TemporalAnalysis["progression"] = "Stable"): TemporalAnalysis {
  return {
    seriesCount: 2,
    seriesIds: ["s1", "s2"],
    progression,
    trends: [],
    forecastedEvolution: "Stable condition expected.",
    treatmentRecommendations: ["Continue current treatment"],
    combinedReport: "Combined report.",
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    inputDir: "/tmp/in",
    outputDir: "/tmp/out",
    series: [],
    imageResults: [],
    seriesResults: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("analyzeEvolutionUseCase", () => {
  it("calls analyzeEvolution with seriesResults and root context", async () => {
    const temporal = makeTemporal("Improving");
    const evolutionFn = makeEvolutionFn(temporal);
    const summaries = [makeSeriesSummary("s1"), makeSeriesSummary("s2")];

    const state = makeState({ seriesResults: summaries });
    const result = await analyzeEvolutionUseCase(state, makeMockClient(evolutionFn));

    expect(evolutionFn).toHaveBeenCalledTimes(1);
    expect(evolutionFn).toHaveBeenCalledWith(summaries, undefined);
    expect(result).toEqual(temporal);
  });

  it("passes root-level text context when provided", async () => {
    const temporal = makeTemporal();
    const evolutionFn = makeEvolutionFn(temporal);

    const state = makeState({
      seriesResults: [makeSeriesSummary("s1")],
      // Root context is carried in the options and stored in state
    });
    // Simulate root context being injected via optional field
    (state as GraphState & { rootContextText?: string }).rootContextText =
      "Patient has documented COPD since 2020.";

    const result = await analyzeEvolutionUseCase(state, makeMockClient(evolutionFn));

    const [, rootContext] = evolutionFn.mock.calls[0] as [SeriesSummary[], string | undefined];
    expect(rootContext).toBe("Patient has documented COPD since 2020.");
    expect(result).toEqual(temporal);
  });

  it("returns the TemporalAnalysis from analyzeEvolution", async () => {
    const temporal = makeTemporal("Worsening");
    const evolutionFn = makeEvolutionFn(temporal);

    const state = makeState({ seriesResults: [makeSeriesSummary("s1"), makeSeriesSummary("s2")] });
    const result = await analyzeEvolutionUseCase(state, makeMockClient(evolutionFn));

    expect(result.progression).toBe("Worsening");
    expect(result.seriesCount).toBe(2);
  });

  it("works with a single series (SingleSeries progression path)", async () => {
    const temporal: TemporalAnalysis = {
      seriesCount: 1,
      seriesIds: ["s1"],
      progression: "SingleSeries",
      trends: [],
      forecastedEvolution: "Only one series — no temporal comparison available.",
      treatmentRecommendations: [],
      combinedReport: "Single series report.",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
    const evolutionFn = makeEvolutionFn(temporal);

    const state = makeState({ seriesResults: [makeSeriesSummary("s1")] });
    const result = await analyzeEvolutionUseCase(state, makeMockClient(evolutionFn));

    expect(result.progression).toBe("SingleSeries");
  });

  it("works with empty seriesResults (edge case)", async () => {
    const temporal: TemporalAnalysis = {
      seriesCount: 0,
      seriesIds: [],
      progression: "Inconclusive",
      trends: [],
      forecastedEvolution: "No data.",
      treatmentRecommendations: [],
      combinedReport: "",
      processedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
    const evolutionFn = makeEvolutionFn(temporal);

    const state = makeState({ seriesResults: [] });
    const result = await analyzeEvolutionUseCase(state, makeMockClient(evolutionFn));

    expect(result.seriesCount).toBe(0);
    expect(evolutionFn).toHaveBeenCalledWith([], undefined);
  });
});
