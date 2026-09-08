/**
 * The image pre-flight as the two clients actually use it.
 *
 * `image-policy.test.ts` covers the decision rules in isolation; this file
 * covers the wiring: that the bytes and the media type placed on the request are
 * the ones the pre-flight produced, that the provenance record reaches the
 * emitted `ImageAnalysis`, and that the environment knobs are honoured through
 * the public client factories. Both providers are driven by fakes — no network,
 * no API key.
 */
import { describe, it, expect, jest, beforeAll, afterAll, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import type { GenerativeModel } from "@google/generative-ai";
import {
  createGeminiClient,
  prepareImage,
  prepareImageForGemini,
} from "../../../src/infrastructure/gemini-client.js";
import {
  createOpenRouterClient,
  type FetchLike,
} from "../../../src/infrastructure/openrouter-client.js";
import { resolvePolicy } from "../../../src/infrastructure/image-policy.js";
import { ImagePreprocessingRecordSchema } from "../../../src/domain/types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let DIR: string;
const file = (name: string): string => path.join(DIR, name);

function pixels(width: number, height: number): Buffer {
  const px = Buffer.allocUnsafe(width * height);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7) % 251;
  return px;
}

const grey = (w: number, h: number) =>
  sharp(pixels(w, h), { raw: { width: w, height: h, channels: 1 } }).toColourspace("b-w");

beforeAll(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "image-wiring-"));
  await grey(224, 224).png().toFile(file("small.png"));
  await grey(224, 224).jpeg({ quality: 92 }).toFile(file("small.jpg"));
  await grey(2000, 2000).png().toFile(file("large.png"));
  fs.writeFileSync(file("corrupt.png"), Buffer.from("definitely not a PNG"));
}, 120_000);

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

