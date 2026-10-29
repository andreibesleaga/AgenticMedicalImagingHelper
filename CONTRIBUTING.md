# Contributing

Thanks for your interest in improving **AgenticMedicalImagingHelper**.

> ⚠️ This is a research/educational tool, **not a medical device**. Contributions
> must preserve the safety disclaimers and the "not for clinical use" framing.

## Prerequisites

- Node.js **>= 22** (CI runs on Node 22 and 24).
- npm (the repo ships a committed `package-lock.json`; use `npm ci`).

## Getting started

```bash
npm ci
cp .env.example .env   # add your GOOGLE_API_KEY (never commit a real key)
npm run build
```

## Development workflow

Run all gates locally before opening a PR — these mirror CI:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint src tests
npm run build         # tsc
npm test              # jest (mocked; excludes tests/live)
npm run test:coverage # jest with coverage thresholds
```

Optional, real-API end-to-end (costs money, needs `GOOGLE_API_KEY`):

```bash
npm run test:live
```

## Pull-request checklist

- [ ] `typecheck`, `lint`, `build`, and `test:coverage` all pass.
- [ ] New code ships with tests; coverage does not drop below the configured
      thresholds in `jest.config.js`.
- [ ] Public behavior is preserved unless the change is intentionally breaking
      (CLI flags, exit codes, and output schemas are a contract — additions are
      fine, removals/renames need a major-version bump).
- [ ] Every emitted report still carries the mandatory disclaimer.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.

## Coding conventions

- TypeScript strict mode, ESM, ports-and-adapters layering (see
  [docs/architecture.md](docs/architecture.md)).
- Formatting via Prettier (`npm run format`); linting via ESLint.
- Keep the framework (LangGraph) confined to `src/adapters/`.

## Continuous integration

Three workflows live in `.github/workflows/`:

| Workflow                | Runs on                                                                       | What it does                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | push and pull request to `main`                                               | On Node 22 and 24: `npm ci`, `typecheck`, `lint`, `build`, `test:coverage`. It does not run `test:live` or `format:check`.                                     |
| `security-baseline.yml` | push and pull request to `main`; weekly, Monday 06:00 UTC                     | `npm audit`, CycloneDX SBOM, licence allow-list, OSV-Scanner and Trivy, all report-only — see [SECURITY.md](SECURITY.md#dependency-and-secret-scanning-in-ci). |
| `pages.yml`             | push to `main` that changes `site/**` or the workflow itself; manual dispatch | Publishes `site/` to GitHub Pages. `docs/` is not published.                                                                                                   |

`.github/dependabot.yml` opens weekly pull requests (Monday) for npm, grouped
into production and development dependencies, and for GitHub Actions.

## Releases

There is no release workflow, and the package is not published to npm. A
release is a git tag `vX.Y.Z` with a GitHub release (`v0.1.0-beta`,
`v0.2.0-beta`, `v1.1.0` on 2026-09-10, `v1.1.1` on 2026-10-01). The version
number appears in four places:

- `package.json` `version` — read at run time by `--version`, the report
  footers and every run manifest's `toolVersion`;
- `CITATION.cff` `version` and `date-released`;
- the release heading in `CHANGELOG.md`;
- `--excludePackages "agentic-medical-imaging-helper@<version>"` in
  `.github/workflows/security-baseline.yml`.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not
open public issues for suspected security problems.

## License

By contributing you agree that your contributions are licensed under the
project's [GPL-3.0](LICENSE) license.
