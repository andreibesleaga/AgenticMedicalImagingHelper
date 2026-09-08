/**
 * Offline tests for the OpenRouter adapter. `fetch` is injected as a jest mock;
 * nothing touches the network. The adapter must behave exactly like the Gemini
 * path from the port's point of view (same prompts, same parsers, same error
 * folding) while mapping OpenRouter's wire format honestly.
 */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import * as path from "path";
import * as url from "url";
import {
  createOpenRouterClient,
  createOpenRouterModel,
  mapOpenRouterUsage,
  toOpenRouterContent,
  OpenRouterError,
  OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_MODEL,
  parseRetryAfterMs,
  requestsJsonOutput,
  type FetchLike,
} from "../../../src/infrastructure/openrouter-client.js";
import { withJsonMode } from "../../../src/infrastructure/gemini-client.js";
import type { RetryAttemptInfo } from "../../../src/infrastructure/retry.js";
import { CostMeter, CostCapExceededError } from "../../../src/infrastructure/cost-meter.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.resolve(__dirname, "../../fixtures/test_image.png");
const PRICING = { inputUsdPerMillion: 1, outputUsdPerMillion: 10 };

const MARKDOWN_RESPONSE = `### 1. Image Type & Region
- Modality: X-ray
- Region: Chest

### 2. Key Findings
- Clear lung fields
- Normal cardiac silhouette

### 3. Diagnostic Assessment
- Primary: Normal chest X-ray

### 4. Patient-Friendly Explanation
Your chest X-ray looks normal.
`;

// A model that fences its JSON despite the instruction not to: the fence is
// stripped before validation, and the raw text is still kept verbatim.
const FENCED_JSON_RESPONSE =
  "```json\n" +
  JSON.stringify({
    modality: "CT",
    anatomyRegion: "Abdomen",
    quality: "Fair",
    findings: ["Stable appearances"],
    abnormalities: [],
    summary: "Nothing new compared with the previous study.",
    references: [],
  }) +
  "\n```";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RequestCapture {
  url: string;
  init: RequestInit;
  body: {
    model: string;
    messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    usage?: { include: boolean };
    response_format?: unknown;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okBody(content: unknown, usage?: Record<string, unknown>) {
  return { choices: [{ message: { role: "assistant", content } }], usage };
}

function mockFetch(...responses: Response[]): { fetchImpl: FetchLike; calls: RequestCapture[] } {
  const calls: RequestCapture[] = [];
  const queue = [...responses];
  const fetchImpl = jest.fn<FetchLike>(async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)) as RequestCapture["body"],
    });
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: no more queued responses");
    return next;
  });
  return { fetchImpl, calls };
}

const baseAnalysis: ImageAnalysis = {
  status: "success",
  imagePath: "/fake/img.png",
  seriesId: "series_1",
  rawResponse: "Analysis 1",
  processedAt: "2026-01-01T00:00:00.000Z",
  disclaimer: DISCLAIMER,
};

