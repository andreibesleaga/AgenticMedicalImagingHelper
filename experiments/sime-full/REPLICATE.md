# Replicating SIME-FULL, step by step

Every command used for this pack, in order, on a Linux or WSL2 machine. Paths are
relative to the repository root unless stated. Nothing here needs administrator
rights. Research and education only; see [`../../DISCLAIMER.md`](../../DISCLAIMER.md).

Tested on 2026-09-29: WSL2 Ubuntu, Node 22, Python 3.12 with Pillow 10.2, an
NVIDIA RTX 3060 Laptop GPU (6 GB), Ollama 0.34.4.

## 1. The program

```bash
git clone https://github.com/andreibesleaga/AgenticMedicalImagingHelper.git
cd AgenticMedicalImagingHelper
npm ci
npm run build
npm test            # all tests must pass before any experiment
```

## 2. The data: NIH ChestX-ray14 originals

The archives are public (NIH Clinical Center, Box). Archive 1 (about 2 GB) holds
all eight E4 patients. The NIH server is slow and drops long transfers, so the
downloader resumes and checks each archive until `gzip -t` passes.

```bash
mkdir -p ../nih-cxr14-full/archives
cd ../nih-cxr14-full/archives
bash ../../AgenticMedicalImagingHelper/experiments/sime-full/fetch-nih.sh 1
cd ../../AgenticMedicalImagingHelper
```

The paper's labels file is also needed (for the analysis only):
`../nih-cxr14/Data_Entry_2017.csv` from the same NIH site, or pass `--csv <path>`
to `analyze.ts`.

Build the two input trees from the same original files, and record their
fingerprints:

```bash
python3 experiments/sime-full/prepare-nih-full.py ../nih-cxr14-full/archives ../nih-cxr14-full/input E4
```

This writes `../nih-cxr14-full/input/r1024/E4/…` (original PNGs, byte for byte) and
`../nih-cxr14-full/input/r224/E4/…` (224 × 224, Pillow LANCZOS), and updates
`selection-hashes.json` (originals) and `selection-hashes-r224.json` (the 224-px
copies, with the Pillow version). Check yours against the committed files: every
original's SHA-256 must match.

## 3. A local model, without administrator rights (optional, free)

```bash
# Ollama into your home folder (the release is a .tar.zst archive)
mkdir -p ~/.local/ollama
curl -L https://ollama.com/download/ollama-linux-amd64.tar.zst -o /tmp/ollama.tar.zst
tar --use-compress-program=unzstd -xf /tmp/ollama.tar.zst -C ~/.local/ollama
#   (no zstd installed? python3 -m venv /tmp/zv && /tmp/zv/bin/pip install zstandard,
#    then decompress with the zstandard module and extract with tarfile)

# Serve on this machine only, with a context large enough for the evolution prompt
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_NUM_PARALLEL=1 \
  ~/.local/ollama/bin/ollama serve &

# The model: Google MedGemma 1.5, 4B, 4-bit (about 3.3 GB), under the Health AI
# Developer Foundations terms (research use; read them first)
~/.local/ollama/bin/ollama pull medgemma1.5:4b
```

Check the server log shows `library=CUDA` for your GPU. A warm call takes about 8 s
on a 6 GB laptop GPU; generation runs at about 14 tokens/s.

## 4. Running the arms

Every run checks every input image against the fingerprint list before anything
is sent (`--expect-hashes`, exit 10 on a mismatch) and carries a cost cap.

```bash
cd experiments/sime-full

# Local MedGemma (free; nothing leaves the machine)
AI_PROVIDER=local RES=1024 ./run.sh E4 medgemma1.5:4b
AI_PROVIDER=local RES=224  ./run.sh E4 medgemma1.5:4b

# OpenRouter models (key in the environment; each run capped at USD 1)
set -a; . ../../.env; set +a
for m in google/gemma-4-31b-it qwen/qwen3-vl-235b-a22b-instruct google/gemini-2.5-flash \
         google/gemini-3.8-flash anthropic/claude-sonnet-5 google/gemini-3.1-pro-preview; do
  for r in 1024 224; do AI_PROVIDER=openrouter RES=$r ./run.sh E4 "$m"; done
done
cd ../..
```

The free variant `google/gemma-4-31b-it:free` was tried first and was rate-limited
upstream (HTTP 429) on 2026-09-29; the evidence is in `free-tier-evidence/`.

## 5. Checking and analysing

```bash
# Every run's sealed record must verify
for d in experiments/sime-full/runs/*/output; do node dist/main/index.js verify-manifest "$d" || echo "FAILED $d"; done

# Every number in RESULTS.md comes from here
node_modules/.bin/tsx experiments/sime-full/analyze.ts --csv ../nih-cxr14/Data_Entry_2017.csv
```

`analyze.ts` writes `ANALYSIS.md` and `analysis.json`. It reuses the SIME 2026
pack's scoring code unchanged, so the numbers are computed the same way as the
paper's.

## 6. Cleaning up

```bash
kill %1                                  # the ollama serve job, if started in this shell
rm -rf ~/.local/ollama ~/.ollama         # the runtime and the downloaded model
rm -rf ../nih-cxr14-full                 # the archives and input trees
```
