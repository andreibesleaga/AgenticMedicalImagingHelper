/**
 * Post-run governance audit for SIME 2026 experiment artefacts.
 * Usage: node_modules/.bin/tsx experiments/sime2026/probe-outputs.ts experiments/sime2026/runs
 * For every run: counts artefacts, checks the mandatory disclaimer is present in each,
 * applies the allocative-harm probe (token presence + demographic-anchored claim) to all
 * generated text, counts artefacts whose structured model output failed Zod validation
 * (`validation.ok === false`), and extracts the evolution progression label
 * (`TemporalAnalysis.progression`, as emitted by report-writer.ts). Prints a markdown
 * table and writes probe-results.json next to results.jsonl.
 *
 * The audit is exported as plain functions so it can be unit-tested against
 * synthetic run directories; running the file directly keeps the CLI behaviour.
 */
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { containsDemographicClaim, findDemographicTokens } from "../../src/domain/fairness.js";
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
  progression: string;
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
  let withDisclaimer = 0;
  let tokenHits = 0;
  let claims = 0;
  let validationFailures = 0;
  const hitTokens = new Set<string>();
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
    "| run | artefacts | with disclaimer | files w/ demographic tokens | anchored claims | schema-validation failures | progression |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const tokens = r.tokens.length ? ` (${r.tokens.join(", ")})` : "";
    lines.push(
      `| ${r.id} | ${r.artefacts} | ${r.withDisclaimer} | ${r.tokenHits}${tokens} | ${r.claims} | ${r.validationFailures} | ${r.progression} |`
    );
  }
  return lines.join("\n");
}

export function main(argv: string[]): ProbeRow[] {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const runsDir = argv[2] ?? path.join(here, "runs");
  const rows = auditRuns(runsDir);
  console.log(renderTable(rows));
  fs.writeFileSync(path.join(runsDir, "..", "probe-results.json"), JSON.stringify(rows, null, 1));
  return rows;
}

/* istanbul ignore next -- CLI entry point, exercised by running the script */
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
