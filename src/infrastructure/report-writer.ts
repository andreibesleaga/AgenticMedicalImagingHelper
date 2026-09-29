import * as fs from "fs/promises";
import * as path from "path";
import { createRequire } from "module";
import type {
  GraphState,
  SeriesSummary,
  TemporalAnalysis,
  ValidationOutcome,
} from "../domain/types.js";

const require = createRequire(import.meta.url);

/**
 * Version stamped into every report footer. Read from `package.json` so the
 * footer, the CLI `--version` and the run manifest's `toolVersion` can never
 * drift apart (they did: the footer was hard-coded to `1.0.0`). Falls back to
 * `"unknown"` if the manifest is unreadable, exactly like the run manifest.
 */
export const TOOL_VERSION: string = (() => {
  try {
    const version = (require("../../package.json") as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0 ? version : "unknown";
  } catch {
    return "unknown";
  }
})();

/**
 * Treatment suggestions are model output, not clinical advice. Every rendered
 * report labels them, so a reader who only sees the Markdown cannot mistake
 * them for a recommendation.
 */
const TREATMENT_LABEL = "experimental — not clinical recommendations";

/**
 * Headings inside *model-authored* Markdown that read as clinical instruction.
 *
 * The pipeline labels its own treatment section, but it used to embed the
 * model's prose verbatim — and in 5 of 8 `gemini-2.5-flash` combined reports in
 * the E4 longitudinal cohort that prose opened its own unlabelled
 * `## Treatment Recommendations` list *above* the labelled section, so a reader
 * skimming the report met an unlabelled treatment list first
 * ("Immediate management … likely requiring chest tube insertion").
 */
const MODEL_TREATMENT_HEADING = /treatment|recommendation|management plan|therapy/i;

/** Suffix appended to a relabelled model heading. */
export const MODEL_TEXT_LABEL = "(model text — experimental, not clinical recommendations)";

/**
 * Level a relabelled model heading is demoted to, so it can never outrank the
 * pipeline's own `## Treatment Suggestions (…)` section.
 */
const DEMOTED_LEVEL = 4;

const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;
const ATX_HEADING = /^(\s{0,3})(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Relabel treatment-shaped headings inside embedded model Markdown.
 *
 * A matching heading is demoted to level {@link DEMOTED_LEVEL} (or deeper if it
 * already was) and gains {@link MODEL_TEXT_LABEL}, so the text is preserved in
 * place while exactly one *labelled* treatment section — the pipeline's own —
 * survives at section level. Headings inside fenced code blocks are left alone,
 * and the transform is idempotent.
 */
export function labelModelTreatmentHeadings(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      const match = ATX_HEADING.exec(line);
      if (!match) return line;
      // Every group of ATX_HEADING is unconditional, so a match always fills them.
      const indent = match[1]!;
      const hashes = match[2]!;
      const text = match[3]!;
      if (!MODEL_TREATMENT_HEADING.test(text)) return line;
      if (text.includes(MODEL_TEXT_LABEL)) return line;

      const level = Math.min(6, Math.max(DEMOTED_LEVEL, hashes.length));
      return `${indent}${"#".repeat(level)} ${text} ${MODEL_TEXT_LABEL}`;
    })
    .join("\n");
}

/** Link schemes that must never survive into a report (OWASP LLM05). */
// One level of nested parentheses is allowed, as in `javascript:alert(1)`.
const UNSAFE_LINK = /\]\(\s*(?:javascript|vbscript|data|file):(?:[^()]|\([^()]*\))*\)/gi;
/** Anything shaped like an HTML/XML tag, comment or processing instruction. */
const HTML_TAG = /<(\/?[a-zA-Z!?][^<>]*)>/g;
// C0 controls except tab (\x09), newline (\x0a) and carriage return (\x0d), plus DEL.
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Neutralise model-authored text before it is embedded in a Markdown report
 * (OWASP Top 10 for LLM Applications 2025, LLM05 improper output handling).
 *
 * Model output is untrusted: a prompt-injected or malfunctioning model could
 * emit raw HTML (`<script>`, `<img onerror=…>`, `<iframe>`), a `javascript:`
 * link, or control characters, and a Markdown viewer might render them. This
 * function escapes anything tag-shaped (`<b>` → `&lt;b&gt;`), rewrites unsafe
 * link targets to `#unsafe-link-removed`, and drops control characters. Text
 * inside fenced code blocks is left as written (it is displayed literally
 * anyway). Ordinary Markdown — headings, lists, emphasis, http(s) links — is
 * untouched, and the transform is idempotent.
 */
export function sanitizeModelMarkdown(markdown: string): string {
  let inFence = false;
  return (markdown ?? "")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(UNSAFE_LINK, "](#unsafe-link-removed)").replace(HTML_TAG, "&lt;$1&gt;");
    })
    .join("\n");
}

/** Sanitise, then relabel treatment headings: the pipeline for embedded model Markdown. */
function modelMarkdown(markdown: string): string {
  return labelModelTreatmentHeadings(sanitizeModelMarkdown(markdown));
}

/** Sanitise a single-line model field (diagnosis, finding, trend). */
const t = (text: string): string => sanitizeModelMarkdown(text);

/**
 * Human-oversight block (EU AI Act Art. 14).
 *
 * The `DISCLAIMER` already says the output is educational; this block says
 * something narrower and more actionable — that *this artefact has not been
 * reviewed yet*, and names the role that must review it. It is the first thing
 * in every Markdown report, before the title, so it survives a reader who
 * skims, a diff view that shows only the head of the file, and a paste into a
 * chat window. The machine-readable counterpart is the run manifest's
 * `humanReview` record (`required: true`, plus any `--reviewer` attestation).
 */
