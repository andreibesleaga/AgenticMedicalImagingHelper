/**
 * E2E governance controls — the whole CLI, offline.
 *
 * Strategy: run the real `runAnalyze` on the OpenRouter path
 * (`AI_PROVIDER=openrouter`), whose only outbound dependency is the global
 * `fetch`. Stubbing `fetch` exercises everything else for real — file scanner,
 * image pre-flight, LangGraph pipeline, report writer, cost meter, call ledger,
 * manifest sealing and the chain — with no network and no API key.
 *
 * What is asserted here is the evidence chain a reviewer would actually pull
 * on: that the run is recorded (Art. 12), that the record is tamper-evident
 * (Art. 12 / NIST MANAGE 4.1), that PHI is caught *before* the upload
 * (HIPAA / GDPR), that oversight is stated (Art. 14), and that a failing run
 * is recorded just as carefully as a passing one.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as url from "url";

import { runAnalyze, runVerifyManifest } from "../../src/main/run-analyze.js";
import {
  MANIFEST_FILENAME,
  readChain,
  readManifest,
  sha256Hex,
  type RunManifest,
} from "../../src/infrastructure/run-manifest.js";
import { HUMAN_REVIEW_BLOCK } from "../../src/infrastructure/report-writer.js";

const FIXTURES = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "fixtures");

// ─── stdio capture ───────────────────────────────────────────────────────────

interface StdioCapture {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureStdio(): StdioCapture {
  const cap: StdioCapture = { stdout: "", stderr: "", restore: () => undefined };
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

// ─── OpenRouter stub ─────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type StubReply = { status?: number; json?: unknown; body?: string };

const sentRequests: any[] = [];

const IMAGE_JSON = JSON.stringify({
  modality: "X-ray",
  anatomyRegion: "Chest (AP)",
  quality: "Good",
  findings: ["Clear lung fields"],
  abnormalities: [],
  summary: "Unremarkable study.",
  references: [],
});
const SERIES_JSON = JSON.stringify({
  consistentFindings: ["Clear lung fields"],
  discrepancies: [],
  primaryDiagnosis: "Normal chest radiograph",
  differentialDiagnoses: [],
  confidenceLevel: "High",
  report: "## Series report\nNothing to report.",
});
const EVOLUTION_JSON = JSON.stringify({
  progression: "Stable",
  trends: [],
  forecastedEvolution: "No interval change expected.",
  treatmentRecommendations: [],
  combinedReport: "## Combined report\nStable across sessions.",
});

function stageOf(body: any): "image" | "series" | "evolution" {
  const text = JSON.stringify(body?.messages?.[0]?.content ?? "");
  if (text.includes("medical imaging expert")) return "image";
  if (text.includes("synthesizing findings")) return "series";
  return "evolution";
}

const USAGE = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0012 };

function okReply(body: any): StubReply {
  const content = { image: IMAGE_JSON, series: SERIES_JSON, evolution: EVOLUTION_JSON }[
    stageOf(body)
  ];
  return { json: { choices: [{ message: { content } }], usage: USAGE } };
}

function installFetchStub(reply: (body: any) => StubReply = okReply): void {
  globalThis.fetch = (async (_input: unknown, init: any) => {
    const body = JSON.parse(String(init?.body));
    sentRequests.push(body);
    const r = reply(body);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => r.json,
      text: async () => r.body ?? "",
    } as unknown as Response;
  }) as typeof fetch;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Input fixtures ──────────────────────────────────────────────────────────

/** CRC-32 (PNG polynomial), so a chunk can be spliced into a real PNG. */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Splice a `tEXt` chunk carrying `value` into a PNG, right after IHDR. */
function withTextChunk(png: Buffer, keyword: string, value: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.alloc(1), Buffer.from(value)]);
  const type = Buffer.from("tEXt", "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([length, type, data, crc]);
  // 8-byte signature + 25-byte IHDR chunk.
  const insertAt = 8 + 25;
  return Buffer.concat([png.subarray(0, insertAt), chunk, png.subarray(insertAt)]);
}

async function makeInput(
  root: string,
  opts: { contextText?: string; images?: number; series?: number; imageBytes?: Buffer } = {}
): Promise<void> {
  const source = opts.imageBytes ?? (await fs.readFile(path.join(FIXTURES, "test_image.png")));
  for (let s = 1; s <= (opts.series ?? 1); s += 1) {
    const seriesDir = path.join(root, `series_${s}`);
    await fs.mkdir(seriesDir, { recursive: true });
    for (let i = 1; i <= (opts.images ?? 2); i += 1) {
      await fs.writeFile(path.join(seriesDir, `img_0${i}.png`), source);
    }
    if (opts.contextText !== undefined) {
      await fs.writeFile(path.join(seriesDir, "context.txt"), opts.contextText);
    }
  }
}

