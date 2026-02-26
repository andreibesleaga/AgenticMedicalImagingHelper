import { z } from "zod";

// ─── Input ───────────────────────────────────────────────────────────────────

/** A discovered series folder with its associated images and optional context file */
export interface SeriesInfo {
  seriesId: string;
  imagePaths: string[];
  textContextPath?: string;
}

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
  rawResponse?: string;
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
  processedAt: string;
  disclaimer: string;
}

// ─── Temporal Evolution ───────────────────────────────────────────────────────

export type ProgressionStatus =
  | "Improving"
  | "Stable"
  | "Worsening"
  | "Inconclusive"
  | "SingleSeries";

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

// ─── Zod Schemas (runtime validation) ────────────────────────────────────────

export const AbnormalitySchema = z.object({
  name: z.string(),
  severity: z.enum(["Normal", "Mild", "Moderate", "Severe"]),
  confidence: z.number().min(0).max(100),
  description: z.string(),
});

export const ParsedImageResponseSchema = z.object({
  modality: z.string().optional(),
  anatomyRegion: z.string().optional(),
  quality: z.enum(["Poor", "Fair", "Good", "Excellent"]).optional(),
  findings: z.array(z.string()).optional().default([]),
  abnormalities: z.array(AbnormalitySchema).optional().default([]),
  summary: z.string().optional(),
});

export type ParsedImageResponse = z.infer<typeof ParsedImageResponseSchema>;
