/**
 * Unlabelled treatment headings inside model prose
 * (qualitative review of the E4 cohort, §d.1).
 *
 * The pipeline labels its *own* treatment section "experimental — not clinical
 * recommendations". It used to embed the model's Markdown verbatim, and in 5 of
 * 8 `gemini-2.5-flash` combined reports in the E4 cohort that Markdown opened
 * its own unlabelled `## Treatment Recommendations` list *above* the labelled
 * section — so a reader skimming the report met an unlabelled list of urgent
 * interventions first. The rendered artefact must carry exactly one treatment
 * section at section level, and it must be the labelled one.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import {
  MODEL_TEXT_LABEL,
  labelModelTreatmentHeadings,
  writeReports,
} from "../../../src/infrastructure/report-writer.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { GraphState, SeriesSummary, TemporalAnalysis } from "../../../src/domain/types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "treatment-headings-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Prose in the shape gemini actually produced for patient 00000092. */
const MODEL_PROSE_WITH_TREATMENT_HEADING = `## Temporal Evolution

The left hydropneumothorax has enlarged between sessions 3 and 4.

## Treatment Recommendations

- **Urgent Medical Intervention:** Immediate management of the large left
  hydropneumothorax is critical, likely requiring chest tube insertion.

### Follow-up therapy

- Repeat imaging after drainage.
`;

