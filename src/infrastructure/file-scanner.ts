import * as fs from "fs/promises";
import * as path from "path";
import { SeriesInfo, SUPPORTED_IMAGE_EXTENSIONS } from "../domain/types.js";
import { FileScanError } from "../domain/errors.js";

/**
 * Scan an input directory and discover all series sub-folders with their images.
 * A series folder is a direct child directory of inputDir that contains at least one image.
 */
export async function scanInputDirectory(
  inputDir: string,
  filterSeries?: string[]
): Promise<SeriesInfo[]> {
  const resolvedInput = path.resolve(inputDir);

  // Reject path traversal: input dir must exist as a real directory
  let entries;
  try {
    entries = await fs.readdir(resolvedInput, { withFileTypes: true });
  } catch {
    throw new FileScanError(
      `Input directory not found or not readable: ${inputDir}`
    );
  }

  // Safety: reject if resolvedInput looks like it escaped via traversal
  // (e.g., symlink resolution to parent directories outside expected scope)
  const normalizedInput = path.normalize(resolvedInput);
  if (normalizedInput !== resolvedInput && !resolvedInput.startsWith(path.sep)) {
    throw new FileScanError(`Path traversal detected: ${inputDir}`);
  }

  const series: SeriesInfo[] = [];

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

    series.push({
      seriesId,
      imagePaths,
      textContextPath: txtPaths[0], // First .txt file alphabetically
    });
  }

  return series;
}
