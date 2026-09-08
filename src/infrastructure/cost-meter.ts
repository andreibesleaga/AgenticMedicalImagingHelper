/**
 * Cost metering for Gemini API usage.
 *
 * Token counts come from the real `usageMetadata` returned by the Gemini SDK
 * response — they are authoritative. The USD figure is an **estimate**: it is
 * `tokens × price`, where the price comes from a small table of published Gemini
 * rates keyed by model name (see {@link defaultGeminiPricing}) and is
 * overridable via env. Output tokens include the model's *thinking* tokens
 * (`thoughtsTokenCount`), because Google bills them at the output rate. The
 * provider's billing invoice is the only authoritative cost; this meter is a
 * client-side guard-rail, not an accountant.
 *
 * Some providers (OpenRouter, via `usage.cost`) report the charge for each call
 * themselves. When present it is accumulated separately as
 * `providerReportedUsd` and shown next to the estimate; the cap logic stays on
 * the estimate so behaviour is identical across providers.
 *
 * The cap is enforced *after* each call completes (you cannot know a call's cost
 * before making it), so `--max-cost-usd` bounds the run by stopping the *next*
 * call once the cumulative estimate crosses the cap.
 */

/** Subset of the Gemini SDK `usageMetadata` shape we depend on. */
export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  /** Reasoning ("thinking") tokens — billed as output tokens by Google. */
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  /**
   * Authoritative per-call charge in USD reported by the provider itself
   * (OpenRouter `usage.cost`). Absent for the Gemini SDK, which reports tokens only.
   */
  providerCostUsd?: number;
}

export interface GeminiPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputUsdPerMillion: number;
  /** USD per 1,000,000 output (candidate) tokens. */
  outputUsdPerMillion: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Published standard-tier Gemini prices (USD per 1M tokens, prompts ≤ 200k
 * tokens), as listed on https://ai.google.dev/gemini-api/docs/pricing
 * (page last updated 2026-09-04). Output prices include thinking tokens.
 */
export const GEMINI_PRICE_TABLE: Readonly<Record<string, GeminiPricing>> = {
  "gemini-2.5-flash": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  "gemini-2.5-pro": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  "gemini-3.1-pro-preview": { inputUsdPerMillion: 2, outputUsdPerMillion: 12 },
  "gemini-3.5-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 },
};

/** Conservative fallback for models not in the table (highest rate we know). */
const FALLBACK_PRICING: GeminiPricing = { inputUsdPerMillion: 2, outputUsdPerMillion: 12 };

/**
 * Pricing for `model` from {@link GEMINI_PRICE_TABLE}; unknown models fall back
 * to the most expensive known rate so the cap trips early rather than late.
 * `GEMINI_INPUT_USD_PER_1M` / `GEMINI_OUTPUT_USD_PER_1M` override either
 * component. Treat as an estimate.
 */
export function defaultGeminiPricing(model?: string): GeminiPricing {
  const base = (model !== undefined && GEMINI_PRICE_TABLE[model]) || FALLBACK_PRICING;
  return {
    inputUsdPerMillion: envNumber("GEMINI_INPUT_USD_PER_1M", base.inputUsdPerMillion),
    outputUsdPerMillion: envNumber("GEMINI_OUTPUT_USD_PER_1M", base.outputUsdPerMillion),
  };
}

export class CostCapExceededError extends Error {
  constructor(
    public readonly estimatedUsd: number,
    public readonly capUsd: number,
    public readonly calls: number
  ) {
    super(
      `Estimated Gemini cost $${estimatedUsd.toFixed(4)} exceeded --max-cost-usd ` +
        `$${capUsd.toFixed(2)} after ${calls} call(s). Run aborted.`
    );
    this.name = "CostCapExceededError";
  }
}

export interface CostCallInfo {
  calls: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  cumulativeUsd: number;
  /** Cumulative provider-reported USD; `undefined` until a call reports one. */
  providerReportedUsd?: number;
}

export interface CostSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  /** Sum of provider-reported charges (USD); `undefined` if no call reported one. */
  providerReportedUsd?: number;
}

/**
 * Accumulates token usage and, optionally, enforces a USD cap.
 *
 * @param maxCostUsd  Cap in USD. `undefined` ⇒ no cap, never throws.
 * @param pricing     Price table (defaults to {@link defaultGeminiPricing}).
 * @param onCall      Optional callback fired after every recorded call.
 */
export class CostMeter {
  private inputTokens = 0;
  private outputTokens = 0;
  private callCount = 0;
  private providerUsd: number | undefined;

  constructor(
    private readonly maxCostUsd?: number,
    private readonly pricing: GeminiPricing = defaultGeminiPricing(),
    private readonly onCall?: (info: CostCallInfo) => void
  ) {}

  /**
   * Record one API call's usage. Throws {@link CostCapExceededError} if a cap is
   * set and the cumulative estimate now exceeds it.
   */
  record(usage: TokenUsage | undefined): void {
    const lastInputTokens = usage?.promptTokenCount ?? 0;
    // Thinking tokens are billed as output tokens, so they count toward the cap.
    const lastOutputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    this.inputTokens += lastInputTokens;
    this.outputTokens += lastOutputTokens;
    this.callCount += 1;

    const reported = usage?.providerCostUsd;
    if (typeof reported === "number" && Number.isFinite(reported)) {
      this.providerUsd = (this.providerUsd ?? 0) + reported;
    }

    const cumulativeUsd = this.estimatedUsd();
    this.onCall?.({
      calls: this.callCount,
      lastInputTokens,
      lastOutputTokens,
      cumulativeUsd,
      providerReportedUsd: this.providerUsd,
    });

    if (this.maxCostUsd !== undefined && cumulativeUsd > this.maxCostUsd) {
      throw new CostCapExceededError(cumulativeUsd, this.maxCostUsd, this.callCount);
    }
  }

  /** Current cumulative estimated cost in USD. */
  estimatedUsd(): number {
    return (
      (this.inputTokens / 1_000_000) * this.pricing.inputUsdPerMillion +
      (this.outputTokens / 1_000_000) * this.pricing.outputUsdPerMillion
    );
  }

  summary(): CostSummary {
    return {
      calls: this.callCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedUsd: this.estimatedUsd(),
      providerReportedUsd: this.providerUsd,
    };
  }
}
