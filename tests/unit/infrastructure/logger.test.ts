import { describe, it, expect } from "@jest/globals";
import { createLogger } from "../../../src/infrastructure/logger.js";

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("createLogger", () => {
  it("is silent by default (no output at silent level)", () => {
    const { lines, write } = capture();
    const log = createLogger("silent", write);
    log.info("ignored", { a: 1 });
    log.error("ignored");
    expect(lines).toEqual([]);
  });

  it("emits structured JSON at or below the configured level", () => {
    const { lines, write } = capture();
    const log = createLogger("info", write);
    log.debug("below-threshold"); // dropped
    log.info("node:enter", { node: "analyzeImages" });

    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ level: "info", event: "node:enter", node: "analyzeImages" });
    expect(typeof rec.time).toBe("string");
  });

  it("emits at error, warn, info, and debug when the level permits", () => {
    const { lines, write } = capture();
    const log = createLogger("debug", write);
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["error", "warn", "info", "debug"]);
  });

  it("redacts sensitive field names (including nested)", () => {
    const { lines, write } = capture();
    const log = createLogger("info", write);
    log.info("call", {
      authorization: "Bearer abc",
      token: "t",
      nested: { apiKey: "zzz" },
      tags: ["plain", { secret: "s" }],
      ok: "fine",
    });
    const rec = JSON.parse(lines[0]);
    expect(rec.authorization).toBe("[REDACTED]");
    expect(rec.token).toBe("[REDACTED]");
    expect(rec.nested.apiKey).toBe("[REDACTED]");
    expect(rec.tags[0]).toBe("plain");
    expect(rec.tags[1].secret).toBe("[REDACTED]");
    expect(rec.ok).toBe("fine");
  });

  it("redacts the configured API key value wherever it appears in a string", () => {
    const saved = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "AIzaSECRETKEY123456";
    try {
      const { lines, write } = capture();
      const log = createLogger("info", write);
      log.info("url", { message: "calling with key AIzaSECRETKEY123456 in url" });
      const rec = JSON.parse(lines[0]);
      expect(rec.message).not.toContain("AIzaSECRETKEY123456");
      expect(rec.message).toContain("[REDACTED]");
    } finally {
      if (saved === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = saved;
    }
  });

  it("resolves the level from LOG_LEVEL when not given explicitly", () => {
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    try {
      const { lines, write } = capture();
      const log = createLogger(undefined, write);
      expect(log.level).toBe("debug");
      log.debug("d");
      expect(lines).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
  });

  it("falls back to silent for an unrecognised LOG_LEVEL", () => {
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "bogus";
    try {
      expect(createLogger().level).toBe("silent");
    } finally {
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
  });

  it("writes to stderr by default when no sink is injected", () => {
    const orig = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = ((chunk: any) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const log = createLogger("info"); // default stderr sink
      log.info("to-stderr", { x: 1 });
    } finally {
      process.stderr.write = orig;
    }
    expect(captured.join("")).toContain("to-stderr");
  });
});

describe("createLogger — OpenRouter key redaction (AI_PROVIDER=openrouter)", () => {
  /** Run `fn` with the given env values, restoring whatever was there before. */
  function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("redacts the OPENROUTER_API_KEY value wherever it appears in a string", () => {
    withEnv({ OPENROUTER_API_KEY: "sk-or-v1-SECRETVALUE0987" }, () => {
      const { lines, write } = capture();
      const log = createLogger("info", write);
      log.info("call", {
        message: "Authorization: Bearer sk-or-v1-SECRETVALUE0987",
        nested: { detail: ["prefix sk-or-v1-SECRETVALUE0987 suffix"] },
      });
      const rec = JSON.parse(lines[0]);
      expect(rec.message).not.toContain("sk-or-v1-SECRETVALUE0987");
      expect(rec.message).toContain("[REDACTED]");
      expect(rec.nested.detail[0]).not.toContain("sk-or-v1-SECRETVALUE0987");
    });
  });

  it("redacts an openrouter_api_key field by name", () => {
    withEnv({ OPENROUTER_API_KEY: undefined }, () => {
      const { lines, write } = capture();
      const log = createLogger("info", write);
      log.info("cfg", { openrouter_api_key: "sk-or-anything", openRouterApiKey: "sk-or-other" });
      const rec = JSON.parse(lines[0]);
      expect(rec.openrouter_api_key).toBe("[REDACTED]");
      expect(rec.openRouterApiKey).toBe("[REDACTED]");
    });
  });

  it("leaves a string untouched when a configured key does not appear in it", () => {
    withEnv({ OPENROUTER_API_KEY: "sk-or-v1-NOTINTHISLINE" }, () => {
      const { lines, write } = capture();
      createLogger("info", write).info("call", { message: "nothing sensitive here" });
      expect(JSON.parse(lines[0]).message).toBe("nothing sensitive here");
    });
  });

  it("logs normally when OPENROUTER_API_KEY is unset", () => {
    withEnv({ OPENROUTER_API_KEY: undefined }, () => {
      const { lines, write } = capture();
      createLogger("info", write).info("call", { message: "no key configured" });
      expect(JSON.parse(lines[0]).message).toBe("no key configured");
    });
  });

  it("ignores an implausibly short key value (never redacts arbitrary substrings)", () => {
    withEnv({ OPENROUTER_API_KEY: "abc" }, () => {
      const { lines, write } = capture();
      createLogger("info", write).info("call", { message: "abcdef stays readable" });
      expect(JSON.parse(lines[0]).message).toBe("abcdef stays readable");
    });
  });

  it("redacts every provider key configured at once", () => {
    withEnv(
      {
        GOOGLE_API_KEY: "AIzaGOOGLEKEY111111",
        GEMINI_API_KEY: "AIzaGEMINIKEY222222",
        OPENROUTER_API_KEY: "sk-or-KEY333333",
      },
      () => {
        const { lines, write } = capture();
        createLogger("info", write).info("call", {
          message: "AIzaGOOGLEKEY111111 / AIzaGEMINIKEY222222 / sk-or-KEY333333",
        });
        const message = JSON.parse(lines[0]).message as string;
        expect(message).toBe("[REDACTED] / [REDACTED] / [REDACTED]");
      }
    );
  });
});
