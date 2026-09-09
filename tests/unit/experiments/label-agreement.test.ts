/**
 * E5 label-agreement (experiments/sime2026/label-agreement.ts).
 *
 * Covers the pure text-matching/metrics/direction logic against fixtures
 * (no live data touched) plus the filesystem orchestration (loadRuns/run)
 * against synthetic run directories, mirroring the style of
 * tests/unit/experiments/probe-outputs.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import {
  NIH_CLASSES,
  CLASS_SYNONYMS,
  buildPhraseRegex,
  isNegatedAt,
  textAssertsPhrase,
  buildSourceText,
  detectClasses,
  parseLabelsField,
  toComparableSet,
  setsEqual,
  setJaccard,
  computePerImageMetrics,
  newClassConfusionTable,
  accumulateClassConfusion,
  computeClassMetrics,
  averageClassMetrics,
  newNoFindingConfusion,
  accumulateNoFindingConfusion,
  noFindingRates,
  deriveDirection,
  mapStratumToDirection,
  directionToExpectedProgression,
  parseRunId,
  classifyArtifact,
  imageFilenameFromAnalysisFilename,
  patientIdFromImageFilename,
  parseNihCsv,
  isProgressionStatus,
  PROGRESSION_VALUES,
  loadRuns,
  aggregateByModel,
  aggregateDirectionByModel,
  aggregateDirectionByModelAndStratum,
  renderMarkdown,
  parseArgs,
  defaultSelectionPath,
  jsonOutPathFor,
  run,
} from "../../../experiments/sime2026/label-agreement.js";

// ─── Class-synonym mapper ───────────────────────────────────────────────────

describe("CLASS_SYNONYMS / detectClasses", () => {
  it("has at least one phrase for every one of the 14 NIH classes", () => {
    for (const cls of NIH_CLASSES) {
      expect(CLASS_SYNONYMS[cls].length).toBeGreaterThan(0);
    }
  });

  it("detects every class from its own first synonym phrase in a plausible sentence", () => {
    for (const cls of NIH_CLASSES) {
      const phrase = CLASS_SYNONYMS[cls][0]!;
      const sentence = `Findings show ${phrase} in the right lower lobe.`;
      const detected = detectClasses(sentence);
      expect(detected.has(cls)).toBe(true);
    }
  });

  it("detects multiple classes from one realistic multi-finding report", () => {
    const text =
      "There is a pleural effusion at the right base. Cardiomegaly is noted with an enlarged cardiac silhouette. " +
      "No pneumothorax is seen.";
    const detected = detectClasses(text);
    expect(detected.has("Effusion")).toBe(true);
    expect(detected.has("Cardiomegaly")).toBe(true);
    expect(detected.has("Pneumothorax")).toBe(false);
  });

  it("does not match short class words inside longer words (word-boundary safety)", () => {
    // "massive" must not trigger Mass; "herniated" must not trigger Hernia.
    const text =
      "There is a massive pleural effusion. Degenerative disc disease with a herniated disc is noted.";
    const detected = detectClasses(text);
    expect(detected.has("Mass")).toBe(false);
    expect(detected.has("Hernia")).toBe(false);
    expect(detected.has("Effusion")).toBe(true);
  });

  it("returns an empty set for a text with no findings at all", () => {
    expect(detectClasses("").size).toBe(0);
    expect(detectClasses("The patient's chart number is on file.").size).toBe(0);
  });
});

// ─── Negation handling ──────────────────────────────────────────────────────

describe("negation-aware matching", () => {
  it("buildPhraseRegex applies word boundaries only where the phrase starts/ends on a word character", () => {
    expect(buildPhraseRegex("mass").source).toBe("\\bmass\\b");
    expect(buildPhraseRegex(">0.5").source).not.toContain("\\b>"); // ">" is not a word char, no leading boundary
  });

  it("isNegatedAt finds a cue within the fallback window", () => {
    const text = "no evidence of pneumothorax";
    const idx = text.indexOf("pneumothorax");
    expect(isNegatedAt(text, idx)).toBe(true);
  });

  it("isNegatedAt does not treat an unrelated distant cue as negating", () => {
    const text = "unremarkable exam. consolidation is present in the right lower lobe.";
    const idx = text.indexOf("consolidation");
    expect(isNegatedAt(text, idx)).toBe(false); // sentence boundary ends the earlier cue's scope
  });

  it("a single negation cue governs a comma-separated list beyond the ~40-char fallback window", () => {
    // Deliberately > 40 chars from "without" to "pneumothorax" — this is the
    // most common radiology negation pattern and the reason clause-scoping
    // was added on top of the spec's literal ~40-char window.
    const text =
      "Lungs are clear without evidence of focal consolidation, pleural effusion, or pneumothorax in either lung field.";
    const detected = detectClasses(text);
    expect(detected.has("Consolidation")).toBe(false);
    expect(detected.has("Effusion")).toBe(false);
    expect(detected.has("Pneumothorax")).toBe(false);
  });

  it("textAssertsPhrase ignores a negated occurrence but still matches a later un-negated one", () => {
    const text = "No pneumothorax on the right. A small pneumothorax is seen on the left.";
    expect(textAssertsPhrase(text, "pneumothorax")).toBe(true);
  });

  it("a clause-breaking conjunction ('however') lets assertion resume mid-sentence", () => {
    const text = "There is no pneumothorax, however moderate cardiomegaly is present.";
    const detected = detectClasses(text);
    expect(detected.has("Pneumothorax")).toBe(false);
    expect(detected.has("Cardiomegaly")).toBe(true);
  });

  it("documents the known false-negative for hedged uncertainty ('cannot rule out')", () => {
    // "cannot rule out X" is NOT a negation of X, but the literal cue list
    // ("not ") is a substring of "cannot ", so this mapper does treat it as
    // negated. Captured as a caveat in the generated report; asserted here
    // so the behaviour cannot silently change.
    const text = "Cannot rule out early pneumonia; clinical correlation advised.";
    expect(detectClasses(text).has("Pneumonia")).toBe(false);
  });

  it("recognises all documented negation cues", () => {
    const cues = [
      "no pneumothorax",
      "without pneumothorax",
      "absence of pneumothorax",
      "not pneumothorax",
      "free of pneumothorax",
      "unremarkable pneumothorax",
      "clear pneumothorax",
    ];
    for (const phrase of cues) {
      expect(detectClasses(phrase).has("Pneumothorax")).toBe(false);
    }
  });
});

// ─── buildSourceText: field selection ──────────────────────────────────────

describe("buildSourceText", () => {
  it("joins findings, abnormalities (name+description), and summary — never rawResponse", () => {
    const text = buildSourceText({
      findings: ["Lungs clear."],
      abnormalities: [{ name: "Cardiomegaly", description: "Enlarged cardiac silhouette." }],
      summary: "Heart appears enlarged.",
      // @ts-expect-error -- rawResponse must be ignored even if present
      rawResponse: '{"findings":["SHOULD NOT APPEAR: pneumothorax"]}',
    } as never);
    expect(text).toContain("Lungs clear.");
    expect(text).toContain("Cardiomegaly");
    expect(text).toContain("Enlarged cardiac silhouette.");
    expect(text).toContain("Heart appears enlarged.");
    expect(text).not.toContain("SHOULD NOT APPEAR");
  });

  it("tolerates missing/malformed fields", () => {
    expect(buildSourceText({})).toBe("");
    expect(
      buildSourceText({
        findings: "not an array" as never,
        abnormalities: null as never,
        summary: 42 as never,
      })
    ).toBe("");
  });
});

// ─── Ground-truth parsing + set comparison ─────────────────────────────────

describe("ground truth parsing and set comparison", () => {
  it("parses a pipe-delimited label field, dropping 'No Finding'", () => {
    expect(parseLabelsField("Effusion|Fibrosis")).toEqual(new Set(["Effusion", "Fibrosis"]));
    expect(parseLabelsField("No Finding")).toEqual(new Set());
  });

  it("toComparableSet substitutes the No Finding sentinel for an empty set", () => {
    expect(toComparableSet(new Set())).toEqual(new Set(["No Finding"]));
    expect(toComparableSet(new Set(["Mass"]))).toEqual(new Set(["Mass"]));
  });

  it("setsEqual / setJaccard behave as expected", () => {
    expect(setsEqual(new Set(["A", "B"]), new Set(["B", "A"]))).toBe(true);
    expect(setsEqual(new Set(["A"]), new Set(["A", "B"]))).toBe(false);
    expect(setJaccard(new Set(["A", "B"]), new Set(["A"]))).toBeCloseTo(0.5);
    expect(setJaccard(new Set(), new Set())).toBe(1);
    expect(setJaccard(new Set(["A"]), new Set(["B"]))).toBe(0);
  });
});

// ─── Per-image metrics ──────────────────────────────────────────────────────

describe("computePerImageMetrics", () => {
  it("both-normal is an exact match with jaccard 1", () => {
    const m = computePerImageMetrics(new Set(), new Set());
    expect(m.exactMatch).toBe(true);
    expect(m.jaccard).toBe(1);
    expect(m.overCalled).toEqual([]);
    expect(m.underCalled).toEqual([]);
  });

  it("partial overlap: reports over-called and under-called classes and a fractional jaccard", () => {
    const predicted = new Set(["Effusion", "Mass"]);
    const gt = new Set(["Effusion", "Fibrosis"]);
    const m = computePerImageMetrics(predicted, gt);
    expect(m.exactMatch).toBe(false);
    expect(m.jaccard).toBeCloseTo(1 / 3);
    expect(m.overCalled).toEqual(["Mass"]);
    expect(m.underCalled).toEqual(["Fibrosis"]);
  });

  it("predicted normal vs. truly abnormal is not an exact match and has jaccard 0", () => {
    const m = computePerImageMetrics(new Set(), new Set(["Nodule"]));
    expect(m.exactMatch).toBe(false);
    expect(m.jaccard).toBe(0);
    expect(m.underCalled).toEqual(["Nodule"]);
  });
});

// ─── Class confusion + precision/recall/F1 ────────────────────────────────

describe("class confusion and metrics", () => {
  it("accumulates tp/fp/fn/tn correctly across several images", () => {
    const table = newClassConfusionTable();
    // image 1: predicted {Effusion}, gt {Effusion} -> TP Effusion, TN others
    accumulateClassConfusion(table, new Set(["Effusion"]), new Set(["Effusion"]));
    // image 2: predicted {Effusion}, gt {} -> FP Effusion
    accumulateClassConfusion(table, new Set(["Effusion"]), new Set());
    // image 3: predicted {}, gt {Effusion} -> FN Effusion
    accumulateClassConfusion(table, new Set(), new Set(["Effusion"]));

    expect(table.Effusion).toEqual({ tp: 1, fp: 1, fn: 1, tn: 0 });
    expect(table.Mass).toEqual({ tp: 0, fp: 0, fn: 0, tn: 3 });

    const m = computeClassMetrics(table.Effusion);
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.f1).toBeCloseTo(0.5);
    expect(m.support).toBe(2);
  });

  it("returns null precision/recall/f1 when there is no support and no predictions", () => {
    const m = computeClassMetrics({ tp: 0, fp: 0, fn: 0, tn: 5 });
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.f1).toBeNull();
    expect(m.support).toBe(0);
  });

  it("averageClassMetrics computes macro (over defined classes) and micro (pooled) averages", () => {
    const table = newClassConfusionTable();
    accumulateClassConfusion(table, new Set(["Effusion"]), new Set(["Effusion"])); // TP
    accumulateClassConfusion(table, new Set(["Mass"]), new Set()); // FP
    const avg = averageClassMetrics(table);
    // Only Effusion (precision 1, recall 1, f1 1) and Mass (precision 0, recall null->excluded) have defined precision.
    expect(avg.macroPrecision).toBeCloseTo(0.5); // mean of Effusion=1 and Mass=0
    expect(avg.macroRecall).toBe(1); // only Effusion has support, recall 1
    expect(avg.microPrecision).toBeCloseTo(0.5); // tp=1, fp=1 pooled
    expect(avg.microRecall).toBe(1); // tp=1, fn=0 pooled
  });
});

// ─── No Finding sensitivity/specificity ────────────────────────────────────

describe("No Finding confusion", () => {
  it("classifies the four quadrants correctly", () => {
    const acc = newNoFindingConfusion();
    accumulateNoFindingConfusion(acc, new Set(), new Set()); // bothNormal
    accumulateNoFindingConfusion(acc, new Set(["Mass"]), new Set()); // missedAbnormalCall (over-call)
    accumulateNoFindingConfusion(acc, new Set(), new Set(["Mass"])); // falseReassurance
    accumulateNoFindingConfusion(acc, new Set(["Mass"]), new Set(["Mass"])); // bothAbnormal
    expect(acc).toEqual({
      bothNormal: 1,
      missedAbnormalCall: 1,
      falseReassurance: 1,
      bothAbnormal: 1,
    });
    const rates = noFindingRates(acc);
    expect(rates.sensitivity).toBeCloseTo(0.5); // 1/(1+1)
    expect(rates.specificity).toBeCloseTo(0.5); // 1/(1+1)
  });

  it("returns null rates when a denominator is zero", () => {
    expect(noFindingRates(newNoFindingConfusion())).toEqual({
      sensitivity: null,
      specificity: null,
    });
  });
});

// ─── Direction derivation ───────────────────────────────────────────────────

describe("deriveDirection", () => {
  it("worsening: normal first, pathology last", () => {
    const seq = [
      { followup: 0, labels: "No Finding" },
      { followup: 1, labels: "Infiltration" },
    ];
    expect(deriveDirection(seq)).toBe("worsening");
  });

  it("improving: pathology first, normal last", () => {
    const seq = [
      { followup: 0, labels: "Effusion" },
      { followup: 1, labels: "No Finding" },
    ];
    expect(deriveDirection(seq)).toBe("improving");
  });

  it("stable-normal: normal at both ends", () => {
    const seq = [
      { followup: 0, labels: "No Finding" },
      { followup: 1, labels: "No Finding" },
    ];
    expect(deriveDirection(seq)).toBe("stable-normal");
  });

  it("stable-pathology: pathology at both ends with class overlap", () => {
    const seq = [
      { followup: 0, labels: "Atelectasis" },
      { followup: 1, labels: "Atelectasis|Effusion" },
    ];
    expect(deriveDirection(seq)).toBe("stable-pathology");
  });

  it("mixed-pathology-change: pathology at both ends with no overlap", () => {
    const seq = [
      { followup: 0, labels: "Nodule" },
      { followup: 1, labels: "Effusion" },
    ];
    expect(deriveDirection(seq)).toBe("mixed-pathology-change");
  });

  it("sorts by followup before comparing first vs. last, regardless of input order", () => {
    const seq = [
      { followup: 2, labels: "No Finding" },
      { followup: 0, labels: "No Finding" },
      { followup: 1, labels: "Infiltration" },
    ];
    expect(deriveDirection(seq)).toBe("stable-normal"); // first(0)=No Finding, last(2)=No Finding
  });

  it("throws on an empty sequence", () => {
    expect(() => deriveDirection([])).toThrow();
  });
});

describe("mapStratumToDirection / directionToExpectedProgression", () => {
  it("maps every known E4L stratum", () => {
    expect(mapStratumToDirection("worsening-like")).toBe("worsening");
    expect(mapStratumToDirection("improving-like")).toBe("improving");
    expect(mapStratumToDirection("stable-pathology")).toBe("stable-pathology");
    expect(mapStratumToDirection("stable-normal")).toBe("stable-normal");
  });

  it("returns null for an unrecognised stratum", () => {
    expect(mapStratumToDirection("unknown-stratum")).toBeNull();
  });

  it("maps every direction to the expected model progression label", () => {
    expect(directionToExpectedProgression("worsening")).toBe("Worsening");
    expect(directionToExpectedProgression("improving")).toBe("Improving");
    expect(directionToExpectedProgression("stable-normal")).toBe("Stable");
    expect(directionToExpectedProgression("stable-pathology")).toBe("Stable");
    expect(directionToExpectedProgression("mixed-pathology-change")).toBe("Inconclusive");
  });
});

// ─── Run id parsing ─────────────────────────────────────────────────────────

describe("parseRunId", () => {
  it("parses an E4 openrouter id", () => {
    expect(parseRunId("E4-00000067-openrouter-google_gemini-2.5-flash")).toEqual({
      cohort: "E4",
      patientId: "00000067",
      sizeLabel: undefined,
      concurrency: undefined,
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
    });
  });

  it("parses an E4L openrouter id with a vendor that itself contains no underscore ambiguity", () => {
    expect(parseRunId("E4L-00000049-openrouter-anthropic_claude-sonnet-5")).toEqual(
      expect.objectContaining({
        cohort: "E4L",
        patientId: "00000049",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5",
      })
    );
  });

  it("parses an E2 id with size/concurrency and an openrouter model", () => {
    expect(parseRunId("E2-S3x10-c5-openrouter-google_gemini-2.5-flash")).toEqual({
      cohort: "E2",
      patientId: undefined,
      sizeLabel: "S3x10",
      concurrency: "c5",
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
    });
  });

  it("parses a direct-Google E2 id with no vendor prefix", () => {
    const info = parseRunId("E2-S1x1-c1-gemini-2.5-flash");
    expect(info.provider).toBe("google");
    expect(info.model).toBe("gemini-2.5-flash");
  });

  it("parses a direct-Google E2 id with an explicit 'google-' prefix", () => {
    const info = parseRunId("E2-S2x5-c5-google-gemini-2.5-flash");
    expect(info.provider).toBe("google");
    expect(info.model).toBe("gemini-2.5-flash");
  });
});

// ─── Artifact status classification ────────────────────────────────────────

describe("classifyArtifact", () => {
  it("classifies success/valid as ok", () => {
    expect(classifyArtifact({ status: "success", validation: { ok: true } })).toBe("ok");
  });
  it("treats a missing validation field as ok", () => {
    expect(classifyArtifact({ status: "success" })).toBe("ok");
  });
  it("classifies validation.ok === false as invalid", () => {
    expect(classifyArtifact({ status: "success", validation: { ok: false, issues: ["x"] } })).toBe(
      "invalid"
    );
  });
  it("classifies status:error as error", () => {
    expect(classifyArtifact({ status: "error", errorMessage: "fetch failed" })).toBe("error");
  });
  it("classifies a non-object as malformed", () => {
    expect(classifyArtifact(null)).toBe("malformed");
    expect(classifyArtifact("not an object")).toBe("malformed");
  });
});

// ─── Filename / CSV helpers ─────────────────────────────────────────────────

describe("imageFilenameFromAnalysisFilename / patientIdFromImageFilename", () => {
  it("extracts the image filename from a plain per-image analysis filename", () => {
    expect(imageFilenameFromAnalysisFilename("00000067_000_analysis.json")).toBe(
      "00000067_000.png"
    );
  });
  it("strips the E2 'img_NN_' ordinal prefix", () => {
    expect(imageFilenameFromAnalysisFilename("img_05_00010693_004_analysis.json")).toBe(
      "00010693_004.png"
    );
  });
  it("returns null for a non-matching filename (e.g. evolution_analysis.json)", () => {
    expect(imageFilenameFromAnalysisFilename("evolution_analysis.json")).toBeNull();
  });
  it("derives the patient id as the first 8 characters of the image filename", () => {
    expect(patientIdFromImageFilename("00010693_004.png")).toBe("00010693");
  });
});

describe("parseNihCsv", () => {
  it("parses Image Index -> Finding Labels, skipping the header and blank lines", () => {
    const csv =
      "Image Index,Finding Labels,Follow-up #,Patient ID,Patient Age,Patient Gender,View Position\n" +
      "00000001_000.png,Cardiomegaly,000,00000001,058Y,M,PA\n" +
      "\n" +
      "00000001_001.png,Cardiomegaly|Emphysema,001,00000001,058Y,M,PA\n";
    const map = parseNihCsv(csv);
    expect(map.get("00000001_000.png")).toBe("Cardiomegaly");
    expect(map.get("00000001_001.png")).toBe("Cardiomegaly|Emphysema");
    expect(map.size).toBe(2);
  });
});

// ─── Filesystem orchestration: loadRuns / aggregation / render / run() ────

describe("loadRuns and orchestration (synthetic run directories)", () => {
  let tmpRoot: string;
  let runsDir: string;
  let csvPath: string;
  let selectionPath: string;

  async function writeAnalysis(
    runId: string,
    seriesDir: string,
    filename: string,
    content: unknown
  ): Promise<void> {
    const dir = path.join(runsDir, runId, "output", seriesDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, filename),
      typeof content === "string" ? content : JSON.stringify(content)
    );
  }

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "label-agreement-"));
    runsDir = path.join(tmpRoot, "runs");
    csvPath = path.join(tmpRoot, "Data_Entry_2017.csv");
    selectionPath = path.join(tmpRoot, "nih-selection.json");

    // A CSV covering every image used below.
    await fs.writeFile(
      csvPath,
      [
        "Image Index,Finding Labels,Follow-up #,Patient ID,Patient Age,Patient Gender,View Position",
        "00000001_000.png,No Finding,000,00000001,050Y,M,PA",
        "00000001_001.png,Effusion,001,00000001,050Y,M,PA",
        "00000002_000.png,Mass,000,00000002,060Y,F,PA",
        "00000003_000.png,No Finding,000,00000003,040Y,M,PA",
        "00000003_001.png,No Finding,001,00000003,040Y,M,PA",
        "",
      ].join("\n")
    );

    await fs.writeFile(
      selectionPath,
      JSON.stringify({
        E4: {
          "00000001": [
            { image: "00000001_000.png", followup: 0, labels: "No Finding" },
            { image: "00000001_001.png", followup: 1, labels: "Effusion" },
          ],
        },
        E4L: {
          "00000003": {
            stratum: "stable-normal",
            studies: [
              { image: "00000003_000.png", followup: 0, labels: "No Finding" },
              { image: "00000003_001.png", followup: 1, labels: "No Finding" },
            ],
            report_label_trajectory: "No Finding → No Finding",
          },
        },
        E2: {},
      })
    );

    // E4 patient 00000001: one ok image (correct effusion call at followup 1), one where json is malformed.
    await writeAnalysis(
      "E4-00000001-openrouter-google_gemini-2.5-flash",
      "series_1",
      "00000001_000_analysis.json",
      {
        status: "success",
        findings: ["Lungs are clear without effusion or consolidation."],
        abnormalities: [],
        summary: "Normal chest x-ray.",
        validation: { ok: true },
      }
    );
    await writeAnalysis(
      "E4-00000001-openrouter-google_gemini-2.5-flash",
      "series_2",
      "00000001_001_analysis.json",
      {
        status: "success",
        findings: ["There is a pleural effusion at the right base."],
        abnormalities: [],
        summary: "Effusion noted.",
        validation: { ok: true },
      }
    );
    await fs.writeFile(
      path.join(
        runsDir,
        "E4-00000001-openrouter-google_gemini-2.5-flash",
        "output",
        "evolution_analysis.json"
      ),
      JSON.stringify({ progression: "Worsening", validation: { ok: true } })
    );
    await fs.writeFile(
      path.join(
        runsDir,
        "E4-00000001-openrouter-google_gemini-2.5-flash",
        "output",
        "run_manifest.json"
      ),
      JSON.stringify({ provider: "openrouter", model: "google/gemini-2.5-flash" })
    );

    // A gemma-style run: status success but validation.ok false (invalid), plus a status:error image.
    await writeAnalysis(
      "E4-00000002-openrouter-google_gemma-4-31b-it",
      "series_1",
      "00000002_000_analysis.json",
      {
        status: "success",
        findings: [],
        validation: { ok: false, issues: ["modality: expected string, received number"] },
      }
    );

    // A run whose per-image artefact JSON is unreadable (malformed): same
    // patient (00000002), a second series slot, filename matches the
    // per-image pattern but the file body is not valid JSON.
    await writeAnalysis(
      "E4-00000002-openrouter-google_gemma-4-31b-it",
      "series_2",
      "00000002_001_analysis.json",
      "not valid json {"
    );

    // E4L patient with a status:error image (API failure).
    await writeAnalysis(
      "E4L-00000003-openrouter-google_gemini-2.5-flash",
      "series_1",
      "00000003_000_analysis.json",
      {
        status: "error",
        errorMessage: "fetch failed",
      }
    );
    await writeAnalysis(
      "E4L-00000003-openrouter-google_gemini-2.5-flash",
      "series_2",
      "00000003_001_analysis.json",
      {
        status: "success",
        findings: ["Lungs are clear."],
        summary: "Normal.",
        validation: { ok: true },
      }
    );
    await fs.writeFile(
      path.join(
        runsDir,
        "E4L-00000003-openrouter-google_gemini-2.5-flash",
        "output",
        "evolution_analysis.json"
      ),
      JSON.stringify({ progression: "Stable", validation: { ok: true } })
    );

    // A run directory that produced no output/ at all (should be skipped).
    await fs.mkdir(path.join(runsDir, "E4-00000099-openrouter-google_gemini-2.5-flash"), {
      recursive: true,
    });

    // An unrecognised-cohort directory (should be skipped).
    await fs.mkdir(path.join(runsDir, "junk-directory"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("loads per-image rows across E4/E4L runs with correct status classification", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    const data = loadRuns(runsDir, csvLabels, selection);

    const okRow = data.perImageRows.find((r) => r.image === "00000001_000.png");
    expect(okRow?.status).toBe("ok");
    expect(okRow?.predictedClasses).toEqual([]); // negated effusion -> No Finding
    expect(okRow?.exactMatch).toBe(true);

    const effusionRow = data.perImageRows.find((r) => r.image === "00000001_001.png");
    expect(effusionRow?.predictedClasses).toEqual(["Effusion"]);
    expect(effusionRow?.exactMatch).toBe(true);

    const invalidRow = data.perImageRows.find((r) => r.image === "00000002_000.png");
    expect(invalidRow?.status).toBe("invalid");
    expect(invalidRow?.exactMatch).toBeNull();

    const malformedRow = data.perImageRows.find((r) => r.image === "00000002_001.png");
    expect(malformedRow?.status).toBe("malformed");
    expect(malformedRow?.exactMatch).toBeNull();

    const errorRow = data.perImageRows.find((r) => r.image === "00000003_000.png");
    expect(errorRow?.status).toBe("error");
    expect(errorRow?.errorMessage).toBe("fetch failed");
    expect(errorRow?.exactMatch).toBeNull();

    // Skipped runs recorded.
    expect(
      data.skippedRuns.some((s) => s.runId === "E4-00000099-openrouter-google_gemini-2.5-flash")
    ).toBe(true);
    expect(data.skippedRuns.some((s) => s.runId === "junk-directory")).toBe(true);
    expect(data.runIds).not.toContain("E4-00000099-openrouter-google_gemini-2.5-flash");
  });

  it("derives direction for E4 and reuses the provided stratum for E4L", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    const data = loadRuns(runsDir, csvLabels, selection);

    const e4Direction = data.directionRows.find((r) => r.patientId === "00000001");
    expect(e4Direction?.stratumSource).toBe("derived");
    expect(e4Direction?.direction).toBe("worsening"); // No Finding -> Effusion
    expect(e4Direction?.expectedProgression).toBe("Worsening");
    expect(e4Direction?.modelProgression).toBe("Worsening");
    expect(e4Direction?.agree).toBe(true);

    const e4lDirection = data.directionRows.find((r) => r.patientId === "00000003");
    expect(e4lDirection?.stratumSource).toBe("provided");
    expect(e4lDirection?.direction).toBe("stable-normal");
    expect(e4lDirection?.expectedProgression).toBe("Stable");
    expect(e4lDirection?.modelProgression).toBe("Stable");
    expect(e4lDirection?.agree).toBe(true);
  });

  it("aggregateByModel excludes invalid/error rows from metrics but counts them", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    const data = loadRuns(runsDir, csvLabels, selection);
    const byModel = aggregateByModel(data.perImageRows);

    const gemini = byModel.get("openrouter/google/gemini-2.5-flash")!;
    expect(gemini.usableImages).toBe(3); // 2 from E4-00000001 + 1 ok from E4L-00000003
    expect(gemini.errorCount).toBe(1);
    expect(gemini.exactMatchCount).toBe(3);
    expect(gemini.exactMatchRate).toBe(1);

    const gemma = byModel.get("openrouter/google/gemma-4-31b-it")!;
    expect(gemma.invalidCount).toBe(1);
    expect(gemma.usableImages).toBe(0);
    expect(gemma.exactMatchRate).toBeNull();
  });

  it("aggregateDirectionByModel and aggregateDirectionByModelAndStratum compute agreement rates", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    const data = loadRuns(runsDir, csvLabels, selection);
    const byModel = aggregateDirectionByModel(data.directionRows);
    const gemini = byModel.get("openrouter/google/gemini-2.5-flash")!;
    expect(gemini.total).toBe(2);
    expect(gemini.agreeRate).toBe(1);

    const byStratum = aggregateDirectionByModelAndStratum(data.directionRows);
    expect(byStratum.get("openrouter/google/gemini-2.5-flash||worsening")?.total).toBe(1);
    expect(byStratum.get("openrouter/google/gemini-2.5-flash||stable-normal")?.total).toBe(1);
  });

  it("renderMarkdown produces a table-safe report (no unescaped pipes breaking rows)", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    const data = loadRuns(runsDir, csvLabels, selection);
    const byModel = aggregateByModel(data.perImageRows);
    const byDirModel = aggregateDirectionByModel(data.directionRows);
    const byDirStratum = aggregateDirectionByModelAndStratum(data.directionRows);
    const md = renderMarkdown(data, byModel, byDirModel, byDirStratum, "2026-09-08T00:00:00.000Z");
    expect(md).toContain("# E5 — Label agreement");
    expect(md).toContain("Generated: 2026-09-08T00:00:00.000Z");
    expect(md).toContain("junk-directory");
    // Every markdown table row must have the same pipe count as its header (12: 11 cols + leading/trailing).
    const perImageHeaderIdx = md.indexOf("| image | patient | cohort |");
    expect(perImageHeaderIdx).toBeGreaterThan(-1);
  });

  it("run() writes both the markdown and JSON files and jsonOutPathFor derives the sibling path", () => {
    const outPath = path.join(tmpRoot, "out", "E5-label-agreement.md");
    const { markdown, jsonPath } = run(runsDir, outPath, csvPath, selectionPath);
    expect(jsonPath).toBe(jsonOutPathFor(outPath));
    expect(fsSync.existsSync(outPath)).toBe(true);
    expect(fsSync.existsSync(jsonPath)).toBe(true);
    expect(fsSync.readFileSync(outPath, "utf8")).toBe(markdown);
    const written = JSON.parse(fsSync.readFileSync(jsonPath, "utf8"));
    expect(written.perImageRows.length).toBeGreaterThan(0);
    expect(written.runIds).toContain("E4-00000001-openrouter-google_gemini-2.5-flash");
  });

  it("loadRuns throws a clear error when the runs directory does not exist", () => {
    const csvLabels = parseNihCsv(fsSync.readFileSync(csvPath, "utf8"));
    const selection = JSON.parse(fsSync.readFileSync(selectionPath, "utf8"));
    expect(() => loadRuns(path.join(tmpRoot, "does-not-exist"), csvLabels, selection)).toThrow();
  });
});

// ─── Evolution-artefact acceptance (the enum is the gate, not validation.ok) ─

describe("isProgressionStatus", () => {
  it("accepts every member of the ProgressionStatus enum", () => {
    expect(PROGRESSION_VALUES).toEqual([
      "Improving",
      "Stable",
      "Worsening",
      "Inconclusive",
      "SingleSeries",
    ]);
    for (const value of PROGRESSION_VALUES) expect(isProgressionStatus(value)).toBe(true);
  });

  it("rejects non-enum strings, non-strings and absent values", () => {
    for (const value of ["Deteriorating", "worsening", "", "Stable ", 3, null, undefined, {}]) {
      expect(isProgressionStatus(value)).toBe(false);
    }
  });
});

describe("direction rows: progression is accepted on its own enum validity", () => {
  let tmpRoot: string;
  let runsDir: string;
  const selection = {
    E4: {
      // No Finding -> Effusion == worsening -> expected "Worsening".
      "00000011": [
        { image: "00000011_000.png", followup: 0, labels: "No Finding" },
        { image: "00000011_001.png", followup: 1, labels: "Effusion" },
      ],
      // No Finding throughout == stable-normal -> expected "Stable".
      "00000012": [
        { image: "00000012_000.png", followup: 0, labels: "No Finding" },
        { image: "00000012_001.png", followup: 1, labels: "No Finding" },
      ],
      "00000013": [
        { image: "00000013_000.png", followup: 0, labels: "No Finding" },
        { image: "00000013_001.png", followup: 1, labels: "No Finding" },
      ],
      "00000014": [
        { image: "00000014_000.png", followup: 0, labels: "No Finding" },
        { image: "00000014_001.png", followup: 1, labels: "No Finding" },
      ],
    },
    E4L: {},
    E2: {},
  };

  /** One E4 run whose only artefact is the evolution record under test. */
  async function writeEvolutionRun(patientId: string, evolution: unknown): Promise<string> {
    const runId = `E4-${patientId}-openrouter-google_gemini-2.5-flash`;
    const outputDir = path.join(runsDir, runId, "output");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "evolution_analysis.json"),
      JSON.stringify(evolution, null, 1)
    );
    return runId;
  }

  function rowFor(patientId: string) {
    const data = loadRuns(runsDir, new Map<string, string>(), selection);
    return { data, row: data.directionRows.find((r) => r.patientId === patientId) };
  }

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "label-agreement-evo-"));
    runsDir = path.join(tmpRoot, "runs");

    // (1) Clean record: valid enum, validation.ok true.
    await writeEvolutionRun("00000011", {
      progression: "Worsening",
      trends: [{ finding: "Effusion", trend: "Worsening", details: "new right basal effusion" }],
      validation: { ok: true, issues: [] },
    });

    // (2) The batch's real failure shape: the top-level progression is a clean
    // enum value, but a trends[] entry carried a fifth value, so the record as
    // a whole failed Zod and the pipeline recovered progression from the
    // response's own partial JSON.
    await writeEvolutionRun("00000012", {
      progression: "Stable",
      trends: [],
      validation: {
        ok: false,
        issues: [
          'trends.0.trend: expected one of "Improving"|"Stable"|"Worsening", received "Inconclusive"',
          'progression: taken from partial JSON ("Stable")',
        ],
      },
    });

    // (3) No progression field at all.
    await writeEvolutionRun("00000013", { trends: [], validation: { ok: true, issues: [] } });

    // (4) A string that is not a ProgressionStatus member.
    await writeEvolutionRun("00000014", {
      progression: "Deteriorating",
      validation: { ok: true, issues: [] },
    });
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("scores a valid progression whose validation.ok is true, and does not flag it recovered", () => {
    const { row } = rowFor("00000011");
    expect(row?.modelProgression).toBe("Worsening");
    expect(row?.expectedProgression).toBe("Worsening");
    expect(row?.agree).toBe(true);
    expect(row?.progressionRecovered).toBe(false);
  });

  it("scores a valid progression whose validation.ok is false, flagged as recovered", () => {
    const { row } = rowFor("00000012");
    expect(row?.modelProgression).toBe("Stable");
    expect(row?.expectedProgression).toBe("Stable");
    expect(row?.agree).toBe(true);
    expect(row?.progressionRecovered).toBe(true);
  });

  it("leaves the row unscored when progression is absent", () => {
    const { row } = rowFor("00000013");
    expect(row).toBeDefined(); // the row still exists, it is just not scored
    expect(row?.modelProgression).toBeNull();
    expect(row?.agree).toBeNull();
    expect(row?.progressionRecovered).toBe(false);
  });

  it("leaves the row unscored when progression is not a ProgressionStatus value", () => {
    const { row } = rowFor("00000014");
    expect(row?.modelProgression).toBeNull();
    expect(row?.agree).toBeNull();
    expect(row?.progressionRecovered).toBe(false);
  });

  it("counts and reports the recovered rows in the data, the aggregates and the markdown", () => {
    const { data } = rowFor("00000011");
    expect(data.directionRows).toHaveLength(4);
    expect(data.recoveredProgressionRows).toBe(1);

    const byModel = aggregateDirectionByModel(data.directionRows);
    const gemini = byModel.get("openrouter/google/gemini-2.5-flash")!;
    expect(gemini.total).toBe(4);
    expect(gemini.agreeCount).toBe(2); // both scored rows agree
    expect(gemini.agreeRate).toBe(1); // the two unscored rows are not in the denominator
    expect(gemini.recoveredCount).toBe(1);

    const byStratum = aggregateDirectionByModelAndStratum(data.directionRows);
    expect(byStratum.get("openrouter/google/gemini-2.5-flash||stable-normal")?.recoveredCount).toBe(
      1
    );

    const md = renderMarkdown(
      data,
      aggregateByModel(data.perImageRows),
      byModel,
      byStratum,
      "2026-09-09T00:00:00.000Z"
    );
    expect(md).toContain("Direction rows scored via that recovered path: **1** of 4");
    expect(md).toContain("| model progression | progression source | agree |");
    expect(md).toContain("| Stable | recovered | yes |");
    expect(md).toContain("| Worsening | validated | yes |");
  });
});

