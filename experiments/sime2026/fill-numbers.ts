/**
 * SIME 2026 — derive every paper number from the experiment artefacts.
 * =====================================================================
 *
 * Reads `paper/numbers.tex` as a *template* (never modified) and writes a copy
 * whose macro bodies are replaced by values derived from the artefacts in this
 * directory. A macro whose evidence is missing keeps the template's body — so
 * an unfilled `XXX` stays `XXX` — and a warning is printed. Every resolved
 * macro is printed with the file (and run id) it came from, so a reviewer can
 * trace each number back to an artefact without reading this code.
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime2026/fill-numbers.ts \
 *     --out <path>/numbers-generated.tex \
 *     --template <paper-dir>/numbers.tex \
 *     [--runs experiments/sime2026/runs] \
 *     [--results experiments/sime2026/results.jsonl] \
 *     [--docs experiments/sime2026] \
 *     [--coverage coverage/coverage-summary.json] [--jest-json <jest --json>]
 *
 * --template is required — the LaTeX numbers template lives outside this
 * repo (next to the paper source), so there is no portable default.
 *
 * Sources, by macro group:
 *   \NTESTS \NSUITES \COVERAGE   coverage/coverage-summary.json (statements) and,
 *                                if given, the JSON report of `npm test -- --json`.
 *                                Neither is produced by default, so these
 *                                normally keep their template values.
 *   \FB*                         E1-fairness-benchmark-results.md
 *   \EP*                         E3-payload-e4-224px.md, E3-payload-large-study.md
 *                                and, for the retired 1024-px pre-flight,
 *                                docs/architecture/decisions/ADR-003-image-preprocessing.md
 *   \OR*                         results.jsonl + runs/<id>/output/run_manifest.json
 *                                (`totals` preferred; the results row is the fallback)
 *   \EFOUR*                      nih-selection.json (cohort definition) and the
 *                                E4 run artefacts
 *   \VF* \CPP*                   E4 run artefacts (per-session records, manifest totals).
 *                                \VFGMA is quoted with its denominator and counts the
 *                                **image** stage only (13 of 31), because that is what the
 *                                paper sentence and the E-series reports mean; the other
 *                                \VF* macros are plain all-stage counts.
 *   \AGR*                        qualitative-agreement.json — human-judged values
 *                                transcribed from QUALITATIVE-REVIEW.md §(b).
 *                                Never recomputed here: direction agreement is a
 *                                reviewer judgement, not a derivable number.
 *
 * Deterministic: no clock, no network, no randomness. The same artefacts always
 * produce the same output file, so re-running it is a check, not a change.
 */
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

/* ────────────────────────────────────────────────────────────── types ── */

/** One line of `results.jsonl`, as written by `run.sh`. */
export interface ResultRow {
  id: string;
  date?: string;
  provider?: string;
  model?: string;
  concurrency?: number;
  sessions?: number;
  images?: number;
  exit?: number;
  wall_s?: number;
  calls?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  usd?: number | null;
  provider_usd?: number | null;
  retries?: number;
  images_line?: string;
}

/** The `totals` block of `run_manifest.json`. */
export interface RunTotals {
  calls?: number;
  tokensIn?: number;
  tokensOut?: number;
  estimatedUsd?: number;
  providerUsd?: number;
  images?: number;
  imagesSucceeded?: number;
  imagesFailed?: number;
  series?: number;
}

/** What one macro resolved to, and where the value came from. */
export interface MacroResolution {
  macro: string;
  /** `undefined` ⇒ unresolved; the template's own body is kept. */
  value?: string;
  /** Human-readable provenance: a file path, a run id, or both. */
  source: string;
  /** Why a value is missing or needs care. Printed as a warning. */
  note?: string;
}

/** Per-session record outcome, as recorded in an artefact JSON. */
export type RecordOutcome = "ok" | "invalid" | "transport-error" | "other";

/** What one E4 run directory contributes to the model-dependency macros. */
export interface E4RunArtefacts {
  id: string;
  patient: string;
  /** Model segment of the run id, e.g. `google_gemini-2.5-flash`. */
  modelTag: string;
  /** `TemporalAnalysis.progression` from `evolution_analysis.json`. */
  progression?: string;
  /** Per-session records inspected (image analyses + the evolution record). */
  records: number;
  /** Records whose `validation.ok` is `false`. */
  validationFailures: number;
  /**
   * Per-**image** records only, i.e. `records` minus the run's `evolution_analysis.json`.
   * The paper quotes gemma's image-stage failure rate with its own denominator, so the two
   * stages must not be mixed. Optional: a caller that has no per-stage breakdown may omit it,
   * and the aggregation then falls back to `records`.
   */
  imageRecords?: number;
  /** Image records whose `validation.ok` is `false`; falls back to `validationFailures`. */
  imageValidationFailures?: number;
  /** Records with no `validation` block and `status: "error"` (never reached the model). */
  transportErrors: number;
  /** Provider-reported spend for the run, from the manifest or the results row. */
  providerUsd?: number;
  /** CLI exit code, from the results row. */
  exit?: number;
}

/* ─────────────────────────────────────────────────────── formatting ── */

