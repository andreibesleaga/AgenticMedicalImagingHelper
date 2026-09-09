/**
 * Post-run governance audit for the experiment pack's run artefacts.
 * Usage: node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts [<runs-dir>] [--out <file>]
 * For every run: counts artefacts, checks the mandatory disclaimer is present in each,
 * applies the allocative-harm probe (token presence + demographic-anchored claim) to all
 * generated text, counts artefacts whose structured model output failed Zod validation
 * (`validation.ok === false`), and extracts the evolution progression label
 * (`TemporalAnalysis.progression`, as emitted by report-writer.ts), and runs the
 * context-consistency probe: the run manifest names the input directory, so the
 * patient context is read back and every artefact is checked for age/sex
 * assertions that contradict it (a run without a manifest or without a context
 * file simply scores 0). Prints the markdown table to stdout and writes it to
 * `experiments/sime2026/probe-results.md`, alongside the machine-readable
 * `experiments/sime2026/probe-results.json`. Both are committed evidence;
 * `--out <file>` overrides the pair (the `.md` takes the same path with a
 * `.md` extension).
 *
 * The audit is exported as plain functions so it can be unit-tested against
 * synthetic run directories; running the file directly keeps the CLI behaviour.
 */
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { containsDemographicClaim, findDemographicTokens } from "../../src/domain/fairness.js";
import { findContextContradictions } from "../../src/domain/context-consistency.js";
import { DISCLAIMER } from "../../src/domain/types.js";

export interface ProbeRow {
  id: string;
  artefacts: number;
  withDisclaimer: number;
  tokenHits: number;
  tokens: string[];
  claims: number;
  /** Artefacts whose recorded `validation.ok` is false (schema fallback used). */
  validationFailures: number;
  /** Artefacts asserting an age or sex the supplied patient context contradicts. */
  contextContradictions: number;
  /** Distinct contradicting terms found, e.g. `["child", "his"]`. */
  contradictionTerms: string[];
  progression: string;
}

/** Name of the per-run provenance record written into every output directory. */
const MANIFEST_FILE = "run_manifest.json";

/** Context file the experiment cohorts place at the root of each patient's input. */
const DEFAULT_CONTEXT_FILE = "patient_context.txt";

/**
 * The operator-supplied context text for a run, read back through the manifest.
 *
 * `run_manifest.json` records the absolute `inputDir` and the context files it
 * hashed, so the audit can recover exactly what the model was told. Every step
 * is optional: a run without a manifest, without an `inputDir`, or whose inputs
 * have since moved yields `undefined` and scores no contradictions rather than
 * failing the audit.
 */
export function readRunContext(outputDir: string): string | undefined {
  let manifest: { inputDir?: unknown; contextFiles?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(outputDir, MANIFEST_FILE), "utf-8")) as {
      inputDir?: unknown;
      contextFiles?: unknown;
    };
  } catch {
    return undefined;
  }

  const inputDir = manifest.inputDir;
  if (typeof inputDir !== "string" || inputDir === "") return undefined;

  const recorded = Array.isArray(manifest.contextFiles)
    ? manifest.contextFiles
        .map((e) => (e as { path?: unknown } | null)?.path)
        .filter((p): p is string => typeof p === "string")
    : [];

  const texts: string[] = [];
  for (const rel of [...recorded, DEFAULT_CONTEXT_FILE]) {
    try {
      texts.push(fs.readFileSync(path.join(inputDir, rel), "utf-8"));
      break;
    } catch {
      /* absent or unreadable — try the next candidate */
    }
  }
  return texts.length > 0 ? texts[0] : undefined;
}

/** Every .json/.md artefact under a run's output directory, depth-first. */
function walk(dir: string, files: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, files);
    else if (/\.(json|md)$/.test(f)) files.push(p);
  }
  return files;
}

