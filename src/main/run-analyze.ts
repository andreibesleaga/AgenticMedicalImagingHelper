/**
 * Pure analyze command handler — extracted from index.ts so tests can call it
 * directly without triggering commander's CLI parsing side effects.
 */
import * as path from "path";
import * as fs from "fs/promises";
import { MissingApiKeyError, FileScanError } from "../domain/errors.js";
import { scanInputDirectory } from "../infrastructure/file-scanner.js";
import { createGeminiClient, createGeminiModelFromSdk } from "../infrastructure/gemini-client.js";
import { CostMeter, CostCapExceededError } from "../infrastructure/cost-meter.js";
import { writeReports } from "../infrastructure/report-writer.js";
import { runMedicalImagingAgent } from "../adapters/langgraph-agent.js";
import type { AnalyzeOptions } from "../domain/types.js";

export interface RunAnalyzeOpts {
  series?: string[];
  concurrency: string;
  verbose: boolean;
  /** Optional client-side cost cap (USD). Absent ⇒ unlimited (default behavior). */
  maxCostUsd?: string;
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

  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const apiAIModel = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";

  if (!apiKey) {
    process.stderr.write(
      "Error: GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable is not set.\n" +
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

  let rootContextText: string | undefined;
  try {
    const rootTxtFiles = (await fs.readdir(inputDir))
      .filter((f) => f.endsWith(".txt"))
      .sort();
    if (rootTxtFiles[0]) {
      rootContextText = await fs.readFile(
        path.join(inputDir, rootTxtFiles[0]),
        "utf-8"
      );
      log(`Root context file loaded: ${rootTxtFiles[0]}`);
    }
  } catch {
    // Non-critical — proceed without root context
  }

  // Meter is attached only when a cap is set or verbose logging is on; otherwise
  // the client is created exactly as before (default path is byte-identical).
  const meter =
    maxCostUsd !== undefined || options.verbose
      ? new CostMeter(maxCostUsd, undefined, (info) =>
          log(
            `Gemini call ${info.calls}: +${info.lastInputTokens} in / ${info.lastOutputTokens} out tokens, ` +
              `est. cumulative $${info.cumulativeUsd.toFixed(4)}`
          )
        )
      : undefined;

  let geminiClient;
  try {
    const model = createGeminiModelFromSdk(apiKey, apiAIModel);
    geminiClient = createGeminiClient(model, meter);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  log("Starting agentic analysis pipeline...");
  let finalState;
  try {
    finalState = await runMedicalImagingAgent(
      inputDir,
      outputDir,
      series,
      geminiClient,
      options,
      rootContextText
    );
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      process.stderr.write(`\n${err.message}\n`);
      return 5;
    }
    throw err;
  }

  log("Writing reports to output directory...");
  const reportPaths = await writeReports(finalState);
  finalState.reportPaths = reportPaths;

  const successCount = finalState.imageResults.filter((r) => r.status === "success").length;
  const failCount = finalState.imageResults.filter((r) => r.status === "error").length;

  process.stdout.write(
    `\nAnalysis complete!\n` +
      `  Series processed:  ${finalState.seriesResults.length}\n` +
      `  Images analyzed:   ${successCount} success, ${failCount} failed\n` +
      `  Reports written:   ${reportPaths.length} files\n` +
      `  Output directory:  ${outputDir}\n`
  );

  if (meter) {
    const c = meter.summary();
    log(
      `Estimated Gemini cost: $${c.estimatedUsd.toFixed(4)} over ${c.calls} call(s) ` +
        `(${c.inputTokens} in / ${c.outputTokens} out tokens; estimate only — provider invoice is authoritative)`
    );
  }

  if (failCount > 0) {
    process.stderr.write(
      `Warning: ${failCount} image(s) failed to analyze. Check individual JSON files for details.\n`
    );
  }

  return failCount > 0 ? 4 : 0;
}