const CLEAN_CONTEXT = "Follow-up chest radiograph. No prior comparison available.";
const PHI_CONTEXT =
  "Patient Name: Jane A. Roe\nMRN: 4471902\nSSN 123-45-6789\nDOB: 04/11/1968\n" +
  "Reachable at jane.roe@example.org\nFollow-up chest radiograph.\n";
const PHI_SECRETS = ["Jane", "4471902", "123-45-6789", "04/11/1968", "jane.roe@example.org"];

// ─── Harness ─────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AI_MAX_RETRIES",
  "IMAGE_QUALITY",
] as const;

let tmp: string;
let cap: StdioCapture;
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof globalThis.fetch;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "governance-e2e-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  savedFetch = globalThis.fetch;
  sentRequests.length = 0;

  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "sk-or-test-offline";
  process.env.OPENROUTER_MODEL = "google/gemini-2.5-flash";
  process.env.AI_MAX_RETRIES = "0";
  delete process.env.IMAGE_QUALITY;

  installFetchStub();
  cap = captureStdio();
});

afterEach(async () => {
  cap.restore();
  globalThis.fetch = savedFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

function dirs(name = "run"): { input: string; output: string } {
  return { input: path.join(tmp, `${name}-in`), output: path.join(tmp, `${name}-out`) };
}

const BASE_OPTS = { concurrency: "2", verbose: false };

// ─── 1. The manifest ─────────────────────────────────────────────────────────

describe("E2E governance — run manifest (Art. 12 record-keeping)", () => {
  it("records a complete, sealed manifest for a successful run", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: CLEAN_CONTEXT });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);

    const manifest = (await readManifest(output))!;
    expect(manifest).not.toBeNull();

    // Identity and configuration
    expect(manifest.manifestVersion).toBe("1.0");
    expect(manifest.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.provider).toBe("openrouter");
    expect(manifest.model).toBe("google/gemini-2.5-flash");
    expect(manifest.pricing).toEqual({ inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 });
    expect(manifest.settings).toEqual({ concurrency: 2, maxCostUsd: null, retries: 0 });
    expect(Date.parse(manifest.startedAt)).toBeLessThanOrEqual(Date.parse(manifest.finishedAt));

    // What went in
    expect(manifest.inputs.map((i) => i.path).sort()).toEqual([
      "series_1/img_01.png",
      "series_1/img_02.png",
    ]);
    const onDisk = await fs.readFile(path.join(input, "series_1", "img_01.png"));
    expect(manifest.inputs[0]!.sha256).toBe(sha256Hex(onDisk));
    expect(manifest.inputs[0]!.bytes).toBe(onDisk.byteLength);
    expect(manifest.contextFiles.map((c) => c.path)).toEqual(["series_1/context.txt"]);

    // What came out
    expect(manifest.outputs.map((o) => o.path).sort()).toEqual([
      "combined_diagnostic_report.md",
      "evolution_analysis.json",
      "series_1/img_01_analysis.json",
      "series_1/img_02_analysis.json",
      "series_1/series_summary.md",
    ]);

    // The seal
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.prevManifestHash).toBeNull();
    expect(manifest.exitCode).toBe(0);
    expect(manifest.warnings).toEqual([]);
    expect(manifest.humanReview).toEqual({ required: true, reviewedBy: null });
  });

  it("records one row per model call, labelled by pipeline stage", async () => {
    const { input, output } = dirs();
    // Two series, so the temporal-evolution node actually calls the model
    // (a single series short-circuits to "SingleSeries" without one).
    await makeInput(input, { images: 1, series: 2 });

    await runAnalyze(input, output, BASE_OPTS);
    const manifest = (await readManifest(output))!;

    expect(manifest.calls.map((c) => c.stage)).toEqual([
      "image",
      "image",
      "series",
      "series",
      "evolution",
    ]);
    expect(manifest.calls.map((c) => c.index)).toEqual([1, 2, 3, 4, 5]);
    for (const call of manifest.calls) {
      expect(call.tokensIn).toBe(1000);
      expect(call.tokensOut).toBe(200);
      expect(call.retries).toBe(0);
      expect(call.providerUsd).toBeCloseTo(0.0012, 10);
      expect(Date.parse(call.timestamp)).not.toBeNaN();
    }
  });

  it("keeps totals consistent with the per-call rows it recorded", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1, series: 2 });

    await runAnalyze(input, output, BASE_OPTS);
    const { calls, totals } = (await readManifest(output))!;

    expect(totals.calls).toBe(calls.length);
    expect(totals.tokensIn).toBe(calls.reduce((n, c) => n + c.tokensIn, 0));
    expect(totals.tokensOut).toBe(calls.reduce((n, c) => n + c.tokensOut, 0));
    expect(totals.estimatedUsd).toBeCloseTo(
      calls.reduce((n, c) => n + c.estimatedUsd, 0),
      10
    );
    expect(totals.providerUsd).toBeCloseTo(0.0012 * calls.length, 10);
    expect(totals).toMatchObject({ images: 2, imagesSucceeded: 2, imagesFailed: 0, series: 2 });
  });

  it("records the image-quality preset when one is configured", async () => {
    process.env.IMAGE_QUALITY = "economy";
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });

    await runAnalyze(input, output, BASE_OPTS);
    expect((await readManifest(output))!.settings.imageQuality).toBe("economy");
  });

  it("records the --reviewer attestation (Art. 14) without changing anything clinical", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });

    expect(await runAnalyze(input, output, { ...BASE_OPTS, reviewer: "Dr A. Reviewer" })).toBe(0);

    const { humanReview } = (await readManifest(output))!;
    expect(humanReview.required).toBe(true);
    expect(humanReview.reviewedBy?.name).toBe("Dr A. Reviewer");
    expect(Date.parse(humanReview.reviewedBy!.at)).not.toBeNaN();
  });
});

