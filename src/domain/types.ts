import { z } from "zod";

// ─── Input ───────────────────────────────────────────────────────────────────

/** A discovered series folder with its associated images and optional context file */
export interface SeriesInfo {
  seriesId: string;
  imagePaths: string[];
  textContextPath?: string;
}

// ─── Runtime validation of model output ─────────────────────────────────────

/**
 * Result of runtime-validating one model response against its Zod schema.
 *
 * Recorded on every output record so schema failures are visible in the
 * artefacts and countable after a run (`validation.ok === false`) instead of
 * silently degrading. A failure never aborts the pipeline: the free-text
 * fallback parsers fill what they can and the narrative is preserved.
 */
export interface ValidationOutcome {
  ok: boolean;
  /** Human-readable `path: message` pairs; present only when `ok` is false. */
  issues?: string[];
}

// ─── Image pre-flight (what was actually sent to the model) ──────────────────

/** Quality preset that selected the target resolution (`IMAGE_QUALITY`). */
export type ImageQualityPreset = "auto" | "max" | "economy";

/** What the pre-flight did to the file before it went on the wire. */
export type ImagePreprocessingAction = "passthrough" | "resized" | "reencoded";

/**
 * Provenance for the bytes one analysis request carried.
 *
 * Recorded on every `ImageAnalysis` so a run can be audited after the fact:
 * what the file was on disk, what the model actually received, which policy
 * chose that resolution, and the vendor-formula token estimate for it. It is
 * descriptive only — nothing downstream branches on it.
 */
export interface ImagePreprocessingRecord {
  /** Pixel dimensions of the file on disk. */
  nativeWidth: number;
  nativeHeight: number;
  /** Pixel dimensions of the image actually sent. */
  sentWidth: number;
  sentHeight: number;
  /** File size on disk, and the byte length of the payload sent. */
  bytesIn: number;
  bytesOut: number;
  /** Container of the bytes sent (`png` or `jpeg`) and its media type. */
  format: string;
  mimeType: string;
  /** Preset that resolved the target (`auto` | `max` | `economy`). */
  policy: ImageQualityPreset;
  /** Long-edge cap the policy resolved for this provider/model. */
  targetDim: number;
  action: ImagePreprocessingAction;
  /** One-line human explanation of why that action was taken. */
  reason: string;
  /**
   * Vendor-formula estimate of the image tokens the sent pixels cost, or
   * `null` when the model family has no published formula.
   */
  estimatedImageTokens: number | null;
}

export const ImagePreprocessingRecordSchema = z.object({
  nativeWidth: z.number().int().positive(),
  nativeHeight: z.number().int().positive(),
  sentWidth: z.number().int().positive(),
  sentHeight: z.number().int().positive(),
  bytesIn: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  format: z.string().min(1),
  mimeType: z.string().min(1),
  policy: z.enum(["auto", "max", "economy"]),
  targetDim: z.number().int().positive(),
  action: z.enum(["passthrough", "resized", "reencoded"]),
  reason: z.string(),
  estimatedImageTokens: z.number().int().nonnegative().nullable(),
});

// ─── Per-Image Analysis ───────────────────────────────────────────────────────

export type ImageQuality = "Poor" | "Fair" | "Good" | "Excellent";
export type Severity = "Normal" | "Mild" | "Moderate" | "Severe";

export interface Abnormality {
  name: string;
  severity: Severity;
  confidence: number;
  description: string;
}

export interface ImageAnalysis {
  imagePath: string;
  seriesId: string;
  status: "success" | "error";
  errorMessage?: string;
  modality?: string;
  anatomyRegion?: string;
  quality?: ImageQuality;
  findings?: string[];
  abnormalities?: Abnormality[];
  summary?: string;
  /** Reference URLs the model cited (Google Search grounding on the Gemini path). */
  references?: string[];
  rawResponse?: string;
  /**
   * Outcome of validating the model's structured (JSON) response against
   * `ParsedImageResponseSchema`. Present whenever a model response was
   * received; absent when the call itself failed (`status: "error"`).
   */
  validation?: ValidationOutcome;
  /**
   * What the image pre-flight sent for this record (resolution, bytes, policy,
   * estimated image tokens). Present whenever the pre-flight ran; absent when
   * the image could not be read at all.
   */
  preprocessing?: ImagePreprocessingRecord;
  processedAt: string;
  disclaimer: string;
}

// ─── Per-Series Aggregation ───────────────────────────────────────────────────

