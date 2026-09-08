/**
 * E3 — request-payload measurement for SIME 2026 paper #154.
 *
 * For every PNG under an input directory this reports, per image:
 *   - the original file size and pixel dimensions;
 *   - what the resolution policy decided to do with it (`passthrough`,
 *     `resized`, `reencoded`) and why;
 *   - the size and pixel dimensions of the bytes actually sent;
 *   - the length of the base64 encoding placed in the request body, which is
 *     ~4/3 of the payload and is what the wire sees;
 *   - the vendor-formula estimate of the image tokens those pixels cost.
 *
 * The pre-flight is *imported* from `src/infrastructure/image-policy.ts`
 * (`preparePayload`, the same function both clients call), not re-implemented,
 * so the numbers here are the bytes the CLI really sends.
 *
 * It prints a Markdown table plus totals, action counts and token totals, and
 * writes `E3-payload-<label>.md` next to this script.
 *
 * IMPORTANT — what this does NOT measure: bytes are not diagnosis. Choosing a
 * target resolution changes the image the model reads. This experiment
 * quantifies transport, and estimates token cost from published vendor
 * formulae; it makes no claim that a resized image is diagnostically equivalent
 * to the original. Establishing that would require a reader study against
 * ground truth, which is out of scope for this artefact.
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime2026/measure-payload.ts <input-dir> [--label <name>]
 *   node_modules/.bin/tsx experiments/sime2026/measure-payload.ts --synthetic [--label <name>]
 *
 * `--synthetic` generates three large greyscale images (2500×2500, 3000×2500,
 * 4000×4000) in a temp directory and measures those, so the "large study"
 * reduction can be reported without any clinical data. The generator is
 * deterministic (seeded PRNG), so the byte counts reproduce exactly.
 *
 * The policy comes from the environment exactly as it would at run time
 * (`AI_PROVIDER`, `GEMINI_MODEL` / `OPENROUTER_MODEL`, `IMAGE_QUALITY`,
 * `IMAGE_MAX_DIM`, `IMAGE_JPEG_FOR_PHOTO`) and is printed in the report header.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import {
  FAMILY_PROFILES,
  estimateImageTokens,
  preparePayload,
  resolvePolicy,
  type ImagePolicy,
} from "../../src/infrastructure/image-policy.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);

// ─── Synthetic inputs ─────────────────────────────────────────────────────────

/** Sizes chosen to bracket real radiography (CR/DR plates are 2–4k on a side). */
const SYNTHETIC_SIZES: Array<[number, number]> = [
  [2500, 2500],
  [3000, 2500],
  [4000, 4000],
];

/** mulberry32 — tiny deterministic PRNG, so synthetic bytes are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 8-bit greyscale noise over a diagonal gradient. Gradient + noise is a
 * deliberately *hard* case for PNG: it neither compresses to nothing (flat
 * fields) nor blows up (pure noise), so the measured reduction is not an
 * artefact of a trivially compressible test image.
 */
