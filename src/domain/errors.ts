export class MissingApiKeyError extends Error {
  constructor() {
    super("GOOGLE_API_KEY is required. Set it in your environment or .env file.");
    this.name = "MissingApiKeyError";
  }
}

export class FileScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileScanError";
  }
}

export class ImageAnalysisError extends Error {
  constructor(
    public readonly imagePath: string,
    cause: Error
  ) {
    super(`Failed to analyze image: ${imagePath} — ${cause.message}`);
    this.name = "ImageAnalysisError";
    this.cause = cause;
  }
}