function evolution(combinedReport: string): TemporalAnalysis {
  return {
    seriesCount: 4,
    seriesIds: ["series_1", "series_2", "series_3", "series_4"],
    progression: "Worsening",
    trends: [],
    forecastedEvolution: "Further enlargement without drainage.",
    treatmentRecommendations: ["Consider urgent review"],
    combinedReport,
    processedAt: "2026-09-08T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

function series(report: string): SeriesSummary {
  return {
    seriesId: "series_1",
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: [],
    discrepancies: [],
    primaryDiagnosis: "Large left hydropneumothorax",
    differentialDiagnoses: [],
    confidenceLevel: "Medium",
    textContextUsed: false,
    report,
    processedAt: "2026-09-08T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

function state(over: Partial<GraphState> = {}): GraphState {
  return {
    inputDir: path.join(tmp, "in"),
    outputDir: tmp,
    series: [],
    imageResults: [],
    seriesResults: [],
    ...over,
  };
}

/** Headings at section level (h1–h3) that read as a treatment instruction. */
const SECTION_TREATMENT_HEADING =
  /^ {0,3}#{1,3} .*(?:treatment|therapy|management plan|recommendation).*$/gim;

// ─── labelModelTreatmentHeadings ─────────────────────────────────────────────

describe("labelModelTreatmentHeadings", () => {
  it("demotes and labels a model's `## Treatment Recommendations` heading", () => {
    const out = labelModelTreatmentHeadings(MODEL_PROSE_WITH_TREATMENT_HEADING);
    expect(out).toContain(`#### Treatment Recommendations ${MODEL_TEXT_LABEL}`);
    expect(out).not.toMatch(/^## Treatment Recommendations$/m);
  });

  it("keeps the text under the heading untouched", () => {
    const out = labelModelTreatmentHeadings(MODEL_PROSE_WITH_TREATMENT_HEADING);
    expect(out).toContain("likely requiring chest tube insertion");
    expect(out).toContain("Repeat imaging after drainage.");
  });

  it("catches every trigger word, at every heading level", () => {
    const cases: Array<[string, string]> = [
      ["# Treatment plan", "#### Treatment plan"],
      ["## Recommendations", "#### Recommendations"],
      ["### Management plan", "#### Management plan"],
      ["#### Adjuvant therapy", "#### Adjuvant therapy"],
      ["##### Therapy options", "##### Therapy options"],
      ["###### Recommendation", "###### Recommendation"],
    ];
    for (const [input, expectedHead] of cases) {
      expect(labelModelTreatmentHeadings(input)).toBe(`${expectedHead} ${MODEL_TEXT_LABEL}`);
    }
  });

  it("leaves unrelated headings and body text alone", () => {
    const md = "## Findings\n\nTreatment was mentioned in the referral note.\n\n### Impression\n";
    expect(labelModelTreatmentHeadings(md)).toBe(md);
  });

  it("leaves a heading inside a fenced code block alone", () => {
    const md = "## Findings\n\n```markdown\n## Treatment Recommendations\n```\n\n## Therapy\n";
    const out = labelModelTreatmentHeadings(md);
    expect(out).toContain("```markdown\n## Treatment Recommendations\n```");
    expect(out).toContain(`#### Therapy ${MODEL_TEXT_LABEL}`);
  });

  it("handles a tilde fence too", () => {
    const md = "~~~\n## Treatment\n~~~\n";
    expect(labelModelTreatmentHeadings(md)).toBe(md);
  });

  it("is idempotent", () => {
    const once = labelModelTreatmentHeadings(MODEL_PROSE_WITH_TREATMENT_HEADING);
    expect(labelModelTreatmentHeadings(once)).toBe(once);
  });

  it("tolerates indentation and a closed ATX heading", () => {
    expect(labelModelTreatmentHeadings("  ## Treatment ##")).toBe(
      `  #### Treatment ${MODEL_TEXT_LABEL}`
    );
  });

  it("leaves a `#`-prefixed line that is not a heading alone", () => {
    expect(labelModelTreatmentHeadings("#Treatment")).toBe("#Treatment");
    expect(labelModelTreatmentHeadings("####### Treatment")).toBe("####### Treatment");
  });

  it("returns empty and whitespace input unchanged", () => {
    expect(labelModelTreatmentHeadings("")).toBe("");
    expect(labelModelTreatmentHeadings("\n\n")).toBe("\n\n");
  });
});

// ─── Rendered artefacts ──────────────────────────────────────────────────────

describe("rendered reports carry exactly one labelled treatment section", () => {
  it("sanitises the combined report's embedded model prose", async () => {
    await writeReports(state({ evolutionResult: evolution(MODEL_PROSE_WITH_TREATMENT_HEADING) }));
    const md = await fs.readFile(path.join(tmp, "combined_diagnostic_report.md"), "utf-8");

    const sections = md.match(SECTION_TREATMENT_HEADING) ?? [];
    expect(sections).toHaveLength(1);
    expect(sections[0]).toBe(
      "## Treatment Suggestions (experimental — not clinical recommendations)"
    );
    expect(md).toContain(`#### Treatment Recommendations ${MODEL_TEXT_LABEL}`);
    // Nothing is lost: the model's own text is still in the artefact.
    expect(md).toContain("likely requiring chest tube insertion");
  });

  it("puts the labelled section before any model treatment text", async () => {
    await writeReports(state({ evolutionResult: evolution(MODEL_PROSE_WITH_TREATMENT_HEADING) }));
    const md = await fs.readFile(path.join(tmp, "combined_diagnostic_report.md"), "utf-8");

    // The model's list is now sub-section text, and the only heading a skimming
    // reader can mistake for a clinical recommendation carries the label.
    const modelHeading = md.indexOf(`#### Treatment Recommendations ${MODEL_TEXT_LABEL}`);
    expect(modelHeading).toBeGreaterThan(-1);
    expect(md.slice(0, modelHeading)).not.toMatch(/^## Treatment Recommendations$/m);
  });

  it("sanitises the series report's embedded model prose", async () => {
    await writeReports(state({ seriesResults: [series(MODEL_PROSE_WITH_TREATMENT_HEADING)] }));
    const md = await fs.readFile(path.join(tmp, "series_1", "series_summary.md"), "utf-8");

    expect(md.match(SECTION_TREATMENT_HEADING) ?? []).toHaveLength(0);
    expect(md).toContain(`#### Treatment Recommendations ${MODEL_TEXT_LABEL}`);
  });

  it("leaves a clean model report byte-identical inside the artefact", async () => {
    const clean = "## Temporal Evolution\n\n- No interval change.\n";
    await writeReports(state({ evolutionResult: evolution(clean) }));
    const md = await fs.readFile(path.join(tmp, "combined_diagnostic_report.md"), "utf-8");
    expect(md).toContain(clean);
  });
});
