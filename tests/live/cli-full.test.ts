/**
 * LIVE end-to-end test — spawns the real CLI against the real Gemini API.
 *
 * Opt-in: only runs via `npm run test:live`. The default `npm test` excludes
 * tests/live/ via jest.config.js `testPathIgnorePatterns`.
 *
 * Requirements:
 *   - GOOGLE_API_KEY (or GEMINI_API_KEY) exported in the environment
 *   - Optional: GEMINI_MODEL (defaults to gemini-2.5-pro)
 *   - tsx available in node_modules/.bin (declared in package.json)
 *   - Network connectivity to generativelanguage.googleapis.com
 *
 * What it does:
 *   1. Creates a real synthetic 64x64 PNG in a tmp series folder
 *   2. Spawns `tsx src/main/index.ts analyze <tmpIn> <tmpOut> --verbose --concurrency 1`
 *   3. Asserts exit 0, disclaimer in every output, fairness probe passes
 *
 * Cost: one Gemini-2.5-pro image-analysis call + one series-synthesis call +
 * one evolution call (3 API calls total, single-series path).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import sharp from "sharp";

import {
  containsDemographicClaim,
} from "../../src/domain/fairness.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const API_KEY = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
const MAYBE = API_KEY ? describe : describe.skip;

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const tsx = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
    const entry = path.join(PROJECT_ROOT, "src", "main", "index.ts");
    // gemini-2.5-pro has 0 free-tier quota for new keys; default to flash so
    // the live suite passes on free-tier accounts. Caller-supplied GEMINI_MODEL
    // wins.
    const childEnv = {
      ...process.env,
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    };
    const child = spawn(tsx, [entry, ...args], {
      cwd: PROJECT_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function makeRealPng(filePath: string): Promise<void> {
  // 64x64 white PNG — real bytes so sharp's preprocessing succeeds in the CLI.
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toFile(filePath);
}

async function* walk(root: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

// ─── Suite ──────────────────────────────────────────────────────────────────

MAYBE("LIVE — real Gemini CLI invocation", () => {
  let tmpIn: string;
  let tmpOut: string;
  let cli: SpawnResult;

  beforeAll(async () => {
    tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "live-in-"));
    tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "live-out-"));
    const seriesDir = path.join(tmpIn, "series_1");
    await fs.mkdir(seriesDir);
    await makeRealPng(path.join(seriesDir, "test_image.png"));
    await fs.writeFile(
      path.join(seriesDir, "context.txt"),
      "Synthetic blank reference image for the integration smoke test. " +
        "No patient data. Expect the model to comment that no abnormalities are visible."
    );

    // 4 minutes is comfortable for one image + synthesis + evolution on gemini-2.5-pro
    cli = await runCli(["analyze", tmpIn, tmpOut, "--verbose", "--concurrency", "1"], 240_000);
  }, 300_000);

  afterAll(async () => {
    await fs.rm(tmpIn, { recursive: true, force: true });
    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("exits with code 0 (or 4 if Gemini returned a partial failure)", () => {
    // Accept 4 too: per the CLI contract, code 4 means "batch completed, some
    // images failed". That's not a test failure — that's the project's
    // documented graceful-degradation contract. We just don't want crashes (99)
    // or user/system errors (1, 2, 3).
    expect([0, 4]).toContain(cli.code);
    if (cli.code !== 0) {
      // Surface details so the run log is debuggable
      process.stderr.write(
        `LIVE CLI exited ${cli.code}.\nSTDOUT:\n${cli.stdout}\nSTDERR:\n${cli.stderr}\n`
      );
    }
  });

  it("produces a per-image JSON with non-empty disclaimer", async () => {
    const jsonPath = path.join(tmpOut, "series_1", "test_image_analysis.json");
    await fs.access(jsonPath);
    const parsed = JSON.parse(await fs.readFile(jsonPath, "utf-8")) as {
      disclaimer?: string;
      status?: string;
      rawResponse?: string;
    };
    expect(parsed.disclaimer && parsed.disclaimer.length > 0).toBe(true);
    // The status may be 'success' or 'error' (network blip / safety filter).
    // Either way, the disclaimer must be present — that is the output contract.
    expect(["success", "error"]).toContain(parsed.status);
  });

  it("produces a series_summary.md containing the educational disclaimer", async () => {
    const md = path.join(tmpOut, "series_1", "series_summary.md");
    await fs.access(md);
    const text = await fs.readFile(md, "utf-8");
    expect(text.toLowerCase()).toContain("educational");
  });

  it("produces a combined_diagnostic_report.md containing the educational disclaimer", async () => {
    const md = path.join(tmpOut, "combined_diagnostic_report.md");
    await fs.access(md);
    const text = await fs.readFile(md, "utf-8");
    expect(text.toLowerCase()).toContain("educational");
  });

  it("every output file (JSON + Markdown) carries the educational disclaimer", async () => {
    let jsonCount = 0;
    let mdCount = 0;
    for await (const file of walk(tmpOut)) {
      if (file.endsWith(".json")) {
        jsonCount++;
        const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as {
          disclaimer?: string;
        };
        expect(parsed.disclaimer?.length).toBeGreaterThan(0);
      } else if (file.endsWith(".md")) {
        mdCount++;
        const text = await fs.readFile(file, "utf-8");
        expect(text.toLowerCase()).toContain("educational");
      }
    }
    expect(jsonCount).toBeGreaterThan(0);
    expect(mdCount).toBeGreaterThan(0);
  });

  it("fairness probe finds no demographic-anchored claims in any structured output", async () => {
    // We didn't supply any demographic context, so this is a clean-path
    // regression: the model should not invent demographic justifications.
    for await (const file of walk(tmpOut)) {
      if (!file.endsWith(".json")) continue;
      const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as {
        summary?: string;
        findings?: string[];
        report?: string;
        primaryDiagnosis?: string;
        combinedReport?: string;
      };
      for (const field of [
        parsed.summary,
        parsed.report,
        parsed.primaryDiagnosis,
        parsed.combinedReport,
      ]) {
        if (field) expect(containsDemographicClaim(field)).toBe(false);
      }
      for (const f of parsed.findings ?? []) {
        expect(containsDemographicClaim(f)).toBe(false);
      }
    }
  });
});

if (!API_KEY) {
  describe("LIVE — skipped (no API key)", () => {
    it("requires GOOGLE_API_KEY (or GEMINI_API_KEY) in the environment", () => {
      console.warn(
        "[live] Skipped: export GOOGLE_API_KEY=... and run `npm run test:live` to enable."
      );
      expect(true).toBe(true);
    });
  });
}
