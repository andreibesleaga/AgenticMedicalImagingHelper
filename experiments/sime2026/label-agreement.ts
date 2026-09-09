/**
 * E5 — Label agreement
 * =====================
 *
 * Compares model-generated free-text radiology output (findings[],
 * abnormalities[], summary) against the NIH ChestX-ray14 "Finding Labels"
 * for the same image, for every run under experiments/sime2026/runs whose
 * id belongs to cohort E4, E4L or E2. This is a DESCRIPTIVE AGREEMENT study,
 * not a diagnostic-accuracy study — see the caveats section emitted at the
 * top of the generated E5-label-agreement.md, and do not cite the numbers below as
 * clinical accuracy.
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime2026/label-agreement.ts \
 *     [--runs experiments/sime2026/runs] \
 *     [--out experiments/sime2026/E5-label-agreement.md] \
 *     [--csv <path-to-Data_Entry_2017.csv>]
 *
 * The NIH metadata CSV is resolved as: --csv flag > NIH_CSV env var >
 * repo-relative default (../nih-cxr14/Data_Entry_2017.csv, a sibling of this
 * repo's root — the layout prepare-nih.py writes to by default).
 *
 * Outputs (default directory experiments/sime2026/, where both are committed
 * evidence):
 *   <out>            — markdown report (default
 *                      experiments/sime2026/E5-label-agreement.md)
 *   <out>.json (with .md replaced by .json, or E5-label-agreement.json if
 *   <out> has no .md extension) — the same data, machine-readable.
 *
 * All pure logic (text matching, metrics, direction derivation, run-id
 * parsing) is exported so it can be unit-tested against fixtures without
 * touching the filesystem; only the loading/orchestration functions at the
 * bottom touch disk.
 */
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import type { ProgressionStatus } from "../../src/domain/types.js";

// ─── 1. The 14 NIH ChestX-ray14 classes ────────────────────────────────────

export const NIH_CLASSES = [
  "Atelectasis",
  "Cardiomegaly",
  "Effusion",
  "Infiltration",
  "Mass",
  "Nodule",
  "Pneumonia",
  "Pneumothorax",
  "Consolidation",
  "Edema",
  "Emphysema",
  "Fibrosis",
  "Pleural_Thickening",
  "Hernia",
] as const;

export type NihClass = (typeof NIH_CLASSES)[number];

/**
 * Heuristic, auditable text→class mapping.
 *
 * This table is NOT clinically validated. It was built by reading the model
 * outputs actually present under experiments/sime2026/runs plus common
 * radiology-report phrasing for each of the 14 NIH ChestX-ray14 classes. It
 * is intentionally conservative (specific multi-word phrases over single
 * generic words like bare "opacity") to limit cross-class false positives —
 * e.g. "opacity" alone is deliberately excluded from Infiltration because it
 * also appears inside Nodule/Consolidation/Fibrosis phrasing, which would
 * otherwise make Infiltration fire on almost every abnormal image. Extend
 * this table under review, the same way fairness.ts's DEMOGRAPHIC_TOKENS
 * list is extended.
 *
 * Matching is negation-aware — see `textAssertsPhrase` below — and
 * word-boundary-aware so short phrases ("mass", "hernia") do not match
 * inside longer words ("massive", "herniated disc").
 */
export const CLASS_SYNONYMS: Record<NihClass, string[]> = {
  Atelectasis: [
    "atelectasis",
    "atelectatic",
    "volume loss",
    "linear atelectasis",
    "subsegmental atelectasis",
    "collapse of the lung",
    "lobar collapse",
  ],
  Cardiomegaly: [
    "cardiomegaly",
    "enlarged cardiac silhouette",
    "enlarged heart",
    "cardiac enlargement",
    "cardiomegalic",
    "cardiothoracic ratio >0.5",
    "cardiothoracic ratio > 0.5",
    "cardiothoracic ratio greater than 0.5",
  ],
  Effusion: [
    "pleural effusion",
    "effusion",
    "blunting of the costophrenic angle",
    "blunted costophrenic angle",
    "costophrenic angle blunting",
    "fluid in the pleural space",
    "layering pleural fluid",
  ],
  Infiltration: [
    "infiltration",
    "infiltrate",
    "airspace disease",
    "airspace opacity",
    "patchy airspace opacity",
    "interstitial infiltrate",
    "ill-defined opacity",
  ],
  Mass: ["mass lesion", "soft tissue mass", "pulmonary mass", "mass-like opacity", "mass"],
  Nodule: ["pulmonary nodule", "nodular opacity", "lung nodule", "nodule"],
  Pneumonia: [
    "pneumonia",
    "pneumonic consolidation",
    "consolidation consistent with pneumonia",
    "infectious airspace process",
  ],
  Pneumothorax: [
    "pneumothorax",
    "collapsed lung",
    "visceral pleural line",
    "absence of lung markings peripherally",
  ],
  Consolidation: ["consolidation", "consolidative opacity", "airspace consolidation"],
  Edema: [
    "pulmonary edema",
    "vascular congestion",
    "interstitial edema",
    "kerley b lines",
    "cephalization of pulmonary vessels",
  ],
  Emphysema: [
    "emphysema",
    "hyperinflation",
    "hyperinflated lungs",
    "flattened diaphragm",
    "flattening of the diaphragm",
    "bullous disease",
    "bullae",
  ],
  Fibrosis: [
    "fibrosis",
    "interstitial markings",
    "reticular markings",
    "reticular opacities",
    "fibrotic changes",
    "pulmonary scarring",
    "honeycombing",
  ],
  Pleural_Thickening: ["pleural thickening", "pleural cap", "apical cap", "pleural scarring"],
  Hernia: ["hiatal hernia", "diaphragmatic hernia", "hernia"],
};

// ─── 2. Negation-aware, word-boundary-aware phrase matching ───────────────

/**
 * Cues that mark a phrase as negated ("no pleural effusion"). Deliberately
 * the literal list from the E5 spec — see the caveats section of the generated
 * report for the known false-negative this wording can cause
 * (e.g. "cannot rule out pneumonia" contains the substring "not ").
 */
export const NEGATION_CUES = [
  "no ",
  "without",
  "absence of",
  "not ",
  "free of",
  "unremarkable",
  "clear",
];
/** Defensive cap (chars) so a pathologically long clause can't force scanning a huge prefix; never limits scope for normal report-length sentences (the E5 spec's literal "~40 chars" was tried first and found to under-detect — see clauseStart below). */
const MAX_LOOKBACK = 400;
/**
 * Boundaries that end a negation cue's scope. Sentence punctuation is the
 * obvious case; " but "/" however "/etc. are included because radiology
 * findings commonly flip assertion mid-sentence ("no pneumothorax, however
 * moderate cardiomegaly is present").
 */