const ENV_KEYS = [
  "IMAGE_QUALITY",
  "IMAGE_MAX_DIM",
  "IMAGE_JPEG_FOR_PHOTO",
  "GEMINI_MODEL",
  "AI_PROVIDER",
  "OPENROUTER_MODEL",
];
const SAVED: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) SAVED[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

const IMAGE_JSON = JSON.stringify({
  modality: "X-ray",
  anatomyRegion: "Chest (PA)",
  quality: "Good",
  findings: ["Clear lung fields"],
  abnormalities: [],
  summary: "Unremarkable study.",
  references: [],
});

// ─── Gemini path ──────────────────────────────────────────────────────────────

interface InlineData {
  data: string;
  mimeType: string;
}

interface Captured {
  model: GenerativeModel;
  inline: () => InlineData;
}

function captureModel(responseText = IMAGE_JSON): Captured {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = jest.fn<(request: any) => Promise<{ response: { text: () => string } }>>();
  fn.mockResolvedValue({ response: { text: () => responseText } });
  return {
    model: { generateContent: fn } as unknown as GenerativeModel,
    inline: () => {
      const request = fn.mock.calls[0]?.[0] as {
        contents: Array<{ parts: Array<{ inlineData?: InlineData }> }>;
      };
      const part = request.contents.flatMap((c) => c.parts).find((p) => p.inlineData !== undefined);
      if (!part?.inlineData) throw new Error("no inlineData part was sent");
      return part.inlineData;
    },
  };
}

describe("Gemini client image payload", () => {
  it("sends the untouched original bytes for a small PNG", async () => {
    const { model, inline } = captureModel();
    const client = createGeminiClient(model);
    const result = await client.analyzeImage(file("small.png"), "series_1");

    const original = fs.readFileSync(file("small.png"));
    expect(inline().mimeType).toBe("image/png");
    expect(Buffer.from(inline().data, "base64").equals(original)).toBe(true);
    expect(result.status).toBe("success");
  });

  it("announces a passed-through JPEG as image/jpeg, not as PNG", async () => {
    const { model, inline } = captureModel();
    await createGeminiClient(model).analyzeImage(file("small.jpg"), "series_1");
    expect(inline().mimeType).toBe("image/jpeg");
    expect(Buffer.from(inline().data, "base64").equals(fs.readFileSync(file("small.jpg")))).toBe(
      true
    );
  });

  it("sends resized bytes for a large plate and announces PNG", async () => {
    const { model, inline } = captureModel();
    await createGeminiClient(model).analyzeImage(file("large.png"), "series_1");
    const sent = Buffer.from(inline().data, "base64");
    expect(inline().mimeType).toBe("image/png");
    expect((await sharp(sent).metadata()).width).toBe(1536);
  });

  it("attaches a schema-valid provenance record on the structured path", async () => {
    const { model } = captureModel();
    const result = await createGeminiClient(model).analyzeImage(file("small.png"), "series_1");
    expect(ImagePreprocessingRecordSchema.safeParse(result.preprocessing).success).toBe(true);
    expect(result.preprocessing).toMatchObject({
      action: "passthrough",
      nativeWidth: 224,
      sentWidth: 224,
      mimeType: "image/png",
      policy: "auto",
      targetDim: 1536,
      estimatedImageTokens: 258,
    });
  });

  it("attaches the record on the free-text fallback path too", async () => {
    const { model } = captureModel("Modality: X-ray. Findings: none of note.");
    const result = await createGeminiClient(model).analyzeImage(file("small.png"), "series_1");
    expect(result.validation?.ok).toBe(false);
    expect(result.preprocessing?.action).toBe("passthrough");
  });

  it("keeps the record on an error record when the provider fails after preparation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = jest.fn<(request: any) => Promise<never>>();
    fn.mockRejectedValue(new Error("provider exploded"));
    const client = createGeminiClient(
      { generateContent: fn } as unknown as GenerativeModel,
      undefined,
      {
        retry: { maxAttempts: 1 },
      }
    );
    const result = await client.analyzeImage(file("small.png"), "series_1");
    expect(result.status).toBe("error");
    expect(result.preprocessing?.action).toBe("passthrough");
  });

  it("folds an unreadable image into an error record with no provider call", async () => {
    const { model } = captureModel();
    const result = await createGeminiClient(model).analyzeImage(file("corrupt.png"), "series_1");
    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Failed to prepare image");
    expect(result.preprocessing).toBeUndefined();
    expect((model.generateContent as unknown as jest.Mock).mock.calls).toHaveLength(0);
  });

  it("honours IMAGE_QUALITY=economy through the client", async () => {
    process.env.IMAGE_QUALITY = "economy";
    const { model, inline } = captureModel();
    const result = await createGeminiClient(model).analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing).toMatchObject({ policy: "economy", targetDim: 768 });
    expect((await sharp(Buffer.from(inline().data, "base64")).metadata()).width).toBe(768);
  });

  it("honours IMAGE_MAX_DIM as a hard override through the client", async () => {
    process.env.IMAGE_MAX_DIM = "512";
    const { model } = captureModel();
    const result = await createGeminiClient(model).analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing).toMatchObject({ targetDim: 512, sentWidth: 512 });
  });

  it("sizes for the configured Gemini model id", async () => {
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    const { model } = captureModel();
    const result = await createGeminiClient(model).analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing?.targetDim).toBe(1536);
  });

  it("lets an explicitly supplied policy win over the environment", async () => {
    process.env.IMAGE_QUALITY = "economy";
    const { model } = captureModel();
    const client = createGeminiClient(model, undefined, {
      imagePolicy: resolvePolicy("openrouter", "anthropic/claude-sonnet-4", {}),
    });
    const result = await client.analyzeImage(file("large.png"), "series_1");
    // Claude's standard tier: the 1568-token budget trims a square study to 1092.
    expect(result.preprocessing).toMatchObject({ policy: "auto", targetDim: 1092 });
  });
});

// ─── Backward compatibility ───────────────────────────────────────────────────

describe("prepareImageForGemini", () => {
  it("still returns just data and mimeType", async () => {
    const out = await prepareImageForGemini(file("small.png"));
    expect(Object.keys(out).sort()).toEqual(["data", "mimeType"]);
    expect(out.mimeType).toBe("image/png");
  });

  it("delegates to the new pipeline: the bytes match preparePayload's", async () => {
    const wrapper = await prepareImageForGemini(file("large.png"));
    const full = await prepareImage(file("large.png"));
    expect(wrapper.data).toBe(full.data);
    expect(wrapper.mimeType).toBe(full.mimeType);
    expect(full.record.sentWidth).toBe(1536);
  });

  it("no longer forces PNG on a JPEG that needs no work", async () => {
    expect((await prepareImageForGemini(file("small.jpg"))).mimeType).toBe("image/jpeg");
  });

  it("reads the OpenRouter model id when AI_PROVIDER=openrouter", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_MODEL = "google/gemma-3-27b-it";
    const out = await prepareImage(file("large.png"));
    expect(out.record).toMatchObject({ targetDim: 896, sentWidth: 896 });
  });

  it("falls back to the documented default model ids", async () => {
    process.env.AI_PROVIDER = "openrouter";
    delete process.env.OPENROUTER_MODEL;
    const viaOpenRouter = await prepareImage(file("small.png"));
    expect(viaOpenRouter.record.targetDim).toBe(1536); // google/gemini-2.5-flash

    process.env.AI_PROVIDER = "google";
    delete process.env.GEMINI_MODEL;
    const viaGoogle = await prepareImage(file("small.png"));
    expect(viaGoogle.record.targetDim).toBe(1536); // gemini-2.5-flash
  });

  it("accepts an explicit policy", async () => {
    const out = await prepareImage(
      file("large.png"),
      resolvePolicy("openrouter", "google/gemma-3-27b-it", {})
    );
    expect(out.record).toMatchObject({ targetDim: 896, sentWidth: 896, estimatedImageTokens: 256 });
  });
});

