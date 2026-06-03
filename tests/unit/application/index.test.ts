/**
 * R11: the application barrel is the public library surface
 * (`agentic-medical-imaging-helper/use-cases`). Assert it re-exports the
 * use-cases so programmatic consumers can import them without the CLI.
 */
import { describe, it, expect } from "@jest/globals";
import * as useCases from "../../../src/application/index.js";

describe("application library barrel", () => {
  it("re-exports the three use-cases as callables", () => {
    expect(typeof useCases.analyzeImageUseCase).toBe("function");
    expect(typeof useCases.aggregateSeriesUseCase).toBe("function");
    expect(typeof useCases.analyzeEvolutionUseCase).toBe("function");
  });

  it("exposes exactly the documented surface (no accidental extras)", () => {
    expect(Object.keys(useCases).sort()).toEqual([
      "aggregateSeriesUseCase",
      "analyzeEvolutionUseCase",
      "analyzeImageUseCase",
    ]);
  });
});
