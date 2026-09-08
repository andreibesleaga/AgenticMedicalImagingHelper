/**
 * Per-run manifest and hash-chained audit ledger.
 *
 * **Why.** EU AI Act Art. 12 requires a high-risk system to record events
 * "over the lifetime of the system" and Art. 26(6) requires a deployer to keep
 * those logs; NIST AI RMF **MANAGE 4.1** asks for post-deployment monitoring
 * artefacts; HIPAA §164.312(b) asks for audit controls. `--verbose` stderr
 * lines satisfy none of them: they are unstructured, unretained and
 * unverifiable. This module writes one machine-readable `run_manifest.json`
 * per run — what went in, what came out, what each model call cost — and seals
 * it with a SHA-256 over its own canonical JSON.
 *
 * **The chain.** A manifest alone proves nothing about *history*: an attacker
 * with write access can rewrite a manifest and its hash together. Linking each
 * run to the previous run's hash (`prevManifestHash`) in an append-only
 * ledger file makes the sequence tamper-*evident*: altering or removing any
 * past run breaks every link after it, and `verify-manifest` reports where.
 *
 * **Honest limits.** This is tamper-evidence, not tamper-proofing. The ledger
 * lives on the same disk as the manifests, so a local attacker who rewrites
 * *both* the manifest and every subsequent ledger entry leaves no trace. Real
 * non-repudiation needs a signature over an off-box key (or an external
 * timestamping/transparency log); that is deliberately out of scope for a
 * research CLI and is recorded as residual risk in THREAT_MODEL T9.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import type { CostCallInfo } from "./cost-meter.js";
import type { GeminiClient } from "./gemini-client.js";

/** Schema version of `run_manifest.json`. Bump on any breaking field change. */
export const MANIFEST_VERSION = "1.0";

/** File name written into the run's output directory. */
export const MANIFEST_FILENAME = "run_manifest.json";

/** Pipeline stage a model call belongs to. */
export type CallStage = "image" | "series" | "evolution";

/** One content-addressed file reference. `path` is POSIX-relative to a base dir. */
export interface ManifestFileEntry {
  path: string;
  sha256: string;
  bytes: number;
}

/** One recorded model call. */
export interface ManifestCall {
  /** 1-based call index in the order the meter observed them. */
  index: number;
  stage: CallStage;
  timestamp: string;
  tokensIn: number;
  /** Output tokens **including** the model's thinking tokens (Google bills them as output). */
  tokensOut: number;
  /** Token-based estimate for this call alone, in USD. */
  estimatedUsd: number;
  /** Provider-reported charge for this call, when the provider reports one. */
  providerUsd?: number;
  /** Retry attempts consumed before this call succeeded. */
  retries: number;
}

/** Prices used for the estimate, echoed so a later reader can recompute it. */
export interface ManifestPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/** Run settings that change results or cost, captured as configured. */
export interface ManifestSettings {
  concurrency: number;
  /** Client-side cost cap in USD; `null` when unlimited. */
  maxCostUsd: number | null;
  /** Retries after a failed call (`AI_MAX_RETRIES`); 0 disables retrying. */
  retries: number;
  /**
   * Image pre-flight preset in force (`IMAGE_QUALITY`: auto | max | economy),
   * when one is configured. Recorded verbatim: it changes the pixels sent, so
   * it changes what the finding was derived from.
   */
  imageQuality?: string;
}

export interface ManifestTotals {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedUsd: number;
  providerUsd?: number;
  images: number;
  imagesSucceeded: number;
  imagesFailed: number;
  series: number;
}

/**
 * Art. 14 human-oversight record. `required` is a constant `true`: no run of
 * this tool is ever cleared for use without a clinician, and `--reviewer`
 * records *who attested*, not that the output became clinically valid.
 */
export interface ManifestHumanReview {
  required: true;
  reviewedBy: null | { name: string; at: string };
}

