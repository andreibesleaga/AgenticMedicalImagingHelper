/**
 * Retry helper tests. Fully offline and deterministic: `sleep` and `random` are
 * injected everywhere, so no test depends on the wall clock and no test waits.
 */
import { describe, it, expect, jest } from "@jest/globals";
import {
  withRetry,
  isRetryableError,
  httpStatusOf,
  retryAfterMsOf,
  resolveMaxRetries,
  computeDelayMs,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  type RetryAttemptInfo,
} from "../../../src/infrastructure/retry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** An error carrying an HTTP status, like the Gemini SDK / OpenRouter adapter. */
function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** The real 429 the SIME 2026 batch hit, verbatim in shape. */
const GEMINI_429 = new Error(
  "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
    "v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded your " +
    'current quota, please check your plan and billing details. [{"@type":' +
    '"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]'
);

/** Collects the delays a run slept for, and never actually waits. */
function recorder(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

// ─── Classification ───────────────────────────────────────────────────────────

describe("isRetryableError", () => {
  it("retries transient HTTP statuses", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableError(httpError(status))).toBe(true);
    }
  });

  it("never retries client errors that a repeat cannot fix", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableError(httpError(status))).toBe(false);
    }
  });

  it("never retries Zod validation errors", () => {
    const zodLike = Object.assign(new Error("invalid"), {
      name: "ZodError",
      issues: [{ code: "invalid_type", path: ["modality"] }],
    });
    expect(isRetryableError(zodLike)).toBe(false);

    // Even when it is dressed up as a transient status, data is still data.
    expect(isRetryableError(Object.assign(httpError(503), { issues: [] }))).toBe(false);
  });

  it("retries transport failures by error code, including undici-wrapped causes", () => {
    expect(isRetryableError(Object.assign(new Error("read"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("dns"), { code: "EAI_AGAIN" }))).toBe(true);

    const wrapped = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect"), { code: "ETIMEDOUT" }),
    });
    expect(isRetryableError(wrapped)).toBe(true);
  });

  it("retries request timeouts but not deliberate aborts", () => {
    expect(isRetryableError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(
      true
    );
    expect(isRetryableError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      false
    );
  });

  it("retries undici phrasings that carry no code", () => {
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
  });

  it("does not retry anything it cannot positively classify", () => {
    expect(isRetryableError(new Error("Network error"))).toBe(false);
    expect(isRetryableError(new Error("API quota exceeded"))).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("boom")).toBe(false);
    expect(isRetryableError(Object.assign(new Error("x"), { code: 7 }))).toBe(false);
  });

  it("stops walking a self-referential cause chain", () => {
    const err: Record<string, unknown> = { message: "loop" };
    err.cause = err;
    expect(isRetryableError(err)).toBe(false);
  });
});

describe("httpStatusOf", () => {
  it("reads status, statusCode and response.status", () => {
    expect(httpStatusOf(httpError(429))).toBe(429);
    expect(httpStatusOf({ statusCode: 503 })).toBe(503);
    expect(httpStatusOf({ response: { status: 502 } })).toBe(502);
  });

  it("falls back to the two message shapes the providers produce", () => {
    expect(httpStatusOf(GEMINI_429)).toBe(429);
    expect(httpStatusOf(new Error("OpenRouter HTTP 500: upstream"))).toBe(500);
  });

  it("ignores out-of-range or absent codes", () => {
    expect(httpStatusOf(new Error("finished in [200 ms] flat"))).toBeUndefined();
    expect(httpStatusOf({ status: 200 })).toBeUndefined();
    expect(httpStatusOf(new Error("no status here"))).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
    expect(httpStatusOf({ message: 42 })).toBeUndefined();
  });
});

