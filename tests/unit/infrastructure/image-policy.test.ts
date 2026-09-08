/**
 * Unit tests for the image resolution policy and the payload pre-flight.
 *
 * Every fixture is generated in-process with sharp from a seeded pattern, so
 * the suite is deterministic and needs no network, no API key and no binary
 * fixtures in the repo. The token-estimate cases are pinned against the numbers
 * published in the vendor documentation (see the table in the module header of
 * `src/infrastructure/image-policy.ts`), so a silent formula drift fails here.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import {
  CLAUDE_PATCH_PX,
  ECONOMY_DIM,
  FAMILY_PROFILES,
  GEMINI_TILE_PX,
  GEMINI_TOKENS_PER_TILE,
  ImagePreparationError,
  capForTokenBudget,
  estimateImageTokens,
  inspectImage,
  modelFamily,
  preparePayload,
  readMaxDimOverride,
  readPreset,
  resolvePolicy,
  resolveTargetDim,
  snapToTileGrid,
  type ImageModelFamily,
  type ImagePolicy,
} from "../../../src/infrastructure/image-policy.js";
import { createLogger } from "../../../src/infrastructure/logger.js";

// ─── Deterministic fixtures ───────────────────────────────────────────────────

let DIR: string;

/** Seeded PRNG so every generated fixture is byte-identical across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 8-bit greyscale gradient + seeded noise — compresses like a radiograph. */
function greyPixels(width: number, height: number, seed = 7): Buffer {
  const random = mulberry32(seed);
  const px = Buffer.allocUnsafe(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gradient = ((x / width + y / height) / 2) * 200 + 20;
      px[y * width + x] = Math.max(0, Math.min(255, Math.round(gradient + (random() - 0.5) * 40)));
    }
  }
  return px;
}

/**
 * A one-band greyscale pipeline. `toColourspace("b-w")` is required: libvips
 * otherwise saves a raw single-band input as 3-channel sRGB, which is exactly
 * the channel inflation the pre-flight guards against — so the fixtures have to
 * be genuinely grey for that guard to be under test.
 */
const grey = (w: number, h: number, seed = 7) =>
  sharp(greyPixels(w, h, seed), { raw: { width: w, height: h, channels: 1 } }).toColourspace("b-w");

const file = (name: string): string => path.join(DIR, name);

beforeAll(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "image-policy-"));

  await grey(224, 224).png().toFile(file("small.png"));
  await grey(2000, 2000).png().toFile(file("large.png"));
  await grey(1536, 1536).png().toFile(file("exact-1536.png"));
  await grey(800, 800).png().toFile(file("edge-800.png"));
  await grey(1000, 1000).png().toFile(file("mid-1000.png"));
  await grey(1500, 1500).png().toFile(file("mid-1500.png"));
  await grey(100, 100).png().toFile(file("tiny.png"));
  await grey(224, 224).jpeg({ quality: 92 }).toFile(file("small.jpg"));
  await grey(2000, 2000).jpeg({ quality: 92 }).toFile(file("large.jpg"));
  await grey(1200, 600).png().toFile(file("wide.png"));

  // RGBA at a size that already fits, so only the alpha strip forces work.
  await sharp({
    create: {
      width: 300,
      height: 300,
      channels: 4,
      background: { r: 90, g: 90, b: 90, alpha: 0.5 },
    },
  })
    .png()
    .toFile(file("alpha.png"));

  // A genuine 16-bit greyscale PNG (libvips only writes ushort from a grey16
  // pipeline), small enough that the depth is the only reason to re-encode.
  await grey(300, 300).toColourspace("grey16").png().toFile(file("depth16.png"));

  await grey(300, 300).tiff().toFile(file("scan.tiff"));
  await grey(300, 300).webp().toFile(file("scan.webp"));

  fs.writeFileSync(file("corrupt.png"), Buffer.from("not an image at all, just text"));
  fs.writeFileSync(file("empty.png"), Buffer.alloc(0));
}, 120_000);

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

/** A policy built without touching `process.env`. */
function policy(over: Partial<ImagePolicy> = {}): ImagePolicy {
  return {
    provider: "google",
    model: "gemini-2.5-flash",
    family: "gemini",
    preset: "auto",
    targetDim: 1536,
    snapToTiles: true,
    applyTokenBudget: true,
    jpegForPhoto: false,
    ...over,
  };
}

// ─── modelFamily ──────────────────────────────────────────────────────────────