function makeSummary(seriesId: string): SeriesSummary {
  return {
    seriesId,
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: [],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: `report ${seriesId}`,
    processedAt: "2026-01-01T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

const SERIES_JSON = JSON.stringify({
  consistentFindings: ["No interval change"],
  discrepancies: [],
  primaryDiagnosis: "Stable post-operative appearances",
  differentialDiagnoses: [],
  confidenceLevel: "Medium",
  report: "## Series\n\nStable.",
});

const EVOLUTION_JSON = JSON.stringify({
  progression: "Improving",
  trends: [{ finding: "Effusion", trend: "Improving", details: "Smaller than the prior study" }],
  forecastedEvolution: "Continued resolution is expected.",
  treatmentRecommendations: ["Continue current monitoring interval"],
  combinedReport: "## Evolution\n\nImproving.",
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createOpenRouterClient — request shape", () => {
  it("posts one user message with the image as a data URL and the prompt as text", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(okBody(MARKDOWN_RESPONSE)));
    const client = createOpenRouterClient("sk-or-test", "openai/gpt-4o", undefined, fetchImpl);

    const result = await client.analyzeImage(FIXTURE_IMAGE, "series_1");

    expect(result.status).toBe("success");
    // The Markdown answer fails schema validation and falls back to patterns.
    expect(result.validation?.ok).toBe(false);
    expect(result.modality).toBe("X-ray");
    expect(result.findings).toEqual(["Clear lung fields", "Normal cardiac silhouette"]);
    expect(result.disclaimer).toBe(DISCLAIMER);

    expect(calls).toHaveLength(1);
    const { url: calledUrl, init, body } = calls[0]!;
    expect(calledUrl).toBe(OPENROUTER_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
    expect(headers["HTTP-Referer"]).toMatch(/^https:\/\/github\.com\//);
    expect(headers["X-Title"]).toBe("AgenticMedicalImagingHelper");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(body.model).toBe("openai/gpt-4o");
    expect(body.usage).toEqual({ include: true });
    // The shared client asks for JSON mode, mapped to OpenAI's response_format.
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
    const parts = body.messages[0]!.content;
    const image = parts.find((p) => p.type === "image_url") as {
      image_url: { url: string };
    };
    expect(image.image_url.url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    const text = parts.find((p) => p.type === "text") as { text: string };
    expect(text.text).toContain("medical imaging expert");
    expect(text.text).toContain(DISCLAIMER);
  });

  it("sends a plain string prompt as a single text part (series synthesis)", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(okBody("## Series\n- Primary: Normal")));
    const client = createOpenRouterClient("k", DEFAULT_OPENROUTER_MODEL, undefined, fetchImpl);

    const result = await client.synthesizeSeries("series_1", [baseAnalysis], "Patient has COPD");

    expect(result.primaryDiagnosis).toBe("Normal");
    expect(result.textContextUsed).toBe(true);
    const parts = calls[0]!.body.messages[0]!.content;
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("text");
    expect(String(parts[0]!.text)).toContain("Patient has COPD");
    expect(calls[0]!.body.model).toBe("google/gemini-2.5-flash");
  });

  it("maps array-form requests and rejects unsupported part kinds", () => {
    const content = toOpenRouterContent([
      "hello",
      { text: "world" },
      { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
    ]);
    expect(content).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
    ]);

    expect(() => toOpenRouterContent([{ functionCall: { name: "f", args: {} } }])).toThrow(
      OpenRouterError
    );
  });
});

describe("createOpenRouterClient — response mapping", () => {
  it("validates fenced JSON and keeps the fenced text verbatim as rawResponse", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(okBody(FENCED_JSON_RESPONSE)));
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl);

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("success");
    expect(result.rawResponse).toBe(FENCED_JSON_RESPONSE);
    expect(result.validation).toEqual({ ok: true });
    expect(result.modality).toBe("CT");
    expect(result.anatomyRegion).toBe("Abdomen");
    expect(result.quality).toBe("Fair");
    expect(result.findings).toEqual(["Stable appearances"]);
    expect(result.abnormalities).toEqual([]);
  });

  it("joins array-of-parts content returned by some providers", async () => {
    const parts = [
      { type: "text", text: "Progression: " },
      { type: "image_url", image_url: { url: "x" } },
      { type: "text", text: "Worsening" },
      null,
    ];
    const { fetchImpl } = mockFetch(jsonResponse(okBody(parts)));
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl);

    const result = await client.analyzeEvolution([makeSummary("s1"), makeSummary("s2")], undefined);

    expect(result.combinedReport).toBe("Progression: Worsening");
    expect(result.progression).toBe("Worsening");
  });

  it("folds an HTTP error into status=error when retries are disabled", async () => {
    const { fetchImpl, calls } = mockFetch(
      new Response("Rate limit exceeded", { status: 429, statusText: "Too Many Requests" })
    );
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl, {
      retry: { maxAttempts: 1 },
    });

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("OpenRouter HTTP 429");
    expect(result.errorMessage).toContain("Rate limit exceeded");
    expect(calls).toHaveLength(1);
  });

  it("surfaces an HTTP error with an empty body and carries the status code", async () => {
    const { fetchImpl } = mockFetch(new Response(null, { status: 500 }));
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 500,
      message: "OpenRouter HTTP 500",
    });
  });

  it("rejects a non-JSON success body", async () => {
    const { fetchImpl } = mockFetch(new Response("<html>gateway</html>", { status: 200 }));
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toThrow(/non-JSON/);
  });

  it("rejects an error object delivered with HTTP 200", async () => {
    const { fetchImpl } = mockFetch(
      jsonResponse({ error: { message: "Provider returned error", code: 502 } })
    );
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toMatchObject({
      status: 502,
      message: "OpenRouter error: Provider returned error",
    });
  });

  it("rejects an error object without a message", async () => {
    const { fetchImpl } = mockFetch(jsonResponse({ error: {} }));
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toThrow("OpenRouter error: unknown");
  });

  it("rejects malformed content (no choices, or non-text content)", async () => {
    const { fetchImpl } = mockFetch(jsonResponse({ choices: [] }), jsonResponse(okBody(42)));
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toThrow(/no choices\[0\]\.message\.content/);
    await expect(model.generateContent("hi")).rejects.toBeInstanceOf(OpenRouterError);
  });
});

