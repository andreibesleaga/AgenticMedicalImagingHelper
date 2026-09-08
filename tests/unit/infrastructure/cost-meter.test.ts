import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  CostMeter,
  CostCapExceededError,
  defaultGeminiPricing,
  GEMINI_PRICE_TABLE,
  type GeminiPricing,
} from "../../../src/infrastructure/cost-meter.js";

// Deterministic pricing: $1 / 1M input, $10 / 1M output.
const PRICING: GeminiPricing = { inputUsdPerMillion: 1, outputUsdPerMillion: 10 };

describe("CostMeter", () => {
  it("estimates cost as tokens × price across multiple calls", () => {
    const meter = new CostMeter(undefined, PRICING);
    meter.record({ promptTokenCount: 500_000, candidatesTokenCount: 100_000 });
    meter.record({ promptTokenCount: 500_000, candidatesTokenCount: 100_000 });

    const summary = meter.summary();
    expect(summary.calls).toBe(2);
    expect(summary.inputTokens).toBe(1_000_000);
    expect(summary.outputTokens).toBe(200_000);
    // (1.0M/1M)*$1 + (0.2M/1M)*$10 = $1 + $2 = $3
    expect(summary.estimatedUsd).toBeCloseTo(3, 10);
  });

  it("treats undefined / missing usage as zero tokens", () => {
    const meter = new CostMeter(undefined, PRICING);
    meter.record(undefined);
    meter.record({});
    const summary = meter.summary();
    expect(summary.calls).toBe(2);
    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.estimatedUsd).toBe(0);
  });

  it("never throws when no cap is set, even at high cost", () => {
    const meter = new CostMeter(undefined, PRICING);
    expect(() =>
      meter.record({ promptTokenCount: 100_000_000, candidatesTokenCount: 100_000_000 })
    ).not.toThrow();
  });

  it("does not throw while cumulative cost stays within the cap", () => {
    const meter = new CostMeter(5, PRICING);
    // $1 input + $1 output = $2 ≤ $5
    expect(() =>
      meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 100_000 })
    ).not.toThrow();
  });

  it("throws CostCapExceededError once the cumulative estimate exceeds the cap", () => {
    const meter = new CostMeter(5, PRICING);
    let thrown: unknown;
    try {
      // (1M)*$1 + (1M)*$10 = $11 > $5
      meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CostCapExceededError);
    const e = thrown as CostCapExceededError;
    expect(e.capUsd).toBe(5);
    expect(e.estimatedUsd).toBeCloseTo(11, 10);
    expect(e.calls).toBe(1);
    expect(e.message).toContain("--max-cost-usd");
  });

  it("aborts on the call that crosses the cap, after earlier calls succeed", () => {
    const meter = new CostMeter(5, PRICING);
    // First call: $2 — fine.
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 100_000 });
    // Second call pushes cumulative to $4 — still fine.
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 100_000 });
    // Third call pushes cumulative to $6 — over the $5 cap.
    expect(() =>
      meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 100_000 })
    ).toThrow(CostCapExceededError);
  });

  it("invokes the onCall callback with cumulative info after each call", () => {
    const onCall = jest.fn();
    const meter = new CostMeter(undefined, PRICING, onCall);
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 0 });
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 0 });

    expect(onCall).toHaveBeenCalledTimes(2);
    expect(onCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ calls: 2, lastInputTokens: 1_000_000, cumulativeUsd: 2 })
    );
  });

  it("counts thinking tokens as output tokens (billed at the output rate)", () => {
    const meter = new CostMeter(undefined, PRICING);
    meter.record({ promptTokenCount: 8, candidatesTokenCount: 1, thoughtsTokenCount: 30 });
    const s = meter.summary();
    expect(s.inputTokens).toBe(8);
    expect(s.outputTokens).toBe(31);
    // 8/1M*$1 + 31/1M*$10
    expect(s.estimatedUsd).toBeCloseTo(8e-6 + 31e-5, 12);
  });

  it("exposes positive default Gemini pricing", () => {
    const p = defaultGeminiPricing();
    expect(p.inputUsdPerMillion).toBeGreaterThan(0);
    expect(p.outputUsdPerMillion).toBeGreaterThan(0);
  });

  it("selects published rates by model name and a conservative fallback otherwise", () => {
    expect(defaultGeminiPricing("gemini-2.5-flash")).toEqual({
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
    });
    expect(defaultGeminiPricing("gemini-2.5-pro")).toEqual({
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 10,
    });
    const unknown = defaultGeminiPricing("some-future-model");
    const max = Math.max(...Object.values(GEMINI_PRICE_TABLE).map((p) => p.outputUsdPerMillion));
    expect(unknown.outputUsdPerMillion).toBeGreaterThanOrEqual(max);
  });
});

