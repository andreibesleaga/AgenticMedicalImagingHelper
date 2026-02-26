#!/usr/bin/env node
/**
 * AgenticMedicalImagingHelper — CLI Entry Point
 *
 * Usage:
 *   medical-imaging analyze [options] <inputDir> [outputDir]
 *
 * Options:
 *   -s, --series <ids...>     Only process specified series (comma-separated)
 *   -c, --concurrency <n>     Max parallel Gemini API calls (default: 5)
 *   -v, --verbose             Print progress to stderr
 *   -h, --help                Show help
 *       --version             Show version
 */

import "dotenv/config";
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import { createRequire } from "module";
import { MissingApiKeyError, FileScanError } from "../domain/errors.js";
import { scanInputDirectory } from "../infrastructure/file-scanner.js";
import { createGeminiClient, createGeminiModelFromSdk } from "../infrastructure/gemini-client.js";
import { writeReports } from "../infrastructure/report-writer.js";
import { runMedicalImagingAgent } from "../adapters/langgraph-agent.js";
import type { AnalyzeOptions } from "../domain/types.js";

// ─── Version ─────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const VERSION: string = pkg.version;

// ─── CLI Definition ───────────────────────────────────────────────────────────

const program = new Command();

program
  .name("medical-imaging")
  .description("AI-powered medical image analysis with temporal evolution tracking")
  .version(VERSION);

program
  .command("analyze")
  .description("Analyze medical images from an input directory")
  .argument("<inputDir>", "Path to the input directory containing series sub-folders")
  .argument("[outputDir]", "Path to the output directory (default: ./output)")
  .option("-s, --series <ids...>", "Only process specified series IDs")
  .option("-c, --concurrency <n>", "Max parallel Gemini API calls", "5")
  .option("-v, --verbose", "Print progress information to stderr", false)
  .action(async (inputDirArg: string, outputDirArg: string | undefined, opts: {
    series?: string[];
    concurrency: string;
    verbose: boolean;
  }) => {
    const exitCode = await runAnalyze(inputDirArg, outputDirArg, opts);
    process.exit(exitCode);
  });

// ─── Analyze Command Handler ──────────────────────────────────────────────────

async function runAnalyze(
  inputDirArg: string,
  outputDirArg: string | undefined,
  opts: { series?: string[]; concurrency: string; verbose: boolean }
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

  // ── 1. Validate API key ────────────────────────────────────────────────
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "Error: GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable is not set.\n" +
        "Set it in your .env file or export it before running.\n"
    );
    return 1;
  }

  // ── 2. Scan input directory ────────────────────────────────────────────
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

  // ── 3. Read optional root-level context file ───────────────────────────
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

  // ── 4. Initialize Gemini client ────────────────────────────────────────
  let geminiClient;
  try {
    const model = createGeminiModelFromSdk(apiKey, "gemini-2.5-pro");
    geminiClient = createGeminiClient(model);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  // ── 5. Run LangGraph agent ─────────────────────────────────────────────
  log("Starting agentic analysis pipeline...");
  const finalState = await runMedicalImagingAgent(
    inputDir,
    outputDir,
    series,
    geminiClient,
    options
  );

  // Inject root context into state extension for evolution analysis
  if (rootContextText) {
    (finalState as typeof finalState & { rootContextText?: string }).rootContextText =
      rootContextText;
  }

  // ── 6. Write reports ────────────────────────────────────────────────────
  log("Writing reports to output directory...");
  const reportPaths = await writeReports(finalState);
  finalState.reportPaths = reportPaths;

  // ── 7. Print summary ────────────────────────────────────────────────────
  const successCount = finalState.imageResults.filter((r) => r.status === "success").length;
  const failCount = finalState.imageResults.filter((r) => r.status === "error").length;

  process.stdout.write(
    `\nAnalysis complete!\n` +
      `  Series processed:  ${finalState.seriesResults.length}\n` +
      `  Images analyzed:   ${successCount} success, ${failCount} failed\n` +
      `  Reports written:   ${reportPaths.length} files\n` +
      `  Output directory:  ${outputDir}\n`
  );

  if (failCount > 0) {
    process.stderr.write(
      `Warning: ${failCount} image(s) failed to analyze. Check individual JSON files for details.\n`
    );
  }

  return failCount > 0 ? 4 : 0;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(99);
});
