import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerativeModel } from "@google/generative-ai";
import {
  ImageAnalysis,
  SeriesSummary,
  TemporalAnalysis,
  DISCLAIMER,
  MAX_CONTEXT_LENGTH,
  ParsedImageResponseSchema,
  ParsedSeriesResponseSchema,
  ParsedEvolutionResponseSchema,
  type ImagePreprocessingRecord,
} from "../domain/types.js";
import { parseStructured, validationOutcome } from "../domain/structured-output.js";
import {
  preparePayload,
  resolvePolicy,
  type ImagePolicy,
  type PreparedImage,
} from "./image-policy.js";
import { CostMeter, CostCapExceededError, type TokenUsage } from "./cost-meter.js";
import { withRetry, type RetryOptions } from "./retry.js";

// ─── Prompt Templates ─────────────────────────────────────────────────────────

/**
 * Every stage asks for one JSON object so the response can be validated at
 * runtime against the Zod schema for that stage (`ParsedImageResponseSchema`,
 * `ParsedSeriesResponseSchema`, `ParsedEvolutionResponseSchema`). The JSON
 * carries the narrative too (`summary` / `report` / `combinedReport`), so a
 * validated response loses none of the free-text value, and the raw text is
 * kept verbatim on the record either way.
 */
const JSON_ONLY_RULES = `Rules:
- Reply with ONE JSON object and nothing else: no prose before or after it, no Markdown code fence.
- Every key in the schema must be present. Use an empty array when there is nothing to report.
- Use only the enum values listed; do not invent additional keys.
- Do not copy the disclaimer below into the JSON.`;

const IMAGE_ANALYSIS_PROMPT = `You are a highly skilled medical imaging expert with extensive knowledge in radiology and diagnostic imaging. Analyze the patient's medical image.

Return a JSON object with exactly this shape:
{
  "modality": "imaging modality, e.g. X-ray | MRI | CT | Ultrasound | PET | Nuclear Medicine",
  "anatomyRegion": "anatomical region and patient positioning, e.g. Chest (AP)",
  "quality": "Poor | Fair | Good | Excellent (technical adequacy of the image)",
  "findings": ["primary observations, systematically; include measurements, densities, location, size, shape where relevant"],
  "abnormalities": [
    {
      "name": "short label for the abnormality",
      "description": "precise description with supporting evidence",
      "severity": "Normal | Mild | Moderate | Severe",
      "confidence": 0
    }
  ],
  "summary": "patient-friendly explanation in plain language: what was seen, what it means, common concerns; define any unavoidable jargon",
  "references": ["2-3 URLs to recent literature or standard protocols for these findings; use Google Search when available"]
}

"confidence" is a number from 0 to 100. Leave "abnormalities" empty when the study is unremarkable.

${JSON_ONLY_RULES}

${DISCLAIMER}`;

function buildSeriesPrompt(
  seriesId: string,
  imageCount: number,
  analysesText: string,
  textContext?: string
): string {
  const contextSection = textContext
    ? `\n<context>\n${textContext.slice(0, MAX_CONTEXT_LENGTH)}\n</context>\n`
    : "";

  return `You are a medical imaging specialist synthesizing findings from ${imageCount} images of the same series (${seriesId}).

Individual image analyses:
${analysesText}
${contextSection}
Return a JSON object with exactly this shape:
{
  "consistentFindings": ["findings present across all images of the series"],
  "discrepancies": ["differences between views, each with a possible explanation"],
  "primaryDiagnosis": "the single most likely diagnosis for this series",
  "differentialDiagnoses": ["alternatives, most likely first"],
  "confidenceLevel": "High | Medium | Low",
  "report": "series-level clinical summary as Markdown, with headers and bullet points"
}

${JSON_ONLY_RULES}

${DISCLAIMER}`;
}

function buildEvolutionPrompt(
  seriesCount: number,
  summariesText: string,
  rootContext?: string
): string {
  const contextSection = rootContext
    ? `\n<context source="user-provided context">\n${rootContext.slice(0, MAX_CONTEXT_LENGTH)}\n</context>\n`
    : "";

  return `You are a medical imaging specialist analyzing disease progression across ${seriesCount} imaging sessions (ordered chronologically by series name).

Series summaries:
${summariesText}
${contextSection}
Return a JSON object with exactly this shape:
{
  "progression": "Improving | Stable | Worsening | Inconclusive (overall trend across the sessions)",
  "trends": [
    {
      "finding": "the finding tracked across sessions",
      "trend": "Improving | Stable | Worsening",
      "details": "what changed between which sessions, including inflection points"
    }
  ],
  "forecastedEvolution": "expected evolution without treatment, based only on the observed trend",
  "treatmentRecommendations": ["experimental suggestions implied by the observed trends; educational only, never clinical advice"],
  "combinedReport": "the full temporal analysis as Markdown, with headers and bullet points"
}

${JSON_ONLY_RULES}

${DISCLAIMER}`;
}