describe("defaultGeminiPricing — env overrides", () => {
  const KEYS = ["GEMINI_INPUT_USD_PER_1M", "GEMINI_OUTPUT_USD_PER_1M"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reads valid numeric env overrides", () => {
    process.env.GEMINI_INPUT_USD_PER_1M = "2";
    process.env.GEMINI_OUTPUT_USD_PER_1M = "20";
    const p = defaultGeminiPricing();
    expect(p.inputUsdPerMillion).toBe(2);
    expect(p.outputUsdPerMillion).toBe(20);
  });

  it("falls back to defaults for empty, non-numeric, or negative env values", () => {
    process.env.GEMINI_INPUT_USD_PER_1M = ""; // empty → fallback
    process.env.GEMINI_OUTPUT_USD_PER_1M = "not-a-number"; // NaN → fallback
    const fallback = defaultGeminiPricing();
    expect(fallback.inputUsdPerMillion).toBeGreaterThan(0);
    expect(fallback.outputUsdPerMillion).toBeGreaterThan(0);

    process.env.GEMINI_INPUT_USD_PER_1M = "-5"; // negative → fallback
    expect(defaultGeminiPricing().inputUsdPerMillion).toBeGreaterThan(0);
  });
});

describe("CostMeter — provider-reported cost", () => {
  it("accumulates providerCostUsd separately and leaves the estimate untouched", () => {
    const onCall = jest.fn();
    const meter = new CostMeter(undefined, PRICING, onCall);
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 0, providerCostUsd: 0.001 });
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 0 }); // no cost reported
    meter.record({ promptTokenCount: 1_000_000, candidatesTokenCount: 0, providerCostUsd: 0.002 });

    const s = meter.summary();
    expect(s.calls).toBe(3);
    expect(s.estimatedUsd).toBeCloseTo(3, 10); // 3M input tokens × $1/1M
    expect(s.providerReportedUsd).toBeCloseTo(0.003, 12);
    expect(onCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ calls: 2, providerReportedUsd: 0.001 })
    );
  });

  it("reports providerReportedUsd as undefined when no call carried a cost", () => {
    const meter = new CostMeter(undefined, PRICING);
    meter.record({ promptTokenCount: 10, candidatesTokenCount: 5 });
    expect(meter.summary().providerReportedUsd).toBeUndefined();
  });

  it("ignores non-finite provider costs", () => {
    const meter = new CostMeter(undefined, PRICING);
    meter.record({ promptTokenCount: 1, candidatesTokenCount: 1, providerCostUsd: Number.NaN });
    meter.record({ promptTokenCount: 1, candidatesTokenCount: 1, providerCostUsd: 0 });
    expect(meter.summary().providerReportedUsd).toBe(0);
  });

  it("enforces the cap on the estimate, not on the provider-reported figure", () => {
    const meter = new CostMeter(1, PRICING);
    // Estimate $0.000001, provider says $5 — cap is unchanged behaviour: estimate only.
    expect(() =>
      meter.record({ promptTokenCount: 1, candidatesTokenCount: 0, providerCostUsd: 5 })
    ).not.toThrow();
  });
});