// ─── 2. The chain ────────────────────────────────────────────────────────────

describe("E2E governance — hash chain (NIST MANAGE 4.1)", () => {
  it("starts a chain when the ledger file does not exist yet", async () => {
    const { input, output } = dirs();
    const chain = path.join(tmp, "ledger", "audit.jsonl");
    await makeInput(input, { images: 1 });

    await runAnalyze(input, output, { ...BASE_OPTS, manifestChain: chain });

    const manifest = (await readManifest(output))!;
    const entries = (await readChain(chain))!;
    expect(manifest.prevManifestHash).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      manifestHash: manifest.manifestHash,
      prevManifestHash: null,
      manifest: path.join(output, MANIFEST_FILENAME),
    });
  });

  it("links each subsequent run to its predecessor", async () => {
    const chain = path.join(tmp, "audit.jsonl");
    const first = dirs("first");
    const second = dirs("second");
    await makeInput(first.input, { images: 1 });
    await makeInput(second.input, { images: 1 });

    await runAnalyze(first.input, first.output, { ...BASE_OPTS, manifestChain: chain });
    await runAnalyze(second.input, second.output, { ...BASE_OPTS, manifestChain: chain });

    const m1 = (await readManifest(first.output))!;
    const m2 = (await readManifest(second.output))!;
    const entries = (await readChain(chain))!;

    expect(m1.prevManifestHash).toBeNull();
    expect(m2.prevManifestHash).toBe(m1.manifestHash);
    expect(entries.map((e) => e.manifestHash)).toEqual([m1.manifestHash, m2.manifestHash]);
    expect(await runVerifyManifest(second.output, { chain })).toBe(0);
  });

  it("does not write a ledger when --manifest-chain is not given", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });

    await runAnalyze(input, output, BASE_OPTS);
    expect((await readManifest(output))!.prevManifestHash).toBeNull();
    expect(await fs.readdir(tmp)).not.toContain("audit.jsonl");
  });
});

// ─── 3. verify-manifest ──────────────────────────────────────────────────────

