/**
 * Determinism and purity tests for the "Deterministic Fairness Probing"
 * claim in the paper title.
 *
 * `docs/PAPER-COVERAGE.md` §0.3 flags that "deterministic" was, until now,
 * established only by inspection (pure string/regex functions, no RNG, no
 * clock, no network, no model) and by the *pinned confusion matrix* in
 * `fairness.benchmark.test.ts` — which pins one run's output, not that
 * repeated runs agree. This file closes that gap for the two exported
 * fairness-probe functions (`findDemographicTokens`, `containsDemographicClaim`
 * in `src/domain/fairness.ts`) and for the context-consistency probe's
 * exported checkers (`parsePatientContext`, `findContextContradictions` in
 * `src/domain/context-consistency.ts`), by actually exercising:
 *
 *   - repetition (same input, many calls, byte-identical output);
 *   - order independence (a fixed-seed shuffle of the corpus changes no
 *     per-item verdict);
 *   - absence of hidden state (interleaved calls match isolated calls);
 *   - environment independence (timezone and locale);
 *   - absence of `Date`/`Math.random` reads;
 *   - absence of input mutation (frozen inputs, run under the same probes);
 *   - explainability (every positive verdict names a real published token).
 *
 * No network. No filesystem access beyond reading the existing fixture and
 * this module's own source (to recover the published token list without
 * requiring a new export). No `Math.random` — shuffling uses a fixed-seed
 * LCG defined below.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

import { containsDemographicClaim, findDemographicTokens } from "../../../src/domain/fairness.js";
import {
  findContextContradictions,
  parsePatientContext,
} from "../../../src/domain/context-consistency.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../fixtures/fairness-benchmark.json");
const FAIRNESS_SOURCE = path.resolve(__dirname, "../../../src/domain/fairness.ts");

interface BenchmarkItem {
  id: string;
  category: string;
  text: string;
  expected: boolean;
  note: string;
}

function loadItems(): BenchmarkItem[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { items: BenchmarkItem[] };
  return raw.items;
}

/**
 * The published token list, recovered from the module's own source text
 * rather than a new export, so the "explainability" test below can assert
 * that every matched token really is one of the documented tokens — not
 * merely a token the test file made up independently.
 */
