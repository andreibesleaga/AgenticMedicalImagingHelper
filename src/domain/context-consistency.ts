/**
 * Context-consistency probe: does the generated text contradict the patient
 * record the operator supplied?
 *
 * **Why this is separate from `fairness.ts`.** The allocative-harm probe asks
 * whether a demographic attribute was used to *justify* a finding ("because she
 * is …"). It is blind to the opposite failure, observed in the E4 longitudinal
 * cohort: a model that quietly *invents* a demographic that the context file
 * contradicts — a 69-year-old female described as "a chest X-ray of a child"
 * with a "normal thymic shadow", or a 54-year-old described as "a young
 * patient". Nothing in those reports is demographically anchored, so the
 * fairness probe reports them clean, yet every downstream finding rests on the
 * wrong patient. This module closes that gap.
 *
 * **What it is.** A deterministic, dependency-free, offline heuristic over two
 * strings: the context text and the generated text. It is a *probe*, not a
 * gate — it produces warnings for a human reviewer and a countable column in
 * the experiment audit, and it never changes an exit code. It cannot know
 * whether the context file itself is correct.
 *
 * **Honest limits.** Pronoun evidence is weak, so bare pronouns are only
 * reported when they sit within {@link PROXIMITY_CHARS} of a clinical noun;
 * a quoted differential ("in a child this would suggest …") will still be
 * flagged; and an absent or unparseable context yields no findings at all,
 * which is silence, not a pass.
 *
 * **Citations are not assertions.** A cited URL is a bibliographic address,
 * not a statement about the patient: a paediatric patient's report citing
 * `…/adult-scoliosis` says nothing about that patient's age. Every scan
 * therefore runs over {@link stripCitations}-sanitised text, and structured
 * callers additionally drop the model's `references[]` in
 * {@link collectGeneratedText}. A contradiction written in a link's *visible*
 * text is still prose and is still flagged.
 */
import type { GraphState } from "./types.js";

/** Which stated attribute a finding contradicts. */
export type ContradictionKind = "sex" | "age";

/** Demographics recovered from the operator-supplied context text. */
export interface ContextDemographics {
  /** Age in years, when the context states one. */
  age?: number;
  sex?: "female" | "male";
}

/** One contradiction between the supplied context and the generated text. */
export interface ContextContradiction {
  kind: ContradictionKind;
  /** What the context states, e.g. `sex: female` or `age: 69`. */
  context: string;
  /** The contradicting term as it appears in the generated text. */
  term: string;
  /** One clause saying why the two cannot both hold. */
  reason: string;
  /** Whitespace-collapsed window of the generated text around `term`. */
  excerpt: string;
}

/** Characters either side of a term kept in {@link ContextContradiction.excerpt}. */
const EXCERPT_CHARS = 80;

/** How near a clinical noun a bare pronoun must sit to count as evidence. */
const PROXIMITY_CHARS = 200;

/**
 * Nouns that make a pronoun a statement *about the patient* rather than
 * incidental prose. Deliberately narrow.
 */
const CLINICAL_NOUNS =
  /\b(patient|radiograph|radiography|chest|study|studies|imaging|image|x-?ray|scan|series|session|findings?)\b/i;

interface SexTerm {
  sex: "female" | "male";
  pattern: RegExp;
  /** Pronouns are weak evidence and are gated on {@link CLINICAL_NOUNS}. */
  pronoun: boolean;
}

/**
 * Gendered terms, split by strength of evidence.
 *
 * `\b` does the delicate work here: `\bmale\b` cannot match inside "female"
 * (both `e` and `m` are word characters, so there is no boundary), `\bmen\b`
 * cannot match inside "women", and `\bhe\b` cannot match inside "the".
 */