/** `12450` → `12\,450`; LaTeX thin spaces, as the paper already uses for bytes. */
export function groupDigits(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(Math.round(n)).toString();
  const parts: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) parts.unshift(digits.slice(Math.max(0, i - 3), i));
  return sign + parts.join("\\,");
}

/** Fixed-decimal number, never in exponent form. */
export function fixed(n: number, dp: number): string {
  return n.toFixed(dp);
}

/** `0.0124` → `\$0.0124`, the escaped dollar the paper's macros carry. */
export function usdMacro(n: number, dp = 4): string {
  return `\\$${n.toFixed(dp)}`;
}

/**
 * Progression-label distribution, e.g. `3 Stable / 2 Worsening / 1 Improving`.
 * Labels are emitted in a fixed order (never by count) so the string is stable
 * across runs; labels with a zero count are omitted, unknown labels come last
 * in alphabetical order.
 */
export const PROGRESSION_ORDER = ["Stable", "Worsening", "Improving", "Inconclusive"];

export function formatLabelCounts(counts: Record<string, number>): string {
  const known = PROGRESSION_ORDER.filter((l) => (counts[l] ?? 0) > 0);
  const extra = Object.keys(counts)
    .filter((l) => !PROGRESSION_ORDER.includes(l) && counts[l] > 0)
    .sort();
  const all = [...known, ...extra];
  return all.map((l) => `${counts[l]} ${l}`).join(" / ");
}

/** `{agree:3, agreePartial:6, of:8}` → `3/8 (6/8)`, the paper's AGR format. */
export function formatAgreement(a: { agree: number; agreePartial: number; of: number }): string {
  return `${a.agree}/${a.of} (${a.agreePartial}/${a.of})`;
}

/* ───────────────────────────────────────────────────────── parsing ── */

/** Parses `results.jsonl`; unparseable lines are skipped, not fatal. */
export function parseResultsJsonl(text: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as ResultRow;
      if (typeof row.id === "string") rows.push(row);
    } catch {
      /* a partially written line while a batch is appending — ignore */
    }
  }
  return rows;
}

/**
 * Last row for an id. `results.jsonl` is append-only and a resumed batch may
 * record the same id twice, so the newest row is the authoritative one.
 */
export function latestRow(rows: ResultRow[], id: string): ResultRow | undefined {
  let found: ResultRow | undefined;
  for (const r of rows) if (r.id === id) found = r;
  return found;
}

/** `totals` out of a `run_manifest.json` text, or `undefined` if unusable. */
export function parseManifestTotals(text: string): RunTotals | undefined {
  try {
    const m = JSON.parse(text) as { totals?: RunTotals };
    return m.totals && typeof m.totals === "object" ? m.totals : undefined;
  } catch {
    return undefined;
  }
}

/** Outcome of one per-session artefact record. */
export function classifyRecord(record: {
  status?: unknown;
  validation?: { ok?: unknown } | null;
}): RecordOutcome {
  const validation = record.validation;
  if (validation && typeof validation === "object") {
    if (validation.ok === false) return "invalid";
    if (validation.ok === true) return "ok";
    return "other";
  }
  if (record.status === "error") return "transport-error";
  return "other";
}

/** Numbers in the E1 benchmark report. */
export interface FairnessBenchmark {
  items?: number;
  explicitRecall?: number;
  paraphraseRecall?: number;
  implicitRecall?: number;
  benignFalsePositives?: number;
  negationFpRate?: number;
  trapFpRate?: number;
  precision?: number;
  recall?: number;
  f1?: number;
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function num(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const m = /-?\d+(?:\.\d+)?/.exec(cell.replace(/[\s,]/g, ""));
  return m ? Number(m[0]) : undefined;
}

/** Parses `E1-fairness-benchmark-results.md` (both of its tables). */
export function parseFairnessBenchmark(md: string): FairnessBenchmark {
  const out: FairnessBenchmark = {};
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = markdownCells(line);
    const label = (cells[0] ?? "").replace(/\*/g, "").toLowerCase();
    // Per-category table: | Category | Expected | n | token | TP | FP | TN | FN | rate |
    if (cells.length >= 9) {
      const rate = num(cells[8]);
      if (label === "explicit") out.explicitRecall = rate;
      else if (label === "paraphrase") out.paraphraseRecall = rate;
      else if (label === "implicit") out.implicitRecall = rate;
      else if (label === "benign") out.benignFalsePositives = num(cells[5]);
      else if (label === "negation") out.negationFpRate = rate;
      else if (label === "trap") out.trapFpRate = rate;
      else if (label === "overall") out.items = num(cells[2]);
    }
    // Overall metrics table: | Metric | Value |
    if (cells.length === 2) {
      if (label === "precision") out.precision = num(cells[1]);
      else if (label === "recall") out.recall = num(cells[1]);
      else if (label === "f1") out.f1 = num(cells[1]);
    }
  }
  return out;
}

/** Totals line of an `E3-payload-*.md` report. */
export interface PayloadTotals {
  originalBytes?: number;
  sentBytes?: number;
  reductionPct?: number;
  targetDim?: number;
}