describe("retryAfterMsOf", () => {
  it("reads an explicit millisecond field", () => {
    expect(retryAfterMsOf({ retryAfterMs: 5000 })).toBe(5000);
    expect(retryAfterMsOf({ retryAfterMs: -1 })).toBe(0);
    expect(retryAfterMsOf({ retryAfterMs: Number.NaN })).toBeUndefined();
  });

  it("parses retryDelay / retryAfter in seconds, with an optional unit suffix", () => {
    expect(retryAfterMsOf({ retryDelay: "37s" })).toBe(37_000);
    expect(retryAfterMsOf({ retryDelay: "250ms" })).toBe(250);
    expect(retryAfterMsOf({ retryAfter: "12" })).toBe(12_000);
    expect(retryAfterMsOf({ retryAfter: 3 })).toBe(3000);
    expect(retryAfterMsOf({ retryDelay: "soon", retryAfter: "2" })).toBe(2000);
    expect(retryAfterMsOf({ retryAfter: -5 })).toBeUndefined();
    expect(retryAfterMsOf({ retryAfter: { seconds: 5 } })).toBeUndefined();
  });

  it("reads a Retry-After response header", () => {
    const err = { response: { headers: new Headers({ "retry-after": "8" }) } };
    expect(retryAfterMsOf(err)).toBe(8000);

    const noHeader = { response: { headers: new Headers() } };
    expect(retryAfterMsOf(noHeader)).toBeUndefined();
    expect(retryAfterMsOf({ response: { headers: { get: "not a function" } } })).toBeUndefined();
  });

  it("reads Google's RetryInfo out of the SDK error message", () => {
    expect(retryAfterMsOf(GEMINI_429)).toBe(37_000);
  });

  it("returns undefined when no hint is present", () => {
    expect(retryAfterMsOf(httpError(429))).toBeUndefined();
    expect(retryAfterMsOf(undefined)).toBeUndefined();
  });
});

// ─── Policy ───────────────────────────────────────────────────────────────────

describe("resolveMaxRetries", () => {
  it("defaults to 3 retries (4 attempts)", () => {
    expect(resolveMaxRetries({})).toBe(DEFAULT_MAX_RETRIES);
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "   " })).toBe(DEFAULT_MAX_RETRIES);
  });

  it("honours AI_MAX_RETRIES, and GEMINI_MAX_RETRIES as an alias", () => {
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "6" })).toBe(6);
    expect(resolveMaxRetries({ GEMINI_MAX_RETRIES: "1" })).toBe(1);
    // The provider-neutral name wins when both are set.
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "2", GEMINI_MAX_RETRIES: "9" })).toBe(2);
  });

  it("treats 0 as 'disabled' and rejects nonsense", () => {
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "0" })).toBe(0);
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "-1" })).toBe(DEFAULT_MAX_RETRIES);
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "1.5" })).toBe(DEFAULT_MAX_RETRIES);
    expect(resolveMaxRetries({ AI_MAX_RETRIES: "lots" })).toBe(DEFAULT_MAX_RETRIES);
  });

  it("reads process.env when no environment is passed", () => {
    const saved = process.env.AI_MAX_RETRIES;
    process.env.AI_MAX_RETRIES = "5";
    try {
      expect(resolveMaxRetries()).toBe(5);
    } finally {
      if (saved === undefined) delete process.env.AI_MAX_RETRIES;
      else process.env.AI_MAX_RETRIES = saved;
    }
  });
});

