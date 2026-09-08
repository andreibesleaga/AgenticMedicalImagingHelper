#!/usr/bin/env bash
# demo/prepare-demo.sh
#
# Copies two showcase NIH ChestX-ray14 patients from the prepared local E4L
# cohort inputs into demo/input/, for the conference-video demo pack
# (npm run demo). Total 6 PNGs (3 per patient), small enough to live in the
# repo. See demo/README.md "Which patients, and why" for the selection
# rationale.
#
# Source: experiments/sime2026/E4L-cohort.md (the 40-patient stratified
# longitudinal cohort). Requires the NIH inputs to already be prepared on
# this machine by experiments/sime2026/../prepare-nih.py (see
# experiments/sime2026/README.md §2) — this script only copies, it does not
# download or derive anything.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NIH_E4L_ROOT="${NIH_E4L_ROOT:-/home/andrei/work/AI/nih-cxr14/input/E4L}"

# worsening-like: No Finding -> No Finding -> Infiltration (single new finding
# at the last study — a simple, legible "worsening" narrative for the video).
WORSENING_PATIENT="00011264"
# improving-like: Effusion -> No Finding -> No Finding (pathology present at
# the first study, cleared by the second — a simple, legible "improving"
# narrative for the video).
IMPROVING_PATIENT="00003158"

copy_patient() {
  local patient="$1"
  local src="$NIH_E4L_ROOT/$patient"
  local dst="$HERE/input/$patient"

  if [[ ! -d "$src" ]]; then
    echo "error: source patient directory not found: $src" >&2
    echo "  (set NIH_E4L_ROOT to override, or run experiments/sime2026/prepare-nih.py first)" >&2
    exit 1
  fi

  echo "Copying $patient -> demo/input/$patient"
  rm -rf "$dst"
  mkdir -p "$dst"

  cp "$src/patient_context.txt" "$dst/patient_context.txt"

  local n=0
  for series_dir in "$src"/series_*; do
    [[ -d "$series_dir" ]] || continue
    local series_id
    series_id="$(basename "$series_dir")"
    mkdir -p "$dst/$series_id"
    for img in "$series_dir"/*.png "$series_dir"/*.jpg "$series_dir"/*.jpeg; do
      [[ -f "$img" ]] || continue
      cp "$img" "$dst/$series_id/"
      n=$((n + 1))
    done
  done
  echo "  $n image(s) copied across $(find "$dst" -mindepth 1 -maxdepth 1 -type d | wc -l) series"
}

copy_patient "$WORSENING_PATIENT"
copy_patient "$IMPROVING_PATIENT"

cat >"$HERE/input/ATTRIBUTION.txt" <<'EOF'
Dataset attribution
====================

The chest radiographs under demo/input/ are drawn from the NIH Clinical
Center's ChestX-ray14 dataset:

  X. Wang, Y. Peng, L. Lu, Z. Lu, M. Bagheri, and R. M. Summers,
  "ChestX-ray8: Hospital-scale chest X-ray database and benchmarks on
  weakly-supervised classification and localization of common thorax
  diseases," in Proc. IEEE Conf. Computer Vision and Pattern Recognition
  (CVPR), 2017, pp. 2097-2106.

  Source: NIH Clinical Center. Released for research use.

Terms and provenance, as used here:
  - This demo uses the publicly redistributed 224-px derivative
    (images-224), not the original 1024-px archive.
  - Images are de-identified by the provider; the NIH asks that the dataset
    be cited and not be used to attempt to identify individuals.
  - Research use only. No clinical data of any kind is included — only
    de-identified frontal PA chest radiographs and the age/sex/view metadata
    already published in the dataset's own Data_Entry_2017.csv.
  - Finding labels (used to select these two patients as "worsening-like"
    and "improving-like") are NLP-mined from radiology reports, not
    radiologist-adjudicated ground truth — see
    experiments/sime2026/E4L-cohort.md "Label-noise caveat".

This tool's own output is AI-generated, experimental, and not a clinical
diagnosis — see the mandatory disclaimer in every generated report and
docs/COMPLIANCE.md §0.
EOF

echo "Wrote demo/input/ATTRIBUTION.txt"
echo "Done. Total images: $(find "$HERE/input" -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' | wc -l)"
