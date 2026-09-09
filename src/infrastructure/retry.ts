/**
 * Bounded retry with exponential backoff and full jitter, shared by every model
 * provider adapter.
 *
 * Why it exists: a reproducibility batch failed mid-run because the
 * Gemini API answered concurrent calls with `429 Too Many Requests … exceeded
 * your current quota`. Nothing about that error is permanent, but the clients
 * had no retry, so a whole experiment was lost to a transient rate limit.
 *
 * Policy (deliberately conservative — this is a medical-imaging CLI, not a
 * high-throughput service):
 *
 * - **Retried:** HTTP `429`, `500`, `502`, `503`, `504`, and genuine transport
 *   failures (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, undici's
 *   `fetch failed` / `socket hang up`, `TimeoutError`, …). These are the errors
 *   where an identical request may well succeed later.
 * - **Never retried:** `400`, `401`, `403`, `404` (the request or the key is
 *   wrong — retrying only burns quota), Zod validation errors (the data is
 *   wrong, not the network), and anything we cannot positively classify as
 *   transient. Unknown ⇒ no retry, so a bug never turns into four bugs.
 * - **Backoff:** full jitter, `delay = random() × min(cap, base × 2^(n−1))`
 *   (AWS "Exponential Backoff and Jitter"). Full jitter is what de-synchronises
 *   the concurrent calls that caused the 429 in the first place; a fixed
 *   backoff would simply re-collide.
 * - **Server hints win:** if the error carries a `Retry-After` header or
 *   Google's `RetryInfo.retryDelay`, that value is used verbatim (clamped to
 *   `[0, cap]`) instead of the jittered delay — the server knows when its
 *   quota window reopens and we should not guess.
 *
 * Defaults: 4 attempts (1 initial + 3 retries), base 2 s, cap 30 s.
 * Configuration: `AI_MAX_RETRIES` (provider-neutral, preferred) or
 * `GEMINI_MAX_RETRIES` (accepted alias) — the number of *retries* after the
 * first attempt. `0` disables retrying entirely (restores the previous
 * behaviour exactly); an unparsable or negative value falls back to the default.
 *
 * `sleep` and `random` are injectable so tests are deterministic and never
 * depend on the wall clock.
 */

/** Number of retries after the first attempt, when nothing overrides it. */
export const DEFAULT_MAX_RETRIES = 3;
/** First backoff ceiling in milliseconds; doubles per attempt. */
export const DEFAULT_BASE_DELAY_MS = 2_000;
/** Upper bound on any single backoff, including server-supplied hints. */
export const DEFAULT_MAX_DELAY_MS = 30_000;

/** Transient HTTP statuses: rate limiting and upstream/gateway failures. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Transport-level failures worth another attempt. Matched on the error `code`
 * (Node/undici set these), not on free-text, so an application error that merely
 * mentions "network" is never retried by accident.
 */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Error names that always mean "the transport gave up", never "the request was
 * wrong". `AbortError` is intentionally absent: an abort is a deliberate
 * cancellation and must not be undone by a retry.
 */
const RETRYABLE_NAMES = new Set(["TimeoutError", "FetchError"]);

/** Undici/Node phrasings that carry no `code` of their own. */
const RETRYABLE_MESSAGES = [/\bfetch failed\b/i, /\bsocket hang up\b/i];

/** How deep to walk `error.cause` when looking for the real transport error. */
const MAX_CAUSE_DEPTH = 5;

// ─── Error introspection ──────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `err` plus its `cause` chain (bounded), so undici-wrapped causes are seen. */
function causeChain(err: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current = asRecord(err);
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    chain.push(current);
    current = asRecord(current.cause);
  }
  return chain;
}

function messageOf(node: Record<string, unknown>): string {
  return typeof node.message === "string" ? node.message : "";
}

function statusFromMessage(message: string): number | undefined {
  // Gemini SDK: "…: [429 Too Many Requests] You exceeded your current quota…"
  // OpenRouter adapter: "OpenRouter HTTP 429: …"
  const match = /\[(\d{3})\s/.exec(message) ?? /\bHTTP (\d{3})\b/.exec(message);
  const code = match ? Number(match[1]) : NaN;
  return code >= 400 && code <= 599 ? code : undefined;
}

/**
 * Best-effort HTTP status for an error, from `status` / `statusCode` /
 * `response.status`, falling back to the two message shapes the Gemini SDK and
 * the OpenRouter adapter produce. `undefined` when the error is not HTTP-shaped.
 */
export function httpStatusOf(err: unknown): number | undefined {
  for (const node of causeChain(err)) {
    const candidates = [node.status, node.statusCode, asRecord(node.response)?.status];
    for (const value of candidates) {
      if (typeof value === "number" && value >= 400 && value <= 599) return value;
    }
    const fromMessage = statusFromMessage(messageOf(node));
    if (fromMessage !== undefined) return fromMessage;
  }
  return undefined;
}

/** A Zod issue list means the *data* is wrong; retrying cannot help. */
function isValidationError(node: Record<string, unknown>): boolean {
  return node.name === "ZodError" || Array.isArray(node.issues);
}

/**
 * `true` only when the error is positively identified as transient: a retryable
 * HTTP status, a known transport error code/name, or an undici phrasing. Any
 * error we cannot classify — including `400/401/403/404` and Zod validation
 * failures — is treated as permanent.
 */
export function isRetryableError(err: unknown): boolean {
  const chain = causeChain(err);
  if (chain.some(isValidationError)) return false;

  const status = httpStatusOf(err);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);

  return chain.some((node) => {
    if (typeof node.code === "string" && RETRYABLE_CODES.has(node.code)) return true;
    if (typeof node.name === "string" && RETRYABLE_NAMES.has(node.name)) return true;
    const message = messageOf(node);
    return RETRYABLE_MESSAGES.some((re) => re.test(message));
  });
}