// ─── Image Preparation ────────────────────────────────────────────────────────

/**
 * The provider/model pair the pre-flight should size for when the caller does
 * not supply a policy.
 *
 * Read from the environment rather than threaded through the composition root
 * so that adding resolution detection changed no public constructor signature.
 * The defaults mirror the CLI's own (`AI_PROVIDER=google`,
 * `GEMINI_MODEL=gemini-2.5-flash`, `OPENROUTER_MODEL=google/gemini-2.5-flash`).
 */
function policyFromEnv(env: NodeJS.ProcessEnv = process.env): ImagePolicy {
  const provider = (env.AI_PROVIDER ?? "google").trim().toLowerCase();
  const model =
    provider === "openrouter"
      ? (env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash")
      : (env.GEMINI_MODEL ?? "gemini-2.5-flash");
  return resolvePolicy(provider, model, env);
}

/**
 * Prepare one image for transport under an explicit resolution policy.
 *
 * All the decisions live in `image-policy.ts`; this is the seam the clients and
 * the E3 experiment share, so the bytes measured are the bytes sent.
 */
export async function prepareImage(
  imagePath: string,
  policy: ImagePolicy = policyFromEnv()
): Promise<PreparedImage> {
  return preparePayload(imagePath, policy);
}

/**
 * Backward-compatible wrapper: prepare an image and return just the two fields
 * the SDK's `inlineData` part needs.
 *
 * Kept exported because it is the published seam for the payload experiment and
 * for the existing tests. It no longer hard-codes 1024 px or a PNG re-encode —
 * it delegates to `preparePayload`, which detects the target resolution from the
 * model family and passes an already-acceptable file through untouched. The
 * media type is therefore whatever the bytes actually are, not a constant.
 */
export async function prepareImageForGemini(
  imagePath: string,
  policy: ImagePolicy = policyFromEnv()
): Promise<{ data: string; mimeType: string }> {
  const prepared = await preparePayload(imagePath, policy);
  return { data: prepared.data, mimeType: prepared.mimeType };
}

// ─── Client Interface ─────────────────────────────────────────────────────────

/**
 * The model-agnostic port consumed by the use-cases and the LangGraph adapter.
 * Implemented for Google Gemini here and for OpenRouter in `openrouter-client.ts`.
 */
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

/** Request shape accepted by `GenerativeModel.generateContent` (string, parts, or full request). */
export type GenerateRequest = Parameters<GenerativeModel["generateContent"]>[0];

/**
 * The minimal `generateContent` surface this client depends on. The Gemini SDK
 * `GenerativeModel` satisfies it structurally; `createOpenRouterModel` provides
 * a second implementation so the prompts and parsers below are shared verbatim.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateRequest
  ): Promise<{ response: { text(): string; usageMetadata?: TokenUsage } }>;
}

export interface GeminiClientOptions {
  /**
   * Retry policy for the model call. Defaults come from `AI_MAX_RETRIES` /
   * `GEMINI_MAX_RETRIES`; pass `{ maxAttempts: 1 }` to disable retrying, or
   * `onRetry` to surface attempts in the CLI's verbose log.
   */
  retry?: RetryOptions;
  /**
   * Resolution policy for the image pre-flight. Defaults to the one derived
   * from `AI_PROVIDER` / `GEMINI_MODEL` / `OPENROUTER_MODEL` plus
   * `IMAGE_QUALITY` / `IMAGE_MAX_DIM` / `IMAGE_JPEG_FOR_PHOTO`; the OpenRouter
   * factory passes its own, because it knows the model id exactly.
   */
  imagePolicy?: ImagePolicy;
}

/** Generation config that asks the provider for a raw JSON body. */
export const JSON_GENERATION_CONFIG = { responseMimeType: "application/json" } as const;

/**
 * Attach `responseMimeType: "application/json"` to any of the three request
 * shapes the SDK accepts, without touching the prompt itself. The OpenRouter
 * shim reads the same flag and maps it to `response_format: {type:"json_object"}`,
 * so one switch turns on JSON mode for both providers.
 */