const CLAUSE_BREAKERS = [".", "!", "?", "\n", ";", " but ", " however", " although", " though "];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a case-insensitive regex for `phrase`, with \b word boundaries where the phrase starts/ends on a word character. */
export function buildPhraseRegex(phrase: string): RegExp {
  const trimmed = phrase.trim();
  const escaped = escapeRegExp(trimmed);
  const startsWord = /[a-z0-9]/i.test(trimmed[0] ?? "");
  const endsWord = /[a-z0-9]/i.test(trimmed[trimmed.length - 1] ?? "");
  return new RegExp((startsWord ? "\\b" : "") + escaped + (endsWord ? "\\b" : ""), "gi");
}

/**
 * Start-of-clause index for `matchIndex`: just after the closest preceding
 * clause breaker, or 0 if none (meaning the current clause runs all the way
 * back to the start of the text, e.g. the first sentence of a report).
 *
 * A fixed ~40-char window (the E5 spec's literal wording) was tried first
 * and rejected: it under-detects negation for the single most common
 * radiology phrasing pattern — one cue governing a comma-separated list
 * ("without focal consolidation, pneumothorax, or pleural effusion") —
 * because by the third list item the cue is often more than 40 characters
 * back, AND it over-detects across sentence boundaries ("Unremarkable exam.
 * Consolidation is present." would wrongly treat "unremarkable" as negating
 * "consolidation" 20 characters later). Scoping to the current clause fixes
 * both without abandoning the spec's negation-window idea; MAX_LOOKBACK
 * remains as a defensive ceiling only.
 */
function clauseStart(lowerText: string, matchIndex: number): number {
  let best = 0;
  for (const brk of CLAUSE_BREAKERS) {
    const idx = lowerText.lastIndexOf(brk, matchIndex - 1);
    if (idx !== -1) best = Math.max(best, idx + brk.length);
  }
  return best;
}

/** True if a negation cue appears between the start of the current clause and `matchIndex` (capped by MAX_LOOKBACK). */
export function isNegatedAt(lowerText: string, matchIndex: number): boolean {
  const windowStart = Math.max(clauseStart(lowerText, matchIndex), matchIndex - MAX_LOOKBACK);
  const window = lowerText.slice(windowStart, matchIndex);
  return NEGATION_CUES.some((cue) => window.includes(cue));
}

/**
 * True if `phrase` appears in `text` at least once in a non-negated context.
 * Source text convention (per E5 spec): findings[] + abnormalities[].name/
 * .description + summary — NEVER rawResponse, to avoid double-counting the
 * same sentence once as structured output and once as raw model text.
 */
export function textAssertsPhrase(text: string, phrase: string): boolean {
  const lower = text.toLowerCase();
  const regex = buildPhraseRegex(phrase);
  let m: RegExpExecArray | null;
  while ((m = regex.exec(lower)) !== null) {
    if (!isNegatedAt(lower, m.index)) return true;
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return false;
}

/** Join the fields the mapper is allowed to read into one text blob. */
export function buildSourceText(analysis: {
  findings?: unknown;
  abnormalities?: unknown;
  summary?: unknown;
}): string {
  const parts: string[] = [];
  if (Array.isArray(analysis.findings)) {
    for (const f of analysis.findings) if (typeof f === "string") parts.push(f);
  }
  if (Array.isArray(analysis.abnormalities)) {
    for (const ab of analysis.abnormalities) {
      if (ab && typeof ab === "object") {
        const a = ab as { name?: unknown; description?: unknown };
        if (typeof a.name === "string") parts.push(a.name);
        if (typeof a.description === "string") parts.push(a.description);
      }
    }
  }
  if (typeof analysis.summary === "string") parts.push(analysis.summary);
  return parts.join(" . ");
}

/** Detected classes for a piece of source text; empty set ⇒ caller predicts "No Finding". */
export function detectClasses(sourceText: string): Set<NihClass> {
  const detected = new Set<NihClass>();
  for (const cls of NIH_CLASSES) {
    if (CLASS_SYNONYMS[cls].some((phrase) => textAssertsPhrase(sourceText, phrase))) {
      detected.add(cls);
    }
  }
  return detected;
}

// ─── 3. Ground truth + set comparison helpers ──────────────────────────────

/** Parse a NIH "Finding Labels" cell ("Effusion|Fibrosis" or "No Finding") into the set of real pathology classes (never contains "No Finding"). */
export function parseLabelsField(field: string): Set<string> {
  return new Set(
    field
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "No Finding")
  );
}

/** Represent an empty real-class set as the sentinel {"No Finding"} so exact-match/Jaccard treat "both normal" as agreement. */
export function toComparableSet(real: Set<string>): Set<string> {
  return real.size === 0 ? new Set(["No Finding"]) : new Set(real);
}

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function setJaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / union.size;
}

export interface PerImageMetrics {
  exactMatch: boolean;
  jaccard: number;
  overCalled: string[]; // classes the model asserted that NIH did not list
  underCalled: string[]; // classes NIH listed that the model did not assert
}

export function computePerImageMetrics(
  predictedReal: Set<string>,
  gtReal: Set<string>
): PerImageMetrics {
  const predictedComparable = toComparableSet(predictedReal);
  const gtComparable = toComparableSet(gtReal);
  return {
    exactMatch: setsEqual(predictedComparable, gtComparable),
    jaccard: setJaccard(predictedComparable, gtComparable),
    overCalled: [...predictedReal].filter((c) => !gtReal.has(c)).sort(),
    underCalled: [...gtReal].filter((c) => !predictedReal.has(c)).sort(),
  };
}

// ─── 4. Per-class confusion + precision/recall/F1 ──────────────────────────

export interface ClassConfusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function newClassConfusionTable(): Record<NihClass, ClassConfusion> {
  const table = {} as Record<NihClass, ClassConfusion>;
  for (const c of NIH_CLASSES) table[c] = { tp: 0, fp: 0, fn: 0, tn: 0 };
  return table;
}

export function accumulateClassConfusion(
  table: Record<NihClass, ClassConfusion>,
  predictedReal: Set<string>,
  gtReal: Set<string>
): void {
  for (const cls of NIH_CLASSES) {
    const p = predictedReal.has(cls);
    const g = gtReal.has(cls);
    if (p && g) table[cls].tp++;
    else if (p && !g) table[cls].fp++;
    else if (!p && g) table[cls].fn++;
    else table[cls].tn++;
  }
}

export interface ClassMetrics {
  precision: number | null; // null when tp+fp === 0 (model never predicted this class)
  recall: number | null; // null when tp+fn === 0 (class never in ground truth)
  f1: number | null;
  support: number; // tp + fn (# images where NIH listed this class)
}

export function computeClassMetrics(c: ClassConfusion): ClassMetrics {
  const precision = c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, support: c.tp + c.fn };
}

export interface AveragedMetrics {
  macroPrecision: number | null;
  macroRecall: number | null;
  macroF1: number | null;
  microPrecision: number | null;
  microRecall: number | null;
  microF1: number | null;
}