/** The manifest before it is sealed with its own hash. */
export interface UnsealedRunManifest {
  manifestVersion: string;
  toolVersion: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  pricing: ManifestPricing;
  settings: ManifestSettings;
  /** Absolute input directory; `inputs[].path` and `contextFiles[].path` are relative to it. */
  inputDir: string;
  /** Absolute output directory; `outputs[].path` is relative to it. */
  outputDir: string;
  inputs: ManifestFileEntry[];
  contextFiles: ManifestFileEntry[];
  calls: ManifestCall[];
  outputs: ManifestFileEntry[];
  totals: ManifestTotals;
  exitCode: number;
  warnings: string[];
  humanReview: ManifestHumanReview;
  /** Hash of the previous run's manifest, or `null` for the first link. */
  prevManifestHash: string | null;
}

/** A sealed manifest: `manifestHash` covers the canonical JSON of every other field. */
export interface RunManifest extends UnsealedRunManifest {
  manifestHash: string;
}

/** One append-only ledger line (the chain file is JSON Lines). */
export interface ChainEntry {
  at: string;
  manifestHash: string;
  prevManifestHash: string | null;
  /** Absolute path of the manifest this entry seals. */
  manifest: string;
}

// ─── Canonicalisation and hashing ────────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped, arrays
 * left in order. Two structurally equal manifests must serialise byte-for-byte
 * identically or the hash is meaningless.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // Object keys are unique, so a two-way comparison is total. Code-unit
    // order (not locale collation) keeps the digest reproducible everywhere.
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 over the canonical JSON of everything except `manifestHash`. */
export function computeManifestHash(manifest: UnsealedRunManifest | RunManifest): string {
  const { ...rest } = manifest as RunManifest;
  delete (rest as Partial<RunManifest>).manifestHash;
  return sha256Hex(canonicalJson(rest));
}

/** Attach the manifest's own hash, making it a `RunManifest`. */
export function sealManifest(manifest: UnsealedRunManifest): RunManifest {
  return { ...manifest, manifestHash: computeManifestHash(manifest) };
}

/** `version` from a parsed package.json, or `"unknown"` when it is unusable. */
export function toolVersionFrom(pkg: unknown): string {
  const version = (pkg as { version?: unknown } | null | undefined)?.version;
  return typeof version === "string" && version.length > 0 ? version : "unknown";
}

// ─── File hashing ────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Content-address one file relative to `baseDir`. Returns `null` when the file
 * cannot be read — a manifest is best-effort evidence and must never abort the
 * run that produced it.
 */
export async function hashFileEntry(
  absPath: string,
  baseDir: string
): Promise<ManifestFileEntry | null> {
  try {
    const buf = await fs.readFile(absPath);
    return {
      path: toPosix(path.relative(baseDir, absPath)),
      sha256: sha256Hex(buf),
      bytes: buf.byteLength,
    };
  } catch {
    return null;
  }
}

/** Content-address many files, dropping the unreadable ones. */
export async function hashFileEntries(
  absPaths: readonly string[],
  baseDir: string
): Promise<ManifestFileEntry[]> {
  const out: ManifestFileEntry[] = [];
  for (const p of absPaths) {
    const entry = await hashFileEntry(p, baseDir);
    if (entry) out.push(entry);
  }
  return out;
}

// ─── Call ledger ─────────────────────────────────────────────────────────────

/**
 * Turns the cost meter's `onCall` stream into per-call manifest rows.
 *
 * The meter's own semantics are untouched: this is a listener the CLI hands to
 * the existing `onCall` hook, plus a stage label the CLI sets as the pipeline
 * moves between nodes. Per-call USD is the *delta* of the meter's cumulative
 * figure, so the ledger always re-sums to the run total.
 */
export class CallLedger {
  private readonly entries: ManifestCall[] = [];
  private stage: CallStage = "image";
  private pendingRetries = 0;
  private lastCumulativeUsd = 0;
  private lastProviderUsd = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Label subsequent calls with `stage`. Set at each pipeline node boundary. */
  setStage(stage: CallStage): void {
    this.stage = stage;
  }