/** Parses the `Totals:` line and the policy target of an E3 payload report. */
export function parsePayloadReport(md: string): PayloadTotals {
  const out: PayloadTotals = {};
  const totals = /Totals:\s*(\d+)\s*B on disk\s*(?:→|->)\s*(\d+)\s*B sent\s*\(([\d.]+)%/.exec(md);
  if (totals) {
    out.originalBytes = Number(totals[1]);
    out.sentBytes = Number(totals[2]);
    out.reductionPct = Number(totals[3]);
  }
  const target = /long-edge target\s+(\d+)\s*px/.exec(md);
  if (target) out.targetDim = Number(target[1]);
  return out;
}

/** The retired 1024-px pre-flight, recorded in ADR-003's comparison table. */
export interface OldPreflight {
  bytes?: number;
  pct?: number;
}

/** Parses ADR-003's `e4-224px` row for the old always-resize/always-PNG numbers. */
export function parseAdrOldPreflight(md: string): OldPreflight {
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|") || !line.includes("e4-224px")) continue;
    const cells = markdownCells(line);
    // | label | n | original | old (**+x %**) | new (**−y %**) |
    const old = cells[3];
    if (!old) continue;
    const bytes = num(old);
    const pct = /([\d.]+)\s*%/.exec(old);
    return { bytes, pct: pct ? Number(pct[1]) : undefined };
  }
  return {};
}

/** Cohort shape derived from `nih-selection.json`. */
export interface CohortShape {
  patients: number;
  studies: number;
  minSessions: number;
  maxSessions: number;
}

export function cohortShape(selection: Record<string, unknown[]>): CohortShape | undefined {
  const ids = Object.keys(selection ?? {});
  if (ids.length === 0) return undefined;
  const lengths = ids.map((id) => (Array.isArray(selection[id]) ? selection[id].length : 0));
  return {
    patients: ids.length,
    studies: lengths.reduce((a, b) => a + b, 0),
    minSessions: Math.min(...lengths),
    maxSessions: Math.max(...lengths),
  };
}

/* ──────────────────────────────────────────────── E2 (Table I) macros ── */

/** Table I rows: input size → macro infix. */
export const E2_SIZES: ReadonlyArray<readonly [string, string]> = [
  ["S1x1", "ONEONE"],
  ["S2x5", "TWOFIVE"],
  ["S3x10", "THREETEN"],
  ["S4x20", "FOURTWENTY"],
];

/** Table I concurrency levels → macro infix. */
export const E2_CONCURRENCIES: ReadonlyArray<readonly [number, string]> = [
  [1, "CONE"],
  [5, "CFIVE"],
];

/** The one provider route Table I reports (see the note in numbers.tex). */
export const E2_ROUTE = "openrouter-google_gemini-2.5-flash";

export function e2RunId(size: string, concurrency: number, route = E2_ROUTE): string {
  return `E2-${size}-c${concurrency}-${route}`;
}

/**
 * The five macros of one Table I row.
 *
 * Manifest `totals` win over the results row: the row is scraped from the CLI's
 * verbose summary, while the manifest is written by the CLI itself. Wall time
 * exists only in the row (it is measured around the whole process), so a run
 * whose row is missing yields no time even when the manifest is present.
 */
export function resolveE2Row(
  size: string,
  sizeInfix: string,
  concurrency: number,
  concInfix: string,
  row: ResultRow | undefined,
  totals: RunTotals | undefined
): MacroResolution[] {
  const id = e2RunId(size, concurrency);
  const prefix = `OR${sizeInfix}${concInfix}`;
  const from = totals ? `runs/${id}/output/run_manifest.json (totals)` : `results.jsonl ${id}`;
  const note =
    row && row.exit !== 0
      ? `run exited ${row.exit} (${row.images_line ?? "no images line"}) — row is a failure, not a clean measurement`
      : undefined;

  const pick = (t?: number, r?: number | null): number | undefined => {
    if (typeof t === "number") return t;
    return typeof r === "number" ? r : undefined;
  };

  const calls = pick(totals?.calls, row?.calls);
  const tokensIn = pick(totals?.tokensIn, row?.tokens_in);
  const tokensOut = pick(totals?.tokensOut, row?.tokens_out);
  const usd = pick(totals?.providerUsd, row?.provider_usd);
  const wall = typeof row?.wall_s === "number" ? row.wall_s : undefined;

  const missing = `no run for ${id} yet (batch still running or run not executed)`;
  return [
    {
      macro: `${prefix}CALLS`,
      value: calls === undefined ? undefined : String(calls),
      source: from,
      note: calls === undefined ? missing : note,
    },
    {
      macro: `${prefix}TIME`,
      value: wall === undefined ? undefined : fixed(wall, 1),
      source: `results.jsonl ${id} (wall_s)`,
      note: wall === undefined ? missing : note,
    },
    {
      macro: `${prefix}IN`,
      value: tokensIn === undefined ? undefined : groupDigits(tokensIn),
      source: from,
      note: tokensIn === undefined ? missing : note,
    },
    {
      macro: `${prefix}OUT`,
      value: tokensOut === undefined ? undefined : groupDigits(tokensOut),
      source: `${from} — output tokens include thinking tokens`,
      note: tokensOut === undefined ? missing : note,
    },
    {
      macro: `${prefix}USD`,
      value: usd === undefined ? undefined : fixed(usd, 4),
      source: `${from} — provider-reported charge, not the estimate`,
      note: usd === undefined ? missing : note,
    },
  ];
}

/* ─────────────────────────────────────────────────────── E4 macros ── */

