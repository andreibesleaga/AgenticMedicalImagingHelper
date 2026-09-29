/**
 * Output handling (OWASP LLM05): model text is neutralised before it is
 * embedded in a Markdown report.
 */
import { describe, it, expect } from "@jest/globals";

import { sanitizeModelMarkdown } from "../../../src/infrastructure/report-writer.js";

describe("sanitizeModelMarkdown", () => {
  it("escapes raw HTML tags, including script and event-handler payloads", () => {
    expect(sanitizeModelMarkdown("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
    expect(sanitizeModelMarkdown('Look <img src=x onerror="steal()"> here')).toBe(
      'Look &lt;img src=x onerror="steal()"&gt; here'
    );
    expect(sanitizeModelMarkdown("<!-- hidden -->")).toBe("&lt;!-- hidden --&gt;");
  });

  it("rewrites unsafe link targets and keeps http(s) links", () => {
    expect(sanitizeModelMarkdown("[click](javascript:alert(1))")).toBe(
      "[click](#unsafe-link-removed)"
    );
    expect(sanitizeModelMarkdown("[x]( data:text/html;base64,AAAA)")).toBe(
      "[x](#unsafe-link-removed)"
    );
    expect(sanitizeModelMarkdown("[ref](https://pubmed.ncbi.nlm.nih.gov/1)")).toBe(
      "[ref](https://pubmed.ncbi.nlm.nih.gov/1)"
    );
  });

  it("drops control characters but keeps tabs and newlines", () => {
    expect(sanitizeModelMarkdown("a\u0000b\u0007c\td\ne\u007f")).toBe("abc\td\ne");
  });

  it("leaves ordinary Markdown and comparison signs untouched", () => {
    const md = "## Findings\n- **Effusion**: small\n- size < 1 cm and > 5 mm\n1. item";
    expect(sanitizeModelMarkdown(md)).toBe(md);
  });

  it("leaves fenced code as written, and is idempotent", () => {
    const md = "```\n<b>literal</b>\n```\n<b>bold</b>";
    const once = sanitizeModelMarkdown(md);
    expect(once).toBe("```\n<b>literal</b>\n```\n&lt;b&gt;bold&lt;/b&gt;");
    expect(sanitizeModelMarkdown(once)).toBe(once);
  });

  it("tolerates undefined-like input", () => {
    expect(sanitizeModelMarkdown(undefined as unknown as string)).toBe("");
  });
});