/** Macro average is over classes that have a defined value (i.e. at least one prediction or one ground-truth occurrence); micro average pools tp/fp/fn across all 14 classes first. */
export function averageClassMetrics(table: Record<NihClass, ClassConfusion>): AveragedMetrics {
  const perClass = NIH_CLASSES.map((c) => computeClassMetrics(table[c]));
  const macro = (values: (number | null)[]): number | null => {
    const defined = values.filter((v): v is number => v !== null);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  };
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const c of NIH_CLASSES) {
    tp += table[c].tp;
    fp += table[c].fp;
    fn += table[c].fn;
  }
  const microPrecision = tp + fp === 0 ? null : tp / (tp + fp);
  const microRecall = tp + fn === 0 ? null : tp / (tp + fn);
  const microF1 =
    microPrecision === null || microRecall === null || microPrecision + microRecall === 0
      ? null
      : (2 * microPrecision * microRecall) / (microPrecision + microRecall);
  return {
    macroPrecision: macro(perClass.map((m) => m.precision)),
    macroRecall: macro(perClass.map((m) => m.recall)),
    macroF1: macro(perClass.map((m) => m.f1)),
    microPrecision,
    microRecall,
    microF1,
  };
}

// ─── 5. "No Finding" specificity/sensitivity ───────────────────────────────

export interface NoFindingConfusion {
  bothNormal: number; // GT No Finding, predicted No Finding (TP for "normal")
  missedAbnormalCall: number; // GT No Finding, predicted a pathology (FN for "normal" / model over-calls)
  falseReassurance: number; // GT abnormal, predicted No Finding (FP for "normal" — clinically the dangerous direction)
  bothAbnormal: number; // GT abnormal, predicted a pathology (TN for "normal")
}

export function newNoFindingConfusion(): NoFindingConfusion {
  return { bothNormal: 0, missedAbnormalCall: 0, falseReassurance: 0, bothAbnormal: 0 };
}

export function accumulateNoFindingConfusion(
  acc: NoFindingConfusion,
  predictedReal: Set<string>,
  gtReal: Set<string>
): void {
  const gtNormal = gtReal.size === 0;
  const predNormal = predictedReal.size === 0;
  if (gtNormal && predNormal) acc.bothNormal++;
  else if (gtNormal && !predNormal) acc.missedAbnormalCall++;
  else if (!gtNormal && predNormal) acc.falseReassurance++;
  else acc.bothAbnormal++;
}

export interface NoFindingRates {
  sensitivity: number | null; // of truly-normal images, fraction predicted normal
  specificity: number | null; // of truly-abnormal images, fraction predicted abnormal (i.e. NOT falsely reassured)
}

export function noFindingRates(c: NoFindingConfusion): NoFindingRates {
  const normalTotal = c.bothNormal + c.missedAbnormalCall;
  const abnormalTotal = c.falseReassurance + c.bothAbnormal;
  return {
    sensitivity: normalTotal === 0 ? null : c.bothNormal / normalTotal,
    specificity: abnormalTotal === 0 ? null : c.bothAbnormal / abnormalTotal,
  };
}

// ─── 6. Per-patient trajectory direction (E4 / E4L only) ──────────────────

export type Direction =
  "worsening" | "improving" | "stable-normal" | "stable-pathology" | "mixed-pathology-change";

export type ExpectedProgression = "Improving" | "Stable" | "Worsening" | "Inconclusive";

/**
 * Derive the NIH-label trajectory direction from the first vs. last study in
 * a patient's cohort sequence. "mixed-pathology-change" is a documented
 * extension beyond the four buckets in the E5 spec, covering the case not
 * named there: pathology present at both ends but with zero overlap (e.g.
 * Nodule → Effusion) — neither purely "worsening" nor "improving" nor a
 * repeat of the same pathology, so it maps to "Inconclusive" downstream.
 */
export function deriveDirection(sequence: { followup: number; labels: string }[]): Direction {
  if (sequence.length === 0) throw new Error("deriveDirection: empty sequence");
  const sorted = [...sequence].sort((a, b) => a.followup - b.followup);
  const first = parseLabelsField(sorted[0]!.labels);
  const last = parseLabelsField(sorted[sorted.length - 1]!.labels);
  const firstEmpty = first.size === 0;
  const lastEmpty = last.size === 0;
  if (firstEmpty && lastEmpty) return "stable-normal";
  if (firstEmpty && !lastEmpty) return "worsening";
  if (!firstEmpty && lastEmpty) return "improving";
  const overlap = [...first].some((c) => last.has(c));
  return overlap ? "stable-pathology" : "mixed-pathology-change";
}

/** E4L cohorts carry a pre-computed `stratum` ("worsening-like" etc.); reuse it rather than re-deriving. */
export function mapStratumToDirection(stratum: string): Direction | null {
  const map: Record<string, Direction> = {
    "worsening-like": "worsening",
    "improving-like": "improving",
    "stable-pathology": "stable-pathology",
    "stable-normal": "stable-normal",
  };
  return map[stratum] ?? null;
}

/**
 * Every member of the pipeline's `ProgressionStatus` enum. Typed as
 * `readonly ProgressionStatus[]` so that adding a member to the domain type
 * without adding it here is a compile error.
 */
export const PROGRESSION_VALUES: readonly ProgressionStatus[] = [
  "Improving",
  "Stable",
  "Worsening",
  "Inconclusive",
  "SingleSeries",
];

/**
 * Whether an evolution artefact's `progression` is usable as a direction label.
 *
 * This is the *only* gate on the direction row. It deliberately ignores
 * `validation.ok`: the pipeline's fallback takes `progression` from the
 * response's own partial JSON whenever it is a valid enum member, so a record
 * whose `trends[]` carried a fifth, out-of-enum trend value still has a
 * trustworthy top-level verdict. Scoring such a run as "no valid evolution
 * artefact" discarded 6 of the SIME-2026 batch's direction rows even though
 * each one's `progression` was a clean enum value.
 */
export function isProgressionStatus(value: unknown): value is ProgressionStatus {
  return typeof value === "string" && (PROGRESSION_VALUES as readonly string[]).includes(value);
}

export function directionToExpectedProgression(d: Direction): ExpectedProgression {
  switch (d) {
    case "worsening":
      return "Worsening";
    case "improving":
      return "Improving";
    case "stable-normal":
    case "stable-pathology":
      return "Stable";
    case "mixed-pathology-change":
      return "Inconclusive";
  }
}

// ─── 7. Run id parsing ──────────────────────────────────────────────────────

export interface RunIdInfo {
  cohort: string;
  patientId?: string;
  sizeLabel?: string;
  concurrency?: string;
  provider: string;
  model: string;
}

/**
 * Parse an experiment run folder name into cohort/patient/provider/model.
 * Observed shapes:
 *   E4-00000067-openrouter-google_gemini-2.5-flash
 *   E4L-<patientId>-openrouter-anthropic_claude-sonnet-5
 *   E2-S1x1-c1-openrouter-google_gemini-2.5-flash
 *   E2-S1x1-c1-gemini-2.5-flash                    (direct Google API, no vendor prefix)
 *   E2-S2x5-c5-google-gemini-2.5-flash              (direct Google API, explicit "google-" prefix)
 * For openrouter ids, the vendor/model pair is joined with "_" in the folder
 * name ("google_gemini-2.5-flash") and reconstructed here as "google/gemini-2.5-flash"
 * to match run_manifest.json's `model` field.
 */