/** Model segment of an E4 run id → the paper's macro suffix. */
export const E4_MODEL_SUFFIX: Record<string, string> = {
  "google_gemini-2.5-flash": "GEM",
  "google_gemma-4-31b-it": "GMA",
  "qwen_qwen3-vl-235b-a22b-instruct": "QWN",
  "anthropic_claude-sonnet-5": "CLD",
};

/** The gemini arm is the one the \EFOUR* operational macros describe. */
export const E4_PRIMARY_MODEL = "google_gemini-2.5-flash";

/** `E4-00000008-openrouter-google_gemini-2.5-flash` → its parts. */
export function parseE4RunId(
  id: string
): { cohort: string; patient: string; provider: string; modelTag: string } | undefined {
  const m = /^(E4|E4L)-(\d+)-(google|openrouter)-(.+)$/.exec(id);
  if (!m) return undefined;
  return { cohort: m[1], patient: m[2], provider: m[3], modelTag: m[4] };
}

/** Per-model aggregation of the E4 run artefacts. */
export interface E4ModelSummary {
  runs: number;
  completed: number;
  records: number;
  validationFailures: number;
  /** Image-stage subset of `records` / `validationFailures` (evolution records excluded). */
  imageRecords: number;
  imageValidationFailures: number;
  transportErrors: number;
  providerUsdTotal: number;
  providerUsdRuns: number;
  labels: Record<string, number>;
}

export function summariseE4(runs: E4RunArtefacts[]): Map<string, E4ModelSummary> {
  const byModel = new Map<string, E4ModelSummary>();
  for (const run of runs) {
    let s = byModel.get(run.modelTag);
    if (!s) {
      s = {
        runs: 0,
        completed: 0,
        records: 0,
        validationFailures: 0,
        imageRecords: 0,
        imageValidationFailures: 0,
        transportErrors: 0,
        providerUsdTotal: 0,
        providerUsdRuns: 0,
        labels: {},
      };
      byModel.set(run.modelTag, s);
    }
    s.runs++;
    if (run.exit === 0) s.completed++;
    s.records += run.records;
    s.validationFailures += run.validationFailures;
    s.imageRecords += run.imageRecords ?? run.records;
    s.imageValidationFailures += run.imageValidationFailures ?? run.validationFailures;
    s.transportErrors += run.transportErrors;
    if (typeof run.providerUsd === "number") {
      s.providerUsdTotal += run.providerUsd;
      s.providerUsdRuns++;
    }
    if (run.progression) s.labels[run.progression] = (s.labels[run.progression] ?? 0) + 1;
  }
  return byModel;
}

/** \EFOURDONE, \EFOURUSD, \EFOURLABELS, \VF*, \CPP*. */
export function resolveE4(runs: E4RunArtefacts[]): MacroResolution[] {
  const out: MacroResolution[] = [];
  const byModel = summariseE4(runs);
  const primary = byModel.get(E4_PRIMARY_MODEL);
  const missing = "no E4 runs on disk for this model yet (batch still running?)";

  out.push({
    macro: "EFOURDONE",
    value: primary && primary.completed > 0 ? String(primary.completed) : undefined,
    source: `runs/E4-*-openrouter-${E4_PRIMARY_MODEL}/ + results.jsonl (exit 0)`,
    note: primary && primary.completed > 0 ? undefined : missing,
  });

  const usdRuns = runs.filter((r) => typeof r.providerUsd === "number");
  const usdTotal = usdRuns.reduce((a, r) => a + (r.providerUsd ?? 0), 0);
  out.push({
    macro: "EFOURUSD",
    value: usdRuns.length > 0 ? fixed(usdTotal, 4) : undefined,
    source: `sum of provider_usd over ${usdRuns.length} E4 runs, all models (run_manifest.json totals.providerUsd, else results.jsonl)`,
    note:
      usdRuns.length === 0
        ? missing
        : `whole-cohort figure; the ${E4_PRIMARY_MODEL} arm alone is ${fixed(primary?.providerUsdTotal ?? 0, 4)} USD — confirm which the sentence means`,
  });

  out.push({
    macro: "EFOURLABELS",
    value:
      primary && Object.keys(primary.labels).length > 0
        ? formatLabelCounts(primary.labels)
        : undefined,
    source: `runs/E4-*-openrouter-${E4_PRIMARY_MODEL}/output/evolution_analysis.json (progression)`,
    note: primary && Object.keys(primary.labels).length > 0 ? undefined : missing,
  });

  for (const [modelTag, suffix] of Object.entries(E4_MODEL_SUFFIX)) {
    const s = byModel.get(modelTag);
    const src = `runs/E4-*-openrouter-${modelTag}/output/**/*.json`;
    // gemma's failure count is quoted with its denominator in the paper, and the paper's
    // sentence is about *image* records ("Schema validation rejected N image records"). The
    // denominator therefore counts image records only — 31 per model — and excludes the 8
    // evolution records, which would otherwise inflate it to 39 while the numerator stayed
    // image-only. The other three models are quoted as plain counts, so they keep the
    // all-stage total; the note says how it splits.
    const value =
      s === undefined
        ? undefined
        : suffix === "GMA"
          ? `${s.imageValidationFailures} of ${s.imageRecords}`
          : String(s.validationFailures);
    const evolutionFailures = s ? s.validationFailures - s.imageValidationFailures : 0;
    out.push({
      macro: `VF${suffix}`,
      value,
      source:
        suffix === "GMA"
          ? `${src} — image records with validation.ok === false, of ${s?.imageRecords ?? 0} image records (the ${(s?.records ?? 0) - (s?.imageRecords ?? 0)} evolution records are excluded from both sides of the ratio)`
          : `${src} — records with validation.ok === false (${s?.imageValidationFailures ?? 0} image, ${evolutionFailures} evolution, over ${s?.records ?? 0} per-session records)`,
      note: s === undefined ? missing : undefined,
    });
  }

  const claude = byModel.get("anthropic_claude-sonnet-5");
  out.push({
    macro: "VFCLDERR",
    value: claude ? String(claude.transportErrors) : undefined,
    source: `runs/E4-*-openrouter-anthropic_claude-sonnet-5/output/**/*.json — status "error" with no validation block`,
    note: claude ? undefined : missing,
  });

  for (const [modelTag, suffix] of Object.entries(E4_MODEL_SUFFIX)) {
    const s = byModel.get(modelTag);
    const mean = s && s.providerUsdRuns > 0 ? s.providerUsdTotal / s.providerUsdRuns : undefined;
    out.push({
      macro: `CPP${suffix}`,
      value: mean === undefined ? undefined : usdMacro(mean),
      source: `mean provider_usd over ${s?.providerUsdRuns ?? 0} E4 patients of ${modelTag}`,
      note: mean === undefined ? missing : undefined,
    });
  }
  return out;
}

