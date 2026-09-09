/**
 * Structured-output plumbing: turn one model response into a schema-validated
 * object, or into a list of validation issues — never into an exception.
 *
 * Both provider adapters ask the model for a single JSON object (Gemini:
 * `generationConfig.responseMimeType = "application/json"`; OpenRouter:
 * `response_format: { type: "json_object" }`), but a model may still wrap it in
 * a ```json fence, prepend a sentence, or answer in Markdown after a JSON-mode
 * request was refused upstream. The helpers here absorb all three cases and,
 * when the response cannot be validated, report *why* so the caller can record
 * a `ValidationOutcome` and fall back to the free-text parsers.
 *
 * Deliberately dependency-free apart from Zod and free of I/O, so it is a
 * domain-level concern shared by every adapter.
 */
import type { ZodType } from "zod";
import type { ValidationOutcome } from "./types.js";

export interface StructuredSuccess<T> {
  ok: true;
  value: T;
}

export interface StructuredFailure {
  ok: false;
  /** `path: message` pairs, or a single transport-shaped reason. */
  issues: string[];
}

export type StructuredResult<T> = StructuredSuccess<T> | StructuredFailure;

/** Cap on recorded issues, so one badly-shaped array cannot flood an artefact. */
const MAX_ISSUES = 20;

/**
 * Numeric values a model emits *instead of* answering.
 *
 * Observed verbatim in the E4 longitudinal cohort from `google/gemma-4-31b-it`,
 * which answered 24 of 39 records with `{"modality":-1, "quality":-1,
 * "findings":-1, …}`. The schema correctly refuses them, but "expected string,
 * received number" hides *why* the run degraded. Tagging the issue makes the
 * model-dependency finding countable: `grep -c "(model sentinel)"`.
 */
const SENTINEL_NUMBERS: readonly number[] = [-1];

/**
 * Ranges the stage schemas enforce, keyed by the last path segment, so a
 * sentinel in a bounded numeric field reads as the bound it broke.
 */
const RANGE_HINTS: Readonly<Record<string, string>> = {
  confidence: "0–100",
};

/** The value at `path` inside `root`, or `undefined` when the path does not resolve. */
function valueAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || (typeof current !== "object" && typeof current !== "function")) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * Render one Zod issue as the `path: message` string written into the artefact,
 * upgrading the message when the offending value is a known model sentinel.
 */
function describeIssue(
  object: Record<string, unknown>,
  path: readonly PropertyKey[],
  message: string
): string {
  const pathStr = path.length > 0 ? path.map((p) => String(p)).join(".") : "(root)";
  const value = valueAtPath(object, path);
  if (typeof value !== "number" || !SENTINEL_NUMBERS.includes(value)) {
    return `${pathStr}: ${message}`;
  }
  // Reaching here means the path resolved to a number, so it is non-empty.
  const range = RANGE_HINTS[String(path[path.length - 1]!)];
  return range !== undefined
    ? `${pathStr}: ${value} is not in ${range} (model sentinel)`
    : `${pathStr}: ${value} is not a valid value here (model sentinel) — ${message}`;
}

/**
 * Remove a surrounding Markdown code fence (```json … ``` or ``` … ```).
 * Text without a fence is returned trimmed and unchanged.
 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

/**
 * Best-effort extraction of the single JSON object in a model response.
 * Tries the whole (de-fenced) text first, then the widest `{ … }` slice, so a
 * preamble like "Here is the analysis:" does not lose the payload.
 * Returns `undefined` when no JSON object can be recovered.
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const stripped = stripJsonFence(text);
  const candidates = [stripped];
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = stripped.slice(first, last + 1);
    if (slice !== stripped) candidates.push(slice);
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON — try the next candidate.
    }
  }
  return undefined;
}

/**
 * Validate a model response against a Zod schema.
 *
 * Uses `safeParse`, so an invalid response is data (a list of issues), never a
 * thrown error: the pipeline continues on its free-text fallback path.
 */
export function parseStructured<T>(
  text: string | undefined,
  schema: ZodType<T>
): StructuredResult<T> {
  if (text === undefined || text.trim() === "") {
    return { ok: false, issues: ["(root): empty model response"] };
  }
  const object = extractJsonObject(text);
  if (!object) {
    return { ok: false, issues: ["(root): response is not a JSON object"] };
  }
  const result = schema.safeParse(object);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues
      .slice(0, MAX_ISSUES)
      .map((issue) => describeIssue(object, issue.path, issue.message)),
  };
}

/** Render a parse result as the `validation` field written into artefacts. */
export function validationOutcome(result: StructuredResult<unknown>): ValidationOutcome {
  return result.ok ? { ok: true } : { ok: false, issues: result.issues };
}
