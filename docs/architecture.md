# Architecture

`AgenticMedicalImagingHelper` is a local CLI that orchestrates Google Gemini
through a LangGraph.js `StateGraph` using a **fan-out / fan-in** topology.

## System context

Who and what the CLI talks to. Exactly one model provider is used per run,
chosen by `AI_PROVIDER`.

```mermaid
C4Context
    title System context — AgenticMedicalImagingHelper
    Person(operator, "Operator", "Runs the CLI on a workstation; de-identifies every input first")
    Person(reviewer, "Qualified clinician", "Must review every report before any use")
    System(cli, "AgenticMedicalImagingHelper CLI", "medical-imaging analyze / verify-manifest; Node.js, TypeScript")
    System_Ext(files, "Local file system", "input series folders and context .txt files; output reports, run_manifest.json, optional ledger")
    System_Ext(gemini, "Google Gemini API", "AI_PROVIDER=google (default)")
    System_Ext(openrouter, "OpenRouter", "AI_PROVIDER=openrouter; routes to the upstream model vendor")
    System_Ext(local, "Local model server", "AI_PROVIDER=local; Ollama, vLLM or llama.cpp at LOCAL_LLM_BASE_URL")
    Rel(operator, cli, "Runs", "terminal")
    Rel(cli, files, "Reads images and context; writes reports and manifest", "fs")
    Rel(cli, gemini, "Image + prompt per call", "HTTPS, @google/generative-ai")
    Rel(cli, openrouter, "Image + prompt per call", "HTTPS, chat/completions")
    Rel(cli, local, "Image + prompt per call", "HTTP, chat/completions")
    Rel(reviewer, files, "Reads the reports")
```

## Components

The modules one `analyze` run passes through, in `src/`. `run-analyze.ts` runs
the pre-flight checks, builds one provider adapter, runs the graph, writes the
reports, runs the probes and seals the manifest.

```mermaid
flowchart LR
    IDX["main/index.ts<br/>(commander CLI)"] --> RUN["main/run-analyze.ts"]
    RUN --> SCAN["infrastructure/file-scanner.ts"]
    RUN --> PHI["domain/phi-scan.ts"]
    RUN --> GUARD["domain/input-guard.ts"]
    RUN --> MET["infrastructure/cost-meter.ts"]
    RUN --> PROV{"provider adapter<br/>(GeminiClient port)"}
    PROV --> GEM["infrastructure/gemini-client.ts"]
    PROV --> OR["infrastructure/openrouter-client.ts"]
    PROV --> LOC["infrastructure/local-client.ts"]
    OR --> GEM
    LOC --> OR
    GEM --> POL["infrastructure/image-policy.ts"]
    GEM --> SO["domain/structured-output.ts"]
    GEM --> RET["infrastructure/retry.ts"]
    RUN --> AGENT["adapters/langgraph-agent.ts"]
    AGENT --> UC["application/*.use-case.ts"]
    UC --> PROV
    RUN --> REP["infrastructure/report-writer.ts"]
    RUN --> PROBES["domain/context-consistency.ts<br/>domain/fairness-v2.ts<br/>domain/measurement-probe.ts"]
    RUN --> MAN["infrastructure/run-manifest.ts"]
```

`openrouter-client.ts` and `local-client.ts` supply the transport and reuse
`createGeminiClient` from `gemini-client.ts`, so prompts, parsing, validation
and retries are the same on every provider.

## StateGraph topology

```mermaid
graph TD
    START((START)) --> A["analyzeImages<br/>(fan-out)"]
    A -->|"p-limit(concurrency)"| A1["analyzeImage · img 1"]
    A --> A2["analyzeImage · img 2"]
    A --> An["analyzeImage · img N"]
    A1 --> B
    A2 --> B
    An --> B["aggregateSeries<br/>(fan-in, per series)"]
    B --> C["analyzeEvolution<br/>(temporal comparison)"]
    C --> END((END))
    C -.->|"GraphState"| W["writeReports<br/>(JSON + Markdown + disclaimer)"]

    classDef node fill:#eef,stroke:#557;
    class A,B,C node;
```