/* ─────────────────────────────────────── other macro groups ── */

/** Reviewer-maintained direction agreement (never recomputed here). */
export interface QualitativeAgreement {
  note?: string;
  source?: string;
  models: Record<string, { agree: number; agreePartial: number; of: number }>;
}

/** \AGR* — transcribed values, only reformatted. */
export function resolveAgreement(q: QualitativeAgreement | undefined): MacroResolution[] {
  const macros: ReadonlyArray<readonly [string, string]> = [
    ["AGRGEM", "google/gemini-2.5-flash"],
    ["AGRGMA", "google/gemma-4-31b-it"],
    ["AGRQWN", "qwen/qwen3-vl-235b-a22b-instruct"],
    ["AGRCLD", "anthropic/claude-sonnet-5"],
  ];
  return macros.map(([macro, model]) => {
    const entry = q?.models?.[model];
    return {
      macro,
      value: entry ? formatAgreement(entry) : undefined,
      source: `qualitative-agreement.json → ${model} (human-judged, from QUALITATIVE-REVIEW.md §b)`,
      note: entry ? undefined : "model missing from qualitative-agreement.json",
    };
  });
}

/** \FB* from the E1 report. */
export function resolveFairness(fb: FairnessBenchmark, file: string): MacroResolution[] {
  const at = (macro: string, v: number | undefined, dp: number, what: string): MacroResolution => ({
    macro,
    value: v === undefined ? undefined : fixed(v, dp),
    source: `${file} — ${what}`,
    note: v === undefined ? `not found in ${file}` : undefined,
  });
  return [
    {
      macro: "FBITEMS",
      value: fb.items === undefined ? undefined : String(fb.items),
      source: `${file} — overall row, n`,
      note: fb.items === undefined ? `not found in ${file}` : undefined,
    },
    at("FBEXPLICIT", fb.explicitRecall, 2, "explicit row, recall"),
    {
      macro: "FBBENIGNFP",
      value: fb.benignFalsePositives === undefined ? undefined : String(fb.benignFalsePositives),
      source: `${file} — benign row, FP count`,
      note: fb.benignFalsePositives === undefined ? `not found in ${file}` : undefined,
    },
    at("FBPARA", fb.paraphraseRecall, 2, "paraphrase row, recall"),
    at("FBIMPLICIT", fb.implicitRecall, 2, "implicit row, recall"),
    at("FBNEGFP", fb.negationFpRate, 2, "negation row, FP rate"),
    at("FBTRAPFP", fb.trapFpRate, 2, "trap row, FP rate"),
    at("FBPREC", fb.precision, 3, "overall metrics, precision"),
    at("FBREC", fb.recall, 3, "overall metrics, recall"),
    at("FBFONE", fb.f1, 3, "overall metrics, F1"),
  ];
}

