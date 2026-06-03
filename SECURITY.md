# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

This is a local, single-user CLI tool. There is no hosted service and no network
surface beyond outbound calls to the Google Gemini API.

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

## Google Gemini API key handling

This tool requires a `GOOGLE_API_KEY` (Gemini). Because a single run can fan out
to many paid API calls, key hygiene matters:

- **Never commit a real key.** `.env` is git-ignored; only `.env.example`
  (placeholder) is tracked. Verify with `git grep -i AIza` before any commit.
- **Never log the key.** The key is read from the environment and is never printed
  to stdout/stderr or written to any report. Structured logs redact it.
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
  identifiers (including EXIF/DICOM metadata) before submission. The tool does not
  do this for you.
- **Compliance is the operator's responsibility.** If you feed in real patient
  data, you — not this project — are responsible for HIPAA (45 CFR Part 164),
  GDPR Art. 9 (special-category health data), and any local equivalents. Gemini's
  data-retention terms are governed by _your_ contract with Google.
- This software is **not a medical device** and must not be used for clinical
  decision-making. See the disclaimer in [README.md](README.md).

## Hardening already in place

- Path-traversal protection on all filesystem reads (`src/infrastructure/file-scanner.ts`).
- Input image extension allow-list (`.png`, `.jpg`, `.jpeg`).
- Text context truncated to 2000 characters to limit prompt-injection surface.
- Images resized to ≤1024px before submission (payload-size bound).
- Mandatory, type-enforced disclaimer on every emitted report.

See [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) for the full audit.
