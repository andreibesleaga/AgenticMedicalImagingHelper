# Contributing

Thanks for your interest in improving **AgenticMedicalImagingHelper**.

> ⚠️ This is a research/educational tool, **not a medical device**. Contributions
> must preserve the safety disclaimers and the "not for clinical use" framing.

## Prerequisites

- Node.js **>= 20** (CI runs on Node 20 and 22).
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

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not
open public issues for suspected security problems.

## License

By contributing you agree that your contributions are licensed under the
project's [GPL-3.0](LICENSE) license.