  /** Count one retry attempt; it is attributed to the next recorded call. */
  noteRetry(): void {
    this.pendingRetries += 1;
  }

  /** Record one metered call. Wire as the `CostMeter`'s `onCall` listener. */
  record(info: CostCallInfo): void {
    const estimatedUsd = info.cumulativeUsd - this.lastCumulativeUsd;
    this.lastCumulativeUsd = info.cumulativeUsd;

    let providerUsd: number | undefined;
    if (info.providerReportedUsd !== undefined) {
      providerUsd = info.providerReportedUsd - this.lastProviderUsd;
      this.lastProviderUsd = info.providerReportedUsd;
    }

    this.entries.push({
      index: info.calls,
      stage: this.stage,
      timestamp: this.now().toISOString(),
      tokensIn: info.lastInputTokens,
      tokensOut: info.lastOutputTokens,
      estimatedUsd,
      ...(providerUsd !== undefined ? { providerUsd } : {}),
      retries: this.pendingRetries,
    });
    this.pendingRetries = 0;
  }

  /** The recorded calls, in meter order. */
  calls(): ManifestCall[] {
    return [...this.entries];
  }
}

/**
 * Wrap a {@link GeminiClient} so the ledger knows which pipeline stage each
 * metered call belongs to. Behaviour is pass-through: same arguments, same
 * return values, same errors — only the stage label is a side effect. Calls
 * inside one stage may run concurrently, but stages never overlap (the graph
 * fans in before the next node starts), so the label cannot be misattributed.
 */
export function withStageTracking(client: GeminiClient, ledger: CallLedger): GeminiClient {
  return {
    analyzeImage: (imagePath, seriesId) => {
      ledger.setStage("image");
      return client.analyzeImage(imagePath, seriesId);
    },
    synthesizeSeries: (seriesId, analyses, textContext) => {
      ledger.setStage("series");
      return client.synthesizeSeries(seriesId, analyses, textContext);
    },
    analyzeEvolution: (summaries, rootContext) => {
      ledger.setStage("evolution");
      return client.analyzeEvolution(summaries, rootContext);
    },
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Write `run_manifest.json` into `outputDir`; returns the path written. */
export async function writeManifest(outputDir: string, manifest: RunManifest): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, MANIFEST_FILENAME);
  await fs.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return target;
}

/** Read and parse `run_manifest.json` from `outputDir`; `null` when unusable. */
export async function readManifest(outputDir: string): Promise<RunManifest | null> {
  try {
    const raw = await fs.readFile(path.join(outputDir, MANIFEST_FILENAME), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as RunManifest;
  } catch {
    return null;
  }
}

/** Read the append-only chain file. A missing file is an empty chain. */
export async function readChain(chainFile: string): Promise<ChainEntry[] | null> {
  let raw: string;
  try {
    raw = await fs.readFile(chainFile, "utf-8");
  } catch {
    return [];
  }
  const entries: ChainEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line) as ChainEntry);
    } catch {
      return null; // a malformed line is itself a tampering signal
    }
  }
  return entries;
}

/** Hash of the most recent chain entry, or `null` for an empty/absent chain. */
export function chainHead(entries: readonly ChainEntry[]): string | null {
  const last = entries[entries.length - 1];
  return last ? last.manifestHash : null;
}

/** Append one link to the chain file, creating it (and its directory) if needed. */
export async function appendChain(chainFile: string, entry: ChainEntry): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(chainFile)), { recursive: true });
  await fs.appendFile(chainFile, `${JSON.stringify(entry)}\n`, "utf-8");
}

// ─── Verification ────────────────────────────────────────────────────────────

export type CheckStatus = "ok" | "fail" | "skip";

