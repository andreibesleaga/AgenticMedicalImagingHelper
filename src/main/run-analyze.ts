/**
 * Pure analyze command handler — extracted from index.ts so tests can call it
 * directly without triggering commander's CLI parsing side effects.
 *
 * Governance controls wired here (all pre-flight, all before any upload):
 * a PHI/PII scan of the user's context files, a per-run hash-sealed manifest
 * (`run_manifest.json`) optionally linked into an append-only ledger, and the
 * `--reviewer` human-oversight attestation. See
 * `docs/architecture/decisions/ADR-007-run-manifest-audit-ledger.md`.
 */
import * as path from "path";
import * as fs from "fs/promises";
import { createRequire } from "module";
import { MissingApiKeyError, FileScanError } from "../domain/errors.js";
import { scanInputDirectory } from "../infrastructure/file-scanner.js";
import { createGeminiClient, createGeminiModelFromSdk } from "../infrastructure/gemini-client.js";
import {
  createOpenRouterClient,
  DEFAULT_OPENROUTER_MODEL,
} from "../infrastructure/openrouter-client.js";
import {
  CostMeter,
  CostCapExceededError,
  defaultGeminiPricing,
} from "../infrastructure/cost-meter.js";
import { resolveMaxRetries, type RetryOptions } from "../infrastructure/retry.js";
import { writeReports } from "../infrastructure/report-writer.js";
import {
  CallLedger,
  MANIFEST_VERSION,
  appendChain,
  chainHead,
  hashFileEntries,
  readChain,
  sealManifest,
  toolVersionFrom,
  verifyManifest,
  withStageTracking,
  writeManifest,
  type ManifestSettings,
  type UnsealedRunManifest,
} from "../infrastructure/run-manifest.js";
import {
  countPhiFindings,
  formatPhiWarnings,
  phiCategories,
  scanContextFilesForPhi,
} from "../domain/phi-scan.js";
import { runMedicalImagingAgent } from "../adapters/langgraph-agent.js";
import type { AnalyzeOptions, ImageAnalysis } from "../domain/types.js";

const require = createRequire(import.meta.url);

/** Tool version stamped into every manifest; `"unknown"` if package.json is unreadable. */
function toolVersion(): string {
  try {
    return toolVersionFrom(require("../../package.json"));
  } catch {
    return "unknown";
  }
}

export interface RunAnalyzeOpts {
  series?: string[];
  concurrency: string;
  verbose: boolean;
  /** Optional client-side cost cap (USD). Absent ⇒ unlimited (default behavior). */
  maxCostUsd?: string;
  /** Append-only ledger file linking this run to the previous run's manifest hash. */
  manifestChain?: string;
  /** Name recorded as the human-oversight attestation (Art. 14). No clinical effect. */
  reviewer?: string;
  /** Acknowledge PHI-scan findings and continue (they are still recorded). */
  allowPhi?: boolean;
  /** Refuse to upload anything when the PHI scan finds something (exit 7). */
  strictPhi?: boolean;
}

