/**
 * Bias probe v2 — unit behaviour and benchmark regression.
 *
 * Two benchmarks, with different status:
 * - `fairness-benchmark.json` (110 items) is the SIME 2026 benchmark. Version 2
 *   was TUNED on it, so for v2 it is a development set and its numbers are
 *   optimistic by construction.
 * - `fairness-benchmark-v2.json` (96 items) was written BEFORE v2 was run on it
 *   and must never be used for tuning. Its numbers are the honest estimate.
 *
 * Both results are pinned exactly, so any change to the probe shows up here.
 * Version 1 stays pinned in fairness.benchmark.test.ts (the published figure).
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

import {
  BIAS_TERMS,
  biasProbeWarnings,
  containsDemographicClaimV2,
  findBiasHits,
  splitSentences,
} from "../../../src/domain/fairness-v2.js";
import { containsDemographicClaim } from "../../../src/domain/fairness.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DEV = path.resolve(__dirname, "../../fixtures/fairness-benchmark.json");
const HELD_OUT = path.resolve(__dirname, "../../fixtures/fairness-benchmark-v2.json");

interface Item {
  id: string;
  category: string;
  attribute?: string;
  text: string;
  expected: boolean;
}

function load(file: string): Item[] {
  return (JSON.parse(fs.readFileSync(file, "utf-8")) as { items: Item[] }).items;
}

function confusion(items: Item[], probe: (t: string) => boolean) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const it of items) {
    const p = probe(it.text);
    if (it.expected && p) tp++;
    else if (!it.expected && p) fp++;
    else if (!it.expected && !p) tn++;
    else fn++;
  }
  return { tp, fp, tn, fn };
}

describe("bias probe v2 — unit behaviour", () => {
  it("flags a demographic attribute used as justification in the same sentence", () => {
    const hits = findBiasHits(
      "Given the patient is Black, the nodes likely represent sarcoidosis."
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attribute).toBe("race-ethnicity");
  });

  it("covers the new attribute classes", () => {
    expect(
      findBiasHits("As a refugee, the adenopathy is most likely tuberculous.")[0]!.attribute
    ).toBe("nationality-migration");
    expect(findBiasHits("The patient is homeless, so the cavity is likely TB.")[0]!.attribute).toBe(
      "socioeconomic"
    );
    expect(
      findBiasHits("Because the patient is gay, the opacities are presumed PCP.")[0]!.attribute
    ).toBe("sexual-orientation-gender-identity");
    expect(findBiasHits("She is Muslim, so the deficiency is likely dietary.")[0]!.attribute).toBe(
      "religion"
    );
  });

  it("does not fire on a descriptor without a justification", () => {
    expect(containsDemographicClaimV2("Demographics: Asian patient, 34 years, female.")).toBe(
      false
    );
  });

  it("does not fire when the attribute and the justifier are in different sentences", () => {
    expect(
      containsDemographicClaimV2("Black patient, 58 years. The nodule is likely a granuloma.")
    ).toBe(false);
  });

  it("respects negation in the same sentence", () => {
    expect(
      containsDemographicClaimV2(
        "Race was not used; the nodes are likely reactive on size criteria."
      )
    ).toBe(false);
    expect(
      containsDemographicClaimV2("Irrespective of ethnicity, the lesion likely represents a cyst.")
    ).toBe(false);
  });

  it("ignores clinical homonyms (white matter, black lung, blind-ending)", () => {
    expect(
      containsDemographicClaimV2("White matter changes likely reflect small-vessel disease.")
    ).toBe(false);
    expect(
      containsDemographicClaimV2("Black lung disease is suggested by upper zone nodules.")
    ).toBe(false);
    expect(
      containsDemographicClaimV2("The blind-ending loop likely represents the appendix.")
    ).toBe(false);
  });

  it("does not let a stereotype phrase count as its own justification", () => {
    expect(containsDemographicClaimV2("Breast density typical for women in this age group.")).toBe(
      false
    );
    expect(
      containsDemographicClaimV2(
        "Bone density is typical for women of this age and suggests osteoporosis."
      )
    ).toBe(true);
  });

  it("does not list age as an alarm attribute (age is a legitimate clinical prior)", () => {
    expect(
      containsDemographicClaimV2("Degenerative changes are consistent with the patient's age.")
    ).toBe(false);
  });

  it("splits sentences on punctuation and line breaks", () => {
    expect(splitSentences("One. Two!\n- Three; four?")).toEqual([
      "One.",
      "Two!",
      "- Three;",
      "four?",
    ]);
  });

  it("formats manifest warnings with a headline and one line per hit", () => {
    expect(biasProbeWarnings("Nothing here.")).toEqual([]);
    const w = biasProbeWarnings("As a refugee, the adenopathy is most likely tuberculous.");
    expect(w[0]).toMatch(/^bias-probe v2: 1 sentence\(s\).*\[nationality-migration\]/);
    expect(w[1]).toMatch(
      /^bias-probe \[nationality-migration\] "refugee" \+ "likely": "As a refugee/
    );
  });

  it("is deterministic", () => {
    const t = "Given that she is Jewish, the cyst is presumed hereditary.";
    expect(findBiasHits(t)).toEqual(findBiasHits(t));
  });

  it("every attribute class has at least one term", () => {
    for (const terms of Object.values(BIAS_TERMS)) expect(terms.length).toBeGreaterThan(0);
  });
});

describe("bias probe v2 — benchmarks (pinned)", () => {
  it("development set (110 items, the SIME 2026 benchmark; v2 was tuned on it)", () => {
    const m = confusion(load(DEV), containsDemographicClaimV2);
    expect(m).toEqual({ tp: 54, fp: 0, tn: 55, fn: 1 });
  });

  it("held-out set (96 items, written before v2 was run on it): the honest estimate", () => {
    const items = load(HELD_OUT);
    expect(items).toHaveLength(96);
    expect(new Set(items.map((i) => i.id)).size).toBe(96);
    const m = confusion(items, containsDemographicClaimV2);
    expect(m).toEqual({ tp: 26, fp: 2, tn: 48, fn: 20 });
    // precision 26/28 = 0.929, recall 26/46 = 0.565, F1 = 0.703
    expect(Number((m.tp / (m.tp + m.fp)).toFixed(3))).toBe(0.929);
    expect(Number((m.tp / (m.tp + m.fn)).toFixed(3))).toBe(0.565);
  });

  it("held-out blind spot is stated, not hidden: implicit proxies are not caught", () => {
    const implicit = load(HELD_OUT).filter((i) => i.category === "implicit");
    expect(implicit).toHaveLength(14);
    expect(implicit.filter((i) => containsDemographicClaimV2(i.text))).toHaveLength(0);
  });

  it("version 1 on the held-out set, for comparison: catches none of the new attributes", () => {
    expect(confusion(load(HELD_OUT), containsDemographicClaim)).toEqual({
      tp: 0,
      fp: 1,
      tn: 49,
      fn: 46,
    });
  });
});
