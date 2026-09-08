/**
 * Input validation at the untrusted boundary (EU AI Act Art. 15 robustness;
 * HIPAA §164.514(b) de-identification; THREAT_MODEL T6).
 *
 * Three refusals, all before anything is uploaded:
 *   - DICOM, by extension *and* by magic bytes, because a DICOM file carries
 *     PHI in its tags and this tool cannot strip it;
 *   - a single image over `MAX_IMAGE_BYTES`;
 *   - a run over `MAX_IMAGES_PER_RUN`.
 *
 * Every refusal must be a `FileScanError` (exit code 2) with a message that
 * says what to do next — a limit the user cannot act on is just a crash.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import {
  DEFAULT_MAX_IMAGES_PER_RUN,
  DEFAULT_MAX_IMAGE_BYTES,
  DICOM_EXTENSIONS,
  envLimit,
  hasDicomMagic,
  inspectImageFile,
  scanInputDirectory,
} from "../../../src/infrastructure/file-scanner.js";
import { FileScanError } from "../../../src/domain/errors.js";

let tmp: string;

/** A DICOM Part-10 header: 128 zero bytes of preamble, then `DICM`. */
function dicomBytes(): Buffer {
  return Buffer.concat([Buffer.alloc(128, 0), Buffer.from("DICM", "latin1"), Buffer.alloc(64, 7)]);
}

async function series(name: string, files: Record<string, string | Buffer>): Promise<void> {
  await fs.mkdir(path.join(tmp, name), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(tmp, name, file), content);
  }
}

const ENV_KEYS = ["MAX_IMAGES_PER_RUN", "MAX_IMAGE_BYTES"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-limits-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("envLimit", () => {
  it("returns the fallback when the variable is unset or blank", () => {
    expect(envLimit("X", 7, {})).toBe(7);
    expect(envLimit("X", 7, { X: "" })).toBe(7);
    expect(envLimit("X", 7, { X: "   " })).toBe(7);
  });

  it("reads a positive integer", () => {
    expect(envLimit("X", 7, { X: "42" })).toBe(42);
  });

  it("ignores anything that is not a positive integer, rather than failing the run", () => {
    expect(envLimit("X", 7, { X: "abc" })).toBe(7);
    expect(envLimit("X", 7, { X: "-1" })).toBe(7);
    expect(envLimit("X", 7, { X: "0" })).toBe(7);
    expect(envLimit("X", 7, { X: "1.5" })).toBe(7);
    expect(envLimit("X", 7, { X: "Infinity" })).toBe(7);
  });

  it("defaults to process.env when no environment is injected", () => {
    process.env.MAX_IMAGES_PER_RUN = "11";
    expect(envLimit("MAX_IMAGES_PER_RUN", 500)).toBe(11);
  });
});

describe("hasDicomMagic", () => {
  it("recognises a DICOM Part-10 preamble", () => {
    expect(hasDicomMagic(dicomBytes())).toBe(true);
  });

  it("rejects a buffer too short to hold a preamble", () => {
    expect(hasDicomMagic(Buffer.from("PNG"))).toBe(false);
    expect(hasDicomMagic(Buffer.alloc(131))).toBe(false);
  });

  it("rejects a long buffer without the magic at offset 128", () => {
    expect(hasDicomMagic(Buffer.alloc(400, 9))).toBe(false);
  });
});

describe("inspectImageFile", () => {
  it("accepts an ordinary small image", async () => {
    const file = path.join(tmp, "ok.png");
    await fs.writeFile(file, "PNGDATA");
    await expect(inspectImageFile(file, DEFAULT_MAX_IMAGE_BYTES)).resolves.toBeUndefined();
  });

  it("reports an unreadable file as a FileScanError rather than a raw errno", async () => {
    await expect(inspectImageFile(path.join(tmp, "nope.png"), 100)).rejects.toThrow(FileScanError);
    await expect(inspectImageFile(path.join(tmp, "nope.png"), 100)).rejects.toThrow(
      /Cannot read image/
    );
  });

  it("refuses a file over the byte limit and names the limit and the actual size", async () => {
    const file = path.join(tmp, "big.png");
    await fs.writeFile(file, Buffer.alloc(2048, 1));
    await expect(inspectImageFile(file, 1024)).rejects.toThrow(
      /exceeds MAX_IMAGE_BYTES: .*2048 bytes, limit is 1024 bytes/
    );
  });

  it("accepts a file exactly at the byte limit", async () => {
    const file = path.join(tmp, "exact.png");
    await fs.writeFile(file, Buffer.alloc(1024, 1));
    await expect(inspectImageFile(file, 1024)).resolves.toBeUndefined();
  });
});

describe("scanInputDirectory — DICOM refusal", () => {
  it("lists .dcm and .dicom as refused extensions", () => {
    expect([...DICOM_EXTENSIONS].sort()).toEqual([".dcm", ".dicom"]);
  });

  it.each([".dcm", ".dicom", ".DCM"])("refuses a %s file outright", async (ext) => {
    await series("series_1", { "a.png": "PNG", [`study${ext}`]: dicomBytes() });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(FileScanError);
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/Refusing DICOM file/);
  });

  it("explains why, and names DICOM ingestion as future work", async () => {
    await series("series_1", { "a.png": "PNG", "study.dcm": dicomBytes() });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/de-identifying it/);
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/tracked as future work/);
  });

  it("refuses a DICOM file disguised with an image extension (magic-byte check)", async () => {
    await series("series_1", { "not-really.png": dicomBytes() });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(
      /has a DICOM preamble despite its image extension/
    );
  });

  it("still accepts a genuine image that merely happens to be long", async () => {
    await series("series_1", { "a.png": Buffer.alloc(400, 3) });
    const found = await scanInputDirectory(tmp);
    expect(found[0]!.imagePaths).toHaveLength(1);
  });
});

