/**
 * OpenRouter adapter — a second model provider behind the same port as Gemini.
 *
 * OpenRouter exposes an OpenAI-compatible `chat/completions` endpoint that
 * fronts many vision-capable models. This module implements the small
 * `ContentGenerator` surface that `createGeminiClient` depends on, so the
 * prompts, response parsers, error handling and LangGraph wiring are reused
 * verbatim — only the transport changes. It exists to test the single-model
 * monoculture risk recorded in ADR-004 (see ADR-006). Gemini remains the default.
 *
 * Honest differences from the Gemini path:
 * - No Google Search grounding (ADR-002 is a Gemini-only tool). The prompt's
 *   "Research Context" section is answered from model knowledge alone.
 * - JSON mode is requested exactly when the shared client asks for it: a
 *   request carrying `generationConfig.responseMimeType === "application/json"`
 *   (see `gemini-client.ts:withJsonMode`) is sent with OpenAI's
 *   `response_format: { type: "json_object" }`, so both providers return the
 *   structured record the Zod schemas validate. Anything else is sent as-is.
 * - Retries are shared with the Gemini path (`retry.ts`): transient statuses
 *   (429/5xx) and transport failures are retried with jittered backoff, and a
 *   `Retry-After` header on the response is forwarded as `retryAfterMs` so the
 *   backoff honours it. A 400/401/403/404 still surfaces immediately.
 * - Usage is mapped from OpenRouter's normalised `usage` object. Reasoning
 *   tokens are already counted inside `completion_tokens` ("Reasoning tokens are
 *   considered output tokens and charged accordingly",
 *   https://openrouter.ai/docs/use-cases/reasoning-tokens), so `thoughtsTokenCount`
 *   is reported as 0 to avoid double-counting in the cost meter. `usage.cost` is
 *   the charge in credits, whose "base currency is US dollars"
 *   (https://openrouter.ai/docs/faq); it is forwarded as `providerCostUsd`.
 *
 * Uses the global `fetch` (Node ≥ 20); no new dependency.
 */
import type { GenerateContentRequest, Part } from "@google/generative-ai";
import {
  createGeminiClient,
  type ContentGenerator,
  type GeminiClient,
  type GenerateRequest,
} from "./gemini-client.js";
import type { GeminiClientOptions } from "./gemini-client.js";
import { resolvePolicy } from "./image-policy.js";
import type { CostMeter, TokenUsage } from "./cost-meter.js";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** Same model family as the Google default, routed through OpenRouter. */
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
/** Attribution headers OpenRouter uses for app rankings; non-secret. */
export const OPENROUTER_REFERER = "https://github.com/andreibesleaga/AgenticMedicalImagingHelper";
export const OPENROUTER_TITLE = "AgenticMedicalImagingHelper";
/** Upper bound on one request; a hung provider must not hang the CLI. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Injectable fetch, so tests run fully offline. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// ─── Wire types (subset we depend on) ─────────────────────────────────────────

type OpenRouterContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** https://openrouter.ai/docs/use-cases/usage-accounting */
export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Charge in credits (USD-denominated). */
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: OpenRouterUsage;
  /** OpenRouter can return an error object with HTTP 200 for upstream failures. */
  error?: { message?: string; code?: number };
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** `Retry-After` from the response, in milliseconds, when the server sent one. */
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/**
 * `Retry-After` in milliseconds. Only the delta-seconds form is parsed (the one
 * OpenRouter sends); an HTTP-date value is ignored so nothing here depends on
 * the wall clock, and the jittered default backoff applies instead.
 */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

// ─── Request mapping ──────────────────────────────────────────────────────────

function partToContent(part: string | Part): OpenRouterContentPart {
  if (typeof part === "string") return { type: "text", text: part };
  if (typeof part.text === "string") return { type: "text", text: part.text };
  if (part.inlineData) {
    const { mimeType, data } = part.inlineData;
    return { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } };
  }
  throw new OpenRouterError(
    "Unsupported content part for OpenRouter (only text and inlineData are mapped)"
  );
}

/**
 * True when the shared client asked for JSON mode on this request. Only the
 * full-request shape can carry a `generationConfig`; a bare string or parts
 * array never does.
 */
export function requestsJsonOutput(request: GenerateRequest): boolean {
  if (typeof request === "string" || Array.isArray(request)) return false;
  return (
    (request as GenerateContentRequest).generationConfig?.responseMimeType === "application/json"
  );
}

