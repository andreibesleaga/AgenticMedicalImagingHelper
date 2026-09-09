import * as fs from "fs/promises";
import * as path from "path";
import { SeriesInfo, SUPPORTED_IMAGE_EXTENSIONS } from "../domain/types.js";
import { FileScanError } from "../domain/errors.js";

/**
 * Hard ceiling on images accepted in one run (`MAX_IMAGES_PER_RUN`).
 *
 * AI Act Art. 15 asks for resilience against input that pushes the system out
 * of its tested envelope; THREAT_MODEL T6 named an unbounded batch as the
 * open half of the DoS risk. A bounded run also bounds spend — 500 images is
 * already a four-figure token bill on a large model.
 */
export const DEFAULT_MAX_IMAGES_PER_RUN = 500;

/** Hard ceiling on a single image file (`MAX_IMAGE_BYTES`), 50 MB. */
export const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** Extensions refused outright: this tool does not ingest DICOM. */
export const DICOM_EXTENSIONS = new Set([".dcm", ".dicom"]);

/** A DICOM Part-10 file carries the magic `DICM` after a 128-byte preamble. */
const DICOM_PREAMBLE_BYTES = 128;
const DICOM_MAGIC = "DICM";
const DICOM_HEAD_BYTES = DICOM_PREAMBLE_BYTES + DICOM_MAGIC.length;

/**
 * Why DICOM is refused rather than converted: a DICOM file carries PHI in its
 * tags (PatientName, PatientID, StudyDate, InstitutionName, and often burned-in
 * annotations in the pixel data). Silently converting it would strip neither,
 * and would turn "the operator de-identifies" into "the tool appeared to".
 * Refusing keeps the HIPAA §164.514(b) obligation where it belongs and visible.
 */
const DICOM_GUIDANCE =
  "DICOM input is not supported. Convert to PNG/JPEG *after* de-identifying it " +
  "(tag-level PHI and any burned-in annotations) — this tool cannot do that for you. " +
  "DICOM ingestion with tag-level PHI stripping is tracked as future work.";

/** Read a non-negative integer limit from the environment, falling back on anything unusable. */
export function envLimit(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** True when `head` starts with a DICOM Part-10 preamble + `DICM` magic. */
export function hasDicomMagic(head: Uint8Array): boolean {
  if (head.length < DICOM_HEAD_BYTES) return false;
  return (
    Buffer.from(head.subarray(DICOM_PREAMBLE_BYTES, DICOM_HEAD_BYTES)).toString("latin1") ===
    DICOM_MAGIC
  );
}

/**
 * Size and content pre-flight for one candidate image.
 *
 * Both checks happen before anything is uploaded, and both are refusals rather
 * than warnings: an oversized file is a cost and memory hazard, and a file that
 * is really DICOM is a PHI hazard whatever its extension claims.
 *
 * Exported so the refusal paths can be tested directly, including the
 * unreadable-file case that a directory walk cannot produce on demand.
 */
export async function inspectImageFile(filePath: string, maxBytes: number): Promise<void> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (err) {
    throw new FileScanError(`Cannot read image ${filePath}: ${(err as Error).message}`);
  }
  try {
    const stat = await handle.stat();
    if (stat.size > maxBytes) {
      throw new FileScanError(
        `Image exceeds MAX_IMAGE_BYTES: ${filePath} is ${stat.size} bytes, limit is ${maxBytes} bytes. ` +
          "Downscale the file, or raise MAX_IMAGE_BYTES if you accept the cost and memory impact."
      );
    }
    const head = Buffer.alloc(DICOM_HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, DICOM_HEAD_BYTES, 0);
    if (hasDicomMagic(head.subarray(0, bytesRead))) {
      throw new FileScanError(
        `${filePath} has a DICOM preamble despite its image extension — refusing to send it. ${DICOM_GUIDANCE}`
      );
    }
  } finally {
    await handle.close();
  }
}

