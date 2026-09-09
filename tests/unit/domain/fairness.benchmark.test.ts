/**
 * Experiment E1 — labelled benchmark regression for the allocative-harm probe.
 *
 * Loads tests/fixtures/fairness-benchmark.json (explicit / paraphrase /
 * implicit / benign / negation / trap) and pins the probe's measured
 * behaviour so that any change to src/domain/fairness.ts that regresses
 * precision or recall is visible. The measured numbers (regenerate the full
 * report with `node_modules/.bin/tsx scripts/fairness-benchmark.ts`) are:
 *
 *   precision 0.545, recall 0.436 (24 TP, 20 FP, 35 TN, 31 FN over 110 items)
 *
 * Deterministic: pure functions over a static fixture, no network, no clock.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

import { containsDemographicClaim, findDemographicTokens } from "../../../src/domain/fairness.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../fixtures/fairness-benchmark.json");

const CATEGORIES = ["explicit", "paraphrase", "implicit", "benign", "negation", "trap"] as const;
type Category = (typeof CATEGORIES)[number];

interface BenchmarkItem {
  id: string;
  category: Category;
  text: string;
  expected: boolean;
  note: string;
}

// Pinned floors: measured values rounded DOWN to two decimals. Raise them if
// the probe improves; never lower them silently.
const PINNED_PRECISION_FLOOR = 0.54;
const PINNED_RECALL_FLOOR = 0.43;

function loadItems(): BenchmarkItem[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { items: BenchmarkItem[] };
  return raw.items;
}

interface Metrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
}

function computeMetrics(items: BenchmarkItem[]): Metrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const it of items) {
    const predicted = containsDemographicClaim(it.text);
    if (it.expected && predicted) tp++;
    else if (!it.expected && predicted) fp++;
    else if (!it.expected && !predicted) tn++;
    else fn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return { tp, fp, tn, fn, precision, recall };
}

describe("Fairness probe — labelled benchmark (E1)", () => {
  const items = loadItems();

  it("fixture is well-formed: unique ids, known categories, ~20 items per category", () => {
    expect(items.length).toBeGreaterThanOrEqual(100);
    expect(items.length).toBeLessThanOrEqual(120);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const it of items) {
      expect(CATEGORIES).toContain(it.category);
      expect(typeof it.text).toBe("string");
      expect(it.text.length).toBeGreaterThan(0);
      expect(typeof it.expected).toBe("boolean");
      expect(it.note.length).toBeGreaterThan(0);
    }
    for (const c of CATEGORIES) {
      const n = items.filter((i) => i.category === c).length;
      expect(n).toBeGreaterThanOrEqual(15);
      expect(n).toBeLessThanOrEqual(25);
    }
  });

  it("ground-truth labels follow the category definitions", () => {
    for (const it of items) {
      const positive =
        it.category === "explicit" || it.category === "paraphrase" || it.category === "implicit";
      expect(it.expected).toBe(positive);
    }
    // Implicit items must not contain any listed token by construction.
    for (const it of items.filter((i) => i.category === "implicit")) {
      expect(findDemographicTokens(it.text)).toEqual([]);
    }
  });

  it("(a) detects every explicit item — recall on explicit == 1.0", () => {
    const explicit = items.filter((i) => i.category === "explicit");
    const missed = explicit.filter((i) => !containsDemographicClaim(i.text)).map((i) => i.id);
    expect(missed).toEqual([]);
    // Every explicit item carries at least one listed demographic token.
    for (const it of explicit) {
      expect(findDemographicTokens(it.text).length).toBeGreaterThan(0);
    }
  });

  it("(c) accepts every benign item — zero false positives on benign", () => {
    const benign = items.filter((i) => i.category === "benign");
    const flagged = benign.filter((i) => containsDemographicClaim(i.text)).map((i) => i.id);
    expect(flagged).toEqual([]);
  });

  it("(b) overall precision and recall do not regress below the pinned floors", () => {
    const m = computeMetrics(items);
    expect(m.tp + m.fp + m.tn + m.fn).toBe(items.length);
    expect(m.precision).toBeGreaterThanOrEqual(PINNED_PRECISION_FLOOR);
    expect(m.recall).toBeGreaterThanOrEqual(PINNED_RECALL_FLOOR);
  });

  it("pins the exact confusion matrix so any behavioural change is visible", () => {
    // Update these numbers deliberately (and the results markdown) when the
    // probe or the fixture changes; they document the measured state.
    const m = computeMetrics(items);
    expect({ tp: m.tp, fp: m.fp, tn: m.tn, fn: m.fn }).toEqual({
      tp: 24,
      fp: 20,
      tn: 35,
      fn: 31,
    });
  });

  it("documents the known blind spots: implicit recall is 0 and paraphrase recall is partial", () => {
    const implicit = computeMetrics(items.filter((i) => i.category === "implicit"));
    const paraphrase = computeMetrics(items.filter((i) => i.category === "paraphrase"));
    expect(implicit.recall).toBe(0);
    expect(paraphrase.recall).toBeGreaterThan(0);
    expect(paraphrase.recall).toBeLessThan(1);
  });
});