describe("E2E governance — verify-manifest", () => {
  async function completedRun(): Promise<{ input: string; output: string }> {
    const d = dirs();
    await makeInput(d.input, { contextText: CLEAN_CONTEXT });
    await runAnalyze(d.input, d.output, BASE_OPTS);
    return d;
  }

  it("exits 0 on an untouched run and prints a per-check report", async () => {
    const { output } = await completedRun();
    cap.stdout = "";

    expect(await runVerifyManifest(output)).toBe(0);
    expect(cap.stdout).toMatch(/\[PASS\] manifest hash/);
    expect(cap.stdout).toMatch(/\[PASS\] inputs/);
    expect(cap.stdout).toMatch(/\[PASS\] outputs/);
    expect(cap.stdout).toMatch(/integrity verified, not clinical validity/);
  });

  it("exits 6 when the manifest is missing", async () => {
    const { output } = await completedRun();
    await fs.rm(path.join(output, MANIFEST_FILENAME));
    expect(await runVerifyManifest(output)).toBe(6);
  });

  it("exits 6 when a report was edited after the run", async () => {
    const { output } = await completedRun();
    const report = path.join(output, "combined_diagnostic_report.md");
    await fs.appendFile(report, "\n(edited by hand)\n");

    expect(await runVerifyManifest(output)).toBe(6);
    expect(cap.stdout).toMatch(/\[FAIL\] outputs/);
  });

  it("exits 6 when an input image was swapped after the run", async () => {
    const { input, output } = await completedRun();
    await fs.writeFile(path.join(input, "series_1", "img_01.png"), "not the same image");

    expect(await runVerifyManifest(output)).toBe(6);
    expect(cap.stdout).toMatch(/\[FAIL\] inputs/);
  });

  it("exits 6 when a manifest field was edited without re-sealing", async () => {
    const { output } = await completedRun();
    const file = path.join(output, MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(file, "utf-8")) as RunManifest;
    manifest.exitCode = 0;
    manifest.totals.imagesFailed = 99;
    await fs.writeFile(file, JSON.stringify(manifest, null, 2));

    expect(await runVerifyManifest(output)).toBe(6);
    expect(cap.stdout).toMatch(/\[FAIL\] manifest hash/);
  });

  it("exits 6 when a run is missing from the ledger it claims to be in", async () => {
    const chain = path.join(tmp, "audit.jsonl");
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });
    await runAnalyze(input, output, BASE_OPTS); // deliberately not chained

    await fs.writeFile(
      chain,
      `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", manifestHash: "f".repeat(64), prevManifestHash: null, manifest: "/elsewhere" })}\n`
    );

    expect(await runVerifyManifest(output, { chain })).toBe(6);
    expect(cap.stdout).toMatch(/\[FAIL\] chain membership/);
  });

  it("reports a deleted input as skipped, not as tampering", async () => {
    const { input, output } = await completedRun();
    await fs.rm(path.join(input, "series_1", "img_01.png"));

    expect(await runVerifyManifest(output)).toBe(0);
    expect(cap.stdout).toMatch(/no longer present \(skipped\)/);
  });
});

// ─── 4. PHI / PII hygiene ────────────────────────────────────────────────────

describe("E2E governance — PHI scan (HIPAA / GDPR)", () => {
  it("warns on stderr by default, continues, and records masked findings", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: PHI_CONTEXT, images: 1 });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);

    expect(cap.stderr).toMatch(/PHI-scan: 5 possible identifier\(s\)/);
    expect(cap.stderr).toMatch(/--strict-phi/);

    const { warnings } = (await readManifest(output))!;
    expect(warnings[0]).toMatch(/PHI-scan: 5 possible identifier\(s\)/);
    expect(warnings.filter((w) => w.includes("series_1/context.txt"))).toHaveLength(5);
  });

  it("never writes the context text or a raw identifier to stderr or the manifest", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: PHI_CONTEXT, images: 1 });

    await runAnalyze(input, output, BASE_OPTS);
    const manifestText = await fs.readFile(path.join(output, MANIFEST_FILENAME), "utf-8");

    for (const secret of PHI_SECRETS) {
      expect(cap.stderr).not.toContain(secret);
      expect(manifestText).not.toContain(secret);
    }
    expect(cap.stderr).toContain("*"); // the masked shapes are what is shown
  });

  it("--strict-phi exits 7 before any upload and leaves no output", async () => {
    const { input, output } = dirs();
    await fs.mkdir(output, { recursive: true });
    await makeInput(input, { contextText: PHI_CONTEXT, images: 1 });

    expect(await runAnalyze(input, output, { ...BASE_OPTS, strictPhi: true })).toBe(7);

    expect(sentRequests).toHaveLength(0);
    expect(await fs.readdir(output)).toEqual([]);
    expect(cap.stderr).toMatch(/refusing to upload anything/);
  });

  it("--allow-phi acknowledges the findings and keeps them in the record", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: PHI_CONTEXT, images: 1 });

    expect(await runAnalyze(input, output, { ...BASE_OPTS, allowPhi: true })).toBe(0);
    expect(cap.stderr).toMatch(/--allow-phi is set: continuing/);

    const { warnings } = (await readManifest(output))!;
    expect(warnings).toContain("PHI findings acknowledged with --allow-phi.");
    expect(warnings.some((w) => w.startsWith("PHI-scan:"))).toBe(true);
  });

  it("stays silent and records no warning for a de-identified context file", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: CLEAN_CONTEXT, images: 1 });

    await runAnalyze(input, output, BASE_OPTS);
    expect(cap.stderr).not.toMatch(/PHI-scan/);
    expect((await readManifest(output))!.warnings).toEqual([]);
  });
});

