import { describe, it, expect } from "@jest/globals";
import * as path from "path";
import * as url from "url";
import type { GenerativeModel } from "@google/generative-ai";
import { createGeminiClient } from "../../../src/infrastructure/gemini-client.js";
import { CostMeter, CostCapExceededError } from "../../../src/infrastructure/cost-meter.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.resolve(__dirname, "../../fixtures/test_image.png");
const PRICING = { inputUsdPerMillion: 1, outputUsdPerMillion: 10 };
const FINDINGS_RESPONSE = "### 2. Key Findings\n- ok";

const oneAnalysis: ImageAnalysis = {
  imagePath: "/fake/img.png",
  seriesId: "s1",
  status: "success",
  rawResponse: "ok",
  processedAt: new Date().toISOString(),
  disclaimer: DISCLAIMER,
};

function makeSummary(seriesId: string): SeriesSummary {
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
    processedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

const OVER_CAP_USAGE = { promptTokenCount: 1_000_000, candidatesTokenCount: 0 };

function modelWithUsage(usage: {
  promptTokenCount: number;
  candidatesTokenCount: number;
}): GenerativeModel {
  return {
    generateContent: async () => ({
      response: { text: () => FINDINGS_RESPONSE, usageMetadata: usage },
    }),
  } as unknown as GenerativeModel;
}

describe("createGeminiClient — cost metering", () => {
  it("records real token usage from the SDK response", async () => {
    const meter = new CostMeter(undefined, PRICING);
    const client = createGeminiClient(
      modelWithUsage({ promptTokenCount: 1000, candidatesTokenCount: 200 }),
      meter
    );

    const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

    expect(result.status).toBe("success");
    const summary = meter.summary();
    expect(summary.calls).toBe(1);
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(200);
  });

  it("propagates CostCapExceededError past the per-call catch so the run aborts", async () => {
    const meter = new CostMeter(0.000001, PRICING);
    const client = createGeminiClient(
      modelWithUsage({ promptTokenCount: 1_000_000, candidatesTokenCount: 0 }),
      meter
    );

    await expect(client.analyzeImage(FIXTURE_IMAGE, "series_1")).rejects.toBeInstanceOf(
      CostCapExceededError
    );
  });

  it("propagates CostCapExceededError from synthesizeSeries", async () => {
    const meter = new CostMeter(0.000001, PRICING);
    const client = createGeminiClient(modelWithUsage(OVER_CAP_USAGE), meter);

    await expect(
      client.synthesizeSeries("s1", [oneAnalysis], undefined)
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });

  it("propagates CostCapExceededError from analyzeEvolution (multi-series)", async () => {
    const meter = new CostMeter(0.000001, PRICING);
    const client = createGeminiClient(modelWithUsage(OVER_CAP_USAGE), meter);

    await expect(
      client.analyzeEvolution([makeSummary("s1"), makeSummary("s2")], undefined)
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });

  it("is a no-op when no meter is supplied (usageMetadata not required)", async () => {
    const model = {
      generateContent: async () => ({ response: { text: () => FINDINGS_RESPONSE } }),
    } as unknown as GenerativeModel;
    const client = createGeminiClient(model); // no meter

    const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");
    expect(result.status).toBe("success");
  });
});