export async function runAnalyze(
  inputDirArg: string,
  outputDirArg: string | undefined,
  opts: RunAnalyzeOpts
): Promise<number> {
  const inputDir = path.resolve(inputDirArg);
  const outputDir = path.resolve(outputDirArg ?? "output");

  const options: AnalyzeOptions = {
    series: opts.series,
    concurrency: Math.max(1, parseInt(opts.concurrency, 10) || 5),
    verbose: opts.verbose,
  };

  const log = (msg: string) => {
    if (options.verbose) process.stderr.write(`[medical-imaging] ${msg}\n`);
  };

  // Optional client-side cost cap. Absent ⇒ unlimited (behavior unchanged).
  let maxCostUsd: number | undefined;
  if (opts.maxCostUsd !== undefined && opts.maxCostUsd !== "") {
    const parsed = Number(opts.maxCostUsd);
    if (!Number.isFinite(parsed) || parsed < 0) {
      process.stderr.write(
        `Error: --max-cost-usd must be a non-negative number (got "${opts.maxCostUsd}").\n`
      );
      return 1;
    }
    maxCostUsd = parsed;
  }

  // Provider selection (ADR-006): Google Gemini is the default; OpenRouter is an
  // opt-in second provider behind the same port, used to test the single-model
  // monoculture risk named in ADR-004. Any other value is a configuration error.
  const provider = (process.env.AI_PROVIDER ?? "google").trim().toLowerCase();
  if (provider !== "google" && provider !== "openrouter") {
    process.stderr.write(
      `Error: AI_PROVIDER must be "google" (default) or "openrouter" (got "${provider}").\n`
    );
    return 1;
  }
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "Gemini";

  const apiKey =
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY);
  // gemini-2.5-pro was retired for new API keys in 2026 (HTTP 404); flash is the
  // cheapest generally-available multimodal model and the one used in the SIME 2026 paper.
  const apiAIModel =
    provider === "openrouter"
      ? (process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL)
      : (process.env.GEMINI_MODEL ?? "gemini-2.5-flash");

  if (!apiKey) {
    process.stderr.write(
      provider === "openrouter"
        ? "Error: OPENROUTER_API_KEY environment variable is not set (AI_PROVIDER=openrouter).\n" +
            "Set it in your .env file or export it before running.\n"
        : "Error: GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable is not set.\n" +
            "Set it in your .env file or export it before running.\n"
    );
    return 1;
  }

  log(`Scanning input directory: ${inputDir}`);
  let series;
  try {
    series = await scanInputDirectory(inputDir, options.series);
  } catch (err) {
    if (err instanceof FileScanError) {
      process.stderr.write(`Error scanning input: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  if (series.length === 0) {
    process.stderr.write(
      `No image series found in: ${inputDir}\n` +
        "Ensure sub-directories exist with .png/.jpg/.jpeg images.\n"
    );
    return 3;
  }

  const totalImages = series.reduce((n, s) => n + s.imagePaths.length, 0);
  log(`Found ${series.length} series with ${totalImages} images total`);

  // ── Context files: read once, used for the prompt and for the PHI scan ──────
  const contextFiles: Array<{ abs: string; rel: string; text: string }> = [];

  let rootContextText: string | undefined;
  let rootContextPath: string | undefined;
  try {
    const rootTxtFiles = (await fs.readdir(inputDir)).filter((f) => f.endsWith(".txt")).sort();
    if (rootTxtFiles[0]) {
      rootContextPath = path.join(inputDir, rootTxtFiles[0]);
      rootContextText = await fs.readFile(rootContextPath, "utf-8");
      log(`Root context file loaded: ${rootTxtFiles[0]}`);
      contextFiles.push({
        abs: rootContextPath,
        rel: path.relative(inputDir, rootContextPath),
        text: rootContextText,
      });
    }
  } catch {
    // Non-critical — proceed without root context
  }

  for (const s of series) {
    if (!s.textContextPath) continue;
    try {
      contextFiles.push({
        abs: s.textContextPath,
        rel: path.relative(inputDir, s.textContextPath),
        text: await fs.readFile(s.textContextPath, "utf-8"),
      });
    } catch {
      // A context file that cannot be read is already handled downstream; the
      // scan simply has nothing to look at.
    }
  }

  // ── PHI / PII pre-flight (HIPAA §164.514(b), GDPR Art. 9) ──────────────────
  // Heuristic, and honest about it: a clean scan means "nothing obvious", not
  // "de-identified". Findings carry masked excerpts only, so the warning cannot
  // itself become a disclosure — that is why they are safe to print and persist.
  const warnings: string[] = [];
  const phiFiles = scanContextFilesForPhi(contextFiles.map((f) => ({ path: f.rel, text: f.text })));
  if (phiFiles.length > 0) {
    const total = countPhiFindings(phiFiles);
    const headline =
      `PHI-scan: ${total} possible identifier(s) in ${phiFiles.length} context file(s) ` +
      `[${phiCategories(phiFiles).join(", ")}]. These are heuristics, not proof.`;
    const detail = formatPhiWarnings(phiFiles);
    warnings.push(headline, ...detail);

    if (opts.strictPhi) {
      process.stderr.write(
        `Error: ${headline}\n${detail.map((d) => `  ${d}\n`).join("")}` +
          "--strict-phi is set: refusing to upload anything. De-identify the context files, " +
          "or re-run with --allow-phi if these are false positives.\n"
      );
      return 7;
    }

    process.stderr.write(
      `Warning: ${headline}\n${detail.map((d) => `  ${d}\n`).join("")}` +
        (opts.allowPhi
          ? "--allow-phi is set: continuing. The findings are recorded in run_manifest.json.\n"
          : "Continuing (use --strict-phi to make this fatal, --allow-phi to acknowledge it). " +
            "The findings are recorded in run_manifest.json.\n")
    );
    if (opts.allowPhi) warnings.push("PHI findings acknowledged with --allow-phi.");
  }

  // Meter is always attached now: it is the only source of the per-call token
  // and cost rows the manifest needs (Art. 12). Its cap semantics are unchanged
  // — `maxCostUsd === undefined` still means "never throws" — and the verbose
  // line is still gated on --verbose.
  //
  // OpenRouter ids are "vendor/model"; a Google model routed through OpenRouter
  // ("google/gemini-2.5-flash") still maps to the published Gemini rate, anything
  // else falls back to the conservative rate. For OpenRouter the estimate is
  // secondary: the provider-reported `usage.cost` is the figure that matters.
  const pricing = defaultGeminiPricing(
    provider === "openrouter" ? apiAIModel.replace(/^google\//, "") : apiAIModel
  );
  const ledger = new CallLedger();
  const meter = new CostMeter(maxCostUsd, pricing, (info) => {
    ledger.record(info);
    log(
      `${providerLabel} call ${info.calls}: +${info.lastInputTokens} in / ${info.lastOutputTokens} out tokens, ` +
        `est. cumulative $${info.cumulativeUsd.toFixed(4)}` +
        (info.providerReportedUsd !== undefined
          ? ` (provider-reported $${info.providerReportedUsd.toFixed(4)})`
          : "")
    );
  });

  // Transient failures (429 rate limits, 5xx, dropped connections) are retried
  // with jittered exponential backoff; see src/infrastructure/retry.ts. Attempts
  // are reported on the existing --verbose channel so a long batch shows why it
  // paused, and counted into the manifest's per-call `retries`.
  // Configure with AI_MAX_RETRIES (0 disables).
  const retry: RetryOptions = {
    onRetry: (info) => {
      ledger.noteRetry();
      log(
        `${providerLabel} call failed (attempt ${info.attempt}/${info.maxAttempts}` +
          (info.status !== undefined ? `, HTTP ${info.status}` : "") +
          `): ${String((info.error as Error)?.message ?? info.error).slice(0, 200)} — ` +
          `retrying in ${info.delayMs} ms` +
          (info.hintMs !== undefined ? ` (server asked for ${info.hintMs} ms)` : "")
      );
    },
  };

  let geminiClient;
  try {
    geminiClient =
      provider === "openrouter"
        ? createOpenRouterClient(apiKey, apiAIModel, meter, undefined, { retry })
        : createGeminiClient(createGeminiModelFromSdk(apiKey, apiAIModel), meter, { retry });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  // ── The run is admitted here: from this point every exit path writes a
  //    manifest, including the failing ones. Everything above is a pre-flight
  //    rejection that produced no output and must leave no output directory.
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let thrown: unknown;
  let reportPaths: string[] = [];
  let imageResults: ImageAnalysis[] = [];
  let seriesCount = 0;

  try {
    log("Starting agentic analysis pipeline...");
    const finalState = await runMedicalImagingAgent(
      inputDir,
      outputDir,
      series,
      withStageTracking(geminiClient, ledger),
      options,
      rootContextText
    );

    log("Writing reports to output directory...");
    reportPaths = await writeReports(finalState);
    finalState.reportPaths = reportPaths;
    imageResults = finalState.imageResults;
    seriesCount = finalState.seriesResults.length;

    const successCount = imageResults.filter((r) => r.status === "success").length;
    const failCount = imageResults.filter((r) => r.status === "error").length;

    process.stdout.write(
      `\nAnalysis complete!\n` +
        `  Series processed:  ${seriesCount}\n` +
        `  Images analyzed:   ${successCount} success, ${failCount} failed\n` +
        `  Reports written:   ${reportPaths.length} files\n` +
        `  Provider / model:  ${provider} / ${apiAIModel}\n` +
        `  Output directory:  ${outputDir}\n`
    );

    const c = meter.summary();
    log(
      `Estimated ${providerLabel} cost: $${c.estimatedUsd.toFixed(4)} over ${c.calls} call(s) ` +
        `(${c.inputTokens} in / ${c.outputTokens} out tokens incl. thinking; provider ${provider}, model ${apiAIModel} at ` +
        `$${pricing.inputUsdPerMillion}/$${pricing.outputUsdPerMillion} per 1M; estimate only — provider invoice is authoritative` +
        (c.providerReportedUsd !== undefined
          ? `; provider-reported $${c.providerReportedUsd.toFixed(4)}`
          : "") +
        `)`
    );

    if (failCount > 0) {
      const msg = `${failCount} image(s) failed to analyze. Check individual JSON files for details.`;
      process.stderr.write(`Warning: ${msg}\n`);
      warnings.push(msg);
    }

    exitCode = failCount > 0 ? 4 : 0;
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      process.stderr.write(`\n${err.message}\n`);
      warnings.push(err.message);
      exitCode = 5;
    } else {
      warnings.push(`Run aborted: ${err instanceof Error ? err.message : String(err)}`);
      exitCode = 99;
      thrown = err;
    }
  }

  // Best-effort by construction: a manifest that cannot be written is a
  // degraded audit trail, never a changed exit code and never a swallowed error.
  try {
    const written = await recordRunManifest({
      inputDir,
      outputDir,
      startedAt,
      provider,
      model: apiAIModel,
      pricing,
      settings: {
        concurrency: options.concurrency,
        maxCostUsd: maxCostUsd ?? null,
        retries: resolveMaxRetries(),
        ...(process.env.IMAGE_QUALITY ? { imageQuality: process.env.IMAGE_QUALITY } : {}),
      },
      imagePaths: series.flatMap((s) => s.imagePaths),
      contextPaths: contextFiles.map((f) => f.abs),
      calls: ledger.calls(),
      totals: meter.summary(),
      reportPaths,
      imageResults,
      seriesCount,
      exitCode,
      warnings,
      reviewer: opts.reviewer,
      chainFile: opts.manifestChain,
    });
    log(`Run manifest written: ${written}`);
  } catch (err) {
    process.stderr.write(
      `Warning: could not write the run manifest (${err instanceof Error ? err.message : String(err)}). ` +
        "The analysis itself is unaffected.\n"
    );
  }

  if (thrown !== undefined) throw thrown;
  return exitCode;
}

interface RecordManifestArgs {
  inputDir: string;
  outputDir: string;
  startedAt: string;
  provider: string;
  model: string;
  pricing: { inputUsdPerMillion: number; outputUsdPerMillion: number };
  settings: ManifestSettings;
  imagePaths: string[];
  contextPaths: string[];
  calls: UnsealedRunManifest["calls"];
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    providerReportedUsd?: number;
  };
  reportPaths: string[];
  imageResults: ImageAnalysis[];
  seriesCount: number;
  exitCode: number;
  warnings: string[];
  reviewer?: string;
  chainFile?: string;
}

/**
 * Assemble, seal and persist the run manifest, and append it to the ledger.
 *
 * The chain link is read *here*, not at run start, so that two runs sharing a
 * ledger cannot both claim the same predecessor.
 */
async function recordRunManifest(args: RecordManifestArgs): Promise<string> {
  const chainFile = args.chainFile ? path.resolve(args.chainFile) : undefined;
  const existing = chainFile ? await readChain(chainFile) : null;
  const prevManifestHash = existing ? chainHead(existing) : null;

  const finishedAt = new Date().toISOString();
  const succeeded = args.imageResults.filter((r) => r.status === "success").length;
  const failed = args.imageResults.filter((r) => r.status === "error").length;

  const unsealed: UnsealedRunManifest = {
    manifestVersion: MANIFEST_VERSION,
    toolVersion: toolVersion(),
    startedAt: args.startedAt,
    finishedAt,
    provider: args.provider,
    model: args.model,
    pricing: args.pricing,
    settings: args.settings,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    inputs: await hashFileEntries(args.imagePaths, args.inputDir),
    contextFiles: await hashFileEntries(args.contextPaths, args.inputDir),
    calls: args.calls,
    outputs: await hashFileEntries(args.reportPaths, args.outputDir),
    totals: {
      calls: args.totals.calls,
      tokensIn: args.totals.inputTokens,
      tokensOut: args.totals.outputTokens,
      estimatedUsd: args.totals.estimatedUsd,
      ...(args.totals.providerReportedUsd !== undefined
        ? { providerUsd: args.totals.providerReportedUsd }
        : {}),
      images: args.imagePaths.length,
      imagesSucceeded: succeeded,
      imagesFailed: failed,
      series: args.seriesCount,
    },
    exitCode: args.exitCode,
    warnings: args.warnings,
    humanReview: {
      required: true,
      reviewedBy: args.reviewer ? { name: args.reviewer, at: finishedAt } : null,
    },
    prevManifestHash,
  };

  const manifest = sealManifest(unsealed);
  const manifestPath = await writeManifest(args.outputDir, manifest);

  if (chainFile) {
    await appendChain(chainFile, {
      at: finishedAt,
      manifestHash: manifest.manifestHash,
      prevManifestHash: manifest.prevManifestHash,
      manifest: manifestPath,
    });
  }

  return manifestPath;
}

export interface RunVerifyManifestOpts {
  /** Ledger file the run should be linked into. */
  chain?: string;
}

/**
 * `medical-imaging verify-manifest <outputDir> [--chain <file>]`.
 *
 * Re-hashes the run's manifest, the input/output files it still can see, and
 * the chain link. Exit 0 when everything checks out, 6 when the manifest is
 * missing, unparseable, altered, or unlinked.
 */
export async function runVerifyManifest(
  outputDirArg: string,
  opts: RunVerifyManifestOpts = {}
): Promise<number> {
  const result = await verifyManifest(
    path.resolve(outputDirArg),
    opts.chain ? { chainFile: path.resolve(opts.chain) } : {}
  );
  process.stdout.write(result.report);
  return result.exitCode;
}
