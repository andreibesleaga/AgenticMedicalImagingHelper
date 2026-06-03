/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "bundler",
        },
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts"],
  // tests/live/ are opt-in (real API calls, cost money). Run them with
  // `npm run test:live`, which sets JEST_LIVE=1 and overrides this ignore.
  testPathIgnorePatterns: process.env.JEST_LIVE
    ? ["/node_modules/"]
    : ["/node_modules/", "/tests/live/"],
  collectCoverageFrom: [
    "src/**/*.ts",
    // Composition root: commander wiring + env-var glue. Behaviour is
    // exercised end-to-end (tests/e2e/full-analysis.test.ts via the same
    // pipeline functions) and on its error edges (tests/e2e/cli-errors.test.ts);
    // we do not double-count line coverage at the wiring layer.
    "!src/main/index.ts",
    "!src/main/run-analyze.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 97,
      functions: 94, // 4 LangGraph annotation reducer closures are framework-internal
      branches: 92,
      statements: 97,
    },
  },
};
