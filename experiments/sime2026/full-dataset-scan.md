# Full-dataset scan — NIH ChestX-ray14 224-px archive

This exercises the **file scanner + sharp preprocessing + CSV metadata join only**. No model call (Gemini/OpenRouter) is made anywhere in this script — it is a fully deterministic, offline pass over every image.

## Run

- Source archive: `<dataset-dir>/NIHDataset_archive.zip` (extracted to `../nih-cxr14/images-224/images-224`)
- Metadata: `../nih-cxr14/Data_Entry_2017.csv`
- Images found: **112,120**
- Images with metadata match: **112,120**
- Concurrency: 8 workers
- Scan wall time: **453.19 s** (453,186.48 ms)
- Total script wall time (incl. CSV I/O): 455.27 s
- Throughput: **247.4 images/s**
- Errors: **0** (none)

## Dimensions & bytes (decoded / processed)

| metric                                   | min   | median | p95    | max     | mean      |
| ---------------------------------------- | ----- | ------ | ------ | ------- | --------- |
| width (px)                               | 224   | 224    | 224    | 224     | 224       |
| height (px)                              | 224   | 224    | 224    | 224     | 224       |
| bytes original                           | 5,226 | 21,864 | 24,212 | 34,157  | 21,571.06 |
| bytes processed (post resize→png)        | 6,147 | 50,872 | 58,730 | 75,257  | 49,841.25 |
| base64 length                            | 8,196 | 67,832 | 78,308 | 100,344 | 66,456.33 |
| per-image ms (stat+decode+resize+encode) | 13.52 | 29.74  | 50.88  | 175.2   | 32.31     |

**Byte-size change from preprocessing: +131.06%** (total original 2,418,547,683 B → total processed 5,588,200,613 B). This archive is pre-downscaled to ~224 px, well under the pipeline's 1024×1024 cap, so `resize(1024,1024,{fit:"inside",withoutEnlargement:true})` is a no-op for every image here — the size delta is entirely from PNG re-encoding. It is a **large increase**, not a reduction: the archive's source PNGs are already heavily optimized/compressed 8-bit grayscale files, while sharp's default `.png()` encoder (no explicit `compressionLevel`, matching the production chain exactly) does not match that optimization, so re-encoding at the same pixel dimensions makes the file bigger here. The task's ≈0%-or-negative expectation does NOT hold for this specific low-resolution, pre-compressed archive — it holds when the resize step actually does work. On full-resolution clinical images (2000-3000 px, per `OriginalImage[Width,Height]` in the metadata) the same chain's resize step would dominate and produce a large size _reduction_ instead.

## Decode metadata distributions

Channels:

- 1 channel(s): 111,601
- 2 channel(s): 519

Bit depth (sharp `metadata().depth`):

- uchar: 112,120

## CSV-metadata-joined distributions (join key: image filename)

- `No Finding`: 60,412 (53.88%)
- Multi-label images (>1 finding): 20,735 (18.49%)

Top Finding Labels (by image count, multi-label images counted once per label):

| label              | count  |
| ------------------ | ------ |
| No Finding         | 60,412 |
| Infiltration       | 19,870 |
| Effusion           | 13,307 |
| Atelectasis        | 11,535 |
| Nodule             | 6,323  |
| Mass               | 5,746  |
| Pneumothorax       | 5,298  |
| Consolidation      | 4,667  |
| Pleural_Thickening | 3,385  |
| Cardiomegaly       | 2,772  |
| Emphysema          | 2,516  |
| Edema              | 2,303  |
| Fibrosis           | 1,686  |
| Pneumonia          | 1,353  |
| Hernia             | 227    |

View Position:

- PA: 67,310
- AP: 44,810

Sex:

- M: 63,340
- F: 48,780

Age buckets (parsed from `Patient Age`, Y/M/D units converted to fractional years):

- 0-9: 1,425
- 10-19: 5,409
- 20-29: 12,788
- 30-39: 16,313
- 40-49: 21,731
- 50-59: 27,406
- 60-69: 19,272
- 70-79: 6,641
- 80-89: 1,054
- 90-99: 65
- out-of-range (<0 or >120): 16

## Per-patient study-count histogram

Unique patients: **30,805**

| studies per patient | # patients |
| ------------------- | ---------- |
| 1                   | 17,503     |
| 2                   | 4,113      |
| 3                   | 2,100      |
| 4                   | 1,330      |
| 5                   | 938        |
| 6                   | 787        |
| 7                   | 608        |
| 8                   | 494        |
| 9                   | 387        |
| 10+                 | 2,545      |

## Output files

- `full-dataset-scan.csv` — 7,947,702 bytes (7.58 MB), one row per image.
