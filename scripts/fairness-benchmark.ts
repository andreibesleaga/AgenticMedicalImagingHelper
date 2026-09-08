/**
 * Experiment E1 — labelled benchmark for the deterministic allocative-harm
 * probe in src/domain/fairness.ts.
 *
 * Usage: node_modules/.bin/tsx scripts/fairness-benchmark.ts
 *
 * Loads tests/fixtures/fairness-benchmark.json, runs containsDemographicClaim
 * (and findDemographicTokens for token-presence statistics) over every item,
 * prints a markdown report to stdout and writes the same report to
 * experiments/sime2026/E1-fairness-benchmark-results.md.
 *
 * The probe itself is NOT modified here; the benchmark measures it as-is.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import { containsDemographicClaim, findDemographicTokens } from "../src/domain/fairness.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "fairness-benchmark.json");
const OUT_DIR = path.join(ROOT, "experiments", "sime2026");
const OUT_FILE = path.join(OUT_DIR, "E1-fairness-benchmark-results.md");

const CATEGORIES = ["explicit", "paraphrase", "implicit", "benign", "negation", "trap"] as const;
type Category = (typeof CATEGORIES)[number];

interface BenchmarkItem {
  id: string;
  category: Category;
  text: string;
  expected: boolean;
  note: string;
}

interface Counts {
  n: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  withToken: number;
}

interface Scored extends BenchmarkItem {
  predicted: boolean;
  tokens: string[];
}

function emptyCounts(): Counts {
  return { n: 0, tp: 0, fp: 0, tn: 0, fn: 0, withToken: 0 };
}

function tally(into: Counts, s: Scored): void {
  into.n++;
  if (s.tokens.length > 0) into.withToken++;
  if (s.expected && s.predicted) into.tp++;
  else if (!s.expected && s.predicted) into.fp++;
  else if (!s.expected && !s.predicted) into.tn++;
  else into.fn++;
}

function ratio(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function fmt(x: number): string {
  return x.toFixed(3);
}

function loadItems(): BenchmarkItem[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { items: BenchmarkItem[] };
  return raw.items;
}

function score(items: BenchmarkItem[]): Scored[] {
  return items.map((it) => ({
    ...it,
    predicted: containsDemographicClaim(it.text),
    tokens: findDemographicTokens(it.text),
  }));
}

function buildReport(scored: Scored[], dateIso: string): string {
  const perCat = new Map<Category, Counts>();
  for (const c of CATEGORIES) perCat.set(c, emptyCounts());
  const overall = emptyCounts();
  for (const s of scored) {
    tally(perCat.get(s.category)!, s);
    tally(overall, s);
  }

  const precision = ratio(overall.tp, overall.tp + overall.fp);
  const recall = ratio(overall.tp, overall.tp + overall.fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  const positives = overall.tp + overall.fn;
  const negatives = overall.tn + overall.fp;

  const lines: string[] = [];
  lines.push("# E1 — Fairness probe labelled benchmark");
  lines.push("");
  lines.push(`Date: ${dateIso}`);
  lines.push("");
  lines.push(
    "Probe under test: `containsDemographicClaim` in `src/domain/fairness.ts` " +
      "(listed demographic token AND listed diagnostic justifier within a 200-character window). " +
      "Token-presence statistics use `findDemographicTokens`."
  );
  lines.push("");
  lines.push(
    `Benchmark: \`tests/fixtures/fairness-benchmark.json\`, ${scored.length} synthetic items.`
  );
  lines.push("");
  lines.push("## Per-category results");
  lines.push("");
  lines.push("| Category | Expected | n | With listed token | TP | FP | TN | FN | Category rate |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const c of CATEGORIES) {
    const k = perCat.get(c)!;
    const expected = c === "explicit" || c === "paraphrase" || c === "implicit";
    const rate = expected
      ? `recall ${fmt(ratio(k.tp, k.tp + k.fn))}`
      : `FP rate ${fmt(ratio(k.fp, k.fp + k.tn))}`;
    lines.push(
      `| ${c} | ${expected} | ${k.n} | ${k.withToken} | ${k.tp} | ${k.fp} | ${k.tn} | ${k.fn} | ${rate} |`
    );
  }
  lines.push(
    `| **overall** | — | ${overall.n} | ${overall.withToken} | ${overall.tp} | ${overall.fp} | ${overall.tn} | ${overall.fn} | — |`
  );
  lines.push("");
  lines.push("## Overall metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Positives (expected true) | ${positives} |`);
  lines.push(`| Negatives (expected false) | ${negatives} |`);
  lines.push(`| Precision | ${fmt(precision)} |`);
  lines.push(`| Recall | ${fmt(recall)} |`);
  lines.push(`| F1 | ${fmt(f1)} |`);
  lines.push(`| Specificity | ${fmt(ratio(overall.tn, overall.tn + overall.fp))} |`);
  lines.push(`| Accuracy | ${fmt(ratio(overall.tp + overall.tn, overall.n))} |`);
  lines.push("");

  const fns = scored.filter((s) => s.expected && !s.predicted);
  const fps = scored.filter((s) => !s.expected && s.predicted);

  lines.push(`## False negatives (${fns.length})`);
  lines.push("");
  lines.push("| Id | Category | Listed tokens present | Text |");
  lines.push("|---|---|---|---|");
  for (const s of fns) {
    lines.push(`| ${s.id} | ${s.category} | ${s.tokens.join(", ") || "—"} | ${cell(s.text)} |`);
  }
  lines.push("");
  lines.push(`## False positives (${fps.length})`);
  lines.push("");
  lines.push("| Id | Category | Listed tokens present | Text |");
  lines.push("|---|---|---|---|");
  for (const s of fps) {
    lines.push(`| ${s.id} | ${s.category} | ${s.tokens.join(", ") || "—"} | ${cell(s.text)} |`);
  }
  lines.push("");
  lines.push("## Known blind spots");
  lines.push("");
  lines.push(blindSpots(perCat, fns, fps));
  lines.push("");
  return lines.join("\n");
}

function cell(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").replace(/\|/g, "\\|");
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

function blindSpots(perCat: Map<Category, Counts>, fns: Scored[], fps: Scored[]): string {
  const parts: string[] = [];
  const byCat = (cat: Category) => fns.filter((s) => s.category === cat);
  const fnNoToken = fns.filter((s) => s.tokens.length === 0).length;
  const fnWithToken = fns.length - fnNoToken;

  const ex = perCat.get("explicit")!;
  parts.push(
    `Explicit anchoring with a listed token and a listed justifier is caught in ${ex.tp}/${ex.n} cases.`
  );

  const pa = byCat("paraphrase");
  if (pa.length > 0) {
    parts.push(
      `Paraphrased anchoring is missed in ${pa.length}/${perCat.get("paraphrase")!.n} cases: ` +
        "the probe matches fixed strings only, so unlisted group phrasings " +
        '("Hispanic heritage", "Black ethnicity", "as a woman", "her sex") ' +
        'and unlisted justifiers ("favoured", "attributed to", "points towards", ' +
        '"in keeping with", "diagnosis of", "most probable") are invisible to it, ' +
        "and a justifier more than 200 characters from the token is outside the window."
    );
  }

  const im = byCat("implicit");
  if (im.length > 0) {
    parts.push(
      `Implicit / proxy reasoning is missed in ${im.length}/${perCat.get("implicit")!.n} cases: ` +
        "surname, language, neighbourhood, postcode, insurance status, skin tone, " +
        '"this population" and place of residence carry no listed token, so the probe ' +
        "cannot see the demographic premise even when a listed justifier is present."
    );
  }

  parts.push(
    `Of the ${fns.length} false negatives, ${fnNoToken} contain no listed token at all ` +
      `(vocabulary gap) and ${fnWithToken} contain a listed token but no listed justifier ` +
      "inside the window (justifier-vocabulary or window gap)."
  );

  const ne = fps.filter((s) => s.category === "negation").length;
  const tr = fps.filter((s) => s.category === "trap").length;
  if (fps.length > 0) {
    parts.push(
      `On the negative side the probe has no notion of negation or of syntactic attachment: ` +
        `${ne}/${perCat.get("negation")!.n} negated statements and ${tr}/${perCat.get("trap")!.n} ` +
        "traps are flagged because a justifier word about a different finding (or a substring " +
        'such as "unlikely" / "contraindicates") falls within 200 characters of a descriptor. ' +
        "Benign descriptor-only mentions, including those with a justifier beyond the window, " +
        `are all accepted (${perCat.get("benign")!.fp} false positives on benign items).`
    );
  }

  parts.push(
    "The probe is therefore a conservative regression guard for the explicit failure mode " +
      "it was designed for, not a general detector of demographic reasoning."
  );
  return parts.join(" ");
}

function main(): void {
  const items = loadItems();
  const scored = score(items);
  const today = new Date().toISOString().slice(0, 10);
  const report = buildReport(scored, today);
  process.stdout.write(report + "\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, report, "utf-8");
  process.stdout.write(`\nWritten: ${path.relative(ROOT, OUT_FILE)}\n`);
}

main();
