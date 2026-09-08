/**
 * Run manifest + hash-chained ledger (EU AI Act Art. 12 / Art. 26(6);
 * NIST AI RMF MANAGE 4.1; HIPAA §164.312(b) audit controls).
 *
 * The tests are organised around the property each piece must have:
 *   - canonical JSON is *deterministic* (key order cannot change the digest);
 *   - the seal *detects* any edit to any field;
 *   - the chain *localises* which run was altered or removed;
 *   - verification is *honest* — it reports what it could not check rather than
 *     passing silently, and never claims clinical validity.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import {
  CallLedger,
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  appendChain,
  canonicalJson,
  chainHead,
  computeManifestHash,
  hashFileEntries,
  hashFileEntry,
  readChain,
  readManifest,
  sealManifest,
  sha256Hex,
  toolVersionFrom,
  verifyChainLinks,
  verifyManifest,
  withStageTracking,
  writeManifest,
  type ChainEntry,
  type RunManifest,
  type UnsealedRunManifest,
} from "../../../src/infrastructure/run-manifest.js";
import type { CostCallInfo } from "../../../src/infrastructure/cost-meter.js";
import type { GeminiClient } from "../../../src/infrastructure/gemini-client.js";
import type { ImageAnalysis, SeriesSummary, TemporalAnalysis } from "../../../src/domain/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function baseManifest(overrides: Partial<UnsealedRunManifest> = {}): UnsealedRunManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    toolVersion: "1.0.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    provider: "google",
    model: "gemini-2.5-flash",
    pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
    settings: { concurrency: 5, maxCostUsd: null, retries: 3 },
    inputDir: "/input",
    outputDir: "/output",
    inputs: [],
    contextFiles: [],
    calls: [],
    outputs: [],
    totals: {
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      estimatedUsd: 0,
      images: 0,
      imagesSucceeded: 0,
      imagesFailed: 0,
      series: 0,
    },
    exitCode: 0,
    warnings: [],
    humanReview: { required: true, reviewedBy: null },
    prevManifestHash: null,
    ...overrides,
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-test-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ─── Canonical JSON ──────────────────────────────────────────────────────────

describe("canonicalJson", () => {
  it("serialises primitives, null and undefined", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([])).toBe("[]");
  });

  it("sorts object keys, so insertion order cannot change the digest", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("drops undefined members rather than emitting them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("recurses through nested objects and arrays", () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }], a: null })).toBe('{"a":null,"z":[{"a":2,"b":1}]}');
  });
});

describe("sha256Hex", () => {
  it("matches the published digest of the empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("accepts bytes as well as text", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex("abc"));
  });
});

// ─── Sealing ─────────────────────────────────────────────────────────────────

describe("sealManifest / computeManifestHash", () => {
  it("produces a 64-hex-character digest", () => {
    expect(sealManifest(baseManifest()).manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same content and independent of key insertion order", () => {
    const a = sealManifest(baseManifest());
    // Rebuild the same content with the keys inserted in reverse order.
    const source = baseManifest() as unknown as Record<string, unknown>;
    const reordered = Object.fromEntries(
      Object.entries(source).reverse()
    ) as unknown as UnsealedRunManifest;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(source));
    expect(sealManifest(reordered).manifestHash).toBe(a.manifestHash);
  });

  it("excludes manifestHash itself, so a sealed manifest re-hashes to the same value", () => {
    const sealed = sealManifest(baseManifest());
    expect(computeManifestHash(sealed)).toBe(sealed.manifestHash);
  });

  it("changes when any field changes", () => {
    const original = sealManifest(baseManifest()).manifestHash;
    expect(sealManifest(baseManifest({ exitCode: 4 })).manifestHash).not.toBe(original);
    expect(sealManifest(baseManifest({ warnings: ["x"] })).manifestHash).not.toBe(original);
    expect(sealManifest(baseManifest({ prevManifestHash: "a".repeat(64) })).manifestHash).not.toBe(
      original
    );
  });
});

describe("toolVersionFrom", () => {
  it("reads a usable version string", () => {
    expect(toolVersionFrom({ version: "1.2.3" })).toBe("1.2.3");
  });

  it("falls back to 'unknown' for anything unusable", () => {
    expect(toolVersionFrom({})).toBe("unknown");
    expect(toolVersionFrom(null)).toBe("unknown");
    expect(toolVersionFrom(undefined)).toBe("unknown");
    expect(toolVersionFrom({ version: "" })).toBe("unknown");
    expect(toolVersionFrom({ version: 3 })).toBe("unknown");
  });
});

// ─── File hashing ────────────────────────────────────────────────────────────

describe("hashFileEntry / hashFileEntries", () => {
  it("content-addresses a file with a POSIX path relative to the base directory", async () => {
    await fs.mkdir(path.join(tmp, "series_1"));
    const file = path.join(tmp, "series_1", "a.png");
    await fs.writeFile(file, "abc");

    const entry = await hashFileEntry(file, tmp);
    expect(entry).toEqual({ path: "series_1/a.png", sha256: sha256Hex("abc"), bytes: 3 });
  });

  it("returns null for an unreadable file instead of throwing", async () => {
    expect(await hashFileEntry(path.join(tmp, "missing.png"), tmp)).toBeNull();
  });

  it("drops unreadable files from a batch and keeps the readable ones", async () => {
    const good = path.join(tmp, "good.png");
    await fs.writeFile(good, "x");

    const entries = await hashFileEntries([good, path.join(tmp, "gone.png")], tmp);
    expect(entries.map((e) => e.path)).toEqual(["good.png"]);
  });

  it("returns an empty list for no paths", async () => {
    expect(await hashFileEntries([], tmp)).toEqual([]);
  });
});

// ─── Call ledger ─────────────────────────────────────────────────────────────

function callInfo(overrides: Partial<CostCallInfo> = {}): CostCallInfo {
  return {
    calls: 1,
    lastInputTokens: 100,
    lastOutputTokens: 50,
    cumulativeUsd: 0.001,
    ...overrides,
  };
}

describe("CallLedger", () => {
  const clock = () => new Date("2026-01-01T00:00:00.000Z");

  it("records the stage, tokens and a timestamp for each call", () => {
    const ledger = new CallLedger(clock);
    ledger.record(callInfo());

    expect(ledger.calls()).toEqual([
      {
        index: 1,
        stage: "image",
        timestamp: "2026-01-01T00:00:00.000Z",
        tokensIn: 100,
        tokensOut: 50,
        estimatedUsd: 0.001,
        retries: 0,
      },
    ]);
  });

  it("defaults to the wall clock when none is injected", () => {
    const ledger = new CallLedger();
    ledger.record(callInfo());
    expect(ledger.calls()[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("converts the meter's cumulative USD into a per-call delta that re-sums to the total", () => {
    const ledger = new CallLedger(clock);
    ledger.record(callInfo({ calls: 1, cumulativeUsd: 0.001 }));
    ledger.record(callInfo({ calls: 2, cumulativeUsd: 0.003 }));

    const perCall = ledger.calls().map((c) => c.estimatedUsd);
    expect(perCall).toEqual([0.001, 0.002]);
    expect(perCall.reduce((a, b) => a + b, 0)).toBeCloseTo(0.003, 10);
  });

  it("does the same for provider-reported cost, and omits it when the provider reports none", () => {
    const ledger = new CallLedger(clock);
    ledger.record(callInfo({ calls: 1, cumulativeUsd: 0.001 }));
    ledger.record(callInfo({ calls: 2, cumulativeUsd: 0.002, providerReportedUsd: 0.004 }));
    ledger.record(callInfo({ calls: 3, cumulativeUsd: 0.003, providerReportedUsd: 0.009 }));

    const calls = ledger.calls();
    expect(calls[0]).not.toHaveProperty("providerUsd");
    expect(calls[1]!.providerUsd).toBeCloseTo(0.004, 10);
    expect(calls[2]!.providerUsd).toBeCloseTo(0.005, 10);
  });

  it("attributes retries to the call they preceded, then resets the counter", () => {
    const ledger = new CallLedger(clock);
    ledger.noteRetry();
    ledger.noteRetry();
    ledger.record(callInfo({ calls: 1 }));
    ledger.record(callInfo({ calls: 2 }));

    expect(ledger.calls().map((c) => c.retries)).toEqual([2, 0]);
  });

  it("labels calls with the stage set most recently", () => {
    const ledger = new CallLedger(clock);
    ledger.record(callInfo({ calls: 1 }));
    ledger.setStage("series");
    ledger.record(callInfo({ calls: 2 }));
    ledger.setStage("evolution");
    ledger.record(callInfo({ calls: 3 }));

    expect(ledger.calls().map((c) => c.stage)).toEqual(["image", "series", "evolution"]);
  });

  it("hands out a copy, so a caller cannot mutate the ledger", () => {
    const ledger = new CallLedger(clock);
    ledger.record(callInfo());
    ledger.calls().pop();
    expect(ledger.calls()).toHaveLength(1);
  });
});

describe("withStageTracking", () => {
  function fakeClient(seen: string[]): GeminiClient {
    return {
      analyzeImage: async (imagePath, seriesId) => {
        seen.push(`image:${imagePath}:${seriesId}`);
        return { imagePath, seriesId } as ImageAnalysis;
      },
      synthesizeSeries: async (seriesId, analyses, textContext) => {
        seen.push(`series:${seriesId}:${analyses.length}:${String(textContext)}`);
        return { seriesId } as SeriesSummary;
      },
      analyzeEvolution: async (summaries, rootContext) => {
        seen.push(`evolution:${summaries.length}:${String(rootContext)}`);
        return { seriesCount: summaries.length } as TemporalAnalysis;
      },
    };
  }

  it("passes every argument through untouched and labels each stage", async () => {
    const seen: string[] = [];
    const ledger = new CallLedger(() => new Date("2026-01-01T00:00:00.000Z"));
    const client = withStageTracking(fakeClient(seen), ledger);

    await client.analyzeImage("/in/a.png", "series_1");
    ledger.record(callInfo({ calls: 1 }));
    await client.synthesizeSeries("series_1", [{} as ImageAnalysis], "ctx");
    ledger.record(callInfo({ calls: 2 }));
    await client.analyzeEvolution([{} as SeriesSummary, {} as SeriesSummary], undefined);
    ledger.record(callInfo({ calls: 3 }));

    expect(seen).toEqual([
      "image:/in/a.png:series_1",
      "series:series_1:1:ctx",
      "evolution:2:undefined",
    ]);
    expect(ledger.calls().map((c) => c.stage)).toEqual(["image", "series", "evolution"]);
  });

  it("returns the wrapped client's own results", async () => {
    const client = withStageTracking(fakeClient([]), new CallLedger());
    await expect(client.analyzeImage("/in/a.png", "s1")).resolves.toMatchObject({
      imagePath: "/in/a.png",
    });
    await expect(client.analyzeEvolution([], undefined)).resolves.toMatchObject({
      seriesCount: 0,
    });
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe("writeManifest / readManifest", () => {
  it("writes run_manifest.json into the output directory, creating it if needed", async () => {
    const out = path.join(tmp, "nested", "output");
    const manifest = sealManifest(baseManifest());

    const written = await writeManifest(out, manifest);
    expect(written).toBe(path.join(out, MANIFEST_FILENAME));
    expect(await readManifest(out)).toEqual(manifest);
  });

  it("returns null when the manifest is absent", async () => {
    expect(await readManifest(tmp)).toBeNull();
  });

  it("returns null when the manifest is not valid JSON", async () => {
    await fs.writeFile(path.join(tmp, MANIFEST_FILENAME), "{not json");
    expect(await readManifest(tmp)).toBeNull();
  });

  it("returns null when the manifest is JSON but not an object", async () => {
    await fs.writeFile(path.join(tmp, MANIFEST_FILENAME), "[1,2,3]");
    expect(await readManifest(tmp)).toBeNull();
    await fs.writeFile(path.join(tmp, MANIFEST_FILENAME), "null");
    expect(await readManifest(tmp)).toBeNull();
  });
});

describe("readChain / appendChain / chainHead", () => {
  const entry = (hash: string, prev: string | null): ChainEntry => ({
    at: "2026-01-01T00:00:00.000Z",
    manifestHash: hash,
    prevManifestHash: prev,
    manifest: `/output/${hash}/run_manifest.json`,
  });

  it("treats an absent chain file as an empty chain", async () => {
    expect(await readChain(path.join(tmp, "nope.jsonl"))).toEqual([]);
    expect(chainHead([])).toBeNull();
  });

  it("appends links and reads them back in order, creating parent directories", async () => {
    const chainFile = path.join(tmp, "ledger", "chain.jsonl");
    await appendChain(chainFile, entry("a".repeat(64), null));
    await appendChain(chainFile, entry("b".repeat(64), "a".repeat(64)));

    const entries = await readChain(chainFile);
    expect(entries).toHaveLength(2);
    expect(chainHead(entries!)).toBe("b".repeat(64));
  });

  it("ignores blank lines", async () => {
    const chainFile = path.join(tmp, "chain.jsonl");
    await fs.writeFile(chainFile, `${JSON.stringify(entry("a".repeat(64), null))}\n\n   \n`);
    expect(await readChain(chainFile)).toHaveLength(1);
  });

  it("reports a malformed line as an unreadable chain (null), not as an empty one", async () => {
    const chainFile = path.join(tmp, "chain.jsonl");
    await fs.writeFile(chainFile, "{ truncated\n");
    expect(await readChain(chainFile)).toBeNull();
  });
});

// ─── Chain verification ──────────────────────────────────────────────────────

describe("verifyChainLinks", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const link = (hash: string, prev: string | null): ChainEntry => ({
    at: "2026-01-01T00:00:00.000Z",
    manifestHash: hash,
    prevManifestHash: prev,
    manifest: "/output/run_manifest.json",
  });

  function statusOf(checks: ReturnType<typeof verifyChainLinks>, name: string) {
    return checks.find((c) => c.name === name)?.status;
  }

  it("fails when the chain is empty", () => {
    const checks = verifyChainLinks([], baseManifest() as RunManifest, hashA);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe("fail");
    expect(checks[0]!.detail).toMatch(/empty or absent/);
  });

  it("passes for the first run in a chain", () => {
    const manifest = { ...baseManifest({ prevManifestHash: null }), manifestHash: hashA };
    const checks = verifyChainLinks([link(hashA, null)], manifest, hashA);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks.find((c) => c.name === "chain predecessor")!.detail).toMatch(/first run/);
  });

  it("passes for a later run and names its predecessor", () => {
    const manifest = { ...baseManifest({ prevManifestHash: hashA }), manifestHash: hashB };
    const checks = verifyChainLinks([link(hashA, null), link(hashB, hashA)], manifest, hashB);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks.find((c) => c.name === "chain predecessor")!.detail).toMatch(/links to aaaa/);
  });

  it("fails linkage when the first entry does not start the chain", () => {
    const manifest = { ...baseManifest({ prevManifestHash: hashB }), manifestHash: hashA };
    const checks = verifyChainLinks([link(hashA, hashB)], manifest, hashA);
    expect(statusOf(checks, "chain linkage")).toBe("fail");
    expect(checks.find((c) => c.name === "chain linkage")!.detail).toMatch(/entry 1/);
  });

  it("fails linkage and names the broken link when a middle run was rewritten", () => {
    const manifest = { ...baseManifest({ prevManifestHash: hashA }), manifestHash: hashB };
    const checks = verifyChainLinks(
      [link(hashA, null), link(hashB, "c".repeat(64))],
      manifest,
      hashB
    );
    expect(statusOf(checks, "chain linkage")).toBe("fail");
    expect(checks.find((c) => c.name === "chain linkage")!.detail).toMatch(/entry 2 does not link/);
  });

  it("fails membership when the run is not in the chain at all", () => {
    const manifest = { ...baseManifest(), manifestHash: hashB };
    const checks = verifyChainLinks([link(hashA, null)], manifest, hashB);
    expect(statusOf(checks, "chain membership")).toBe("fail");
    expect(statusOf(checks, "chain predecessor")).toBeUndefined();
  });

  it("fails the predecessor check when the manifest disagrees with the ledger", () => {
    const manifest = { ...baseManifest({ prevManifestHash: null }), manifestHash: hashB };
    const checks = verifyChainLinks([link(hashA, null), link(hashB, hashA)], manifest, hashB);
    expect(statusOf(checks, "chain membership")).toBe("ok");
    expect(statusOf(checks, "chain predecessor")).toBe("fail");
  });
});

// ─── End-to-end verification ─────────────────────────────────────────────────

describe("verifyManifest", () => {
  async function seedRun(
    overrides: Partial<UnsealedRunManifest> = {}
  ): Promise<{ inputDir: string; outputDir: string; manifest: RunManifest }> {
    const inputDir = path.join(tmp, "input", "series_1");
    const outputDir = path.join(tmp, "output");
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, "a.png"), "image-bytes");
    await fs.writeFile(path.join(inputDir, "context.txt"), "clinical note");
    await fs.writeFile(path.join(outputDir, "report.md"), "# report");

    const inputRoot = path.join(tmp, "input");
    const manifest = sealManifest(
      baseManifest({
        inputDir: inputRoot,
        outputDir,
        inputs: [
          {
            path: "series_1/a.png",
            sha256: sha256Hex("image-bytes"),
            bytes: "image-bytes".length,
          },
        ],
        contextFiles: [
          {
            path: "series_1/context.txt",
            sha256: sha256Hex("clinical note"),
            bytes: "clinical note".length,
          },
        ],
        outputs: [{ path: "report.md", sha256: sha256Hex("# report"), bytes: "# report".length }],
        ...overrides,
      })
    );
    await writeManifest(outputDir, manifest);
    return { inputDir: inputRoot, outputDir, manifest };
  }

  it("passes an untouched run and says integrity, not clinical validity", async () => {
    const { outputDir } = await seedRun();
    const result = await verifyManifest(outputDir);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.report).toMatch(/integrity verified, not clinical validity/);
    expect(result.checks.filter((c) => c.status === "fail")).toEqual([]);
  });

  it("fails with exit 6 when there is no manifest", async () => {
    const result = await verifyManifest(tmp);
    expect(result.exitCode).toBe(6);
    expect(result.checks[0]!.detail).toMatch(/not found or not valid JSON/);
    expect(result.report).toMatch(/VERIFICATION FAILED/);
  });

  it("fails with exit 6 when the manifest is not valid JSON", async () => {
    await fs.mkdir(path.join(tmp, "bad"), { recursive: true });
    await fs.writeFile(path.join(tmp, "bad", MANIFEST_FILENAME), "{oops");
    expect((await verifyManifest(path.join(tmp, "bad"))).exitCode).toBe(6);
  });

  it("fails when manifestHash is missing or not a SHA-256 digest", async () => {
    const { outputDir, manifest } = await seedRun();
    await fs.writeFile(
      path.join(outputDir, MANIFEST_FILENAME),
      JSON.stringify({ ...manifest, manifestHash: "nope" })
    );
    const result = await verifyManifest(outputDir);
    expect(result.exitCode).toBe(6);
    expect(result.checks[0]!.detail).toMatch(/not a SHA-256 hex digest/);

    const withoutHash: Record<string, unknown> = { ...manifest };
    delete withoutHash.manifestHash;
    await fs.writeFile(path.join(outputDir, MANIFEST_FILENAME), JSON.stringify(withoutHash));
    expect((await verifyManifest(outputDir)).exitCode).toBe(6);
  });

  it("detects an edited field: the recorded hash no longer matches the content", async () => {
    const { outputDir, manifest } = await seedRun();
    await fs.writeFile(
      path.join(outputDir, MANIFEST_FILENAME),
      JSON.stringify({
        ...manifest,
        exitCode: 0,
        totals: { ...manifest.totals, estimatedUsd: 0.5 },
      })
    );

    const result = await verifyManifest(outputDir);
    expect(result.exitCode).toBe(6);
    expect(result.checks.find((c) => c.name === "manifest hash")!.status).toBe("fail");
  });

  it("detects an edited output report", async () => {
    const { outputDir } = await seedRun();
    await fs.writeFile(path.join(outputDir, "report.md"), "# report (edited)");

    const result = await verifyManifest(outputDir);
    expect(result.exitCode).toBe(6);
    const outputs = result.checks.find((c) => c.name === "outputs")!;
    expect(outputs.status).toBe("fail");
    expect(outputs.detail).toMatch(/report\.md/);
  });

  it("detects an edited input image", async () => {
    const { inputDir, outputDir } = await seedRun();
    await fs.writeFile(path.join(inputDir, "series_1", "a.png"), "different-bytes");

    const result = await verifyManifest(outputDir);
    expect(result.exitCode).toBe(6);
    expect(result.checks.find((c) => c.name === "inputs")!.status).toBe("fail");
  });

  it("reports a file that is simply gone as skipped, not as tampering", async () => {
    const { inputDir, outputDir } = await seedRun();
    await fs.rm(path.join(inputDir, "series_1", "a.png"));

    const result = await verifyManifest(outputDir);
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.name === "inputs")!.detail).toMatch(
      /1 no longer present \(skipped\)/
    );
  });

  it("skips a file group the run never recorded", async () => {
    const { outputDir } = await seedRun({ contextFiles: [] });
    const result = await verifyManifest(outputDir);
    expect(result.checks.find((c) => c.name === "context files")!.status).toBe("skip");
  });

  it("tolerates a manifest with no inputDir or file lists at all", async () => {
    const outputDir = path.join(tmp, "bare");
    await writeManifest(
      outputDir,
      sealManifest({
        ...baseManifest(),
        inputDir: undefined,
        inputs: undefined,
        contextFiles: undefined,
        outputs: undefined,
        humanReview: undefined,
      } as unknown as UnsealedRunManifest)
    );
    const result = await verifyManifest(outputDir);
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.name === "human review")!.status).toBe("skip");
  });

  it("reports the reviewer attestation when one was recorded", async () => {
    const { outputDir } = await seedRun({
      humanReview: { required: true, reviewedBy: { name: "Dr A. Reviewer", at: "2026-01-02" } },
    });
    const check = (await verifyManifest(outputDir)).checks.find((c) => c.name === "human review")!;
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/Dr A\. Reviewer/);
  });

  it("says review is still required when no reviewer attested", async () => {
    const { outputDir } = await seedRun();
    const check = (await verifyManifest(outputDir)).checks.find((c) => c.name === "human review")!;
    expect(check.status).toBe("skip");
    expect(check.detail).toMatch(/review is still required/);
  });

  it("verifies the chain link when a ledger is supplied", async () => {
    const { outputDir, manifest } = await seedRun();
    const chainFile = path.join(tmp, "chain.jsonl");
    await appendChain(chainFile, {
      at: "2026-01-01T00:00:00.000Z",
      manifestHash: manifest.manifestHash,
      prevManifestHash: null,
      manifest: path.join(outputDir, MANIFEST_FILENAME),
    });

    const result = await verifyManifest(outputDir, { chainFile });
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.name === "chain membership")!.status).toBe("ok");
  });

  it("fails when the run is not present in the supplied ledger", async () => {
    const { outputDir } = await seedRun();
    const chainFile = path.join(tmp, "chain.jsonl");
    await appendChain(chainFile, {
      at: "2026-01-01T00:00:00.000Z",
      manifestHash: "f".repeat(64),
      prevManifestHash: null,
      manifest: "/elsewhere/run_manifest.json",
    });

    expect((await verifyManifest(outputDir, { chainFile })).exitCode).toBe(6);
  });

  it("fails when the ledger itself is corrupt", async () => {
    const { outputDir } = await seedRun();
    const chainFile = path.join(tmp, "chain.jsonl");
    await fs.writeFile(chainFile, "{ truncated\n");

    const result = await verifyManifest(outputDir, { chainFile });
    expect(result.exitCode).toBe(6);
    expect(result.checks.find((c) => c.name === "chain")!.detail).toMatch(/malformed line/);
  });

  it("renders every check with an explicit PASS/FAIL/SKIP marker", async () => {
    const { outputDir } = await seedRun({ contextFiles: [] });
    const report = (await verifyManifest(outputDir)).report;
    expect(report).toMatch(/\[PASS\] manifest hash/);
    expect(report).toMatch(/\[SKIP\] context files/);
    expect(report).toMatch(new RegExp(`Verifying .*${MANIFEST_FILENAME}`));
  });
});
