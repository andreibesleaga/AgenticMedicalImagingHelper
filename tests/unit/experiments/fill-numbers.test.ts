/**
 * Number derivation for the paper (experiments/sime2026/fill-numbers.ts).
 *
 * Part of the published suite: `fill-numbers.ts` derives the quantitative
 * macros from the committed evidence in experiments/sime2026/, so it is
 * tested like any other script in the repository (`npm test`).
 *
 * Every quantitative claim in the paper is written by this script, so the
 * parsing and aggregation helpers are tested against offline fixtures: a
 * synthetic results log, synthetic run directories (manifest + per-session
 * records), the Markdown shapes of the E1/E3/ADR reports, and the macro
 * template itself. No network, no API keys, no real artefacts are read.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  groupDigits,
  fixed,
  usdMacro,
  formatLabelCounts,
  formatAgreement,
  parseResultsJsonl,
  latestRow,
  parseManifestTotals,
  classifyRecord,
  parseFairnessBenchmark,
  parsePayloadReport,
  parseAdrOldPreflight,
  cohortShape,
  parseE4RunId,
  summariseE4,
  resolveE2Row,
  resolveE4,
  resolveAgreement,
  resolveFairness,
  resolvePayload,
  resolveCohort,
  resolveTests,
  rewriteMacros,
  remainingPlaceholders,
  renderTraceTable,
  readE4Run,
  e2RunId,
  parseArgs,
  collect,
  main,
  type E4RunArtefacts,
  type MacroResolution,
} from "../../../experiments/sime2026/fill-numbers.js";

/** Value of one macro in a rendered template, or undefined if absent. */
function macroBody(tex: string, macro: string): string | undefined {
  const m = new RegExp(`\\\\newcommand\\{\\\\${macro}\\}\\{([^{}]*)\\}`).exec(tex);
  return m ? m[1] : undefined;
}

function resolution(list: MacroResolution[], macro: string): MacroResolution {
  const found = list.find((r) => r.macro === macro);
  if (!found) throw new Error(`no resolution for ${macro}`);
  return found;
}

describe("formatting helpers", () => {
  it("groups digits with LaTeX thin spaces", () => {
    expect(groupDigits(7)).toBe("7");
    expect(groupDigits(582)).toBe("582");
    expect(groupDigits(1270)).toBe("1\\,270");
    expect(groupDigits(1570313)).toBe("1\\,570\\,313");
    expect(groupDigits(-1270)).toBe("-1\\,270");
  });

  it("formats fixed decimals and escaped dollars", () => {
    expect(fixed(53.5, 1)).toBe("53.5");
    expect(fixed(0.9, 1)).toBe("0.9");
    expect(usdMacro(0.01239)).toBe("\\$0.0124");
  });

  it("orders progression labels canonically and drops empty ones", () => {
    expect(formatLabelCounts({ Improving: 2, Stable: 3, Worsening: 2, Inconclusive: 1 })).toBe(
      "3 Stable / 2 Worsening / 2 Improving / 1 Inconclusive"
    );
    expect(formatLabelCounts({ Stable: 1, Worsening: 0 })).toBe("1 Stable");
    expect(formatLabelCounts({ SingleSeries: 1, Stable: 1 })).toBe("1 Stable / 1 SingleSeries");
    expect(formatLabelCounts({})).toBe("");
  });

  it("formats direction agreement as the paper writes it", () => {
    expect(formatAgreement({ agree: 3, agreePartial: 6, of: 8 })).toBe("3/8 (6/8)");
  });
});