export const HUMAN_REVIEW_BLOCK =
  "> **Requires review by a qualified clinician before any use.**\n" +
  "> This report is unreviewed AI research output. No finding, diagnosis, trend, forecast or\n" +
  "> treatment suggestion in it has been checked by a human clinician, and none may be acted\n" +
  "> on until one has. Recorded as `humanReview` in `run_manifest.json` (EU AI Act Art. 14).";

/**
 * One line stating whether the model's structured response passed its Zod
 * schema. Absent when no model response was validated (e.g. the call failed),
 * so nothing is claimed that was not measured.
 */
function validationLine(validation: ValidationOutcome | undefined): string {
  if (!validation) return "";
  if (validation.ok) return "**Structured output**: schema-validated\n";
  const issues = validation.issues ?? [];
  return (
    `**Structured output**: schema validation FAILED (${issues.length} issue(s)) — ` +
    `narrative fallback used\n` +
    (issues.length > 0 ? issues.map((i) => `> - ${i}`).join("\n") + "\n" : "")
  );
}

/**
 * Write all analysis reports to the output directory.
 * Mirrors the input directory structure in output/.
 * Returns the list of file paths written.
 */
export async function writeReports(state: GraphState): Promise<string[]> {
  const { outputDir, imageResults, seriesResults, evolutionResult } = state;
  const written: string[] = [];

  // Ensure output root exists
  await fs.mkdir(outputDir, { recursive: true });

  // Write per-image JSON files
  for (const analysis of imageResults) {
    const seriesDir = path.join(outputDir, analysis.seriesId);
    await fs.mkdir(seriesDir, { recursive: true });

    const imageName = path.basename(analysis.imagePath, path.extname(analysis.imagePath));
    const jsonPath = path.join(seriesDir, `${imageName}_analysis.json`);
    await fs.writeFile(jsonPath, JSON.stringify(analysis, null, 2), "utf-8");
    written.push(jsonPath);
  }

  // Write per-series Markdown summaries
  for (const summary of seriesResults) {
    const seriesDir = path.join(outputDir, summary.seriesId);
    await fs.mkdir(seriesDir, { recursive: true });

    const mdPath = path.join(seriesDir, "series_summary.md");
    const content = buildSeriesMarkdown(summary);
    await fs.writeFile(mdPath, content, "utf-8");
    written.push(mdPath);
  }

  // Write evolution analysis files
  if (evolutionResult) {
    const evolutionJsonPath = path.join(outputDir, "evolution_analysis.json");
    await fs.writeFile(evolutionJsonPath, JSON.stringify(evolutionResult, null, 2), "utf-8");
    written.push(evolutionJsonPath);

    const combinedMdPath = path.join(outputDir, "combined_diagnostic_report.md");
    const combinedContent = buildCombinedMarkdown(evolutionResult);
    await fs.writeFile(combinedMdPath, combinedContent, "utf-8");
    written.push(combinedMdPath);
  }

  return written;
}

function buildSeriesMarkdown(summary: SeriesSummary): string {
  return `${HUMAN_REVIEW_BLOCK}

# Series Analysis: ${summary.seriesId}

> ${summary.disclaimer}

**Analyzed**: ${summary.processedAt}
**Images**: ${summary.imageCount} submitted, ${summary.successCount} successfully analyzed, ${summary.failureCount} failed
**Context file used**: ${summary.textContextUsed ? "Yes" : "No"}
${validationLine(summary.validation)}
## Primary Diagnosis
${t(summary.primaryDiagnosis)} — Confidence: ${summary.confidenceLevel}

## Differential Diagnoses
${summary.differentialDiagnoses.length > 0 ? summary.differentialDiagnoses.map((d, i) => `${i + 1}. ${t(d)}`).join("\n") : "_None noted_"}

## Consistent Findings Across All Views
${summary.consistentFindings.length > 0 ? summary.consistentFindings.map((f) => `- ${t(f)}`).join("\n") : "_No consistent findings extracted_"}

## Discrepancies Between Views
${summary.discrepancies.length > 0 ? summary.discrepancies.map((d) => `- ${t(d)}`).join("\n") : "_None noted_"}

## Full Series Report

${modelMarkdown(summary.report)}

---
*Generated by AgenticMedicalImagingHelper v${TOOL_VERSION} | Educational use only*
`;
}

function buildCombinedMarkdown(evolution: TemporalAnalysis): string {
  return `${HUMAN_REVIEW_BLOCK}

# Combined Diagnostic Report

> ${evolution.disclaimer}

**Generated**: ${evolution.processedAt}
**Series analyzed**: ${evolution.seriesCount} (${evolution.seriesIds.join(", ")})
**Overall progression**: ${evolution.progression}
${validationLine(evolution.validation)}
## Temporal Evolution Analysis

${modelMarkdown(evolution.combinedReport)}

## Per-Finding Trends
${evolution.trends.length > 0 ? evolution.trends.map((tr) => `- **${t(tr.finding)}** — ${tr.trend}${tr.details ? `: ${t(tr.details)}` : ""}`).join("\n") : "_No per-finding trends extracted_"}

## Forecasted Evolution
${evolution.forecastedEvolution.length > 0 ? modelMarkdown(evolution.forecastedEvolution) : "_Not extracted_"}

## Treatment Suggestions (${TREATMENT_LABEL})
_AI-generated suggestions for educational use only. They are not clinical recommendations and must not be acted on._

${evolution.treatmentRecommendations.length > 0 ? evolution.treatmentRecommendations.map((r) => `- ${t(r)}`).join("\n") : "_See full report above_"}

---
*Generated by AgenticMedicalImagingHelper v${TOOL_VERSION} | Educational use only*
*This report is AI-generated for educational purposes only. Professional clinical review required.*
`;
}
