# AGENTS.md

Instructions for coding agents working in this repository. The README is the
reference for users; this file is the short version for changing the code.

## What this is

A TypeScript CLI (`medical-imaging`, Node.js, ESM) that runs a LangGraph.js
fan-out / fan-in graph over series of medical images and writes per-image JSON,
per-series Markdown, a combined evolution report and a hash-sealed
`run_manifest.json`. It is research and educational software, **not a medical
device**. Keep every disclaimer, the clinician-review block and the "not for
clinical use" framing; never add wording that makes an output sound like a
diagnosis or a recommendation ([DISCLAIMER.md](DISCLAIMER.md),
[docs/COMPLIANCE.md](docs/COMPLIANCE.md) §0).

## Layout

| Path                     | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `src/domain/`            | types, errors, Zod schemas, probes, PHI scan, input guard (no I/O)                |
| `src/application/`       | the three use-cases (per image, per series, evolution)                            |
| `src/infrastructure/`    | provider clients, image policy, file scanner, report writer, cost meter, manifest |
| `src/adapters/`          | the LangGraph graph (`langgraph-agent.ts`); LangGraph stays in this folder        |
| `src/main/`              | CLI (`index.ts`) and the command handlers (`run-analyze.ts`)                      |
| `tests/`                 | `unit/`, `e2e/` (mocked), `live/` (real API, opt-in), `fixtures/`                 |
| `experiments/sime2026/`  | the SIME 2026 paper's pack — frozen (ROADMAP §10.1); do not edit or reformat it   |
| `experiments/sime-full/` | the post-paper follow-up at full resolution                                       |
| `docs/`                  | architecture, compliance, roadmap, ADRs, threat model                             |
| `site/`                  | the GitHub Pages site (published by `pages.yml`)                                  |

## Commands

```bash
npm ci                 # install from the lockfile
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src tests
npm run build          # tsc -> dist/
npm test               # mocked suite, no network (excludes tests/live)
npm run test:coverage  # what CI runs; floors in jest.config.js
node dist/main/index.js --help
```

`npm run test:live` calls a real provider and costs money; run it only when
asked. CI (`.github/workflows/ci.yml`) runs `npm ci`, `typecheck`, `lint`,
`build` and `test:coverage` on Node 22 and 24.

## Rules

- CLI flags, exit codes (README "Exit Codes") and output fields are a contract:
  additions are fine; a rename or removal needs a major-version bump
  (CONTRIBUTING.md).
- Every output type carries the `disclaimer` field (`src/domain/types.ts`);
  Scenario 8 in `tests/e2e/full-analysis.test.ts` checks the written files.
- A new provider key variable must be added to `secretValues()` in
  `src/infrastructure/logger.ts` in the same change (SECURITY.md).
- The run outputs under `experiments/sime2026/runs/` are sealed by their run
  manifests' hashes (61 of the 62 runs have one); a byte change to a sealed file
  makes `verify-manifest` fail.
- Never commit `.env` or a real key; tests use fake keys only.
- Add a line under `[Unreleased]` in `CHANGELOG.md` for every change.