/** Flatten a Gemini-style request into one OpenAI-style user message. */
export function toOpenRouterContent(request: GenerateRequest): OpenRouterContentPart[] {
  if (typeof request === "string") return [{ type: "text", text: request }];
  if (Array.isArray(request)) return request.map(partToContent);
  return request.contents.flatMap((c) => c.parts.map(partToContent));
}

// ─── Response mapping ─────────────────────────────────────────────────────────

/**
 * Map OpenRouter usage onto the meter's Gemini-shaped `TokenUsage`. Reasoning
 * tokens are NOT added again: OpenRouter already includes them in
 * `completion_tokens` (see module doc). `cost` is forwarded only when numeric.
 */
export function mapOpenRouterUsage(usage: OpenRouterUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokenCount = usage.prompt_tokens ?? 0;
  const candidatesTokenCount = usage.completion_tokens ?? 0;
  return {
    promptTokenCount,
    candidatesTokenCount,
    thoughtsTokenCount: 0,
    totalTokenCount: usage.total_tokens ?? promptTokenCount + candidatesTokenCount,
    ...(typeof usage.cost === "number" && Number.isFinite(usage.cost)
      ? { providerCostUsd: usage.cost }
      : {}),
  };
}

function extractText(json: OpenRouterResponse): string {
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // Some providers return an array of typed parts; keep the text ones.
  if (Array.isArray(content)) {
    return content
      .map((p: unknown) => {
        const text = (p as { text?: unknown } | null)?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  throw new OpenRouterError("OpenRouter response has no choices[0].message.content text");
}

// ─── Model shim ───────────────────────────────────────────────────────────────

/**
 * A `ContentGenerator` backed by OpenRouter's chat-completions endpoint.
 *
 * @param apiKey     OpenRouter API key (`OPENROUTER_API_KEY`).
 * @param modelId    OpenRouter model id, e.g. `google/gemini-2.5-flash`,
 *                   `openai/gpt-4o`, `qwen/qwen2.5-vl-72b-instruct`.
 * @param fetchImpl  Injectable fetch (defaults to the global one).
 */
export function createOpenRouterModel(
  apiKey: string,
  modelId: string,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init)
): ContentGenerator {
  return {
    async generateContent(request) {
      const body = {
        model: modelId,
        messages: [{ role: "user", content: toOpenRouterContent(request) }],
        usage: { include: true },
        // https://openrouter.ai/docs/features/structured-outputs
        ...(requestsJsonOutput(request)
          ? { response_format: { type: "json_object" as const } }
          : {}),
      };

      const res = await fetchImpl(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": OPENROUTER_REFERER,
          "X-Title": OPENROUTER_TITLE,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new OpenRouterError(
          `OpenRouter HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
          res.status,
          parseRetryAfterMs(res.headers.get("retry-after"))
        );
      }

      let json: OpenRouterResponse;
      try {
        json = (await res.json()) as OpenRouterResponse;
      } catch {
        throw new OpenRouterError("OpenRouter returned a non-JSON response body", res.status);
      }
      if (json.error) {
        throw new OpenRouterError(
          `OpenRouter error: ${json.error.message ?? "unknown"}`,
          json.error.code
        );
      }

      const text = extractText(json);
      const usageMetadata = mapOpenRouterUsage(json.usage);
      return { response: { text: () => text, usageMetadata } };
    },
  };
}

// ─── Client factory (same port as createGeminiClient) ─────────────────────────

/**
 * Build the `GeminiClient` port on top of OpenRouter. Drop-in for
 * `createGeminiClient(createGeminiModelFromSdk(...), meter)`.
 */
export function createOpenRouterClient(
  apiKey: string,
  modelId: string,
  meter?: CostMeter,
  fetchImpl?: FetchLike,
  options: GeminiClientOptions = {}
): GeminiClient {
  // The image pre-flight sizes for the model that will actually read the image.
  // Only this factory knows the OpenRouter model id (`anthropic/claude-…`,
  // `qwen/qwen2.5-vl-…`, `google/gemma-3-…`), so it resolves the policy here
  // rather than letting the shared client guess it from the environment.
  const withPolicy: GeminiClientOptions = {
    ...options,
    imagePolicy: options.imagePolicy ?? resolvePolicy("openrouter", modelId),
  };
  return createGeminiClient(createOpenRouterModel(apiKey, modelId, fetchImpl), meter, withPolicy);
}
