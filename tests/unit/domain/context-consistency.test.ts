/**
 * Context-consistency probe (governance).
 *
 * The fairness probe asks whether a demographic attribute *justified* a
 * finding. This one asks the opposite question — whether the model invented a
 * demographic the supplied context contradicts — because the E4 longitudinal
 * cohort contains two runs that describe a 69-year-old female as a child and a
 * 54-year-old as "a young patient" while scoring perfectly clean on the
 * fairness probe.
 *
 * Golden paths, then the edges that decide whether a heuristic is usable: the
 * substring traps ("female" contains "male", "the" contains "he"), pronouns
 * with no clinical subject nearby, and every way the context can be missing.
 */
import { describe, it, expect } from "@jest/globals";
import {
  collectGeneratedText,
  contextConsistencyWarnings,
  findContextContradictions,
  parsePatientContext,
  stripCitations,
  summariseContradictions,
} from "../../../src/domain/context-consistency.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { GraphState, ImageAnalysis, SeriesSummary } from "../../../src/domain/types.js";

/** The context file shipped with every E4 cohort patient, verbatim in shape. */
const E4_CONTEXT =
  "Public, de-identified frontal chest radiographs (PA view) from the NIH ChestX-ray14 " +
  "dataset, downsampled to 224x224 pixels. Patient age at first study: 69 years; sex: female. " +
  "Each series folder is one imaging session, in chronological order (series_1 earliest). " +
  "No clinical history is available. Research use only.";

// ─── parsePatientContext ─────────────────────────────────────────────────────

describe("parsePatientContext", () => {
  it("reads age and sex from the cohort's own context file", () => {
    expect(parsePatientContext(E4_CONTEXT)).toEqual({ age: 69, sex: "female" });
  });

  it("reads a labelled single-letter sex", () => {
    expect(parsePatientContext("Sex: M. Age: 62.")).toEqual({ age: 62, sex: "male" });
  });

  it("reads the '62-year-old female' phrasing", () => {
    expect(parsePatientContext("A 62-year-old female, PA chest.")).toEqual({
      age: 62,
      sex: "female",
    });
  });

  it("reads a sex stated without a label", () => {
    expect(parsePatientContext("Chest radiograph of a male subject.")).toEqual({ sex: "male" });
  });

  it("returns nothing for text stating neither", () => {
    expect(parsePatientContext("Frontal chest radiographs, research use only.")).toEqual({});
  });

  it("returns nothing for undefined or blank context", () => {
    expect(parsePatientContext(undefined)).toEqual({});
    expect(parsePatientContext("   \n ")).toEqual({});
  });

  it("ignores an implausible age rather than guessing", () => {
    expect(parsePatientContext("Sex: F. Age: 431.").age).toBeUndefined();
  });

  it("ignores a sex label it cannot normalise", () => {
    expect(parsePatientContext("Sex: unknown. Age at study: 40 years.")).toEqual({ age: 40 });
  });
});

// ─── Sex contradictions ──────────────────────────────────────────────────────

