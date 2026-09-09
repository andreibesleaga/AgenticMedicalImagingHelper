/**
 * Progression fallback when the evolution response fails schema validation
 * (qualitative review of the E4 cohort, §d.3).
 *
 * Schema validation is all-or-nothing; a model response is not. The pipeline
 * used to throw away a *valid* `progression` the model had written because some
 * other field of the same object was malformed, and replace it with a keyword
 * scan over the whole blob — which reads per-trend detail strings and so
 * systematically converted `Inconclusive` into a directional label exactly
 * where the model was least sure. Both machine-readable "Worsening" labels
 * produced this way in the E4 cohort were wrong about what the model concluded.
 *
 * Covered here: the golden rule-(a) path, the rule-(b) keyword path with
 * uncertainty precedence, the recorded rule string (c), and the edges — no
 * JSON, non-enum value, wrong type, empty text — plus the E4 00000008
 * regression driven through the real client.
 */
import { describe, it, expect, jest } from "@jest/globals";
import type { GenerativeModel } from "@google/generative-ai";
import {
  createGeminiClient,
  resolveProgressionFallback,
} from "../../../src/infrastructure/gemini-client.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { SeriesSummary } from "../../../src/domain/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMockFn = jest.Mock<any>;

function modelReturning(text: string): GenerativeModel {
  const mockFn: AnyMockFn = jest.fn();
  mockFn.mockResolvedValue({ response: { text: () => text } });
  return { generateContent: mockFn } as unknown as GenerativeModel;
}

const summary = (seriesId: string): SeriesSummary => ({
  seriesId,
  imageCount: 1,
  successCount: 1,
  failureCount: 0,
  consistentFindings: [],
  discrepancies: [],
  primaryDiagnosis: "Normal chest",
  differentialDiagnoses: [],
  confidenceLevel: "High",
  textContextUsed: false,
  report: `Report for ${seriesId}`,
  processedAt: "2026-09-08T00:00:00.000Z",
  disclaimer: DISCLAIMER,
});

const twoSummaries = [summary("series_1"), summary("series_2")];

/**
 * Patient 00000008 / google_gemini-2.5-flash, reduced to the shape that matters:
 * the object is valid JSON, its top-level `progression` is `Inconclusive`, one
 * `trends[i].trend` is outside the enum (so Zod rejects the whole record), and
 * the word "Worsening" appears inside a per-trend detail string.
 */
const E4_00000008_RAW = JSON.stringify(
  {
    progression: "Inconclusive",
    trends: [
      {
        finding: "Cardiac position",
        trend: "Worsening",
        details:
          "Series 2 reports dextrocardia. Series 3 states cardiomediastinal contours are within " +
          "normal limits, which contradicts Series 2. This suggests either a misinterpretation " +
          "in Series 2 or an imaging artifact, making a clear trend difficult to establish.",
      },
      { finding: "Implantable cardiac device", trend: "Stable", details: "Likely still present." },
      { finding: "Extraneous objects", trend: "Inconclusive", details: "Unclear across sessions." },
    ],
    forecastedEvolution: "Unclear without prior imaging.",
    treatmentRecommendations: [],
    combinedReport: "## Temporal Evolution\n\nA clear trend cannot be established.",
  },
  null,
  2
);

// ─── resolveProgressionFallback ──────────────────────────────────────────────

describe("resolveProgressionFallback — rule (a): the model's own partial JSON", () => {
  it("takes a valid progression out of an otherwise invalid record", () => {
    expect(resolveProgressionFallback(E4_00000008_RAW)).toEqual({
      progression: "Inconclusive",
      issue: 'progression: taken from partial JSON ("Inconclusive")',
    });
  });

  it("takes each of the four enum values", () => {
    for (const label of ["Improving", "Stable", "Worsening", "Inconclusive"] as const) {
      expect(resolveProgressionFallback(JSON.stringify({ progression: label })).progression).toBe(
        label
      );
    }
  });

  it("accepts the model's own casing and padding", () => {
    expect(resolveProgressionFallback('{"progression": "  worsening  "}')).toEqual({
      progression: "Worsening",
      issue: 'progression: taken from partial JSON ("Worsening")',
    });
  });

  it("reads through a ```json fence and a preamble", () => {
    const raw = 'Here is the analysis:\n```json\n{"progression":"Improving","trends":-1}\n```';
    expect(resolveProgressionFallback(raw).progression).toBe("Improving");
  });
});