export function parseRunId(id: string): RunIdInfo {
  const parts = id.split("-");
  const cohort = parts[0] ?? "";
  let rest: string[];
  let patientId: string | undefined;
  let sizeLabel: string | undefined;
  let concurrency: string | undefined;
  if (cohort === "E4" || cohort === "E4L") {
    patientId = parts[1];
    rest = parts.slice(2);
  } else if (cohort === "E2") {
    sizeLabel = parts[1];
    concurrency = parts[2];
    rest = parts.slice(3);
  } else {
    rest = parts.slice(1);
  }
  const restStr = rest.join("-");
  let provider: string;
  let model: string;
  if (restStr.startsWith("openrouter-")) {
    provider = "openrouter";
    const modelPart = restStr.slice("openrouter-".length);
    const underscore = modelPart.indexOf("_");
    model =
      underscore === -1
        ? modelPart
        : modelPart.slice(0, underscore) + "/" + modelPart.slice(underscore + 1);
  } else if (restStr.startsWith("google-")) {
    provider = "google";
    model = restStr.slice("google-".length);
  } else {
    // No vendor prefix in the folder name: this batch's convention for the
    // direct (non-OpenRouter) Google Gemini API calls.
    provider = "google";
    model = restStr;
  }
  return { cohort, patientId, sizeLabel, concurrency, provider, model };
}

// ─── 8. Artifact status classification ─────────────────────────────────────

export type ArtifactStatus = "ok" | "invalid" | "error" | "malformed";

/**
 * Classify a parsed *_analysis.json:
 *  - "error"     status:"error" — provider/network call failed, no content at all.
 *  - "invalid"   status:"success" but validation.ok === false — the model's
 *                JSON failed the app's own Zod schema (seen with gemma-4-31b-it).
 *  - "ok"        usable structured output (validation.ok true, or the field
 *                is simply absent, which older artefacts may not carry).
 *  - "malformed" not even a parseable object (should not occur; defensive).
 * "invalid" and "error" rows are excluded from the metric aggregations
 * (they are not real predictions) but are still listed in the full per-image
 * table for transparency, with their status flagged.
 */
export function classifyArtifact(a: unknown): ArtifactStatus {
  if (a === null || typeof a !== "object") return "malformed";
  const rec = a as Record<string, unknown>;
  if (rec.status === "error") return "error";
  const validation = rec.validation as { ok?: unknown } | undefined;
  if (validation && validation.ok === false) return "invalid";
  return "ok";
}

// ─── 9. Filesystem loading ──────────────────────────────────────────────────

/** Parse Data_Entry_2017.csv into Image Index → Finding Labels. Mirrors full-dataset-scan.ts's parseMetadataCsv (no quoted commas in this file). */
export function parseNihCsv(text: string): Map<string, string> {
  const lines = text.split("\n");
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    const image = cols[0];
    if (image) map.set(image, cols[1] ?? "");
  }
  return map;
}

const ANALYSIS_FILENAME_RE = /^(?:img_\d+_)?(\d{8}_\d{3})_analysis\.json$/;

/** "img_05_00010693_004_analysis.json" or "00000067_000_analysis.json" → "00010693_004.png" */
export function imageFilenameFromAnalysisFilename(filename: string): string | null {
  const m = ANALYSIS_FILENAME_RE.exec(filename);
  return m ? `${m[1]}.png` : null;
}

/** First 8 characters of a NIH image filename are always the zero-padded patient id. */
export function patientIdFromImageFilename(imageFilename: string): string {
  return imageFilename.slice(0, 8);
}

interface NihSelection {
  E4: Record<string, { image: string; followup: number; labels: string }[]>;
  E4L: Record<
    string,
    {
      stratum: string;
      studies: { image: string; followup: number; labels: string }[];
      report_label_trajectory?: string;
    }
  >;
  E2: Record<string, { image: string; labels: string; patient: string }>;
}

export interface PerImageRow {
  runId: string;
  cohort: string;
  patientId: string;
  provider: string;
  model: string;
  image: string;
  gtLabels: string; // raw NIH "Finding Labels" cell
  predictedClasses: string[]; // sorted, empty ⇒ "No Finding"
  status: ArtifactStatus;
  errorMessage?: string;
  exactMatch: boolean | null; // null when excluded from metrics (invalid/error/missing GT)
  jaccard: number | null;
  overCalled: string[];
  underCalled: string[];
}

export interface DirectionRow {
  runId: string;
  cohort: string;
  patientId: string;
  provider: string;
  model: string;
  stratumSource: "provided" | "derived";
  direction: Direction;
  expectedProgression: ExpectedProgression;
  modelProgression: string | null;
  agree: boolean | null; // null when the evolution artefact was invalid/missing
  /**
   * True when `modelProgression` came from a record whose `validation.ok` is
   * false — i.e. the enum value was recovered by the pipeline's partial-JSON
   * fallback after a sibling field (typically `trends[].trend`) failed the
   * schema. The row is scored normally; the flag keeps the provenance visible.
   */
  progressionRecovered: boolean;
}

export interface ModelKey {
  provider: string;
  model: string;
}

function modelKeyString(k: ModelKey): string {
  return `${k.provider}/${k.model}`;
}

export interface LoadedData {
  perImageRows: PerImageRow[];
  directionRows: DirectionRow[];
  runIds: string[];
  skippedRuns: { runId: string; reason: string }[];
  /** Direction rows scored from a fallback-recovered `progression` (see {@link DirectionRow.progressionRecovered}). */
  recoveredProgressionRows: number;
}

/**
 * Walk every run directory under `runsDir`, extract per-image comparison
 * rows for cohorts E4/E4L/E2, and per-patient direction rows for E4/E4L.
 * Pure I/O; all comparison logic above is unit-tested independently of this
 * function via fixtures.
 */
