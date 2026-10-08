/**
 * SIME-FULL analysis: every number in RESULTS.md is produced here, from the
 * committed run records only (runs/<id>/output, results.jsonl).
 *
 * It reuses the SIME 2026 pack's own scoring code unchanged
 * (../sime2026/label-agreement.ts: NIH-label matching, direction derivation,
 * per-model aggregation), so the numbers are computed exactly as the paper's
 * were. It adds the paired 224-px vs 1024-px comparison and the new probes.
 *
 * Usage:
 *   node_modules/.bin/tsx experiments/sime-full/analyze.ts [--csv <Data_Entry_2017.csv>]
 * Writes experiments/sime-full/ANALYSIS.md and analysis.json.
 *
 * DESCRIPTIVE ONLY. NIH labels were text-mined from reports (about 90 %
 * accurate), eight patients, no clinician review: nothing here is diagnostic
 * accuracy.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as url from "url";

import {
  aggregateByModel,
  aggregateDirectionByModel,
  loadRuns,
  parseNihCsv,
  setJaccard,
  toComparableSet,
  type DirectionRow,
  type PerImageRow,
} from "../sime2026/label-agreement.js";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, "runs");
const RES = ["224", "1024"] as const;
type Res = (typeof RES)[number];

interface ResultRow {
  id: string;
  res: number;
  provider: string;
  model: string;
  exit: number;
  wall_s: number;
  calls: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  usd: number | null;
  provider_usd: number | null;
  retries: number;
}

/**
 * "E4-00000008-r1024-openrouter-x"        → { res: "1024", paperId: "E4-00000008-openrouter-x", rep: 1 }
 * "E4L20-00003158-r224-local-m"           → { res: "224",  paperId: "E4L-00003158-local-m", rep: 1 }
 * "E2-S2x5-c5-r1024-openrouter-x"         → { res: "1024", paperId: "E2-S2x5-c5-openrouter-x", rep: 1 }
 * "E4-00000008-r1024-openrouter-x-rep2"   → { …, rep: 2 }  (a repeat of the same arm, see run.sh REP)
 */
export function splitResolution(id: string): { res: string; paperId: string; rep: number } | null {
  const r = /^(.*)-rep(\d+)$/.exec(id);
  const base = r ? r[1]! : id;
  const rep = r ? Number(r[2]) : 1;
  const m = /^(E4|E4L20)-(\d{8})-r(\d+)-(.+)$/.exec(base);
  if (m) return { res: m[3]!, paperId: `${m[1] === "E4L20" ? "E4L" : "E4"}-${m[2]}-${m[4]}`, rep };
  const e = /^E2-(S\d+x\d+)-(c\d+)-r(\d+)-(.+)$/.exec(base);
  if (e) return { res: e[3]!, paperId: `E2-${e[1]}-${e[2]}-${e[4]}`, rep };
  return null;
}

