/**
 * E — Scanner stress test
 * =========================
 *
 * Exercises the real `scanInputDirectory` (src/infrastructure/file-scanner.ts)
 * against two synthetic-but-real input trees built from the NIH ChestX-ray14
 * 224-px archive, to check discovery correctness and ordering at scale. Files
 * are hard-linked (not copied) from the extracted archive, so this uses no
 * extra disk space and stays fast even with tens of thousands of entries.
 *
 * Tree A: the 500 patients with the most studies in Data_Entry_2017.csv, one
 *         series folder per study (image), each series holding exactly 1 image.
 * Tree B: a single series folder holding 5,000 images.
 *
 * This does NOT run any LLM stage — it only calls the deterministic file
 * scanner.
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime2026/scanner-stress.ts \
 *     [--images-dir <dir>] [--csv <path>]
 *
 * The images directory and metadata CSV are resolved in this order:
 *   1. --images-dir / --csv flags
 *   2. NIH_IMAGES_DIR / NIH_CSV environment variables
 *   3. repo-relative default: ../nih-cxr14/images-224/images-224 and
 *      ../nih-cxr14/Data_Entry_2017.csv, both siblings of this repo's root
 *      (the layout prepare-nih.py writes to by default — see
 *      experiments/sime2026/README.md §2).
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { scanInputDirectory } from "../../src/infrastructure/file-scanner.js";

function getFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const IMAGES_DIR =
  getFlag(argv, "--images-dir") ??
  process.env.NIH_IMAGES_DIR ??
  path.resolve(REPO_ROOT, "..", "nih-cxr14", "images-224", "images-224");
const CSV_METADATA_PATH =
  getFlag(argv, "--csv") ??
  process.env.NIH_CSV ??
  path.resolve(REPO_ROOT, "..", "nih-cxr14", "Data_Entry_2017.csv");
const TOP_N_PATIENTS = 500;
const SINGLE_SERIES_IMAGE_COUNT = 5000;

// ─── Minimal CSV parse (duplicated from full-dataset-scan.ts on purpose — this
// script is meant to be runnable standalone) ───────────────────────────────

interface MetaRow {
  patientId: string;
}

function parseMetadataCsv(text: string): Map<string, MetaRow> {
  const lines = text.split("\n");
  const map = new Map<string, MetaRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    const image = cols[0]!;
    map.set(image, { patientId: cols[3] ?? "" });
  }
  return map;
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function buildTreeA(
  tmpRoot: string,
  imagesByPatient: Map<string, string[]>
): Promise<{
  dir: string;
  expectedSeriesCount: number;
  expectedImageCount: number;
}> {
  const dir = path.join(tmpRoot, "tree-a-top500-patients");
  await fs.mkdir(dir, { recursive: true });

  // Rank patients by study count, descending; break ties by patientId for determinism.
  const ranked = [...imagesByPatient.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });
  const top500 = ranked.slice(0, TOP_N_PATIENTS);

  let expectedImageCount = 0;
  for (const [, images] of top500) {
    for (const image of images) {
      // One series folder per study/image, named after the image (sans extension).
      const seriesId = image.replace(/\.png$/, "");
      const seriesDir = path.join(dir, seriesId);
      await fs.mkdir(seriesDir, { recursive: true });
      const src = path.join(IMAGES_DIR, image);
      const dst = path.join(seriesDir, image);
      await fs.link(src, dst);
      expectedImageCount++;
    }
  }

  return { dir, expectedSeriesCount: expectedImageCount, expectedImageCount };
}

async function buildTreeB(
  tmpRoot: string,
  allImages: string[]
): Promise<{
  dir: string;
  seriesId: string;
  expectedImages: string[];
}> {
  const dir = path.join(tmpRoot, "tree-b-single-series-5000");
  const seriesId = "series-5000";
  const seriesDir = path.join(dir, seriesId);
  await fs.mkdir(seriesDir, { recursive: true });

  const chosen = allImages.slice(0, SINGLE_SERIES_IMAGE_COUNT);
  for (const image of chosen) {
    await fs.link(path.join(IMAGES_DIR, image), path.join(seriesDir, image));
  }

  return { dir, seriesId, expectedImages: [...chosen].sort() };
}

function isSorted(arr: string[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1]! > arr[i]!) return false;
  }
  return true;
}

function failMissingPath(what: string, flag: string, envVar: string, attempted: string): never {
  console.error(
    `[scanner-stress] ${what} not found: ${attempted}\n` +
      `  Set it with ${flag} <path>, the ${envVar} environment variable, or prepare the NIH ` +
      "dataset with experiments/sime2026/prepare-nih.py first (see experiments/sime2026/README.md §2)."
  );
  process.exit(1);
}

async function main() {
  const report: string[] = [];
  const log = (s: string) => {
    console.log(s);
    report.push(s);
  };

  log("[scanner-stress] reading metadata CSV...");
  let csvText: string;
  try {
    csvText = await fs.readFile(CSV_METADATA_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      failMissingPath("metadata CSV", "--csv", "NIH_CSV", CSV_METADATA_PATH);
    }
    throw err;
  }
  const meta = parseMetadataCsv(csvText);

  let allImages: string[];
  try {
    allImages = (await fs.readdir(IMAGES_DIR)).filter((f) => f.endsWith(".png")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      failMissingPath("images directory", "--images-dir", "NIH_IMAGES_DIR", IMAGES_DIR);
    }
    throw err;
  }
  log(`[scanner-stress] ${allImages.length} images available in archive`);

  const imagesByPatient = new Map<string, string[]>();
  for (const image of allImages) {
    const patientId = meta.get(image)?.patientId;
    if (!patientId) continue;
    const arr = imagesByPatient.get(patientId) ?? [];
    arr.push(image);
    imagesByPatient.set(patientId, arr);
  }
  log(`[scanner-stress] ${imagesByPatient.size} unique patients in metadata`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-stress-"));
  log(`[scanner-stress] temp root: ${tmpRoot}`);

  try {
    // ─── Tree A ───────────────────────────────────────────────────────────
    log("");
    log(`=== Tree A: top ${TOP_N_PATIENTS} patients by study count, 1 series per study ===`);
    const buildAStart = performance.now();
    const treeA = await buildTreeA(tmpRoot, imagesByPatient);
    const buildAMs = performance.now() - buildAStart;
    log(
      `  built ${treeA.expectedSeriesCount} series (hardlinks) in ${(buildAMs / 1000).toFixed(2)}s`
    );

    const scanAStart = performance.now();
    const seriesA = await scanInputDirectory(treeA.dir);
    const scanAMs = performance.now() - scanAStart;

    const totalImagesA = seriesA.reduce((n, s) => n + s.imagePaths.length, 0);
    const allSingleImage = seriesA.every((s) => s.imagePaths.length === 1);
    const orderOkA = seriesA.every((s) => isSorted(s.imagePaths));

    log(`  scanInputDirectory: ${(scanAMs / 1000).toFixed(3)}s`);
    log(`  series discovered: ${seriesA.length} (expected ${treeA.expectedSeriesCount})`);
    log(`  images discovered: ${totalImagesA} (expected ${treeA.expectedImageCount})`);
    log(`  every series has exactly 1 image: ${allSingleImage}`);
    log(`  imagePaths sorted within every series: ${orderOkA}`);
    const okA =
      seriesA.length === treeA.expectedSeriesCount &&
      totalImagesA === treeA.expectedImageCount &&
      allSingleImage &&
      orderOkA;
    log(`  RESULT: ${okA ? "PASS" : "FAIL"}`);

    // ─── Tree B ───────────────────────────────────────────────────────────
    log("");
    log(`=== Tree B: 1 series x ${SINGLE_SERIES_IMAGE_COUNT} images ===`);
    const buildBStart = performance.now();
    const treeB = await buildTreeB(tmpRoot, allImages);
    const buildBMs = performance.now() - buildBStart;
    log(
      `  built 1 series with ${treeB.expectedImages.length} hardlinks in ${(buildBMs / 1000).toFixed(2)}s`
    );

    const scanBStart = performance.now();
    const seriesB = await scanInputDirectory(treeB.dir);
    const scanBMs = performance.now() - scanBStart;

    log(`  scanInputDirectory: ${(scanBMs / 1000).toFixed(3)}s`);
    log(`  series discovered: ${seriesB.length} (expected 1)`);
    const single = seriesB[0];
    const imageCountB = single?.imagePaths.length ?? 0;
    log(`  images in series: ${imageCountB} (expected ${treeB.expectedImages.length})`);
    log(`  seriesId matches: ${single?.seriesId === treeB.seriesId}`);

    const basenamesB = (single?.imagePaths ?? []).map((p) => path.basename(p));
    const orderOkB = isSorted(basenamesB);
    const namesMatchB =
      basenamesB.length === treeB.expectedImages.length &&
      basenamesB.every((n, i) => n === treeB.expectedImages[i]);
    log(`  imagePaths sorted (ascending basename): ${orderOkB}`);
    log(`  discovered set matches expected set (order-sensitive): ${namesMatchB}`);
    const okB =
      seriesB.length === 1 &&
      imageCountB === treeB.expectedImages.length &&
      orderOkB &&
      namesMatchB;
    log(`  RESULT: ${okB ? "PASS" : "FAIL"}`);

    // ─── Overall ────────────────────────────────────────────────────────
    log("");
    log(
      `=== Overall: ${okA && okB ? "PASS" : "FAIL"} — no errors thrown, no LLM stages invoked ===`
    );
  } catch (err) {
    log(`[scanner-stress] ERROR: ${(err as Error).stack ?? (err as Error).message}`);
    throw err;
  } finally {
    log(`[scanner-stress] cleaning up temp root: ${tmpRoot}`);
    await rmrf(tmpRoot);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
