/**
 * Runtime validation of model output (paper §III-A/B/C).
 *
 * Covers the three stage schemas and the fence/preamble-tolerant JSON reader
 * that feeds them: a golden path per stage (the committed mock responses under
 * `tests/fixtures/mock-responses/`), the shapes a model realistically returns
 * instead (fenced, prefixed, truncated, wrong types, empty), and the exact
 * issue strings recorded in the artefacts when validation fails.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { z } from "zod";
import {
  extractJsonObject,
  parseStructured,
  stripJsonFence,
  validationOutcome,
} from "../../../src/domain/structured-output.js";
import {
  AbnormalitySchema,
  ParsedEvolutionResponseSchema,
  ParsedImageResponseSchema,
  ParsedSeriesResponseSchema,
  TrendItemSchema,
} from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const MOCKS = path.resolve(__dirname, "../../fixtures/mock-responses");
const mock = (name: string): string => fs.readFileSync(path.join(MOCKS, name), "utf-8");

// ─── stripJsonFence ──────────────────────────────────────────────────────────

describe("stripJsonFence", () => {
  it("removes a ```json fence", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("removes an unlabelled ``` fence", () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves unfenced text alone (trimmed)", () => {
    expect(stripJsonFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("leaves an unterminated fence alone", () => {
    expect(stripJsonFence('```json\n{"a":1}')).toBe('```json\n{"a":1}');
  });
});

// ─── extractJsonObject ───────────────────────────────────────────────────────

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"modality":"CT"}')).toEqual({ modality: "CT" });
  });

  it("parses a fenced object", () => {
    expect(extractJsonObject('```json\n{"modality":"CT"}\n```')).toEqual({ modality: "CT" });
  });

  it("recovers an object wrapped in prose (widest brace slice)", () => {
    const text = 'Here is the analysis:\n{"modality":"CT","findings":["a"]}\nHope that helps.';
    expect(extractJsonObject(text)).toEqual({ modality: "CT", findings: ["a"] });
  });

  it("returns undefined for Markdown with no JSON at all", () => {
    expect(extractJsonObject("### 1. Image Type\n- Modality: X-ray")).toBeUndefined();
  });

  it("recovers the object from a single-element JSON array (arrays are not accepted as-is)", () => {
    expect(extractJsonObject('[{"modality":"CT"}]')).toEqual({ modality: "CT" });
  });

  it("returns undefined for an array of scalars (no object anywhere)", () => {
    expect(extractJsonObject("[1,2,3]")).toBeUndefined();
  });

  it("returns undefined for JSON `null`", () => {
    expect(extractJsonObject("null")).toBeUndefined();
  });

  it("returns undefined for truncated JSON", () => {
    expect(extractJsonObject('{"modality":"CT",')).toBeUndefined();
  });

  it("returns undefined for a brace slice that is still not JSON", () => {
    expect(extractJsonObject("prose { not json } more prose")).toBeUndefined();
  });
});

// ─── parseStructured ─────────────────────────────────────────────────────────

const Tiny = z.object({ a: z.string() });

describe("parseStructured", () => {
  it("returns the validated value on success", () => {
    const result = parseStructured('{"a":"x"}', Tiny);
    expect(result).toEqual({ ok: true, value: { a: "x" } });
  });

  it("reports an empty response", () => {
    expect(parseStructured("   ", Tiny)).toEqual({
      ok: false,
      issues: ["(root): empty model response"],
    });
  });

  it("reports an undefined response (no text at all)", () => {
    expect(parseStructured(undefined, Tiny)).toEqual({
      ok: false,
      issues: ["(root): empty model response"],
    });
  });

  it("reports a non-JSON response", () => {
    expect(parseStructured("just prose", Tiny)).toEqual({
      ok: false,
      issues: ["(root): response is not a JSON object"],
    });
  });

  it("reports schema issues as `path: message` pairs", () => {
    const result = parseStructured('{"a":42}', Tiny);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^a: /);
  });

  it("labels a root-level issue `(root)`", () => {
    const AtLeastSix = z.object({ a: z.string() }).refine((v) => v.a.length > 5, "a is too short");
    const result = parseStructured('{"a":"x"}', AtLeastSix);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toEqual(["(root): a is too short"]);
  });

  it("caps the number of recorded issues at 20", () => {
    const shape: Record<string, z.ZodString> = {};
    for (let i = 0; i < 30; i++) shape[`f${i}`] = z.string();
    const result = parseStructured("{}", z.object(shape));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toHaveLength(20);
  });
});

describe("validationOutcome", () => {
  it("renders success without issues", () => {
    expect(validationOutcome({ ok: true, value: 1 })).toEqual({ ok: true });
  });

  it("renders failure with its issues", () => {
    expect(validationOutcome({ ok: false, issues: ["a: bad"] })).toEqual({
      ok: false,
      issues: ["a: bad"],
    });
  });
});

// ─── Stage 1: image schema ───────────────────────────────────────────────────

describe("ParsedImageResponseSchema", () => {
  it("accepts the committed mock response and fills every paper-claimed field", () => {
    const result = parseStructured(mock("image-analysis-success.txt"), ParsedImageResponseSchema);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues.join("; "));
    expect(result.value.modality).toBe("X-ray");
    expect(result.value.anatomyRegion).toContain("Chest");
    expect(result.value.quality).toBe("Good");
    expect(result.value.findings.length).toBeGreaterThan(0);
    expect(result.value.abnormalities[0]).toEqual({
      name: "Mild basal atelectasis",
      description: expect.stringContaining("atelectasis"),
      severity: "Mild",
      confidence: 62,
    });
    expect(result.value.summary.length).toBeGreaterThan(0);
    expect(result.value.references).toHaveLength(2);
  });

  it("accepts the same payload inside a ```json fence", () => {
    const fenced = "```json\n" + mock("image-analysis-success.txt") + "\n```";
    const result = parseStructured(fenced, ParsedImageResponseSchema);
    expect(result.ok).toBe(true);
  });

  it("defaults the optional arrays when the model omits them", () => {
    const result = parseStructured(
      '{"modality":"MRI","anatomyRegion":"Brain","quality":"Fair","summary":"Looks unremarkable."}',
      ParsedImageResponseSchema
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.findings).toEqual([]);
    expect(result.value.abnormalities).toEqual([]);
    expect(result.value.references).toEqual([]);
  });

  it("rejects a missing required field", () => {
    const result = parseStructured(
      '{"anatomyRegion":"Brain","quality":"Fair","summary":"x"}',
      ParsedImageResponseSchema
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.join(" ")).toMatch(/modality/);
  });

  it("rejects an empty-string modality and an out-of-range quality enum", () => {
    const bad = parseStructured(
      '{"modality":"","anatomyRegion":"Brain","quality":"Excellentish","summary":"x"}',
      ParsedImageResponseSchema
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("unreachable");
    expect(bad.issues.join(" ")).toMatch(/modality/);
    expect(bad.issues.join(" ")).toMatch(/quality/);
  });

  it("rejects a findings array of the wrong element type", () => {
    const result = parseStructured(
      '{"modality":"CT","anatomyRegion":"Chest","quality":"Good","summary":"x","findings":[1,2]}',
      ParsedImageResponseSchema
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.join(" ")).toMatch(/findings\.0/);
  });
});

describe("AbnormalitySchema", () => {
  it("defaults a missing name", () => {
    const parsed = AbnormalitySchema.safeParse({
      severity: "Moderate",
      confidence: 50,
      description: "d",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe("Unnamed finding");
  });

  it("rejects confidence outside 0–100 and unknown severities", () => {
    expect(
      AbnormalitySchema.safeParse({
        name: "n",
        severity: "Moderate",
        confidence: 140,
        description: "d",
      }).success
    ).toBe(false);
    expect(
      AbnormalitySchema.safeParse({
        name: "n",
        severity: "Critical",
        confidence: 10,
        description: "d",
      }).success
    ).toBe(false);
  });

  it("accepts the boundary confidences 0 and 100", () => {
    for (const confidence of [0, 100]) {
      expect(
        AbnormalitySchema.safeParse({
          name: "n",
          severity: "Normal",
          confidence,
          description: "d",
        }).success
      ).toBe(true);
    }
  });
});

// ─── Stage 2: series schema ──────────────────────────────────────────────────

describe("ParsedSeriesResponseSchema", () => {
  it("accepts the committed mock response", () => {
    const result = parseStructured(mock("series-synthesis.txt"), ParsedSeriesResponseSchema);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues.join("; "));
    expect(result.value.consistentFindings.length).toBeGreaterThan(0);
    expect(result.value.discrepancies.length).toBeGreaterThan(0);
    expect(result.value.primaryDiagnosis).toContain("Normal chest radiograph");
    expect(result.value.differentialDiagnoses).toEqual([
      "Subsegmental atelectasis",
      "Early basal infiltrate",
    ]);
    expect(result.value.confidenceLevel).toBe("High");
    expect(result.value.report).toContain("Series Synthesis");
  });

  it("defaults the list fields when omitted", () => {
    const result = parseStructured(
      '{"primaryDiagnosis":"Normal","confidenceLevel":"Low","report":"# r"}',
      ParsedSeriesResponseSchema
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.consistentFindings).toEqual([]);
    expect(result.value.discrepancies).toEqual([]);
    expect(result.value.differentialDiagnoses).toEqual([]);
  });

  it("rejects an unknown confidence level and a missing report", () => {
    const result = parseStructured(
      '{"primaryDiagnosis":"Normal","confidenceLevel":"Very high"}',
      ParsedSeriesResponseSchema
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.join(" ")).toMatch(/confidenceLevel/);
    expect(result.issues.join(" ")).toMatch(/report/);
  });
});

// ─── Stage 3: evolution schema ───────────────────────────────────────────────

describe("ParsedEvolutionResponseSchema", () => {
  it("accepts the committed mock response with trends, forecast and suggestions", () => {
    const result = parseStructured(mock("evolution-analysis.txt"), ParsedEvolutionResponseSchema);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues.join("; "));
    expect(result.value.progression).toBe("Stable");
    expect(result.value.trends).toHaveLength(2);
    expect(result.value.trends[0]).toEqual({
      finding: "Left basal atelectasis",
      trend: "Stable",
      details: expect.stringContaining("Unchanged"),
    });
    expect(result.value.forecastedEvolution).toContain("unchanged");
    expect(result.value.treatmentRecommendations).toHaveLength(2);
    expect(result.value.combinedReport).toContain("Temporal Evolution");
  });

  it("rejects `SingleSeries` — that label is derived by the pipeline, not the model", () => {
    const result = parseStructured(
      '{"progression":"SingleSeries","forecastedEvolution":"x","combinedReport":"y"}',
      ParsedEvolutionResponseSchema
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.join(" ")).toMatch(/progression/);
  });

  it("defaults trends and treatmentRecommendations when omitted", () => {
    const result = parseStructured(
      '{"progression":"Improving","forecastedEvolution":"x","combinedReport":"y"}',
      ParsedEvolutionResponseSchema
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.trends).toEqual([]);
    expect(result.value.treatmentRecommendations).toEqual([]);
  });

  it("rejects a malformed trend entry", () => {
    const result = parseStructured(
      '{"progression":"Stable","forecastedEvolution":"x","combinedReport":"y",' +
        '"trends":[{"finding":"a","trend":"Better"}]}',
      ParsedEvolutionResponseSchema
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.join(" ")).toMatch(/trends\.0\.trend/);
  });
});

describe("TrendItemSchema", () => {
  it("defaults empty details", () => {
    const parsed = TrendItemSchema.safeParse({ finding: "Nodule", trend: "Worsening" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.details).toBe("");
  });
});