describe("results.jsonl parsing", () => {
  const log = [
    '{"id":"E2-S1x1-c1-openrouter-google_gemini-2.5-flash","exit":0,"wall_s":7.6,"calls":2,"tokens_in":1270,"tokens_out":582,"provider_usd":0.0018}',
    "",
    // a half-written line, as seen while a batch is appending
    '{"id":"E2-S1x1-c1-openrouter-google_gemini-2.5-flash","exit":0,"wall_s":8.1,"calls":2,"provider_usd',
    '{"id":"E2-S2x5-c1-openrouter-google_gemini-2.5-flash","exit":4,"wall_s":53.5}',
  ].join("\n");

  it("skips blank and partially written lines", () => {
    const rows = parseResultsJsonl(log);
    expect(rows.map((r) => r.id)).toEqual([
      "E2-S1x1-c1-openrouter-google_gemini-2.5-flash",
      "E2-S2x5-c1-openrouter-google_gemini-2.5-flash",
    ]);
  });

  it("returns the newest row for a repeated id", () => {
    const rows = parseResultsJsonl(
      ['{"id":"x","wall_s":1}', '{"id":"x","wall_s":2}', '{"id":"y","wall_s":3}'].join("\n")
    );
    expect(latestRow(rows, "x")?.wall_s).toBe(2);
    expect(latestRow(rows, "zzz")).toBeUndefined();
  });

  it("builds the E2 run ids the batch writes", () => {
    expect(e2RunId("S4x20", 5)).toBe("E2-S4x20-c5-openrouter-google_gemini-2.5-flash");
  });
});

describe("manifest and record classification", () => {
  it("reads totals and tolerates malformed manifests", () => {
    expect(parseManifestTotals('{"totals":{"calls":13,"providerUsd":0.017}}')).toEqual({
      calls: 13,
      providerUsd: 0.017,
    });
    expect(parseManifestTotals("{}")).toBeUndefined();
    expect(parseManifestTotals("not json")).toBeUndefined();
  });

  it("separates schema failures from transport failures", () => {
    expect(classifyRecord({ validation: { ok: true } })).toBe("ok");
    expect(classifyRecord({ validation: { ok: false } })).toBe("invalid");
    expect(classifyRecord({ status: "error" })).toBe("transport-error");
    expect(classifyRecord({ status: "success" })).toBe("other");
    expect(classifyRecord({ validation: null, status: "error" })).toBe("transport-error");
  });

  it("splits a cohort run id into its parts", () => {
    expect(parseE4RunId("E4-00000008-openrouter-google_gemini-2.5-flash")).toEqual({
      cohort: "E4",
      patient: "00000008",
      provider: "openrouter",
      modelTag: "google_gemini-2.5-flash",
    });
    expect(parseE4RunId("E2-S1x1-c1-openrouter-google_gemini-2.5-flash")).toBeUndefined();
  });
});