/**
 * Scan an input directory and discover all series sub-folders with their images.
 * A series folder is a direct child directory of inputDir that contains at least one image.
 *
 * Rejections (all before any network call): path traversal, DICOM input by
 * extension or by magic bytes, a single image over `MAX_IMAGE_BYTES`, and a run
 * over `MAX_IMAGES_PER_RUN` images in total. Each throws {@link FileScanError},
 * which the CLI maps to exit code 2.
 */
export async function scanInputDirectory(
  inputDir: string,
  filterSeries?: string[]
): Promise<SeriesInfo[]> {
  const resolvedInput = path.resolve(inputDir);
  const maxImages = envLimit("MAX_IMAGES_PER_RUN", DEFAULT_MAX_IMAGES_PER_RUN);
  const maxImageBytes = envLimit("MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES);

  // Reject path traversal: input dir must exist as a real directory
  let entries;
  try {
    entries = await fs.readdir(resolvedInput, { withFileTypes: true });
  } catch {
    throw new FileScanError(`Input directory not found or not readable: ${inputDir}`);
  }

  // Series order is a *documented product decision*, not an accident: PRD §12 Q3
  // resolves temporal ordering as "alphabetical by series folder name" (users
  // encode dates in the folder name), and the evolution prompt tells the model
  // the sessions are "ordered chronologically by series name". `fs.readdir`
  // guarantees no order at all — POSIX leaves it unspecified and ext4's hashed
  // directory index returns neither creation nor lexicographic order — so
  // without this sort the same input could yield a different session order on a
  // different filesystem, silently inverting a progression verdict. Sorted by
  // code unit, matching the `imagePaths.sort()` / `txtPaths.sort()` below.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Safety: reject if resolvedInput looks like it escaped via traversal
  // (e.g., symlink resolution to parent directories outside expected scope)
  const normalizedInput = path.normalize(resolvedInput);
  if (normalizedInput !== resolvedInput && !resolvedInput.startsWith(path.sep)) {
    throw new FileScanError(`Path traversal detected: ${inputDir}`);
  }

  const series: SeriesInfo[] = [];
  let totalImages = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const seriesId = entry.name;

    // Apply series filter if provided
    if (filterSeries && filterSeries.length > 0 && !filterSeries.includes(seriesId)) {
      continue;
    }

    const seriesDir = path.join(resolvedInput, seriesId);

    // Validate the series dir is within inputDir (path traversal protection)
    if (!seriesDir.startsWith(resolvedInput + path.sep)) {
      throw new FileScanError(`Path traversal detected: ${seriesDir}`);
    }

    let seriesEntries;
    try {
      seriesEntries = await fs.readdir(seriesDir, { withFileTypes: true });
    } catch (err) {
      throw new FileScanError(
        `Cannot read series directory ${seriesDir}: ${(err as Error).message}`
      );
    }

    const imagePaths: string[] = [];
    const txtPaths: string[] = [];

    for (const file of seriesEntries) {
      if (!file.isFile()) continue;

      const filePath = path.join(seriesDir, file.name);
      const ext = path.extname(file.name).toLowerCase();

      if (DICOM_EXTENSIONS.has(ext)) {
        throw new FileScanError(`Refusing DICOM file ${filePath}. ${DICOM_GUIDANCE}`);
      }

      if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        imagePaths.push(filePath);
      } else if (ext === ".txt") {
        txtPaths.push(filePath);
      }
    }

    // Skip empty series (no images)
    if (imagePaths.length === 0) continue;

    // Sort image paths for deterministic ordering
    imagePaths.sort();
    txtPaths.sort();

    // Pre-flight every accepted image before the run is admitted, so a bad file
    // in the last series fails the run before the first one is uploaded.
    for (const imagePath of imagePaths) {
      await inspectImageFile(imagePath, maxImageBytes);
    }

    totalImages += imagePaths.length;
    if (totalImages > maxImages) {
      throw new FileScanError(
        `Run exceeds MAX_IMAGES_PER_RUN: ${totalImages} images found, limit is ${maxImages}. ` +
          "Split the study across runs, use --series to select a subset, or raise MAX_IMAGES_PER_RUN."
      );
    }

    series.push({
      seriesId,
      imagePaths,
      textContextPath: txtPaths[0], // First .txt file alphabetically
    });
  }

  return series;
}