describe("scanInputDirectory — traversal guard", () => {
  it("refuses the filesystem root, where no child can be proven to be inside the input dir", async () => {
    // `/` + separator is `//`, which nothing under it starts with — so the
    // containment check that protects every other input directory cannot be
    // satisfied here, and the scan refuses rather than walking the whole disk.
    await expect(scanInputDirectory(path.sep)).rejects.toThrow(FileScanError);
    await expect(scanInputDirectory(path.sep)).rejects.toThrow(/Path traversal detected/);
  });
});

describe("scanInputDirectory — size and count limits", () => {
  it("exposes the documented defaults", () => {
    expect(DEFAULT_MAX_IMAGES_PER_RUN).toBe(500);
    expect(DEFAULT_MAX_IMAGE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("refuses a run whose image is over MAX_IMAGE_BYTES", async () => {
    process.env.MAX_IMAGE_BYTES = "16";
    await series("series_1", { "big.png": Buffer.alloc(64, 1) });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/exceeds MAX_IMAGE_BYTES/);
  });

  it("refuses a run over MAX_IMAGES_PER_RUN and suggests how to proceed", async () => {
    process.env.MAX_IMAGES_PER_RUN = "2";
    await series("series_1", { "a.png": "P", "b.png": "P", "c.png": "P" });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(
      /Run exceeds MAX_IMAGES_PER_RUN: 3 images found, limit is 2/
    );
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/--series/);
  });

  it("counts the limit across series, not per series", async () => {
    process.env.MAX_IMAGES_PER_RUN = "3";
    await series("series_1", { "a.png": "P", "b.png": "P" });
    await series("series_2", { "c.png": "P", "d.png": "P" });
    await expect(scanInputDirectory(tmp)).rejects.toThrow(/4 images found, limit is 3/);
  });

  it("accepts a run exactly at the image-count limit", async () => {
    process.env.MAX_IMAGES_PER_RUN = "2";
    await series("series_1", { "a.png": "P", "b.png": "P" });
    const found = await scanInputDirectory(tmp);
    expect(found[0]!.imagePaths).toHaveLength(2);
  });

  it("lets --series bring an over-limit study back under the cap", async () => {
    process.env.MAX_IMAGES_PER_RUN = "2";
    await series("series_1", { "a.png": "P", "b.png": "P" });
    await series("series_2", { "c.png": "P", "d.png": "P" });

    const found = await scanInputDirectory(tmp, ["series_1"]);
    expect(found.map((s) => s.seriesId)).toEqual(["series_1"]);
  });
});