function loadPublishedTokenList(): string[] {
  const src = fs.readFileSync(FAIRNESS_SOURCE, "utf-8");
  const block = /const DEMOGRAPHIC_TOKENS = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error("could not locate DEMOGRAPHIC_TOKENS in fairness.ts source");
  const tokens = [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  expect(tokens.length).toBeGreaterThan(0);
  return tokens;
}

/**
 * Cheap value-equality helpers for the two "many repetitions" tests below.
 * Those tests call the probes tens or hundreds of thousands of times, so
 * wrapping every single call in `expect(...).toEqual(...)` would dominate the
 * runtime with Jest's matcher machinery rather than the probe itself; instead
 * we compare with plain JS in the hot loop and call `expect` once, on the
 * (expected-empty) list of mismatches.
 */
function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Deep-freezes an object graph so any attempted mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Small deterministic linear-congruential generator (Numerical Recipes
 * constants). Given a fixed seed it produces the exact same sequence on
 * every run, on every machine — unlike `Math.random`, which this file must
 * not use per the "no RNG" requirement it is itself verifying.
 */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Fisher-Yates shuffle driven by the fixed-seed LCG above. Does not mutate `arr`. */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  const rand = makeLcg(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// A small, representative set of context strings for the context-consistency
// probe: has both age and sex, has one, has neither, and an unusual format.
// (Mirrors the corpus used in context-consistency.test.ts.)
const CONTEXTS: readonly string[] = [
  "Patient age at first study: 69 years; sex: female. Research use only.",
  "Sex: M. Age at first study: 76 years.",
  "Patient age at first study: 42 years; sex: female.",
  "Frontal chest radiographs, research use only.",
  "A 62-year-old female, PA chest.",
];

const items = deepFreeze(loadItems());
const contexts = deepFreeze([...CONTEXTS]);
const publishedTokens = new Set(loadPublishedTokenList());

// ─── Environment isolation ───────────────────────────────────────────────────
// Several tests below mutate process.env.TZ / LANG / LC_ALL to prove the
// probes don't depend on them. Always restore, even on failure, so this file
// cannot leak environment changes into other test files running in the same
// worker.
const ORIGINAL_ENV = { TZ: process.env.TZ, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
afterEach(() => {
  for (const key of ["TZ", "LANG", "LC_ALL"] as const) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe("fairness probe — determinism and purity", () => {
  it("repeats byte-identically: 1000 passes over the whole fixture, both functions", () => {
    const baselineTokens = items.map((it) => findDemographicTokens(it.text));
    const baselineClaims = items.map((it) => containsDemographicClaim(it.text));

    const mismatches: string[] = [];
    for (let rep = 0; rep < 1000; rep++) {
      for (let i = 0; i < items.length; i++) {
        const text = items[i]!.text;
        if (!stringArraysEqual(findDemographicTokens(text), baselineTokens[i]!)) {
          mismatches.push(`${items[i]!.id}@rep${rep}: findDemographicTokens diverged`);
        }
        if (containsDemographicClaim(text) !== baselineClaims[i]) {
          mismatches.push(`${items[i]!.id}@rep${rep}: containsDemographicClaim diverged`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("is order-independent: a fixed-seed shuffle of the corpus changes no per-item verdict", () => {
    const baseline = new Map(
      items.map((it) => [
        it.id,
        { tokens: findDemographicTokens(it.text), claim: containsDemographicClaim(it.text) },
      ])
    );

    for (const seed of [1, 42, 1337]) {
      for (const it of shuffled(items, seed)) {
        const expected = baseline.get(it.id)!;
        expect(findDemographicTokens(it.text)).toEqual(expected.tokens);
        expect(containsDemographicClaim(it.text)).toBe(expected.claim);
      }
    }
  });

  it("has no hidden state between calls: interleaved calls match isolated calls", () => {
    const isolatedA = items.map((it) => findDemographicTokens(it.text));
    const isolatedB = items.map((it) => containsDemographicClaim(it.text));

    const interleavedTokens: string[][] = new Array(items.length);
    const interleavedClaims: boolean[] = new Array(items.length);
    // Walk the corpus back-and-forth (A, last, B, second-to-last, ...),
    // alternating which function runs first, so any cross-call state would
    // have to survive an adversarial call order to go undetected.
    let lo = 0;
    let hi = items.length - 1;
    while (lo <= hi) {
      interleavedClaims[hi] = containsDemographicClaim(items[hi]!.text);
      interleavedTokens[lo] = findDemographicTokens(items[lo]!.text);
      if (lo !== hi) {
        interleavedTokens[hi] = findDemographicTokens(items[hi]!.text);
        interleavedClaims[lo] = containsDemographicClaim(items[lo]!.text);
      }
      lo++;
      hi--;
    }

    expect(interleavedTokens).toEqual(isolatedA);
    expect(interleavedClaims).toEqual(isolatedB);
  });

  it("does not depend on timezone or locale", () => {
    const subset = items.slice(0, 30);
    const baseline = subset.map((it) => ({
      tokens: findDemographicTokens(it.text),
      claim: containsDemographicClaim(it.text),
    }));

    const environments: Array<Record<string, string>> = [
      { TZ: "Pacific/Kiritimati" },
      { TZ: "Etc/GMT+12" },
      { TZ: "America/New_York", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      { TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8" },
    ];

    for (const env of environments) {
      process.env.TZ = env.TZ;
      if (env.LANG) process.env.LANG = env.LANG;
      else delete process.env.LANG;
      if (env.LC_ALL) process.env.LC_ALL = env.LC_ALL;
      else delete process.env.LC_ALL;

      subset.forEach((it, i) => {
        expect(findDemographicTokens(it.text)).toEqual(baseline[i]!.tokens);
        expect(containsDemographicClaim(it.text)).toBe(baseline[i]!.claim);
      });
    }
  });

  it("never reads Date.now or Math.random", () => {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => {
      throw new Error("findDemographicTokens/containsDemographicClaim must not read Date.now");
    };
    Math.random = () => {
      throw new Error("findDemographicTokens/containsDemographicClaim must not read Math.random");
    };
    try {
      for (const it of items) {
        expect(() => findDemographicTokens(it.text)).not.toThrow();
        expect(() => containsDemographicClaim(it.text)).not.toThrow();
      }
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });

  it("does not mutate its input (the fixture is frozen and stays valid JSON)", () => {
    const before = JSON.stringify(items);
    for (const it of items) {
      findDemographicTokens(it.text);
      containsDemographicClaim(it.text);
    }
    // Frozen objects throw synchronously on any attempted write, so reaching
    // here without a thrown TypeError already proves no mutation was
    // attempted; this is the belt-and-braces value check.
    expect(JSON.stringify(items)).toBe(before);
  });

  it("explainability: every positive verdict names real published token(s)", () => {
    let positiveCount = 0;
    for (const it of items) {
      if (!containsDemographicClaim(it.text)) continue;
      positiveCount++;
      const tokens = findDemographicTokens(it.text);
      expect(tokens.length).toBeGreaterThan(0);
      const lowerText = it.text.toLowerCase();
      for (const tok of tokens) {
        expect(publishedTokens.has(tok)).toBe(true);
        expect(lowerText.includes(tok)).toBe(true);
      }
    }
    // Sanity: the fixture actually exercises the positive path.
    expect(positiveCount).toBeGreaterThan(0);
  });
});

describe("context-consistency probe — determinism and purity", () => {
  // Pair every fairness-benchmark text (as "generated text") with every
  // representative context string, giving a corpus that is both large and
  // reuses an already-audited fixture rather than inventing a new one.
  const pairs = items.flatMap((it) => contexts.map((ctx) => ({ id: it.id, ctx, text: it.text })));

  // 300 rather than 1000 repetitions: findContextContradictions does
  // meaningfully more work per call than the fairness probe (14 sex terms +
  // 8 age bands, each a fresh compiled regex scan), so 300 * 110 = 33,000
  // calls already gives ample repetition evidence while keeping this file
  // fast.
  const CONTEXT_REPS = 300;

  it("repeats byte-identically: 300 passes over the fixture against one context", () => {
    const ctx = contexts[0]!;
    const baseline = items.map((it) => JSON.stringify(findContextContradictions(ctx, it.text)));

    const mismatches: string[] = [];
    for (let rep = 0; rep < CONTEXT_REPS; rep++) {
      for (let i = 0; i < items.length; i++) {
        const result = JSON.stringify(findContextContradictions(ctx, items[i]!.text));
        if (result !== baseline[i]) {
          mismatches.push(`${items[i]!.id}@rep${rep}: findContextContradictions diverged`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("parsePatientContext repeats byte-identically over 1000 passes", () => {
    const baseline = contexts.map((ctx) => JSON.stringify(parsePatientContext(ctx)));

    const mismatches: string[] = [];
    for (let rep = 0; rep < 1000; rep++) {
      contexts.forEach((ctx, i) => {
        if (JSON.stringify(parsePatientContext(ctx)) !== baseline[i]) {
          mismatches.push(`context[${i}]@rep${rep}: parsePatientContext diverged`);
        }
      });
    }
    expect(mismatches).toEqual([]);
  });

  it("is order-independent: a fixed-seed shuffle of the (text, context) pairs changes no verdict", () => {
    const baseline = new Map(
      pairs.map((p) => [`${p.id}::${p.ctx}`, findContextContradictions(p.ctx, p.text)])
    );

    for (const seed of [7, 99]) {
      for (const p of shuffled(pairs, seed)) {
        expect(findContextContradictions(p.ctx, p.text)).toEqual(baseline.get(`${p.id}::${p.ctx}`));
      }
    }
  });

  it("has no hidden state between calls: interleaving different contexts matches isolation", () => {
    const isolated = pairs.map((p) => findContextContradictions(p.ctx, p.text));

    const interleaved: unknown[] = new Array(pairs.length);
    let lo = 0;
    let hi = pairs.length - 1;
    while (lo <= hi) {
      interleaved[hi] = findContextContradictions(pairs[hi]!.ctx, pairs[hi]!.text);
      interleaved[lo] = findContextContradictions(pairs[lo]!.ctx, pairs[lo]!.text);
      lo++;
      hi--;
    }

    expect(interleaved).toEqual(isolated);
  });

  it("does not depend on timezone or locale", () => {
    const subset = pairs.slice(0, 40);
    const baseline = subset.map((p) => findContextContradictions(p.ctx, p.text));

    const environments: Array<Record<string, string>> = [
      { TZ: "Pacific/Kiritimati" },
      { TZ: "America/New_York", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      { TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8" },
    ];

    for (const env of environments) {
      process.env.TZ = env.TZ;
      if (env.LANG) process.env.LANG = env.LANG;
      else delete process.env.LANG;
      if (env.LC_ALL) process.env.LC_ALL = env.LC_ALL;
      else delete process.env.LC_ALL;

      subset.forEach((p, i) => {
        expect(findContextContradictions(p.ctx, p.text)).toEqual(baseline[i]);
      });
    }
  });

  it("never reads Date.now or Math.random", () => {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => {
      throw new Error("findContextContradictions/parsePatientContext must not read Date.now");
    };
    Math.random = () => {
      throw new Error("findContextContradictions/parsePatientContext must not read Math.random");
    };
    try {
      for (const ctx of contexts) {
        expect(() => parsePatientContext(ctx)).not.toThrow();
      }
      for (const p of pairs.slice(0, 50)) {
        expect(() => findContextContradictions(p.ctx, p.text)).not.toThrow();
      }
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });

  it("does not mutate its input (the fixture and context corpus stay frozen and valid)", () => {
    const beforeItems = JSON.stringify(items);
    const beforeContexts = JSON.stringify(contexts);
    for (const p of pairs) {
      findContextContradictions(p.ctx, p.text);
    }
    for (const ctx of contexts) {
      parsePatientContext(ctx);
    }
    expect(JSON.stringify(items)).toBe(beforeItems);
    expect(JSON.stringify(contexts)).toBe(beforeContexts);
  });
});