/** A directory of symlinks named the way the SIME 2026 loader expects, one per resolution. */
function buildView(res: Res, rep = 1): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sime-full-view-r${res}-`));
  for (const id of fs.readdirSync(RUNS)) {
    const s = splitResolution(id);
    if (!s || s.res !== res || s.rep !== rep) continue;
    // The SIME 2026 loader lists real directories only, then follows output/.
    fs.mkdirSync(path.join(dir, s.paperId));
    fs.symlinkSync(path.join(RUNS, id, "output"), path.join(dir, s.paperId, "output"));
  }
  return dir;
}

function readResults(): ResultRow[] {
  const p = path.join(HERE, "results.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ResultRow);
}

interface ProbeCounts {
  bias: number;
  measurement: number;
  measurementHighConfidence: number;
  contextConsistency: number;
  metadataStripped: number;
}

function probeCounts(runId: string): ProbeCounts {
  const c: ProbeCounts = {
    bias: 0,
    measurement: 0,
    measurementHighConfidence: 0,
    contextConsistency: 0,
    metadataStripped: 0,
  };
  const mp = path.join(RUNS, runId, "output", "run_manifest.json");
  if (!fs.existsSync(mp)) return c;
  const warnings =
    (JSON.parse(fs.readFileSync(mp, "utf8")) as { warnings?: string[] }).warnings ?? [];
  for (const w of warnings) {
    const b = /^bias-probe v2: (\d+) sentence/.exec(w);
    if (b) c.bias += Number(b[1]);
    const m = /^measurement-probe: (\d+) absolute size claim\(s\)(?:.*?, (\d+) at ≥90)?/.exec(w);
    if (m) {
      c.measurement += Number(m[1]);
      c.measurementHighConfidence += Number(m[2] ?? 0);
    }
    if (w.startsWith("context-consistency [")) c.contextConsistency++;
    if (w.startsWith("input-guard [image-metadata]")) c.metadataStripped++;
  }
  return c;
}

const fmt = (x: number | null | undefined, d = 3): string =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(d);

const keyOf = (x: { provider: string; model: string }): string => `${x.provider}/${x.model}`;

/** The two longitudinal cohorts: run-id prefix here, cohort name in the SIME 2026 loader. */
const COHORTS = [
  { id: "E4", loader: "E4" },
  { id: "E4L20", loader: "E4L" },
] as const;
type Cohort = (typeof COHORTS)[number];

interface View {
  images: PerImageRow[];
  dirs: DirectionRow[];
}

function loadView(
  res: Res,
  rep: number,
  csv: Map<string, string>,
  selection: Parameters<typeof loadRuns>[2]
): View {
  const view = buildView(res, rep);
  try {
    const data = loadRuns(view, csv, selection);
    return { images: data.perImageRows, dirs: data.directionRows };
  } finally {
    fs.rmSync(view, { recursive: true, force: true });
  }
}

/** Class-set and verdict agreement between two runs of the same model on the same pictures. */
function compareRuns(
  a: View,
  b: View,
  key: string
): {
  imagePairs: number;
  identicalClassSets: number;
  meanPairJaccard: number | null;
  patientPairs: number;
  sameVerdict: number;
} {
  const byImage = new Map(a.images.filter((i) => keyOf(i) === key).map((i) => [i.image, i]));
  let pairs = 0;
  let identical = 0;
  let jac = 0;
  for (const y of b.images.filter((i) => keyOf(i) === key)) {
    const x = byImage.get(y.image);
    if (!x || x.status !== "ok" || y.status !== "ok") continue;
    pairs++;
    const j = setJaccard(
      toComparableSet(new Set(x.predictedClasses)),
      toComparableSet(new Set(y.predictedClasses))
    );
    jac += j;
    if (j === 1) identical++;
  }
  const dirsA = new Map(a.dirs.filter((d) => keyOf(d) === key).map((d) => [d.patientId, d]));
  let dirPairs = 0;
  let same = 0;
  for (const y of b.dirs.filter((d) => keyOf(d) === key)) {
    const x = dirsA.get(y.patientId);
    if (!x || x.modelProgression === null || y.modelProgression === null) continue;
    dirPairs++;
    if (x.modelProgression === y.modelProgression) same++;
  }
  return {
    imagePairs: pairs,
    identicalClassSets: identical,
    meanPairJaccard: pairs ? Number((jac / pairs).toFixed(3)) : null,
    patientPairs: dirPairs,
    sameVerdict: same,
  };
}

const firstRun = (id: string): boolean => splitResolution(id)?.rep === 1;

export function main(argv: string[]): void {
  const csvArg = argv.indexOf("--csv");
  const csvPath =
    csvArg !== -1
      ? path.resolve(argv[csvArg + 1]!)
      : (process.env.NIH_CSV ?? path.resolve(HERE, "../../../nih-cxr14/Data_Entry_2017.csv"));
  const csv = parseNihCsv(fs.readFileSync(csvPath, "utf8"));
  const selection = JSON.parse(
    fs.readFileSync(path.join(HERE, "..", "sime2026", "nih-selection.json"), "utf8")
  );
  const results = readResults();

  const perRes: Record<string, View> = {};
  for (const r of RES) perRes[r] = loadView(r, 1, csv, selection);
  const only = (v: View, cohort: string): View => ({
    images: v.images.filter((i) => i.cohort === cohort),
    dirs: v.dirs.filter((d) => d.cohort === cohort),
  });
  const modelsIn = (cohort: string): string[] =>
    [
      ...new Set(
        RES.flatMap((r) => perRes[r]!.images.filter((i) => i.cohort === cohort).map(keyOf))
      ),
    ].sort();

  // ── Table 1 (per cohort): per model × resolution ─────────────────────────
  const perModelRes = (c: Cohort): Record<string, unknown>[] => {
    const rows1: Record<string, unknown>[] = [];
    for (const key of modelsIn(c.loader)) {
      for (const r of RES) {
        const v = only(perRes[r]!, c.loader);
        const imgs = v.images.filter((i) => keyOf(i) === key);
        const dirs = v.dirs.filter((d) => keyOf(d) === key);
        if (imgs.length === 0 && dirs.length === 0) continue;
        const agg = [...aggregateByModel(imgs).values()][0];
        const dagg = [...aggregateDirectionByModel(dirs).values()][0];
        const rows = results.filter(
          (x) =>
            String(x.res) === r &&
            `${x.provider}/${x.model}` === key &&
            x.id.startsWith(`${c.id}-`) &&
            firstRun(x.id)
        );
        const probes = rows.map((x) => probeCounts(x.id));
        const sum = (f: (p: ProbeCounts) => number) => probes.reduce((a, p) => a + f(p), 0);
        rows1.push({
          model: key,
          res: Number(r),
          patients: dirs.length,
          images: agg?.totalImages ?? 0,
          usableImages: agg?.usableImages ?? 0,
          schemaRejected: agg?.invalidCount ?? 0,
          callErrors: agg?.errorCount ?? 0,
          exactMatchRate: agg?.exactMatchRate ?? null,
          meanJaccard: agg?.meanJaccard ?? null,
          directionAgree: dagg?.agreeCount ?? 0,
          directionTotal: dagg?.total ?? 0,
          runsExit0: rows.filter((x) => x.exit === 0).length,
          runs: rows.length,
          calls: rows.reduce((a, x) => a + (x.calls ?? 0), 0),
          wallSeconds: Number(rows.reduce((a, x) => a + (x.wall_s ?? 0), 0).toFixed(1)),
          providerUsd: Number(rows.reduce((a, x) => a + (x.provider_usd ?? 0), 0).toFixed(4)),
          biasProbeSentences: sum((p) => p.bias),
          sizeClaims: sum((p) => p.measurement),
          sizeClaimsHighConfidence: sum((p) => p.measurementHighConfidence),
          contextContradictions: sum((p) => p.contextConsistency),
        });
      }
    }
    return rows1;
  };

  // ── Table 2 (per cohort): paired 224 px vs 1024 px, same model ───────────
  const pairedResolution = (c: Cohort): Record<string, unknown>[] => {
    const rows2: Record<string, unknown>[] = [];
    const lo = only(perRes["224"]!, c.loader);
    const hi = only(perRes["1024"]!, c.loader);
    for (const key of modelsIn(c.loader)) {
      const cmp = compareRuns(lo, hi, key);
      if (cmp.imagePairs === 0 && cmp.patientPairs === 0) continue;
      const dl = new Map(lo.dirs.filter((d) => keyOf(d) === key).map((d) => [d.patientId, d]));
      let agree224 = 0;
      let agree1024 = 0;
      for (const d of hi.dirs.filter((x) => keyOf(x) === key)) {
        const l = dl.get(d.patientId);
        if (!l || l.modelProgression === null || d.modelProgression === null) continue;
        if (l.agree) agree224++;
        if (d.agree) agree1024++;
      }
      rows2.push({ model: key, ...cmp, agree224, agree1024 });
    }
    return rows2;
  };

  // ── Table 3 (per cohort): run-to-run noise floor ──────────────────────────
  // The SIME 2026 runs used a third-party 224-px resize of the same originals;
  // this pack's r224 uses its own Lanczos resize (mean absolute pixel
  // difference ≤ 0.68 / 255 on the E4 images). Comparing the two is, in
  // effect, a repeat run of the same model on the same pictures: the change it
  // shows is the variability a resolution effect must exceed to be seen.
  const paper = loadRuns(path.join(HERE, "..", "sime2026", "runs"), csv, selection);
  const vsPaper = (c: Cohort): Record<string, unknown>[] => {
    const p = only({ images: paper.perImageRows, dirs: paper.directionRows }, c.loader);
    const ours = only(perRes["224"]!, c.loader);
    const rows3: Record<string, unknown>[] = [];
    for (const key of modelsIn(c.loader)) {
      if (!p.images.some((i) => keyOf(i) === key)) continue;
      rows3.push({ model: key, ...compareRuns(p, ours, key) });
    }
    return rows3;
  };

  const cohortTables: Record<string, { table1: unknown[]; table2: unknown[]; table3: unknown[] }> =
    {};
  for (const c of COHORTS) {
    cohortTables[c.id] = {
      table1: perModelRes(c),
      table2: pairedResolution(c),
      table3: vsPaper(c),
    };
  }

  // ── Table 4: repeat runs (E4, 1024 px) ────────────────────────────────────
  // run.sh REP=2 / REP=3 repeat an arm unchanged; run 1 is the arm in Table 1.
  const reps = [...new Set(fs.readdirSync(RUNS).map((id) => splitResolution(id)?.rep ?? 1))]
    .filter((n) => n > 1)
    .sort((a, b) => a - b);
  const repeatViews = new Map<number, View>([[1, only(perRes["1024"]!, "E4")]]);
  for (const n of reps) repeatViews.set(n, only(loadView("1024", n, csv, selection), "E4"));
  const table4: Record<string, unknown>[] = [];
  for (const key of modelsIn("E4")) {
    const runsOf = [...repeatViews.entries()].filter(([, v]) =>
      v.images.some((i) => keyOf(i) === key)
    );
    if (runsOf.length < 2) continue;
    // Every pair of runs; the mean is comparable with Table 2's resolution change.
    let imagePairs = 0;
    let identical = 0;
    let jacSum = 0;
    let patientPairs = 0;
    let sameVerdict = 0;
    for (let x = 0; x < runsOf.length; x++) {
      for (let y = x + 1; y < runsOf.length; y++) {
        const cmp = compareRuns(runsOf[x]![1], runsOf[y]![1], key);
        imagePairs += cmp.imagePairs;
        identical += cmp.identicalClassSets;
        jacSum += (cmp.meanPairJaccard ?? 0) * cmp.imagePairs;
        patientPairs += cmp.patientPairs;
        sameVerdict += cmp.sameVerdict;
      }
    }
    // Patients whose verdict is the same in every run.
    const verdicts = new Map<string, (string | null)[]>();
    for (const [, v] of runsOf) {
      for (const d of v.dirs.filter((q) => keyOf(q) === key)) {
        verdicts.set(d.patientId, [...(verdicts.get(d.patientId) ?? []), d.modelProgression]);
      }
    }
    const complete = [...verdicts.values()].filter(
      (l) => l.length === runsOf.length && l.every((q) => q !== null)
    );
    const perRun = runsOf.map(([n, v]) => {
      const agg = [...aggregateByModel(v.images.filter((i) => keyOf(i) === key)).values()][0];
      const dagg = [
        ...aggregateDirectionByModel(v.dirs.filter((d) => keyOf(d) === key)).values(),
      ][0];
      return {
        run: n,
        usableImages: agg?.usableImages ?? 0,
        images: agg?.totalImages ?? 0,
        exactMatchRate: agg?.exactMatchRate ?? null,
        directionAgree: dagg?.agreeCount ?? 0,
        directionTotal: dagg?.total ?? 0,
      };
    });
    table4.push({
      model: key,
      runs: runsOf.length,
      imagePairs,
      identicalClassSets: identical,
      meanPairJaccard: imagePairs ? Number((jacSum / imagePairs).toFixed(3)) : null,
      patientPairs,
      sameVerdict,
      patientsAllRunsSame: complete.filter((l) => l.every((q) => q === l[0])).length,
      patientsAllRuns: complete.length,
      perRun,
    });
  }

  // ── Table 5: E2 operational scaling test ──────────────────────────────────
  const e2Rows = results.filter((x) => x.id.startsWith("E2-") && firstRun(x.id));
  const e2Models = [...new Set(e2Rows.map((x) => `${x.provider}/${x.model}`))].sort();
  const table5: Record<string, unknown>[] = [];
  for (const key of e2Models) {
    for (const r of RES) {
      const rows = e2Rows.filter((x) => String(x.res) === r && `${x.provider}/${x.model}` === key);
      if (rows.length === 0) continue;
      const imgs = perRes[r]!.images.filter((i) => i.cohort === "E2" && keyOf(i) === key);
      const agg = [...aggregateByModel(imgs).values()][0];
      table5.push({
        model: key,
        res: Number(r),
        runs: rows.length,
        runsExit0: rows.filter((x) => x.exit === 0).length,
        images: agg?.totalImages ?? 0,
        usableImages: agg?.usableImages ?? 0,
        schemaRejected: agg?.invalidCount ?? 0,
        callErrors: agg?.errorCount ?? 0,
        exactMatchRate: agg?.exactMatchRate ?? null,
        meanJaccard: agg?.meanJaccard ?? null,
        calls: rows.reduce((a, x) => a + (x.calls ?? 0), 0),
        retries: rows.reduce((a, x) => a + (x.retries ?? 0), 0),
        wallSeconds: Number(rows.reduce((a, x) => a + (x.wall_s ?? 0), 0).toFixed(1)),
        providerUsd: Number(rows.reduce((a, x) => a + (x.provider_usd ?? 0), 0).toFixed(4)),
      });
    }
  }
  const table5runs = e2Rows
    .map((x) => {
      const m = /^E2-(S\d+x\d+)-c(\d+)-/.exec(x.id);
      return {
        model: `${x.provider}/${x.model}`,
        res: x.res,
        size: m?.[1] ?? "",
        concurrency: Number(m?.[2] ?? 0),
        exit: x.exit,
        calls: x.calls,
        wallSeconds: x.wall_s,
        providerUsd: x.provider_usd,
      };
    })
    .sort(
      (a, b) =>
        a.model.localeCompare(b.model) ||
        a.res - b.res ||
        a.size.localeCompare(b.size) ||
        a.concurrency - b.concurrency
    );

  // ── Table 9: E4L-20 direction agreement per NIH-label trajectory stratum ─
  // The paper's E4L-20 finding was 0/5 (person-judged) and 1/5 (mechanical) on
  // the worsening-like stratum, attributed to 224 px; this tests it at 1024 px.
  const STRATA = ["worsening", "improving", "stable-pathology", "stable-normal"] as const;
  const strataRow = (
    source: string,
    dirs: DirectionRow[],
    key: string
  ): Record<string, unknown> => {
    const row: Record<string, unknown> = { source, model: key };
    for (const st of STRATA) {
      const d = dirs.filter((x) => keyOf(x) === key && x.direction === st);
      row[st] = `${d.filter((x) => x.agree).length}/${d.length}`;
    }
    const all = dirs.filter((x) => keyOf(x) === key);
    row.total = `${all.filter((x) => x.agree).length}/${all.length}`;
    return row;
  };
  const table9: Record<string, unknown>[] = [];
  const paperL = paper.directionRows.filter((d) => d.cohort === "E4L");
  for (const key of modelsIn("E4L")) {
    if (paperL.some((d) => keyOf(d) === key))
      table9.push(strataRow("SIME 2026, 224 px", paperL, key));
    for (const r of RES) {
      const dirs = perRes[r]!.dirs.filter((d) => d.cohort === "E4L");
      if (dirs.some((d) => keyOf(d) === key))
        table9.push(strataRow(`this pack, ${r} px`, dirs, key));
    }
  }

  const out = {
    generatedFrom: "runs/ + results.jsonl + ../sime2026/runs",
    table1: cohortTables.E4!.table1,
    table2: cohortTables.E4!.table2,
    table3: cohortTables.E4!.table3,
    e4l20: cohortTables.E4L20,
    table4,
    table5,
    table5runs,
    table9,
  };
  fs.writeFileSync(path.join(HERE, "analysis.json"), JSON.stringify(out, null, 1) + "\n");

  const t1 = (rows: unknown[]) => [
    "| Model | px | Patients | Images usable / total | Schema-rejected | Empty or failed calls | Exact label match | Mean Jaccard | Direction agrees with NIH labels | Calls | Wall s | Provider USD | Bias-probe sentences | Size claims (≥90 % conf.) | Context contradictions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(rows as Record<string, unknown>[]).map(
      (t) =>
        `| ${t.model} | ${t.res} | ${t.patients} | ${t.usableImages} / ${t.images} | ${t.schemaRejected} | ${t.callErrors} | ${fmt(t.exactMatchRate as number)} | ${fmt(t.meanJaccard as number)} | ${t.directionAgree} / ${t.directionTotal} | ${t.calls} | ${t.wallSeconds} | ${t.providerUsd} | ${t.biasProbeSentences} | ${t.sizeClaims} (${t.sizeClaimsHighConfidence}) | ${t.contextContradictions} |`
    ),
  ];
  const t2 = (rows: unknown[]) => [
    "| Model | Image pairs | Identical NIH-class sets | Mean pair Jaccard | Patient pairs | Same verdict | Agrees with labels at 224 | at 1024 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(rows as Record<string, unknown>[]).map(
      (t) =>
        `| ${t.model} | ${t.imagePairs} | ${t.identicalClassSets} | ${fmt(t.meanPairJaccard as number)} | ${t.patientPairs} | ${t.sameVerdict} | ${t.agree224} | ${t.agree1024} |`
    ),
  ];
  const t3 = (rows: unknown[]) => [
    "| Model | Image pairs | Identical NIH-class sets | Mean pair Jaccard | Patient pairs | Same verdict |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(rows as Record<string, unknown>[]).map(
      (t) =>
        `| ${t.model} | ${t.imagePairs} | ${t.identicalClassSets} | ${fmt(t.meanPairJaccard as number)} | ${t.patientPairs} | ${t.sameVerdict} |`
    ),
  ];

  const md: string[] = [
    "# SIME-FULL — analysis tables (generated)",
    "",
    "Generated by `analyze.ts` from `runs/` and `results.jsonl`. Do not edit by hand.",
    "Descriptive only: NIH text-mined labels, small cohorts (8 and 20 patients), no clinician review.",
    "",
    "## Table 1 — per model and resolution (E4 cohort)",
    "",
    ...t1(cohortTables.E4!.table1),
    "",
    "## Table 2 — paired 224 px vs 1024 px, same model",
    "",
    ...t2(cohortTables.E4!.table2),
    "",
    "## Table 3 — run-to-run noise floor: SIME 2026 224-px run vs this pack's 224-px run, same model",
    "",
    "The two 224-px inputs differ only in the resize method (mean absolute pixel difference ≤ 0.68 / 255), so this is in effect a repeat run.",
    "",
    ...t3(cohortTables.E4!.table3),
    "",
  ];
  if (table4.length > 0) {
    md.push(
      "## Table 4 — repeat runs, unchanged (E4 cohort, 1024 px)",
      "",
      "The same arm run again with nothing changed (run.sh `REP`). Pairs are every pair of runs; the mean pair Jaccard is directly comparable with Table 2.",
      "",
      "| Model | Runs | Image pairs | Identical NIH-class sets | Mean pair Jaccard | Patient pairs | Same verdict | Same verdict in every run | Exact label match per run | Direction agrees per run |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...table4.map((t) => {
        const per = t.perRun as {
          exactMatchRate: number | null;
          directionAgree: number;
          directionTotal: number;
        }[];
        return `| ${t.model} | ${t.runs} | ${t.imagePairs} | ${t.identicalClassSets} | ${fmt(t.meanPairJaccard as number)} | ${t.patientPairs} | ${t.sameVerdict} | ${t.patientsAllRunsSame} / ${t.patientsAllRuns} | ${per.map((q) => fmt(q.exactMatchRate)).join(" · ")} | ${per.map((q) => `${q.directionAgree}/${q.directionTotal}`).join(" · ")} |`;
      }),
      ""
    );
  }
  if (table5.length > 0) {
    md.push(
      "## Table 5 — E2 operational scaling test (80 different patients' images, sizes S1x1 to S4x20, concurrency 1 and 5)",
      "",
      "| Model | px | Runs exit 0 | Images usable / total | Schema-rejected | Empty or failed calls | Exact label match | Mean Jaccard | Calls | Retries | Wall s | Provider USD |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...table5.map(
        (t) =>
          `| ${t.model} | ${t.res} | ${t.runsExit0} / ${t.runs} | ${t.usableImages} / ${t.images} | ${t.schemaRejected} | ${t.callErrors} | ${fmt(t.exactMatchRate as number)} | ${fmt(t.meanJaccard as number)} | ${t.calls} | ${t.retries} | ${t.wallSeconds} | ${t.providerUsd} |`
      ),
      "",
      "Per run:",
      "",
      "| Model | px | Size | Concurrency | Exit | Calls | Wall s | Provider USD |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...table5runs.map(
        (t) =>
          `| ${t.model} | ${t.res} | ${t.size} | ${t.concurrency} | ${t.exit} | ${t.calls ?? "—"} | ${t.wallSeconds} | ${t.providerUsd ?? "—"} |`
      ),
      ""
    );
  }
  const l20 = cohortTables.E4L20!;
  if (l20.table1.length > 0) {
    md.push(
      "## Table 6 — per model and resolution (E4L-20 cohort, 20 patients)",
      "",
      ...t1(l20.table1),
      "",
      "## Table 7 — paired 224 px vs 1024 px, same model (E4L-20)",
      "",
      ...t2(l20.table2),
      "",
      "## Table 8 — SIME 2026 224-px run vs this pack's 224-px run, same model (E4L-20)",
      "",
      ...t3(l20.table3),
      ""
    );
  }
  if (table9.length > 0) {
    md.push(
      "## Table 9 — E4L-20 direction agreement per NIH-label trajectory stratum (mechanical, 5 patients per stratum)",
      "",
      "| Source | Model | Worsening-like | Improving-like | Stable-pathology | Stable-normal | All |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...table9.map(
        (t) =>
          `| ${t.source} | ${t.model} | ${t.worsening} | ${t.improving} | ${t["stable-pathology"]} | ${t["stable-normal"]} | ${t.total} |`
      ),
      ""
    );
  }
  fs.writeFileSync(path.join(HERE, "ANALYSIS.md"), md.join("\n"));
  process.stdout.write(md.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
