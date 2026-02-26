import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { scanInputDirectory } from "../../../src/infrastructure/file-scanner.js";
import { FileScanError } from "../../../src/domain/errors.js";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "medical-test-"));

  // Create series_1 with images and context
  await fs.mkdir(path.join(tmpDir, "series_1"));
  await fs.writeFile(path.join(tmpDir, "series_1", "image_001.png"), "PNG");
  await fs.writeFile(path.join(tmpDir, "series_1", "image_002.jpg"), "JPG");
  await fs.writeFile(path.join(tmpDir, "series_1", "ignored.dicom"), "DICOM");
  await fs.writeFile(path.join(tmpDir, "series_1", "context.txt"), "Patient notes");

  // Create series_2 with only images (no context)
  await fs.mkdir(path.join(tmpDir, "series_2"));
  await fs.writeFile(path.join(tmpDir, "series_2", "scan.JPEG"), "JPEG");

  // Create an empty series
  await fs.mkdir(path.join(tmpDir, "series_empty"));

  // Create a file (not a directory) at root — should be ignored
  await fs.writeFile(path.join(tmpDir, "root-file.txt"), "root context");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe("scanInputDirectory", () => {
  it("discovers all series sub-folders", async () => {
    const results = await scanInputDirectory(tmpDir);
    const seriesIds = results.map((s) => s.seriesId).sort();
    expect(seriesIds).toContain("series_1");
    expect(seriesIds).toContain("series_2");
  });

  it("excludes empty series folders", async () => {
    const results = await scanInputDirectory(tmpDir);
    const seriesIds = results.map((s) => s.seriesId);
    expect(seriesIds).not.toContain("series_empty");
  });

  it("collects only supported image extensions (png, jpg, jpeg — case-insensitive)", async () => {
    const results = await scanInputDirectory(tmpDir);
    const series1 = results.find((s) => s.seriesId === "series_1")!;
    expect(series1).toBeDefined();
    expect(series1.imagePaths).toHaveLength(2);
    const basenames = series1.imagePaths.map((p) => path.basename(p));
    expect(basenames).toContain("image_001.png");
    expect(basenames).toContain("image_002.jpg");
    expect(basenames).not.toContain("ignored.dicom");
  });

  it("detects .txt context file in series folder", async () => {
    const results = await scanInputDirectory(tmpDir);
    const series1 = results.find((s) => s.seriesId === "series_1")!;
    expect(series1.textContextPath).toBeDefined();
    expect(series1.textContextPath).toMatch(/context\.txt$/);
  });

  it("sets textContextPath to undefined when no .txt file exists", async () => {
    const results = await scanInputDirectory(tmpDir);
    const series2 = results.find((s) => s.seriesId === "series_2")!;
    expect(series2.textContextPath).toBeUndefined();
  });

  it("handles case-insensitive image extensions (.JPEG)", async () => {
    const results = await scanInputDirectory(tmpDir);
    const series2 = results.find((s) => s.seriesId === "series_2")!;
    expect(series2.imagePaths).toHaveLength(1);
    expect(path.basename(series2.imagePaths[0]!)).toBe("scan.JPEG");
  });

  it("throws FileScanError when input directory does not exist", async () => {
    await expect(scanInputDirectory("/nonexistent/path/xyz")).rejects.toThrow(FileScanError);
  });

  it("filters series by name when filterSeries is provided", async () => {
    const results = await scanInputDirectory(tmpDir, ["series_1"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.seriesId).toBe("series_1");
  });

  it("rejects when input directory does not exist (ENOENT)", async () => {
    await expect(scanInputDirectory("/tmp/does-not-exist-xyz123")).rejects.toThrow(FileScanError);
  });

  it("returns image paths as absolute paths", async () => {
    const results = await scanInputDirectory(tmpDir);
    for (const series of results) {
      for (const imgPath of series.imagePaths) {
        expect(path.isAbsolute(imgPath)).toBe(true);
      }
    }
  });

  it("throws FileScanError when a series sub-directory cannot be read", async () => {
    const lockedDir = await fs.mkdtemp(path.join(os.tmpdir(), "locked-series-"));
    const seriesDir = path.join(lockedDir, "locked_series");
    await fs.mkdir(seriesDir);
    // Write a dummy image so the series would normally be discovered
    // but make the directory unreadable before scanning
    try {
      execSync(`chmod 000 "${seriesDir}"`);
      await expect(scanInputDirectory(lockedDir)).rejects.toThrow(FileScanError);
    } finally {
      execSync(`chmod 755 "${seriesDir}"`);
      await fs.rm(lockedDir, { recursive: true, force: true });
    }
  });
});