export function withJsonMode(request: GenerateRequest): GenerateRequest {
  if (typeof request === "string") {
    return {
      contents: [{ role: "user", parts: [{ text: request }] }],
      generationConfig: { ...JSON_GENERATION_CONFIG },
    };
  }
  if (Array.isArray(request)) {
    return {
      contents: [
        { role: "user", parts: request.map((p) => (typeof p === "string" ? { text: p } : p)) },
      ],
      generationConfig: { ...JSON_GENERATION_CONFIG },
    };
  }
  return {
    ...request,
    generationConfig: { ...request.generationConfig, ...JSON_GENERATION_CONFIG },
  };
}

/**
 * True when a provider rejected the request *because* JSON mode was asked for
 * — e.g. Gemini refusing `responseMimeType` while the Google Search grounding
 * tool is enabled. Such a refusal is not retryable and not the user's fault, so
 * the call is replayed once without JSON mode and the response then travels the
 * free-text fallback path (recorded as a validation failure, never a crash).
 */
export function isJsonModeUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /response.?mime.?type|response.?schema|json mode|json_object/i.test(message) &&
    /unsupported|not supported|not enabled|invalid|cannot be used|incompatible/i.test(message)
  );
}

/**
 * A failed attempt can still have consumed billable tokens (the provider
 * charges for what it processed before erroring). When the error carries
 * usage metadata we record it, so the cost estimate and `--max-cost-usd`
 * stay honest; when it does not, nothing is recorded and the retry costs the
 * meter nothing. Either way a retried call is metered once per *attempt that
 * reported usage*, never twice for the same tokens.
 */
function usageFromError(err: unknown): TokenUsage | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const node = err as { usageMetadata?: unknown; response?: { usageMetadata?: unknown } };
  const usage = node.usageMetadata ?? node.response?.usageMetadata;
  return typeof usage === "object" && usage !== null ? (usage as TokenUsage) : undefined;
}

