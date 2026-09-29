/**
 * Offline tests for the local provider (Ollama / vLLM / llama.cpp behind an
 * OpenAI-compatible endpoint). `fetch` is injected; nothing touches the network.
 * The local path shares the OpenRouter transport, so these tests pin only what
 * differs: the endpoint, the absent-by-default Authorization header, the label
 * in errors, the image policy and the zero-cost usage mapping.
 */
import { describe, it, expect, jest } from "@jest/globals";
import * as path from "path";
import * as url from "url";
import {
  createLocalClient,
  localChatEndpoint,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  LOCAL_REQUEST_TIMEOUT_MS,
} from "../../../src/infrastructure/local-client.js";
import {
  createChatCompletionsModel,
  OpenRouterError,
  type FetchLike,
} from "../../../src/infrastructure/openrouter-client.js";
import { CostMeter } from "../../../src/infrastructure/cost-meter.js";
import { DISCLAIMER } from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.resolve(__dirname, "../../fixtures/test_image.png");

const IMAGE_JSON = JSON.stringify({
  modality: "X-ray",
  anatomyRegion: "Chest",
  quality: "Good",
  findings: ["Clear lung fields"],
  abnormalities: [],
  summary: "No acute abnormality.",
  references: [],
});

interface Capture {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function mockFetch(...responses: Response[]): { fetchImpl: FetchLike; calls: Capture[] } {
  const calls: Capture[] = [];
  const queue = [...responses];
  const fetchImpl = jest.fn<FetchLike>(async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: no more queued responses");
    return next;
  });
  return { fetchImpl, calls };
}

function ok(content: string, usage?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("localChatEndpoint", () => {
  it("appends /chat/completions and tolerates trailing slashes and spaces", () => {
    expect(localChatEndpoint("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/v1/chat/completions"
    );
    expect(localChatEndpoint(" http://localhost:8000/v1// ")).toBe(
      "http://localhost:8000/v1/chat/completions"
    );
  });

  it("defaults to Ollama on the loopback interface and MedGemma 1.5 4B", () => {
    expect(DEFAULT_LOCAL_BASE_URL).toBe("http://127.0.0.1:11434/v1");
    expect(DEFAULT_LOCAL_MODEL).toBe("medgemma1.5:4b");
    expect(LOCAL_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });
});

describe("createLocalClient", () => {
  it("posts to the local endpoint without an Authorization header or OpenRouter attribution", async () => {
    const { fetchImpl, calls } = mockFetch(
      ok(IMAGE_JSON, { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350 })
    );
    const meter = new CostMeter(undefined, { inputUsdPerMillion: 0, outputUsdPerMillion: 0 });
    const client = createLocalClient(
      "http://127.0.0.1:11434/v1",
      "medgemma1.5:4b",
      meter,
      fetchImpl
    );

    const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

    expect(result.status).toBe("success");
    expect(result.validation?.ok).toBe(true);
    expect(result.findings).toEqual(["Clear lung fields"]);
    expect(result.disclaimer).toBe(DISCLAIMER);

    expect(calls).toHaveLength(1);
    const { url: calledUrl, init, body } = calls[0]!;
    expect(calledUrl).toBe("http://127.0.0.1:11434/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(body.model).toBe("medgemma1.5:4b");
    expect(body.response_format).toEqual({ type: "json_object" });

    // Zero pricing: tokens are counted, the estimate stays at $0.
    const totals = meter.summary();
    expect(totals.calls).toBe(1);
    expect(totals.inputTokens).toBe(300);
    expect(totals.estimatedUsd).toBe(0);
  });

  it("sends a bearer token only when an API key is given (vLLM --api-key)", async () => {
    const { fetchImpl, calls } = mockFetch(ok(IMAGE_JSON));
    const client = createLocalClient("http://h:8000/v1", "m", undefined, fetchImpl, {}, "secret");

    await client.analyzeImage(FIXTURE_IMAGE, "series_1");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
  });

  it("treats an empty API key as no key", async () => {
    const { fetchImpl, calls } = mockFetch(ok(IMAGE_JSON));
    const client = createLocalClient("http://h:8000/v1", "m", undefined, fetchImpl, {}, "");

    await client.analyzeImage(FIXTURE_IMAGE, "series_1");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses the Gemma image policy for a MedGemma model id", async () => {
    const { fetchImpl } = mockFetch(ok(IMAGE_JSON));
    const client = createLocalClient(
      DEFAULT_LOCAL_BASE_URL,
      "medgemma1.5:4b",
      undefined,
      fetchImpl
    );
    await client.analyzeImage(FIXTURE_IMAGE, "series_1");
    // The policy is internal to the client; the fixture is small, so the call
    // simply succeeds. The family mapping itself is pinned in image-policy tests.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createChatCompletionsModel — labelled errors", () => {
  it("names the target in HTTP errors and keeps the status for the retry layer", async () => {
    const { fetchImpl } = mockFetch(new Response("model not found", { status: 404 }));
    const model = createChatCompletionsModel(
      { endpoint: "http://127.0.0.1:11434/v1/chat/completions", label: "Local" },
      "missing:model",
      fetchImpl
    );

    const err = await model.generateContent("hi").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpenRouterError);
    expect((err as OpenRouterError).message).toMatch(/^Local HTTP 404: model not found/);
    expect((err as OpenRouterError).status).toBe(404);
  });

  it("names the target when the body has no text content", async () => {
    const { fetchImpl } = mockFetch(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    );
    const model = createChatCompletionsModel(
      { endpoint: "http://x/v1/chat/completions", label: "Local" },
      "m",
      fetchImpl
    );

    await expect(model.generateContent("hi")).rejects.toThrow(
      /^Local response has no choices\[0\]\.message\.content text$/
    );
  });

  it("names the target on a non-JSON body and on an error object", async () => {
    const { fetchImpl } = mockFetch(
      new Response("<html>", { status: 200 }),
      new Response(JSON.stringify({ error: { message: "out of memory", code: 500 } }), {
        status: 200,
      })
    );
    const model = createChatCompletionsModel(
      { endpoint: "http://x/v1/chat/completions", label: "Local" },
      "m",
      fetchImpl
    );

    await expect(model.generateContent("a")).rejects.toThrow(
      /^Local returned a non-JSON response body$/
    );
    await expect(model.generateContent("b")).rejects.toThrow(/^Local error: out of memory$/);
  });
});