export function loadRuns(
  runsDir: string,
  csvLabels: Map<string, string>,
  selection: NihSelection
): LoadedData {
  const perImageRows: PerImageRow[] = [];
  const directionRows: DirectionRow[] = [];
  let recoveredProgressionRows = 0;
  const runIds: string[] = [];
  const skippedRuns: { runId: string; reason: string }[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read runs directory ${runsDir}: ${(err as Error).message}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const info = parseRunId(runId);
    if (info.cohort !== "E4" && info.cohort !== "E4L" && info.cohort !== "E2") {
      skippedRuns.push({ runId, reason: `unrecognised cohort "${info.cohort}"` });
      continue;
    }
    const outputDir = path.join(runsDir, runId, "output");
    if (!fs.existsSync(outputDir)) {
      skippedRuns.push({ runId, reason: "no output/ directory (run did not complete)" });
      continue;
    }

    // Reconcile provider/model against run_manifest.json when present.
    let provider = info.provider;
    let model = info.model;
    const manifestPath = path.join(outputDir, "run_manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
          provider?: string;
          model?: string;
        };
        if (typeof manifest.provider === "string") provider = manifest.provider;
        if (typeof manifest.model === "string") model = manifest.model;
      } catch {
        // manifest present but unparsable — keep the id-derived provider/model.
      }
    }

    runIds.push(runId);

    // Per-image rows: every series_*/*_analysis.json.
    let seriesDirs: string[] = [];
    try {
      seriesDirs = fs
        .readdirSync(outputDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("series_"))
        .map((d) => d.name);
    } catch {
      seriesDirs = [];
    }
    for (const seriesDir of seriesDirs) {
      const dirPath = path.join(outputDir, seriesDir);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dirPath).filter((f) => f.endsWith("_analysis.json"));
      } catch {
        continue;
      }
      for (const file of files) {
        const image = imageFilenameFromAnalysisFilename(file);
        if (!image) continue; // not a per-image analysis artefact
        let parsed: unknown;
        try {
          parsed = JSON.parse(fs.readFileSync(path.join(dirPath, file), "utf8"));
        } catch {
          perImageRows.push({
            runId,
            cohort: info.cohort,
            patientId: info.patientId ?? patientIdFromImageFilename(image),
            provider,
            model,
            image,
            gtLabels: csvLabels.get(image) ?? "",
            predictedClasses: [],
            status: "malformed",
            exactMatch: null,
            jaccard: null,
            overCalled: [],
            underCalled: [],
          });
          continue;
        }
        const status = classifyArtifact(parsed);
        const rec = parsed as Record<string, unknown>;
        const patientId = info.patientId ?? patientIdFromImageFilename(image);
        const gtLabels = csvLabels.get(image);
        let predictedReal = new Set<string>();
        if (status === "ok") {
          predictedReal = detectClasses(buildSourceText(rec));
        }
        let exactMatch: boolean | null = null;
        let jaccard: number | null = null;
        let overCalled: string[] = [];
        let underCalled: string[] = [];
        if (status === "ok" && gtLabels !== undefined) {
          const gtReal = parseLabelsField(gtLabels);
          const m = computePerImageMetrics(predictedReal, gtReal);
          exactMatch = m.exactMatch;
          jaccard = m.jaccard;
          overCalled = m.overCalled;
          underCalled = m.underCalled;
        }
        perImageRows.push({
          runId,
          cohort: info.cohort,
          patientId,
          provider,
          model,
          image,
          gtLabels: gtLabels ?? "",
          predictedClasses: [...predictedReal].sort(),
          status,
          errorMessage: typeof rec.errorMessage === "string" ? rec.errorMessage : undefined,
          exactMatch,
          jaccard,
          overCalled,
          underCalled,
        });
      }
    }

    // Direction row: only for single-patient cohorts E4/E4L.
    if ((info.cohort === "E4" || info.cohort === "E4L") && info.patientId) {
      const patientId = info.patientId;
      let sequence: { followup: number; labels: string }[] | undefined;
      let direction: Direction | undefined;
      let stratumSource: "provided" | "derived" = "derived";
      if (info.cohort === "E4L") {
        const entryL = selection.E4L[patientId];
        if (entryL) {
          sequence = entryL.studies;
          const mapped = mapStratumToDirection(entryL.stratum);
          if (mapped) {
            direction = mapped;
            stratumSource = "provided";
          }
        }
      } else {
        sequence = selection.E4[patientId];
      }
      if (sequence && sequence.length > 0) {
        if (!direction) direction = deriveDirection(sequence);
        const expectedProgression = directionToExpectedProgression(direction);
        const evoPath = path.join(outputDir, "evolution_analysis.json");
        let modelProgression: string | null = null;
        let agree: boolean | null = null;
        let progressionRecovered = false;
        if (fs.existsSync(evoPath)) {
          try {
            const evo = JSON.parse(fs.readFileSync(evoPath, "utf8")) as {
              progression?: unknown;
              validation?: { ok?: unknown };
            };
            // The gate is the enum, not `validation.ok`: a record whose
            // `trends[]` failed the schema still carries the model's own
            // top-level verdict, recovered verbatim by the pipeline's
            // partial-JSON fallback. Only an absent or non-enum `progression`
            // leaves the row unscored.
            if (isProgressionStatus(evo.progression)) {
              modelProgression = evo.progression;
              progressionRecovered = evo.validation?.ok === false;
              agree = modelProgression === expectedProgression;
            }
          } catch {
            // unparsable evolution artefact — leave modelProgression/agree null.
          }
        }
        if (progressionRecovered) recoveredProgressionRows++;
        directionRows.push({
          runId,
          cohort: info.cohort,
          patientId,
          provider,
          model,
          stratumSource,
          direction,
          expectedProgression,
          modelProgression,
          agree,
          progressionRecovered,
        });
      }
    }
  }

  return { perImageRows, directionRows, runIds, skippedRuns, recoveredProgressionRows };
}

// ─── 10. Aggregation ─────────────────────────────────────────────────────

export interface ModelAggregate {
  key: string;
  provider: string;
  model: string;
  totalImages: number;
  usableImages: number; // status "ok" with matched ground truth
  invalidCount: number;
  errorCount: number;
  malformedCount: number;
  gtMissingCount: number;
  exactMatchCount: number;
  exactMatchRate: number | null;
  meanJaccard: number | null;
  classConfusion: Record<NihClass, ClassConfusion>;
  averaged: AveragedMetrics;
  noFinding: NoFindingConfusion;
  noFindingRates: NoFindingRates;
}

export function aggregateByModel(rows: PerImageRow[]): Map<string, ModelAggregate> {
  const byModel = new Map<string, ModelAggregate>();
  for (const row of rows) {
    const key = modelKeyString({ provider: row.provider, model: row.model });
    let agg = byModel.get(key);
    if (!agg) {
      agg = {
        key,
        provider: row.provider,
        model: row.model,
        totalImages: 0,
        usableImages: 0,
        invalidCount: 0,
        errorCount: 0,
        malformedCount: 0,
        gtMissingCount: 0,
        exactMatchCount: 0,
        exactMatchRate: null,
        meanJaccard: null,
        classConfusion: newClassConfusionTable(),
        averaged: {
          macroPrecision: null,
          macroRecall: null,
          macroF1: null,
          microPrecision: null,
          microRecall: null,
          microF1: null,
        },
        noFinding: newNoFindingConfusion(),
        noFindingRates: { sensitivity: null, specificity: null },
      };
      byModel.set(key, agg);
    }
    agg.totalImages++;
    if (row.status === "invalid") agg.invalidCount++;
    else if (row.status === "error") agg.errorCount++;
    else if (row.status === "malformed") agg.malformedCount++;
    else if (row.status === "ok" && row.exactMatch === null) agg.gtMissingCount++;
    else if (row.status === "ok" && row.exactMatch !== null) {
      agg.usableImages++;
      if (row.exactMatch) agg.exactMatchCount++;
      const predictedReal = new Set(row.predictedClasses);
      const gtReal = parseLabelsField(row.gtLabels);
      accumulateClassConfusion(agg.classConfusion, predictedReal, gtReal);
      accumulateNoFindingConfusion(agg.noFinding, predictedReal, gtReal);
    }
  }
  for (const agg of byModel.values()) {
    agg.exactMatchRate = agg.usableImages === 0 ? null : agg.exactMatchCount / agg.usableImages;
    const jaccards = rows
      .filter(
        (r) =>
          modelKeyString({ provider: r.provider, model: r.model }) === agg.key && r.jaccard !== null
      )
      .map((r) => r.jaccard as number);
    agg.meanJaccard =
      jaccards.length === 0 ? null : jaccards.reduce((a, b) => a + b, 0) / jaccards.length;
    agg.averaged = averageClassMetrics(agg.classConfusion);
    agg.noFindingRates = noFindingRates(agg.noFinding);
  }
  return byModel;
}