describe("report parsing", () => {
  const e1 = [
    "| Category | Expected | n | With listed token | TP | FP | TN | FN | Category rate |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
    "| explicit | true | 20 | 20 | 20 | 0 | 0 | 0 | recall 1.000 |",
    "| paraphrase | true | 20 | 10 | 4 | 0 | 0 | 16 | recall 0.200 |",
    "| implicit | true | 15 | 0 | 0 | 0 | 0 | 15 | recall 0.000 |",
    "| benign | false | 20 | 19 | 0 | 0 | 20 | 0 | FP rate 0.000 |",
    "| negation | false | 15 | 14 | 0 | 8 | 7 | 0 | FP rate 0.533 |",
    "| trap | false | 20 | 20 | 0 | 12 | 8 | 0 | FP rate 0.600 |",
    "| **overall** | — | 110 | 83 | 24 | 20 | 35 | 31 | — |",
    "",
    "| Metric | Value |",
    "|---|---:|",
    "| Precision | 0.545 |",
    "| Recall | 0.436 |",
    "| F1 | 0.485 |",
  ].join("\n");

  it("reads the E1 benchmark tables", () => {
    expect(parseFairnessBenchmark(e1)).toEqual({
      items: 110,
      explicitRecall: 1,
      paraphraseRecall: 0.2,
      implicitRecall: 0,
      benignFalsePositives: 0,
      negationFpRate: 0.533,
      trapFpRate: 0.6,
      precision: 0.545,
      recall: 0.436,
      f1: 0.485,
    });
  });

  it("survives an E1 report with no tables", () => {
    expect(parseFairnessBenchmark("# nothing here")).toEqual({});
  });

  it("reads the E3 totals line and policy target", () => {
    const md = [
      "- Policy: `IMAGE_QUALITY=auto`, long-edge target 1536 px, tile-aligned to 768 px",
      "",
      "Totals: 684548 B on disk → 678332 B sent (0.9% reduction) → 904492 base64 characters",
    ].join("\n");
    expect(parsePayloadReport(md)).toEqual({
      originalBytes: 684548,
      sentBytes: 678332,
      reductionPct: 0.9,
      targetDim: 1536,
    });
    expect(parsePayloadReport("no totals here")).toEqual({});
  });

  it("reads the retired pre-flight numbers out of ADR-003", () => {
    const adr = [
      "| cohort | n | original | old | new |",
      "|---|---|---|---|---|",
      "| `e4-224px` (NIH derivative, 224 px) | 31 | 684,548 B | 1,570,313 B (**+129.4 %**) | 678,332 B (**−0.9 %**) |",
    ].join("\n");
    expect(parseAdrOldPreflight(adr)).toEqual({ bytes: 1570313, pct: 129.4 });
    expect(parseAdrOldPreflight("| other | row |")).toEqual({});
  });

  it("derives the cohort shape from the selection manifest", () => {
    expect(
      cohortShape({
        "00000008": [{}, {}, {}],
        "00000239": [{}, {}, {}, {}, {}, {}],
        "00000067": [{}, {}, {}],
      })
    ).toEqual({ patients: 3, studies: 12, minSessions: 3, maxSessions: 6 });
    expect(cohortShape({})).toBeUndefined();
  });
});

describe("E2 Table I resolution", () => {
  const row = {
    id: e2RunId("S2x5", 1),
    exit: 0,
    wall_s: 53.5,
    calls: 13,
    tokens_in: 12450,
    tokens_out: 5374,
    provider_usd: 0.017,
  };

  it("prefers manifest totals over the scraped results row", () => {
    const macros = resolveE2Row("S2x5", "TWOFIVE", 1, "CONE", row, {
      calls: 13,
      tokensIn: 12450,
      tokensOut: 5374,
      providerUsd: 0.0169983,
    });
    expect(resolution(macros, "ORTWOFIVECONECALLS").value).toBe("13");
    expect(resolution(macros, "ORTWOFIVECONEIN").value).toBe("12\\,450");
    expect(resolution(macros, "ORTWOFIVECONEOUT").value).toBe("5\\,374");
    expect(resolution(macros, "ORTWOFIVECONEUSD").value).toBe("0.0170");
    expect(resolution(macros, "ORTWOFIVECONETIME").value).toBe("53.5");
    expect(resolution(macros, "ORTWOFIVECONECALLS").source).toContain("run_manifest.json");
    expect(macros.every((m) => m.note === undefined)).toBe(true);
  });

  it("falls back to the results row when no manifest was written", () => {
    const macros = resolveE2Row("S2x5", "TWOFIVE", 1, "CONE", row, undefined);
    expect(resolution(macros, "ORTWOFIVECONECALLS").value).toBe("13");
    expect(resolution(macros, "ORTWOFIVECONEUSD").value).toBe("0.0170");
    expect(resolution(macros, "ORTWOFIVECONECALLS").source).toContain("results.jsonl");
  });

  it("leaves every macro of a missing run unresolved, with a reason", () => {
    const macros = resolveE2Row("S4x20", "FOURTWENTY", 5, "CFIVE", undefined, undefined);
    expect(macros).toHaveLength(5);
    expect(macros.every((m) => m.value === undefined)).toBe(true);
    expect(macros.every((m) => (m.note ?? "").includes("no run for"))).toBe(true);
  });

  it("flags a run that exited non-zero as a failure, not a measurement", () => {
    const macros = resolveE2Row(
      "S1x1",
      "ONEONE",
      5,
      "CFIVE",
      {
        ...row,
        id: e2RunId("S1x1", 5),
        exit: 4,
        images_line: "Images analyzed:   0 success, 1 failed",
      },
      undefined
    );
    expect(resolution(macros, "ORONEONECFIVECALLS").note).toContain("run exited 4");
  });
});

