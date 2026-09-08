# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

This is a local, single-user CLI tool. There is no hosted service and no network
surface beyond outbound calls to the configured model provider — Google Gemini
by default, or OpenRouter and the upstream vendor it proxies to when
`AI_PROVIDER=openrouter` ([ADR-006](docs/architecture/decisions/ADR-006-openrouter-second-provider.md)).

The full analysis lives in [docs/architecture/THREAT_MODEL.md](docs/architecture/THREAT_MODEL.md)
(STRIDE, T1–T10, with residual risks stated rather than mitigated away). This
file is the operator-facing summary of it.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a
suspected vulnerability.

- Preferred: open a [GitHub private security advisory](https://github.com/andreibesleaga/AgenticMedicalImagingHelper/security/advisories/new).

We aim to acknowledge within **5 working days** and to provide a remediation
timeline within **15 working days**. Please allow a **90-day coordinated
disclosure embargo** before any public discussion, extended only if a fix is
demonstrably in progress.

When reporting, include: affected version/commit, reproduction steps, impact, and
any suggested mitigation.

## API key handling

This tool requires `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) on the default path,
and `OPENROUTER_API_KEY` when `AI_PROVIDER=openrouter`. Because a single run can
fan out to many paid API calls, key hygiene matters:

- **Never commit a real key.** `.env` is git-ignored; only `.env.example`
  (placeholder) is tracked. Verify with `git grep -i AIza` before any commit.
- **Never log the key.** The key is read from the environment and is never printed
  to stdout/stderr or written to any report. `src/infrastructure/logger.ts`
  redacts **every** provider key it knows about — `GOOGLE_API_KEY`,
  `GEMINI_API_KEY` and `OPENROUTER_API_KEY` — both by value (any occurrence of
  the secret in a rendered line becomes `[REDACTED]`) and by field name
  (`authorization`, `token`, `apiKey`, `openrouter_api_key`, …).
  **When a new provider or key variable is added, it must be added to
  `secretValues()` in the same change**, or that key leaks verbatim into every
  structured log line. Keys never enter the run manifest: it records the
  provider and the model id, never a credential.
- **Use a project-scoped key**, not an account-wide one, so it can be revoked
  without collateral.
- **Rotate at least every 90 days**, and immediately if exposure is suspected.
- **Set a hard ceiling at the provider.** Configure a Google Cloud billing budget
  / quota so a misconfigured loop cannot run up unbounded cost. The CLI also
  accepts `--max-cost-usd <n>` as a client-side soft cap (see README).

## Handling medical image data (user responsibility)

Images you pass in are sent to the Google Gemini API for analysis. They leave your
machine only via that call.

- **De-identify first.** You are responsible for stripping PHI / patient
  identifiers (including EXIF and DICOM tags) before submission. The tool does
  **not** de-identify anything for you. What it does do, since v1.1, is refuse
  or warn about the most obvious failures of that obligation:
  - **DICOM is refused**, by file extension and by Part-10 magic bytes, because
    a DICOM file carries PHI in its tags and often burned into its pixels.
    Convert to PNG/JPEG _after_ de-identifying (exit code 2).
  - **Context `.txt` files are scanned** for MRN-like identifiers, SSNs, phone
    numbers, emails, dates of birth, patient-name lines and postal addresses
    before the first upload. The default is a warning on stderr plus a record
    in the run manifest; `--strict-phi` makes it fatal (exit code 7) and
    `--allow-phi` acknowledges it. Findings carry **masked** excerpts only, so
    the warning cannot itself become a second disclosure.
  - This scan is a **heuristic smoke alarm, not a de-identifier**. It has false
    positives and false negatives, it does not look inside images, and a clean
    scan means "nothing obvious" — never "safe to upload".
- **Compliance is the operator's responsibility.** If you feed in real patient
  data, you — not this project — are responsible for HIPAA (45 CFR Part 164),
  GDPR Art. 9 (special-category health data), and any local equivalents. Gemini's
  data-retention terms are governed by _your_ contract with Google.
- This software is **not a medical device** and must not be used for clinical
  decision-making. See the disclaimer in [README.md](README.md).

## Run-record integrity

Every run writes `<outputDir>/run_manifest.json`, sealed with a SHA-256 over the
canonical JSON of its own contents
([ADR-007](docs/architecture/decisions/ADR-007-run-manifest-audit-ledger.md)).
It records the provider and model, the settings in force, a SHA-256 of every
input image and context file, one row per model call (stage, tokens, cost,
retries), a SHA-256 of every artefact written, the exit code, the run's
warnings, and the human-review record.

```bash
# Link each run into an append-only ledger
medical-imaging analyze ./input ./output --manifest-chain ./audit/chain.jsonl

# Re-hash a completed run and check its ledger link (exit 0 ok, 6 tampered)
medical-imaging verify-manifest ./output --chain ./audit/chain.jsonl
```

**What this gives you:** any edit to a manifest field, to a written report, or
to an input image is detected; any run removed from or reordered in the ledger
breaks the chain and `verify-manifest` names where.

**What it does not give you:** this is tamper-_evidence_, not tamper-_proofing_.
The ledger lives on the same disk as the manifests, so a local attacker with
write access who rewrites a manifest and every subsequent ledger entry leaves no
trace (THREAT_MODEL **T9**). Non-repudiation needs a signature over a key held
off the box, or an external timestamping / transparency log — out of scope for a
research CLI. Keep the ledger on separate, append-only storage if you need more.

## Hardening already in place

- Path-traversal protection on all filesystem reads (`src/infrastructure/file-scanner.ts`).
- Input image extension allow-list (`.png`, `.jpg`, `.jpeg`); DICOM refused by
  extension and by magic bytes.
- Input limits: `MAX_IMAGES_PER_RUN` (default 500) and `MAX_IMAGE_BYTES`
  (default 50 MB), enforced before any upload.
- PHI/PII heuristic scan of context files before the first upload.
- Text context truncated to 2000 characters to limit prompt-injection surface.
- Images re-encoded and bounded before submission (payload-size bound,
  [ADR-003](docs/architecture/decisions/ADR-003-image-preprocessing.md));
  ancillary PNG metadata does not survive the re-encode.
- Bounded retry with jitter on HTTP 429/5xx only, and a client-side
  `--max-cost-usd` cap, so a rate limit or a runaway loop cannot become an
  unbounded bill.
- Mandatory, type-enforced disclaimer on every emitted report, plus a
  "requires review by a qualified clinician" block at the head of every
  Markdown report.
- Hash-sealed run manifest with an optional hash-chained ledger and an offline
  `verify-manifest` command.
- Deterministic exit codes (0–7, 99) so failures are scriptable rather than
  guessed at.

## Dependency and secret scanning in CI

`.github/workflows/security-baseline.yml` runs on every push and pull request to
`main`, and weekly on a schedule:

| Check                                  | Tool                              | Blocking?                                |
| -------------------------------------- | --------------------------------- | ---------------------------------------- |
| Known CVEs in the dependency tree      | `npm audit --audit-level=high`    | **Report-only** (`continue-on-error`)    |
| Known CVEs against the lockfile        | OSV-Scanner → SARIF               | Report-only; results in the Security tab |
| Filesystem vulnerability + secret scan | Trivy (`scanners: vuln,secret`)   | Report-only; results in the Security tab |
| SBOM                                   | CycloneDX 1.6 (uploaded artefact) | Report-only                              |
| License allow-list                     | `license-checker-rseidelsohn`     | Report-only                              |

Two honest notes about that table, because a security policy that overstates its
own CI is worse than one that has none:

- **Every scanner is currently `continue-on-error`** — they surface findings in
  the GitHub Security tab and the job log, they do not fail the merge. Making
  `npm audit` and OSV blocking is the next step, and is gated on triaging the
  existing backlog rather than on tooling.
- **Secret scanning is Trivy's, not a dedicated `gitleaks` step.** Trivy's
  `secret` scanner covers the common key formats; the dedicated pre-commit
  secret scan named in THREAT_MODEL **T3** is still open.

Alongside that:

- **Dependencies.** `.github/dependabot.yml` opens weekly grouped pull requests
  for `npm` (production and development separately) and for GitHub Actions.
  Review the CI result _and_ the diff on each one — a dependency PR with red CI
  is a blocker, not noise.
- **Secrets.** `.env` is git-ignored and only `.env.example` (placeholders) is
  tracked. Before any commit that touches configuration, `git grep -i AIza` and
  `git grep -i "sk-or-"` should both come back empty.
- **Reproducibility.** `package-lock.json` is committed and CI installs with
  `npm ci`, so a build cannot silently float to a different transitive tree.
  Actions are pinned by tag, and Trivy by commit SHA.

See [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) for the full audit.