export interface SeriesSummary {
  seriesId: string;
  imageCount: number;
  successCount: number;
  failureCount: number;
  consistentFindings: string[];
  discrepancies: string[];
  primaryDiagnosis: string;
  differentialDiagnoses: string[];
  confidenceLevel: string;
  textContextUsed: boolean;
  textContextPath?: string;
  report: string;
  /** Outcome of validating the model response against `ParsedSeriesResponseSchema`. */
  validation?: ValidationOutcome;
  processedAt: string;
  disclaimer: string;
}

// ─── Temporal Evolution ───────────────────────────────────────────────────────

export type ProgressionStatus =
  "Improving" | "Stable" | "Worsening" | "Inconclusive" | "SingleSeries";

export interface TrendItem {
  finding: string;
  trend: "Improving" | "Stable" | "Worsening";
  details: string;
}

export interface TemporalAnalysis {
  seriesCount: number;
  seriesIds: string[];
  progression: ProgressionStatus;
  trends: TrendItem[];
  forecastedEvolution: string;
  treatmentRecommendations: string[];
  combinedReport: string;
  /** Outcome of validating the model response against `ParsedEvolutionResponseSchema`. */
  validation?: ValidationOutcome;
  processedAt: string;
  disclaimer: string;
}

// ─── LangGraph State ─────────────────────────────────────────────────────────

export interface GraphState {
  inputDir: string;
  outputDir: string;
  series: SeriesInfo[];
  imageResults: ImageAnalysis[];
  seriesResults: SeriesSummary[];
  evolutionResult?: TemporalAnalysis;
  reportPaths?: string[];
  error?: string;
  rootContextText?: string;
}

// ─── CLI Options ──────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  series?: string[];
  concurrency: number;
  verbose: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DISCLAIMER =
  "⚠️ DISCLAIMER: This analysis is AI-generated for educational and informational purposes only. " +
  "It is NOT a substitute for professional medical diagnosis or treatment. " +
  "All findings must be reviewed by a qualified healthcare professional before any clinical decision is made.";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
export const MAX_CONTEXT_LENGTH = 2000;

// ─── Zod Schemas (runtime validation of model output) ────────────────────────
//
// One schema per pipeline stage. The model is asked for a single JSON object
// shaped exactly like these; the adapters validate the response with
// `safeParse` (never `parse`, so a bad response degrades instead of throwing)
// and record the outcome as `ValidationOutcome` on the emitted record.

export const AbnormalitySchema = z.object({
  /** Short label, e.g. "Right lower lobe consolidation". */
  name: z.string().min(1).default("Unnamed finding"),
  severity: z.enum(["Normal", "Mild", "Moderate", "Severe"]),
  /** Model-reported confidence, 0–100. */
  confidence: z.number().min(0).max(100),
  description: z.string(),
});

/** Stage 1 — per-image structured record (§III-A). */
export const ParsedImageResponseSchema = z.object({
  modality: z.string().min(1),
  anatomyRegion: z.string().min(1),
  quality: z.enum(["Poor", "Fair", "Good", "Excellent"]),
  findings: z.array(z.string()).default([]),
  abnormalities: z.array(AbnormalitySchema).default([]),
  summary: z.string().min(1),
  /** Reference URLs (Google Search grounding); empty when the model cites none. */
  references: z.array(z.string()).default([]),
});

/** Stage 2 — per-series synthesis (§III-B). */
export const ParsedSeriesResponseSchema = z.object({
  consistentFindings: z.array(z.string()).default([]),
  discrepancies: z.array(z.string()).default([]),
  primaryDiagnosis: z.string().min(1),
  differentialDiagnoses: z.array(z.string()).default([]),
  confidenceLevel: z.enum(["High", "Medium", "Low"]),
  /** Markdown narrative kept for the human-readable series report. */
  report: z.string().min(1),
});

export const TrendItemSchema = z.object({
  finding: z.string().min(1),
  trend: z.enum(["Improving", "Stable", "Worsening"]),
  details: z.string().default(""),
});

/** Stage 3 — temporal evolution (§III-C). */
export const ParsedEvolutionResponseSchema = z.object({
  progression: z.enum(["Improving", "Stable", "Worsening", "Inconclusive"]),
  trends: z.array(TrendItemSchema).default([]),
  forecastedEvolution: z.string().min(1),
  /**
   * Experimental, research-only suggestions — labelled as such in every
   * rendered report; never clinical recommendations.
   */
  treatmentRecommendations: z.array(z.string()).default([]),
  /** Markdown narrative kept for the human-readable combined report. */
  combinedReport: z.string().min(1),
});

export type ParsedImageResponse = z.infer<typeof ParsedImageResponseSchema>;
export type ParsedSeriesResponse = z.infer<typeof ParsedSeriesResponseSchema>;
export type ParsedEvolutionResponse = z.infer<typeof ParsedEvolutionResponseSchema>;
