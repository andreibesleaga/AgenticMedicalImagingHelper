# E3 — request payload after the client's image pre-flight (`e4-224px`)

- Source: `../nih-cxr14/input/E4`
- Images: 31
- Provider / model: `google` / `gemini-2.5-flash` (family `gemini`)
- Policy: `IMAGE_QUALITY=auto`, long-edge target 1536 px, tile-aligned to 768 px
- Pipeline: `preparePayload()` imported from `src/infrastructure/image-policy.ts`,
  i.e. the same code path every analysis request uses.
- Actions: passthrough 30, reencoded 1

**This measures bytes and estimates tokens; it does not measure diagnosis.**
Choosing a target resolution changes the image the model reads. The table
below quantifies transport size, the base64 body the wire carries, and the
vendor-formula image-token cost of the pixels sent. It is not evidence that a
resized image supports the same diagnosis as the original. Establishing that
would require a reader study against ground truth (out of scope here).

| image                                |      original | original px | action                      |          sent | sent px | mime      | base64 chars | reduction | img tokens |
| ------------------------------------ | ------------: | ----------: | --------------------------- | ------------: | ------: | --------- | -----------: | --------: | ---------: |
| `00000008/series_1/00000008_000.png` |      23.2 KiB |     224×224 | passthrough                 |      23.2 KiB | 224×224 | image/png |        31696 |      0.0% |        258 |
| `00000008/series_2/00000008_001.png` |      22.3 KiB |     224×224 | passthrough                 |      22.3 KiB | 224×224 | image/png |        30380 |      0.0% |        258 |
| `00000008/series_3/00000008_002.png` |      19.7 KiB |     224×224 | passthrough                 |      19.7 KiB | 224×224 | image/png |        26944 |      0.0% |        258 |
| `00000067/series_1/00000067_000.png` |      21.6 KiB |     224×224 | passthrough                 |      21.6 KiB | 224×224 | image/png |        29500 |      0.0% |        258 |
| `00000067/series_2/00000067_001.png` |      21.1 KiB |     224×224 | passthrough                 |      21.1 KiB | 224×224 | image/png |        28780 |      0.0% |        258 |
| `00000067/series_3/00000067_002.png` |      20.5 KiB |     224×224 | passthrough                 |      20.5 KiB | 224×224 | image/png |        27948 |      0.0% |        258 |
| `00000086/series_1/00000086_000.png` |      20.0 KiB |     224×224 | passthrough                 |      20.0 KiB | 224×224 | image/png |        27376 |      0.0% |        258 |
| `00000086/series_2/00000086_001.png` |      27.5 KiB |     224×224 | reencoded                   |      21.4 KiB | 224×224 | image/png |        29256 |     22.1% |        258 |
| `00000086/series_3/00000086_002.png` |      21.3 KiB |     224×224 | passthrough                 |      21.3 KiB | 224×224 | image/png |        29052 |      0.0% |        258 |
| `00000092/series_1/00000092_000.png` |      22.1 KiB |     224×224 | passthrough                 |      22.1 KiB | 224×224 | image/png |        30140 |      0.0% |        258 |
| `00000092/series_2/00000092_001.png` |      22.0 KiB |     224×224 | passthrough                 |      22.0 KiB | 224×224 | image/png |        30076 |      0.0% |        258 |
| `00000092/series_3/00000092_002.png` |      21.3 KiB |     224×224 | passthrough                 |      21.3 KiB | 224×224 | image/png |        29052 |      0.0% |        258 |
| `00000092/series_4/00000092_003.png` |      20.4 KiB |     224×224 | passthrough                 |      20.4 KiB | 224×224 | image/png |        27852 |      0.0% |        258 |
| `00000148/series_1/00000148_000.png` |      20.9 KiB |     224×224 | passthrough                 |      20.9 KiB | 224×224 | image/png |        28512 |      0.0% |        258 |
| `00000148/series_2/00000148_001.png` |      21.6 KiB |     224×224 | passthrough                 |      21.6 KiB | 224×224 | image/png |        29476 |      0.0% |        258 |
| `00000148/series_3/00000148_002.png` |      22.4 KiB |     224×224 | passthrough                 |      22.4 KiB | 224×224 | image/png |        30532 |      0.0% |        258 |
| `00000148/series_4/00000148_003.png` |      22.3 KiB |     224×224 | passthrough                 |      22.3 KiB | 224×224 | image/png |        30504 |      0.0% |        258 |
| `00000219/series_1/00000219_000.png` |      20.8 KiB |     224×224 | passthrough                 |      20.8 KiB | 224×224 | image/png |        28372 |      0.0% |        258 |
| `00000219/series_2/00000219_001.png` |      21.3 KiB |     224×224 | passthrough                 |      21.3 KiB | 224×224 | image/png |        29048 |      0.0% |        258 |
| `00000219/series_3/00000219_002.png` |      21.3 KiB |     224×224 | passthrough                 |      21.3 KiB | 224×224 | image/png |        29024 |      0.0% |        258 |
| `00000219/series_4/00000219_003.png` |      21.4 KiB |     224×224 | passthrough                 |      21.4 KiB | 224×224 | image/png |        29224 |      0.0% |        258 |
| `00000239/series_1/00000239_000.png` |      21.6 KiB |     224×224 | passthrough                 |      21.6 KiB | 224×224 | image/png |        29512 |      0.0% |        258 |
| `00000239/series_2/00000239_001.png` |      22.6 KiB |     224×224 | passthrough                 |      22.6 KiB | 224×224 | image/png |        30864 |      0.0% |        258 |
| `00000239/series_3/00000239_002.png` |      21.6 KiB |     224×224 | passthrough                 |      21.6 KiB | 224×224 | image/png |        29520 |      0.0% |        258 |
| `00000239/series_4/00000239_003.png` |      21.6 KiB |     224×224 | passthrough                 |      21.6 KiB | 224×224 | image/png |        29540 |      0.0% |        258 |
| `00000239/series_5/00000239_004.png` |      21.5 KiB |     224×224 | passthrough                 |      21.5 KiB | 224×224 | image/png |        29348 |      0.0% |        258 |
| `00000239/series_6/00000239_005.png` |      20.5 KiB |     224×224 | passthrough                 |      20.5 KiB | 224×224 | image/png |        28028 |      0.0% |        258 |
| `00000296/series_1/00000296_000.png` |      20.2 KiB |     224×224 | passthrough                 |      20.2 KiB | 224×224 | image/png |        27640 |      0.0% |        258 |
| `00000296/series_2/00000296_001.png` |      20.6 KiB |     224×224 | passthrough                 |      20.6 KiB | 224×224 | image/png |        28124 |      0.0% |        258 |
| `00000296/series_3/00000296_002.png` |      20.7 KiB |     224×224 | passthrough                 |      20.7 KiB | 224×224 | image/png |        28268 |      0.0% |        258 |
| `00000296/series_4/00000296_003.png` |      22.6 KiB |     224×224 | passthrough                 |      22.6 KiB | 224×224 | image/png |        30904 |      0.0% |        258 |
| **total**                            | **668.5 KiB** |           — | passthrough 30, reencoded 1 | **662.4 KiB** |       — | —         |   **904492** |  **0.9%** |   **7998** |

