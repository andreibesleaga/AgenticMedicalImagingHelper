# E4L: Stratified Longitudinal Cohort (40 patients)

A larger, stratified longitudinal cohort for the SIME 2026 conference experiment, drawn from `Data_Entry_2017.csv` (NIH ChestX-ray14). Selection: patients with 3-6 studies, all frontal PA view, studies ordered by Follow-up #, deterministic (`random.seed(20260908)`). The 8 patients already used in cohort E4 and every patient whose images appear in the E2 scalability pool were excluded, so E4L is disjoint from both. Patients were stratified into four trajectory classes (10 each) and, within each stratum, balanced 5 male / 5 female and spread across the age range (sorted by age at first study, evenly spaced picks).

## Stratum definitions

- **worsening-like** — first study `No Finding`, last study has ≥1 pathology label.
- **improving-like** — first study has ≥1 pathology label, last study `No Finding`.
- **stable-pathology** — every study has ≥1 pathology label, and the label sets of the first and last study intersect.
- **stable-normal** — every study is `No Finding`.

## Cohort table

| id | stratum | sex | age (first study) | n studies | trajectory |
|---|---|---|---|---|---|
| 00016493 | worsening-like | F | 7 | 4 | No Finding → No Finding → Effusion → Effusion\|Infiltration |
| 00015192 | worsening-like | F | 40 | 3 | No Finding → Infiltration → Pleural_Thickening |
| 00007869 | worsening-like | F | 49 | 5 | No Finding → No Finding → Mass → No Finding → Atelectasis\|Effusion\|Pleural_Thickening |
| 00002407 | worsening-like | F | 58 | 3 | No Finding → No Finding → Infiltration\|Pneumothorax |
| 00007845 | worsening-like | F | 80 | 3 | No Finding → Atelectasis\|Pneumonia → Cardiomegaly\|Emphysema |
| 00016012 | worsening-like | M | 8 | 3 | No Finding → No Finding → Infiltration |
| 00011264 | worsening-like | M | 40 | 3 | No Finding → No Finding → Infiltration |
| 00022202 | worsening-like | M | 50 | 3 | No Finding → Atelectasis → Atelectasis |
| 00002197 | worsening-like | M | 59 | 3 | No Finding → Infiltration → Consolidation\|Infiltration |
| 00002681 | worsening-like | M | 85 | 3 | No Finding → No Finding → Edema\|Infiltration |
| 00022134 | improving-like | F | 6 | 3 | Infiltration → No Finding → No Finding |
| 00004946 | improving-like | F | 37 | 3 | Fibrosis → No Finding → No Finding |
| 00013787 | improving-like | F | 49 | 3 | Fibrosis → Effusion\|Infiltration → No Finding |
| 00010136 | improving-like | F | 59 | 4 | Infiltration → Infiltration → No Finding → No Finding |
| 00000049 | improving-like | F | 91 | 3 | Nodule → No Finding → No Finding |
| 00003158 | improving-like | M | 8 | 3 | Effusion → No Finding → No Finding |
| 00005852 | improving-like | M | 40 | 5 | Emphysema\|Pneumothorax → Pneumothorax → No Finding → No Finding → No Finding |
| 00021807 | improving-like | M | 53 | 3 | Atelectasis\|Effusion\|Infiltration → Atelectasis\|Effusion → No Finding |
| 00011214 | improving-like | M | 65 | 3 | Infiltration → Fibrosis → No Finding |
| 00028916 | improving-like | M | 84 | 3 | Cardiomegaly → Infiltration → No Finding |
| 00015863 | stable-pathology | F | 11 | 3 | Mass → Atelectasis\|Infiltration → Mass |
| 00027230 | stable-pathology | F | 41 | 4 | Consolidation\|Mass → Mass → Mass → Mass |
| 00025457 | stable-pathology | F | 54 | 5 | Infiltration\|Nodule → Infiltration → Infiltration\|Nodule → Fibrosis\|Mass\|Nodule → Effusion\|Mass\|Nodule |
| 00028588 | stable-pathology | F | 63 | 3 | Effusion → Atelectasis\|Infiltration\|Pleural_Thickening → Effusion\|Infiltration |
| 00000284 | stable-pathology | F | 86 | 6 | Hernia → Hernia → Hernia → Hernia → Cardiomegaly\|Hernia → Cardiomegaly\|Effusion\|Hernia |
| 00019779 | stable-pathology | M | 8 | 3 | Infiltration → Infiltration → Infiltration |
| 00027141 | stable-pathology | M | 34 | 4 | Infiltration → Fibrosis\|Pleural_Thickening → Infiltration → Infiltration |
| 00013880 | stable-pathology | M | 51 | 4 | Effusion → Effusion\|Pleural_Thickening → Atelectasis\|Effusion\|Pleural_Thickening → Effusion |
| 00019858 | stable-pathology | M | 62 | 3 | Atelectasis\|Cardiomegaly\|Effusion\|Mass\|Nodule → Cardiomegaly\|Effusion → Atelectasis |
| 00001531 | stable-pathology | M | 88 | 3 | Consolidation → Fibrosis → Consolidation\|Mass |
| 00016054 | stable-normal | F | 5 | 3 | No Finding → No Finding → No Finding |
| 00026237 | stable-normal | F | 35 | 3 | No Finding → No Finding → No Finding |
| 00002769 | stable-normal | F | 47 | 3 | No Finding → No Finding → No Finding |
| 00005669 | stable-normal | F | 56 | 3 | No Finding → No Finding → No Finding |
| 00000194 | stable-normal | F | 81 | 6 | No Finding → No Finding → No Finding → No Finding → No Finding → No Finding |
| 00015553 | stable-normal | M | 7 | 5 | No Finding → No Finding → No Finding → No Finding → No Finding |
| 00003295 | stable-normal | M | 34 | 6 | No Finding → No Finding → No Finding → No Finding → No Finding → No Finding |
| 00003980 | stable-normal | M | 46 | 4 | No Finding → No Finding → No Finding → No Finding |
| 00003876 | stable-normal | M | 57 | 5 | No Finding → No Finding → No Finding → No Finding → No Finding |
| 00001115 | stable-normal | M | 81 | 3 | No Finding → No Finding → No Finding |

## Counts

| stratum | requested | achieved | M | F | candidate pool size |
|---|---|---|---|---|---|
| worsening-like | 10 | 10 | 5 | 5 | 486 |
| improving-like | 10 | 10 | 5 | 5 | 330 |
| stable-pathology | 10 | 10 | 5 | 5 | 96 |
| stable-normal | 10 | 10 | 5 | 5 | 625 |

**Total patients: 40. Total studies/images: 145.** All four strata were filled to the full target of 10 patients (5 M / 5 F each); no stratum fell short.

## Label-noise caveat

NIH ChestX-ray14 `Finding Labels` are mined from radiology reports with NLP (not radiologist-adjudicated ground truth). Wang et al. (CVPR 2017) report the label extraction is expected to be >90% accurate, but the labels — and therefore the worsening/improving/stable trajectories derived from them here — should be treated as noisy weak supervision, not verified clinical ground truth.