// ─── OpenRouter path ──────────────────────────────────────────────────────────

function fakeFetch(): { fetchImpl: FetchLike; dataUrl: () => string } {
  const calls: RequestInit[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    calls.push(init ?? {});
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: IMAGE_JSON } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  };
  return {
    fetchImpl,
    dataUrl: () => {
      const body = JSON.parse(String(calls[0]?.body)) as {
        messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
      };
      const part = body.messages.flatMap((m) => m.content).find((c) => c.type === "image_url");
      if (!part?.image_url) throw new Error("no image_url part was sent");
      return part.image_url.url;
    },
  };
}

describe("OpenRouter client image payload", () => {
  it("sizes for the OpenRouter model id, not for the environment default", async () => {
    const { fetchImpl } = fakeFetch();
    const client = createOpenRouterClient("k", "anthropic/claude-opus-5", undefined, fetchImpl);
    const result = await client.analyzeImage(file("large.png"), "series_1");
    // Claude's high-resolution tier could take 2576 px; `auto` declines it and
    // stays on the 1568 px standard tier, which is the economic choice.
    expect(result.preprocessing).toMatchObject({ targetDim: 1568, sentWidth: 1568 });
    // 56 × 56 patches, comfortably inside the tier's 4784-token cap.
    expect(result.preprocessing?.estimatedImageTokens).toBe(3136);
  });

  it("builds the data URL from the media type the pre-flight chose", async () => {
    const { fetchImpl, dataUrl } = fakeFetch();
    const client = createOpenRouterClient(
      "k",
      "qwen/qwen2.5-vl-72b-instruct",
      undefined,
      fetchImpl
    );
    await client.analyzeImage(file("small.jpg"), "series_1");
    expect(dataUrl().startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(
      Buffer.from(dataUrl().split(",")[1] as string, "base64").equals(
        fs.readFileSync(file("small.jpg"))
      )
    ).toBe(true);
  });

  it("sends Qwen-VL a payload inside its published pixel budget", async () => {
    const { fetchImpl } = fakeFetch();
    const client = createOpenRouterClient(
      "k",
      "qwen/qwen2.5-vl-72b-instruct",
      undefined,
      fetchImpl
    );
    const result = await client.analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing?.sentWidth).toBe(980);
    // max_pixels = 1280 × 28 × 28 = 1,003,520.
    const sent = result.preprocessing as { sentWidth: number; sentHeight: number };
    expect(sent.sentWidth * sent.sentHeight).toBeLessThanOrEqual(1280 * 28 * 28);
  });

  it("normalises a Gemma payload to the 896 px SigLIP input", async () => {
    const { fetchImpl } = fakeFetch();
    const client = createOpenRouterClient("k", "google/gemma-3-27b-it", undefined, fetchImpl);
    const result = await client.analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing).toMatchObject({ sentWidth: 896, estimatedImageTokens: 256 });
  });

  it("lets an explicit policy override the model-derived one", async () => {
    const { fetchImpl } = fakeFetch();
    const client = createOpenRouterClient("k", "anthropic/claude-opus-5", undefined, fetchImpl, {
      imagePolicy: resolvePolicy("openrouter", "anthropic/claude-opus-5", { IMAGE_QUALITY: "max" }),
    });
    const result = await client.analyzeImage(file("large.png"), "series_1");
    expect(result.preprocessing).toMatchObject({ policy: "max", targetDim: 2576 });
  });
});