export interface DirectionAggregate {
  key: string; // model key, or model key + "|" + stratum for per-stratum breakdown
  total: number;
  agreeCount: number;
  agreeRate: number | null;
  /** Of `total`, how many rows were scored from a fallback-recovered `progression`. */
  recoveredCount: number;
  confusion: Record<ExpectedProgression, Record<string, number>>; // expected -> modelProgression(or "null") -> count
}

function newDirectionAggregate(key: string): DirectionAggregate {
  return {
    key,
    total: 0,
    agreeCount: 0,
    agreeRate: null,
    recoveredCount: 0,
    confusion: { Improving: {}, Stable: {}, Worsening: {}, Inconclusive: {} },
  };
}

function bumpConfusion(
  agg: DirectionAggregate,
  expected: ExpectedProgression,
  actual: string | null
): void {
  const col = actual ?? "(no valid evolution artefact)";
  agg.confusion[expected][col] = (agg.confusion[expected][col] ?? 0) + 1;
}

export function aggregateDirectionByModel(rows: DirectionRow[]): Map<string, DirectionAggregate> {
  const byModel = new Map<string, DirectionAggregate>();
  for (const row of rows) {
    const key = modelKeyString({ provider: row.provider, model: row.model });
    let agg = byModel.get(key);
    if (!agg) {
      agg = newDirectionAggregate(key);
      byModel.set(key, agg);
    }
    agg.total++;
    if (row.agree === true) agg.agreeCount++;
    if (row.progressionRecovered) agg.recoveredCount++;
    bumpConfusion(agg, row.expectedProgression, row.modelProgression);
  }
  for (const agg of byModel.values()) {
    const evaluable = rows.filter(
      (r) =>
        modelKeyString({ provider: r.provider, model: r.model }) === agg.key && r.agree !== null
    ).length;
    agg.agreeRate = evaluable === 0 ? null : agg.agreeCount / evaluable;
  }
  return byModel;
}

