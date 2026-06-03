/**
 * Minimal zero-dependency structured logger.
 *
 * - Emits one JSON object per line to **stderr** (never stdout, so the CLI's
 *   stdout contract is untouched).
 * - **Silent by default.** Output only when `LOG_LEVEL` (or an explicit level)
 *   is one of error/warn/info/debug — so the default run is byte-identical.
 * - **Redacts secrets**: any configured API key value, and common sensitive
 *   field names (authorization, token, apiKey, …).
 *
 * Kept dependency-free on purpose: a CLI should not pull a logging framework
 * into its supply chain for a handful of structured lines.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const LEVEL_NAMES = new Set<string>(["silent", "error", "warn", "info", "debug"]);

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const env = (process.env.LOG_LEVEL ?? "").toLowerCase();
  return (LEVEL_NAMES.has(env) ? env : "silent") as LogLevel;
}

/** Concrete secret values that must never appear in any log line. */
function secretValues(): string[] {
  return [process.env.GOOGLE_API_KEY, process.env.GEMINI_API_KEY].filter(
    (v): v is string => typeof v === "string" && v.length >= 6
  );
}

const REDACT_KEYS = new Set([
  "apikey",
  "api_key",
  "googleapikey",
  "google_api_key",
  "geminiapikey",
  "gemini_api_key",
  "authorization",
  "token",
  "password",
  "secret",
  "key",
]);

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const s of secrets) {
      if (out.includes(s)) out = out.split(s).join("[REDACTED]");
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value && typeof value === "object") {
    return redactObject(value as Record<string, unknown>, secrets);
  }
  return value;
}

function redactObject(
  obj: Record<string, unknown>,
  secrets: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactValue(v, secrets);
  }
  return out;
}

export interface Logger {
  readonly level: LogLevel;
  error(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Create a logger.
 *
 * @param level  Explicit level (defaults to `LOG_LEVEL` env, else `silent`).
 * @param write  Sink for each rendered line (defaults to stderr). Injectable for tests.
 */
export function createLogger(
  level?: LogLevel,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  }
): Logger {
  const resolved = resolveLevel(level);
  const threshold = ORDER[resolved];

  const emit = (at: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (threshold === 0 || ORDER[at] > threshold) return;
    const secrets = secretValues();
    const record = {
      level: at,
      time: new Date().toISOString(),
      event,
      ...(fields ? redactObject(fields, secrets) : {}),
    };
    write(`${JSON.stringify(record)}\n`);
  };

  return {
    level: resolved,
    error: (event, fields) => emit("error", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
  };
}
