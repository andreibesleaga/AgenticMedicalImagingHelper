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

/** "E4-00000008-r1024-openrouter-x" → { res: "1024", paperId: "E4-00000008-openrouter-x" } */
export function splitResolution(id: string): { res: string; paperId: string } | null {
  const m = /^(E4|E4L20)-(\d{8})-r(\d+)-(.+)$/.exec(id);
  if (!m) return null;
  return { res: m[3]!, paperId: `${m[1] === "E4L20" ? "E4L" : "E4"}-${m[2]}-${m[4]}` };
}

/** A directory of symlinks named the way the SIME 2026 loader expects, one per resolution. */
function buildView(res: Res): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sime-full-view-r${res}-`));
  for (const id of fs.readdirSync(RUNS)) {
    const s = splitResolution(id);
    if (!s || s.res !== res) continue;
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
  const warnings = (JSON.parse(fs.readFileSync(mp, "utf8")) as { warnings?: string[] }).warnings ?? [];
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

  const perRes: Record<string, { images: PerImageRow[]; dirs: DirectionRow[] }> = {};
  for (const r of RES) {
    const view = buildView(r);
    try {
      const data = loadRuns(view, csv, selection);
      perRes[r] = { images: data.perImageRows, dirs: data.directionRows };
    } finally {
      fs.rmSync(view, { recursive: true, force: true });
    }
  }

  const models = [
    ...new Set(
      RES.flatMap((r) => perRes[r]!.images.map((i) => `${i.provider}/${i.model}`))
    ),
  ].sort();

  // ── Table 1: per model × resolution ──────────────────────────────────────
  const table1: Record<string, unknown>[] = [];
  for (const key of models) {
    for (const r of RES) {
      const imgs = perRes[r]!.images.filter((i) => `${i.provider}/${i.model}` === key);
      const dirs = perRes[r]!.dirs.filter((d) => `${d.provider}/${d.model}` === key);
      if (imgs.length === 0 && dirs.length === 0) continue;
      const agg = [...aggregateByModel(imgs).values()][0];
      const dagg = [...aggregateDirectionByModel(dirs).values()][0];
      const rows = results.filter(
        (x) => String(x.res) === r && `${x.provider}/${x.model}` === key && x.id.startsWith("E4-")
      );
      const probes = rows.map((x) => probeCounts(x.id));
      const sum = (f: (p: ProbeCounts) => number) => probes.reduce((a, p) => a + f(p), 0);
      table1.push({
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

  // ── Table 2: paired resolution comparison (same model, same image/patient) ─
  const table2: Record<string, unknown>[] = [];
  for (const key of models) {
    const a = perRes["224"]!.images.filter((i) => `${i.provider}/${i.model}` === key);
    const b = perRes["1024"]!.images.filter((i) => `${i.provider}/${i.model}` === key);
    const byImage = new Map(a.map((i) => [i.image, i]));
    let pairs = 0;
    let identical = 0;
    let jac = 0;
    for (const hi of b) {
      const lo = byImage.get(hi.image);
      if (!lo || lo.status !== "ok" || hi.status !== "ok") continue;
      pairs++;
      const sa = toComparableSet(new Set(lo.predictedClasses));
      const sb = toComparableSet(new Set(hi.predictedClasses));
      const j = setJaccard(sa, sb);
      jac += j;
      if (j === 1) identical++;
    }
    const da = new Map(
      perRes["224"]!.dirs.filter((d) => `${d.provider}/${d.model}` === key).map((d) => [d.patientId, d])
    );
    let dirPairs = 0;
    let sameVerdict = 0;
    let agree224 = 0;
    let agree1024 = 0;
    for (const d of perRes["1024"]!.dirs.filter((x) => `${x.provider}/${x.model}` === key)) {
      const lo = da.get(d.patientId);
      if (!lo || lo.modelProgression === null || d.modelProgression === null) continue;
      dirPairs++;
      if (lo.modelProgression === d.modelProgression) sameVerdict++;
      if (lo.agree) agree224++;
      if (d.agree) agree1024++;
    }
    if (pairs === 0 && dirPairs === 0) continue;
    table2.push({
      model: key,
      imagePairs: pairs,
      identicalClassSets: identical,
      meanPairJaccard: pairs ? Number((jac / pairs).toFixed(3)) : null,
      patientPairs: dirPairs,
      sameVerdict,
      agree224,
      agree1024,
    });
  }

  // ── Table 3: run-to-run noise floor ───────────────────────────────────────
  // The SIME 2026 runs used a third-party 224-px resize of the same originals;
  // this pack's r224 uses its own Lanczos resize (mean absolute pixel
  // difference ≤ 0.68 / 255 on these 31 images). Comparing the two is, in
  // effect, a repeat run of the same model on the same pictures: the change it
  // shows is the variability a resolution effect must exceed to be seen.
  const paper = loadRuns(path.join(HERE, "..", "sime2026", "runs"), csv, selection);
  const paperImgs = paper.perImageRows.filter((i) => i.cohort === "E4");
  const paperDirs = paper.directionRows.filter((d) => d.cohort === "E4");
  const table3: Record<string, unknown>[] = [];
  for (const key of models) {
    const p = paperImgs.filter((i) => `${i.provider}/${i.model}` === key);
    if (p.length === 0) continue;
    const ours = new Map(
      perRes["224"]!.images.filter((i) => `${i.provider}/${i.model}` === key).map((i) => [i.image, i])
    );
    let pairs = 0;
    let identical = 0;
    let jac = 0;
    for (const a of p) {
      const b = ours.get(a.image);
      if (!b || a.status !== "ok" || b.status !== "ok") continue;
      pairs++;
      const j = setJaccard(
        toComparableSet(new Set(a.predictedClasses)),
        toComparableSet(new Set(b.predictedClasses))
      );
      jac += j;
      if (j === 1) identical++;
    }
    const od = new Map(
      perRes["224"]!.dirs.filter((d) => `${d.provider}/${d.model}` === key).map((d) => [d.patientId, d])
    );
    let dirPairs = 0;
    let same = 0;
    for (const a of paperDirs.filter((d) => `${d.provider}/${d.model}` === key)) {
      const b = od.get(a.patientId);
      if (!b || a.modelProgression === null || b.modelProgression === null) continue;
      dirPairs++;
      if (a.modelProgression === b.modelProgression) same++;
    }
    table3.push({
      model: key,
      imagePairs: pairs,
      identicalClassSets: identical,
      meanPairJaccard: pairs ? Number((jac / pairs).toFixed(3)) : null,
      patientPairs: dirPairs,
      sameVerdict: same,
    });
  }

  const out = { generatedFrom: "runs/ + results.jsonl + ../sime2026/runs", table1, table2, table3 };
  fs.writeFileSync(path.join(HERE, "analysis.json"), JSON.stringify(out, null, 1) + "\n");

  const md: string[] = [
    "# SIME-FULL — analysis tables (generated)",
    "",
    "Generated by `analyze.ts` from `runs/` and `results.jsonl`. Do not edit by hand.",
    "Descriptive only: NIH text-mined labels, 8 patients, no clinician review.",
    "",
    "## Table 1 — per model and resolution (E4 cohort)",
    "",
    "| Model | px | Patients | Images usable / total | Schema-rejected | Empty or failed calls | Exact label match | Mean Jaccard | Direction agrees with NIH labels | Calls | Wall s | Provider USD | Bias-probe sentences | Size claims (≥90 % conf.) | Context contradictions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table1.map(
      (t) =>
        `| ${t.model} | ${t.res} | ${t.patients} | ${t.usableImages} / ${t.images} | ${t.schemaRejected} | ${t.callErrors} | ${fmt(t.exactMatchRate as number)} | ${fmt(t.meanJaccard as number)} | ${t.directionAgree} / ${t.directionTotal} | ${t.calls} | ${t.wallSeconds} | ${t.providerUsd} | ${t.biasProbeSentences} | ${t.sizeClaims} (${t.sizeClaimsHighConfidence}) | ${t.contextContradictions} |`
    ),
    "",
    "## Table 2 — paired 224 px vs 1024 px, same model",
    "",
    "| Model | Image pairs | Identical NIH-class sets | Mean pair Jaccard | Patient pairs | Same verdict | Agrees with labels at 224 | at 1024 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table2.map(
      (t) =>
        `| ${t.model} | ${t.imagePairs} | ${t.identicalClassSets} | ${fmt(t.meanPairJaccard as number)} | ${t.patientPairs} | ${t.sameVerdict} | ${t.agree224} | ${t.agree1024} |`
    ),
    "",
    "## Table 3 — run-to-run noise floor: SIME 2026 224-px run vs this pack's 224-px run, same model",
    "",
    "The two 224-px inputs differ only in the resize method (mean absolute pixel difference ≤ 0.68 / 255), so this is in effect a repeat run.",
    "",
    "| Model | Image pairs | Identical NIH-class sets | Mean pair Jaccard | Patient pairs | Same verdict |",
    "| --- | --- | --- | --- | --- | --- |",
    ...table3.map(
      (t) =>
        `| ${t.model} | ${t.imagePairs} | ${t.identicalClassSets} | ${fmt(t.meanPairJaccard as number)} | ${t.patientPairs} | ${t.sameVerdict} |`
    ),
    "",
  ];
  fs.writeFileSync(path.join(HERE, "ANALYSIS.md"), md.join("\n"));
  process.stdout.write(md.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
