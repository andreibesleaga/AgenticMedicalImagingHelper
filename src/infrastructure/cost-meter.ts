/**
 * Cost metering for Gemini API usage.
 *
 * Token counts come from the real `usageMetadata` returned by the Gemini SDK
 * response — they are authoritative. The USD figure is an **estimate**: it is
 * `tokens × price`, where the price defaults to published Gemini 2.5 Pro rates
 * and is overridable via env. The provider's billing invoice is the only
 * authoritative cost; this meter is a client-side guard-rail, not an accountant.
 *
 * The cap is enforced *after* each call completes (you cannot know a call's cost
 * before making it), so `--max-cost-usd` bounds the run by stopping the *next*
 * call once the cumulative estimate crosses the cap.
 */

/** Subset of the Gemini SDK `usageMetadata` shape we depend on. */
export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
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
 * Default published Gemini 2.5 Pro pricing (USD / 1M tokens), overridable via
 * `GEMINI_INPUT_USD_PER_1M` / `GEMINI_OUTPUT_USD_PER_1M`. Treat as an estimate.
 */
export function defaultGeminiPricing(): GeminiPricing {
  return {
    inputUsdPerMillion: envNumber("GEMINI_INPUT_USD_PER_1M", 1.25),
    outputUsdPerMillion: envNumber("GEMINI_OUTPUT_USD_PER_1M", 10),
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
}

export interface CostSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
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
    const lastOutputTokens = usage?.candidatesTokenCount ?? 0;
    this.inputTokens += lastInputTokens;
    this.outputTokens += lastOutputTokens;
    this.callCount += 1;

    const cumulativeUsd = this.estimatedUsd();
    this.onCall?.({
      calls: this.callCount,
      lastInputTokens,
      lastOutputTokens,
      cumulativeUsd,
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
    };
  }
}