describe("modelFamily", () => {
  const cases: Array<[string, ImageModelFamily]> = [
    ["gemini-2.5-flash", "gemini"],
    ["gemini-2.5-pro", "gemini"],
    ["google/gemini-2.5-flash", "gemini"],
    ["GEMINI-3-PRO", "gemini"],
    ["google/gemma-3-27b-it", "gemma"],
    ["gemma-4-12b", "gemma"],
    ["anthropic/claude-sonnet-4", "claude-standard"],
    ["anthropic/claude-3-5-haiku", "claude-standard"],
    ["anthropic/claude-opus-5", "claude-highres"],
    ["claude-4.7-sonnet", "claude-highres"],
    ["anthropic/claude-sonnet-45", "claude-highres"],
    ["qwen/qwen2.5-vl-72b-instruct", "qwen-vl"],
    ["qwen/qwen3-vl-8b-instruct", "qwen-vl"],
    ["qwen/qwen3-32b", "unknown"],
    ["openai/gpt-4o", "unknown"],
    ["meta-llama/llama-4-scout", "unknown"],
    ["", "unknown"],
  ];
  it.each(cases)("maps %s to %s", (model, family) => {
    expect(modelFamily(model)).toBe(family);
  });

  it("treats a Gemma id as Gemma even though it is a Google model", () => {
    expect(modelFamily("google/gemma-3-27b-it")).not.toBe("gemini");
  });

  it("survives a null or undefined id from an untyped caller", () => {
    expect(modelFamily(undefined as unknown as string)).toBe("unknown");
    expect(modelFamily(null as unknown as string)).toBe("unknown");
  });
});

// ─── resolveTargetDim ─────────────────────────────────────────────────────────

describe("resolveTargetDim", () => {
  it("uses the family's auto target by default", () => {
    expect(resolveTargetDim("google", "gemini-2.5-flash", "auto")).toBe(1536);
    expect(resolveTargetDim("openrouter", "google/gemma-3-27b-it", "auto")).toBe(896);
    expect(resolveTargetDim("openrouter", "anthropic/claude-sonnet-4", "auto")).toBe(1568);
    expect(resolveTargetDim("openrouter", "anthropic/claude-opus-5", "auto")).toBe(1568);
    expect(resolveTargetDim("openrouter", "qwen/qwen2.5-vl-72b-instruct", "auto")).toBe(1000);
  });

  it("uses the model ceiling for the max preset", () => {
    expect(resolveTargetDim("google", "gemini-2.5-flash", "max")).toBe(3072);
    expect(resolveTargetDim("openrouter", "anthropic/claude-opus-5", "max")).toBe(2576);
    expect(resolveTargetDim("openrouter", "anthropic/claude-sonnet-4", "max")).toBe(1568);
    expect(resolveTargetDim("openrouter", "qwen/qwen2.5-vl-72b-instruct", "max")).toBe(3584);
    // Gemma's encoder normalises to 896 whatever it is given, so max == auto.
    expect(resolveTargetDim("openrouter", "google/gemma-3-27b-it", "max")).toBe(896);
  });

  it("clamps the economy preset to one Gemini tile, never above the ceiling", () => {
    expect(resolveTargetDim("google", "gemini-2.5-flash", "economy")).toBe(ECONOMY_DIM);
    expect(resolveTargetDim("openrouter", "anthropic/claude-opus-5", "economy")).toBe(ECONOMY_DIM);
    expect(resolveTargetDim("openrouter", "google/gemma-3-27b-it", "economy")).toBe(ECONOMY_DIM);
  });

  it("falls back to 1024 px for an unknown model", () => {
    expect(resolveTargetDim("openrouter", "openai/gpt-4o", "auto")).toBe(1024);
    expect(resolveTargetDim("openrouter", "openai/gpt-4o", "max")).toBe(1024);
  });

  it("defaults an empty model id to Gemini on the Google path only", () => {
    expect(resolveTargetDim("google", "", "auto")).toBe(1536);
    expect(resolveTargetDim("  GOOGLE ", "   ", "auto")).toBe(1536);
    expect(resolveTargetDim("openrouter", "", "auto")).toBe(1024);
  });

  it("keeps every table entry internally consistent (auto never above max)", () => {
    for (const profile of Object.values(FAMILY_PROFILES)) {
      expect(profile.auto).toBeLessThanOrEqual(profile.max);
      expect(profile.source).not.toBe("");
    }
  });
});

// ─── Environment parsing ──────────────────────────────────────────────────────

