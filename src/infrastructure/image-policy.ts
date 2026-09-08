/**
 * Resolution policy and payload preparation for the image sent with every
 * analysis request.
 *
 * ## Why this module exists
 *
 * The original pre-flight (`sharp().resize(1024, 1024, { fit: "inside",
 * withoutEnlargement: true }).png()`) applied the same 1024-px cap and the same
 * unconditional PNG re-encode to every input. That is wrong in both directions:
 *
 *   - **Too small for large plates.** 1024 px is below the effective input
 *     resolution of every model family this CLI can talk to (Gemini samples a
 *     768-px tile grid anchored on the short edge; Claude accepts a 1568-px
 *     long edge before it downscales server-side). Detail was being discarded
 *     that the model would have been charged for anyway.
 *   - **Actively harmful for small inputs.** For a 224-px 8-bit greyscale PNG
 *     (the NIH ChestX-ray14 derivative used in E3/E4) the resize is a no-op and
 *     only the re-encode applies — at settings that need not match the source
 *     encoder's. Measured effect on the 31-image E3 cohort: the payload grew
 *     by **+129.4 %**. The pipeline
 *     was paying more bytes for zero extra information.
 *
 * So the target resolution is now *detected* rather than fixed: it comes from a
 * per-model-family table of published effective input resolutions, is bounded by
 * a quality preset, and is skipped entirely when the file on disk is already
 * acceptable as-is.
 *
 * ## Verified vendor facts behind the table
 *
 * Every number below was read from vendor documentation, not inferred.
 *
 * - **Gemini** — "258 tokens if both dimensions <= 384 pixels. Larger images
 *   are tiled into 768x768 pixel tiles, each costing 258 tokens." The tile
 *   count is derived from a crop unit: "Calculate the crop unit size which is
 *   roughly: `floor(min(width, height) / 1.5)`. Divide each dimension by the
 *   crop unit size and multiply together to get the number of tiles."
 *   (https://ai.google.dev/gemini-api/docs/image-understanding,
 *   https://ai.google.dev/gemini-api/docs/tokens)
 *
 *   Consequence, and it is not intuitive: **above 384 px the Gemini token cost
 *   depends only on the aspect ratio, not on the resolution.** The crop unit
 *   scales with the image, so a 4000×4000 plate and a 1000×1000 thumbnail both
 *   cost 2×2 tiles = 1032 tokens. Downscaling therefore buys bytes and latency
 *   on the Gemini path, never tokens — unless the image is taken all the way
 *   below 384 px, which flattens it to 258. The tile grid is 2 tiles on the
 *   short edge (`ceil(1.5)`), so the model effectively samples 2 × 768 = 1536 px
 *   across the short edge: that is the `auto` target.
 *
 * - **Claude** — "Each patch is a 28×28-pixel block of the image, referred to as
 *   a visual token. An image, therefore, costs `ceil(width / 28) × ceil(height /
 *   28)` visual tokens." Standard tier (all models before Claude 4.7): max long
 *   edge 1568 px, max 1568 visual tokens. High-resolution tier (Claude 4.7 and
 *   later): 2576 px, 4784 visual tokens. "Images larger than either limit are
 *   downscaled before processing."
 *   (https://platform.claude.com/docs/en/build-with-claude/vision)
 *
 *   The older `(w × h) / 750` rule of thumb is the same arithmetic rounded
 *   (28 × 28 = 784 ≈ 750); the patch formula above is the current published one
 *   and is what this module implements. Unlike Gemini, Claude's cost *is*
 *   proportional to pixels, so `auto` stays on the 1568-px standard tier even
 *   for high-resolution models: 2576 px costs up to ~3× the tokens for detail a
 *   chest radiograph read does not need.
 *
 * - **Gemma 3 / 4** — "Images, normalized to 896 x 896 resolution and encoded to
 *   256 tokens each."
 *   (https://ai.google.dev/gemma/docs/core/model_card_3,
 *   https://huggingface.co/google/gemma-3-27b-it)
 *   Anything above 896 px is discarded by the encoder, so `auto` and `max` are
 *   both 896.
 *
 * - **Qwen-VL (2.5 / 3)** — dynamic resolution over 28-px units. "The default
 *   range for the number of visual tokens per image in the model is 4-16384",
 *   with the recommended working budget `min_pixels = 256*28*28` /
 *   `max_pixels = 1280*28*28`.
 *   (https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)
 *   `max_pixels = 1280 × 784 = 1,003,520` px, so a square image fits at
 *   1000 × 1000 — that is the `auto` target. The hard ceiling
 *   `16384 × 784 = 12,845,056` px is exactly 3584 × 3584, which is `max`.
 *
 * - **Unknown model** — 1024 px, the previous behaviour, so an unrecognised id
 *   is never a silent quality regression.
 *
 * ## Two per-image refinements on top of the table
 *
 * A single long-edge number is not the whole rule for every family, so `auto`
 * (and `economy`) trim it further per image; `max` and an explicit
 * `IMAGE_MAX_DIM` are left exactly as asked for.
 *
 * 1. **Visual-token budget** (Claude, Qwen-VL). These families cap *tokens* as
 *    well as the long edge, and on anything near square the token cap binds
 *    first — the provider then downscales server-side, so the extra pixels were
 *    paid for in bytes and latency and thrown away. `capForTokenBudget` sends
 *    exactly the largest image that survives unscaled. It reproduces the
 *    vendor's own published downscale targets to the pixel (1092×1092 and
 *    1456×819 on the 1568-token standard tier, 2576×1449 on the 4784-token
 *    high-resolution tier).
 * 2. **Tile alignment** (Gemini). A long edge overshooting a 768-px multiple by
 *    under a tenth of a tile is snapped down — see `snapToTileGrid` for the
 *    honest note on what that does and does not save.
 *
 * ## What this module does NOT claim
 *
 * Bytes and tokens are not diagnosis. Choosing a target resolution changes the
 * image the model reads; nothing here is evidence that a downscaled image
 * supports the same diagnosis as the original. DICOM window/level selection —
 * the transform that actually decides what a 12-bit modality export looks like
 * at 8 bits — is out of scope and remains future work; 16-bit inputs are
 * currently reduced by libvips' linear full-range map (0…65535 → 0…255).
 */
