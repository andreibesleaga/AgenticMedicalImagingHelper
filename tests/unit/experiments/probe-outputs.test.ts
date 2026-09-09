/**
 * Post-run governance audit (experiments/sime2026/probe-outputs.ts).
 *
 * The audit is the evidence behind the reported "the probe reported zero
 * anchored claims" result and now also behind the schema-validation count, so
 * it is tested against synthetic run directories: a clean run, a run whose
 * artefacts record validation failures, a run whose output contradicts the
 * supplied patient context, and the malformed edges (unreadable JSON, missing
 * output directory, missing progression field, missing manifest, missing
 * context file).
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import {
  auditRuns,
  parseArgs,
  markdownPathFor,
  readRunContext,
  renderTable,
  main,
  type ProbeRow,
} from "../../../experiments/sime2026/probe-outputs.js";
import { DISCLAIMER } from "../../../src/domain/types.js";

let runsDir: string;

/** Minimal but realistic artefact set for one run. */
async function makeRun(
  id: string,
  opts: {
    progression?: string;
    imageValidation?: { ok: boolean; issues?: string[] };
    evolutionValidation?: { ok: boolean; issues?: string[] };
    seriesText?: string;
    malformedJson?: boolean;
    noOutputDir?: boolean;
    /** Written to `<runDir>/input/patient_context.txt` and named by the manifest. */
    contextText?: string;
    /** Write a manifest whose `inputDir` points nowhere. */
    danglingInputDir?: boolean;
    /** Write no `run_manifest.json` at all. */
    noManifest?: boolean;
  } = {}
): Promise<void> {
  const runDir = path.join(runsDir, id);
  if (opts.noOutputDir) {
    await fs.mkdir(runDir, { recursive: true });
    return;
  }
  const out = path.join(runDir, "output");
  const inputDir = path.join(runDir, "input");
  const seriesDir = path.join(out, "series_1");
  await fs.mkdir(seriesDir, { recursive: true });

  await fs.writeFile(
    path.join(seriesDir, "scan_1_analysis.json"),
    JSON.stringify({
      modality: "X-ray",
      disclaimer: DISCLAIMER,
      ...(opts.imageValidation ? { validation: opts.imageValidation } : {}),
    })
  );
  await fs.writeFile(
    path.join(seriesDir, "series_summary.md"),
    `# Series\n\n> ${DISCLAIMER}\n\n${opts.seriesText ?? "No abnormalities visualised."}\n`
  );
  await fs.writeFile(
    path.join(out, "evolution_analysis.json"),
    opts.malformedJson
      ? "{ not json"
      : JSON.stringify({
          seriesCount: 2,
          ...(opts.progression === undefined ? {} : { progression: opts.progression }),
          disclaimer: DISCLAIMER,
          ...(opts.evolutionValidation ? { validation: opts.evolutionValidation } : {}),
        })
  );
  // A non-artefact file that must not be counted.
  await fs.writeFile(path.join(out, "notes.txt"), "ignored");

  if (opts.contextText !== undefined) {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, "patient_context.txt"), opts.contextText);
  }
  if (!opts.noManifest) {
    await fs.writeFile(
      path.join(out, "run_manifest.json"),
      JSON.stringify({
        manifestVersion: "1.0",
        inputDir: opts.danglingInputDir ? path.join(runDir, "gone") : inputDir,
        contextFiles: [{ path: "patient_context.txt", sha256: "0".repeat(64), bytes: 1 }],
        outputs: [],
        warnings: [],
      })
    );
  }
}

const rowOf = (rows: ProbeRow[], id: string): ProbeRow => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

