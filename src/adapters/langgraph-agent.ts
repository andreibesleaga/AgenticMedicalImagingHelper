import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import pLimit from "p-limit";
import type {
  SeriesInfo,
  GraphState,
  ImageAnalysis,
  SeriesSummary,
  TemporalAnalysis,
  AnalyzeOptions,
} from "../domain/types.js";
import type { GeminiClient } from "../infrastructure/gemini-client.js";
import { analyzeImageUseCase } from "../application/analyze-image.use-case.js";
import { aggregateSeriesUseCase } from "../application/aggregate-series.use-case.js";
import { analyzeEvolutionUseCase } from "../application/analyze-evolution.use-case.js";
import { createLogger } from "../infrastructure/logger.js";

// ─── LangGraph State Schema ───────────────────────────────────────────────────

/**
 * LangGraph Annotation schema for the medical imaging graph.
 * imageResults uses an append reducer to accumulate results from parallel fan-out.
 * All other fields use a last-write-wins reducer.
 */
const MedicalImagingState = Annotation.Root({
  inputDir: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  outputDir: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  series: Annotation<SeriesInfo[]>({ reducer: (_prev, next) => next, default: () => [] }),
  imageResults: Annotation<ImageAnalysis[]>({
    // Fan-in accumulator: merge new results into existing
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  seriesResults: Annotation<SeriesSummary[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  evolutionResult: Annotation<TemporalAnalysis | undefined>({
    /* istanbul ignore next */ reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  reportPaths: Annotation<string[] | undefined>({
    /* istanbul ignore next */ reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    /* istanbul ignore next */ reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  rootContextText: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

type AgentState = typeof MedicalImagingState.State;

// ─── Graph Builder ───────────────────────────────────────────────────────────

/**
 * Build and compile the LangGraph StateGraph for medical image analysis.
 * Topology: START → analyzeImages → aggregateSeries → analyzeEvolution → END
 *
 * analyzeImages implements Fan-Out/Fan-In:
 *   - Fans out: parallel analysis of every image across all series (p-limit concurrency)
 *   - Fans in: accumulates ImageAnalysis[] results via the append reducer
 */
function buildMedicalImagingGraph(geminiClient: GeminiClient, options: AnalyzeOptions) {
  const limit = pLimit(Math.max(1, options.concurrency));
  const logger = createLogger();

  // Wrap a node with structured enter/exit logging (silent unless LOG_LEVEL set).
  function logged(
    node: string,
    fn: (state: AgentState) => Promise<Partial<AgentState>>
  ): (state: AgentState) => Promise<Partial<AgentState>> {
    return async (state: AgentState) => {
      const startedAt = Date.now();
      logger.info("node:enter", { node });
      try {
        const result = await fn(state);
        logger.info("node:exit", { node, status: "ok", durationMs: Date.now() - startedAt });
        return result;
      } catch (err) {
        logger.error("node:error", {
          node,
          status: "error",
          durationMs: Date.now() - startedAt,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
  }

  // ── Node: analyzeImages ─────────────────────────────────────────────────
  async function analyzeImages(state: AgentState): Promise<Partial<AgentState>> {
    const { series } = state;

    // Gather all (imagePath, seriesId) pairs across all series
    const tasks: Array<{ imagePath: string; seriesId: string }> = [];
    for (const s of series) {
      for (const imagePath of s.imagePaths) {
        tasks.push({ imagePath, seriesId: s.seriesId });
      }
    }

    // Fan-out: concurrent image analysis limited by options.concurrency
    const imageResults = await Promise.all(
      tasks.map(({ imagePath, seriesId }) =>
        limit(() => analyzeImageUseCase(imagePath, seriesId, geminiClient))
      )
    );

    return { imageResults };
  }

  // ── Node: aggregateSeries ───────────────────────────────────────────────
  async function aggregateSeries(state: AgentState): Promise<Partial<AgentState>> {
    // Convert AgentState to GraphState for the use case
    const graphState: GraphState = {
      inputDir: state.inputDir,
      outputDir: state.outputDir,
      series: state.series,
      imageResults: state.imageResults,
      seriesResults: state.seriesResults,
      rootContextText: state.rootContextText,
    };

    const seriesResults = await aggregateSeriesUseCase(graphState, geminiClient);
    return { seriesResults };
  }

  // ── Node: analyzeEvolution ──────────────────────────────────────────────
  async function analyzeEvolution(state: AgentState): Promise<Partial<AgentState>> {
    const graphState: GraphState = {
      inputDir: state.inputDir,
      outputDir: state.outputDir,
      series: state.series,
      imageResults: state.imageResults,
      seriesResults: state.seriesResults,
      rootContextText: state.rootContextText,
    };

    const evolutionResult = await analyzeEvolutionUseCase(graphState, geminiClient);
    return { evolutionResult };
  }

  // ── Build StateGraph ────────────────────────────────────────────────────
  const graph = new StateGraph(MedicalImagingState)
    .addNode("analyzeImages", logged("analyzeImages", analyzeImages))
    .addNode("aggregateSeries", logged("aggregateSeries", aggregateSeries))
    .addNode("analyzeEvolution", logged("analyzeEvolution", analyzeEvolution))
    .addEdge(START, "analyzeImages")
    .addEdge("analyzeImages", "aggregateSeries")
    .addEdge("aggregateSeries", "analyzeEvolution")
    .addEdge("analyzeEvolution", END);

  return graph.compile();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full medical imaging agentic pipeline.
 *
 * @param inputDir   - Absolute path to the input directory
 * @param outputDir  - Absolute path to the output directory
 * @param series     - Pre-scanned series list from scanInputDirectory
 * @param geminiClient - Initialized GeminiClient
 * @param options    - CLI options (concurrency, verbose)
 * @returns Final GraphState with all results populated
 */
export async function runMedicalImagingAgent(
  inputDir: string,
  outputDir: string,
  series: SeriesInfo[],
  geminiClient: GeminiClient,
  options: AnalyzeOptions,
  rootContextText?: string
): Promise<GraphState> {
  const app = buildMedicalImagingGraph(geminiClient, options);

  const initialState: Partial<AgentState> = {
    inputDir,
    outputDir,
    series,
    imageResults: [],
    seriesResults: [],
    rootContextText,
  };

  const finalState = await app.invoke(initialState);

  return {
    inputDir: finalState.inputDir,
    outputDir: finalState.outputDir,
    series: finalState.series,
    imageResults: finalState.imageResults,
    seriesResults: finalState.seriesResults,
    evolutionResult: finalState.evolutionResult,
    reportPaths: finalState.reportPaths,
    error: finalState.error,
    rootContextText: finalState.rootContextText,
  };
}