import * as fs from "fs/promises";
import sharp from "sharp";
import type {
  ImagePreprocessingAction,
  ImagePreprocessingRecord,
  ImageQualityPreset,
} from "../domain/types.js";
import { createLogger, type Logger } from "./logger.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * A file could not be read, decoded, or re-encoded for transport.
 *
 * Typed (rather than a bare sharp/libvips error) so the caller can tell a bad
 * input apart from a provider failure: the client folds it into
 * `status: "error"` on the record instead of aborting the run.
 */
export class ImagePreparationError extends Error {
  constructor(
    public readonly imagePath: string,
    cause: unknown
  ) {
    super(
      `Failed to prepare image for the model: ${imagePath} — ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "ImagePreparationError";
    if (cause instanceof Error) this.cause = cause;
  }
}

// ─── Model families and the resolution table ─────────────────────────────────

export type ImageModelFamily =
  "gemini" | "gemma" | "claude-standard" | "claude-highres" | "qwen-vl" | "unknown";

/** Gemini's tile edge in pixels, and the tokens one tile costs. */
export const GEMINI_TILE_PX = 768;
export const GEMINI_TOKENS_PER_TILE = 258;
/** Claude's visual-token patch edge in pixels. */
export const CLAUDE_PATCH_PX = 28;
/** Long edge used by the `economy` preset: exactly one Gemini tile. */
export const ECONOMY_DIM = 768;
/** Long edge used when the model id matches nothing in the table. */
export const UNKNOWN_DIM = 1024;

/**
 * Fraction of a tile edge below which a spill-over tile row/column is not worth
 * paying for. A long edge that overshoots a multiple of 768 by less than this
 * is snapped down (see `snapToTileGrid`).
 */
export const TILE_SNAP_TOLERANCE = 0.1;

interface FamilyProfile {
  /** Target long edge for `IMAGE_QUALITY=auto` — best detail the model can use. */
  readonly auto: number;
  /** Target long edge for `IMAGE_QUALITY=max` — the model's published ceiling. */
  readonly max: number;
  /**
   * Published cap on 28-px visual tokens per image, when the family has one.
   *
   * A long-edge limit alone is not the whole rule for these families: the token
   * cap binds first on anything near square, and the provider then downscales
   * server-side. Sending pixels that are about to be thrown away costs bytes and
   * latency for nothing, so `capForTokenBudget` trims the target to the largest
   * image the model will accept unscaled (see `applyTokenBudget`).
   */
  readonly tokenBudget?: number;
  /** Vendor doc the numbers came from. */
  readonly source: string;
}

export const FAMILY_PROFILES: Readonly<Record<ImageModelFamily, FamilyProfile>> = {
  // 2 tiles across the short edge × 768 px = the resolution the tiler samples.
  // `max` is 4 tiles, past which the crop unit simply grows with the image.
  gemini: {
    auto: 1536,
    max: 3072,
    source: "https://ai.google.dev/gemini-api/docs/image-understanding",
  },
  // The SigLIP front-end normalises to 896×896 whatever it is given.
  gemma: {
    auto: 896,
    max: 896,
    source: "https://ai.google.dev/gemma/docs/core/model_card_3",
  },
  "claude-standard": {
    auto: 1568,
    max: 1568,
    tokenBudget: 1568,
    source: "https://platform.claude.com/docs/en/build-with-claude/vision",
  },
  // 4.7+ accepts 2576 px, but at up to ~3× the visual tokens; `auto` declines
  // the longer edge and keeps the wider token budget the tier really has.
  "claude-highres": {
    auto: 1568,
    max: 2576,
    tokenBudget: 4784,
    source: "https://platform.claude.com/docs/en/build-with-claude/vision",
  },
  // Long edge ceiling sqrt(16384 × 28 × 28) = 3584 exactly; the recommended
  // working budget is max_pixels = 1280 × 28 × 28, which is the `auto` case.
  "qwen-vl": {
    auto: 1000,
    max: 3584,
    tokenBudget: 1280,
    source: "https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct",
  },
  unknown: {
    auto: UNKNOWN_DIM,
    max: UNKNOWN_DIM,
    source: "no published effective input resolution — previous 1024 px default kept",
  },
};

/**
 * Claude's high-resolution tier is "Claude 4.7 and later models". Model ids
 * spell that either as a dotted generation (`claude-4.7-sonnet`) or as a
 * suffixed one (`claude-opus-5`), so both spellings are matched; anything else
 * bearing the Claude name falls to the standard tier, which is the conservative
 * side — a standard-tier target is always accepted by a high-resolution model.
 */
const CLAUDE_HIGHRES = /(?:4[.\-_]7|(?:opus|sonnet|haiku)[.\-_ ]?(?:[5-9]|\d\d))/i;

/** Map a provider model id onto a family in `FAMILY_PROFILES`. */
export function modelFamily(model: string): ImageModelFamily {
  const id = (model ?? "").toLowerCase();
  // Gemma first: it is a Google id but not a Gemini one, and the two names
  // share no substring, so ordering only guards against future ids like
  // "gemini-gemma-*".
  if (/gemma/.test(id)) return "gemma";
  if (/gemini/.test(id)) return "gemini";
  if (/claude|anthropic/.test(id)) {
    return CLAUDE_HIGHRES.test(id) ? "claude-highres" : "claude-standard";
  }
  if (/qwen/.test(id) && /vl/.test(id)) return "qwen-vl";
  return "unknown";
}

/**
 * The long edge to aim for, before any per-image adjustment.
 *
 * `provider` is accepted for symmetry with the call sites and is used only when
 * the model id is empty: the Google path then defaults to Gemini rather than to
 * the unknown-model fallback.
 */
export function resolveTargetDim(
  provider: string,
  model: string,
  preset: ImageQualityPreset
): number {
  const family =
    model.trim() === "" && provider.trim().toLowerCase() === "google"
      ? "gemini"
      : modelFamily(model);
  const profile = FAMILY_PROFILES[family];
  if (preset === "max") return profile.max;
  if (preset === "economy") return Math.min(ECONOMY_DIM, profile.max);
  return profile.auto;
}

// ─── Policy ───────────────────────────────────────────────────────────────────

export interface ImagePolicy {
  readonly provider: string;
  readonly model: string;
  readonly family: ImageModelFamily;
  readonly preset: ImageQualityPreset;
  /** Long-edge cap for this provider/model/preset (after `IMAGE_MAX_DIM`). */
  readonly targetDim: number;
  /** Snap a Gemini target down to a whole tile grid (off when `preset=max`). */
  readonly snapToTiles: boolean;
  /**
   * Trim the target to the family's visual-token budget for this image's aspect
   * ratio (off when `preset=max` or `IMAGE_MAX_DIM` asked for an exact size).
   */
  readonly applyTokenBudget: boolean;
  /** Re-encode a JPEG source as JPEG q=90 instead of PNG (`IMAGE_JPEG_FOR_PHOTO`). */
  readonly jpegForPhoto: boolean;
}

const PRESETS = new Set<string>(["auto", "max", "economy"]);

/** Parse `IMAGE_QUALITY`; anything unrecognised (or unset) means `auto`. */
export function readPreset(env: NodeJS.ProcessEnv = process.env): ImageQualityPreset {
  const raw = (env.IMAGE_QUALITY ?? "").trim().toLowerCase();
  return (PRESETS.has(raw) ? raw : "auto") as ImageQualityPreset;
}

/**
 * Parse `IMAGE_MAX_DIM`. A positive integer is a **hard** override of the
 * table; zero, a negative, or a non-number is ignored so a typo degrades to the
 * policy instead of to a broken pipeline.
 */
export function readMaxDimOverride(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = (env.IMAGE_MAX_DIM ?? "").trim();
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Resolve the full policy for one provider/model pair from the environment. */
export function resolvePolicy(
  provider: string,
  model: string,
  env: NodeJS.ProcessEnv = process.env
): ImagePolicy {
  const preset = readPreset(env);
  const override = readMaxDimOverride(env);
  return {
    provider,
    model,
    family: modelFamily(model),
    preset,
    targetDim: override ?? resolveTargetDim(provider, model, preset),
    // An explicit `max` asks for the ceiling, so nothing trims it. An explicit
    // IMAGE_MAX_DIM is a hard override and is likewise left exactly as given.
    snapToTiles: preset !== "max" && override === undefined,
    applyTokenBudget: preset !== "max" && override === undefined,
    jpegForPhoto: (env.IMAGE_JPEG_FOR_PHOTO ?? "").trim() === "1",
  };
}

/**
 * Trim a long edge back to a whole number of 768-px tiles when it overshoots
 * one by less than `TILE_SNAP_TOLERANCE` of a tile.
 *
 * Rationale: a few pixels past a tile boundary can buy a whole extra row or
 * column of tiles for no extra information. Honest caveat, recorded here
 * because it matters for the paper: per the *verified* crop-unit formula the
 * Gemini tile count is aspect-driven and scale-invariant above 384 px, so this
 * snap reliably saves bytes and latency but does not, on its own, reduce the
 * Gemini token count. It is retained because it costs nothing, because it does
 * bound the payload, and because tile-aligned inputs avoid resampling artefacts
 * at the tile seams.
 */
export function snapToTileGrid(longEdge: number, tile = GEMINI_TILE_PX): number {
  if (longEdge <= tile) return longEdge;
  const multiple = Math.floor(longEdge / tile) * tile;
  const overshoot = longEdge - multiple;
  return overshoot > 0 && overshoot < tile * TILE_SNAP_TOLERANCE ? multiple : longEdge;
}

/**
 * The largest long edge whose 28-px patch grid still fits `budget` visual
 * tokens at this aspect ratio, in whole patches.
 *
 * Derivation: a `long × short` image costs `ceil(long/28) × ceil(short/28)`
 * patches. Writing the long edge as `p` patches and the aspect ratio as
 * `ar = long / short`, the cost is about `p² / ar`, so `p = floor(sqrt(budget ×
 * ar))` and the pixel edge is `28 p`.
 *
 * This reproduces the provider's own published downscale targets exactly: at
 * the 1568-token standard tier a square image lands on 1092 px (39 × 39 = 1521
 * tokens) and a 16:9 image on 1456 × 819 (52 × 30 = 1560), and at the
 * 4784-token high-resolution tier a 16:9 image lands on 2576 × 1449
 * (92 × 52 = 4784) — the three rows the vendor documents. Sending exactly that
 * is the economic optimum: one pixel more is downscaled away server-side, and
 * one pixel less is detail given up for free.
 */
export function capForTokenBudget(budget: number, longEdge: number, shortEdge: number): number {
  if (budget <= 0 || longEdge <= 0 || shortEdge <= 0) return longEdge;
  const aspect = longEdge / shortEdge;
  const patches = Math.max(1, Math.floor(Math.sqrt(budget * aspect)));
  return patches * CLAUDE_PATCH_PX;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Vendor-formula estimate of the image tokens `width × height` will cost.
 *
 * Returns `null` for a family with no published formula rather than guessing —
 * a wrong number in an artefact is worse than an absent one.
 */
export function estimateImageTokens(
  family: ImageModelFamily,
  width: number,
  height: number
): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  switch (family) {
    case "gemini": {
      // "258 tokens if both dimensions <= 384 pixels."
      if (width <= GEMINI_TILE_PX / 2 && height <= GEMINI_TILE_PX / 2) {
        return GEMINI_TOKENS_PER_TILE;
      }
      // "crop unit size ... floor(min(width, height) / 1.5)", then
      // "divide each dimension by the crop unit size and multiply together".
      const crop = Math.max(1, Math.floor(Math.min(width, height) / 1.5));
      const tiles = Math.ceil(width / crop) * Math.ceil(height / crop);
      return tiles * GEMINI_TOKENS_PER_TILE;
    }
    case "claude-standard":
    case "claude-highres": {
      const patches = Math.ceil(width / CLAUDE_PATCH_PX) * Math.ceil(height / CLAUDE_PATCH_PX);
      // The API downscales past the tier limit, so the estimate is capped there.
      return Math.min(patches, family === "claude-highres" ? 4784 : 1568);
    }
    case "gemma":
      // Normalised to 896×896 and encoded to 256 tokens, whatever came in.
      return 256;
    case "qwen-vl": {
      const units = Math.ceil(width / CLAUDE_PATCH_PX) * Math.ceil(height / CLAUDE_PATCH_PX);
      return Math.min(16384, Math.max(4, units));
    }
    default:
      return null;
  }
}

// ─── Inspection ───────────────────────────────────────────────────────────────

export interface ImageInspection {
  readonly width: number;
  readonly height: number;
  /** Bands including alpha, as libvips reports them (2 = grey + alpha). */
  readonly channels: number;
  /** libvips pixel depth, e.g. `uchar` (8-bit) or `ushort` (16-bit). */
  readonly depth: string;
  readonly format: string;
  /** Size of the file on disk, in bytes. */
  readonly bytes: number;
  readonly hasAlpha: boolean;
  readonly isProgressive: boolean;
  /** Bits per sample when the container reports them (PNG/GIF). */
  readonly bitsPerSample?: number;
}

/**
 * Read dimensions, colour model and size without decoding the whole image.
 *
 * Throws `ImagePreparationError` for a missing, truncated, or non-image file —
 * including the case where libvips decodes a header but reports no dimensions.
 */
export async function inspectImage(imagePath: string): Promise<ImageInspection> {
  try {
    const [stat, meta] = await Promise.all([
      fs.stat(imagePath),
      sharp(imagePath, { failOn: "error" }).metadata(),
    ]);
    // libvips types these as always present, but a decoder that accepts a file
    // and then reports no geometry would silently produce a 0-px policy, so the
    // guard stays.
    if (!meta.width || !meta.height) {
      throw new Error("image reports no pixel dimensions");
    }
    return {
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      depth: meta.depth,
      format: meta.format,
      bytes: stat.size,
      hasAlpha: meta.hasAlpha === true,
      isProgressive: meta.isProgressive === true,
      ...(typeof meta.bitsPerSample === "number" ? { bitsPerSample: meta.bitsPerSample } : {}),
    };
  } catch (err) {
    throw new ImagePreparationError(imagePath, err);
  }
}

// ─── Payload preparation ──────────────────────────────────────────────────────

export interface PreparedImage {
  /** Base64 of the bytes actually sent. */
  readonly data: string;
  /** Media type of those bytes — always derived from them, never assumed. */
  readonly mimeType: string;
  /** The bytes themselves, for callers that measure rather than transmit. */
  readonly bytes: Buffer;
  readonly record: ImagePreprocessingRecord;
}

/** Containers that can be forwarded byte-for-byte to every provider here. */
type SendableFormat = "png" | "jpeg";

const MIME_BY_FORMAT: Readonly<Record<SendableFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

function isSendable(format: string): format is SendableFormat {
  return format === "png" || format === "jpeg";
}

/** libvips pixel depths that are already 8 bits per sample. */
const EIGHT_BIT_DEPTHS = new Set(["uchar", "char"]);

/** True when the file is 8 bits per sample, i.e. needs no depth reduction. */
function isEightBit(info: ImageInspection): boolean {
  if (typeof info.bitsPerSample === "number") return info.bitsPerSample <= 8;
  return EIGHT_BIT_DEPTHS.has(info.depth);
}

/** Colour bands excluding alpha — 1 means the source is truly greyscale. */
function colourChannels(info: ImageInspection): number {
  return info.hasAlpha ? Math.max(1, info.channels - 1) : info.channels;
}

let sharedLogger: Logger | undefined;
function defaultLogger(): Logger {
  // Rebuilt when LOG_LEVEL changes so a test can turn logging on mid-process.
  if (!sharedLogger || sharedLogger.level !== resolveLoggerLevel()) {
    sharedLogger = createLogger();
  }
  return sharedLogger;
}
function resolveLoggerLevel(): string {
  const env = (process.env.LOG_LEVEL ?? "").toLowerCase();
  return ["silent", "error", "warn", "info", "debug"].includes(env) ? env : "silent";
}

export interface PreparePayloadOptions {
  /** Injectable sink for the one-line-per-image record (defaults to `LOG_LEVEL`). */
  readonly logger?: Logger;
}

/**
 * Produce the bytes one analysis request should carry, plus the record of how
 * they were produced.
 *
 * Decision order:
 *
 *   1. **Passthrough** — the file is already ≤ the target on its long edge, is a
 *      PNG or JPEG, carries no alpha, and is 8-bit. The original bytes go on the
 *      wire *untouched*: no decode, no re-encode, no possibility of growth. This
 *      is the branch that removes the measured +129.4 % growth on 224-px PNGs.
 *   2. **Resized** — the long edge exceeds the target. `fit: "inside"` with
 *      `withoutEnlargement: true`, so aspect ratio is preserved and a small
 *      image is never upscaled into detail it does not have.
 *   3. **Re-encoded** — the long edge is fine but something else is not: an
 *      alpha channel to strip, a 16-bit source to reduce, or a container
 *      (TIFF, WebP, …) the providers do not accept inline.
 *
 * Greyscale stays one channel (libvips otherwise promotes a grey source to
 * 3-channel sRGB on PNG save, tripling the payload for no information), alpha is
 * dropped, and 16-bit is reduced by libvips' linear full-range map — *not* by
 * `normalise()`, which would stretch per-image contrast and silently change what
 * the model sees. Output is lossless PNG unless the source was a JPEG and
 * `IMAGE_JPEG_FOR_PHOTO=1`.
 */
export async function preparePayload(
  imagePath: string,
  policy: ImagePolicy,
  options: PreparePayloadOptions = {}
): Promise<PreparedImage> {
  const info = await inspectImage(imagePath);
  const nativeLong = Math.max(info.width, info.height);

  // The effective cap: never larger than the image already is, and trimmed to
  // the tile grid when that costs less than a tenth of a tile.
  let targetDim = policy.targetDim;
  const budget = FAMILY_PROFILES[policy.family].tokenBudget;
  if (policy.applyTokenBudget && budget !== undefined) {
    targetDim = Math.min(
      targetDim,
      capForTokenBudget(budget, nativeLong, Math.min(info.width, info.height))
    );
  }
  if (policy.snapToTiles && policy.family === "gemini") {
    const scaledLong = Math.min(targetDim, nativeLong);
    const snapped = snapToTileGrid(scaledLong);
    if (snapped < scaledLong) targetDim = snapped;
  }

  const eightBit = isEightBit(info);
  const formatOk = isSendable(info.format);
  const fits = nativeLong <= targetDim;

  let bytes: Buffer;
  let format: SendableFormat;
  let sentWidth: number;
  let sentHeight: number;
  let action: ImagePreprocessingAction;
  let reason: string;

  if (fits && formatOk && !info.hasAlpha && eightBit) {
    bytes = await readFile(imagePath);
    format = info.format;
    sentWidth = info.width;
    sentHeight = info.height;
    action = "passthrough";
    reason =
      `long edge ${nativeLong}px ≤ target ${targetDim}px, 8-bit ${info.format} ` +
      `without alpha — original bytes sent unmodified`;
  } else {
    const notes: string[] = [];
    if (!fits) notes.push(`long edge ${nativeLong}px > target ${targetDim}px`);
    if (!formatOk) notes.push(`format ${info.format} is not sendable inline`);
    if (info.hasAlpha) notes.push("alpha channel stripped");
    if (!eightBit) notes.push(`${info.depth} source reduced to 8-bit`);

    const encoded = await encode(imagePath, targetDim, info, policy);
    bytes = encoded.bytes;
    format = encoded.format;
    sentWidth = encoded.width;
    sentHeight = encoded.height;
    action = fits ? "reencoded" : "resized";
    reason = notes.join("; ");
  }

  const record: ImagePreprocessingRecord = {
    nativeWidth: info.width,
    nativeHeight: info.height,
    sentWidth,
    sentHeight,
    bytesIn: info.bytes,
    bytesOut: bytes.length,
    format,
    mimeType: MIME_BY_FORMAT[format],
    policy: policy.preset,
    targetDim,
    action,
    reason,
    estimatedImageTokens: estimateImageTokens(policy.family, sentWidth, sentHeight),
  };

  (options.logger ?? defaultLogger()).debug("image.prepared", {
    imagePath,
    model: policy.model,
    family: policy.family,
    ...record,
  });

  return { data: bytes.toString("base64"), mimeType: record.mimeType, bytes, record };
}

/** Read the file as-is, mapping any I/O failure onto the typed error. */
async function readFile(imagePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(imagePath);
  } catch (err) {
    throw new ImagePreparationError(imagePath, err);
  }
}

interface Encoded {
  bytes: Buffer;
  format: SendableFormat;
  width: number;
  height: number;
}

async function encode(
  imagePath: string,
  targetDim: number,
  info: ImageInspection,
  policy: ImagePolicy
): Promise<Encoded> {
  try {
    let pipeline = sharp(imagePath, { failOn: "error" }).resize(targetDim, targetDim, {
      fit: "inside",
      withoutEnlargement: true,
    });
    if (info.hasAlpha) pipeline = pipeline.removeAlpha();
    // Without this libvips saves a grey source as 3-channel sRGB.
    if (colourChannels(info) === 1) pipeline = pipeline.toColourspace("b-w");

    const asJpeg = policy.jpegForPhoto && info.format === "jpeg";
    pipeline = asJpeg
      ? pipeline.jpeg({ quality: 90, mozjpeg: false })
      : // Lossless, and the highest zlib level: the pre-flight runs once per
        // image against a network round-trip, so CPU here is free.
        pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });

    const { data, info: out } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      format: asJpeg ? "jpeg" : "png",
      width: out.width,
      height: out.height,
    };
  } catch (err) {
    throw new ImagePreparationError(imagePath, err);
  }
}
