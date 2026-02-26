import { describe, it, expect, jest } from "@jest/globals";
import * as path from "path";
import * as url from "url";
import type { GenerativeModel } from "@google/generative-ai";
import { createGeminiClient, createGeminiModelFromSdk } from "../../../src/infrastructure/gemini-client.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// Real 10×10 white PNG fixture — no sharp mock needed
const FIXTURE_IMAGE = path.resolve(__dirname, "../../fixtures/test_image.png");

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
      const callArg = mockFn.mock.calls[0]![0] as string;
      expect(callArg).toContain("<context>");
      expect(callArg).toContain("Patient has COPD");
      expect(callArg).toContain("</context>");
    });

    it("truncates context to MAX_CONTEXT_LENGTH characters", async () => {
      const { model, mockFn } = makeMockModel(SAMPLE_SERIES_RESPONSE);
      const client = createGeminiClient(model);
      const longContext = "X".repeat(5000);

      await client.synthesizeSeries("series_1", [baseAnalysis], longContext);

      const callArg = mockFn.mock.calls[0]![0] as string;
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
      const callArg = mockFn.mock.calls[0]![0] as string;
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

  describe("createGeminiModelFromSdk", () => {
    it("returns a GenerativeModel object given a valid API key", () => {
      const model = createGeminiModelFromSdk("fake-api-key-for-test", "gemini-2.5-pro");
      // It should have a generateContent method (duck type check)
      expect(typeof model.generateContent).toBe("function");
    });
  });
});
