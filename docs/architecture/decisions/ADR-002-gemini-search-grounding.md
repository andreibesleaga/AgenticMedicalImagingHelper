# ADR-002: Gemini Built-in Google Search Grounding for Research Context

**Date**: 2026-02-25
**Status**: Accepted
**Deciders**: Claude Code (architect), Project Owner (human approval pending)

---

## Context

Enable the AI agent to search for medical literature and treatment protocols as part of Section 5 (Research Context) of the analysis. The TypeScript implementation needs an equivalent web search capability.

---

## Options Considered

### Option A: `duck-duck-scrape` npm package

**Approach**: Add `duck-duck-scrape` (or similar) as a dependency; make HTTP calls to DuckDuckGo search before or after the Gemini call; inject results into the prompt.

**Pros:**

- Directly mirrors the Python reference implementation
- No dependency on Gemini-specific features
- Works with any LLM

**Cons:**

- Additional npm dependency (scraping library, may break on DuckDuckGo HTML changes)
- Requires a separate HTTP call per image + constructing a multi-turn conversation
- Results must be manually formatted and injected into the Gemini prompt
- Rate limiting on DuckDuckGo (no official API — scraping is fragile)
- Increases complexity: two separate API calls per image instead of one
- Scraped HTML content may require cleaning/parsing

---

### Option B: Gemini Built-in Google Search Grounding

**Approach**: Enable `tools: [{ googleSearch: {} }]` in the `@google/generative-ai` SDK call. Gemini handles search automatically when it determines a web lookup would improve its response.

**Pros:**

- Zero additional dependencies — uses the same `GOOGLE_API_KEY` already required
- Gemini decides when and what to search — no manual query construction
- Results are natively integrated into the response (no separate HTTP call)
- Official Google API feature — stable, no scraping fragility
- Search results are cited in the response with URLs
- Single API call per image (simpler code, lower latency)

**Cons:**

- Only available with Gemini models (not portable to other LLMs)
- Slightly less control over which queries are run
- May consume additional API quota for search calls

---

## Decision

We will use **Option B — Gemini Built-in Google Search Grounding**.

The Gemini Search Grounding is the cleanest solution: no extra dependency, no fragile scraping, and it uses the existing `GOOGLE_API_KEY`. Since we are already committed to Gemini as the only LLM (per AGENTS.md), portability is not a concern. The single-call architecture is simpler, more reliable, and reduces latency.

## Consequences

**Positive:**

- Eliminates `duck-duck-scrape` or similar dependency
- Single Gemini API call per image handles both vision analysis and research
- Official API — no scraping fragility

**Negative:**

- Locks Research Context to Google Search results (not DuckDuckGo or other engines)
- Search grounding may increase token usage per call

**Neutral:**

- Section 5 (Research Context) output format may differ from Python reference — acceptable

## Implementation Note

```typescript
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  tools: [{ googleSearch: {} }],
});
```

Search grounding is enabled for per-image analysis calls only. Series synthesis and evolution calls do not require web search.

## Y-Statement Summary

For a medical imaging agent that needs current medical literature and treatment protocol references, Gemini Google Search Grounding is a built-in SDK feature that natively integrates web search into LLM responses, unlike duck-duck-scrape our solution requires zero additional dependencies and is officially supported by Google.

---

_ADR created by: Claude Code (adr-writer.skill) | 2026-02-25_