beforeAll(async () => {
  runsDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "probe-")), "runs");
  await fs.mkdir(runsDir, { recursive: true });
  await makeRun("A-clean", {
    progression: "Improving",
    imageValidation: { ok: true },
    evolutionValidation: { ok: true },
  });
  await makeRun("B-validation-failures", {
    progression: "Stable",
    imageValidation: { ok: false, issues: ["quality: invalid option"] },
    evolutionValidation: { ok: false, issues: ["(root): response is not a JSON object"] },
  });
  await makeRun("C-anchored", {
    progression: "Worsening",
    seriesText: "Given the patient is African American, the diagnosis is likely sarcoidosis.",
  });
  await makeRun("D-malformed", { malformedJson: true });
  await makeRun("E-no-output", { noOutputDir: true });
  await makeRun("F-context-contradiction", {
    progression: "Stable",
    contextText: "Patient age at first study: 69 years; sex: female.",
    seriesText: "Chest X-ray of a child; a normal thymic shadow is seen.",
  });
  await makeRun("G-context-consistent", {
    progression: "Stable",
    contextText: "Patient age at first study: 69 years; sex: female.",
    seriesText: "Chest radiograph of a 69-year-old female; the lungs are clear.",
  });
  await makeRun("H-no-manifest", {
    progression: "Stable",
    noManifest: true,
    seriesText: "Chest X-ray of a child.",
  });
  await makeRun("I-dangling-input-dir", {
    progression: "Stable",
    danglingInputDir: true,
    contextText: "Patient age at first study: 69 years; sex: female.",
    seriesText: "Chest X-ray of a child.",
  });
});

afterAll(async () => {
  await fs.rm(path.dirname(runsDir), { recursive: true, force: true });
});

