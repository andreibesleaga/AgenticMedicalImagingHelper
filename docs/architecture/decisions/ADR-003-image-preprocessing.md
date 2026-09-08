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

---

## Update — 2026-09-08: model-aware resolution detection replaces the fixed 1024 px

**Status**: Accepted (supersedes the fixed 1024 px / always-PNG rule above; the
`sharp` decision itself is unchanged)

### What forced the revisit

E3 measured the pre-flight against real inputs and the original rule failed in
both directions.

1. **It grew small payloads.** On the 31-image 224-px NIH ChestX-ray14 cohort
   (`experiments/sime2026/E3-payload-e4-224px.md`) the 1024-px resize is a no-op
   and only the unconditional PNG re-encode applies, at settings that need not
   match the source encoder's. Measured: 684,548 B on disk became 1,570,313 B on
   the wire — **+129.4 %**, paid for zero extra information.
2. **It threw away detail the model was charged for anyway.** 1024 px is below
   the effective input resolution of every family the CLI can address, and the
   claim in the original decision that "Gemini 2.5-pro processes images at a
   fixed internal resolution regardless of input size" is not what the vendor
   documents. Gemini tiles at 768 px with a crop unit of
   `floor(min(w, h) / 1.5)`, so the token cost above 384 px is **aspect-driven
   and scale-invariant**: a 4000-px plate and a 1024-px one cost the same 2×2
   tiles. Downscaling past the tile grid bought nothing and lost resolution.

### Decision

Detect the target resolution per provider/model from published effective input
resolutions, and skip the re-encode entirely when the file on disk is already
acceptable. Implemented in `src/infrastructure/image-policy.ts`; both clients
call the same `preparePayload`, so measurement and transport cannot diverge.

**Verified resolution table** (every number read from vendor documentation, not
inferred; sources are carried in the module and in `FAMILY_PROFILES[*].source`):

| family | `auto` long edge | `max` long edge | visual-token budget | token formula | source |
|---|---:|---:|---:|---|---|
| Gemini | 1536 | 3072 | — | 258 tokens if both dims ≤ 384 px, else `ceil(w/c) × ceil(h/c) × 258` with `c = floor(min(w,h)/1.5)` | ai.google.dev/gemini-api/docs/image-understanding, /docs/tokens |
| Gemma 3 / 4 | 896 | 896 | — | flat 256 (normalised to 896×896) | ai.google.dev/gemma/docs/core/model_card_3 |
| Claude (standard) | 1568 | 1568 | 1568 | `ceil(w/28) × ceil(h/28)` | platform.claude.com/docs/en/build-with-claude/vision |
| Claude 4.7+ (high-res) | 1568 | 2576 | 4784 | same, capped at 4784 | platform.claude.com/docs/en/build-with-claude/vision |
| Qwen-VL 2.5 / 3 | 1000 | 3584 | 1280 | `ceil(w/28) × ceil(h/28)`, clamped to 4…16384 | huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct |
| unknown | 1024 | 1024 | — | none (`null`) | — (previous default kept, so an unrecognised id is never a silent regression) |

`1536` is 2 × 768: Gemini's tile grid is `ceil(1.5)` = 2 tiles across the short
edge, so that is the resolution the tiler actually samples. Claude's `auto`
declines the 2576-px high-resolution tier because its cost *is* per pixel — up
to ~3× the tokens for detail a chest-radiograph read does not need.

**Decision rules, in order:**

1. **Preset.** `IMAGE_QUALITY` selects `auto` (table, default), `max` (model
   ceiling) or `economy` (768 px, one Gemini tile). `IMAGE_MAX_DIM` is a hard
   override of all of it.
2. **Visual-token budget** (Claude, Qwen-VL; `auto`/`economy` only). These
   families cap tokens as well as the long edge, and near square the token cap
   binds first — the provider downscales server-side and the extra pixels were
   paid for in bytes for nothing. The target is trimmed to
   `28 × floor(sqrt(budget × aspect))`, which reproduces the vendor's own
   published downscale targets to the pixel: 1092×1092 and 1456×819 on the
   1568-token standard tier, 2576×1449 on the 4784-token high-resolution tier.
3. **Tile alignment** (Gemini; `auto`/`economy` only). A long edge overshooting a
   768-px multiple by less than a tenth of a tile is snapped down. Honest note:
   because the Gemini tile count is scale-invariant above 384 px, this saves
   bytes and latency but **not** tokens.
4. **Passthrough.** If the long edge is already ≤ the target, the container is
   PNG or JPEG, there is no alpha and the depth is 8-bit, the **original bytes go
   on the wire untouched** — no decode, no re-encode, no possibility of growth.
   This is the branch that removes the +129.4 %.
5. **Otherwise resize / re-encode.** `fit: inside, withoutEnlargement: true`;
   greyscale kept at one channel (libvips otherwise promotes a grey source to
   3-channel sRGB on PNG save); alpha stripped; lossless PNG output unless the
   source was JPEG and `IMAGE_JPEG_FOR_PHOTO=1` (then JPEG q=90).

The media type now follows the bytes actually sent, so a passed-through JPEG is
announced as `image/jpeg` instead of the previous constant `image/png`.

### Measured effect (E3, re-run 2026-09-08)

| cohort | images | on disk | old pre-flight | new pre-flight |
|---|---:|---:|---:|---:|
| `e4-224px` (NIH ChestX-ray14 derivative, 224 px) | 31 | 684,548 B | 1,570,313 B (**+129.4 %**) | 678,332 B (**−0.9 %**) |
| `large-study` (synthetic 2500²–4000², deterministic) | 3 | 45,551,868 B | 2,943,445 B (−93.5 %, at 1024 px) | 6,066,209 B (−86.7 %, at 1536 px) |

The large-study row is a deliberate trade, not a regression: the new pre-flight
sends 1536 px where the old one sent 1024 px — 50 % more linear resolution — for
**identical** Gemini image-token cost (3096 tokens either way, because the tile
count is aspect-driven). It buys resolution with bytes, not with money.

### Consequences

**Positive:** the small-input regression is gone (floor is now 0 % growth); large
plates arrive at the resolution the model actually samples; per-image provenance
(`ImageAnalysis.preprocessing`) makes every run auditable — what was on disk,
what was sent, under which policy, and the vendor-formula token estimate; three
env knobs let a run trade quality against cost without a code change.

**Negative:** the payload for large plates is larger than under the old 1024-px
rule; the family table is a maintenance surface that has to be re-verified when a
vendor changes its tiling or tier limits (the token-estimate tests pin the
published golden rows, so drift fails the suite rather than passing silently).

**Neutral:** `prepareImageForGemini` is kept and simply delegates, so no caller
had to change. **Still out of scope:** DICOM window/level selection. 16-bit
inputs are reduced by libvips' linear full-range map (0…65535 → 0…255), *not* by
`normalise()`, which would stretch per-image contrast and silently change what
the model sees; choosing a clinically appropriate window remains future work, as
does any claim of diagnostic equivalence — bytes and tokens are not diagnosis.

---

*Update by: Claude Code | 2026-09-08*