export function auditRun(id: string, outputDir: string): ProbeRow {
  const files = walk(outputDir);
  const contextText = readRunContext(outputDir);
  let withDisclaimer = 0;
  let tokenHits = 0;
  let claims = 0;
  let validationFailures = 0;
  let contextContradictions = 0;
  const hitTokens = new Set<string>();
  const contradictionTerms = new Set<string>();
  let progression = "";

  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    if (text.includes(DISCLAIMER)) withDisclaimer++;
    const toks = findDemographicTokens(text);
    if (toks.length) {
      tokenHits++;
      toks.forEach((t) => hitTokens.add(t));
    }
    if (containsDemographicClaim(text)) claims++;
    // The manifest itself is provenance, not generated text: it echoes the
    // input paths and any warning excerpts, so scanning it would double-count.
    if (path.basename(f) !== MANIFEST_FILE) {
      const contradictions = findContextContradictions(contextText, text);
      if (contradictions.length > 0) {
        contextContradictions++;
        contradictions.forEach((c) => contradictionTerms.add(c.term.toLowerCase()));
      }
    }
    if (f.endsWith(".json")) {
      try {
        const record = JSON.parse(text) as {
          progression?: string;
          validation?: { ok?: boolean };
        };
        if (record.validation?.ok === false) validationFailures++;
        if (f.endsWith("evolution_analysis.json")) progression = String(record.progression ?? "");
      } catch {
        /* not a record we can read — counted as an artefact only */
      }
    }
  }

  return {
    id,
    artefacts: files.length,
    withDisclaimer,
    tokenHits,
    tokens: [...hitTokens],
    claims,
    validationFailures,
    contextContradictions,
    contradictionTerms: [...contradictionTerms],
    progression,
  };
}

export function auditRuns(runsDir: string): ProbeRow[] {
  const rows: ProbeRow[] = [];
  for (const id of fs.readdirSync(runsDir).sort()) {
    const out = path.join(runsDir, id, "output");
    if (!fs.existsSync(out)) continue;
    rows.push(auditRun(id, out));
  }
  return rows;
}

export function renderTable(rows: ProbeRow[]): string {
  const lines = [
    "| run | artefacts | with disclaimer | files w/ demographic tokens | anchored claims | schema-validation failures | context contradictions | progression |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const tokens = r.tokens.length ? ` (${r.tokens.join(", ")})` : "";
    const terms = r.contradictionTerms.length ? ` (${r.contradictionTerms.join(", ")})` : "";
    lines.push(
      `| ${r.id} | ${r.artefacts} | ${r.withDisclaimer} | ${r.tokenHits}${tokens} | ${r.claims} | ${r.validationFailures} | ${r.contextContradictions}${terms} | ${r.progression} |`
    );
  }
  return lines.join("\n");
}

export const USAGE =
  "Usage: probe-outputs.ts [<runs-dir>] [--out <file>]\n" +
  "\n" +
  "  <runs-dir>   directory of run outputs to audit (default experiments/sime2026/runs)\n" +
  "  --out <file> JSON report path (default experiments/sime2026/probe-results.json).\n" +
  "               The markdown table is written next to it with a .md extension\n" +
  "               (default experiments/sime2026/probe-results.md). Both are the\n" +
  "               committed evidence for the governance probe.";

/** Parses the CLI arguments after `node script.ts`. */
export function parseArgs(args: string[], here: string): { runsDir: string; outPath: string } {
  let runsDir: string | undefined;
  let outPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = path.resolve(args[i + 1]!);
      i++;
    } else if (!args[i]!.startsWith("--") && runsDir === undefined) {
      runsDir = path.resolve(args[i]!);
    }
  }
  return {
    runsDir: runsDir ?? path.join(here, "runs"),
    outPath: outPath ?? path.join(here, "probe-results.json"),
  };
}

/** Companion markdown path for a JSON report path (`x.json` -> `x.md`). */
export function markdownPathFor(jsonPath: string): string {
  return jsonPath.replace(/\.json$/i, "") + ".md";
}

export function main(argv: string[]): ProbeRow[] {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const { runsDir, outPath } = parseArgs(argv.slice(2), here);
  const rows = auditRuns(runsDir);
  const table = renderTable(rows);
  console.log(table);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 1));
  fs.writeFileSync(markdownPathFor(outPath), `${table}\n`);
  return rows;
}

/* istanbul ignore next -- CLI entry point, exercised by running the script */
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
  } else {
    main(process.argv);
  }
}