## Nodes

| Node               | Responsibility                                                                                                                                                 | Source                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `analyzeImages`    | Fans out every `(imagePath, seriesId)` pair and analyses each image concurrently, bounded by `p-limit(concurrency)`. Results accumulate via an append reducer. | `src/adapters/langgraph-agent.ts`                                                  |
| `aggregateSeries`  | Fans in per series: synthesises consistent findings, discrepancies, primary/differential diagnoses.                                                            | `src/adapters/langgraph-agent.ts` → `src/application/aggregate-series.use-case.ts` |
| `analyzeEvolution` | Compares series across time and classifies progression (`Improving` / `Stable` / `Worsening` / `Inconclusive` / `SingleSeries`).                               | `src/application/analyze-evolution.use-case.ts`                                    |
| `writeReports`     | Writes per-image JSON, per-series Markdown, and the combined evolution report — each carrying the mandatory disclaimer.                                        | `src/infrastructure/report-writer.ts`                                              |

## Layering (ports & adapters)

- `domain/` — pure types, errors, fairness probe (no I/O).
- `application/` — use-cases (orchestration only).
- `infrastructure/` — Gemini client, OpenRouter client, local client, file scanner, report writer, cost meter (outside-world adapters).
- `adapters/` — LangGraph wiring (`langgraph-agent.ts`).
- `main/` — CLI composition root (`index.ts`) + handler (`run-analyze.ts`).

The framework (LangGraph) is quarantined to `adapters/`; swapping orchestration
would not touch the domain or application layers.

## Model providers

The graph talks to the model only through the `GeminiClient` port
(`analyzeImage` / `synthesizeSeries` / `analyzeEvolution`). Three adapters
implement it: Google Gemini via the official SDK (default, `AI_PROVIDER=google`),
a **local** OpenAI-compatible server (`AI_PROVIDER=local`,
`infrastructure/local-client.ts`, which reuses the OpenRouter transport; see
[LOCAL-INFERENCE.md](architecture/LOCAL-INFERENCE.md)), and
**OpenRouter** (`AI_PROVIDER=openrouter`, `infrastructure/openrouter-client.ts`),
an OpenAI-compatible `chat/completions` shim that satisfies the same
`generateContent` surface, so prompts, parsers, error handling and the LangGraph
wiring are shared verbatim and any OpenRouter vision model can be run from the
unchanged CLI. Differences are deliberate and documented in
[ADR-006](architecture/decisions/ADR-006-openrouter-second-provider.md): the
OpenRouter path has **no Google Search grounding** (ADR-002 is Gemini-only; the
"Research Context" section is answered from model knowledge alone), it maps the
shared client's JSON-mode request to `response_format: { type: "json_object" }`,
and it forwards the
provider's own `usage.cost` (USD) to the cost meter as `providerReportedUsd`
next to the token-based estimate. Gemini remains the default; OpenRouter exists
to test the single-model monoculture risk tracked in ADR-004.

## Cross-cutting

- **Cost guard** — `infrastructure/cost-meter.ts` records real token usage from
  the provider response and optionally aborts on `--max-cost-usd`; when the
  provider reports an authoritative per-call charge (OpenRouter) it is summed
  as `providerReportedUsd` alongside the estimate.
- **Disclaimer** — a required field on every output type, enforced at the type
  level (`domain/types.ts`) and asserted in `tests/e2e/full-analysis.test.ts`.