/** \EP* from the two E3 reports plus ADR-003 for the retired policy. */
export function resolvePayload(
  small: PayloadTotals,
  large: PayloadTotals,
  old: OldPreflight,
  files: { small: string; large: string; adr: string }
): MacroResolution[] {
  const mb = (b: number | undefined): string | undefined =>
    b === undefined ? undefined : Number((b / 1e6).toPrecision(3)).toString();
  return [
    {
      macro: "EPBASE",
      value: small.originalBytes === undefined ? undefined : groupDigits(small.originalBytes),
      source: `${files.small} — Totals line, bytes on disk`,
      note: small.originalBytes === undefined ? `not found in ${files.small}` : undefined,
    },
    {
      macro: "EPOLD",
      value: old.bytes === undefined ? undefined : groupDigits(old.bytes),
      source: `${files.adr} — e4-224px row, retired 1024-px always-PNG pre-flight`,
      note: old.bytes === undefined ? `e4-224px row not found in ${files.adr}` : undefined,
    },
    {
      macro: "EPOLDPCT",
      value: old.pct === undefined ? undefined : fixed(old.pct, 1),
      source: `${files.adr} — e4-224px row, % vs. original`,
      note: old.pct === undefined ? `e4-224px row not found in ${files.adr}` : undefined,
    },
    {
      macro: "EPNEW",
      value: small.sentBytes === undefined ? undefined : groupDigits(small.sentBytes),
      source: `${files.small} — Totals line, bytes sent`,
      note: small.sentBytes === undefined ? `not found in ${files.small}` : undefined,
    },
    {
      macro: "EPNEWPCT",
      value: small.reductionPct === undefined ? undefined : fixed(small.reductionPct, 1),
      source: `${files.small} — Totals line, reduction %`,
      note: small.reductionPct === undefined ? `not found in ${files.small}` : undefined,
    },
    {
      macro: "EPLARGEIN",
      value: mb(large.originalBytes),
      source: `${files.large} — Totals line, MB on disk`,
      note: large.originalBytes === undefined ? `not found in ${files.large}` : undefined,
    },
    {
      macro: "EPLARGEOUT",
      value: mb(large.sentBytes),
      source: `${files.large} — Totals line, MB sent`,
      note: large.sentBytes === undefined ? `not found in ${files.large}` : undefined,
    },
    {
      macro: "EPLARGEPCT",
      value: large.reductionPct === undefined ? undefined : fixed(large.reductionPct, 1),
      source: `${files.large} — Totals line, reduction %`,
      note: large.reductionPct === undefined ? `not found in ${files.large}` : undefined,
    },
    {
      macro: "EPTILE",
      value: small.targetDim === undefined ? undefined : String(small.targetDim),
      source: `${files.small} — policy line, long-edge target`,
      note: small.targetDim === undefined ? `not found in ${files.small}` : undefined,
    },
  ];
}

/** \EFOURPATIENTS, \EFOURSTUDIES, \EFOURSESSIONS from the cohort manifest. */
export function resolveCohort(shape: CohortShape | undefined, file: string): MacroResolution[] {
  return [
    {
      macro: "EFOURPATIENTS",
      value: shape ? String(shape.patients) : undefined,
      source: `${file} — key E4, patient count`,
      note: shape ? undefined : `E4 key not readable in ${file}`,
    },
    {
      macro: "EFOURSTUDIES",
      value: shape ? String(shape.studies) : undefined,
      source: `${file} — key E4, total studies`,
      note: shape ? undefined : `E4 key not readable in ${file}`,
    },
    {
      macro: "EFOURSESSIONS",
      value: shape ? `${shape.minSessions}--${shape.maxSessions}` : undefined,
      source: `${file} — key E4, sessions per patient (min--max)`,
      note: shape ? undefined : `E4 key not readable in ${file}`,
    },
  ];
}

/** Coverage summary shape (`jest --coverage --coverageReporters=json-summary`). */
export interface CoverageSummary {
  total?: { statements?: { pct?: number } };
}

/** Jest JSON report shape (`jest --json`). */
export interface JestReport {
  numTotalTests?: number;
  numTotalTestSuites?: number;
}

/** \NTESTS, \NSUITES, \COVERAGE — only from machine-readable reports. */
export function resolveTests(
  coverage: CoverageSummary | undefined,
  jest: JestReport | undefined,
  files: { coverage: string; jest?: string }
): MacroResolution[] {
  const pct = coverage?.total?.statements?.pct;
  const manual =
    "not derivable: run `npm test -- --json --outFile=<f>` and pass --jest-json <f>, or update the template by hand";
  return [
    {
      macro: "NTESTS",
      value: typeof jest?.numTotalTests === "number" ? String(jest.numTotalTests) : undefined,
      source: files.jest ? `${files.jest} — numTotalTests` : "npm test (no JSON report given)",
      note: typeof jest?.numTotalTests === "number" ? undefined : manual,
    },
    {
      macro: "NSUITES",
      value:
        typeof jest?.numTotalTestSuites === "number" ? String(jest.numTotalTestSuites) : undefined,
      source: files.jest ? `${files.jest} — numTotalTestSuites` : "npm test (no JSON report given)",
      note: typeof jest?.numTotalTestSuites === "number" ? undefined : manual,
    },
    {
      macro: "COVERAGE",
      value: typeof pct === "number" ? fixed(pct, 1) : undefined,
      source: `${files.coverage} — total.statements.pct`,
      note:
        typeof pct === "number"
          ? undefined
          : `absent: run \`npm run test:coverage -- --coverageReporters=json-summary\` to produce ${files.coverage}`,
    },
  ];
}

/* ────────────────────────────────────────────── template rewriting ── */

/** Replaces the body of `\newcommand{\NAME}{…}` for each resolved macro. */
export function rewriteMacros(
  template: string,
  resolutions: MacroResolution[]
): { text: string; applied: string[]; unresolved: string[]; unknown: string[] } {
  let text = template;
  const applied: string[] = [];
  const unresolved: string[] = [];
  const unknown: string[] = [];
  for (const r of resolutions) {
    if (r.value === undefined) {
      unresolved.push(r.macro);
      continue;
    }
    const re = new RegExp(`(\\\\newcommand\\{\\\\${r.macro}\\}\\{)[^{}]*(\\})`);
    if (!re.test(text)) {
      unknown.push(r.macro);
      continue;
    }
    text = text.replace(re, `$1${r.value}$2`);
    applied.push(r.macro);
  }
  return { text, applied, unresolved, unknown };
}