describe("E4 aggregation", () => {
  const runs: E4RunArtefacts[] = [
    {
      id: "E4-00000008-openrouter-google_gemini-2.5-flash",
      patient: "00000008",
      modelTag: "google_gemini-2.5-flash",
      progression: "Worsening",
      records: 4,
      validationFailures: 1,
      transportErrors: 0,
      providerUsd: 0.012,
      exit: 0,
    },
    {
      id: "E4-00000067-openrouter-google_gemini-2.5-flash",
      patient: "00000067",
      modelTag: "google_gemini-2.5-flash",
      progression: "Stable",
      records: 4,
      validationFailures: 0,
      transportErrors: 0,
      providerUsd: 0.0128,
      exit: 0,
    },
    {
      id: "E4-00000086-openrouter-google_gemini-2.5-flash",
      patient: "00000086",
      modelTag: "google_gemini-2.5-flash",
      progression: "Stable",
      records: 4,
      validationFailures: 0,
      transportErrors: 0,
      providerUsd: 0.0124,
      exit: 4,
    },
    {
      id: "E4-00000008-openrouter-google_gemma-4-31b-it",
      patient: "00000008",
      modelTag: "google_gemma-4-31b-it",
      progression: "Inconclusive",
      records: 4,
      validationFailures: 3,
      transportErrors: 0,
      providerUsd: 0.0028,
      exit: 0,
    },
    {
      id: "E4-00000008-openrouter-anthropic_claude-sonnet-5",
      patient: "00000008",
      modelTag: "anthropic_claude-sonnet-5",
      progression: "Stable",
      records: 4,
      validationFailures: 0,
      transportErrors: 2,
      providerUsd: 0.1052,
      exit: 0,
    },
  ];

  it("summarises per model", () => {
    const byModel = summariseE4(runs);
    const gem = byModel.get("google_gemini-2.5-flash");
    expect(gem).toMatchObject({ runs: 3, completed: 2, records: 12, validationFailures: 1 });
    expect(gem?.labels).toEqual({ Worsening: 1, Stable: 2 });
    expect(byModel.get("anthropic_claude-sonnet-5")?.transportErrors).toBe(2);
  });

  it("derives the operational, validation and cost macros", () => {
    const macros = resolveE4(runs);
    expect(resolution(macros, "EFOURDONE").value).toBe("2");
    expect(resolution(macros, "EFOURLABELS").value).toBe("2 Stable / 1 Worsening");
    // Whole-cohort spend, all models.
    expect(resolution(macros, "EFOURUSD").value).toBe("0.1452");
    expect(resolution(macros, "EFOURUSD").note).toContain("google_gemini-2.5-flash");
    // gemma is quoted with its denominator, the others as plain counts.
    expect(resolution(macros, "VFGMA").value).toBe("3 of 4");
    expect(resolution(macros, "VFGEM").value).toBe("1");
    expect(resolution(macros, "VFCLD").value).toBe("0");
    expect(resolution(macros, "VFCLDERR").value).toBe("2");
    expect(resolution(macros, "CPPGEM").value).toBe("\\$0.0124");
    expect(resolution(macros, "CPPCLD").value).toBe("\\$0.1052");
    // qwen was not run at all: unresolved, with a reason.
    expect(resolution(macros, "VFQWN").value).toBeUndefined();
    expect(resolution(macros, "CPPQWN").note).toContain("no E4 runs");
  });

  it("resolves nothing when no run directory exists", () => {
    const macros = resolveE4([]);
    expect(macros.every((m) => m.value === undefined)).toBe(true);
  });
});

