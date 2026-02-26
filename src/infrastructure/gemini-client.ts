import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerativeModel } from "@google/generative-ai";
import sharp from "sharp";
import {
  ImageAnalysis,
  SeriesSummary,
  TemporalAnalysis,
  DISCLAIMER,
  MAX_CONTEXT_LENGTH,
} from "../domain/types.js";

// ─── Prompt Templates ─────────────────────────────────────────────────────────

const IMAGE_ANALYSIS_PROMPT = `You are a highly skilled medical imaging expert with extensive knowledge in radiology and diagnostic imaging. Analyze the patient's medical image and structure your response as follows:

### 1. Image Type & Region
- Specify imaging modality (X-ray/MRI/CT/Ultrasound/etc.)
- Identify the patient's anatomical region and positioning
- Comment on image quality and technical adequacy

### 2. Key Findings
- List primary observations systematically
- Note any abnormalities with precise descriptions
- Include measurements and densities where relevant
- Describe location, size, shape, and characteristics
- Rate severity: Normal/Mild/Moderate/Severe

### 3. Diagnostic Assessment
- Provide primary diagnosis with confidence level
- List differential diagnoses in order of likelihood
- Support each diagnosis with observed evidence
- Note any critical or urgent findings

### 4. Patient-Friendly Explanation
- Explain the findings in simple, clear language
- Avoid medical jargon or provide clear definitions
- Include visual analogies if helpful
- Address common patient concerns related to these findings

### 5. Research Context
Use Google Search to find:
- Recent medical literature about similar findings
- Standard treatment protocols
- Relevant medical links (2-3 key references)

Format your response using clear markdown headers and bullet points. Be concise yet thorough.

${DISCLAIMER}`;

function buildSeriesPrompt(
  seriesId: string,
  imageCount: number,
  analysesText: string,
  textContext?: string
): string {
  const contextSection =
    textContext
      ? `\n<context>\n${textContext.slice(0, MAX_CONTEXT_LENGTH)}\n</context>\n`
      : "";

  return `You are a medical imaging specialist synthesizing findings from ${imageCount} images of the same series (${seriesId}).

Individual image analyses:
${analysesText}
${contextSection}
Provide:
1. Consistent findings across all images
2. Discrepancies between views (and possible explanations)
3. Primary diagnosis with confidence level (High/Medium/Low)
4. Differential diagnoses in order of likelihood
5. Series-level clinical summary

Use clear markdown headers and bullet points.

${DISCLAIMER}`;
}

function buildEvolutionPrompt(
  seriesCount: number,
  summariesText: string,
  rootContext?: string
): string {
  const contextSection =
    rootContext
      ? `\n<context source="user-provided context">\n${rootContext.slice(0, MAX_CONTEXT_LENGTH)}\n</context>\n`
      : "";

  return `You are a medical imaging specialist analyzing disease progression across ${seriesCount} imaging sessions (ordered chronologically by series name).

Series summaries:
${summariesText}
${contextSection}
Analyze:
1. Changes between sessions (improving / stable / worsening per finding)
2. Overall progression trend (Improving/Stable/Worsening/Inconclusive)
3. Key inflection points
4. Forecasted evolution without treatment
5. Treatment recommendations based on observed trends

Use clear markdown headers and bullet points.

${DISCLAIMER}`;
}

// ─── Image Preparation ────────────────────────────────────────────────────────

async function prepareImageForGemini(
  imagePath: string
): Promise<{ data: string; mimeType: string }> {
  const buffer = await sharp(imagePath)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/png" };
}

// ─── Client Interface ─────────────────────────────────────────────────────────

export interface GeminiClient {
  analyzeImage(imagePath: string, seriesId: string): Promise<ImageAnalysis>;
  synthesizeSeries(
    seriesId: string,
    analyses: ImageAnalysis[],
    textContext: string | undefined
  ): Promise<SeriesSummary>;
  analyzeEvolution(
    summaries: SeriesSummary[],
    rootContext: string | undefined
  ): Promise<TemporalAnalysis>;
}

// ─── Client Factory ───────────────────────────────────────────────────────────