describe("findContextContradictions — sex", () => {
  it("flags a male patient described against a female context", () => {
    const findings = findContextContradictions(
      E4_CONTEXT,
      "Chest radiograph of an adult male patient; the lungs are clear."
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("sex");
    expect(findings[0]!.term.toLowerCase()).toBe("male");
    expect(findings[0]!.context).toBe("sex: female");
    expect(findings[0]!.excerpt).toContain("male patient");
  });

  it("flags 'she' against a male context", () => {
    const findings = findContextContradictions(
      "Sex: M. Age at first study: 76 years.",
      "The patient is stable; she shows no new opacity."
    );
    expect(findings.map((f) => f.term.toLowerCase())).toContain("she");
  });

  it("does not mistake 'female' for 'male'", () => {
    expect(
      findContextContradictions(E4_CONTEXT, "A 69-year-old female with clear lung fields.")
    ).toEqual([]);
  });

  it("does not mistake 'the' or 'there' for a pronoun", () => {
    expect(
      findContextContradictions(
        E4_CONTEXT,
        "The chest is clear. There is no pneumothorax in the study."
      )
    ).toEqual([]);
  });

  it("ignores a bare pronoun with no clinical subject anywhere near it", () => {
    const prose = `He said so. ${"filler word ".repeat(40)}The chest radiograph is normal.`;
    expect(findContextContradictions(E4_CONTEXT, prose)).toEqual([]);
  });

  it("reports each distinct contradicting term once", () => {
    const findings = findContextContradictions(
      E4_CONTEXT,
      "His chest is clear. His lungs are normal. The male patient is well."
    );
    expect(findings.map((f) => f.term.toLowerCase()).sort()).toEqual(["his", "male"]);
  });

  it("does not flag a sex when the context states none", () => {
    expect(
      findContextContradictions("Frontal chest radiographs.", "He is a male patient.")
    ).toEqual([]);
  });
});

// ─── Age contradictions ──────────────────────────────────────────────────────

describe("findContextContradictions — age", () => {
  it("flags a pediatric description of a 69-year-old (E4 failure case F2)", () => {
    const findings = findContextContradictions(
      E4_CONTEXT,
      "Chest X-ray of a child. A normal thymic shadow is seen; likely a pediatric ICU study."
    );
    const terms = findings.filter((f) => f.kind === "age").map((f) => f.term.toLowerCase());
    expect(terms).toContain("child");
    expect(terms).toContain("pediatric");
    expect(findings[0]!.reason).toContain("the context states 69");
    expect(findings[0]!.excerpt).toContain("child");
  });

  it("flags 'young patient' for a 54-year-old", () => {
    const findings = findContextContradictions(
      "Patient age at first study: 54 years; sex: female.",
      "The findings are unremarkable for a young patient."
    );
    expect(findings.map((f) => f.term.toLowerCase())).toContain("young patient");
  });

  it("flags 'elderly' when the stated age is under 60", () => {
    const findings = findContextContradictions(
      "Patient age at first study: 42 years; sex: female.",
      "Degenerative change as expected in an elderly patient."
    );
    expect(findings.map((f) => f.term.toLowerCase())).toContain("elderly");
  });

  it("flags 'infant' and 'neonate' for an adult", () => {
    const terms = findContextContradictions(
      E4_CONTEXT,
      "The infant is well positioned; neonatal lines are absent."
    ).map((f) => f.term.toLowerCase());
    expect(terms).toEqual(expect.arrayContaining(["infant", "neonatal"]));
  });

  it("accepts a life-stage term consistent with the stated age", () => {
    expect(
      findContextContradictions(E4_CONTEXT, "An elderly adult patient; the lungs are clear.")
    ).toEqual([]);
  });

  it("does not flag an age when the context states none", () => {
    expect(findContextContradictions("Sex: female.", "A pediatric chest radiograph.")).toEqual([]);
  });

  it("flags an age contradiction when the context states no sex", () => {
    const findings = findContextContradictions(
      "Patient age at first study: 69 years.",
      "Chest X-ray of a male child."
    );
    expect(findings.map((f) => f.kind)).toEqual(["age"]);
    expect(findings[0]!.term.toLowerCase()).toBe("child");
  });

  it("reports a repeated life-stage term once", () => {
    const findings = findContextContradictions(
      E4_CONTEXT,
      "A child. The child is well. A pediatric study."
    );
    expect(findings.map((f) => f.term.toLowerCase()).sort()).toEqual(["child", "pediatric"]);
  });
});

// ─── Excerpts ────────────────────────────────────────────────────────────────

describe("findContextContradictions — excerpts", () => {
  it("elides both ends when the term sits inside a long narrative", () => {
    const filler = "The lungs are clear and the mediastinum is normal. ".repeat(20);
    const findings = findContextContradictions(E4_CONTEXT, `${filler}A child.${filler}`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.excerpt.startsWith("…")).toBe(true);
    expect(findings[0]!.excerpt.endsWith("…")).toBe(true);
    expect(findings[0]!.excerpt).toContain("child");
  });

  it("does not elide a short narrative, and collapses its whitespace", () => {
    const findings = findContextContradictions(E4_CONTEXT, "A\n  child.");
    expect(findings[0]!.excerpt).toBe("A child.");
  });
});

// ─── Missing input ───────────────────────────────────────────────────────────

describe("findContextContradictions — missing or empty input", () => {
  it("returns nothing when the context is absent", () => {
    expect(findContextContradictions(undefined, "The male patient is a child.")).toEqual([]);
  });

  it("returns nothing when the context is blank", () => {
    expect(findContextContradictions("  ", "The male patient is a child.")).toEqual([]);
  });

  it("returns nothing when the context states no demographics", () => {
    expect(
      findContextContradictions("Modality: X-ray. Research use only.", "A pediatric patient.")
    ).toEqual([]);
  });

  it("returns nothing when there is no generated text", () => {
    expect(findContextContradictions(E4_CONTEXT, undefined)).toEqual([]);
    expect(findContextContradictions(E4_CONTEXT, "   ")).toEqual([]);
  });
});

// ─── Reporting ───────────────────────────────────────────────────────────────

describe("contextConsistencyWarnings", () => {
  it("is empty when nothing contradicts", () => {
    expect(contextConsistencyWarnings(E4_CONTEXT, "A 69-year-old female. Lungs clear.")).toEqual(
      []
    );
  });

  it("produces a headline plus one line per finding", () => {
    const lines = contextConsistencyWarnings(
      E4_CONTEXT,
      "Chest X-ray of a male child in the pediatric unit."
    );
    expect(lines[0]).toContain("Context-consistency:");
    expect(lines[0]).toContain("non-blocking");
    expect(lines[0]).toMatch(/\[age, sex\]/);
    expect(lines).toHaveLength(
      findContextContradictions(E4_CONTEXT, "Chest X-ray of a male child in the pediatric unit.")
        .length + 1
    );
    expect(lines.slice(1).every((l) => l.startsWith("context-consistency ["))).toBe(true);
  });

  it("names only the kinds actually found", () => {
    expect(
      summariseContradictions(findContextContradictions(E4_CONTEXT, "A male patient."))
    ).toContain("[sex]");
  });
});

// ─── Citations are addresses, not assertions ─────────────────────────────────

/**
 * The E4L cohort's context file for a paediatric patient. Both of the batch's
 * probe false positives were 8-year-old boys whose reports cited a URL with
 * "adult" in its path.
 */
const PAEDIATRIC_CONTEXT =
  "Public, de-identified frontal chest radiographs (PA view) from the NIH ChestX-ray14 " +
  "dataset, downsampled to 224x224 pixels. Patient age at first study: 8 years; sex: male. " +
  "No clinical history is available. Research use only.";

describe("stripCitations", () => {
  it("drops a bare URL but keeps the surrounding prose", () => {
    expect(stripCitations("See https://www.spine.org/conditions/scoliosis/adult-scoliosis now.")) //
      .toBe("See   now.");
  });

  it("keeps a Markdown link's visible label and drops only its target", () => {
    expect(stripCitations("[Adult scoliosis](https://www.spine.org/adult-scoliosis)")) //
      .toBe("Adult scoliosis");
  });

  it("drops a references[] array, plain or backslash-escaped inside rawResponse", () => {
    expect(stripCitations('"references": ["Adult congenital heart disease, 3rd ed."]')).toBe(" ");
    expect(stripCitations('\\"references\\": [\\"Paediatric imaging\\"]')).toBe(" ");
  });

  it("cannot let one URL match swallow a minified artefact", () => {
    const minified = '{"references":["https://a.example/adult"],"summary":"An elderly woman."}';
    expect(stripCitations(minified)).toContain("An elderly woman.");
  });

  it("leaves text with no citation apparatus untouched", () => {
    const prose = "AP supine chest radiograph of a pediatric patient.";
    expect(stripCitations(prose)).toBe(prose);
  });
});

describe("findContextContradictions — citations", () => {
  it("does not flag a life-stage word that occurs only inside a cited URL", () => {
    const artefact =
      '{"summary": "Cardiomediastinal silhouette is within normal limits for the patient\'s age ' +
      'and body habitus.", "references": ["https://www.spine.org/conditions/scoliosis/adult-scoliosis", ' +
      '"https://www.escardio.org/Volume-13/The-Chest-Radiograph-in-Adult-Congenital-Heart-Disease"]}';
    expect(findContextContradictions(PAEDIATRIC_CONTEXT, artefact)).toEqual([]);
  });

  it("still flags a genuine contradiction in prose", () => {
    const findings = findContextContradictions(
      PAEDIATRIC_CONTEXT,
      "AP supine chest radiograph of an elderly patient; the lungs are clear."
    );
    expect(findings.map((f) => f.term.toLowerCase())).toEqual(["elderly"]);
    expect(findings[0]!.kind).toBe("age");
    expect(findings[0]!.excerpt).toContain("elderly patient");
  });

  it("still flags a genuine contradiction written in a Markdown link's visible text", () => {
    const findings = findContextContradictions(
      PAEDIATRIC_CONTEXT,
      "Findings are typical of [an elderly patient](https://radiopaedia.org/articles/paediatric-chest)."
    );
    expect(findings.map((f) => f.term.toLowerCase())).toEqual(["elderly"]);
    // The link target's own life-stage word ("paediatric") is compatible with
    // age 8 anyway; what matters is that the visible label was still scanned.
    expect(findings[0]!.excerpt).toContain("an elderly patient");
  });

  it("returns nothing when the artefact is citations and nothing else", () => {
    expect(
      findContextContradictions(
        PAEDIATRIC_CONTEXT,
        "https://www.spine.org/conditions/scoliosis/adult-scoliosis"
      )
    ).toEqual([]);
  });

  it("does not flag a citation title in references[] that has no URL at all", () => {
    const artefact =
      '{"summary": "Normal chest.", "references": ["The chest radiograph in adult congenital heart disease"]}';
    expect(findContextContradictions(PAEDIATRIC_CONTEXT, artefact)).toEqual([]);
  });

  it("keeps the six genuine hits of the E4-00000008 fabrication (69-year-old described as an infant)", () => {
    const prose =
      "This is a chest X-ray of an infant or young child taken from the front. The cardiac " +
      "silhouette appears mildly enlarged, which can be a normal variant in infants due to " +
      "thymic shadow. Routine neonatal/pediatric monitoring lines are present. " +
      "Radiographically normal paediatric chest.";
    const terms = findContextContradictions(E4_CONTEXT, prose).map((f) => f.term.toLowerCase());
    expect(new Set(terms)).toEqual(
      new Set(["infant", "child", "infants", "neonatal", "pediatric", "paediatric"])
    );
  });
});

// ─── collectGeneratedText ────────────────────────────────────────────────────

function state(overrides: Partial<GraphState> = {}): GraphState {
  return {
    inputDir: "/in",
    outputDir: "/out",
    series: [],
    imageResults: [],
    seriesResults: [],
    ...overrides,
  };
}

const image = (over: Partial<ImageAnalysis> = {}): ImageAnalysis => ({
  imagePath: "/in/series_1/a.png",
  seriesId: "series_1",
  status: "success",
  processedAt: "2026-09-08T00:00:00.000Z",
  disclaimer: DISCLAIMER,
  ...over,
});

const series = (over: Partial<SeriesSummary> = {}): SeriesSummary => ({
  seriesId: "series_1",
  imageCount: 1,
  successCount: 1,
  failureCount: 0,
  consistentFindings: [],
  discrepancies: [],
  primaryDiagnosis: "Normal chest",
  differentialDiagnoses: [],
  confidenceLevel: "High",
  textContextUsed: true,
  report: "",
  processedAt: "2026-09-08T00:00:00.000Z",
  disclaimer: DISCLAIMER,
  ...over,
});

describe("collectGeneratedText", () => {
  it("collects narrative from every stage", () => {
    const text = collectGeneratedText(
      state({
        imageResults: [
          image({
            summary: "Chest X-ray of a child",
            findings: ["Normal thymic shadow"],
            abnormalities: [
              { name: "Thymus", description: "prominent", severity: "Normal", confidence: 50 },
            ],
          }),
        ],
        seriesResults: [series({ report: "## Findings\nClear", consistentFindings: ["clear"] })],
        evolutionResult: {
          seriesCount: 2,
          seriesIds: ["series_1", "series_2"],
          progression: "Stable",
          trends: [{ finding: "Thymus", trend: "Stable", details: "unchanged" }],
          forecastedEvolution: "unchanged",
          treatmentRecommendations: ["Routine follow-up"],
          combinedReport: "## Temporal Evolution",
          processedAt: "2026-09-08T00:00:00.000Z",
          disclaimer: DISCLAIMER,
        },
      })
    );

    for (const fragment of [
      "Chest X-ray of a child",
      "Normal thymic shadow",
      "prominent",
      "Clear",
      "Routine follow-up",
      "Temporal Evolution",
      "unchanged",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it("is empty for a state with no results", () => {
    expect(collectGeneratedText(state())).toBe("");
  });

  it("tolerates records with no narrative fields", () => {
    const text = collectGeneratedText(
      state({
        imageResults: [image({ status: "error", errorMessage: "fetch failed" })],
        seriesResults: [series()],
      })
    );
    expect(text).toBe("Normal chest");
  });

  it("excludes the model's references[] (citations are not claims about the patient)", () => {
    const text = collectGeneratedText(
      state({
        imageResults: [
          image({
            summary: "Normal chest.",
            references: [
              "https://www.spine.org/conditions/scoliosis/adult-scoliosis",
              "The chest radiograph in adult congenital heart disease",
            ],
          }),
        ],
      })
    );
    expect(text).toBe("Normal chest.");
    expect(text).not.toContain("adult");
    expect(findContextContradictions(PAEDIATRIC_CONTEXT, text)).toEqual([]);
  });

  it("feeds the probe end to end from a graph state", () => {
    const text = collectGeneratedText(
      state({ imageResults: [image({ summary: "Chest X-ray of a child, likely an ICU patient" })] })
    );
    expect(findContextContradictions(E4_CONTEXT, text).map((f) => f.term)).toContain("child");
  });
});
