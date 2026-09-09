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
  const { seriesResults, rootContextText } = state;

  return geminiClient.analyzeEvolution(seriesResults, rootContextText);
}
