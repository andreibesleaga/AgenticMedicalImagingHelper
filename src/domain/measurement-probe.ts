/**
 * Unsupported-measurement probe (governance, non-blocking).
 *
 * The inputs this program accepts are PNG and JPEG images; DICOM is refused.
 * Those formats carry no pixel spacing, so no absolute size ("a 4 cm cavity",
 * "a 12 mm nodule") can be measured from them. A size in the model's output is
 * therefore the model's own estimate, stated as if measured. The SIME 2026
 * pack's failure case F1 was exactly this: a fabricated "4 cm cavitary lesion"
 * at 95 % confidence that passed schema validation.
 *
 * The probe flags two things in model-authored text:
 * - `absolute-size`: any size in mm, cm or metres;
 * - `high-confidence-size`: an abnormality that states an absolute size AND
 *   carries a model-reported confidence of 90 or more — the F1 pattern.
 *
 * It cannot tell a correct estimate from a wrong one. It only says the number
 * has no measurement behind it, so a reviewer must check it against the image.
 */
import type { GraphState } from "./types.js";

export type MeasurementKind = "absolute-size" | "high-confidence-size";

export interface MeasurementHit {
  readonly kind: MeasurementKind;
  /** Where the text came from, e.g. `image series_2/img.png`, `series series_1`, `evolution`. */
  readonly source: string;
  /** The matched size, e.g. "4 cm". */
  readonly size: string;
  /** Model-reported confidence (0–100) for `high-confidence-size`. */
  readonly confidence?: number;
  /** The surrounding text, at most 160 characters. */
  readonly excerpt: string;
}

/** Confidence at or above which a sized abnormality is flagged as the F1 pattern. */
export const HIGH_CONFIDENCE = 90;

// "4 cm", "4.5cm", "12 mm", "1,5 cm", "3 x 2 cm", "10 millimetres", "2 centimeters".
const SIZE_RE =
  /(?<![a-z0-9.,])(\d+(?:[.,]\d+)?(?:\s*(?:x|×|by)\s*\d+(?:[.,]\d+)?)*)\s*(mm|cm|millimet(?:er|re)s?|centimet(?:er|re)s?)(?![a-z])/gi;

/** Every absolute size mentioned in a text, as written ("4 cm", "3 x 2 cm"). */
export function findSizes(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(SIZE_RE)) {
    out.push(`${m[1]!.replace(/\s+/g, " ")} ${m[2]!.toLowerCase()}`);
  }
  return out;
}

function excerptAround(text: string, needle: string): string {
  const i = text.indexOf(needle.split(" ")[0]!);
  const start = Math.max(0, i - 60);
  const s = text
    .slice(start, start + 160)
    .replace(/\s+/g, " ")
    .trim();
  return s.length === 160 ? `${s}...` : s;
}

function scan(source: string, text: string | undefined, out: MeasurementHit[]): void {
  if (!text) return;
  for (const size of findSizes(text)) {
    out.push({ kind: "absolute-size", source, size, excerpt: excerptAround(text, size) });
  }
}

/**
 * All unsupported measurements in the model-authored text of a completed run.
 * Deterministic; reads only generated fields, never the context file.
 */
export function findUnsupportedMeasurements(state: GraphState): MeasurementHit[] {
  const hits: MeasurementHit[] = [];
  for (const image of state.imageResults) {
    const where = `image ${image.seriesId}/${image.imagePath.split(/[\\/]/).pop() ?? ""}`;
    scan(where, image.summary, hits);
    for (const f of image.findings ?? []) scan(where, f, hits);
    for (const a of image.abnormalities ?? []) {
      const text = `${a.name}. ${a.description}`;
      const sizes = findSizes(text);
      for (const size of sizes) {
        const high = typeof a.confidence === "number" && a.confidence >= HIGH_CONFIDENCE;
        hits.push({
          kind: high ? "high-confidence-size" : "absolute-size",
          source: where,
          size,
          ...(high ? { confidence: a.confidence } : {}),
          excerpt: excerptAround(text, size),
        });
      }
    }
  }
  for (const s of state.seriesResults) {
    scan(`series ${s.seriesId}`, s.report, hits);
    for (const f of s.consistentFindings ?? []) scan(`series ${s.seriesId}`, f, hits);
  }
  const ev = state.evolutionResult;
  if (ev) {
    scan("evolution", ev.combinedReport, hits);
    scan("evolution", ev.forecastedEvolution, hits);
    for (const t of ev.trends) scan("evolution", `${t.finding}: ${t.details}`, hits);
  }
  return hits;
}

/** At most this many detail lines in the manifest; the headline carries the total. */
export const MAX_DETAIL_LINES = 20;

/**
 * Warning lines for the run manifest: a headline, then one line per hit
 * (high-confidence hits first, capped at {@link MAX_DETAIL_LINES}). Empty when
 * nothing is found.
 */
export function measurementProbeWarnings(state: GraphState): string[] {
  const hits = findUnsupportedMeasurements(state);
  if (hits.length === 0) return [];
  const high = hits.filter((h) => h.kind === "high-confidence-size");
  const ordered = [...high, ...hits.filter((h) => h.kind === "absolute-size")];
  const lines = ordered
    .slice(0, MAX_DETAIL_LINES)
    .map(
      (h) =>
        `measurement-probe [${h.kind}] ${h.source}: "${h.size}"` +
        (h.confidence !== undefined ? ` at ${h.confidence} % confidence` : "") +
        ` — "${h.excerpt}"`
    );
  return [
    `measurement-probe: ${hits.length} absolute size claim(s) in generated text` +
      (high.length > 0 ? `, ${high.length} at ≥${HIGH_CONFIDENCE} % confidence` : "") +
      `. PNG/JPEG inputs carry no pixel spacing, so these are model estimates, not measurements; ` +
      `verify against the image.`,
    ...lines,
    ...(ordered.length > MAX_DETAIL_LINES
      ? [`measurement-probe: ${ordered.length - MAX_DETAIL_LINES} further hit(s) not listed.`]
      : []),
  ];
}