// ─── CLI arg parsing ────────────────────────────────────────────────────────

describe("parseArgs / jsonOutPathFor", () => {
  it("defaults --runs and --out relative to the script directory", () => {
    const here = "/repo/experiments/sime2026";
    const { runsDir, outPath, csvPath } = parseArgs([], here);
    expect(runsDir).toBe(path.join(here, "runs"));
    expect(outPath).toBe(path.join(here, "E5-label-agreement.md"));
    expect(csvPath).toContain("Data_Entry_2017.csv");
  });

  it("honours --runs, --out and --csv overrides", () => {
    const { runsDir, outPath, csvPath } = parseArgs(
      ["--runs", "/tmp/myruns", "--out", "/tmp/out.md", "--csv", "/tmp/data.csv"],
      "/repo/experiments/sime2026"
    );
    expect(runsDir).toBe(path.resolve("/tmp/myruns"));
    expect(outPath).toBe(path.resolve("/tmp/out.md"));
    expect(csvPath).toBe(path.resolve("/tmp/data.csv"));
  });

  it("defaultSelectionPath resolves nih-selection.json next to the script", () => {
    expect(defaultSelectionPath("/repo/experiments/sime2026")).toBe(
      path.join("/repo/experiments/sime2026", "nih-selection.json")
    );
  });

  it("jsonOutPathFor swaps .md for .json, or appends .json otherwise", () => {
    expect(jsonOutPathFor("/x/report.md")).toBe("/x/report.json");
    expect(jsonOutPathFor("/x/report")).toBe("/x/report.json");
  });
});