export interface VerifyCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  /** 0 when every check passed, 6 when the manifest is missing or tampered. */
  exitCode: 0 | 6;
  manifestPath: string;
  checks: VerifyCheck[];
  /** Rendered, human-readable report — the CLI prints this verbatim. */
  report: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Validate the chain links around `manifest`.
 *
 * Three independent properties are checked, because each fails differently:
 * the ledger is internally well-linked; the run appears in it; and the run's
 * own `prevManifestHash` agrees with its neighbour in the ledger.
 */
export function verifyChainLinks(
  entries: readonly ChainEntry[],
  manifest: RunManifest,
  recomputedHash: string
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];

  if (entries.length === 0) {
    checks.push({
      name: "chain",
      status: "fail",
      detail: "chain file is empty or absent — the run is not recorded in any ledger",
    });
    return checks;
  }

  const breaks: string[] = [];
  if (entries[0]!.prevManifestHash !== null) {
    breaks.push("entry 1 does not start the chain (prevManifestHash is not null)");
  }
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i]!.prevManifestHash !== entries[i - 1]!.manifestHash) {
      breaks.push(`entry ${i + 1} does not link to entry ${i}`);
    }
  }
  checks.push(
    breaks.length === 0
      ? { name: "chain linkage", status: "ok", detail: `${entries.length} link(s) intact` }
      : { name: "chain linkage", status: "fail", detail: breaks.join("; ") }
  );

  const index = entries.findIndex((e) => e.manifestHash === recomputedHash);
  if (index === -1) {
    checks.push({
      name: "chain membership",
      status: "fail",
      detail: `manifest hash ${recomputedHash.slice(0, 12)}… is not in the chain file`,
    });
    return checks;
  }
  checks.push({
    name: "chain membership",
    status: "ok",
    detail: `recorded as entry ${index + 1} of ${entries.length}`,
  });

  const expectedPrev = index === 0 ? null : entries[index - 1]!.manifestHash;
  const agrees =
    entries[index]!.prevManifestHash === manifest.prevManifestHash &&
    manifest.prevManifestHash === expectedPrev;
  checks.push(
    agrees
      ? {
          name: "chain predecessor",
          status: "ok",
          detail:
            expectedPrev === null
              ? "first run in the chain (prevManifestHash: null)"
              : `links to ${expectedPrev.slice(0, 12)}…`,
        }
      : {
          name: "chain predecessor",
          status: "fail",
          detail:
            `manifest records prevManifestHash ${String(manifest.prevManifestHash)}; ` +
            `chain expects ${String(expectedPrev)}`,
        }
  );

  return checks;
}

/** Re-hash the files a manifest references, relative to `baseDir`. */
async function verifyFileGroup(
  name: string,
  entries: readonly ManifestFileEntry[],
  baseDir: string
): Promise<VerifyCheck> {
  if (entries.length === 0) {
    return { name, status: "skip", detail: "none recorded" };
  }
  let matched = 0;
  let absent = 0;
  const mismatched: string[] = [];
  for (const entry of entries) {
    const abs = path.resolve(baseDir, entry.path);
    const current = await hashFileEntry(abs, baseDir);
    if (current === null) {
      absent += 1;
      continue;
    }
    if (current.sha256 === entry.sha256 && current.bytes === entry.bytes) matched += 1;
    else mismatched.push(entry.path);
  }
  const absentNote = absent > 0 ? `, ${absent} no longer present (skipped)` : "";
  return mismatched.length === 0
    ? {
        name,
        status: "ok",
        detail: `${matched}/${entries.length} re-hashed and identical${absentNote}`,
      }
    : {
        name,
        status: "fail",
        detail: `${mismatched.length} file(s) changed since the run: ${mismatched.join(", ")}${absentNote}`,
      };
}