/** key = "<modelKey>||<direction-source-value>" (E4L uses the original stratum string; E4 uses the derived Direction). */
export function aggregateDirectionByModelAndStratum(
  rows: DirectionRow[]
): Map<string, DirectionAggregate> {
  const byKey = new Map<string, DirectionAggregate>();
  for (const row of rows) {
    const modelKey = modelKeyString({ provider: row.provider, model: row.model });
    const stratumLabel = row.direction;
    const key = `${modelKey}||${stratumLabel}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = newDirectionAggregate(key);
      byKey.set(key, agg);
    }
    agg.total++;
    if (row.agree === true) agg.agreeCount++;
    if (row.progressionRecovered) agg.recoveredCount++;
    bumpConfusion(agg, row.expectedProgression, row.modelProgression);
  }
  for (const [key, agg] of byKey) {
    const [modelKey, stratumLabel] = key.split("||");
    const evaluable = rows.filter(
      (r) =>
        modelKeyString({ provider: r.provider, model: r.model }) === modelKey &&
        r.direction === stratumLabel &&
        r.agree !== null
    ).length;
    agg.agreeRate = evaluable === 0 ? null : agg.agreeCount / evaluable;
  }
  return byKey;
}

// ─── 11. Markdown rendering ─────────────────────────────────────────────────

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | null, digits = 3): string {
  return n === null ? "—" : n.toFixed(digits);
}

export function renderMarkdown(
  data: LoadedData,
  modelAggregates: Map<string, ModelAggregate>,
  directionByModel: Map<string, DirectionAggregate>,
  directionByModelStratum: Map<string, DirectionAggregate>,
  generatedAt: string
): string {
  const lines: string[] = [];
  lines.push("# E5 — Label agreement (NIH ChestX-ray14 vs. model output)");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`Run ids included (${data.runIds.length}):`);
  lines.push("");
  for (const id of [...data.runIds].sort()) lines.push(`- \`${id}\``);
  if (data.skippedRuns.length > 0) {
    lines.push("");
    lines.push(`Skipped run directories (${data.skippedRuns.length}):`);
    lines.push("");
    for (const s of data.skippedRuns) lines.push(`- \`${s.runId}\` — ${s.reason}`);
  }
  lines.push("");
  lines.push(
    "**This report is regenerated, never hand-edited.** It reflects exactly the run directories present under " +
      "`experiments/sime2026/runs/` at generation time — see the run-id list above for what was included. " +
      "Re-run `node_modules/.bin/tsx experiments/sime2026/label-agreement.ts` to rebuild it and its `.json` sibling."
  );
  lines.push("");

  // ── Method + caveats ──
  lines.push("## Method and honest caveats — read before the tables");
  lines.push("");
  lines.push(
    '- **NIH labels are not ground truth.** The 14 ChestX-ray14 "Finding Labels" were mined from radiology ' +
      "report text with NLP (DNorm/NegBio), not assigned by a radiologist looking at each image. Wang et al., " +
      'CVPR 2017 report ~90% label accuracy for the NLP mining step, so a portion of the "disagreements" below ' +
      "are actually errors in the reference labels, not the model."
  );
  lines.push(
    "- **The images are 224px downsampled**, well below diagnostic resolution (clinical CXR is typically read at " +
      "2000+ px). Findings that require fine detail (small nodules, subtle interstitial change) are not fairly " +
      "assessable at this resolution, by a model or a human."
  );
  lines.push(
    "- **The synonym mapping (`CLASS_SYNONYMS`) is a heuristic text-matcher**, not a clinically validated NLP " +
      "labeler. It is negation-aware (skips a phrase preceded, anywhere in its current clause/sentence, by cues " +
      'like "no ", "without", "not ") but that is a blunt instrument — e.g. "cannot rule out pneumonia" ' +
      'contains the substring "not " and would be (incorrectly) treated as a negated mention.'
  );
  lines.push(
    "- **Source text = `findings[]` + `abnormalities[].name`/`.description` + `summary` only — never `rawResponse`**, " +
      "to avoid counting the same sentence twice (rawResponse is the raw JSON the structured fields were parsed from)."
  );
  lines.push(
    '- **"No Finding" rows**: when the mapper detects zero of the 14 classes in a report, the prediction is ' +
      '"No Finding" per the E5 spec, regardless of how confidently or hedgingly the model phrased its normal read.'
  );
  lines.push(
    "- **This is descriptive agreement between free text and a keyword-mined label set, NOT a diagnostic-accuracy " +
      "or clinical-validation study.** Do not report F1/precision/recall figures below as sensitivity/specificity " +
      "of the underlying vision-language model at detecting disease — they measure agreement with an imperfect, " +
      "NLP-derived reference under a heuristic text mapper, on sub-diagnostic-resolution images."
  );
  lines.push(
    "- Per-image rows whose artefact `status` is `invalid` (structured output failed the app's Zod schema — seen " +
      "with `google/gemma-4-31b-it`) or `error` (the API call itself failed) are **excluded from all metric " +
      "tables** below (they are not real predictions) but are still listed in the full per-image table, flagged, " +
      "for transparency."
  );
  lines.push("");

  // ── Per-image table, grouped by model ──
  lines.push("## Per-image results (full table, grouped by model)");
  lines.push("");
  const rowsByModel = new Map<string, PerImageRow[]>();
  for (const row of data.perImageRows) {
    const key = modelKeyString({ provider: row.provider, model: row.model });
    if (!rowsByModel.has(key)) rowsByModel.set(key, []);
    rowsByModel.get(key)!.push(row);
  }
  for (const key of [...rowsByModel.keys()].sort()) {
    const rows = rowsByModel.get(key)!.sort((a, b) => a.image.localeCompare(b.image));
    lines.push(`### ${key}`);
    lines.push("");
    lines.push(
      "| image | patient | cohort | run id | NIH labels | model classes | status | exact match | jaccard | over-called | under-called |"
    );
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const predicted =
        r.predictedClasses.length === 0 && r.status === "ok"
          ? "No Finding"
          : r.predictedClasses.join(", ") || "—";
      const gt = (r.gtLabels || "No Finding").split("|").join(", ");
      const exact = r.exactMatch === null ? "—" : r.exactMatch ? "yes" : "no";
      const jac = r.jaccard === null ? "—" : r.jaccard.toFixed(2);
      const shortError = r.errorMessage ? r.errorMessage.split("\n")[0]!.slice(0, 80) : undefined;
      const statusFlag =
        r.status === "ok" ? "ok" : `${r.status}${shortError ? ` (${shortError}…)` : ""}`;
      lines.push(
        `| ${r.image} | ${r.patientId} | ${r.cohort} | \`${r.runId}\` | ${gt} | ${predicted} | ${statusFlag} | ${exact} | ${jac} | ${r.overCalled.join(", ") || "—"} | ${r.underCalled.join(", ") || "—"} |`
      );
    }
    lines.push("");
  }

  // ── Per-class metrics per model ──
  lines.push("## Per-class metrics per model");
  lines.push("");
  for (const key of [...modelAggregates.keys()].sort()) {
    const agg = modelAggregates.get(key)!;
    lines.push(`### ${key}`);
    lines.push("");
    lines.push(
      `Images: ${agg.totalImages} total, ${agg.usableImages} usable for metrics ` +
        `(excluded: ${agg.invalidCount} invalid-output, ${agg.errorCount} API error, ${agg.malformedCount} malformed, ${agg.gtMissingCount} missing ground truth).`
    );
    lines.push("");
    lines.push(
      `Exact-set match rate: **${pct(agg.exactMatchRate)}** (${agg.exactMatchCount}/${agg.usableImages}). Mean Jaccard: **${num(agg.meanJaccard, 3)}**.`
    );
    lines.push("");
    lines.push(
      `"No Finding" sensitivity (of truly-normal images, % predicted normal): **${pct(agg.noFindingRates.sensitivity)}**. ` +
        `"No Finding" specificity (of truly-abnormal images, % NOT falsely called normal): **${pct(agg.noFindingRates.specificity)}**.`
    );
    lines.push("");
    lines.push("| class | TP | FP | FN | TN | support | precision | recall | F1 |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const cls of NIH_CLASSES) {
      const c = agg.classConfusion[cls];
      const m = computeClassMetrics(c);
      lines.push(
        `| ${cls} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.tn} | ${m.support} | ${num(m.precision, 3)} | ${num(m.recall, 3)} | ${num(m.f1, 3)} |`
      );
    }
    lines.push(
      `| **macro avg** | | | | | | ${num(agg.averaged.macroPrecision, 3)} | ${num(agg.averaged.macroRecall, 3)} | ${num(agg.averaged.macroF1, 3)} |`
    );
    lines.push(
      `| **micro avg** | | | | | | ${num(agg.averaged.microPrecision, 3)} | ${num(agg.averaged.microRecall, 3)} | ${num(agg.averaged.microF1, 3)} |`
    );
    lines.push("");
  }

  // ── Direction agreement ──
  lines.push("## Per-patient trajectory direction agreement (E4 / E4L only)");
  lines.push("");
  if (data.directionRows.length === 0) {
    lines.push(
      "No E4/E4L runs with a resolvable cohort sequence were present in the included run set."
    );
    lines.push("");
  } else {
    lines.push(
      "Direction is derived from the first vs. last study's NIH labels for the patient's cohort sequence " +
        "(worsening: normal→pathology; improving: pathology→normal; stable-normal: normal throughout; " +
        "stable-pathology: pathology at both ends with class overlap; mixed-pathology-change: pathology at both " +
        "ends with no overlapping class — an extension beyond the spec's four named buckets, mapped to " +
        '"Inconclusive" below since it is neither a clean worsening nor improving nor a repeat finding). ' +
        "E4L reuses the pre-computed `stratum` from `nih-selection.json` when present; E4 always derives."
    );
    lines.push("");
    lines.push(
      "**A row is scored whenever the evolution artefact's top-level `progression` is a valid " +
        "`ProgressionStatus` value, even if `validation.ok` is false.** When a sibling field (in practice " +
        "`trends[].trend`) carries an out-of-enum value the whole record fails Zod validation, but the " +
        "pipeline's partial-JSON fallback still takes the model's own top-level verdict verbatim, so that " +
        "verdict is a real direction label and is scored here. Such rows are flagged `recovered` in the table " +
        "below and counted in `directionByModel[].recoveredCount` in the JSON sibling. Only an absent " +
        "`progression`, a non-enum value, or an unreadable artefact leaves a row unscored " +
        '("(no valid evolution artefact)").'
    );
    lines.push("");
    lines.push(
      `Direction rows scored via that recovered path: **${data.recoveredProgressionRows}** of ${data.directionRows.length}.`
    );
    lines.push("");
    lines.push("### Per-patient table");
    lines.push("");
    lines.push(
      "| patient | cohort | run id | model | stratum source | direction | expected progression | model progression | progression source | agree |"
    );
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const r of [...data.directionRows].sort((a, b) =>
      a.patientId.localeCompare(b.patientId)
    )) {
      const source =
        r.modelProgression === null ? "—" : r.progressionRecovered ? "recovered" : "validated";
      lines.push(
        `| ${r.patientId} | ${r.cohort} | \`${r.runId}\` | ${r.provider}/${r.model} | ${r.stratumSource} | ${r.direction} | ${r.expectedProgression} | ${r.modelProgression ?? "—"} | ${source} | ${r.agree === null ? "—" : r.agree ? "yes" : "no"} |`
      );
    }
    lines.push("");
    lines.push("### Agreement rate per model");
    lines.push("");
    lines.push("| model | patients | agreement rate | of which recovered |");
    lines.push("|---|---|---|---|");
    for (const key of [...directionByModel.keys()].sort()) {
      const agg = directionByModel.get(key)!;
      lines.push(`| ${key} | ${agg.total} | ${pct(agg.agreeRate)} | ${agg.recoveredCount} |`);
    }
    lines.push("");
    lines.push("### Agreement rate per model × derived direction bucket");
    lines.push("");
    lines.push("| model | direction bucket | patients | agreement rate | of which recovered |");
    lines.push("|---|---|---|---|---|");
    for (const key of [...directionByModelStratum.keys()].sort()) {
      const agg = directionByModelStratum.get(key)!;
      const [modelKey, stratum] = key.split("||");
      lines.push(
        `| ${modelKey} | ${stratum} | ${agg.total} | ${pct(agg.agreeRate)} | ${agg.recoveredCount} |`
      );
    }
    lines.push("");
    lines.push("### Confusion matrix per model (expected progression → model progression)");
    lines.push("");
    for (const key of [...directionByModel.keys()].sort()) {
      const agg = directionByModel.get(key)!;
      lines.push(`**${key}**`);
      lines.push("");
      lines.push(
        "| expected \\ model | Improving | Stable | Worsening | Inconclusive | (no valid evolution artefact) |"
      );
      lines.push("|---|---|---|---|---|---|");
      for (const expected of [
        "Improving",
        "Stable",
        "Worsening",
        "Inconclusive",
      ] as ExpectedProgression[]) {
        const row = agg.confusion[expected];
        lines.push(
          `| ${expected} | ${row.Improving ?? 0} | ${row.Stable ?? 0} | ${row.Worsening ?? 0} | ${row.Inconclusive ?? 0} | ${row["(no valid evolution artefact)"] ?? 0} |`
        );
      }
      lines.push("");
    }
  }

  // ── What this shows / does not show ──
  lines.push("## What this shows / what it does not");
  lines.push("");
  lines.push(
    "**Shows:** how often each model's free-text chest X-ray read, passed through a heuristic keyword mapper, " +
      "lands on the same 14-class label set (or the same coarse worsening/improving/stable trajectory) as the " +
      "NLP-mined NIH ChestX-ray14 labels for the same 224px image. Differences between models/providers in this " +
      "report are internally comparable (same mapper, same reference labels, same images) even where the " +
      "absolute numbers are not trustworthy in isolation."
  );
  lines.push(
    "**Does not show:** diagnostic accuracy, sensitivity/specificity of disease detection in any clinical sense, " +
      "or a validated comparison to radiologist ground truth. It also cannot show performance at the image " +
      "resolution used in real clinical workflows, since every image here is the 224px NIH release copy."
  );
  lines.push("");
  return lines.join("\n");
}