describe("resolveProgressionFallback — rule (b): keyword scan", () => {
  it("falls back when the response carries no JSON at all", () => {
    expect(resolveProgressionFallback("Progression: Stable — no interval change.")).toEqual({
      progression: "Stable",
      issue: 'progression: keyword fallback ("Stable")',
    });
  });

  it("falls back when the JSON progression is not one of the four labels", () => {
    const raw = JSON.stringify({
      progression: "SingleSeries",
      combinedReport: "Worsening overall",
    });
    expect(resolveProgressionFallback(raw)).toEqual({
      progression: "Worsening",
      issue: 'progression: keyword fallback ("Worsening")',
    });
  });

  it("falls back when the JSON progression is not a string (gemma's -1 sentinel)", () => {
    const raw = JSON.stringify({ progression: -1, trends: [], combinedReport: -1 });
    expect(resolveProgressionFallback(raw).progression).toBe("Inconclusive");
    expect(resolveProgressionFallback(raw).issue).toContain("keyword fallback");
  });

  it("lets an explicit 'inconclusive' beat a directional keyword", () => {
    const raw = "The findings are worsening in one region but the comparison is inconclusive.";
    expect(resolveProgressionFallback(raw).progression).toBe("Inconclusive");
  });

  it("lets a statement of limited comparability beat a directional keyword", () => {
    for (const prose of [
      "Series 2 shows worsening opacity, but limited comparability between the studies.",
      "Improving in part, though it is difficult to establish a clear trend.",
      "Worsening cannot be determined from these images.",
      "Improving or worsening — insufficient data to say.",
      "Worsening in one lobe; there is no clear trend overall.",
      "Improving appearances, but the progression remains unclear.",
      "Worsening was considered; we are unable to determine the direction.",
    ]) {
      expect(resolveProgressionFallback(prose).progression).toBe("Inconclusive");
    }
  });

  it("still classifies confidently-directional prose", () => {
    expect(resolveProgressionFallback("Improving on every measure.").progression).toBe("Improving");
    expect(resolveProgressionFallback("Worsening consolidation.").progression).toBe("Worsening");
    expect(resolveProgressionFallback("Stable appearances.").progression).toBe("Stable");
  });

  it("returns Inconclusive for text with no signal, and for no text", () => {
    expect(resolveProgressionFallback("No comment.").progression).toBe("Inconclusive");
    expect(resolveProgressionFallback("").progression).toBe("Inconclusive");
    expect(resolveProgressionFallback(undefined).progression).toBe("Inconclusive");
  });
});

// ─── Through the client ──────────────────────────────────────────────────────

describe("analyzeEvolution — recorded fallback rule (c)", () => {
  it("keeps the model's own Inconclusive for the E4 00000008 record", async () => {
    const client = createGeminiClient(modelReturning(E4_00000008_RAW));
    const result = await client.analyzeEvolution(twoSummaries, undefined);

    // The keyword scan would have said "Worsening" (it is the first directional
    // keyword in the blob, inside trends[0].details).
    expect(result.progression).toBe("Inconclusive");
    expect(result.validation?.ok).toBe(false);
    expect(result.validation?.issues).toContain(
      'progression: taken from partial JSON ("Inconclusive")'
    );
    // The schema failure that caused the fallback is still recorded.
    expect(result.validation?.issues?.[0]).toMatch(/trends\.\d+\.trend/);
    expect(result.combinedReport).toBe(E4_00000008_RAW);
  });

  it("records the keyword rule when there is no usable JSON progression", async () => {
    const client = createGeminiClient(modelReturning("Progression: Worsening across sessions."));
    const result = await client.analyzeEvolution(twoSummaries, undefined);

    expect(result.progression).toBe("Worsening");
    expect(result.validation?.issues).toContain('progression: keyword fallback ("Worsening")');
  });

  it("records exactly one progression-rule issue, appended after the schema issues", async () => {
    const client = createGeminiClient(modelReturning(E4_00000008_RAW));
    const issues =
      (await client.analyzeEvolution(twoSummaries, undefined)).validation?.issues ?? [];

    const ruleIssues = issues.filter((i) => i.startsWith("progression: "));
    expect(ruleIssues).toHaveLength(1);
    expect(issues[issues.length - 1]).toBe(ruleIssues[0]);
  });

  it("records no fallback rule when the response validates cleanly", async () => {
    const valid = JSON.stringify({
      progression: "Stable",
      trends: [],
      forecastedEvolution: "Unchanged.",
      treatmentRecommendations: [],
      combinedReport: "## Temporal Evolution",
    });
    const result = await createGeminiClient(modelReturning(valid)).analyzeEvolution(
      twoSummaries,
      undefined
    );

    expect(result.validation).toEqual({ ok: true });
    expect(result.progression).toBe("Stable");
  });

  it("degrades to Inconclusive when the call itself fails", async () => {
    const mockFn: AnyMockFn = jest.fn();
    mockFn.mockRejectedValue(new Error("API quota exceeded"));
    const client = createGeminiClient({ generateContent: mockFn } as unknown as GenerativeModel);

    const result = await client.analyzeEvolution(twoSummaries, undefined);
    expect(result.progression).toBe("Inconclusive");
    expect(result.validation).toBeUndefined();
  });
});
