import { describe, it, expect, jest } from "@jest/globals";
import * as path from "path";
import * as url from "url";
import type { GenerativeModel } from "@google/generative-ai";
import * as fs from "fs";
import {
  createGeminiClient,
  createGeminiModelFromSdk,
  isJsonModeUnsupported,
  prepareImageForGemini,
  withJsonMode,
  JSON_GENERATION_CONFIG,
} from "../../../src/infrastructure/gemini-client.js";
import { CostMeter } from "../../../src/infrastructure/cost-meter.js";
import type { RetryAttemptInfo } from "../../../src/infrastructure/retry.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// Real 10×10 white PNG fixture — no sharp mock needed
const FIXTURE_IMAGE = path.resolve(__dirname, "../../fixtures/test_image.png");
const MOCKS = path.resolve(__dirname, "../../fixtures/mock-responses");
const mock = (name: string): string => fs.readFileSync(path.join(MOCKS, name), "utf-8");

/**
 * Every request now travels as a full `GenerateContentRequest` so JSON mode can
 * ride on `generationConfig`; these helpers read the prompt text and that config
 * back out of whatever shape the client sent.
 */
function promptTextOf(request: unknown): string {
  const req = request as { contents?: Array<{ parts: Array<{ text?: string }> }> };
  return (req.contents ?? [])
    .flatMap((c) => c.parts)
    .map((p) => p.text ?? "")
    .join("\n");
}