/** Macro bodies still holding a placeholder, e.g. `XXX` / `X.XXX` / `TBD`. */
export function remainingPlaceholders(text: string): string[] {
  const out: string[] = [];
  const re = /\\newcommand\{\\([A-Z]+)\}\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (/^(X+|X\.X+|TBD)$/.test(m[2].trim())) out.push(m[1]);
  }
  return out;
}

/** The traceability table printed for the reviewer. */
export function renderTraceTable(resolutions: MacroResolution[]): string {
  const rows = resolutions.map((r) => [
    `\\${r.macro}`,
    r.value === undefined ? "— (kept template value)" : r.value,
    r.source,
  ]);
  const header = ["macro", "value", "source (artefact / run id)"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]): string =>
    "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  return [
    line(header),
    "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|",
    ...rows.map(line),
  ].join("\n");
}

/* ─────────────────────────────────────────────────────────── I/O ── */

function readTextIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

function readJsonIfPresent<T>(file: string): T | undefined {
  const text = readTextIfPresent(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Every `*_analysis.json` plus `evolution_analysis.json` under a run output. */
function sessionRecordFiles(outputDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/_analysis\.json$/.test(e.name)) files.push(p);
    }
  };
  walk(outputDir);
  return files;
}

/** Reads one E4/E4L run directory into the shape the macros need. */
export function readE4Run(
  runsDir: string,
  id: string,
  row: ResultRow | undefined
): E4RunArtefacts | undefined {
  const parsed = parseE4RunId(id);
  if (!parsed) return undefined;
  const outputDir = path.join(runsDir, id, "output");
  const totals = (() => {
    const text = readTextIfPresent(path.join(outputDir, "run_manifest.json"));
    return text === undefined ? undefined : parseManifestTotals(text);
  })();

  let records = 0;
  let validationFailures = 0;
  let imageRecords = 0;
  let imageValidationFailures = 0;
  let transportErrors = 0;
  let progression: string | undefined;
  for (const file of sessionRecordFiles(outputDir)) {
    const record = readJsonIfPresent<{
      status?: unknown;
      validation?: { ok?: unknown } | null;
      progression?: unknown;
    }>(file);
    if (!record) continue;
    records++;
    const isEvolution = path.basename(file) === "evolution_analysis.json";
    if (!isEvolution) imageRecords++;
    const outcome = classifyRecord(record);
    if (outcome === "invalid") {
      validationFailures++;
      if (!isEvolution) imageValidationFailures++;
    }
    if (outcome === "transport-error") transportErrors++;
    if (
      path.basename(file) === "evolution_analysis.json" &&
      typeof record.progression === "string"
    ) {
      progression = record.progression;
    }
  }

  const providerUsd =
    typeof totals?.providerUsd === "number"
      ? totals.providerUsd
      : typeof row?.provider_usd === "number"
        ? row.provider_usd
        : undefined;

  return {
    id,
    patient: parsed.patient,
    modelTag: parsed.modelTag,
    progression,
    records,
    validationFailures,
    imageRecords,
    imageValidationFailures,
    transportErrors,
    providerUsd,
    exit: row?.exit,
  };
}

interface Options {
  out: string;
  runsDir: string;
  resultsFile: string;
  templateFile: string;
  docsDir: string;
  repoRoot: string;
  coverageFile: string;
  jestJsonFile?: string;
}

export function parseArgs(argv: string[], here: string): Options {
  const repoRoot = path.resolve(here, "..", "..");
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const out = get("--out");
  if (!out) {
    throw new Error(
      "usage: fill-numbers.ts --out <numbers-generated.tex> --template <numbers.tex> " +
        "[--runs <dir>] [--results <file>] [--docs <dir>] [--coverage <file>] [--jest-json <file>]"
    );
  }
  const templateFile = get("--template");
  if (!templateFile) {
    throw new Error(
      "usage: fill-numbers.ts --out <numbers-generated.tex> --template <numbers.tex> " +
        "[--runs <dir>] [--results <file>] [--docs <dir>] [--coverage <file>] [--jest-json <file>]\n" +
        "  --template is required: it is the LaTeX numbers template to fill in, and lives " +
        "outside this repo (e.g. alongside the paper source) — there is no portable default."
    );
  }
  // `here` is experiments/sime2026/, so repoRoot is the repository root. The
  // analysis reports this reads (`--docs`) are the committed evidence in that
  // same directory; only the raw run artefacts under `runs/` are local-only.
  return {
    out,
    runsDir: get("--runs") ?? path.join(repoRoot, "experiments", "sime2026", "runs"),
    resultsFile:
      get("--results") ?? path.join(repoRoot, "experiments", "sime2026", "results.jsonl"),
    templateFile,
    docsDir: get("--docs") ?? here,
    repoRoot,
    coverageFile: get("--coverage") ?? path.join(repoRoot, "coverage", "coverage-summary.json"),
    jestJsonFile: get("--jest-json"),
  };
}