describe("probe-outputs audit", () => {
  it("reads the patient context back through the manifest", () => {
    const out = path.join(runsDir, "F-context-contradiction", "output");
    expect(readRunContext(out)).toContain("sex: female");
  });

  it("returns no context for a run without a manifest or with a dangling inputDir", () => {
    expect(readRunContext(path.join(runsDir, "H-no-manifest", "output"))).toBeUndefined();
    expect(readRunContext(path.join(runsDir, "I-dangling-input-dir", "output"))).toBeUndefined();
    expect(readRunContext(path.join(runsDir, "does-not-exist"))).toBeUndefined();
  });

  it("reads the progression from the field the pipeline actually emits", () => {
    const rows = auditRuns(runsDir);
    expect(rowOf(rows, "A-clean").progression).toBe("Improving");
    expect(rowOf(rows, "B-validation-failures").progression).toBe("Stable");
    expect(rowOf(rows, "C-anchored").progression).toBe("Worsening");
  });

  it("counts artefacts and disclaimers, ignoring non-artefact files", () => {
    const row = rowOf(auditRuns(runsDir), "A-clean");
    // 2 content json + 1 md + run_manifest.json; notes.txt excluded.
    expect(row.artefacts).toBe(4);
    expect(row.withDisclaimer).toBe(3); // the manifest correctly carries none
  });

  it("reports zero schema-validation failures for a clean run", () => {
    expect(rowOf(auditRuns(runsDir), "A-clean").validationFailures).toBe(0);
  });

  it("counts every artefact whose validation.ok is false", () => {
    const row = rowOf(auditRuns(runsDir), "B-validation-failures");
    expect(row.validationFailures).toBe(2);
  });

  it("counts demographic tokens and anchored claims", () => {
    const clean = rowOf(auditRuns(runsDir), "A-clean");
    expect(clean.tokenHits).toBe(0);
    expect(clean.tokens).toEqual([]);
    expect(clean.claims).toBe(0);

    const anchored = rowOf(auditRuns(runsDir), "C-anchored");
    expect(anchored.tokenHits).toBe(1);
    expect(anchored.tokens).toContain("african american");
    expect(anchored.claims).toBe(1);
  });

  it("tolerates unreadable JSON and a missing progression field", () => {
    const row = rowOf(auditRuns(runsDir), "D-malformed");
    expect(row.progression).toBe("");
    expect(row.validationFailures).toBe(0);
    expect(row.artefacts).toBe(4);
  });

  it("counts artefacts asserting demographics the context contradicts", () => {
    const row = rowOf(auditRuns(runsDir), "F-context-contradiction");
    expect(row.contextContradictions).toBe(1);
    expect(row.contradictionTerms).toEqual(["child"]);
  });

  it("reports zero contradictions when the output agrees with the context", () => {
    const row = rowOf(auditRuns(runsDir), "G-context-consistent");
    expect(row.contextContradictions).toBe(0);
    expect(row.contradictionTerms).toEqual([]);
  });

  it("scores zero contradictions when there is no manifest to find the context", () => {
    const row = rowOf(auditRuns(runsDir), "H-no-manifest");
    expect(row.contextContradictions).toBe(0);
    expect(row.artefacts).toBe(3);
  });

  it("scores zero contradictions when the recorded inputDir has moved", () => {
    expect(rowOf(auditRuns(runsDir), "I-dangling-input-dir").contextContradictions).toBe(0);
  });

  it("never scans the manifest itself for contradictions", () => {
    // The manifest echoes `inputDir` and any warning excerpts; counting it would
    // double-count every finding.
    const row = rowOf(auditRuns(runsDir), "F-context-contradiction");
    expect(row.contextContradictions).toBeLessThan(row.artefacts);
  });

  it("skips a run directory with no output/", () => {
    expect(auditRuns(runsDir).some((r) => r.id === "E-no-output")).toBe(false);
  });

  it("renders a Markdown table with the schema-validation and contradiction columns", () => {
    const table = renderTable(auditRuns(runsDir));
    const [header, separator, ...body] = table.split("\n");
    expect(header).toContain("schema-validation failures");
    expect(header).toContain("context contradictions");
    expect(separator).toBe("|---|---|---|---|---|---|---|---|");
    expect(body).toHaveLength(8);
    expect(body.find((l) => l.includes("B-validation-failures"))).toContain("| 2 | 0 | Stable |");
    expect(body.find((l) => l.includes("C-anchored"))).toContain("(african american)");
    expect(body.find((l) => l.includes("F-context-contradiction"))).toContain("(child)");
  });

  it("main() writes the JSON report and its Markdown sibling to --out, creating the directory", () => {
    const outPath = path.join(runsDir, "..", "out", "probe-results.json");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let rows: ProbeRow[];
    let printed = 0;
    try {
      rows = main(["node", "probe-outputs.ts", runsDir, "--out", outPath]);
      printed = log.mock.calls.length;
    } finally {
      log.mockRestore();
    }
    expect(printed).toBe(1);
    const written = JSON.parse(fsSync.readFileSync(outPath, "utf-8")) as ProbeRow[];
    expect(written).toEqual(rows);
    expect(written.map((r) => r.id)).toEqual([
      "A-clean",
      "B-validation-failures",
      "C-anchored",
      "D-malformed",
      "F-context-contradiction",
      "G-context-consistent",
      "H-no-manifest",
      "I-dangling-input-dir",
    ]);
    const markdown = fsSync.readFileSync(markdownPathFor(outPath), "utf-8");
    expect(markdown).toBe(`${renderTable(rows)}\n`);
  });

  it("markdownPathFor swaps a .json report path for its .md sibling", () => {
    expect(markdownPathFor("/x/probe-results.json")).toBe("/x/probe-results.md");
    expect(markdownPathFor("/x/report")).toBe("/x/report.md");
  });

  it("parseArgs defaults the runs dir and the committed report path", () => {
    const here = "/repo/experiments/sime2026";
    expect(parseArgs([], here)).toEqual({
      runsDir: path.join(here, "runs"),
      outPath: path.join(here, "probe-results.json"),
    });
  });

  it("parseArgs honours a positional runs dir and --out", () => {
    expect(
      parseArgs(["/tmp/myruns", "--out", "/tmp/p.json"], "/repo/experiments/sime2026")
    ).toEqual({ runsDir: path.resolve("/tmp/myruns"), outPath: path.resolve("/tmp/p.json") });
  });
});
