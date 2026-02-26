import type { ImageAnalysis } from "../domain/types.js";
import type { GeminiClient } from "../infrastructure/gemini-client.js";

/**
 * Analyze a single medical image using the Gemini client.
 * Always returns an ImageAnalysis (never throws) — errors are captured in status="error".
 */
export async function analyzeImageUseCase(
  imagePath: string,
  seriesId: string,
  geminiClient: GeminiClient
): Promise<ImageAnalysis> {
  return geminiClient.analyzeImage(imagePath, seriesId);
}