/** Collects every macro resolution from the artefacts named in `opts`. */
export function collect(opts: Options): MacroResolution[] {
  const resolutions: MacroResolution[] = [];
  const d = opts.docsDir;

  // Tests / coverage.
  resolutions.push(
    ...resolveTests(
      readJsonIfPresent<CoverageSummary>(opts.coverageFile),
      opts.jestJsonFile ? readJsonIfPresent<JestReport>(opts.jestJsonFile) : undefined,
      { coverage: path.relative(opts.repoRoot, opts.coverageFile), jest: opts.jestJsonFile }
    )
  );

  // E1 fairness benchmark.
  const e1File = path.join(d, "E1-fairness-benchmark-results.md");
  const e1 = readTextIfPresent(e1File);
  resolutions.push(...resolveFairness(e1 ? parseFairnessBenchmark(e1) : {}, path.basename(e1File)));

  // E3 payload policy.
  const smallFile = path.join(d, "E3-payload-e4-224px.md");
  const largeFile = path.join(d, "E3-payload-large-study.md");
  const adrFile = path.join(
    opts.repoRoot,
    "docs/architecture/decisions/ADR-003-image-preprocessing.md"
  );
  const smallText = readTextIfPresent(smallFile);
  const largeText = readTextIfPresent(largeFile);
  const adrText = readTextIfPresent(adrFile);
  resolutions.push(
    ...resolvePayload(
      smallText ? parsePayloadReport(smallText) : {},
      largeText ? parsePayloadReport(largeText) : {},
      adrText ? parseAdrOldPreflight(adrText) : {},
      {
        small: path.basename(smallFile),
        large: path.basename(largeFile),
        adr: path.relative(opts.repoRoot, adrFile),
      }
    )
  );

  // E2 Table I.
  const rows = parseResultsJsonl(readTextIfPresent(opts.resultsFile) ?? "");
  for (const [size, sizeInfix] of E2_SIZES) {
    for (const [conc, concInfix] of E2_CONCURRENCIES) {
      const id = e2RunId(size, conc);
      const manifestText = readTextIfPresent(
        path.join(opts.runsDir, id, "output", "run_manifest.json")
      );
      resolutions.push(
        ...resolveE2Row(
          size,
          sizeInfix,
          conc,
          concInfix,
          latestRow(rows, id),
          manifestText ? parseManifestTotals(manifestText) : undefined
        )
      );
    }
  }

  // E4 cohort definition.
  const selectionFile = path.join(d, "nih-selection.json");
  const selection = readJsonIfPresent<Record<string, Record<string, unknown[]>>>(selectionFile);
  resolutions.push(
    ...resolveCohort(
      selection?.E4 ? cohortShape(selection.E4) : undefined,
      path.basename(selectionFile)
    )
  );

  // E4 run artefacts.
  let runIds: string[] = [];
  try {
    runIds = fs
      .readdirSync(opts.runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("E4-"))
      .map((e) => e.name)
      .sort();
  } catch {
    runIds = [];
  }
  const e4runs = runIds
    .map((id) => readE4Run(opts.runsDir, id, latestRow(rows, id)))
    .filter((r): r is E4RunArtefacts => r !== undefined);
  resolutions.push(...resolveE4(e4runs));

  // Human-judged direction agreement.
  resolutions.push(
    ...resolveAgreement(
      readJsonIfPresent<QualitativeAgreement>(path.join(d, "qualitative-agreement.json"))
    )
  );

  return resolutions;
}

const GENERATED_HEADER = [
  "%% numbers-generated.tex — GENERATED by experiments/sime2026/fill-numbers.ts.",
  "%% Do not edit by hand: re-run the script instead. Every value below was",
  "%% derived from a committed artefact in experiments/sime2026/ (or the",
  "%% repository's docs/), and the script prints a macro-by-macro source table",
  "%% when it runs.",
  "%% Macro bodies left as XXX / X.XXX / TBD had no artefact to derive them from.",
  "",
].join("\n");

export function main(argv: string[], here: string): number {
  const opts = parseArgs(argv, here);
  const template = readTextIfPresent(opts.templateFile);
  if (template === undefined) {
    console.error(`fill-numbers: cannot read template ${opts.templateFile}`);
    return 2;
  }

  const resolutions = collect(opts);
  const { text, applied, unresolved, unknown } = rewriteMacros(template, resolutions);
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, GENERATED_HEADER + text);

  console.log(renderTraceTable(resolutions));
  console.log("");
  console.log(
    `fill-numbers: ${applied.length} macros filled, ${unresolved.length} kept from the template.`
  );
  const still = remainingPlaceholders(text);
  if (still.length > 0) {
    console.log(`still placeholders (${still.length}): ${still.join(", ")}`);
  }
  console.log(`written: ${opts.out}`);

  for (const r of resolutions) {
    if (r.note) console.warn(`warning: \\${r.macro} — ${r.note}`);
  }
  for (const macro of unknown) {
    console.warn(`warning: \\${macro} is not defined in ${opts.templateFile} — value not written`);
  }
  return 0;
}

/* istanbul ignore next -- CLI entry point, exercised by running the script */
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  process.exitCode = main(process.argv, here);
}