describe("readPreset", () => {
  it.each([
    ["auto", "auto"],
    ["max", "max"],
    ["economy", "economy"],
    ["  MAX  ", "max"],
  ])("accepts %s", (raw, expected) => {
    expect(readPreset({ IMAGE_QUALITY: raw } as NodeJS.ProcessEnv)).toBe(expected);
  });

  it.each([[""], ["  "], ["fastest"], ["1"]])("falls back to auto for %p", (raw) => {
    expect(readPreset({ IMAGE_QUALITY: raw } as NodeJS.ProcessEnv)).toBe("auto");
  });

  it("falls back to auto when the variable is unset", () => {
    expect(readPreset({} as NodeJS.ProcessEnv)).toBe("auto");
  });

  it("reads process.env when no environment is passed", () => {
    const saved = process.env.IMAGE_QUALITY;
    try {
      process.env.IMAGE_QUALITY = "economy";
      expect(readPreset()).toBe("economy");
    } finally {
      if (saved === undefined) delete process.env.IMAGE_QUALITY;
      else process.env.IMAGE_QUALITY = saved;
    }
  });
});

describe("readMaxDimOverride", () => {
  it("accepts a positive integer", () => {
    expect(readMaxDimOverride({ IMAGE_MAX_DIM: "512" } as NodeJS.ProcessEnv)).toBe(512);
    expect(readMaxDimOverride({ IMAGE_MAX_DIM: " 2048 " } as NodeJS.ProcessEnv)).toBe(2048);
  });

  it.each([["0"], ["-100"], ["1.5"], ["abc"], [""], ["  "]])("ignores %p", (raw) => {
    expect(readMaxDimOverride({ IMAGE_MAX_DIM: raw } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("is undefined when unset", () => {
    expect(readMaxDimOverride({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("reads process.env when no environment is passed", () => {
    const saved = process.env.IMAGE_MAX_DIM;
    try {
      process.env.IMAGE_MAX_DIM = "777";
      expect(readMaxDimOverride()).toBe(777);
    } finally {
      if (saved === undefined) delete process.env.IMAGE_MAX_DIM;
      else process.env.IMAGE_MAX_DIM = saved;
    }
  });
});

describe("resolvePolicy", () => {
  it("builds the default Gemini policy from an empty environment", () => {
    expect(resolvePolicy("google", "gemini-2.5-flash", {} as NodeJS.ProcessEnv)).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
      family: "gemini",
      preset: "auto",
      targetDim: 1536,
      snapToTiles: true,
      applyTokenBudget: true,
      jpegForPhoto: false,
    });
  });

  it("lets IMAGE_MAX_DIM override the table and disables tile snapping", () => {
    const p = resolvePolicy("google", "gemini-2.5-flash", {
      IMAGE_MAX_DIM: "640",
    } as NodeJS.ProcessEnv);
    expect(p.targetDim).toBe(640);
    expect(p.snapToTiles).toBe(false);
    expect(p.applyTokenBudget).toBe(false);
  });

  it("disables tile snapping for the max preset", () => {
    const p = resolvePolicy("google", "gemini-2.5-flash", {
      IMAGE_QUALITY: "max",
    } as NodeJS.ProcessEnv);
    expect(p.targetDim).toBe(3072);
    expect(p.snapToTiles).toBe(false);
    expect(p.applyTokenBudget).toBe(false);
  });

  it("reads IMAGE_JPEG_FOR_PHOTO only as the exact string 1", () => {
    const on = { IMAGE_JPEG_FOR_PHOTO: "1" } as NodeJS.ProcessEnv;
    const off = { IMAGE_JPEG_FOR_PHOTO: "true" } as NodeJS.ProcessEnv;
    expect(resolvePolicy("google", "gemini-2.5-flash", on).jpegForPhoto).toBe(true);
    expect(resolvePolicy("google", "gemini-2.5-flash", off).jpegForPhoto).toBe(false);
  });

  it("carries the economy preset through to the target", () => {
    const p = resolvePolicy("openrouter", "anthropic/claude-sonnet-4", {
      IMAGE_QUALITY: "economy",
    } as NodeJS.ProcessEnv);
    expect(p).toMatchObject({ family: "claude-standard", preset: "economy", targetDim: 768 });
  });
});

// ─── Tile snapping ────────────────────────────────────────────────────────────

describe("snapToTileGrid", () => {
  it("leaves anything at or below one tile alone", () => {
    expect(snapToTileGrid(224)).toBe(224);
    expect(snapToTileGrid(GEMINI_TILE_PX)).toBe(GEMINI_TILE_PX);
  });

  it("snaps down when the overshoot is under a tenth of a tile", () => {
    expect(snapToTileGrid(800)).toBe(768); // overshoot 32 < 76.8
    expect(snapToTileGrid(1560)).toBe(1536); // overshoot 24 < 76.8
    expect(snapToTileGrid(2320)).toBe(2304); // overshoot 16 < 76.8
  });

  it("keeps the dimension when the overshoot pays for real pixels", () => {
    expect(snapToTileGrid(900)).toBe(900); // overshoot 132 > 76.8
    expect(snapToTileGrid(1620)).toBe(1620);
    expect(snapToTileGrid(845)).toBe(845); // overshoot 77 — just outside
  });

  it("leaves an exact multiple untouched", () => {
    expect(snapToTileGrid(1536)).toBe(1536);
    expect(snapToTileGrid(3072)).toBe(3072);
  });

  it("honours a custom tile size", () => {
    expect(snapToTileGrid(1010, 1000)).toBe(1000);
    expect(snapToTileGrid(1500, 1000)).toBe(1500);
  });
});

// ─── Visual-token budget ──────────────────────────────────────────────────────

describe("capForTokenBudget", () => {
  it("reproduces the vendor's published downscale targets exactly", () => {
    // Standard tier, 1568 visual tokens.
    expect(capForTokenBudget(1568, 1092, 1092)).toBe(1092);
    expect(capForTokenBudget(1568, 1920, 1080)).toBe(1456);
    // The documented result for that 16:9 case is 1456×819 at 1560 tokens.
    expect(estimateImageTokens("claude-standard", 1456, 819)).toBe(1560);
    // High-resolution tier, 4784 visual tokens: 3840×2160 → 2576×1449.
    expect(capForTokenBudget(4784, 3840, 2160)).toBe(2576);
    expect(estimateImageTokens("claude-highres", 2576, 1449)).toBe(4784);
  });

  it("keeps the result inside the budget for a range of aspect ratios", () => {
    for (const [long, short] of [
      [1000, 1000],
      [1600, 900],
      [3000, 1000],
      [2048, 1536],
      [500, 400],
    ] as Array<[number, number]>) {
      const cappedLong = capForTokenBudget(1568, long, short);
      const cappedShort = Math.round(cappedLong * (short / long));
      expect(estimateImageTokens("claude-standard", cappedLong, cappedShort)).toBeLessThanOrEqual(
        1568
      );
    }
  });

  it("derives the Qwen-VL square target from max_pixels = 1280 × 28 × 28", () => {
    expect(capForTokenBudget(1280, 2000, 2000)).toBe(980);
    expect(980 * 980).toBeLessThanOrEqual(1280 * 28 * 28);
  });

  it("never returns less than one patch", () => {
    expect(capForTokenBudget(1, 100, 100)).toBe(28);
    expect(capForTokenBudget(0.0001, 100, 100)).toBe(28);
  });

  it("returns the long edge unchanged for degenerate inputs", () => {
    expect(capForTokenBudget(0, 500, 400)).toBe(500);
    expect(capForTokenBudget(-1, 500, 400)).toBe(500);
    expect(capForTokenBudget(1568, 0, 400)).toBe(0);
    expect(capForTokenBudget(1568, 500, 0)).toBe(500);
  });
});

// ─── Token estimation ─────────────────────────────────────────────────────────

describe("estimateImageTokens", () => {
  describe("gemini", () => {
    it("charges one flat tile when both dimensions are at most 384 px", () => {
      expect(estimateImageTokens("gemini", 224, 224)).toBe(GEMINI_TOKENS_PER_TILE);
      expect(estimateImageTokens("gemini", 384, 384)).toBe(GEMINI_TOKENS_PER_TILE);
      expect(estimateImageTokens("gemini", 384, 100)).toBe(GEMINI_TOKENS_PER_TILE);
    });

    it("reproduces the documented 960×540 example (3 × 2 tiles)", () => {
      expect(estimateImageTokens("gemini", 960, 540)).toBe(6 * GEMINI_TOKENS_PER_TILE);
    });

    it("is aspect-driven, not resolution-driven, above the 384 px threshold", () => {
      // crop = floor(min/1.5) scales with the image, so a square study costs
      // 2 × 2 tiles whatever its resolution. This is the finding that makes
      // downscaling a bytes/latency win on Gemini rather than a token win.
      const square = 4 * GEMINI_TOKENS_PER_TILE;
      expect(estimateImageTokens("gemini", 1000, 1000)).toBe(square);
      expect(estimateImageTokens("gemini", 1536, 1536)).toBe(square);
      expect(estimateImageTokens("gemini", 4000, 4000)).toBe(square);
    });

    it("guards a degenerate crop unit instead of dividing by zero", () => {
      expect(estimateImageTokens("gemini", 500, 1)).toBe(500 * GEMINI_TOKENS_PER_TILE);
    });
  });

  describe("claude", () => {
    // Golden rows copied from the vendor's own table of image sizes.
    it.each([
      [200, 200, 64],
      [1000, 1000, 1296],
      [1092, 1092, 1521],
      [1456, 819, 1560],
      [1269, 952, 1564],
    ])("costs %i×%i as %i visual tokens", (w, h, tokens) => {
      expect(estimateImageTokens("claude-standard", w, h)).toBe(tokens);
    });

    it("caps the standard tier at 1568 visual tokens", () => {
      expect(estimateImageTokens("claude-standard", 4000, 4000)).toBe(1568);
    });

    it("caps the high-resolution tier at 4784 visual tokens", () => {
      expect(estimateImageTokens("claude-highres", 4000, 4000)).toBe(4784);
      expect(estimateImageTokens("claude-highres", 1000, 1000)).toBe(1296);
    });

    it("uses a 28 px patch edge", () => {
      expect(CLAUDE_PATCH_PX).toBe(28);
      expect(estimateImageTokens("claude-standard", 28, 28)).toBe(1);
      expect(estimateImageTokens("claude-standard", 29, 28)).toBe(2);
    });
  });

  it("charges Gemma a flat 256 tokens whatever the input", () => {
    expect(estimateImageTokens("gemma", 100, 100)).toBe(256);
    expect(estimateImageTokens("gemma", 4000, 4000)).toBe(256);
  });

  it("clamps Qwen-VL to its published 4…16384 visual-token range", () => {
    expect(estimateImageTokens("qwen-vl", 1000, 1000)).toBe(1296);
    expect(estimateImageTokens("qwen-vl", 10, 10)).toBe(4);
    expect(estimateImageTokens("qwen-vl", 20000, 20000)).toBe(16384);
  });

  it("returns null rather than guessing for an unknown family", () => {
    expect(estimateImageTokens("unknown", 1000, 1000)).toBeNull();
  });

  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])("returns null for the invalid dimensions %p × %p", (w, h) => {
    expect(estimateImageTokens("gemini", w, h)).toBeNull();
  });
});

// ─── inspectImage ─────────────────────────────────────────────────────────────

describe("inspectImage", () => {
  it("reports geometry, colour model and file size for a greyscale PNG", async () => {
    const info = await inspectImage(file("small.png"));
    expect(info).toMatchObject({
      width: 224,
      height: 224,
      channels: 1,
      depth: "uchar",
      format: "png",
      hasAlpha: false,
      bitsPerSample: 8,
    });
    expect(info.bytes).toBe(fs.statSync(file("small.png")).size);
    expect(info.isProgressive).toBe(false);
  });

  it("reports a JPEG as jpeg", async () => {
    expect((await inspectImage(file("small.jpg"))).format).toBe("jpeg");
  });

  it("reports an alpha channel", async () => {
    const info = await inspectImage(file("alpha.png"));
    expect(info.hasAlpha).toBe(true);
    expect(info.channels).toBe(4);
  });

  it("reports a 16-bit source", async () => {
    const info = await inspectImage(file("depth16.png"));
    expect(info.depth).toBe("ushort");
    expect(info.bitsPerSample).toBe(16);
  });

  it("reports non-inline containers by their real format", async () => {
    expect((await inspectImage(file("scan.tiff"))).format).toBe("tiff");
    expect((await inspectImage(file("scan.webp"))).format).toBe("webp");
  });

  it("throws a typed error for a missing file", async () => {
    await expect(inspectImage(file("nope.png"))).rejects.toBeInstanceOf(ImagePreparationError);
  });

  it("throws a typed error naming the file for a corrupt image", async () => {
    const err = await inspectImage(file("corrupt.png")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImagePreparationError);
    expect((err as ImagePreparationError).imagePath).toBe(file("corrupt.png"));
    expect((err as Error).message).toContain("Failed to prepare image");
  });

  it("throws a typed error for an empty file", async () => {
    await expect(inspectImage(file("empty.png"))).rejects.toBeInstanceOf(ImagePreparationError);
  });
});

// ─── preparePayload ───────────────────────────────────────────────────────────

describe("preparePayload — passthrough", () => {
  it("sends a small 8-bit PNG byte-for-byte, with no re-encode", async () => {
    const original = fs.readFileSync(file("small.png"));
    const out = await preparePayload(file("small.png"), policy());

    expect(out.record.action).toBe("passthrough");
    expect(out.bytes.equals(original)).toBe(true);
    expect(out.data).toBe(original.toString("base64"));
    expect(out.mimeType).toBe("image/png");
    expect(out.record).toMatchObject({
      nativeWidth: 224,
      nativeHeight: 224,
      sentWidth: 224,
      sentHeight: 224,
      bytesIn: original.length,
      bytesOut: original.length,
      format: "png",
      policy: "auto",
      targetDim: 1536,
      estimatedImageTokens: 258,
    });
    expect(out.record.reason).toContain("original bytes sent unmodified");
  });

  it("never grows the payload for the 224 px NIH derivative (the +131 % regression)", async () => {
    const out = await preparePayload(file("small.png"), policy());
    expect(out.record.bytesOut).toBeLessThanOrEqual(out.record.bytesIn);
  });

  it("passes a JPEG through as image/jpeg, not as a PNG re-encode", async () => {
    const original = fs.readFileSync(file("small.jpg"));
    const out = await preparePayload(file("small.jpg"), policy());
    expect(out.record.action).toBe("passthrough");
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.record.format).toBe("jpeg");
    expect(out.bytes.equals(original)).toBe(true);
  });

  it("passes an image sitting exactly on the target through", async () => {
    const out = await preparePayload(file("exact-1536.png"), policy());
    expect(out.record.action).toBe("passthrough");
    expect(out.record.sentWidth).toBe(1536);
    expect(out.record.bytesOut).toBe(out.record.bytesIn);
  });

  it("passes one pixel over the target through the resize branch", async () => {
    const out = await preparePayload(file("exact-1536.png"), policy({ targetDim: 1535 }));
    expect(out.record.action).toBe("resized");
    expect(out.record.sentWidth).toBe(1535);
  });
});

describe("preparePayload — resize", () => {
  it("downscales a large plate to the target, preserving aspect ratio", async () => {
    const out = await preparePayload(file("large.png"), policy());
    expect(out.record).toMatchObject({
      action: "resized",
      nativeWidth: 2000,
      sentWidth: 1536,
      sentHeight: 1536,
      format: "png",
      mimeType: "image/png",
    });
    expect(out.record.bytesOut).toBeLessThan(out.record.bytesIn);
    expect(out.record.reason).toContain("2000px > target 1536px");
  });

  it("preserves aspect ratio on a non-square plate", async () => {
    const out = await preparePayload(file("wide.png"), policy({ targetDim: 600 }));
    expect(out.record.sentWidth).toBe(600);
    expect(out.record.sentHeight).toBe(300);
  });

  it("keeps a greyscale source at one channel instead of promoting it to sRGB", async () => {
    const out = await preparePayload(file("large.png"), policy());
    const meta = await sharp(out.bytes).metadata();
    expect(meta.channels).toBe(1);
    expect(meta.space).toBe("b-w");
  });

  it("never enlarges a small image, even when the container forces a re-encode", async () => {
    const out = await preparePayload(file("scan.tiff"), policy());
    expect(out.record.sentWidth).toBe(300);
    expect(out.record.sentHeight).toBe(300);
  });

  it("honours the economy preset", async () => {
    const out = await preparePayload(
      file("mid-1000.png"),
      policy({ preset: "economy", targetDim: ECONOMY_DIM })
    );
    expect(out.record).toMatchObject({ action: "resized", sentWidth: 768, policy: "economy" });
  });

  it("uses the unknown-model fallback of 1024 px", async () => {
    const p = policy({ model: "openai/gpt-4o", family: "unknown", targetDim: 1024 });
    const out = await preparePayload(file("mid-1500.png"), p);
    expect(out.record.sentWidth).toBe(1024);
    expect(out.record.estimatedImageTokens).toBeNull();
  });
});

describe("preparePayload — re-encode", () => {
  it("strips alpha and records why", async () => {
    const out = await preparePayload(file("alpha.png"), policy());
    expect(out.record.action).toBe("reencoded");
    expect(out.record.reason).toContain("alpha channel stripped");
    expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(false);
    expect(out.record.sentWidth).toBe(300);
  });

  it("reduces a 16-bit source to 8 bits without stretching contrast", async () => {
    const out = await preparePayload(file("depth16.png"), policy());
    expect(out.record.action).toBe("reencoded");
    expect(out.record.reason).toContain("ushort source reduced to 8-bit");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.depth).toBe("uchar");
    expect(meta.bitsPerSample).toBe(8);

    // A linear full-range map, not `normalise()`: the 8-bit source that was
    // widened to 16 bits comes back unchanged rather than contrast-stretched.
    const before = greyPixels(300, 300);
    const decoded = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    const stride = decoded.info.channels;
    expect(decoded.data.length).toBe(before.length * stride);
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) {
      const sample = decoded.data[i * stride] as number;
      maxDelta = Math.max(maxDelta, Math.abs((before[i] as number) - sample));
    }
    expect(maxDelta).toBeLessThanOrEqual(1);
  });

  it.each([
    ["scan.tiff", "tiff"],
    ["scan.webp", "webp"],
  ])("re-encodes an unsupported container (%s) as PNG", async (name, format) => {
    const out = await preparePayload(file(name), policy());
    expect(out.record.action).toBe("reencoded");
    expect(out.record.reason).toContain(`format ${format} is not sendable inline`);
    expect(out.record.format).toBe("png");
    expect(out.mimeType).toBe("image/png");
    expect((await sharp(out.bytes).metadata()).format).toBe("png");
  });

  it("re-encodes a large JPEG as lossless PNG by default", async () => {
    const out = await preparePayload(file("large.jpg"), policy());
    expect(out.record.format).toBe("png");
    expect(out.mimeType).toBe("image/png");
  });

  it("re-encodes a large JPEG as JPEG q=90 when IMAGE_JPEG_FOR_PHOTO is set", async () => {
    const out = await preparePayload(file("large.jpg"), policy({ jpegForPhoto: true }));
    expect(out.record.format).toBe("jpeg");
    expect(out.mimeType).toBe("image/jpeg");
    expect((await sharp(out.bytes).metadata()).format).toBe("jpeg");
  });

  it("does not turn a PNG into a JPEG just because the flag is on", async () => {
    const out = await preparePayload(file("large.png"), policy({ jpegForPhoto: true }));
    expect(out.record.format).toBe("png");
  });

  it("lists every reason when several apply at once", async () => {
    const out = await preparePayload(file("alpha.png"), policy({ targetDim: 128 }));
    expect(out.record.action).toBe("resized");
    expect(out.record.reason).toContain("long edge 300px > target 128px");
    expect(out.record.reason).toContain("alpha channel stripped");
  });
});

describe("preparePayload — tile snapping", () => {
  it("trims a Gemini target down to a whole tile grid under auto", async () => {
    // Native 800 px, target 1536: the effective cap is 800, which overshoots
    // one tile by 32 px — snapped to 768, so the image is resized after all.
    const out = await preparePayload(file("edge-800.png"), policy());
    expect(out.record.targetDim).toBe(768);
    expect(out.record.action).toBe("resized");
    expect(out.record.sentWidth).toBe(768);
  });

  it("leaves the same image alone under the max preset", async () => {
    const out = await preparePayload(
      file("edge-800.png"),
      policy({ preset: "max", targetDim: 3072, snapToTiles: false })
    );
    expect(out.record.targetDim).toBe(3072);
    expect(out.record.action).toBe("passthrough");
    expect(out.record.sentWidth).toBe(800);
  });

  it("does not snap for a non-Gemini family", async () => {
    const p = policy({
      model: "anthropic/claude-sonnet-4",
      family: "claude-standard",
      targetDim: 1568,
    });
    const out = await preparePayload(file("edge-800.png"), p);
    // Trimmed by the token budget (1092), never by the 768 px tile grid, and
    // 800 px is already under 1092 — so the bytes go out untouched.
    expect(out.record.targetDim).toBe(1092);
    expect(out.record.action).toBe("passthrough");
  });

  it("does not snap when IMAGE_MAX_DIM asked for an exact size", async () => {
    const out = await preparePayload(file("edge-800.png"), policy({ snapToTiles: false }));
    expect(out.record.targetDim).toBe(1536);
    expect(out.record.action).toBe("passthrough");
  });

  it("does not snap a target that is already a tile multiple", async () => {
    const out = await preparePayload(file("large.png"), policy());
    expect(out.record.targetDim).toBe(1536);
  });
});

describe("preparePayload — visual-token budget", () => {
  const claude = (over: Partial<ImagePolicy> = {}) =>
    policy({
      model: "anthropic/claude-sonnet-4",
      family: "claude-standard",
      targetDim: 1568,
      ...over,
    });

  it("trims a square plate to the largest size Claude will not downscale", async () => {
    const out = await preparePayload(file("large.png"), claude());
    expect(out.record.targetDim).toBe(1092);
    expect(out.record.sentWidth).toBe(1092);
    expect(out.record.estimatedImageTokens).toBe(1521);
  });

  it("uses the whole long edge when the aspect ratio makes it affordable", async () => {
    // 2:1 → 55 patches on the long edge (sqrt(1568 × 2) = 56.0 → 55 after floor
    // of the exact ratio), which is above the 1200 px native size, so nothing
    // is trimmed and the file passes straight through.
    const out = await preparePayload(file("wide.png"), claude());
    expect(out.record.action).toBe("passthrough");
    expect(out.record.sentWidth).toBe(1200);
    expect(out.record.estimatedImageTokens).toBeLessThanOrEqual(1568);
  });

  it("gives the high-resolution tier its wider budget", async () => {
    const out = await preparePayload(
      file("large.png"),
      claude({ model: "anthropic/claude-opus-5", family: "claude-highres" })
    );
    expect(out.record.sentWidth).toBe(1568);
    expect(out.record.estimatedImageTokens).toBe(3136);
  });

  it("does not apply the budget under the max preset", async () => {
    const out = await preparePayload(
      file("large.png"),
      claude({
        model: "anthropic/claude-opus-5",
        family: "claude-highres",
        preset: "max",
        targetDim: 2576,
        snapToTiles: false,
        applyTokenBudget: false,
      })
    );
    expect(out.record.targetDim).toBe(2576);
    expect(out.record.sentWidth).toBe(2000);
  });

  it("applies the budget to Qwen-VL", async () => {
    const out = await preparePayload(
      file("large.png"),
      policy({ model: "qwen/qwen2.5-vl-72b-instruct", family: "qwen-vl", targetDim: 1000 })
    );
    expect(out.record.sentWidth).toBe(980);
  });

  it("leaves families without a published budget alone", async () => {
    const out = await preparePayload(file("large.png"), policy());
    expect(out.record.sentWidth).toBe(1536);
  });
});

describe("preparePayload — records and logging", () => {
  it("estimates tokens from the pixels actually sent, not the native ones", async () => {
    const out = await preparePayload(file("large.png"), policy());
    expect(out.record.estimatedImageTokens).toBe(estimateImageTokens("gemini", 1536, 1536));
  });

  it("estimates Claude tokens with the patch formula", async () => {
    const p = policy({
      model: "anthropic/claude-sonnet-4",
      family: "claude-standard",
      targetDim: 1568,
    });
    const out = await preparePayload(file("mid-1000.png"), p);
    // 1000 px square is already inside the 1568-token budget (36 × 36 = 1296).
    expect(out.record.action).toBe("passthrough");
    expect(out.record.estimatedImageTokens).toBe(1296);
  });

  it("emits exactly one structured line per image", async () => {
    const lines: string[] = [];
    const logger = createLogger("debug", (line) => lines.push(line));
    await preparePayload(file("small.png"), policy(), { logger });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string);
    expect(record).toMatchObject({
      level: "debug",
      event: "image.prepared",
      action: "passthrough",
      family: "gemini",
      sentWidth: 224,
      estimatedImageTokens: 258,
    });
  });

  it("uses the LOG_LEVEL logger when none is injected", async () => {
    const saved = process.env.LOG_LEVEL;
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      process.env.LOG_LEVEL = "debug";
      await preparePayload(file("small.png"), policy());
    } finally {
      process.stderr.write = realWrite;
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
    expect(written.filter((l) => l.includes("image.prepared"))).toHaveLength(1);
  });

  it("stays silent at the default log level", async () => {
    const lines: string[] = [];
    const logger = createLogger("silent", (line) => lines.push(line));
    await preparePayload(file("small.png"), policy(), { logger });
    expect(lines).toHaveLength(0);
  });

  it("base64 always decodes back to the bytes it reports", async () => {
    for (const name of ["small.png", "small.jpg", "large.png", "scan.tiff", "depth16.png"]) {
      const out = await preparePayload(file(name), policy());
      const decoded = Buffer.from(out.data, "base64");
      expect(decoded.equals(out.bytes)).toBe(true);
      expect(decoded.length).toBe(out.record.bytesOut);
    }
  });

  it("is deterministic: the same input and policy produce the same bytes", async () => {
    const a = await preparePayload(file("large.png"), policy());
    const b = await preparePayload(file("large.png"), policy());
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });
});

describe("preparePayload — error paths", () => {
  it("rejects a corrupt file with a typed error", async () => {
    await expect(preparePayload(file("corrupt.png"), policy())).rejects.toBeInstanceOf(
      ImagePreparationError
    );
  });

  it("rejects a missing file with a typed error", async () => {
    const err = await preparePayload(file("gone.png"), policy()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImagePreparationError);
    expect((err as ImagePreparationError).imagePath).toBe(file("gone.png"));
  });

  it("keeps a non-Error cause readable in the message", () => {
    const err = new ImagePreparationError("/x.png", "libvips said no");
    expect(err.message).toContain("libvips said no");
    expect(err.name).toBe("ImagePreparationError");
    expect(err.cause).toBeUndefined();
  });

  it("preserves an Error cause", () => {
    const cause = new Error("boom");
    expect(new ImagePreparationError("/x.png", cause).cause).toBe(cause);
  });

  it("surfaces a re-encode failure as the typed error", async () => {
    // Truncated PNG: the header parses, so `inspectImage` succeeds and the
    // failure only appears when libvips decodes the pixels for the resize.
    const whole = fs.readFileSync(file("large.png"));
    const truncated = file("truncated.png");
    fs.writeFileSync(truncated, whole.subarray(0, Math.floor(whole.length / 3)));
    await expect(preparePayload(truncated, policy())).rejects.toBeInstanceOf(ImagePreparationError);
  });
});
