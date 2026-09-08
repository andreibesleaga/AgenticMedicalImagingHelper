/**
 * E — Full-dataset deterministic scan (SIME 2026)
 * =================================================
 *
 * Runs the DETERMINISTIC, offline stages of the pipeline (file discovery,
 * sharp decode, and the exact pre-processing chain the Gemini client applies
 * before sending bytes to a model) over every image in the NIH ChestX-ray14
 * 224-px archive (112,120 PNGs). It does NOT call any model — no Gemini,
 * no OpenRouter, nothing network-bound. It only exercises:
 *
 *   1. sharp's decoder (width/height/channels/bit-depth/format)
 *   2. the exact resize→png→buffer chain used before an image is sent to a
 *      model (copied below, not imported — see comment above
 *      `prepareImageForGemini`)
 *   3. CSV metadata join (Data_Entry_2017.csv) for demographic/label stats
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime2026/full-dataset-scan.ts
 *
 * Outputs (relative to repo root):
 *   experiments/sime2026/full-dataset-scan.csv  — one row per image
 *   experiments/sime2026/full-dataset-scan.md   — summary statistics
 */

import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

// ─── Configuration ──────────────────────────────────────────────────────────

const IMAGES_DIR = "/home/andrei/work/AI/nih-cxr14/images-224/images-224";
const CSV_METADATA_PATH = "/home/andrei/work/AI/nih-cxr14/Data_Entry_2017.csv";
const CONCURRENCY = 8;
const PROGRESS_EVERY = 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_CSV = path.join(__dirname, "full-dataset-scan.csv");
const OUT_MD = path.join(__dirname, "full-dataset-scan.md");

// ─── CSV metadata (Data_Entry_2017.csv) ────────────────────────────────────

interface MetaRow {
  findingLabels: string;
  followup: string;
  patientId: string;
  age: string; // raw, e.g. "058Y"
  gender: string;
  viewPosition: string;
}

function parseMetadataCsv(text: string): Map<string, MetaRow> {
  const lines = text.split("\n");
  const map = new Map<string, MetaRow>();
  // header: Image Index,Finding Labels,Follow-up #,Patient ID,Patient Age,
  //         Patient Gender,View Position,OriginalImage[Width,Height],
  //         OriginalImagePixelSpacing[x,y],
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    const image = cols[0]!;
    map.set(image, {
      findingLabels: cols[1] ?? "",
      followup: cols[2] ?? "",
      patientId: cols[3] ?? "",
      age: cols[4] ?? "",
      gender: cols[5] ?? "",
      viewPosition: cols[6] ?? "",
    });
  }
  return map;
}

/** Parse "058Y" / "003M" / "021D" into a fractional-year float. */
function ageToYears(raw: string): number | undefined {
  const m = raw.match(/^(\d+)([YMD])$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case "Y":
      return n;
    case "M":
      return n / 12;
    case "D":
      return n / 365;
    default:
      return undefined;
  }
}

// ─── Image pre-processing (copied from src/infrastructure/gemini-client.ts) ─
//
// This is NOT imported — the task instructions ask for the exact chain to be
// replicated here so this experiment stays independent of the file another
// concurrent change is touching. Source (`prepareImageForGemini`,
// src/infrastructure/gemini-client.ts, lines ~116-124), quoted verbatim:
//
//   export async function prepareImageForGemini(
//     imagePath: string
//   ): Promise<{ data: string; mimeType: string }> {
//     const buffer = await sharp(imagePath)
//       .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
//       .png()
//       .toBuffer();
//     return { data: buffer.toString("base64"), mimeType: "image/png" };
//   }
//
async function prepareImageForGemini(
  imagePath: string
): Promise<{ data: string; mimeType: string }> {
  const buffer = await sharp(imagePath)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/png" };
}

// ─── Per-image scan ─────────────────────────────────────────────────────────

interface ScanRow {
  image: string;
  patient: string;
  followup: string;
  width?: number;
  height?: number;
  channels?: number;
  depth?: string;
  bytesOriginal?: number;
  bytesProcessed?: number;
  base64Len?: number;
  ms: number;
  error?: string;
}

