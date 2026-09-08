/**
 * Human oversight in rendered reports (EU AI Act Art. 14).
 *
 * The existing `DISCLAIMER` says the output is educational. This block says
 * something narrower: *this artefact has not been reviewed yet*, and names the
 * role that must review it. It has to be the first thing in the file, because
 * that is the only position that survives a skim, a truncated diff, or a paste
 * into a chat window.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import { HUMAN_REVIEW_BLOCK, writeReports } from "../../../src/infrastructure/report-writer.js";
import { DISCLAIMER } from "../../../src/domain/types.js";
import type { GraphState, SeriesSummary, TemporalAnalysis } from "../../../src/domain/types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oversight-test-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function summary(): SeriesSummary {
  return {
    seriesId: "series_1",
    imageCount: 1,
    successCount: 1,
    failureCount: 0,
    consistentFindings: [],
    discrepancies: [],
    primaryDiagnosis: "Normal",
    differentialDiagnoses: [],
    confidenceLevel: "High",
    textContextUsed: false,
    report: "narrative",
    processedAt: "2026-01-01T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

function evolution(): TemporalAnalysis {
  return {
    seriesCount: 2,
    seriesIds: ["series_1", "series_2"],
    progression: "Stable",
    trends: [],
    forecastedEvolution: "no change expected",
    treatmentRecommendations: [],
    combinedReport: "narrative",
    processedAt: "2026-01-01T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

function state(): GraphState {
  return {
    inputDir: "/input",
    outputDir: tmp,
    series: [],
    imageResults: [],
    seriesResults: [summary()],
    evolutionResult: evolution(),
  };
}

describe("HUMAN_REVIEW_BLOCK", () => {
  it("names the required reviewer, the requirement, and where it is recorded", () => {
    expect(HUMAN_REVIEW_BLOCK).toMatch(/Requires review by a qualified clinician before any use/);
    expect(HUMAN_REVIEW_BLOCK).toMatch(/run_manifest\.json/);
    expect(HUMAN_REVIEW_BLOCK).toMatch(/Art\. 14/);
  });

  it("renders as a Markdown blockquote on every line", () => {
    for (const line of HUMAN_REVIEW_BLOCK.split("\n")) {
      expect(line.startsWith(">")).toBe(true);
    }
  });
});

describe("writeReports — Art. 14 review block", () => {
  it("starts every Markdown report with the block, before the title", async () => {
    const written = await writeReports(state());
    const markdown = written.filter((p) => p.endsWith(".md"));
    expect(markdown).toHaveLength(2);

    for (const file of markdown) {
      const content = await fs.readFile(file, "utf-8");
      expect(content.startsWith(HUMAN_REVIEW_BLOCK)).toBe(true);
      expect(content.indexOf(HUMAN_REVIEW_BLOCK)).toBeLessThan(content.indexOf("# "));
    }
  });

  it("keeps the educational disclaimer as well — the two say different things", async () => {
    for (const file of (await writeReports(state())).filter((p) => p.endsWith(".md"))) {
      const content = await fs.readFile(file, "utf-8");
      expect(content).toContain(HUMAN_REVIEW_BLOCK);
      expect(content).toContain(DISCLAIMER);
    }
  });

  it("does not add the block to the machine-readable JSON artefacts", async () => {
    const written = await writeReports(state());
    const json = written.find((p) => p.endsWith("evolution_analysis.json"))!;
    const parsed = JSON.parse(await fs.readFile(json, "utf-8")) as TemporalAnalysis;
    expect(parsed.disclaimer).toBe(DISCLAIMER);
    expect(JSON.stringify(parsed)).not.toContain("Requires review by a qualified clinician");
  });
});