function renderReport(manifestPath: string, checks: readonly VerifyCheck[], ok: boolean): string {
  const symbol: Record<CheckStatus, string> = { ok: "PASS", fail: "FAIL", skip: "SKIP" };
  const body = checks.map((c) => `  [${symbol[c.status]}] ${c.name}: ${c.detail}`).join("\n");
  return (
    `Verifying ${manifestPath}\n${body}\n\n` +
    (ok
      ? "Result: manifest intact (integrity verified, not clinical validity).\n"
      : "Result: VERIFICATION FAILED — manifest missing, altered, or unlinked.\n")
  );
}

export interface VerifyOptions {
  /** Optional chain file to validate the run's link against. */
  chainFile?: string;
}

/**
 * Re-hash a completed run and report whether its evidence still holds.
 *
 * Present files are re-hashed and compared; files that no longer exist are
 * reported and skipped, because inputs live outside the tool's control and
 * their deletion is not evidence of tampering with the record. A missing or
 * unparseable manifest, a hash that no longer matches its own content, a
 * changed file, or a broken chain link all fail with exit code 6.
 */
export async function verifyManifest(
  outputDir: string,
  options: VerifyOptions = {}
): Promise<VerifyResult> {
  const resolvedOut = path.resolve(outputDir);
  const manifestPath = path.join(resolvedOut, MANIFEST_FILENAME);
  const checks: VerifyCheck[] = [];

  const manifest = await readManifest(resolvedOut);
  if (manifest === null) {
    checks.push({
      name: "manifest",
      status: "fail",
      detail: "not found or not valid JSON",
    });
    return {
      ok: false,
      exitCode: 6,
      manifestPath,
      checks,
      report: renderReport(manifestPath, checks, false),
    };
  }

  if (typeof manifest.manifestHash !== "string" || !HEX64.test(manifest.manifestHash)) {
    checks.push({
      name: "manifest",
      status: "fail",
      detail: "manifestHash is missing or is not a SHA-256 hex digest",
    });
    return {
      ok: false,
      exitCode: 6,
      manifestPath,
      checks,
      report: renderReport(manifestPath, checks, false),
    };
  }

  checks.push({
    name: "manifest",
    status: "ok",
    detail: `schema ${String(manifest.manifestVersion)}, tool ${String(manifest.toolVersion)}, exit ${String(manifest.exitCode)}`,
  });

  const recomputed = computeManifestHash(manifest);
  checks.push(
    recomputed === manifest.manifestHash
      ? {
          name: "manifest hash",
          status: "ok",
          detail: `${recomputed.slice(0, 12)}… matches content`,
        }
      : {
          name: "manifest hash",
          status: "fail",
          detail: `recorded ${manifest.manifestHash.slice(0, 12)}…, recomputed ${recomputed.slice(0, 12)}…`,
        }
  );

  checks.push(
    await verifyFileGroup(
      "inputs",
      manifest.inputs ?? [],
      path.resolve(manifest.inputDir ?? resolvedOut)
    )
  );
  checks.push(
    await verifyFileGroup(
      "context files",
      manifest.contextFiles ?? [],
      path.resolve(manifest.inputDir ?? resolvedOut)
    )
  );
  checks.push(await verifyFileGroup("outputs", manifest.outputs ?? [], resolvedOut));

  checks.push({
    name: "human review",
    status: manifest.humanReview?.reviewedBy ? "ok" : "skip",
    detail: manifest.humanReview?.reviewedBy
      ? `attested by ${manifest.humanReview.reviewedBy.name} at ${manifest.humanReview.reviewedBy.at}`
      : "no reviewer attestation recorded (review is still required)",
  });

  if (options.chainFile !== undefined) {
    const entries = await readChain(options.chainFile);
    if (entries === null) {
      checks.push({
        name: "chain",
        status: "fail",
        detail: "chain file contains a malformed line",
      });
    } else {
      checks.push(...verifyChainLinks(entries, manifest, recomputed));
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return {
    ok,
    exitCode: ok ? 0 : 6,
    manifestPath,
    checks,
    report: renderReport(manifestPath, checks, ok),
  };
}
