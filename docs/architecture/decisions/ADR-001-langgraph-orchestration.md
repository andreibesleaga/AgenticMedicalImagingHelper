# ADR-001: LangGraph.js for Agent Orchestration

**Date**: 2026-02-25
**Status**: Accepted
**Deciders**: Claude Code (architect), Project Owner (human approval pending)

---

## Context

The system must orchestrate parallel analysis of N medical images across multiple series, then aggregate results in two stages (per-series fan-in, then cross-series evolution). This requires:

- Dynamic fan-out to a variable number of parallel workers (one per image)
- Stateful accumulation of results as workers complete
- Clear phase boundaries (scan → analyze → aggregate → evolve → report)
- Fault isolation (one failing image must not abort others)

---

## Options Considered

### Option A: Raw `Promise.all` + Manual State Management

**Approach**: Use native `Promise.all`/`Promise.allSettled` for parallelism; maintain state in a plain object.

**Pros:**

- Zero additional dependencies
- Simple for developers familiar with Node.js async

**Cons:**

- No built-in state machine semantics — phase transitions must be manually coded and tested
- No checkpointing — if the process crashes mid-run, all progress is lost
- Harder to extend (adding new phases requires restructuring the promise chain)
- No native streaming support for progress events
- Error handling and state accumulation must be hand-rolled

---

### Option B: LangGraph.js (`@langchain/langgraph`)

**Approach**: Model the pipeline as a `StateGraph` with named nodes. Use the `Send` API for dynamic fan-out.

**Pros:**

- `Send` API provides native dynamic fan-out with automatic fan-in (results accumulated in state array)
- Built-in checkpointing for resume-on-crash
- Clear, inspectable graph topology (nodes + edges visible as code)
- Streaming support for real-time progress updates
- Easy to extend — add new nodes without restructuring existing flow
- Official JS/TS support, stable as of 2025

**Cons:**

- Additional dependency (`@langchain/langgraph` + `@langchain/core`)
- Slightly higher learning curve than raw promises
- Adds ~3MB to bundle

---

## Decision

We will use **Option B — LangGraph.js**.

The Fan-Out/Fan-In pattern is the architectural core of this system. LangGraph's `Send` API eliminates the need to manually manage dynamic worker dispatch and result accumulation, significantly reducing the risk of subtle concurrency bugs. The checkpointing capability adds resilience for long-running batches (e.g., 100+ images). The explicit graph topology improves readability and testability.

## Consequences

**Positive:**

- Fan-out/fan-in implemented in ~20 lines vs. ~100 lines of manual async code
- Checkpointing means long batches can resume after interruption
- Graph topology is self-documenting

**Negative:**

- Additional `@langchain/langgraph` + `@langchain/core` dependency (~3MB)
- Team must learn LangGraph `StateGraph` API

**Neutral:**

- LangGraph's `StateGraph` is the primary abstraction; no other LangChain components are required

## Y-Statement Summary

For a medical imaging batch processor that needs dynamic parallel worker dispatch and stateful result accumulation, LangGraph.js is an agent orchestration framework that provides native Fan-Out via `Send` and stateful fan-in, unlike raw Promise.all our solution provides checkpointing, explicit graph topology, and extensibility without manual concurrency management.

---

## Update 2026-09-08 — Superseded in implementation

The mechanism described above is aspirational, not what shipped. The actual
implementation (`src/adapters/langgraph-agent.ts`) fans out inside a single
`analyzeImages` node using `Promise.all` + `p-limit(concurrency)` — the
`Send` API named under "Decision" and "Positive" above is **not used**.
There is also **no checkpointer**: the graph does not resume-on-crash: a
process interruption mid-run loses in-flight progress, same as Option A
would have. What LangGraph _does_ provide as implemented is the explicit
`StateGraph` topology (`START → analyzeImages → aggregateSeries →
analyzeEvolution → END`) with an append reducer for `imageResults`, and
per-image error isolation (a failing `analyzeImage` call is caught and
folded into `status: "error"` rather than aborting the batch). The
Fan-Out/Fan-In _pattern_ this ADR chose still holds; the specific `Send`
API and checkpointing claims do not, and should not be relied on when
reasoning about resilience.

---

_ADR created by: Claude Code (adr-writer.skill) | 2026-02-25_
