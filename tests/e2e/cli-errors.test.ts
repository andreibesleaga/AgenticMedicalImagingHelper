/**
 * E2E CLI-level error tests — Scenarios 5 and 6 from tests/e2e/scenarios.md.
 *
 * These cover the failure paths that exit before the Gemini client is built,
 * so no API mocking is needed. We call runAnalyze directly (extracted from the
 * commander wiring) and capture its stdio + return code.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import { runAnalyze } from "../../src/main/run-analyze.js";

interface StdioCapture {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureStdio(): StdioCapture {
  const cap: StdioCapture = {
    stdout: "",
    stderr: "",
    restore: () => undefined,
  };
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => {
    cap.stdout += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((chunk: any) => {
    cap.stderr += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;

  cap.restore = () => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  };

  return cap;
}

describe("E2E — CLI error paths", () => {
  const origGoogleKey = process.env.GOOGLE_API_KEY;
  const origGeminiKey = process.env.GEMINI_API_KEY;
  let cap: StdioCapture;

  beforeEach(() => {
    cap = captureStdio();
  });

  afterEach(() => {
    cap.restore();
    if (origGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = origGoogleKey;
    if (origGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origGeminiKey;
  });

  // ── Scenario 5: missing API key → exit 1 ─────────────────────────────
  describe("Scenario 5 — Missing API Key", () => {
    it("returns exit code 1 and writes a clear error to stderr", async () => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-noapi-in-"));
      const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-noapi-out-"));
      try {
        const code = await runAnalyze(tmpIn, tmpOut, {
          concurrency: "5",
          verbose: false,
        });
        expect(code).toBe(1);
        expect(cap.stderr).toMatch(/GOOGLE_API_KEY/);
      } finally {
        await fs.rm(tmpIn, { recursive: true, force: true });
        await fs.rm(tmpOut, { recursive: true, force: true });
      }
    });

    it("creates no output files when API key is missing", async () => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-noapi-in-"));
      const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-noapi-out-"));
      try {
        await runAnalyze(tmpIn, tmpOut, {
          concurrency: "5",
          verbose: false,
        });
        const entries = await fs.readdir(tmpOut);
        expect(entries).toEqual([]);
      } finally {
        await fs.rm(tmpIn, { recursive: true, force: true });
        await fs.rm(tmpOut, { recursive: true, force: true });
      }
    });
  });

  // ── Scenario 6: missing input directory → exit 2 ─────────────────────
  // (scenarios.md historically said "exit 1"; the README's exit-code table
  // and src/main/run-analyze.ts both define 2 = "input dir not found".
  // We assert the actual implemented contract.)
  describe("Scenario 6 — Missing Input Directory", () => {
    it("returns exit code 2 and writes a descriptive error", async () => {
      process.env.GOOGLE_API_KEY = "test-key-not-used"; // bypasses scenario 5
      const nonexistent = path.join(os.tmpdir(), `does-not-exist-${Date.now()}`);

      const code = await runAnalyze(nonexistent, undefined, {
        concurrency: "5",
        verbose: false,
      });

      expect(code).toBe(2);
      expect(cap.stderr.toLowerCase()).toMatch(/not found|not readable/);
    });
  });

  // ── Invalid --max-cost-usd → exit 1 (validated before any API/IO work) ─
  describe("Invalid --max-cost-usd", () => {
    it("returns exit code 1 and explains the constraint for a non-numeric cap", async () => {
      const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-cost-in-"));
      const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-cost-out-"));
      try {
        const code = await runAnalyze(tmpIn, tmpOut, {
          concurrency: "5",
          verbose: false,
          maxCostUsd: "abc",
        });
        expect(code).toBe(1);
        expect(cap.stderr).toMatch(/--max-cost-usd/);
      } finally {
        await fs.rm(tmpIn, { recursive: true, force: true });
        await fs.rm(tmpOut, { recursive: true, force: true });
      }
    });

    it("rejects a negative cap", async () => {
      const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-cost-in-"));
      const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-cost-out-"));
      try {
        const code = await runAnalyze(tmpIn, tmpOut, {
          concurrency: "5",
          verbose: false,
          maxCostUsd: "-1",
        });
        expect(code).toBe(1);
      } finally {
        await fs.rm(tmpIn, { recursive: true, force: true });
        await fs.rm(tmpOut, { recursive: true, force: true });
      }
    });
  });
});