describe("reviewer-maintained and report-derived groups", () => {
  it("only reformats the human-judged agreement values", () => {
    const macros = resolveAgreement({
      models: {
        "google/gemini-2.5-flash": { agree: 3, agreePartial: 6, of: 8 },
        "google/gemma-4-31b-it": { agree: 0, agreePartial: 1, of: 8 },
      },
    });
    expect(resolution(macros, "AGRGEM").value).toBe("3/8 (6/8)");
    expect(resolution(macros, "AGRGMA").value).toBe("0/8 (1/8)");
    expect(resolution(macros, "AGRQWN").value).toBeUndefined();
    expect(resolution(macros, "AGRGEM").source).toContain("QUALITATIVE-REVIEW");
  });

  it("leaves every agreement macro unresolved when the file is missing", () => {
    expect(resolveAgreement(undefined).every((m) => m.value === undefined)).toBe(true);
  });

  it("formats the fairness macros at the paper's precision", () => {
    const macros = resolveFairness(
      { items: 110, explicitRecall: 1, benignFalsePositives: 0, precision: 0.545 },
      "E1.md"
    );
    expect(resolution(macros, "FBITEMS").value).toBe("110");
    expect(resolution(macros, "FBEXPLICIT").value).toBe("1.00");
    expect(resolution(macros, "FBBENIGNFP").value).toBe("0");
    expect(resolution(macros, "FBPREC").value).toBe("0.545");
    expect(resolution(macros, "FBREC").value).toBeUndefined();
  });

  it("converts payload bytes to the paper's units", () => {
    const macros = resolvePayload(
      { originalBytes: 684548, sentBytes: 678332, reductionPct: 0.9, targetDim: 1536 },
      { originalBytes: 45551868, sentBytes: 6066209, reductionPct: 86.7 },
      { bytes: 1570313, pct: 129.4 },
      { small: "E3-small.md", large: "E3-large.md", adr: "ADR-003.md" }
    );
    expect(resolution(macros, "EPBASE").value).toBe("684\\,548");
    expect(resolution(macros, "EPOLD").value).toBe("1\\,570\\,313");
    expect(resolution(macros, "EPOLDPCT").value).toBe("129.4");
    expect(resolution(macros, "EPNEW").value).toBe("678\\,332");
    expect(resolution(macros, "EPNEWPCT").value).toBe("0.9");
    expect(resolution(macros, "EPLARGEIN").value).toBe("45.6");
    expect(resolution(macros, "EPLARGEOUT").value).toBe("6.07");
    expect(resolution(macros, "EPTILE").value).toBe("1536");
  });

  it("describes the cohort from the selection manifest", () => {
    const macros = resolveCohort(
      { patients: 8, studies: 31, minSessions: 3, maxSessions: 6 },
      "nih-selection.json"
    );
    expect(resolution(macros, "EFOURPATIENTS").value).toBe("8");
    expect(resolution(macros, "EFOURSTUDIES").value).toBe("31");
    expect(resolution(macros, "EFOURSESSIONS").value).toBe("3--6");
    expect(resolveCohort(undefined, "nih-selection.json").every((m) => !m.value)).toBe(true);
  });

  it("takes coverage from the summary and test counts only from a jest report", () => {
    const withReports = resolveTests(
      { total: { statements: { pct: 99.26 } } },
      { numTotalTests: 738, numTotalTestSuites: 32 },
      { coverage: "coverage/coverage-summary.json", jest: "jest.json" }
    );
    expect(resolution(withReports, "COVERAGE").value).toBe("99.3");
    expect(resolution(withReports, "NTESTS").value).toBe("738");
    expect(resolution(withReports, "NSUITES").value).toBe("32");

    const without = resolveTests(undefined, undefined, {
      coverage: "coverage/coverage-summary.json",
    });
    expect(without.every((m) => m.value === undefined)).toBe(true);
    expect(resolution(without, "COVERAGE").note).toContain("coverage-summary.json");
  });
});

