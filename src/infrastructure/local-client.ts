/**
 * Local provider — a model served on this machine (or a host the operator
 * controls) through an OpenAI-compatible `chat/completions` endpoint: Ollama
 * (`/v1`), vLLM (`vllm serve`), llama.cpp `llama-server`, LM Studio.
 *
 * Why it exists: some data may not leave the machine at all. PhysioNet's policy
 * on LLM services (2025-09-24) requires that credentialed data is not retained
 * by third-party services and strongly recommends locally deployed models; the
 * same route runs openly licensed data at zero API cost. See
 * `docs/architecture/LOCAL-INFERENCE.md` and ROADMAP C5.
 *
 * Same transport as OpenRouter (`createChatCompletionsModel`), so the prompts,
 * Zod schemas, JSON mode, retries and probes are unchanged. Differences:
 * - no API key by default (`LOCAL_LLM_API_KEY` is sent as a bearer token only
 *   when set, for servers started with `--api-key`);
 * - zero pricing: the cost meter reports $0 and a cost cap never trips;
 * - a longer per-request timeout, because a small GPU is slow;
 * - the image pre-flight uses the policy of the model family (`medgemma` →
 *   the Gemma profile, 896 px).
 * The endpoint is whatever `LOCAL_LLM_BASE_URL` says. Pointing it at a remote
 * host sends the images there; the default is the loopback interface.
 */
import {
  createGeminiClient,
  type GeminiClient,
  type GeminiClientOptions,
} from "./gemini-client.js";
import { resolvePolicy } from "./image-policy.js";
import type { CostMeter } from "./cost-meter.js";
import { createChatCompletionsModel, type FetchLike } from "./openrouter-client.js";

/** Ollama's OpenAI-compatible API on the loopback interface. */
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
/** MedGemma 1.5 4B (Ollama tag), about 3.3 GB, fits a 6 GB GPU. */
export const DEFAULT_LOCAL_MODEL = "medgemma1.5:4b";
/** A 4B vision model on a laptop GPU can take minutes on a large prompt. */
export const LOCAL_REQUEST_TIMEOUT_MS = 600_000;

/** `<base>/chat/completions`, tolerating a trailing slash on the base URL. */
export function localChatEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Build the `GeminiClient` port on top of a local OpenAI-compatible server.
 * Drop-in for `createOpenRouterClient`.
 */
export function createLocalClient(
  baseUrl: string,
  modelId: string,
  meter?: CostMeter,
  fetchImpl?: FetchLike,
  options: GeminiClientOptions = {},
  apiKey?: string
): GeminiClient {
  const model = createChatCompletionsModel(
    {
      endpoint: localChatEndpoint(baseUrl),
      label: "Local",
      ...(apiKey !== undefined && apiKey !== "" ? { authorization: `Bearer ${apiKey}` } : {}),
      timeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
    },
    modelId,
    fetchImpl
  );
  return createGeminiClient(model, meter, {
    ...options,
    imagePolicy: options.imagePolicy ?? resolvePolicy("local", modelId),
  });
}
