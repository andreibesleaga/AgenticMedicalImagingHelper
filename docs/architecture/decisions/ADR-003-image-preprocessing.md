# ADR-003: sharp for Image Preprocessing Before Gemini API Submission

**Date**: 2026-02-25
**Status**: Accepted
**Deciders**: Claude Code (architect), Project Owner (human approval pending)

---

## Context

Before submitting medical images to the Gemini Vision API, they must be encoded as base64 for inline upload. Medical images (especially MRI/CT exports) can be very large (>10MB). The Gemini API has practical limits on inlineData size. The system needs to decide whether to preprocess images before submission.

---

## Options Considered

### Option A: Raw Base64 — No Preprocessing

**Approach**: Read image files as Buffer, convert directly to base64, send as `inlineData` to Gemini.

**Pros:**
- Zero additional dependencies
- Maximum fidelity (no pixel modification)
- Simpler code

**Cons:**
- Large medical images (e.g., 4000×4000 MRI) result in very large payloads (>15MB base64)
- Gemini inlineData has a 20MB practical limit — large images may fail
- Higher API latency for large payloads
- Higher token usage (Gemini charges per token, including image tokens)
- No format normalization — different MIME types may behave differently

---

### Option B: `sharp` — Resize to Max 1024px + PNG Normalization

**Approach**: Use `sharp` to resize images to a maximum dimension of 1024px (preserving aspect ratio), convert to PNG, then base64-encode.

**Pros:**
- Reduces payload size by 75–95% for large medical images
- Stays well within Gemini's inlineData limits
- PNG is lossless — no diagnostic information lost at the same resolution
- Consistent MIME type (always PNG) simplifies API call code
- `sharp` is the fastest Node.js image processing library (native libvips bindings)
- Format normalization handles JPG, PNG, WebP inputs uniformly

**Cons:**
- Additional `sharp` dependency (~10MB native binaries)
- Slight preprocessing latency per image (~50–200ms)
- Resize to 1024px may theoretically reduce visibility of very fine details (acceptable given Gemini's token window)

---

## Decision

We will use **Option B — `sharp` with max 1024px resize + PNG normalization**.

Gemini 2.5-pro processes images at a fixed internal resolution regardless of input size beyond its context window. Sending a 4000px image provides no diagnostic benefit over 1024px for AI analysis, but significantly increases payload size and API cost. The `sharp` library is production-grade, battle-tested, and widely used in Node.js image pipelines.

## Consequences

**Positive:**
- Reliable API submission for all image sizes
- Lower API latency and token cost
- Consistent behavior across image formats

**Negative:**
- `sharp` native binary dependency (~10MB) added to project
- Requires `npm install sharp` and platform-specific native builds

**Neutral:**
- Images are only resized if their max dimension exceeds 1024px; smaller images are passed as-is (converted to PNG)

## Implementation Note

```typescript
import sharp from "sharp";

async function prepareImageForGemini(imagePath: string): Promise<{ data: string; mimeType: string }> {
  const buffer = await sharp(imagePath)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/png" };
}
```

## Y-Statement Summary

For a medical imaging batch processor that submits potentially large images to the Gemini Vision API, sharp is a native Node.js image processing library that resizes and normalizes images before API submission, unlike raw base64 our solution prevents payload size failures and reduces API cost without sacrificing diagnostic image quality.

---

*ADR created by: Claude Code (adr-writer.skill) | 2026-02-25*