describe("template rewriting", () => {
  const template = [
    "%% comment",
    "\\newcommand{\\NTESTS}{587}          % settled",
    "\\newcommand{\\ORONEONECONECALLS}{XXX}",
    "\\newcommand{\\ORONEONECONEUSD}{X.XXX}",
    "\\newcommand{\\EFOURLABELS}{TBD}",
    "\\newcommand{\\CTXPROBE}{a context-consistency check now flags age, sex and",
    "life-stage assertions that contradict the supplied clinical context}",
  ].join("\n");

  it("replaces only the macros it has values for", () => {
    const { text, applied, unresolved, unknown } = rewriteMacros(template, [
      { macro: "ORONEONECONECALLS", value: "2", source: "s" },
      { macro: "ORONEONECONEUSD", value: undefined, source: "s" },
      { macro: "NOSUCHMACRO", value: "9", source: "s" },
    ]);
    expect(macroBody(text, "ORONEONECONECALLS")).toBe("2");
    expect(macroBody(text, "ORONEONECONEUSD")).toBe("X.XXX");
    expect(macroBody(text, "NTESTS")).toBe("587");
    expect(applied).toEqual(["ORONEONECONECALLS"]);
    expect(unresolved).toEqual(["ORONEONECONEUSD"]);
    expect(unknown).toEqual(["NOSUCHMACRO"]);
  });

  it("leaves a multi-line macro body alone unless it is given a value", () => {
    const untouched = rewriteMacros(template, [{ macro: "NTESTS", value: "738", source: "s" }]);
    expect(untouched.text).toContain(
      "life-stage assertions that contradict the supplied clinical context}"
    );
    // \\CTXPROBE is prose spanning two lines; a value replaces the whole body.
    const replaced = rewriteMacros(template, [{ macro: "CTXPROBE", value: "x", source: "s" }]);
    expect(replaced.text).toContain("\\newcommand{\\CTXPROBE}{x}");
  });

  it("lists the bodies still holding a placeholder", () => {
    expect(remainingPlaceholders(template)).toEqual([
      "ORONEONECONECALLS",
      "ORONEONECONEUSD",
      "EFOURLABELS",
    ]);
  });

  it("renders one traceable row per macro", () => {
    const table = renderTraceTable([
      { macro: "ORONEONECONECALLS", value: "2", source: "runs/E2-.../run_manifest.json" },
      { macro: "EFOURUSD", value: undefined, source: "results.jsonl" },
    ]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("\\ORONEONECONECALLS");
    expect(lines[3]).toContain("kept template value");
  });
});

describe("reading run directories and the end-to-end CLI", () => {
  let dir: string;
  let runsDir: string;
  let docsDir: string;
  let templateFile: string;

  /** A run directory with a manifest, per-image records and an evolution record. */
  async function makeRun(
    id: string,
    opts: {
      providerUsd?: number;
      images: Array<{ ok?: boolean; status?: string }>;
      progression?: string;
      noManifest?: boolean;
    }
  ): Promise<void> {
    const out = path.join(runsDir, id, "output", "series_1");
    await fs.mkdir(out, { recursive: true });
    if (!opts.noManifest) {
      await fs.writeFile(
        path.join(runsDir, id, "output", "run_manifest.json"),
        JSON.stringify({ totals: { calls: 4, providerUsd: opts.providerUsd ?? 0 } })
      );
    }
    let i = 0;
    for (const img of opts.images) {
      i++;
      const record: Record<string, unknown> = { status: img.status ?? "success" };
      if (img.ok !== undefined) record.validation = { ok: img.ok };
      await fs.writeFile(path.join(out, `img_0${i}_analysis.json`), JSON.stringify(record));
    }
    if (opts.progression) {
      await fs.writeFile(
        path.join(runsDir, id, "output", "evolution_analysis.json"),
        JSON.stringify({ progression: opts.progression, validation: { ok: true } })
      );
    }
    // A non-record file that must not be counted.
    await fs.writeFile(path.join(out, "series_summary.md"), "# summary\n");
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "fill-numbers-"));
    runsDir = path.join(dir, "runs");
    docsDir = path.join(dir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    await makeRun("E4-00000008-openrouter-google_gemini-2.5-flash", {
      providerUsd: 0.0124,
      images: [{ ok: true }, { ok: false }],
      progression: "Worsening",
    });
    await makeRun("E4-00000067-openrouter-google_gemini-2.5-flash", {
      providerUsd: 0.0124,
      images: [{ ok: true }, { ok: true }],
      progression: "Stable",
    });
    await makeRun("E4-00000008-openrouter-anthropic_claude-sonnet-5", {
      providerUsd: 0.1052,
      images: [{ ok: true }, { status: "error" }],
      progression: "Stable",
    });
    await makeRun("E2-S1x1-c1-openrouter-google_gemini-2.5-flash", { images: [{ ok: true }] });

    await fs.writeFile(
      path.join(dir, "results.jsonl"),
      [
        '{"id":"E4-00000008-openrouter-google_gemini-2.5-flash","exit":0,"provider_usd":0.0124}',
        '{"id":"E4-00000067-openrouter-google_gemini-2.5-flash","exit":0,"provider_usd":0.0124}',
        '{"id":"E4-00000008-openrouter-anthropic_claude-sonnet-5","exit":0,"provider_usd":0.1052}',
        '{"id":"E2-S1x1-c1-openrouter-google_gemini-2.5-flash","exit":0,"wall_s":7.6,"calls":2,"tokens_in":1270,"tokens_out":582,"provider_usd":0.0018}',
      ].join("\n")
    );
    await fs.writeFile(
      path.join(docsDir, "nih-selection.json"),
      JSON.stringify({ E4: { "00000008": [{}, {}, {}], "00000067": [{}, {}, {}, {}] } })
    );
    await fs.writeFile(
      path.join(docsDir, "qualitative-agreement.json"),
      JSON.stringify({
        models: { "google/gemini-2.5-flash": { agree: 3, agreePartial: 6, of: 8 } },
      })
    );
    templateFile = path.join(dir, "numbers.tex");
    await fs.writeFile(
      templateFile,
      [
        "\\newcommand{\\ORONEONECONECALLS}{XXX}",
        "\\newcommand{\\ORONEONECONETIME}{XXX}",
        "\\newcommand{\\ORFOURTWENTYCFIVEUSD}{X.XXX}",
        "\\newcommand{\\EFOURPATIENTS}{0}",
        "\\newcommand{\\EFOURDONE}{XXX}",
        "\\newcommand{\\EFOURLABELS}{TBD}",
        "\\newcommand{\\VFGEM}{XXX}",
        "\\newcommand{\\AGRGEM}{TBD}",
      ].join("\n")
    );
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("counts records, failures and transport errors in one run", () => {
    const run = readE4Run(runsDir, "E4-00000008-openrouter-anthropic_claude-sonnet-5", {
      id: "E4-00000008-openrouter-anthropic_claude-sonnet-5",
      exit: 0,
    });
    expect(run).toMatchObject({
      patient: "00000008",
      modelTag: "anthropic_claude-sonnet-5",
      progression: "Stable",
      records: 3, // 2 images + the evolution record; the .md is not a record
      validationFailures: 0,
      transportErrors: 1,
      providerUsd: 0.1052,
    });
  });

  it("returns nothing for a directory that is not a cohort run", () => {
    expect(
      readE4Run(runsDir, "E2-S1x1-c1-openrouter-google_gemini-2.5-flash", undefined)
    ).toBeUndefined();
  });

  it("survives a run directory with no output at all", async () => {
    await fs.mkdir(path.join(runsDir, "E4-99999999-openrouter-google_gemma-4-31b-it"), {
      recursive: true,
    });
    const run = readE4Run(runsDir, "E4-99999999-openrouter-google_gemma-4-31b-it", undefined);
    expect(run).toMatchObject({ records: 0, validationFailures: 0, providerUsd: undefined });
    await fs.rm(path.join(runsDir, "E4-99999999-openrouter-google_gemma-4-31b-it"), {
      recursive: true,
    });
  });

  it("collects every macro group from a synthetic artefact tree", () => {
    const opts = parseArgs(
      [
        "node",
        "fill-numbers.ts",
        "--out",
        path.join(dir, "out.tex"),
        "--runs",
        runsDir,
        "--results",
        path.join(dir, "results.jsonl"),
        "--docs",
        docsDir,
        "--template",
        templateFile,
        "--coverage",
        path.join(dir, "no-such-coverage.json"),
      ],
      docsDir
    );
    const macros = collect(opts);
    // The manifest totals (4 calls) win over the results row (2 calls).
    expect(resolution(macros, "ORONEONECONECALLS").value).toBe("4");
    expect(resolution(macros, "EFOURPATIENTS").value).toBe("2");
    expect(resolution(macros, "EFOURSTUDIES").value).toBe("7");
    expect(resolution(macros, "EFOURDONE").value).toBe("2");
    expect(resolution(macros, "EFOURLABELS").value).toBe("1 Stable / 1 Worsening");
    expect(resolution(macros, "VFGEM").value).toBe("1");
    expect(resolution(macros, "VFCLDERR").value).toBe("1");
    expect(resolution(macros, "AGRGEM").value).toBe("3/8 (6/8)");
    expect(resolution(macros, "COVERAGE").value).toBeUndefined();
  });

  it("writes a generated file, keeping placeholders it cannot fill", async () => {
    const out = path.join(dir, "numbers-generated.tex");
    const code = main(
      [
        "node",
        "fill-numbers.ts",
        "--out",
        out,
        "--runs",
        runsDir,
        "--results",
        path.join(dir, "results.jsonl"),
        "--docs",
        docsDir,
        "--template",
        templateFile,
        "--coverage",
        path.join(dir, "no-such-coverage.json"),
      ],
      docsDir
    );
    expect(code).toBe(0);
    const tex = await fs.readFile(out, "utf-8");
    expect(tex.startsWith("%% numbers-generated.tex — GENERATED")).toBe(true);
    expect(macroBody(tex, "ORONEONECONECALLS")).toBe("4");
    expect(macroBody(tex, "ORONEONECONETIME")).toBe("7.6");
    expect(macroBody(tex, "EFOURDONE")).toBe("2");
    expect(macroBody(tex, "AGRGEM")).toBe("3/8 (6/8)");
    // No S4x20 run exists in the fixture tree, so its macro stays a placeholder.
    expect(macroBody(tex, "ORFOURTWENTYCFIVEUSD")).toBe("X.XXX");
    // Re-running over unchanged artefacts must produce byte-identical output.
    const again = path.join(dir, "numbers-generated-2.tex");
    main(
      [
        "node",
        "fill-numbers.ts",
        "--out",
        again,
        "--runs",
        runsDir,
        "--results",
        path.join(dir, "results.jsonl"),
        "--docs",
        docsDir,
        "--template",
        templateFile,
        "--coverage",
        path.join(dir, "no-such-coverage.json"),
      ],
      docsDir
    );
    expect(await fs.readFile(again, "utf-8")).toBe(tex);
  });

  it("reports a missing template instead of throwing", () => {
    const code = main(
      ["node", "fill-numbers.ts", "--out", path.join(dir, "x.tex"), "--template", "/nope/nope.tex"],
      docsDir
    );
    expect(code).toBe(2);
  });

  it("requires --out", () => {
    expect(() => parseArgs(["node", "fill-numbers.ts"], docsDir)).toThrow(/--out/);
  });
});