describe("computeDelayMs — full jitter bounds", () => {
  it("stays within [0, min(cap, base × 2^(n−1))] for every attempt", () => {
    const base = 2000;
    const cap = 30_000;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
      for (const r of [0, 0.25, 0.5, 0.999_999, 1]) {
        const delay = computeDelayMs(attempt, {
          baseDelayMs: base,
          maxDelayMs: cap,
          random: () => r,
        });
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("doubles the ceiling per attempt until the cap", () => {
    const full = { baseDelayMs: 2000, maxDelayMs: 30_000, random: () => 1 };
    expect(computeDelayMs(1, full)).toBe(2000);
    expect(computeDelayMs(2, full)).toBe(4000);
    expect(computeDelayMs(3, full)).toBe(8000);
    expect(computeDelayMs(4, full)).toBe(16_000);
    expect(computeDelayMs(5, full)).toBe(30_000); // 32 000 clamped to the cap
    expect(computeDelayMs(9, full)).toBe(30_000);
  });

  it("uses the documented defaults when nothing is passed", () => {
    expect(computeDelayMs(1, { random: () => 1 })).toBe(DEFAULT_BASE_DELAY_MS);
    expect(computeDelayMs(1, { random: () => 0 })).toBe(0);
    expect(computeDelayMs(20, { random: () => 1 })).toBe(DEFAULT_MAX_DELAY_MS);
    // Math.random is the default source; only the bounds are asserted.
    expect(computeDelayMs(1)).toBeLessThanOrEqual(DEFAULT_BASE_DELAY_MS);
  });

  it("uses a server hint verbatim, clamped to [0, cap], and skips the jitter", () => {
    const random = jest.fn(() => 1);
    expect(computeDelayMs(1, { hintMs: 7000, random })).toBe(7000);
    expect(computeDelayMs(1, { hintMs: 90_000, maxDelayMs: 30_000, random })).toBe(30_000);
    expect(computeDelayMs(1, { hintMs: -5, random })).toBe(0);
    expect(random).not.toHaveBeenCalled();
  });
});

// ─── Runner ───────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const { sleep, delays } = recorder();
    const fn = jest.fn(async () => "ok");

    await expect(withRetry(fn, { sleep })).resolves.toBe("ok");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("succeeds after two transient failures (3 calls, 2 backoffs)", async () => {
    const { sleep, delays } = recorder();
    const attempts: RetryAttemptInfo[] = [];
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls <= 2) throw httpError(429, "OpenRouter HTTP 429: rate limited");
      return `ok after ${calls}`;
    });

    const result = await withRetry(fn, {
      sleep,
      random: () => 1, // deterministic: take the full backoff ceiling
      baseDelayMs: 2000,
      maxDelayMs: 30_000,
      onRetry: (info) => attempts.push(info),
    });

    expect(result).toBe("ok after 3");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 4000]);
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(attempts[0]).toMatchObject({ maxAttempts: 4, status: 429, delayMs: 2000 });
    expect(attempts[0]!.hintMs).toBeUndefined();
    expect((attempts[0]!.error as Error).message).toContain("rate limited");
  });

  it("gives up after the maximum attempts and rethrows the last error unchanged", async () => {
    const { sleep, delays } = recorder();
    const last = httpError(503, "HTTP 503 attempt 4");
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      throw calls === 4 ? last : httpError(503, `HTTP 503 attempt ${calls}`);
    });

    await expect(withRetry(fn, { sleep, random: () => 0 })).rejects.toBe(last);

    expect(fn).toHaveBeenCalledTimes(1 + DEFAULT_MAX_RETRIES);
    expect(delays).toHaveLength(DEFAULT_MAX_RETRIES);
  });

  it("does not retry a non-retryable error", async () => {
    const { sleep, delays } = recorder();
    const fn = jest.fn(async () => {
      throw httpError(401, "HTTP 401 invalid API key");
    });

    await expect(withRetry(fn, { sleep })).rejects.toThrow("invalid API key");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("honours a Retry-After hint instead of the jittered backoff", async () => {
    const { sleep, delays } = recorder();
    const attempts: RetryAttemptInfo[] = [];
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls === 1) {
        throw Object.assign(httpError(429), { retryAfterMs: 6500 });
      }
      if (calls === 2) throw GEMINI_429; // RetryInfo "37s", clamped to the cap
      return "ok";
    });

    await expect(
      withRetry(fn, { sleep, random: () => 1, onRetry: (i) => attempts.push(i) })
    ).resolves.toBe("ok");

    expect(delays).toEqual([6500, 30_000]);
    expect(attempts.map((a) => a.hintMs)).toEqual([6500, 37_000]);
  });

  it("maxAttempts: 1 disables retrying entirely (AI_MAX_RETRIES=0)", async () => {
    const { sleep, delays } = recorder();
    const fn = jest.fn(async () => {
      throw httpError(429);
    });

    await expect(withRetry(fn, { sleep, maxAttempts: 1 })).rejects.toMatchObject({ status: 429 });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("clamps a nonsensical maxAttempts to at least one attempt", async () => {
    const fn = jest.fn(async () => "ok");
    await expect(withRetry(fn, { maxAttempts: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses a real (zero-length) timer when no sleep is injected", async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls === 1) throw httpError(500);
      return "ok";
    });

    // random() = 0 ⇒ a 0 ms backoff, so the real setTimeout resolves immediately.
    await expect(withRetry(fn, { random: () => 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