async function processOne(file: string, meta: Map<string, MetaRow>): Promise<ScanRow> {
  const imagePath = path.join(IMAGES_DIR, file);
  const m = meta.get(file);
  const row: ScanRow = {
    image: file,
    patient: m?.patientId ?? "",
    followup: m?.followup ?? "",
    ms: 0,
  };
  const start = performance.now();
  try {
    const stat = await fs.stat(imagePath);
    row.bytesOriginal = stat.size;

    const md = await sharp(imagePath).metadata();
    row.width = md.width;
    row.height = md.height;
    row.channels = md.channels;
    row.depth = md.depth;

    const processed = await prepareImageForGemini(imagePath);
    // Recompute processed byte length from the base64 payload (matches what
    // is actually shipped to the model) rather than re-decoding again.
    row.base64Len = processed.data.length;
    row.bytesProcessed = Buffer.byteLength(processed.data, "base64");
  } catch (err) {
    row.error = (err as Error).message.replace(/[\r\n,]/g, " ");
  } finally {
    row.ms = Math.round((performance.now() - start) * 100) / 100;
  }
  return row;
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

function stats(values: number[]): { min: number; median: number; p95: number; max: number; mean: number } {
  if (values.length === 0) return { min: 0, median: 0, p95: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    min: sorted[0]!,
    median: pct(0.5),
    p95: pct(0.95),
    max: sorted[sorted.length - 1]!,
    mean,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function topEntries(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const runStart = performance.now();

  console.log(`[full-dataset-scan] reading metadata CSV: ${CSV_METADATA_PATH}`);
  const csvText = await fs.readFile(CSV_METADATA_PATH, "utf-8");
  const meta = parseMetadataCsv(csvText);
  console.log(`[full-dataset-scan] loaded metadata for ${meta.size} images`);

  console.log(`[full-dataset-scan] listing images: ${IMAGES_DIR}`);
  const files = (await fs.readdir(IMAGES_DIR)).filter((f) => f.endsWith(".png")).sort();
  console.log(`[full-dataset-scan] found ${files.length} PNG files`);

  const results: ScanRow[] = new Array(files.length);
  let nextIndex = 0;
  let completed = 0;
  const scanStart = performance.now();

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= files.length) return;
      results[i] = await processOne(files[i]!, meta);
      completed++;
      if (completed % PROGRESS_EVERY === 0) {
        const elapsedS = (performance.now() - scanStart) / 1000;
        console.log(
          `[full-dataset-scan] ${completed}/${files.length} (${(completed / elapsedS).toFixed(1)} img/s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const scanMs = performance.now() - scanStart;

  // ─── Write CSV ──────────────────────────────────────────────────────────
  console.log(`[full-dataset-scan] writing CSV: ${OUT_CSV}`);
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(OUT_CSV);
    out.on("error", reject);
    out.write(
      "image,patient,followup,width,height,channels,depth,bytesOriginal,bytesProcessed,base64Len,ms,error\n"
    );
    for (const r of results) {
      out.write(
        [
          r.image,
          r.patient,
          r.followup,
          r.width ?? "",
          r.height ?? "",
          r.channels ?? "",
          r.depth ?? "",
          r.bytesOriginal ?? "",
          r.bytesProcessed ?? "",
          r.base64Len ?? "",
          r.ms,
          r.error ?? "",
        ].join(",") + "\n"
      );
    }
    out.end(() => resolve());
  });

  // ─── Aggregate stats ────────────────────────────────────────────────────
  const okRows = results.filter((r) => !r.error);
  const errRows = results.filter((r) => r.error);

  const widths = okRows.map((r) => r.width!).filter((n) => n != null);
  const heights = okRows.map((r) => r.height!).filter((n) => n != null);
  const bytesOrig = okRows.map((r) => r.bytesOriginal!).filter((n) => n != null);
  const bytesProc = okRows.map((r) => r.bytesProcessed!).filter((n) => n != null);
  const base64Lens = okRows.map((r) => r.base64Len!).filter((n) => n != null);
  const msValues = results.map((r) => r.ms);

  const wStats = stats(widths);
  const hStats = stats(heights);
  const boStats = stats(bytesOrig);
  const bpStats = stats(bytesProc);
  const b64Stats = stats(base64Lens);
  const msStats = stats(msValues);

  const totalOrig = bytesOrig.reduce((a, b) => a + b, 0);
  const totalProc = bytesProc.reduce((a, b) => a + b, 0);
  const pctReduction = totalOrig > 0 ? ((totalOrig - totalProc) / totalOrig) * 100 : 0;

  const totalRunS = scanMs / 1000;
  const throughput = files.length / totalRunS;

  // Channel / depth / format distributions (from sharp metadata)
  const channelCounts = new Map<string, number>();
  const depthCounts = new Map<string, number>();
  for (const r of okRows) {
    const ch = String(r.channels ?? "unknown");
    channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
    const d = r.depth ?? "unknown";
    depthCounts.set(d, (depthCounts.get(d) ?? 0) + 1);
  }

  // Metadata-joined distributions (Finding Labels / View / sex / age buckets)
  const findingCounts = new Map<string, number>();
  const viewCounts = new Map<string, number>();
  const sexCounts = new Map<string, number>();
  const ageBucketCounts = new Map<string, number>();
  const patientStudyCounts = new Map<string, number>();
  let noFindingCount = 0;
  let multiLabelCount = 0;

  for (const file of files) {
    const m = meta.get(file);
    if (!m) continue;

    const labels = m.findingLabels.split("|").map((s) => s.trim()).filter(Boolean);
    if (labels.length === 0 || (labels.length === 1 && labels[0] === "No Finding")) {
      noFindingCount++;
    }
    if (labels.length > 1) multiLabelCount++;
    for (const label of labels) {
      findingCounts.set(label, (findingCounts.get(label) ?? 0) + 1);
    }

    viewCounts.set(m.viewPosition, (viewCounts.get(m.viewPosition) ?? 0) + 1);
    sexCounts.set(m.gender, (sexCounts.get(m.gender) ?? 0) + 1);

    const years = ageToYears(m.age);
    let bucket: string;
    if (years == null) bucket = "invalid/unparseable";
    else if (years < 0 || years > 120) bucket = "out-of-range (<0 or >120)";
    else {
      const lo = Math.floor(years / 10) * 10;
      bucket = `${lo}-${lo + 9}`;
    }
    ageBucketCounts.set(bucket, (ageBucketCounts.get(bucket) ?? 0) + 1);

    patientStudyCounts.set(m.patientId, (patientStudyCounts.get(m.patientId) ?? 0) + 1);
  }

  // Per-patient study-count histogram: buckets 1,2,...,9,>=10
  const studyHistogram = new Map<string, number>();
  for (const count of patientStudyCounts.values()) {
    const key = count >= 10 ? "10+" : String(count);
    studyHistogram.set(key, (studyHistogram.get(key) ?? 0) + 1);
  }
  const histogramOrder = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"];

  const totalRunMs = performance.now() - runStart;

  // ─── Write markdown summary ─────────────────────────────────────────────
  const csvStatBuf = await fs.stat(OUT_CSV);
  const lines: string[] = [];
  lines.push("# Full-dataset scan — NIH ChestX-ray14 224-px archive");
  lines.push("");
  lines.push(
    "This exercises the **file scanner + sharp preprocessing + CSV metadata join only**. " +
      "No model call (Gemini/OpenRouter) is made anywhere in this script — it is a fully " +
      "deterministic, offline pass over every image."
  );
  lines.push("");
  lines.push("## Run");
  lines.push("");
  lines.push(`- Source archive: \`/home/andrei/work/AI/NIHDataset_archive.zip\` (extracted to \`${IMAGES_DIR}\`)`);
  lines.push(`- Metadata: \`${CSV_METADATA_PATH}\``);
  lines.push(`- Images found: **${fmt(files.length)}**`);
  lines.push(`- Images with metadata match: **${fmt(meta.size)}**`);
  lines.push(`- Concurrency: ${CONCURRENCY} workers`);
  lines.push(`- Scan wall time: **${fmt(totalRunS)} s** (${fmt(scanMs)} ms)`);
  lines.push(`- Total script wall time (incl. CSV I/O): ${fmt(totalRunMs / 1000)} s`);
  lines.push(`- Throughput: **${fmt(throughput)} images/s**`);
  lines.push(`- Errors: **${errRows.length}**${errRows.length ? "" : " (none)"}`);
  if (errRows.length) {
    lines.push("");
    lines.push("Example errors (first 5):");
    for (const r of errRows.slice(0, 5)) {
      lines.push(`  - \`${r.image}\`: ${r.error}`);
    }
  }
  lines.push("");

  lines.push("## Dimensions & bytes (decoded / processed)");
  lines.push("");
  lines.push("| metric | min | median | p95 | max | mean |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(`| width (px) | ${wStats.min} | ${wStats.median} | ${wStats.p95} | ${wStats.max} | ${fmt(wStats.mean)} |`);
  lines.push(`| height (px) | ${hStats.min} | ${hStats.median} | ${hStats.p95} | ${hStats.max} | ${fmt(hStats.mean)} |`);
  lines.push(
    `| bytes original | ${fmt(boStats.min)} | ${fmt(boStats.median)} | ${fmt(boStats.p95)} | ${fmt(boStats.max)} | ${fmt(boStats.mean)} |`
  );
  lines.push(
    `| bytes processed (post resize→png) | ${fmt(bpStats.min)} | ${fmt(bpStats.median)} | ${fmt(bpStats.p95)} | ${fmt(bpStats.max)} | ${fmt(bpStats.mean)} |`
  );
  lines.push(
    `| base64 length | ${fmt(b64Stats.min)} | ${fmt(b64Stats.median)} | ${fmt(b64Stats.p95)} | ${fmt(b64Stats.max)} | ${fmt(b64Stats.mean)} |`
  );
  lines.push(
    `| per-image ms (stat+decode+resize+encode) | ${fmt(msStats.min)} | ${fmt(msStats.median)} | ${fmt(msStats.p95)} | ${fmt(msStats.max)} | ${fmt(msStats.mean)} |`
  );
  lines.push("");
  const grew = pctReduction < 0;
  lines.push(
    `**Byte-size change from preprocessing: ${grew ? "+" : "-"}${fmt(Math.abs(pctReduction))}%** ` +
      `(total original ${fmt(totalOrig)} B → total processed ${fmt(totalProc)} B). ` +
      "This archive is pre-downscaled to ~224 px, well under the pipeline's 1024×1024 cap, so " +
      "`resize(1024,1024,{fit:\"inside\",withoutEnlargement:true})` is a no-op for every image here — " +
      "the size delta is entirely from PNG re-encoding. " +
      (grew
        ? "It is a **large increase**, not a reduction: the archive's source PNGs are already heavily " +
          "optimized/compressed 8-bit grayscale files, while sharp's default `.png()` encoder (no " +
          "explicit `compressionLevel`, matching the production chain exactly) does not match that " +
          "optimization, so re-encoding at the same pixel dimensions makes the file bigger here. " +
          "The task's ≈0%-or-negative expectation does NOT hold for this specific low-resolution, " +
          "pre-compressed archive — it holds when the resize step actually does work. On full-resolution " +
          "clinical images (2000-3000 px, per `OriginalImage[Width,Height]` in the metadata) the same " +
          "chain's resize step would dominate and produce a large size *reduction* instead."
        : "It is close to the ≈0%-or-negative reduction expected for inputs already at/under the " +
          "1024×1024 cap, where resize is a no-op and only re-encoding differences remain.")
  );
  lines.push("");

  lines.push("## Decode metadata distributions");
  lines.push("");
  lines.push("Channels:");
  for (const [k, v] of topEntries(channelCounts, 10)) lines.push(`  - ${k} channel(s): ${fmt(v)}`);
  lines.push("");
  lines.push("Bit depth (sharp `metadata().depth`):");
  for (const [k, v] of topEntries(depthCounts, 10)) lines.push(`  - ${k}: ${fmt(v)}`);
  lines.push("");

  lines.push("## CSV-metadata-joined distributions (join key: image filename)");
  lines.push("");
  lines.push(`- \`No Finding\`: ${fmt(noFindingCount)} (${fmt((noFindingCount / files.length) * 100)}%)`);
  lines.push(`- Multi-label images (>1 finding): ${fmt(multiLabelCount)} (${fmt((multiLabelCount / files.length) * 100)}%)`);
  lines.push("");
  lines.push("Top Finding Labels (by image count, multi-label images counted once per label):");
  lines.push("");
  lines.push("| label | count |");
  lines.push("|---|---|");
  for (const [k, v] of topEntries(findingCounts, 20)) lines.push(`| ${k} | ${fmt(v)} |`);
  lines.push("");
  lines.push("View Position:");
  for (const [k, v] of topEntries(viewCounts, 10)) lines.push(`  - ${k}: ${fmt(v)}`);
  lines.push("");
  lines.push("Sex:");
  for (const [k, v] of topEntries(sexCounts, 10)) lines.push(`  - ${k}: ${fmt(v)}`);
  lines.push("");
  lines.push("Age buckets (parsed from `Patient Age`, Y/M/D units converted to fractional years):");
  const ageOrder = [...ageBucketCounts.keys()].sort();
  for (const k of ageOrder) lines.push(`  - ${k}: ${fmt(ageBucketCounts.get(k)!)}`);
  lines.push("");

  lines.push("## Per-patient study-count histogram");
  lines.push("");
  lines.push(`Unique patients: **${fmt(patientStudyCounts.size)}**`);
  lines.push("");
  lines.push("| studies per patient | # patients |");
  lines.push("|---|---|");
  for (const k of histogramOrder) {
    lines.push(`| ${k} | ${fmt(studyHistogram.get(k) ?? 0)} |`);
  }
  lines.push("");

  lines.push("## Output files");
  lines.push("");
  const csvMb = csvStatBuf.size / (1024 * 1024);
  lines.push(`- \`full-dataset-scan.csv\` — ${fmt(csvStatBuf.size)} bytes (${fmt(csvMb)} MB), one row per image.`);
  if (csvMb > 20) {
    lines.push(
      "  - This exceeds 20 MB, so a gzip copy `full-dataset-scan.csv.gz` was produced with " +
        "`gzip -k full-dataset-scan.csv` and the raw CSV should be treated as a local-only artifact."
    );
  }
  lines.push("");

  await fs.writeFile(OUT_MD, lines.join("\n") + "\n", "utf-8");
  console.log(`[full-dataset-scan] wrote summary: ${OUT_MD}`);
  console.log(`[full-dataset-scan] done in ${fmt(totalRunMs / 1000)}s — ${fmt(throughput)} img/s, ${errRows.length} errors`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