const SEX_TERMS: readonly SexTerm[] = [
  { sex: "male", pattern: /\bmales?\b/i, pronoun: false },
  { sex: "male", pattern: /\bm[ae]n\b/i, pronoun: false },
  { sex: "male", pattern: /\bgentle(?:man|men)\b/i, pronoun: false },
  { sex: "male", pattern: /\bboys?\b/i, pronoun: false },
  { sex: "male", pattern: /\bhe\b/i, pronoun: true },
  { sex: "male", pattern: /\bhis\b/i, pronoun: true },
  { sex: "male", pattern: /\bhim\b/i, pronoun: true },
  { sex: "female", pattern: /\bfemales?\b/i, pronoun: false },
  { sex: "female", pattern: /\bwom[ae]n\b/i, pronoun: false },
  { sex: "female", pattern: /\bl(?:ady|adies)\b/i, pronoun: false },
  { sex: "female", pattern: /\bgirls?\b/i, pronoun: false },
  { sex: "female", pattern: /\bshe\b/i, pronoun: true },
  { sex: "female", pattern: /\bher\b/i, pronoun: true },
  { sex: "female", pattern: /\bhers\b/i, pronoun: true },
];

interface AgeBand {
  pattern: RegExp;
  /** Inclusive age range in years for which the term is compatible. */
  min: number;
  max: number;
}

/**
 * Life-stage vocabulary and the age range each one implies. Ranges are
 * deliberately generous: the probe should fire on "a child" for a 69-year-old,
 * not quibble over whether 12 or 13 ends childhood.
 */
const AGE_BANDS: readonly AgeBand[] = [
  { pattern: /\b(?:neonates?|neonatal|newborns?)\b/i, min: 0, max: 0 },
  { pattern: /\binfants?\b/i, min: 0, max: 1 },
  { pattern: /\btoddlers?\b/i, min: 1, max: 3 },
  { pattern: /\b(?:child|children|childhood|pa?ediatrics?)\b/i, min: 0, max: 12 },
  { pattern: /\b(?:adolescents?|teenagers?|teenage)\b/i, min: 12, max: 19 },
  { pattern: /\byoung (?:patient|adult|man|woman|male|female)\b/i, min: 0, max: 39 },
  { pattern: /\b(?:elderly|geriatric)\b/i, min: 60, max: 120 },
  { pattern: /\badults?\b/i, min: 18, max: 120 },
];

/** Highest age treated as a plausible reading of a context file. */
const MAX_PLAUSIBLE_AGE = 120;

// ─── Context parsing ─────────────────────────────────────────────────────────

function normaliseSex(raw: string): "female" | "male" | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "f" || s === "female" || s === "woman" || s === "girl") return "female";
  if (s === "m" || s === "male" || s === "man" || s === "boy") return "male";
  return undefined;
}

function plausibleAge(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PLAUSIBLE_AGE ? n : undefined;
}

/**
 * Recover age and sex from a `patient_context.txt`-style free-text block.
 *
 * Handles the phrasings the cohort actually uses — "Patient age at first study:
 * 69 years; sex: female", "Sex: F", "62-year-old female" — and returns an empty
 * record rather than guessing when none of them is present.
 */
export function parsePatientContext(text: string | undefined): ContextDemographics {
  if (text === undefined || text.trim() === "") return {};
  const out: ContextDemographics = {};

  const sexLabelled = /\bsex\s*(?:is|[:=])\s*"?([A-Za-z]+)"?/i.exec(text);
  const sexYearOld = /\b\d{1,3}[- ]year[- ]old\s+(female|male|man|woman|boy|girl)\b/i.exec(text);
  const sexBare = /\b(female|male)\b/i.exec(text);
  for (const match of [sexLabelled, sexYearOld, sexBare]) {
    const sex = match ? normaliseSex(match[1]!) : undefined;
    if (sex) {
      out.sex = sex;
      break;
    }
  }

  const ageYearOld = /\b(\d{1,3})[- ]year[- ]old\b/i.exec(text);
  const ageLabelledUnits = /\bage\b[^.;\n]{0,40}?(\d{1,3})\s*(?:years?|yrs?|y\/o)\b/i.exec(text);
  const ageLabelled = /\bage\s*(?:is|[:=])\s*(\d{1,3})\b/i.exec(text);
  for (const match of [ageYearOld, ageLabelledUnits, ageLabelled]) {
    const age = match ? plausibleAge(match[1]!) : undefined;
    if (age !== undefined) {
      out.age = age;
      break;
    }
  }

  return out;
}