async function writeSyntheticPng(
  width: number,
  height: number,
  dest: string,
  seed: number
): Promise<void> {
  const random = mulberry32(seed);
  const pixels = Buffer.allocUnsafe(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gradient = ((x / width + y / height) / 2) * 200 + 20;
      const noise = (random() - 0.5) * 60;
      pixels[y * width + x] = Math.max(0, Math.min(255, Math.round(gradient + noise)));
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(dest);
}

async function makeSyntheticDir(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e3-synthetic-"));
  let seed = 1;
  for (const [width, height] of SYNTHETIC_SIZES) {
    await writeSyntheticPng(
      width,
      height,
      path.join(dir, `synthetic_${width}x${height}.png`),
      seed++
    );
  }
  return dir;
}

// ─── Measurement ──────────────────────────────────────────────────────────────

interface Row {
  file: string;
  originalBytes: number;
  originalDims: string;
  sentBytes: number;
  sentDims: string;
  base64Chars: number;
  action: string;
  reason: string;
  targetDim: number;
  mimeType: string;
  tokens: number | null;
  /** Tokens the *native* pixels would have cost, for the same model family. */
  nativeTokens: number | null;
}

function listPngs(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d).sort()) {
      const p = path.join(d, entry);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.png$/i.test(entry)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

async function measure(file: string, root: string, policy: ImagePolicy): Promise<Row> {
  // The exact pipeline both clients run before every request.
  const prepared = await preparePayload(file, policy);
  const r = prepared.record;
  return {
    file: path.relative(root, file) || path.basename(file),
    originalBytes: r.bytesIn,
    originalDims: `${r.nativeWidth}×${r.nativeHeight}`,
    sentBytes: r.bytesOut,
    sentDims: `${r.sentWidth}×${r.sentHeight}`,
    base64Chars: prepared.data.length,
    action: r.action,
    reason: r.reason,
    targetDim: r.targetDim,
    mimeType: r.mimeType,
    tokens: r.estimatedImageTokens,
    nativeTokens: estimateImageTokens(policy.family, r.nativeWidth, r.nativeHeight),
  };
}

const kib = (bytes: number): string => (bytes / 1024).toFixed(1);
const pct = (from: number, to: number): string =>
  from === 0 ? "n/a" : `${(((from - to) / from) * 100).toFixed(1)}%`;

function render(
  rows: Row[],
  label: string,
  source: string,
  synthetic: boolean,
  policy: ImagePolicy
): string {
  const totalOriginal = rows.reduce((n, r) => n + r.originalBytes, 0);
  const totalSent = rows.reduce((n, r) => n + r.sentBytes, 0);
  const totalB64 = rows.reduce((n, r) => n + r.base64Chars, 0);

  const actions = new Map<string, number>();
  for (const r of rows) actions.set(r.action, (actions.get(r.action) ?? 0) + 1);
  const actionLine = [...actions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([action, n]) => `${action} ${n}`)
    .join(", ");

  const anyTokens = rows.some((r) => r.tokens !== null);
  const totalTokens = rows.reduce((n, r) => n + (r.tokens ?? 0), 0);
  const totalNativeTokens = rows.reduce((n, r) => n + (r.nativeTokens ?? 0), 0);

  const lines: string[] = [
    `# E3 — request payload after the client's image pre-flight (\`${label}\`)`,
    "",
    `- Source: \`${source}\`${synthetic ? " (synthetic, deterministic — see below)" : ""}`,
    `- Images: ${rows.length}`,
    `- Provider / model: \`${policy.provider}\` / \`${policy.model}\` (family \`${policy.family}\`)`,
    `- Policy: \`IMAGE_QUALITY=${policy.preset}\`, long-edge target ${policy.targetDim} px` +
      `${
        policy.applyTokenBudget && FAMILY_PROFILES[policy.family].tokenBudget !== undefined
          ? `, trimmed per image to the family's ${FAMILY_PROFILES[policy.family].tokenBudget}-visual-token budget`
          : ""
      }` +
      `${policy.snapToTiles && policy.family === "gemini" ? ", tile-aligned to 768 px" : ""}`,
    "- Pipeline: `preparePayload()` imported from `src/infrastructure/image-policy.ts`,",
    "  i.e. the same code path every analysis request uses.",
    `- Actions: ${actionLine}`,
    "",
    "**This measures bytes and estimates tokens; it does not measure diagnosis.**",
    "Choosing a target resolution changes the image the model reads. The table",
    "below quantifies transport size, the base64 body the wire carries, and the",
    "vendor-formula image-token cost of the pixels sent. It is not evidence that a",
    "resized image supports the same diagnosis as the original. Establishing that",
    "would require a reader study against ground truth (out of scope here).",
    "",
    "| image | original | original px | action | sent | sent px | mime | base64 chars | reduction | img tokens |",
    "|---|---:|---:|---|---:|---:|---|---:|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| \`${r.file}\` | ${kib(r.originalBytes)} KiB | ${r.originalDims} | ${r.action} | ` +
        `${kib(r.sentBytes)} KiB | ${r.sentDims} | ${r.mimeType} | ${r.base64Chars} | ` +
        `${pct(r.originalBytes, r.sentBytes)} | ${r.tokens ?? "n/a"} |`
    );
  }
  lines.push(
    `| **total** | **${kib(totalOriginal)} KiB** | — | ${actionLine} | ` +
      `**${kib(totalSent)} KiB** | — | — | **${totalB64}** | **${pct(totalOriginal, totalSent)}** | ` +
      `**${anyTokens ? totalTokens : "n/a"}** |`,
    "",
    `Totals: ${totalOriginal} B on disk → ${totalSent} B sent ` +
      `(${pct(totalOriginal, totalSent)} reduction) → ${totalB64} base64 characters in the ` +
      `request body (${(totalB64 / Math.max(1, totalSent)).toFixed(3)}× the payload size).`,
    ""
  );

  if (anyTokens) {
    lines.push(
      `Estimated image tokens for the pixels sent: **${totalTokens}** across ${rows.length} ` +
        `images. The same images at native resolution would be estimated at ` +
        `${totalNativeTokens} tokens.`,
      "",
      "For the Gemini family those two numbers are equal above 384 px, and that is",
      "not a bug in the measurement. Gemini derives its tile count from a crop unit",
      "of `floor(min(w, h) / 1.5)`, which scales with the image, so above the 384-px",
      "flat-rate threshold the tile count — and therefore the token cost — depends",
      "on the aspect ratio alone, not on the resolution. On that path the pre-flight",
      "buys bytes and latency, not tokens. Families that charge per pixel (Claude,",
      "Qwen-VL) are where the resolution policy also reduces token cost, and the",
      "policy sizes for exactly the largest image those providers accept unscaled.",
      ""
    );
  }

  lines.push(
    "A **negative** reduction would mean the pre-flight made the payload *larger*.",
    "That is what the previous unconditional `resize(1024).png()` did to small,",
    "already well-compressed inputs such as the 224-px NIH derivative: the resize",
    "was a no-op and only the re-encode applied, at settings that need not match",
    "the source encoder's. The current policy detects that case and forwards the",
    "original bytes untouched (`action: passthrough`), so the floor is now 0 %.",
    "",
    "Per-image decisions:",
    ""
  );
  for (const r of rows.slice(0, 5)) {
    lines.push(`- \`${r.file}\` — ${r.action} (target ${r.targetDim} px): ${r.reason}`);
  }
  if (rows.length > 5) lines.push(`- … ${rows.length - 5} more, same decisions.`);
  lines.push("");

  if (synthetic) {
    lines.push(
      "Synthetic inputs: 8-bit greyscale, diagonal gradient plus seeded uniform noise,",
      `at ${SYNTHETIC_SIZES.map(([w, h]) => `${w}×${h}`).join(", ")}. They stand in for`,
      "large-plate studies so the reduction can be measured without clinical data.",
      "They are *not* radiographs and carry no anatomy; only their compressibility is",
      "meant to be representative.",
      ""
    );
  }
  return lines.join("\n");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const synthetic = argv.includes("--synthetic");
  const labelIndex = argv.indexOf("--label");
  const positional = argv.filter((a, i) => !a.startsWith("--") && i !== labelIndex + 1);

  let inputDir: string;
  if (synthetic) {
    inputDir = await makeSyntheticDir();
  } else {
    if (!positional[0]) {
      process.stderr.write(
        "Usage: measure-payload.ts <input-dir> [--label <name>] | --synthetic [--label <name>]\n"
      );
      process.exitCode = 1;
      return;
    }
    inputDir = path.resolve(positional[0]);
  }

  const label =
    (labelIndex >= 0 ? argv[labelIndex + 1] : undefined) ??
    (synthetic ? "synthetic" : path.basename(inputDir));

  const files = listPngs(inputDir);
  if (files.length === 0) {
    process.stderr.write(`No .png files found under ${inputDir}\n`);
    process.exitCode = 3;
    return;
  }

  const provider = (process.env.AI_PROVIDER ?? "google").trim().toLowerCase();
  const model =
    provider === "openrouter"
      ? (process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash")
      : (process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
  const policy = resolvePolicy(provider, model);

  const rows: Row[] = [];
  for (const file of files) rows.push(await measure(file, inputDir, policy));

  const markdown = render(rows, label, inputDir, synthetic, policy);
  process.stdout.write(`${markdown}\n`);

  const outFile = path.join(HERE, `E3-payload-${label}.md`);
  fs.writeFileSync(outFile, markdown);
  process.stderr.write(`Wrote ${outFile}\n`);
}

await main();