function generationConfigOf(request: unknown): { responseMimeType?: string } | undefined {
  return (request as { generationConfig?: { responseMimeType?: string } }).generationConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMockFn = jest.Mock<(...args: any[]) => Promise<{ response: { text: () => string } }>>;

interface MockModelResult {
  model: GenerativeModel;
  mockFn: AnyMockFn;
}

function makeMockModel(responseText: string): MockModelResult {
  const mockFn: AnyMockFn = jest.fn();
  mockFn.mockResolvedValue({ response: { text: () => responseText } });
  return {
    model: { generateContent: mockFn } as unknown as GenerativeModel,
    mockFn,
  };
}

const baseAnalysis: ImageAnalysis = {
  status: "success",
  imagePath: "/fake/img.png",
  seriesId: "series_1",
  rawResponse: "Analysis 1",
  processedAt: new Date().toISOString(),
  disclaimer: DISCLAIMER,
};

const baseSummary: SeriesSummary = {
  seriesId: "series_1",
  imageCount: 2,
  successCount: 2,
  failureCount: 0,
  consistentFindings: [],
  discrepancies: [],
  primaryDiagnosis: "Normal",
  differentialDiagnoses: [],
  confidenceLevel: "High",
  textContextUsed: false,
  report: "Summary",
  processedAt: new Date().toISOString(),
  disclaimer: DISCLAIMER,
};

const SAMPLE_IMAGE_ANALYSIS_RESPONSE = `
### 1. Image Type & Region
- Modality: X-ray
- Region: Chest (AP)
- Quality: Good

### 2. Key Findings
- Clear lung fields
- Normal cardiac silhouette

### 3. Diagnostic Assessment
- Primary: Normal chest X-ray (confidence: 90%)
- Differential: None significant

### 4. Patient-Friendly Explanation
Your chest X-ray looks normal overall.

### 5. Research Context
[Search results: standard chest X-ray interpretation]
`;

const SAMPLE_SERIES_RESPONSE = `
## Series Synthesis
- Primary Diagnosis: Normal
- Consistent Findings: Clear lung fields, normal cardiac silhouette
- Confidence: High
`;

const SAMPLE_EVOLUTION_RESPONSE = `
## Temporal Evolution
- Progression: Stable
- Trends: No significant change
- Forecast: Condition expected to remain stable
- Recommendations: Routine follow-up
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createGeminiClient", () => {
  describe("analyzeImage", () => {
    it("returns a successful ImageAnalysis on valid response", async () => {
      const { model } = makeMockModel(SAMPLE_IMAGE_ANALYSIS_RESPONSE);
      const client = createGeminiClient(model);

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("success");
      expect(result.seriesId).toBe("series_1");
      expect(result.imagePath).toBe(FIXTURE_IMAGE);
      expect(result.rawResponse).toContain("Chest");
      expect(result.disclaimer).toBe(DISCLAIMER);
      expect(result.processedAt).toBeTruthy();
    });

    it("calls generateContent with image inlineData", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_IMAGE_ANALYSIS_RESPONSE);
      const client = createGeminiClient(model);

      await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(mockFn).toHaveBeenCalledTimes(1);
      const callArg = mockFn.mock.calls[0]![0] as {
        contents: Array<{ parts: Array<Record<string, unknown>> }>;
      };
      const parts = callArg.contents[0]!.parts;
      const imagePart = parts.find((p) => p["inlineData"] !== undefined);
      expect(imagePart).toBeDefined();
    });

    it("returns status=error on API failure without throwing", async () => {
      const errorFn: AnyMockFn = jest.fn();
      errorFn.mockRejectedValue(new Error("API timeout"));
      const model = { generateContent: errorFn } as unknown as GenerativeModel;
      const client = createGeminiClient(model);

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("API timeout");
      expect(result.disclaimer).toBe(DISCLAIMER);
    });

    it("returns undefined modality and empty findings when response has no matching patterns", async () => {
      const { model } = makeMockModel("Plain unstructured response with no medical patterns.");
      const client = createGeminiClient(model);

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      // Covers null branches in extractModality, extractFindings, extractSummary
      expect(result.status).toBe("success");
      expect(result.modality).toBeUndefined();
      expect(result.findings).toEqual([]);
      expect(result.summary).toBeUndefined();
    });
  });

  describe("synthesizeSeries", () => {
    it("returns a SeriesSummary with report content", async () => {
      const { model } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);

      const result = await client.synthesizeSeries("series_1", [baseAnalysis], undefined);

      expect(result.seriesId).toBe("series_1");
      expect(result.report).toContain("Series Synthesis");
      expect(result.disclaimer).toBe(DISCLAIMER);
      expect(result.textContextUsed).toBe(false);
    });

    it("injects text context wrapped in <context> tags when provided", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);

      await client.synthesizeSeries("series_1", [baseAnalysis], "Patient has COPD");

      expect(mockFn).toHaveBeenCalledTimes(1);
      const callArg = promptTextOf(mockFn.mock.calls[0]![0]);
      expect(callArg).toContain("<context>");
      expect(callArg).toContain("Patient has COPD");
      expect(callArg).toContain("</context>");
    });

    it("truncates context to MAX_CONTEXT_LENGTH characters", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);
      const longContext = "X".repeat(5000);

      await client.synthesizeSeries("series_1", [baseAnalysis], longContext);

      const callArg = promptTextOf(mockFn.mock.calls[0]![0]);
      const contextMatch = callArg.match(/<context>([\s\S]*?)<\/context>/);
      expect(contextMatch).toBeTruthy();
      // Trim surrounding newlines before checking length; MAX_CONTEXT_LENGTH = 2000
      expect(contextMatch![1]!.trim().length).toBeLessThanOrEqual(2000);
    });

    it("marks textContextUsed=true when context is provided", async () => {
      const { model } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);

      const result = await client.synthesizeSeries("series_1", [baseAnalysis], "Some notes");
      expect(result.textContextUsed).toBe(true);
    });
  });

  describe("analyzeEvolution", () => {
    it("returns SingleSeries progression without API call when only one series", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_EVOLUTION_RESPONSE);
      const client = createGeminiClient(model);

      const result = await client.analyzeEvolution([baseSummary], undefined);

      expect(result.progression).toBe("SingleSeries");
      expect(result.seriesCount).toBe(1);
      expect(result.disclaimer).toBe(DISCLAIMER);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it("calls API and returns temporal analysis for multiple series", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_EVOLUTION_RESPONSE);
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = {
        ...baseSummary,
        seriesId: "series_2",
        primaryDiagnosis: "Resolving consolidation",
        report: "Summary 2",
      };

      const result = await client.analyzeEvolution([baseSummary, summary2], undefined);

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(result.seriesCount).toBe(2);
      expect(result.combinedReport).toContain("Temporal Evolution");
      expect(result.disclaimer).toBe(DISCLAIMER);
    });

    it("returns Stable progression when response contains 'stable'", async () => {
      const { model } = makeMockModel("Progression: Stable - no changes noted");
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = { ...baseSummary, seriesId: "series_2" };
      const result = await client.analyzeEvolution([baseSummary, summary2], undefined);

      expect(result.progression).toBe("Stable");
    });

    it("returns Worsening progression when response contains 'worsening'", async () => {
      const { model } = makeMockModel("Worsening over time, condition deteriorating");
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = { ...baseSummary, seriesId: "series_2" };
      const result = await client.analyzeEvolution([baseSummary, summary2], undefined);

      expect(result.progression).toBe("Worsening");
    });

    it("returns Improving progression when response contains 'improving'", async () => {
      const { model } = makeMockModel("Improving — patient shows significant improvement");
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = { ...baseSummary, seriesId: "series_2" };
      const result = await client.analyzeEvolution([baseSummary, summary2], undefined);

      expect(result.progression).toBe("Improving");
    });

    it("passes rootContext in prompt when provided", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_EVOLUTION_RESPONSE);
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = { ...baseSummary, seriesId: "series_2" };
      await client.analyzeEvolution([baseSummary, summary2], "Patient had surgery in 2023");

      expect(mockFn).toHaveBeenCalledTimes(1);
      const callArg = promptTextOf(mockFn.mock.calls[0]![0]);
      expect(callArg).toContain("Patient had surgery in 2023");
    });

    it("returns error text in combinedReport when generateContent throws", async () => {
      const mockFn: AnyMockFn = jest.fn();
      mockFn.mockRejectedValue(new Error("API quota exceeded"));
      const model = { generateContent: mockFn } as unknown as GenerativeModel;
      const client = createGeminiClient(model);

      const summary2: SeriesSummary = { ...baseSummary, seriesId: "series_2" };
      const result = await client.analyzeEvolution([baseSummary, summary2], undefined);

      expect(result.combinedReport).toContain("Evolution analysis failed");
      expect(result.combinedReport).toContain("API quota exceeded");
      expect(result.progression).toBe("Inconclusive");
    });
  });

  describe("synthesizeSeries", () => {
    it("handles analyses where rawResponse is undefined (uses empty string fallback)", async () => {
      const { model } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);

      const analysisNoRaw: ImageAnalysis = {
        imagePath: "/tmp/img.png",
        seriesId: "s1",
        status: "success",
        // rawResponse deliberately omitted
        processedAt: new Date().toISOString(),
        disclaimer: DISCLAIMER,
      };

      // Should not throw — rawResponse ?? "" fallback is exercised
      const result = await client.synthesizeSeries("s1", [analysisNoRaw], undefined);
      expect(result.seriesId).toBe("s1");
    });
  });

  describe("synthesizeSeries error handling", () => {
    it("returns error text in report when generateContent throws", async () => {
      const mockFn: AnyMockFn = jest.fn();
      mockFn.mockRejectedValue(new Error("Network error"));
      const model = { generateContent: mockFn } as unknown as GenerativeModel;
      const client = createGeminiClient(model);

      const result = await client.synthesizeSeries("series_1", [baseAnalysis], undefined);

      expect(result.report).toContain("Series synthesis failed");
      expect(result.report).toContain("Network error");
    });
  });

  describe("retry integration", () => {
    const PRICING = { inputUsdPerMillion: 1, outputUsdPerMillion: 10 };
    const OK = { response: { text: () => SAMPLE_IMAGE_ANALYSIS_RESPONSE } };

    /** The real 429 that ended a SIME 2026 batch, including its RetryInfo hint. */
    const quota429 = () =>
      new Error(
        "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
          "v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded " +
          'your current quota. [{"@type":"type.googleapis.com/google.rpc.RetryInfo",' +
          '"retryDelay":"7s"}]'
      );

    const recordSleep = (delays: number[]) => async (ms: number) => {
      delays.push(ms);
    };

    it("retries a Gemini 429 quota error and returns a successful analysis", async () => {
      const delays: number[] = [];
      const attempts: RetryAttemptInfo[] = [];
      let calls = 0;
      const model = {
        generateContent: async () => {
          calls++;
          if (calls <= 2) throw quota429();
          return OK;
        },
      } as unknown as GenerativeModel;
      const client = createGeminiClient(model, undefined, {
        retry: {
          sleep: recordSleep(delays),
          random: () => 1,
          onRetry: (info) => attempts.push(info),
        },
      });

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("success");
      expect(result.modality).toBe("X-ray");
      expect(calls).toBe(3);
      // The server's RetryInfo hint wins over the jittered backoff, both times.
      expect(delays).toEqual([7000, 7000]);
      expect(attempts.map((a) => a.status)).toEqual([429, 429]);
      expect(attempts.map((a) => a.hintMs)).toEqual([7000, 7000]);
    });

    it("meters the successful attempt once — a retried failure does not double-count", async () => {
      const delays: number[] = [];
      let calls = 0;
      const model = {
        generateContent: async () => {
          calls++;
          if (calls === 1) throw quota429();
          return {
            response: {
              text: () => SAMPLE_IMAGE_ANALYSIS_RESPONSE,
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100 },
            },
          };
        },
      } as unknown as GenerativeModel;
      const meter = new CostMeter(undefined, PRICING);
      const client = createGeminiClient(model, meter, {
        retry: { sleep: recordSleep(delays), random: () => 0 },
      });

      await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      const summary = meter.summary();
      expect(summary.calls).toBe(1);
      expect(summary.inputTokens).toBe(500);
      expect(summary.outputTokens).toBe(100);
    });

    it("still records tokens a failed attempt reported, so the estimate stays honest", async () => {
      const delays: number[] = [];
      let calls = 0;
      const model = {
        generateContent: async () => {
          calls++;
          if (calls === 1) {
            throw Object.assign(quota429(), {
              usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 0 },
            });
          }
          return {
            response: {
              text: () => SAMPLE_IMAGE_ANALYSIS_RESPONSE,
              usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 },
            },
          };
        },
      } as unknown as GenerativeModel;
      const meter = new CostMeter(undefined, PRICING);
      const client = createGeminiClient(model, meter, {
        retry: { sleep: recordSleep(delays), random: () => 0 },
      });

      await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      // Two metered calls: the burned attempt (300 in) and the good one (300/40).
      const summary = meter.summary();
      expect(summary.calls).toBe(2);
      expect(summary.inputTokens).toBe(600);
      expect(summary.outputTokens).toBe(40);
    });

    it("gives up after the configured attempts and folds the error into the result", async () => {
      const delays: number[] = [];
      const errorFn: AnyMockFn = jest.fn();
      errorFn.mockRejectedValue(quota429());
      const model = { generateContent: errorFn } as unknown as GenerativeModel;
      const client = createGeminiClient(model, undefined, {
        retry: { maxAttempts: 3, sleep: recordSleep(delays), random: () => 0 },
      });

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("429 Too Many Requests");
      expect(errorFn).toHaveBeenCalledTimes(3);
      expect(delays).toHaveLength(2);
    });

    it("does not retry a non-transient failure (403 / plain error)", async () => {
      const delays: number[] = [];
      const errorFn: AnyMockFn = jest.fn();
      errorFn.mockRejectedValue(Object.assign(new Error("[403 Forbidden] API key invalid"), {}));
      const model = { generateContent: errorFn } as unknown as GenerativeModel;
      const client = createGeminiClient(model, undefined, {
        retry: { sleep: recordSleep(delays) },
      });

      const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("error");
      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(delays).toEqual([]);
    });

    it("retries the series-synthesis call too (same wrapper, string prompt)", async () => {
      const delays: number[] = [];
      let calls = 0;
      const model = {
        generateContent: async () => {
          calls++;
          if (calls === 1) throw Object.assign(new Error("upstream"), { status: 503 });
          return { response: { text: () => "## Series\n- Primary: Normal" } };
        },
      } as unknown as GenerativeModel;
      const client = createGeminiClient(model, undefined, {
        retry: { sleep: recordSleep(delays), random: () => 0.5, baseDelayMs: 1000 },
      });

      const result = await client.synthesizeSeries("series_1", [baseAnalysis], undefined);

      expect(result.primaryDiagnosis).toBe("Normal");
      expect(calls).toBe(2);
      expect(delays).toEqual([500]);
    });
  });

  describe("prepareImageForGemini", () => {
    it("re-encodes an image as base64 PNG (exported for the E3 payload experiment)", async () => {
      const prepared = await prepareImageForGemini(FIXTURE_IMAGE);

      expect(prepared.mimeType).toBe("image/png");
      expect(Buffer.from(prepared.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    });
  });

  describe("createGeminiModelFromSdk", () => {
    it("returns a GenerativeModel object given a valid API key", () => {
      const model = createGeminiModelFromSdk("fake-api-key-for-test", "gemini-2.5-pro");
      // It should have a generateContent method (duck type check)
      expect(typeof model.generateContent).toBe("function");
    });
  });
});

// ─── Structured output (JSON mode + Zod validation) ──────────────────────────

describe("structured output", () => {
  const VALID_IMAGE_JSON = mock("image-analysis-success.txt");
  const VALID_SERIES_JSON = mock("series-synthesis.txt");
  const VALID_EVOLUTION_JSON = mock("evolution-analysis.txt");

  const twoSummaries: SeriesSummary[] = [
    baseSummary,
    { ...baseSummary, seriesId: "series_2", report: "Summary 2" },
  ];

  describe("request shape", () => {
    it("asks Gemini for application/json on the image call, keeping the image part", async () => {
      const { model, mockFn } = makeMockModel(VALID_IMAGE_JSON);
      await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      const request = mockFn.mock.calls[0]![0] as {
        contents: Array<{ parts: Array<Record<string, unknown>> }>;
      };
      expect(generationConfigOf(request)?.responseMimeType).toBe("application/json");
      expect(request.contents[0]!.parts.some((p) => p["inlineData"] !== undefined)).toBe(true);
      expect(promptTextOf(request)).toContain('"anatomyRegion"');
    });

    it("asks for application/json on the series and evolution calls too", async () => {
      const { model: m1, mockFn: f1 } = makeMockModel(VALID_SERIES_JSON);
      await createGeminiClient(m1).synthesizeSeries("series_1", [baseAnalysis], undefined);
      expect(generationConfigOf(f1.mock.calls[0]![0])?.responseMimeType).toBe("application/json");

      const { model: m2, mockFn: f2 } = makeMockModel(VALID_EVOLUTION_JSON);
      await createGeminiClient(m2).analyzeEvolution(twoSummaries, undefined);
      expect(generationConfigOf(f2.mock.calls[0]![0])?.responseMimeType).toBe("application/json");
    });

    it("withJsonMode handles all three request shapes the SDK accepts", () => {
      const fromString = withJsonMode("hello") as {
        contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
        generationConfig: Record<string, string>;
      };
      expect(fromString.contents[0]!.role).toBe("user");
      expect(fromString.contents[0]!.parts[0]!.text).toBe("hello");
      expect(fromString.generationConfig).toEqual(JSON_GENERATION_CONFIG);

      const fromParts = withJsonMode(["a", { text: "b" }]) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
        generationConfig: Record<string, string>;
      };
      expect(fromParts.contents[0]!.parts.map((p) => p.text)).toEqual(["a", "b"]);
      expect(fromParts.generationConfig).toEqual(JSON_GENERATION_CONFIG);

      const fromRequest = withJsonMode({
        contents: [{ role: "user", parts: [{ text: "c" }] }],
        generationConfig: { temperature: 0 },
      }) as { generationConfig: Record<string, unknown> };
      // Pre-existing generation settings survive; the mime type is added.
      expect(fromRequest.generationConfig).toEqual({
        temperature: 0,
        responseMimeType: "application/json",
      });
    });
  });

  describe("analyzeImage", () => {
    it("populates modality, region, quality, findings, abnormalities and summary from valid JSON", async () => {
      const { model } = makeMockModel(VALID_IMAGE_JSON);
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("success");
      expect(result.modality).toBe("X-ray");
      expect(result.anatomyRegion).toContain("Chest");
      expect(result.quality).toBe("Good");
      expect(result.findings).toHaveLength(4);
      expect(result.abnormalities).toEqual([
        {
          name: "Mild basal atelectasis",
          description: expect.stringContaining("atelectasis"),
          severity: "Mild",
          confidence: 62,
        },
      ]);
      expect(result.summary).toContain("chest image");
      expect(result.references).toHaveLength(2);
      expect(result.validation).toEqual({ ok: true });
      // The raw model text is always kept verbatim next to the parsed record.
      expect(result.rawResponse).toBe(VALID_IMAGE_JSON);
      expect(result.disclaimer).toBe(DISCLAIMER);
    });

    it("accepts JSON wrapped in a ```json fence", async () => {
      const { model } = makeMockModel("```json\n" + VALID_IMAGE_JSON + "\n```");
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.validation).toEqual({ ok: true });
      expect(result.modality).toBe("X-ray");
    });

    it("accepts JSON preceded by prose", async () => {
      const { model } = makeMockModel("Here is the analysis:\n" + VALID_IMAGE_JSON);
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.validation).toEqual({ ok: true });
      expect(result.anatomyRegion).toContain("Chest");
    });

    it("falls back to the pattern parsers and records issues when the JSON is invalid", async () => {
      // Valid JSON, wrong shape: quality is not one of the four enum values and
      // confidence is out of range.
      const invalid = JSON.stringify({
        modality: "X-ray",
        anatomyRegion: "Chest",
        quality: "Sharp",
        summary: "ok",
        abnormalities: [{ name: "n", description: "d", severity: "Mild", confidence: 500 }],
      });
      const { model } = makeMockModel(invalid);
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("success");
      expect(result.validation?.ok).toBe(false);
      expect(result.validation?.issues?.join(" ")).toMatch(/quality/);
      expect(result.validation?.issues?.join(" ")).toMatch(/abnormalities\.0\.confidence/);
      // Nothing was invented from an unvalidated payload…
      expect(result.anatomyRegion).toBeUndefined();
      expect(result.quality).toBeUndefined();
      expect(result.abnormalities).toBeUndefined();
      // …the narrative and the mandatory disclaimer are still there.
      expect(result.rawResponse).toBe(invalid);
      expect(result.disclaimer).toBe(DISCLAIMER);
    });

    it("falls back to the Markdown parsers when the model ignores JSON mode", async () => {
      const { model } = makeMockModel(SAMPLE_IMAGE_ANALYSIS_RESPONSE);
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.validation).toEqual({
        ok: false,
        issues: ["(root): response is not a JSON object"],
      });
      expect(result.modality).toBe("X-ray");
      expect(result.findings).toEqual(["Clear lung fields", "Normal cardiac silhouette"]);
      expect(result.summary).toBe("Your chest X-ray looks normal overall.");
    });

    it("records an empty response as a validation failure", async () => {
      const { model } = makeMockModel("");
      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.validation).toEqual({
        ok: false,
        issues: ["(root): empty model response"],
      });
      expect(result.status).toBe("success");
    });

    it("records no validation outcome when the call itself failed", async () => {
      const errorFn: AnyMockFn = jest.fn();
      errorFn.mockRejectedValue(new Error("API timeout"));
      const model = { generateContent: errorFn } as unknown as GenerativeModel;

      const result = await createGeminiClient(model).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(result.status).toBe("error");
      expect(result.validation).toBeUndefined();
    });
  });

  describe("synthesizeSeries", () => {
    it("populates consistentFindings, discrepancies, differentials and confidence from valid JSON", async () => {
      const { model } = makeMockModel(VALID_SERIES_JSON);
      const result = await createGeminiClient(model).synthesizeSeries(
        "series_1",
        [baseAnalysis],
        undefined
      );

      expect(result.consistentFindings).toHaveLength(3);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.primaryDiagnosis).toContain("Normal chest radiograph");
      expect(result.differentialDiagnoses).toEqual([
        "Subsegmental atelectasis",
        "Early basal infiltrate",
      ]);
      expect(result.confidenceLevel).toBe("High");
      // `report` holds the narrative from the JSON, not the JSON envelope.
      expect(result.report).toContain("Series Synthesis");
      expect(result.report).not.toContain('"consistentFindings"');
      expect(result.validation).toEqual({ ok: true });
      expect(result.disclaimer).toBe(DISCLAIMER);
    });

    it("keeps the raw narrative and records issues when the JSON is invalid", async () => {
      const { model } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const result = await createGeminiClient(model).synthesizeSeries(
        "series_1",
        [baseAnalysis],
        undefined
      );

      expect(result.validation?.ok).toBe(false);
      expect(result.report).toBe(SAMPLE_SERIES_RESPONSE);
      expect(result.primaryDiagnosis).toBe("Diagnosis: Normal");
      expect(result.consistentFindings).toEqual([]);
      expect(result.confidenceLevel).toBe("Medium");
    });

    it("records no validation outcome when the call failed", async () => {
      const mockFn: AnyMockFn = jest.fn();
      mockFn.mockRejectedValue(new Error("Network error"));
      const model = { generateContent: mockFn } as unknown as GenerativeModel;

      const result = await createGeminiClient(model).synthesizeSeries(
        "series_1",
        [baseAnalysis],
        undefined
      );

      expect(result.validation).toBeUndefined();
      expect(result.report).toContain("Series synthesis failed");
      expect(result.primaryDiagnosis).toBe("See full report");
    });
  });

  describe("analyzeEvolution", () => {
    it("populates progression, trends, forecast and treatment suggestions from valid JSON", async () => {
      const { model } = makeMockModel(VALID_EVOLUTION_JSON);
      const result = await createGeminiClient(model).analyzeEvolution(twoSummaries, undefined);

      expect(result.progression).toBe("Stable");
      expect(result.trends).toHaveLength(2);
      expect(result.trends[0]).toEqual({
        finding: "Left basal atelectasis",
        trend: "Stable",
        details: expect.stringContaining("Unchanged"),
      });
      expect(result.forecastedEvolution).toContain("unchanged");
      expect(result.treatmentRecommendations).toHaveLength(2);
      expect(result.combinedReport).toContain("Temporal Evolution");
      expect(result.validation).toEqual({ ok: true });
    });

    it("falls back to the narrative classifier when the JSON is invalid", async () => {
      const { model } = makeMockModel(SAMPLE_EVOLUTION_RESPONSE);
      const result = await createGeminiClient(model).analyzeEvolution(twoSummaries, undefined);

      expect(result.validation?.ok).toBe(false);
      expect(result.progression).toBe("Stable");
      expect(result.trends).toEqual([]);
      expect(result.forecastedEvolution).toBe("");
      expect(result.treatmentRecommendations).toEqual([]);
      expect(result.combinedReport).toBe(SAMPLE_EVOLUTION_RESPONSE);
    });

    it("records issues when the JSON parses but the progression label is not in the enum", async () => {
      const { model } = makeMockModel(
        JSON.stringify({
          progression: "SingleSeries",
          forecastedEvolution: "x",
          combinedReport: "Worsening overall",
        })
      );
      const result = await createGeminiClient(model).analyzeEvolution(twoSummaries, undefined);

      expect(result.validation?.ok).toBe(false);
      expect(result.validation?.issues?.join(" ")).toMatch(/progression/);
      // The classifier still labels the record from the raw text.
      expect(result.progression).toBe("Worsening");
    });

    it("records no validation outcome for the single-series shortcut (no model call)", async () => {
      const { model, mockFn } = makeMockModel(VALID_EVOLUTION_JSON);
      const result = await createGeminiClient(model).analyzeEvolution([baseSummary], undefined);

      expect(result.progression).toBe("SingleSeries");
      expect(result.validation).toBeUndefined();
      expect(mockFn).not.toHaveBeenCalled();
    });

    it("records no validation outcome when the call failed", async () => {
      const mockFn: AnyMockFn = jest.fn();
      mockFn.mockRejectedValue(new Error("API quota exceeded"));
      const model = { generateContent: mockFn } as unknown as GenerativeModel;

      const result = await createGeminiClient(model).analyzeEvolution(twoSummaries, undefined);

      expect(result.validation).toBeUndefined();
      expect(result.progression).toBe("Inconclusive");
    });
  });

  describe("JSON-mode refusal", () => {
    it("recognises a provider refusal of responseMimeType, and only that", () => {
      expect(
        isJsonModeUnsupported(
          new Error(
            "[400] Function calling with response mime type application/json is unsupported"
          )
        )
      ).toBe(true);
      expect(
        isJsonModeUnsupported("response_format json_object is not supported by this model")
      ).toBe(true);
      expect(isJsonModeUnsupported(new Error("[429] quota exceeded"))).toBe(false);
      expect(isJsonModeUnsupported(new Error("responseMimeType accepted"))).toBe(false);
    });

    it("replays the call once without JSON mode and still returns a record", async () => {
      const requests: unknown[] = [];
      const model = {
        generateContent: async (request: unknown) => {
          requests.push(request);
          if (requests.length === 1) {
            throw new Error(
              "[400 Bad Request] response mime type application/json is unsupported with tools"
            );
          }
          return { response: { text: () => SAMPLE_IMAGE_ANALYSIS_RESPONSE } };
        },
      } as unknown as GenerativeModel;

      const result = await createGeminiClient(model, undefined, {
        retry: { maxAttempts: 1 },
      }).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(requests).toHaveLength(2);
      expect(generationConfigOf(requests[0])?.responseMimeType).toBe("application/json");
      expect(generationConfigOf(requests[1])?.responseMimeType).toBeUndefined();
      // The replay answers in Markdown, so it travels the fallback path.
      expect(result.status).toBe("success");
      expect(result.modality).toBe("X-ray");
      expect(result.validation?.ok).toBe(false);
    });

    it("does not replay any other error", async () => {
      const errorFn: AnyMockFn = jest.fn();
      errorFn.mockRejectedValue(new Error("[403 Forbidden] API key invalid"));
      const model = { generateContent: errorFn } as unknown as GenerativeModel;

      const result = await createGeminiClient(model, undefined, {
        retry: { maxAttempts: 1 },
      }).analyzeImage(FIXTURE_IMAGE, "series_1");

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("error");
    });

    it("meters the replayed attempt exactly once", async () => {
      let calls = 0;
      const model = {
        generateContent: async () => {
          calls++;
          if (calls === 1) throw new Error("json mode is not supported for this model");
          return {
            response: {
              text: () => mock("image-analysis-success.txt"),
              usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
            },
          };
        },
      } as unknown as GenerativeModel;
      const meter = new CostMeter(undefined, { inputUsdPerMillion: 1, outputUsdPerMillion: 10 });

      await createGeminiClient(model, meter, { retry: { maxAttempts: 1 } }).analyzeImage(
        FIXTURE_IMAGE,
        "series_1"
      );

      const summary = meter.summary();
      expect(summary.calls).toBe(1);
      expect(summary.inputTokens).toBe(200);
      expect(summary.outputTokens).toBe(50);
    });
  });
});

describe("defensive edges", () => {
  it("tolerates a non-object rejection (a thrown string) without metering usage", async () => {
    const model = {
      generateContent: async () => {
        throw "provider blew up";
      },
    } as unknown as GenerativeModel;
    const meter = new CostMeter(undefined, { inputUsdPerMillion: 1, outputUsdPerMillion: 10 });

    const result = await createGeminiClient(model, meter, {
      retry: { maxAttempts: 1 },
    }).analyzeImage(FIXTURE_IMAGE, "series_1");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBeUndefined();
    expect(meter.summary().calls).toBe(0);
  });

  it("falls back to an empty combined report when the only summary carries no report", async () => {
    const { model } = makeMockModel("unused");
    const noReport = { ...baseSummary, report: undefined } as unknown as SeriesSummary;

    const result = await createGeminiClient(model).analyzeEvolution([noReport], undefined);

    expect(result.progression).toBe("SingleSeries");
    expect(result.combinedReport).toBe("");
  });
});