/**
 * Parse a duration into milliseconds. Bare numbers and bare numeric strings are
 * **seconds** (the `Retry-After` unit); an explicit `ms`/`s` suffix wins, which
 * is how Google reports `RetryInfo.retryDelay` ("37s"). HTTP-date `Retry-After`
 * values are not parsed (neither provider sends them) so nothing here reads the
 * wall clock.
 */
function durationToMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value * 1000 : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2]?.toLowerCase() === "ms" ? amount : amount * 1000;
}

/**
 * Server-supplied "come back in N" hint, in milliseconds, or `undefined`.
 * Reads (in order) an explicit `retryAfterMs`, `retryDelay` / `retryAfter`
 * fields, a `Retry-After` response header, and finally Google's `RetryInfo`
 * blob as embedded in the SDK's error message.
 */
export function retryAfterMsOf(err: unknown): number | undefined {
  for (const node of causeChain(err)) {
    if (typeof node.retryAfterMs === "number" && Number.isFinite(node.retryAfterMs)) {
      return Math.max(0, node.retryAfterMs);
    }
    const direct = durationToMs(node.retryDelay) ?? durationToMs(node.retryAfter);
    if (direct !== undefined) return direct;

    const headers = asRecord(asRecord(node.response)?.headers);
    if (typeof headers?.get === "function") {
      const header = (headers.get as (name: string) => unknown)("retry-after");
      const fromHeader = durationToMs(header);
      if (fromHeader !== undefined) return fromHeader;
    }

    // e.g. {"@type":"…google.rpc.RetryInfo","retryDelay":"37s"} inside the message
    const embedded = /"retryDelay"\s*:\s*"([^"]+)"/.exec(messageOf(node));
    const fromMessage = embedded ? durationToMs(embedded[1]) : undefined;
    if (fromMessage !== undefined) return fromMessage;
  }
  return undefined;
}

// ─── Policy ───────────────────────────────────────────────────────────────────

/**
 * Retries configured by `AI_MAX_RETRIES` (preferred) or `GEMINI_MAX_RETRIES`.
 * `0` disables retrying; unparsable or negative values fall back to
 * {@link DEFAULT_MAX_RETRIES}.
 */
export function resolveMaxRetries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AI_MAX_RETRIES ?? env.GEMINI_MAX_RETRIES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_RETRIES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_RETRIES;
}

export interface DelayOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Server-supplied hint; when present it replaces the jittered backoff. */
  hintMs?: number;
  random?: () => number;
}

/**
 * Delay before retry number `attempt` (1-based). Full jitter over
 * `[0, min(cap, base × 2^(attempt−1))]`, or the clamped server hint when one is
 * available. Always a non-negative integer number of milliseconds.
 */
export function computeDelayMs(attempt: number, opts: DelayOptions = {}): number {
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (opts.hintMs !== undefined) {
    return Math.round(Math.min(maxDelayMs, Math.max(0, opts.hintMs)));
  }
  const random = opts.random ?? Math.random;
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * ceiling);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/** What `onRetry` is told about an attempt that failed and will be retried. */
export interface RetryAttemptInfo {
  /** 1-based index of the attempt that just failed. */
  attempt: number;
  /** Total attempts allowed (1 + retries). */
  maxAttempts: number;
  /** Milliseconds we are about to sleep. */
  delayMs: number;
  /** The error that triggered the retry. */
  error: unknown;
  /** HTTP status, when the error carried one. */
  status?: number;
  /** Server-supplied delay hint, when the error carried one. */
  hintMs?: number;
}

export interface RetryOptions {
  /** Total attempts, including the first. Defaults to `1 + resolveMaxRetries()`. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to `Math.random`. */
  random?: () => number;
  /** Called before each sleep — used to log retries at verbose level. */
  onRetry?: (info: RetryAttemptInfo) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `fn`, retrying only transient failures with jittered exponential backoff.
 *
 * The last error is rethrown unchanged once the attempts are exhausted, so
 * callers keep their existing error handling. `fn` must be safe to run more than
 * once — the model call it wraps is idempotent from the client's point of view.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1 + resolveMaxRetries());
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      const hintMs = retryAfterMsOf(err);
      const delayMs = computeDelayMs(attempt, {
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        random: options.random,
        ...(hintMs !== undefined ? { hintMs } : {}),
      });
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error: err,
        ...(httpStatusOf(err) !== undefined ? { status: httpStatusOf(err) } : {}),
        ...(hintMs !== undefined ? { hintMs } : {}),
      });
      await sleep(delayMs);
    }
  }
}
