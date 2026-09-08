# ADR-006: OpenRouter as an opt-in second model provider (Gemini remains default)

- **Status:** Accepted
- **Date:** 2026-09-08
- **Relates to:** ADR-002 (Gemini search grounding), ADR-004 (single-model
  monoculture risk), ADR-005 (canonical architecture reference).

## Context

Conference reviewers raised the single-model monoculture concern that ADR-004
already records as accepted-but-deferred risk, with triggers T1–T7 that would
re-open it. Testing whether the pipeline's behaviour (fairness probe, report
structure, cost) is specific to Gemini or holds across model families requires
running the _unchanged_ graph on another model. Until now the only concrete
adapter was the Gemini SDK, so no such experiment could be run without
touching the pipeline, which would confound the comparison.

## Decision

Add **OpenRouter** (https://openrouter.ai, OpenAI-compatible
`chat/completions`) as a second adapter behind the existing `GeminiClient`
port, selected by `AI_PROVIDER=openrouter` with `OPENROUTER_API_KEY` and
`OPENROUTER_MODEL` (default `google/gemini-2.5-flash`).

- **Gemini via Google remains the default** (`AI_PROVIDER=google`, unchanged
  behaviour, unchanged exit codes).
- The adapter (`src/infrastructure/openrouter-client.ts`) implements the small
  `ContentGenerator` surface (`generateContent` → `{ response.text(),
usageMetadata }`) that `createGeminiClient` already depends on, so prompts,
  Markdown parsers, error folding, cost metering and the LangGraph wiring are
  shared verbatim. `src/adapters/langgraph-agent.ts` is untouched.
- Transport is the global `fetch` (Node ≥ 20); no new dependency. Images are
  the same sharp-preprocessed PNGs (ADR-003), sent as `image_url` data URLs.
- Usage is mapped from OpenRouter's normalised `usage` object with
  `usage: { include: true }`. Reasoning tokens are already counted inside
  `completion_tokens` (OpenRouter: "Reasoning tokens are considered output
  tokens and charged accordingly"), so they are not added again. The
  provider's own `usage.cost` (credits, USD-denominated) is accumulated by the
  cost meter as `providerReportedUsd` next to the token-based estimate; the
  `--max-cost-usd` cap still acts on the estimate for identical behaviour
  across providers.
- No JSON mode is requested. At the time this decision was recorded, no retry
  policy existed on either path, and the comparison was designed not to
  introduce path-specific behaviour. See "Update 2026-09-08" below — a shared
  retry policy has since been added to both adapters.

## Consequences

- **Positive.** The ADR-004 experiment is now runnable: same prompts, same
  graph, different model family, with provider-authoritative cost. The port
  boundary predicted by ADR-005 held — one new infrastructure file, one
  interface widening, and env-driven selection in the composition root.
- **Negative / honest limits.**
  - **No Google Search grounding** on the OpenRouter path (ADR-002 is a
    Gemini-only tool). The prompt's "Research Context" section is then answered
    from model knowledge alone and should be read as such in comparisons.
  - Model behaviour on OpenRouter varies by upstream vendor (tokeniser, image
    handling, refusal policy); the fairness probe and report parsers apply
    unchanged but their outcome is model-dependent — that is the point of the
    experiment, not a defect of the adapter.
  - The token-based estimate uses the Gemini price table (with the
    conservative fallback for non-Google ids); for OpenRouter treat
    `providerReportedUsd` as the figure of record.
- **Neutral.** This does not close ADR-004: the default deployment is still a
  single model. It provides the mechanism that T1/T3/T4/T7 would need, and the
  evidence base ADR-004 Option C asked for.

## Update 2026-09-08

The "no retry policy is added" line under Decision is superseded. A bounded
retry policy has since shipped in `src/infrastructure/retry.ts`
(`withRetry`, `isRetryableError`, `computeDelayMs`) and is wired into
**both** adapters (`gemini-client.ts` and `openrouter-client.ts`) from the
composition root in `src/main/run-analyze.ts`. Behaviour: exponential
backoff with full jitter, retried only for HTTP 429/5xx and transport-level
failures (never 4xx other than 429, never a Zod/parse failure), `Retry-After`
/ `RetryInfo` honoured when the provider supplies one, attempt count
configurable via `AI_MAX_RETRIES` (`0` disables retries). The cost of a
failed attempt is recorded once by the cost meter, not once per retry. This
does not change the comparison intent of this ADR — the policy is identical
on both paths, so provider comparisons made with it enabled remain
apples-to-apples.

## Update 2026-09-08 (structured JSON output)

The "No JSON mode is requested" sentence under **Decision** is likewise
superseded. All three stages now request a structured response on both paths:
OpenRouter requests are sent with `response_format: { type: "json_object" }`
(the OpenAI-compatible JSON mode), and the Google path sets the equivalent
`responseMimeType: "application/json"`. Each response is parsed and validated
at runtime with a Zod schema (`safeParse`, `src/domain/structured-output.ts`);
a response that fails validation is recorded on the artefact as
`validation: { ok: false, issues }` and falls back to the previous
pattern-extraction path, so the pipeline degrades instead of failing. If a
model or upstream vendor refuses JSON mode, the request is replayed once
without `response_format` and then follows the same fallback.

This keeps the two adapters behaviourally symmetric (the point of this ADR):
the request shape differs only in the provider-specific spelling of "return
JSON", and prompts, parsers, cost metering and the graph remain shared. Note
for comparisons that JSON mode materially changes token usage — the narrative
Markdown is no longer emitted as the primary payload — so cost and latency
figures recorded before this change are not comparable with figures recorded
after it.
