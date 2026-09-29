/**
 * Unsupported-measurement probe: absolute sizes in model text for inputs that
 * carry no pixel spacing, and the SIME 2026 failure case F1 (a fabricated
 * "4 cm cavitary lesion" at 95 % confidence).
 */
import { describe, it, expect } from "@jest/globals";

import {
  findSizes,
  findUnsupportedMeasurements,
  measurementProbeWarnings,
  MAX_DETAIL_LINES,
} from "../../../src/domain/measurement-probe.js";
import type { GraphState, ImageAnalysis } from "../../../src/domain/types.js";

function image(over: Partial<ImageAnalysis>): ImageAnalysis {
  return {
    status: "success",
    imagePath: "/in/series_2/00011264_001.png",
    seriesId: "series_2",
    modality: "X-ray",
    anatomyRegion: "Chest",
    quality: "Good",
    findings: [],
    abnormalities: [],
    summary: "",
    references: [],
    rawResponse: "",
    disclaimer: "x",
    ...over,
  } as ImageAnalysis;
}

function state(images: ImageAnalysis[], extra: Partial<GraphState> = {}): GraphState {
  return {
    inputDir: "/in",
    outputDir: "/out",
    series: [],
    imageResults: images,
    seriesResults: [],
    ...extra,
  };
}

describe("findSizes", () => {
  it("finds mm and cm sizes in common spellings", () => {
    expect(
      findSizes("A 4 cm cavity and a 12mm nodule; 3 x 2 cm mass; 1,5 cm; 10 millimetres.")
    ).toEqual(["4 cm", "12 mm", "3 x 2 cm", "1,5 cm", "10 millimetres"]);
  });

  it("ignores numbers without a length unit and units inside words", () => {
    expect(findSizes("95 % confidence, 3 views, 2 cmH2O pressure, mmHg")).toEqual([]);
  });
});

describe("findUnsupportedMeasurements", () => {
  it("reproduces failure case F1 as a high-confidence size claim", () => {
    const hits = findUnsupportedMeasurements(
      state([
        image({
          abnormalities: [
            {
              name: "Cavitary lesions",
              severity: "Severe",
              confidence: 95,
              description: "Multiple 4 cm cavitary lesions in the right lung.",
            },
          ],
        }),
      ])
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "high-confidence-size",
      size: "4 cm",
      confidence: 95,
      source: "image series_2/00011264_001.png",
    });
  });

  it("marks a sized abnormality below 90 % confidence as a plain absolute-size claim", () => {
    const hits = findUnsupportedMeasurements(
      state([
        image({
          abnormalities: [
            { name: "Nodule", severity: "Mild", confidence: 85, description: "2 cm nodule" },
          ],
        }),
      ])
    );
    expect(hits.map((h) => h.kind)).toEqual(["absolute-size"]);
  });

  it("scans findings, series reports and the evolution narrative", () => {
    const hits = findUnsupportedMeasurements(
      state([image({ findings: ["5 mm nodule"] })], {
        seriesResults: [
          {
            seriesId: "series_1",
            report: "Effusion measures 3 cm.",
            consistentFindings: [],
          } as never,
        ],
        evolutionResult: {
          combinedReport: "Grew from 1 cm to 2 cm.",
          forecastedEvolution: "",
          trends: [],
          treatmentRecommendations: [],
        } as never,
      })
    );
    expect(hits.map((h) => `${h.source}:${h.size}`)).toEqual([
      "image series_2/00011264_001.png:5 mm",
      "series series_1:3 cm",
      "evolution:1 cm",
      "evolution:2 cm",
    ]);
  });

  it("finds nothing in size-free text", () => {
    expect(findUnsupportedMeasurements(state([image({ findings: ["Clear lungs"] })]))).toEqual([]);
    expect(measurementProbeWarnings(state([]))).toEqual([]);
  });
});

describe("measurementProbeWarnings", () => {
  it("lists high-confidence hits first and caps the detail lines", () => {
    const many = Array.from({ length: MAX_DETAIL_LINES + 3 }, (_, i) => `${i + 1} mm spot`);
    const w = measurementProbeWarnings(
      state([
        image({
          findings: many,
          abnormalities: [
            { name: "Mass", severity: "Severe", confidence: 92, description: "6 cm mass" },
          ],
        }),
      ])
    );
    expect(w[0]).toMatch(/^measurement-probe: 24 absolute size claim\(s\).*1 at ≥90 % confidence/);
    expect(w[1]).toMatch(/\[high-confidence-size\].*"6 cm" at 92 % confidence/);
    expect(w).toHaveLength(1 + MAX_DETAIL_LINES + 1);
    expect(w[w.length - 1]).toBe("measurement-probe: 4 further hit(s) not listed.");
  });
});