describe("OpenRouter usage → cost meter", () => {
  it("maps prompt/completion tokens and provider cost; reasoning tokens are not double-counted", async () => {
    const usage = {
      prompt_tokens: 1000,
      completion_tokens: 200, // already includes the 150 reasoning tokens below
      total_tokens: 1200,
      cost: 0.0034,
      completion_tokens_details: { reasoning_tokens: 150 },
    };
    const { fetchImpl } = mockFetch(jsonResponse(okBody(MARKDOWN_RESPONSE, usage)));
    const meter = new CostMeter(undefined, PRICING);
    const client = createOpenRouterClient("k", "m", meter, fetchImpl);

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("success");
    const s = meter.summary();
    expect(s.calls).toBe(1);
    expect(s.inputTokens).toBe(1000);
    expect(s.outputTokens).toBe(200);
    expect(s.estimatedUsd).toBeCloseTo(1000e-6 * 1 + 200e-6 * 10, 12);
    expect(s.providerReportedUsd).toBeCloseTo(0.0034, 12);
  });

  it("mapOpenRouterUsage handles missing usage, missing fields and non-numeric cost", () => {
    expect(mapOpenRouterUsage(undefined)).toBeUndefined();

    expect(mapOpenRouterUsage({})).toEqual({
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      totalTokenCount: 0,
    });

    const partial = mapOpenRouterUsage({ prompt_tokens: 7, completion_tokens: 3 });
    expect(partial?.totalTokenCount).toBe(10);
    expect(partial).not.toHaveProperty("providerCostUsd");

    const bad = mapOpenRouterUsage({ cost: "0.1" as unknown as number });
    expect(bad).not.toHaveProperty("providerCostUsd");

    const free = mapOpenRouterUsage({ cost: 0 });
    expect(free?.providerCostUsd).toBe(0);
  });

  it("records nothing when the response carries no usage but still succeeds", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(okBody(MARKDOWN_RESPONSE)));
    const meter = new CostMeter(undefined, PRICING);
    const client = createOpenRouterClient("k", "m", meter, fetchImpl);

    await client.analyzeImage(FIXTURE_IMAGE, "s1");

    const s = meter.summary();
    expect(s.calls).toBe(1);
    expect(s.inputTokens).toBe(0);
    expect(s.providerReportedUsd).toBeUndefined();
  });

  it("propagates CostCapExceededError past the per-image catch, like the Gemini path", async () => {
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, cost: 1 };
    const { fetchImpl } = mockFetch(jsonResponse(okBody(MARKDOWN_RESPONSE, usage)));
    const meter = new CostMeter(0.000001, PRICING);
    const client = createOpenRouterClient("k", "m", meter, fetchImpl);

    await expect(client.analyzeImage(FIXTURE_IMAGE, "s1")).rejects.toBeInstanceOf(
      CostCapExceededError
    );
  });
});

describe("OpenRouter retry integration", () => {
  const noSleep = (delays: number[]) => async (ms: number) => {
    delays.push(ms);
  };

  it("retries a 429 and succeeds, metering the successful call exactly once", async () => {
    const delays: number[] = [];
    const attempts: RetryAttemptInfo[] = [];
    const usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 };
    const { fetchImpl, calls } = mockFetch(
      new Response("Rate limit exceeded", {
        status: 429,
        headers: { "retry-after": "3" },
      }),
      new Response(null, { status: 503 }),
      jsonResponse(okBody(MARKDOWN_RESPONSE, usage))
    );
    const meter = new CostMeter(undefined, PRICING);
    const client = createOpenRouterClient("k", "m", meter, fetchImpl, {
      retry: {
        sleep: noSleep(delays),
        random: () => 1,
        baseDelayMs: 100,
        maxDelayMs: 30_000,
        onRetry: (info) => attempts.push(info),
      },
    });

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("success");
    expect(result.modality).toBe("X-ray");
    expect(calls).toHaveLength(3);
    // First backoff comes from the Retry-After header, the second from jitter.
    expect(delays).toEqual([3000, 200]);
    expect(attempts.map((a) => a.status)).toEqual([429, 503]);

    // The two failed attempts reported no usage, so nothing was double-counted.
    const s = meter.summary();
    expect(s.calls).toBe(1);
    expect(s.inputTokens).toBe(100);
    expect(s.outputTokens).toBe(10);
    expect(s.providerReportedUsd).toBeCloseTo(0.001, 12);
  });

  it("gives up after the configured attempts and folds the last 429 into status=error", async () => {
    const delays: number[] = [];
    const { fetchImpl, calls } = mockFetch(
      new Response("quota", { status: 429 }),
      new Response("quota", { status: 429 }),
      new Response("quota", { status: 429 })
    );
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl, {
      retry: { maxAttempts: 3, sleep: noSleep(delays), random: () => 0 },
    });

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("OpenRouter HTTP 429");
    expect(calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
  });

  it("does not retry a 401 — the key is wrong, not the network", async () => {
    const delays: number[] = [];
    const { fetchImpl, calls } = mockFetch(new Response("no auth", { status: 401 }));
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl, {
      retry: { sleep: noSleep(delays) },
    });

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("OpenRouter HTTP 401");
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("parses Retry-After onto the error, ignoring absent and HTTP-date forms", async () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfterMs("-1")).toBeUndefined();

    const { fetchImpl } = mockFetch(
      new Response("slow down", { status: 429, headers: { "retry-after": "12" } })
    );
    const model = createOpenRouterModel("k", "m", fetchImpl);
    await expect(model.generateContent("hi")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 12_000,
    });
  });
});

