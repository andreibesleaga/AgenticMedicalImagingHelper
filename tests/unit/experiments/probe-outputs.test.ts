/**
 * Post-run governance audit (experiments/sime2026/probe-outputs.ts).
 *
 * The audit is the evidence behind the paper's "the probe reported zero
 * anchored claims" sentence and now also behind the schema-validation count, so
 * it is tested against synthetic run directories: a clean run, a run whose
 * artefacts record validation failures, and the malformed edges (unreadable
 * JSON, missing output directory, missing progression field).
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import {
  auditRuns,
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
  } = {}
): Promise<void> {
  const runDir = path.join(runsDir, id);
  if (opts.noOutputDir) {
    await fs.mkdir(runDir, { recursive: true });
    return;
  }
  const out = path.join(runDir, "output");
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
});

afterAll(async () => {
  await fs.rm(path.dirname(runsDir), { recursive: true, force: true });
});

describe("probe-outputs audit", () => {
  it("reads the progression from the field the pipeline actually emits", () => {
    const rows = auditRuns(runsDir);
    expect(rowOf(rows, "A-clean").progression).toBe("Improving");
    expect(rowOf(rows, "B-validation-failures").progression).toBe("Stable");
    expect(rowOf(rows, "C-anchored").progression).toBe("Worsening");
  });

  it("counts artefacts and disclaimers, ignoring non-artefact files", () => {
    const row = rowOf(auditRuns(runsDir), "A-clean");
    expect(row.artefacts).toBe(3); // 2 json + 1 md; notes.txt excluded
    expect(row.withDisclaimer).toBe(3);
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
    expect(row.artefacts).toBe(3);
  });

  it("skips a run directory with no output/", () => {
    expect(auditRuns(runsDir).some((r) => r.id === "E-no-output")).toBe(false);
  });

  it("renders a Markdown table with the schema-validation column", () => {
    const table = renderTable(auditRuns(runsDir));
    const [header, separator, ...body] = table.split("\n");
    expect(header).toContain("schema-validation failures");
    expect(separator).toBe("|---|---|---|---|---|---|---|");
    expect(body).toHaveLength(4);
    expect(body.find((l) => l.includes("B-validation-failures"))).toContain("| 2 | Stable |");
    expect(body.find((l) => l.includes("C-anchored"))).toContain("(african american)");
  });

  it("main() writes probe-results.json next to the runs directory", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let rows: ProbeRow[];
    let printed = 0;
    try {
      rows = main(["node", "probe-outputs.ts", runsDir]);
      printed = log.mock.calls.length;
    } finally {
      log.mockRestore();
    }
    expect(printed).toBe(1);
    const written = JSON.parse(
      fsSync.readFileSync(path.join(runsDir, "..", "probe-results.json"), "utf-8")
    ) as ProbeRow[];
    expect(written).toEqual(rows);
    expect(written.map((r) => r.id)).toEqual([
      "A-clean",
      "B-validation-failures",
      "C-anchored",
      "D-malformed",
    ]);
  });
});