export function createGeminiClient(model: GenerativeModel): GeminiClient {
  async function analyzeImage(imagePath: string, seriesId: string): Promise<ImageAnalysis> {
    const now = new Date().toISOString();
    try {
      const imageData = await prepareImageForGemini(imagePath);

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: imageData },
              { text: IMAGE_ANALYSIS_PROMPT },
            ],
          },
        ],
      });

      const rawResponse = result.response.text();

      return {
        imagePath,
        seriesId,
        status: "success",
        rawResponse,
        findings: extractFindings(rawResponse),
        modality: extractModality(rawResponse),
        summary: extractSummary(rawResponse),
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    } catch (err) {
      return {
        imagePath,
        seriesId,
        status: "error",
        errorMessage: (err as Error).message,
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    }
  }

  async function synthesizeSeries(
    seriesId: string,
    analyses: ImageAnalysis[],
    textContext: string | undefined
  ): Promise<SeriesSummary> {
    const now = new Date().toISOString();
    const successfulAnalyses = analyses.filter((a) => a.status === "success");
    const analysesText = successfulAnalyses
      .map((a, i) => `**Image ${i + 1}** (${a.imagePath}):\n${a.rawResponse ?? ""}`)
      .join("\n\n---\n\n");

    const prompt = buildSeriesPrompt(
      seriesId,
      analyses.length,
      analysesText,
      textContext
    );

    let report: string;
    try {
      const result = await model.generateContent(prompt);
      report = result.response.text();
    } catch (err) {
      report = `Series synthesis failed: ${(err as Error).message}`;
    }

    return {
      seriesId,
      imageCount: analyses.length,
      successCount: successfulAnalyses.length,
      failureCount: analyses.length - successfulAnalyses.length,
      consistentFindings: [],
      discrepancies: [],
      primaryDiagnosis: extractDiagnosis(report),
      differentialDiagnoses: [],
      confidenceLevel: "Medium",
      textContextUsed: !!textContext,
      report,
      processedAt: now,
      disclaimer: DISCLAIMER,
    };
  }

  async function analyzeEvolution(
    summaries: SeriesSummary[],
    rootContext: string | undefined
  ): Promise<TemporalAnalysis> {
    const now = new Date().toISOString();
    const seriesIds = summaries.map((s) => s.seriesId);

    // Single series — no temporal comparison
    if (summaries.length === 1) {
      return {
        seriesCount: 1,
        seriesIds,
        progression: "SingleSeries",
        trends: [],
        forecastedEvolution: "Only one series available — temporal analysis requires multiple sessions.",
        treatmentRecommendations: [],
        combinedReport: summaries[0]?.report ?? "",
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    }

    const summariesText = summaries
      .map((s, i) => `**Series ${i + 1}: ${s.seriesId}**\n${s.report}`)
      .join("\n\n---\n\n");

    const prompt = buildEvolutionPrompt(summaries.length, summariesText, rootContext);

    let combinedReport: string;
    try {
      const result = await model.generateContent(prompt);
      combinedReport = result.response.text();
    } catch (err) {
      combinedReport = `Evolution analysis failed: ${(err as Error).message}`;
    }

    return {
      seriesCount: summaries.length,
      seriesIds,
      progression: extractProgression(combinedReport),
      trends: [],
      forecastedEvolution: "",
      treatmentRecommendations: [],
      combinedReport,
      processedAt: now,
      disclaimer: DISCLAIMER,
    };
  }

  return { analyzeImage, synthesizeSeries, analyzeEvolution };
}

// ─── Response Parsers (lightweight extraction) ────────────────────────────────

function extractModality(text: string): string | undefined {
  const match = text.match(/modality[:\s]+(X-ray|MRI|CT|Ultrasound|PET|Nuclear Medicine)/i);
  return match?.[1];
}

function extractFindings(text: string): string[] {
  const section = text.match(/### 2\. Key Findings\n([\s\S]*?)(?=###|$)/i);
  if (!section) return [];
  return section[1]!
    .split("\n")
    .filter((l) => l.trim().startsWith("-"))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function extractSummary(text: string): string | undefined {
  const section = text.match(/### 4\. Patient-Friendly Explanation\n([\s\S]*?)(?=###|$)/i);
  return section?.[1]?.trim();
}

function extractDiagnosis(text: string): string {
  const match = text.match(/Primary[:\s]+([^\n]+)/i);
  return match?.[1]?.trim() ?? "See full report";
}

function extractProgression(text: string): "Improving" | "Stable" | "Worsening" | "Inconclusive" {
  if (/improving/i.test(text)) return "Improving";
  if (/worsening/i.test(text)) return "Worsening";
  if (/stable/i.test(text)) return "Stable";
  return "Inconclusive";
}

// ─── Model Factory ────────────────────────────────────────────────────────────

export function createGeminiModelFromSdk(
  apiKey: string,
  modelName: string
): GenerativeModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    // Enable Google Search grounding for research context (Section 5 of analysis)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ googleSearch: {} } as any],
  });
}
