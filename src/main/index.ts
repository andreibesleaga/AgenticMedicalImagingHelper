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
import { createRequire } from "module";
import { runAnalyze } from "./run-analyze.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const VERSION: string = pkg.version;

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
  .option("--max-cost-usd <n>", "Abort the run if estimated Gemini cost (USD) exceeds this cap")
  .action(async (inputDirArg: string, outputDirArg: string | undefined, opts: {
    series?: string[];
    concurrency: string;
    verbose: boolean;
    maxCostUsd?: string;
  }) => {
    const exitCode = await runAnalyze(inputDirArg, outputDirArg, opts);
    process.exit(exitCode);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(99);
});
