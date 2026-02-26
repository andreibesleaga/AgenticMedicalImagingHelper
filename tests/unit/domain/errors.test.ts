import { describe, it, expect } from "@jest/globals";
import {
  MissingApiKeyError,
  FileScanError,
  ImageAnalysisError,
} from "../../../src/domain/errors.js";

describe("Domain Errors", () => {
  describe("MissingApiKeyError", () => {
    it("has correct name and message", () => {
      const err = new MissingApiKeyError();
      expect(err.name).toBe("MissingApiKeyError");
      expect(err.message).toContain("GOOGLE_API_KEY");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("FileScanError", () => {
    it("has correct name and message", () => {
      const err = new FileScanError("Could not read /some/path");
      expect(err.name).toBe("FileScanError");
      expect(err.message).toBe("Could not read /some/path");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("ImageAnalysisError", () => {
    it("has correct name, message, imagePath, and cause", () => {
      const cause = new Error("ENOENT: no such file");
      const err = new ImageAnalysisError("/patient/scan.png", cause);

      expect(err.name).toBe("ImageAnalysisError");
      expect(err.imagePath).toBe("/patient/scan.png");
      expect(err.message).toContain("/patient/scan.png");
      expect(err.message).toContain("ENOENT: no such file");
      expect(err.cause).toBe(cause);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
