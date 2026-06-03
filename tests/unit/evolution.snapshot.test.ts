/**
 * Snapshot test (R5): the evolution classifier must map narrative text to a
 * deterministic progression label (Improving / Stable / Worsening /
 * Inconclusive / SingleSeries) — identical inputs always yield identical output.
 */
import { describe, it, expect } from "@jest/globals";
import type { GenerativeModel } from "@google/generative-ai";
import { createGeminiClient } from "../../src/infrastructure/gemini-client.js";
import { DISCLAIMER } from "../../src/domain/types.js";
import type { SeriesSummary } from "../../src/domain/types.js";

function mockModel(responseText: string): GenerativeModel {
  return {
    generateContent: async () => ({ response: { text: () => responseText } }),
  } as unknown as GenerativeModel;
}

function summary(seriesId: string): SeriesSummary {
  return {
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
    report: `report ${seriesId}`,
    processedAt: "2026-01-01T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

const cases: Array<[name: string, text: string, expected: string]> = [
  ["improving narrative", "Overall the lesion is improving across sessions.", "Improving"],
  ["worsening narrative", "Findings are worsening; the mass has enlarged.", "Worsening"],
  ["stable narrative", "The appearance is stable with no interval change.", "Stable"],
  ["ambiguous narrative", "Mixed and unclear; further imaging advised.", "Inconclusive"],
];

describe("evolution classifier (deterministic snapshot)", () => {
  for (const [name, text, expected] of cases) {
    it(`classifies ${name} as ${expected} (and is stable across runs)`, async () => {
      const client = createGeminiClient(mockModel(text));
      const first = await client.analyzeEvolution([summary("s1"), summary("s2")], undefined);
      const second = await client.analyzeEvolution([summary("s1"), summary("s2")], undefined);

      expect(first.progression).toBe(expected);
      expect(second.progression).toBe(first.progression); // determinism
      expect({ progression: first.progression }).toMatchSnapshot();
    });
  }

  it("returns SingleSeries (no classification) for a single series", async () => {
    const client = createGeminiClient(mockModel("anything"));
    const result = await client.analyzeEvolution([summary("s1")], undefined);
    expect(result.progression).toBe("SingleSeries");
  });
});