Totals: 684548 B on disk → 678332 B sent (0.9% reduction) → 904492 base64 characters in the request body (1.333× the payload size).

Estimated image tokens for the pixels sent: **7998** across 31 images. The same images at native resolution would be estimated at 7998 tokens.

For the Gemini family those two numbers are equal above 384 px, and that is
not a bug in the measurement. Gemini derives its tile count from a crop unit
of `floor(min(w, h) / 1.5)`, which scales with the image, so above the 384-px
flat-rate threshold the tile count — and therefore the token cost — depends
on the aspect ratio alone, not on the resolution. On that path the pre-flight
buys bytes and latency, not tokens. Families that charge per pixel (Claude,
Qwen-VL) are where the resolution policy also reduces token cost, and the
policy sizes for exactly the largest image those providers accept unscaled.

A **negative** reduction would mean the pre-flight made the payload _larger_.
That is what the previous unconditional `resize(1024).png()` did to small,
already well-compressed inputs such as the 224-px NIH derivative: the resize
was a no-op and only the re-encode applied, at settings that need not match
the source encoder's. The current policy detects that case and forwards the
original bytes untouched (`action: passthrough`), so the floor is now 0 %.

Per-image decisions:

- `00000008/series_1/00000008_000.png` — passthrough (target 1536 px): long edge 224px ≤ target 1536px, 8-bit png without alpha — original bytes sent unmodified
- `00000008/series_2/00000008_001.png` — passthrough (target 1536 px): long edge 224px ≤ target 1536px, 8-bit png without alpha — original bytes sent unmodified
- `00000008/series_3/00000008_002.png` — passthrough (target 1536 px): long edge 224px ≤ target 1536px, 8-bit png without alpha — original bytes sent unmodified
- `00000067/series_1/00000067_000.png` — passthrough (target 1536 px): long edge 224px ≤ target 1536px, 8-bit png without alpha — original bytes sent unmodified
- `00000067/series_2/00000067_001.png` — passthrough (target 1536 px): long edge 224px ≤ target 1536px, 8-bit png without alpha — original bytes sent unmodified
- … 26 more, same decisions.
