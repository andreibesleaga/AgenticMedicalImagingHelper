import * as fs from "fs/promises";
import type { GraphState, SeriesSummary } from "../domain/types.js";
import type { GeminiClient } from "../infrastructure/gemini-client.js";

/**
 * Aggregate all image results into per-series summaries.
 * Groups imageResults by seriesId, reads text context files, calls synthesizeSeries per series.
 */
export async function aggregateSeriesUseCase(
  state: GraphState,
  geminiClient: GeminiClient
): Promise<SeriesSummary[]> {
  const { imageResults, series } = state;

  // Build a lookup from seriesId → textContextPath
  const contextPaths = new Map<string, string | undefined>();
  for (const s of series) {
    contextPaths.set(s.seriesId, s.textContextPath);
  }

  // Group image results by seriesId
  const grouped = new Map<string, typeof imageResults>();
  for (const result of imageResults) {
    const existing = grouped.get(result.seriesId) ?? [];
    existing.push(result);
    grouped.set(result.seriesId, existing);
  }

  const summaries: SeriesSummary[] = [];

  for (const [seriesId, analyses] of grouped) {
    const textContextPath = contextPaths.get(seriesId);
    let textContext: string | undefined;

    if (textContextPath) {
      try {
        textContext = await fs.readFile(textContextPath, "utf-8");
      } catch {
        // Context file unreadable — proceed without it
        textContext = undefined;
      }
    }

    const summary = await geminiClient.synthesizeSeries(seriesId, analyses, textContext);
    summaries.push(summary);
  }

  return summaries;
}