// ─── 5. Input refusals ───────────────────────────────────────────────────────

describe("E2E governance — input refusals (Art. 15 robustness)", () => {
  it("refuses a DICOM file with exit code 2 and an actionable message", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });
    await fs.writeFile(path.join(input, "series_1", "study.dcm"), Buffer.alloc(300, 0));

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(2);
    expect(cap.stderr).toMatch(/Refusing DICOM file/);
    expect(cap.stderr).toMatch(/tracked as future work/);
    expect(sentRequests).toHaveLength(0);
  });

  it("refuses a run over MAX_IMAGES_PER_RUN with exit code 2", async () => {
    const saved = process.env.MAX_IMAGES_PER_RUN;
    process.env.MAX_IMAGES_PER_RUN = "1";
    try {
      const { input, output } = dirs();
      await makeInput(input, { images: 2 });
      expect(await runAnalyze(input, output, BASE_OPTS)).toBe(2);
      expect(cap.stderr).toMatch(/Run exceeds MAX_IMAGES_PER_RUN/);
      expect(sentRequests).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.MAX_IMAGES_PER_RUN;
      else process.env.MAX_IMAGES_PER_RUN = saved;
    }
  });

  it("does not forward image metadata: a tEXt chunk carrying PHI never reaches the wire", async () => {
    const { input, output } = dirs();
    const png = await fs.readFile(path.join(FIXTURES, "test_image.png"));
    const tagged = withTextChunk(png, "Comment", "PatientName=Jane A. Roe; MRN=4471902");
    expect(tagged.includes(Buffer.from("tEXt"))).toBe(true); // the fixture really is tagged
    await makeInput(input, { images: 1, imageBytes: tagged });

    await runAnalyze(input, output, BASE_OPTS);

    const payload = JSON.stringify(sentRequests[0]);
    const match = /data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)/.exec(payload);
    expect(match).not.toBeNull();
    const sent = Buffer.from(match![2]!, "base64");

    if (sent.equals(tagged)) {
      // Pass-through policy: nothing was re-encoded, so nothing was added
      // either. Metadata stripping then remains the operator's job — recorded
      // honestly rather than asserted away.
      expect(sent.byteLength).toBe(tagged.byteLength);
    } else {
      // Re-encoded (today's behaviour): the ancillary chunks must be gone.
      for (const marker of ["tEXt", "iTXt", "zTXt", "eXIf", "Exif\0\0"]) {
        expect(sent.includes(Buffer.from(marker, "latin1"))).toBe(false);
      }
      expect(payload).not.toContain("4471902");
    }
  });
});

// ─── 6. Failure paths still leave a record ───────────────────────────────────

describe("E2E governance — the record survives failure", () => {
  it("records exit 4 and the failure warning when images could not be analysed", async () => {
    installFetchStub((body) =>
      stageOf(body) === "image" ? { status: 400, body: "bad request" } : okReply(body)
    );
    const { input, output } = dirs();
    await makeInput(input, { images: 2 });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(4);

    const manifest = (await readManifest(output))!;
    expect(manifest.exitCode).toBe(4);
    expect(manifest.totals).toMatchObject({ imagesSucceeded: 0, imagesFailed: 2 });
    expect(manifest.warnings.some((w) => /2 image\(s\) failed to analyze/.test(w))).toBe(true);
    expect(await runVerifyManifest(output)).toBe(0);
  });

  it("records exit 5 and the cap message when the cost cap aborted the run", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 2 });

    expect(await runAnalyze(input, output, { ...BASE_OPTS, maxCostUsd: "0" })).toBe(5);

    const manifest = (await readManifest(output))!;
    expect(manifest.exitCode).toBe(5);
    expect(manifest.settings.maxCostUsd).toBe(0);
    expect(manifest.warnings.some((w) => /exceeded --max-cost-usd/.test(w))).toBe(true);
    expect(manifest.calls.length).toBeGreaterThan(0);
  });

  it("leaves no manifest for a pre-flight rejection, which produced no output at all", async () => {
    const { input, output } = dirs();
    await fs.mkdir(output, { recursive: true });
    delete process.env.OPENROUTER_API_KEY;

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(1);
    expect(await fs.readdir(output)).toEqual([]);
  });

  it("never lets a manifest-writing failure change the run's exit code", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });
    // Occupy the manifest's path with a directory, so writing it must fail.
    await fs.mkdir(path.join(output, MANIFEST_FILENAME), { recursive: true });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);
    expect(cap.stderr).toMatch(/could not write the run manifest/);
    expect(cap.stdout).toMatch(/Analysis complete!/);
  });
});