- **Retry / backoff** — `infrastructure/retry.ts:withRetry` wraps both provider
  adapters with bounded exponential backoff and full jitter. Only HTTP 429/5xx
  and transport-level failures are retried (never other 4xx, never a parse or
  Zod-validation failure); `Retry-After` / provider `RetryInfo` is honoured
  when present; attempt count is configurable via `AI_MAX_RETRIES` (`0`
  disables retries). The cost meter records a failed attempt's usage once, not
  once per retry. See [ADR-006](architecture/decisions/ADR-006-openrouter-second-provider.md#update-2026-09-08).
- **Structured-output validation** — at all three pipeline stages
  (`analyzeImage`, `aggregateSeries` / `synthesizeSeries`, `analyzeEvolution`)
  the model is asked for one JSON object (JSON mode on both transports; a
  request whose JSON mode the provider refuses is replayed once without it), which
  `domain/structured-output.ts` extracts and checks against the stage's Zod
  schema (`domain/types.ts`). A schema failure is recorded in a `validation`
  field on the corresponding output rather than aborting the run, and the
  free-text parsers still extract what they can from the raw response, so a
  validation failure degrades to free text instead of failing the pipeline.
- **Exit codes** — `main/index.ts` / `main/run-analyze.ts` return one of:
  `0` every image analyzed successfully, `1` user error
  (missing/invalid API key, bad `--max-cost-usd` value, unknown `AI_PROVIDER`),
  `2` input directory not found or unreadable, `3` no image series found,
  `4` partial failure (some images could not be analyzed), `5` the
  `--max-cost-usd` cap was exceeded and the run was aborted
  (`CostCapExceededError`), `6` `verify-manifest` found the run manifest
  missing, altered or unlinked, `7` `--strict-phi` found a likely identifier in
  a context file and refused to upload, `8` `--fail-on-probe` and a governance
  probe fired (outputs and manifest still written), `9` `--secure` and the input
  guard found a problem (nothing uploaded), `10` `--expect-hashes` and an image
  is missing from the list or changed (nothing uploaded), `99` unexpected
  internal error. See
  [SPEC.md §2.3](SPEC.md#23-exit-codes) and the README [Exit Codes](../README.md#exit-codes)
  table.
- **Run manifest and audit ledger** — every admitted run writes a
  `run_manifest.json` into its output directory, sealed with a SHA-256 over the
  canonical JSON of its own content
  ([ADR-007](architecture/decisions/ADR-007-run-manifest-audit-ledger.md),
  `infrastructure/run-manifest.ts`). It records provider and model, the pricing
  and settings in force, the SHA-256 and byte length of every input image and
  context file, one row per model call (stage, timestamp, tokens in/out
  including thinking tokens, per-call USD, provider-reported USD, retries), the
  SHA-256 of every artefact written, run totals, the exit code, the run's
  warnings, and the `humanReview` record. The per-call rows come from the
  existing cost-meter `onCall` hook plus `withStageTracking`, a pass-through
  wrapper around the `GeminiClient` port that labels the ledger at each node
  boundary — so no adapter, use-case or graph node changed to gain the record.
  `--manifest-chain <file>` links each run to the previous run's hash in an
  append-only JSON-Lines ledger, and `medical-imaging verify-manifest
<outputDir> [--chain <file>]` re-checks all of it offline (exit 6 on failure).
  The manifest is written on every exit path from the point the run is admitted
  — including the failing ones — as a best-effort side effect that can never
  change the exit code; pre-flight rejections (1, 2, 3, 7, 9, 10) deliberately leave
  nothing behind. This is tamper-_evidence_, not tamper-proofing: see
  THREAT_MODEL **T9** for the residual local-write risk.
- **PHI pre-flight** — `domain/phi-scan.ts` scans context files for likely
  identifiers before the first upload; findings carry masked excerpts only and
  land on stderr and in the manifest's `warnings[]`, with `--strict-phi`
  turning them into a refusal (THREAT_MODEL **T10**).
- See [architecture/decisions/](architecture/decisions/) for ADRs and
  [architecture/THREAT_MODEL.md](architecture/THREAT_MODEL.md).
