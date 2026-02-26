import type { GraphState, TemporalAnalysis } from "../domain/types.js";
import type { GeminiClient } from "../infrastructure/gemini-client.js";

/**
 * Analyze temporal evolution across all series summaries.
 * Passes the optional root-level text context to the Gemini client.
 */
export async function analyzeEvolutionUseCase(
  state: GraphState,
  geminiClient: GeminiClient
): Promise<TemporalAnalysis> {
  const { seriesResults } = state;

  // Root context may be injected as an optional extension field
  const rootContextText = (state as GraphState & { rootContextText?: string }).rootContextText;

  return geminiClient.analyzeEvolution(seriesResults, rootContextText);
}