// ─── Citation stripping ──────────────────────────────────────────────────────

/**
 * A Markdown inline link. The *visible* label is kept (it is prose the model
 * wrote about this patient); the target is dropped. Matched before the bare-URL
 * rule so that a link target never survives as a loose token.
 */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;

/**
 * A `"references": [ … ]` array as it appears in a run artefact — both as real
 * JSON and as the backslash-escaped copy embedded in `rawResponse`. Citation
 * titles are not always URLs ("Adult congenital heart disease, 3rd ed."), so
 * the whole array is dropped rather than only its links.
 */
const JSON_REFERENCES_ARRAY = /\\?"references\\?"\s*:\s*\[[^\]]*\]/gi;

/**
 * A bare `http(s)://…` token. It ends at whitespace or at any delimiter that
 * cannot appear unescaped inside a URL in these artefacts — the closing quote
 * of a JSON string, a closing bracket, an angle bracket — so a minified,
 * newline-free artefact cannot let one match swallow the rest of the file.
 */
const URL_TOKEN = /\bhttps?:\/\/[^\s"'<>`)\]}]*/gi;

/**
 * `text` with citation apparatus removed: Markdown link targets (label kept),
 * `references[]` arrays, and bare URLs, each replaced by a single space so no
 * two words are welded together.
 *
 * This exists because the probe is applied to whole artefact files, where the
 * model's bibliography sits in the same string as its prose. Two runs in the
 * SIME-2026 batch (`E4L-00003158`, `E4L-00019779`, both 8-year-olds) were
 * flagged solely for the word "Adult" inside a cited URL; nothing in either
 * narrative asserted an age.
 */
export function stripCitations(text: string): string {
  return text
    .replace(MARKDOWN_LINK, (_match, label: string) => label)
    .replace(JSON_REFERENCES_ARRAY, " ")
    .replace(URL_TOKEN, " ");
}

// ─── Scanning ────────────────────────────────────────────────────────────────

function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_CHARS);
  const to = Math.min(text.length, end + EXCERPT_CHARS);
  const body = text.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}

/**
 * Every match of `pattern` in `text`, as `[start, end, matched]` triples.
 *
 * Every pattern in this module is a case-insensitive, `\b`-anchored literal
 * alternation, so the scan is recompiled with `gi` rather than mutating the
 * shared literal's `lastIndex`, and no match can ever be zero-length.
 */
function allMatches(text: string, pattern: RegExp): Array<[number, number, string]> {
  const global = new RegExp(pattern.source, "gi");
  const out: Array<[number, number, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length, m[0]]);
  }
  return out;
}

function nearClinicalNoun(text: string, start: number, end: number): boolean {
  const window = text.slice(
    Math.max(0, start - PROXIMITY_CHARS),
    Math.min(text.length, end + PROXIMITY_CHARS)
  );
  return CLINICAL_NOUNS.test(window);
}

function findSexContradictions(
  sex: "female" | "male",
  generatedText: string
): ContextContradiction[] {
  const opposite = sex === "female" ? "male" : "female";
  const found = new Map<string, ContextContradiction>();

  for (const term of SEX_TERMS) {
    if (term.sex !== opposite) continue;
    for (const [start, end, matched] of allMatches(generatedText, term.pattern)) {
      if (term.pronoun && !nearClinicalNoun(generatedText, start, end)) continue;
      const key = matched.toLowerCase();
      if (found.has(key)) continue;
      found.set(key, {
        kind: "sex",
        context: `sex: ${sex}`,
        term: matched,
        reason: `the output describes a ${opposite} patient, the context states ${sex}`,
        excerpt: excerptAround(generatedText, start, end),
      });
    }
  }

  return [...found.values()];
}