// ─── 12. CLI orchestration ──────────────────────────────────────────────────

/**
 * Resolution order for the NIH metadata CSV: --csv flag > NIH_CSV env var >
 * repo-relative default (../nih-cxr14/Data_Entry_2017.csv, a sibling of this
 * repo's root — the layout prepare-nih.py writes to by default; see
 * experiments/sime2026/README.md §2).
 */
function defaultCsvPath(here: string): string {
  return (
    process.env.NIH_CSV ?? path.resolve(here, "..", "..", "..", "nih-cxr14", "Data_Entry_2017.csv")
  );
}

export const USAGE =
  "Usage: label-agreement.ts [--runs <dir>] [--out <file.md>] [--csv <Data_Entry_2017.csv>]\n" +
  "\n" +
  "  --runs <dir>   run outputs to score (default experiments/sime2026/runs)\n" +
  "  --out <file>   markdown report; the JSON sibling is written next to it\n" +
  "                 (default experiments/sime2026/E5-label-agreement.md, which\n" +
  "                 is committed evidence alongside its .json sibling)\n" +
  "  --csv <file>   NIH metadata CSV (default $NIH_CSV, else ../nih-cxr14/Data_Entry_2017.csv)";

export function parseArgs(
  argv: string[],
  here: string
): { runsDir: string; outPath: string; csvPath: string } {
  let runsDir = path.join(here, "runs");
  let outPath = path.join(here, "E5-label-agreement.md");
  let csvPath = defaultCsvPath(here);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs" && argv[i + 1]) {
      runsDir = path.resolve(argv[i + 1]!);
      i++;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      outPath = path.resolve(argv[i + 1]!);
      i++;
    } else if (argv[i] === "--csv" && argv[i + 1]) {
      csvPath = path.resolve(argv[i + 1]!);
      i++;
    }
  }
  return { runsDir, outPath, csvPath };
}

export function jsonOutPathFor(outPath: string): string {
  return outPath.endsWith(".md") ? outPath.slice(0, -3) + ".json" : outPath + ".json";
}

/**
 * `nih-selection.json` (the committed cohort definition) is located relative to
 * this script rather than to the report, so `--out` can point anywhere without
 * breaking cohort lookup.
 */
export function defaultSelectionPath(here: string): string {
  return path.join(here, "nih-selection.json");
}

export function run(
  runsDir: string,
  outPath: string,
  csvPath: string,
  selectionPath: string
): { markdown: string; jsonPath: string } {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const csvLabels = parseNihCsv(csvText);
  const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8")) as NihSelection;

  const data = loadRuns(runsDir, csvLabels, selection);
  const modelAggregates = aggregateByModel(data.perImageRows);
  const directionByModel = aggregateDirectionByModel(data.directionRows);
  const directionByModelStratum = aggregateDirectionByModelAndStratum(data.directionRows);

  const generatedAt = new Date().toISOString();
  const markdown = renderMarkdown(
    data,
    modelAggregates,
    directionByModel,
    directionByModelStratum,
    generatedAt
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, "utf8");
  const jsonPath = jsonOutPathFor(outPath);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt,
        runIds: data.runIds,
        skippedRuns: data.skippedRuns,
        recoveredProgressionRows: data.recoveredProgressionRows,
        perImageRows: data.perImageRows,
        directionRows: data.directionRows,
        modelAggregates: [...modelAggregates.values()],
        directionByModel: [...directionByModel.values()],
        directionByModelStratum: [...directionByModelStratum.values()],
      },
      null,
      1
    ),
    "utf8"
  );
  return { markdown, jsonPath };
}

/* istanbul ignore next -- CLI entry point, exercised by running the script */
export function main(argv: string[]): void {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const { runsDir, outPath, csvPath } = parseArgs(argv.slice(2), here);
  const { jsonPath } = run(runsDir, outPath, csvPath, defaultSelectionPath(here));
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${jsonPath}`);
}

/* istanbul ignore next -- CLI entry point */
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
  } else {
    main(process.argv);
  }
}