describe("createOpenRouterModel — default transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the global fetch when none is injected", async () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(okBody("from global fetch")));
    const model = createOpenRouterModel("k", "m");

    const result = await model.generateContent("hi");

    expect(result.response.text()).toBe("from global fetch");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toBe(OPENROUTER_ENDPOINT);
  });
});

describe("OpenRouter JSON mode", () => {
  it("requestsJsonOutput only fires for a request carrying the JSON generationConfig", () => {
    expect(requestsJsonOutput(withJsonMode("prompt"))).toBe(true);
    expect(requestsJsonOutput("prompt")).toBe(false);
    expect(requestsJsonOutput(["a", { text: "b" }])).toBe(false);
    expect(requestsJsonOutput({ contents: [{ role: "user", parts: [{ text: "x" }] }] })).toBe(
      false
    );
    expect(
      requestsJsonOutput({
        contents: [{ role: "user", parts: [{ text: "x" }] }],
        generationConfig: { responseMimeType: "text/plain" },
      })
    ).toBe(false);
  });

  it("omits response_format for a request that did not ask for JSON", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(okBody("plain answer")));
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await model.generateContent("hi");

    expect(calls[0]!.body.response_format).toBeUndefined();
  });

  it("asks for JSON on the series and evolution calls as well", async () => {
    const { fetchImpl, calls } = mockFetch(
      jsonResponse(okBody(SERIES_JSON)),
      jsonResponse(okBody(EVOLUTION_JSON))
    );
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl);

    const series = await client.synthesizeSeries("series_1", [baseAnalysis], undefined);
    const evolution = await client.analyzeEvolution(
      [makeSummary("s1"), makeSummary("s2")],
      undefined
    );

    expect(calls[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(calls[1]!.body.response_format).toEqual({ type: "json_object" });
    expect(series.validation).toEqual({ ok: true });
    expect(series.confidenceLevel).toBe("Medium");
    expect(series.consistentFindings).toEqual(["No interval change"]);
    expect(evolution.validation).toEqual({ ok: true });
    expect(evolution.progression).toBe("Improving");
    expect(evolution.trends).toHaveLength(1);
    expect(evolution.treatmentRecommendations).toEqual(["Continue current monitoring interval"]);
  });

  it("folds an unparseable answer into a recorded validation failure, not a crash", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(okBody("I cannot help with that.")));
    const client = createOpenRouterClient("k", "m", undefined, fetchImpl);

    const result = await client.analyzeImage(FIXTURE_IMAGE, "s1");

    expect(result.status).toBe("success");
    expect(result.validation).toEqual({
      ok: false,
      issues: ["(root): response is not a JSON object"],
    });
    expect(result.disclaimer).toBe(DISCLAIMER);
  });
});

describe("OpenRouter transport edges", () => {
  it("still reports an HTTP error when the error body cannot be read", async () => {
    const broken = {
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream closed")),
      headers: new Headers(),
    } as unknown as Response;
    const { fetchImpl } = mockFetch(broken);
    const model = createOpenRouterModel("k", "m", fetchImpl);

    await expect(model.generateContent("hi")).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 502,
      message: "OpenRouter HTTP 502",
    });
  });
});