function findAgeContradictions(age: number, generatedText: string): ContextContradiction[] {
  const found = new Map<string, ContextContradiction>();

  for (const band of AGE_BANDS) {
    if (age >= band.min && age <= band.max) continue;
    for (const [start, end, matched] of allMatches(generatedText, band.pattern)) {
      const key = matched.toLowerCase();
      if (found.has(key)) continue;
      found.set(key, {
        kind: "age",
        context: `age: ${age}`,
        term: matched,
        reason:
          `"${matched}" implies an age of ${band.min}–${band.max}, ` + `the context states ${age}`,
        excerpt: excerptAround(generatedText, start, end),
      });
    }
  }

  return [...found.values()];
}

/**
 * Contradictions of the stated age or sex in `generatedText`.
 *
 * Returns an empty array — never throws — when the context is missing, blank,
 * or states neither an age nor a sex. Each distinct contradicting term is
 * reported once, with the first excerpt in which it appeared.
 *
 * `generatedText` is passed through {@link stripCitations} first, so cited URLs
 * and `references[]` arrays cannot raise a contradiction and excerpts are quoted
 * from the sanitised prose.
 */
export function findContextContradictions(
  contextText: string | undefined,
  generatedText: string | undefined
): ContextContradiction[] {
  if (generatedText === undefined || generatedText.trim() === "") return [];
  const { age, sex } = parsePatientContext(contextText);
  if (age === undefined && sex === undefined) return [];

  const scanned = stripCitations(generatedText);
  if (scanned.trim() === "") return [];

  return [
    ...(sex !== undefined ? findSexContradictions(sex, scanned) : []),
    ...(age !== undefined ? findAgeContradictions(age, scanned) : []),
  ];
}

// ─── Reporting ───────────────────────────────────────────────────────────────

/** Headline line summarising a set of contradictions, for stderr and the manifest. */
export function summariseContradictions(findings: readonly ContextContradiction[]): string {
  const kinds = [...new Set(findings.map((f) => f.kind))].sort().join(", ");
  return (
    `Context-consistency: ${findings.length} statement(s) in the generated output ` +
    `contradict the supplied patient context [${kinds}]. Heuristic, non-blocking — ` +
    `the output still requires clinician review.`
  );
}

/**
 * Warning lines for the run manifest: a headline followed by one line per
 * finding. Empty when there is nothing to report, so the caller can push the
 * result unconditionally.
 */
export function contextConsistencyWarnings(
  contextText: string | undefined,
  generatedText: string | undefined
): string[] {
  const findings = findContextContradictions(contextText, generatedText);
  if (findings.length === 0) return [];
  return [
    summariseContradictions(findings),
    ...findings.map((f) => `context-consistency [${f.kind}] ${f.reason}: "${f.excerpt}"`),
  ];
}

/**
 * The model-authored text of a completed run, concatenated for probing.
 *
 * Only generated narrative is included — never the prompt or the context file
 * itself — so a context that says "female" cannot make its own echo look like
 * a contradiction.
 *
 * `ImageAnalysis.references` is deliberately **not** collected: it holds cited
 * URLs and citation titles, which are bibliography rather than claims about
 * this patient (see {@link stripCitations}). `rawResponse` is likewise excluded,
 * since it is the unparsed source of the fields already gathered here.
 */
export function collectGeneratedText(state: GraphState): string {
  const parts: string[] = [];

  for (const image of state.imageResults) {
    if (image.summary) parts.push(image.summary);
    if (image.findings) parts.push(...image.findings);
    for (const abnormality of image.abnormalities ?? []) {
      parts.push(abnormality.name, abnormality.description);
    }
    // image.references / image.rawResponse: intentionally omitted — see above.
  }

  for (const series of state.seriesResults) {
    parts.push(series.primaryDiagnosis, series.report, ...series.consistentFindings);
  }

  const evolution = state.evolutionResult;
  if (evolution) {
    parts.push(evolution.combinedReport, evolution.forecastedEvolution);
    parts.push(...evolution.treatmentRecommendations);
    for (const trend of evolution.trends) parts.push(trend.finding, trend.details);
  }

  return parts.filter((p) => typeof p === "string" && p.length > 0).join("\n\n");
}
