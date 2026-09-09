#!/usr/bin/env node
/**
 * AgenticMedicalImagingHelper — CLI Entry Point
 *
 * Usage:
 *   medical-imaging analyze [options] <inputDir> [outputDir]
 *   medical-imaging verify-manifest <outputDir> [--chain <file>]
 *
 * Options (analyze):
 *   -s, --series <ids...>     Only process specified series (space-separated ids)
 *   -c, --concurrency <n>     Max parallel model API calls (default: 5)
 *   -v, --verbose             Print progress to stderr
 *       --max-cost-usd <n>    Client-side cost cap (exit 5)
 *       --manifest-chain <f>  Append the run manifest's hash to a ledger file
 *       --reviewer <name>     Record a human-oversight attestation (Art. 14)
 *       --allow-phi           Acknowledge PHI-scan findings and continue
 *       --strict-phi          Refuse to upload anything if PHI is suspected (exit 7)
 *   -h, --help                Show help
 *       --version             Show version
 */

import "dotenv/config";
import { Command } from "commander";
import { createRequire } from "module";
import { runAnalyze, runVerifyManifest } from "./run-analyze.js";

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
  .option("-c, --concurrency <n>", "Max parallel model API calls", "5")
  .option("-v, --verbose", "Print progress information to stderr", false)
  .option("--max-cost-usd <n>", "Abort the run if estimated model cost (USD) exceeds this cap")
  .option(
    "--manifest-chain <file>",
    "Append-only ledger file: links this run's manifest hash to the previous run's"
  )
  .option("--reviewer <name>", "Record a human-oversight attestation in the run manifest")
  .option("--allow-phi", "Acknowledge PHI-scan findings in context files and continue", false)
  .option("--strict-phi", "Exit 7 before any upload if the PHI scan finds anything", false)
  .action(
    async (
      inputDirArg: string,
      outputDirArg: string | undefined,
      opts: {
        series?: string[];
        concurrency: string;
        verbose: boolean;
        maxCostUsd?: string;
        manifestChain?: string;
        reviewer?: string;
        allowPhi?: boolean;
        strictPhi?: boolean;
      }
    ) => {
      const exitCode = await runAnalyze(inputDirArg, outputDirArg, opts);
      process.exit(exitCode);
    }
  );

program
  .command("verify-manifest")
  .description("Re-hash a completed run and verify its manifest (and optionally its ledger link)")
  .argument("<outputDir>", "Output directory of the run to verify (contains run_manifest.json)")
  .option("--chain <file>", "Ledger file the run should be linked into")
  .action(async (outputDirArg: string, opts: { chain?: string }) => {
    const exitCode = await runVerifyManifest(outputDirArg, opts);
    process.exit(exitCode);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(99);
});