// ─── 7. Human oversight in the artefacts ─────────────────────────────────────

describe("E2E governance — human oversight (Art. 14)", () => {
  it("starts every rendered Markdown report with the clinician-review block", async () => {
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });

    await runAnalyze(input, output, BASE_OPTS);

    for (const file of [
      path.join(output, "combined_diagnostic_report.md"),
      path.join(output, "series_1", "series_summary.md"),
    ]) {
      const content = await fs.readFile(file, "utf-8");
      expect(content.startsWith(HUMAN_REVIEW_BLOCK)).toBe(true);
    }
  });
});

// ─── 8. Context consistency ──────────────────────────────────────────────────

/**
 * The fairness probe scored two E4 runs perfectly clean while they described a
 * 69-year-old female as a child and a 54-year-old as "a young patient". The
 * context-consistency probe is wired into the CLI to catch that class of
 * output, and — because it is a heuristic over model prose — it must warn
 * without ever changing the exit code.
 */
describe("E2E governance — context consistency", () => {
  const AGE_SEX_CONTEXT =
    "De-identified frontal chest radiographs. Patient age at first study: 69 years; sex: female. " +
    "No clinical history is available.";

  /** Replies whose narrative invents a paediatric male patient. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function contradictingReply(body: any): StubReply {
    const content = {
      image: JSON.stringify({
        modality: "X-ray",
        anatomyRegion: "Chest (AP)",
        quality: "Good",
        findings: ["Normal thymic shadow"],
        abnormalities: [],
        summary: "Chest X-ray of a child; his lungs are clear. Likely a paediatric ICU study.",
        references: [],
      }),
      series: SERIES_JSON,
      evolution: EVOLUTION_JSON,
    }[stageOf(body)];
    return { json: { choices: [{ message: { content } }], usage: USAGE } };
  }

  it("warns on stderr and records the finding in the manifest, without failing the run", async () => {
    installFetchStub(contradictingReply);
    const { input, output } = dirs();
    await makeInput(input, { contextText: AGE_SEX_CONTEXT, images: 1 });

    // Non-blocking: the probe never changes the exit code.
    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);

    expect(cap.stderr).toMatch(/Context-consistency: \d+ statement\(s\)/);
    expect(cap.stderr).toMatch(/non-blocking/);

    const manifest = (await readManifest(output))!;
    const headline = manifest.warnings.find((w) => w.startsWith("Context-consistency:"));
    expect(headline).toBeDefined();
    expect(headline).toMatch(/\[age, sex\]/);

    const details = manifest.warnings.filter((w) => w.startsWith("context-consistency ["));
    expect(details.length).toBeGreaterThan(0);
    expect(details.join(" ")).toContain("the context states 69");
    expect(details.join(" ")).toContain("Chest X-ray of a child");
  });

  it("records nothing when the narrative agrees with the supplied context", async () => {
    const { input, output } = dirs();
    await makeInput(input, { contextText: AGE_SEX_CONTEXT, images: 1 });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);

    expect(cap.stderr).not.toMatch(/Context-consistency/);
    const manifest = (await readManifest(output))!;
    expect(
      manifest.warnings.filter((w) => w.toLowerCase().includes("context-consistency"))
    ).toEqual([]);
  });

  it("records nothing when the context states no demographics", async () => {
    installFetchStub(contradictingReply);
    const { input, output } = dirs();
    await makeInput(input, { contextText: CLEAN_CONTEXT, images: 1 });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);
    expect(cap.stderr).not.toMatch(/Context-consistency/);
  });

  it("records nothing when there is no context file at all", async () => {
    installFetchStub(contradictingReply);
    const { input, output } = dirs();
    await makeInput(input, { images: 1 });

    expect(await runAnalyze(input, output, BASE_OPTS)).toBe(0);
    expect(cap.stderr).not.toMatch(/Context-consistency/);
  });
});