export function createGeminiClient(
  model: ContentGenerator,
  meter?: CostMeter,
  options: GeminiClientOptions = {}
): GeminiClient {
  // One policy per client: the target resolution depends on the model, not on
  // the image, so it is resolved once instead of per request.
  const imagePolicy = options.imagePolicy ?? policyFromEnv();

  // Wraps generateContent to (a) retry transient failures — a 429 rate limit
  // once cost a whole reproducibility batch — and (b) record real token usage
  // from the SDK response. The meter is recorded *outside* the retry loop, so a
  // retried attempt never double-counts the tokens of the successful one.
  // When no meter is supplied the optional-chained record() is a no-op, so the
  // default path is functionally identical to calling the model directly.
  const attempt = (request: GenerateRequest) =>
    withRetry(async () => {
      try {
        return await model.generateContent(request);
      } catch (err) {
        const failedUsage = usageFromError(err);
        if (failedUsage) meter?.record(failedUsage);
        throw err;
      }
    }, options.retry);

  const generate = async (request: GenerateRequest) => {
    let result;
    try {
      result = await attempt(withJsonMode(request));
    } catch (err) {
      // Only a "JSON mode is not supported here" refusal is replayed; every
      // other error keeps its existing meaning (retried, then folded by the
      // caller into status=error / a "failed" narrative).
      if (!isJsonModeUnsupported(err)) throw err;
      result = await attempt(request);
    }
    meter?.record(result.response.usageMetadata);
    return result;
  };

  async function analyzeImage(imagePath: string, seriesId: string): Promise<ImageAnalysis> {
    const now = new Date().toISOString();
    // Provenance for the bytes this request carried. Captured outside the try
    // so a provider failure still reports what was sent; it stays undefined
    // only when the file itself could not be prepared.
    let preprocessing: ImagePreprocessingRecord | undefined;
    try {
      const prepared = await preparePayload(imagePath, imagePolicy);
      preprocessing = prepared.record;

      const result = await generate({
        contents: [
          {
            role: "user",
            parts: [
              // The media type follows the bytes actually sent — a passed-through
              // JPEG is announced as image/jpeg, not as the old constant PNG.
              { inlineData: { data: prepared.data, mimeType: prepared.mimeType } },
              { text: IMAGE_ANALYSIS_PROMPT },
            ],
          },
        ],
      });

      const rawResponse = result.response.text();

      // Structured path: one JSON object validated against the schema.
      const parsed = parseStructured(rawResponse, ParsedImageResponseSchema);
      if (parsed.ok) {
        return {
          imagePath,
          seriesId,
          status: "success",
          rawResponse,
          modality: parsed.value.modality,
          anatomyRegion: parsed.value.anatomyRegion,
          quality: parsed.value.quality,
          findings: parsed.value.findings,
          abnormalities: parsed.value.abnormalities,
          summary: parsed.value.summary,
          references: parsed.value.references,
          validation: validationOutcome(parsed),
          preprocessing,
          processedAt: now,
          disclaimer: DISCLAIMER,
        };
      }

      // Fallback: the response was not valid JSON for the schema. Keep the
      // narrative, extract what the pattern parsers can, and record why.
      return {
        imagePath,
        seriesId,
        status: "success",
        rawResponse,
        findings: extractFindings(rawResponse),
        modality: extractModality(rawResponse),
        summary: extractSummary(rawResponse),
        validation: validationOutcome(parsed),
        preprocessing,
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    } catch (err) {
      if (err instanceof CostCapExceededError) throw err;
      return {
        imagePath,
        seriesId,
        status: "error",
        errorMessage: (err as Error).message,
        ...(preprocessing ? { preprocessing } : {}),
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

    const prompt = buildSeriesPrompt(seriesId, analyses.length, analysesText, textContext);

    const counts = {
      seriesId,
      imageCount: analyses.length,
      successCount: successfulAnalyses.length,
      failureCount: analyses.length - successfulAnalyses.length,
      textContextUsed: !!textContext,
      processedAt: now,
      disclaimer: DISCLAIMER,
    };

    let rawResponse: string;
    try {
      const result = await generate(prompt);
      rawResponse = result.response.text();
    } catch (err) {
      if (err instanceof CostCapExceededError) throw err;
      // No response at all — nothing to validate, so no validation outcome.
      return {
        ...counts,
        consistentFindings: [],
        discrepancies: [],
        primaryDiagnosis: "See full report",
        differentialDiagnoses: [],
        confidenceLevel: "Medium",
        report: `Series synthesis failed: ${(err as Error).message}`,
      };
    }

    const parsed = parseStructured(rawResponse, ParsedSeriesResponseSchema);
    if (parsed.ok) {
      return {
        ...counts,
        consistentFindings: parsed.value.consistentFindings,
        discrepancies: parsed.value.discrepancies,
        primaryDiagnosis: parsed.value.primaryDiagnosis,
        differentialDiagnoses: parsed.value.differentialDiagnoses,
        confidenceLevel: parsed.value.confidenceLevel,
        report: parsed.value.report,
        validation: validationOutcome(parsed),
      };
    }

    return {
      ...counts,
      consistentFindings: [],
      discrepancies: [],
      primaryDiagnosis: extractDiagnosis(rawResponse),
      differentialDiagnoses: [],
      confidenceLevel: "Medium",
      report: rawResponse,
      validation: validationOutcome(parsed),
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
        forecastedEvolution:
          "Only one series available — temporal analysis requires multiple sessions.",
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

    let rawResponse: string;
    try {
      const result = await generate(prompt);
      rawResponse = result.response.text();
    } catch (err) {
      if (err instanceof CostCapExceededError) throw err;
      const failed = `Evolution analysis failed: ${(err as Error).message}`;
      return {
        seriesCount: summaries.length,
        seriesIds,
        progression: extractProgression(failed),
        trends: [],
        forecastedEvolution: "",
        treatmentRecommendations: [],
        combinedReport: failed,
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    }

    const parsed = parseStructured(rawResponse, ParsedEvolutionResponseSchema);
    if (parsed.ok) {
      return {
        seriesCount: summaries.length,
        seriesIds,
        progression: parsed.value.progression,
        trends: parsed.value.trends,
        forecastedEvolution: parsed.value.forecastedEvolution,
        treatmentRecommendations: parsed.value.treatmentRecommendations,
        combinedReport: parsed.value.combinedReport,
        validation: validationOutcome(parsed),
        processedAt: now,
        disclaimer: DISCLAIMER,
      };
    }

    return {
      seriesCount: summaries.length,
      seriesIds,
      progression: extractProgression(rawResponse),
      trends: [],
      forecastedEvolution: "",
      treatmentRecommendations: [],
      combinedReport: rawResponse,
      validation: validationOutcome(parsed),
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

export function createGeminiModelFromSdk(apiKey: string, modelName: string): GenerativeModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    // Enable Google Search grounding for research context (Section 5 of analysis)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ googleSearch: {} } as any],
  });
}
