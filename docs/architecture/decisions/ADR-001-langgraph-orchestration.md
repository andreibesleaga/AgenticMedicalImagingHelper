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

*ADR created by: Claude Code (adr-writer.skill) | 2026-02-25*
