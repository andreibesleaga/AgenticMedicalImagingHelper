/**
 * Heuristic PHI / PII scan of user-supplied text context.
 *
 * **Why.** The `input/` tree is an untrusted boundary (see
 * `docs/architecture/THREAT_MODEL.md` T2/T10): `context.txt` files come from
 * PACS exports, e-mail attachments and clipboard pastes, and are injected
 * verbatim into a prompt that leaves the workstation. HIPAA §164.514(b)(2)
 * (Safe Harbor) and GDPR Art. 9 make de-identification the *operator's*
 * obligation; this scanner does not discharge it, it makes a breach of it
 * visible before the upload happens.
 *
 * **What this is not.** A regex sweep is a smoke alarm, not a de-identifier.
 * It has false positives (an accession-shaped string in a protocol note) and
 * false negatives (a bare surname, a rare identifier format, any non-English
 * layout). Treat a clean scan as "nothing obvious", never as "de-identified".
 *
 * **Privacy of the scanner itself.** Every function here is pure text-in /
 * findings-out, and a finding never carries the raw match: {@link maskMatch}
 * keeps the first character and the punctuation shape and stars out every
 * other letter and digit, and no surrounding text is captured. That is what
 * lets the CLI print findings to stderr and persist them in the run manifest
 * without the warning itself becoming a second disclosure.
 */

/** Category of a matched identifier, used for grouping and for the manifest. */
export type PhiCategory = "mrn" | "ssn" | "phone" | "email" | "dob" | "name" | "address";

export interface PhiFinding {
  category: PhiCategory;
  /** Human-readable name of the pattern that matched. */
  label: string;
  /** 1-based line number of the match within the scanned text. */
  line: number;
  /** Masked rendering of the matched text. Never the raw value. */
  excerpt: string;
}

/** Findings for one scanned file. */
export interface PhiFileFindings {
  /** Path as it should be shown to the user (caller decides absolute/relative). */
  path: string;
  findings: PhiFinding[];
}

/** Longest masked excerpt kept in a finding; longer matches are elided. */
export const MAX_EXCERPT_LENGTH = 48;

/**
 * Mask a matched identifier: keep the first character and all punctuation and
 * whitespace (so the *shape* is recognisable and a reviewer can find it in the
 * file), replace every other letter or digit with `*`.
 *
 * `"123-45-6789"` → `"1**-**-****"`, `"Patient Name: Jane Roe"` → `"P****** ****: **** ***"`.
 */
export function maskMatch(raw: string): string {
  const masked = raw
    .split("")
    .map((ch, i) => (i === 0 ? ch : /[A-Za-z0-9]/.test(ch) ? "*" : ch))
    .join("");
  return masked.length > MAX_EXCERPT_LENGTH ? `${masked.slice(0, MAX_EXCERPT_LENGTH)}…` : masked;
}

interface PhiPattern {
  category: PhiCategory;
  label: string;
  /** Must carry the `g` flag; earlier entries win an overlap. */
  regex: RegExp;
}

/**
 * Patterns in priority order. When two patterns match overlapping spans the
 * earlier one wins, so a US SSN is never also reported as a phone number, and
 * a `Patient name:` line is reported as *one* finding rather than once per
 * identifier that happens to sit on it.
 *
 * The whole-line name pattern therefore comes first: it is the broadest and
 * the highest-confidence signal, and pointing the operator at "line 1 is a
 * patient-name line" is more useful than three overlapping fragments of it.
 */
const PATTERNS: readonly PhiPattern[] = [
  {
    category: "name",
    label: "Named patient line",
    regex: /^[ \t]*(?:Patient(?:'s)?\s+Name|Name\s+of\s+Patient|Patient)\s*:[ \t]*\S.*$/gim,
  },
  {
    category: "ssn",
    label: "US Social Security Number",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    category: "email",
    label: "Email address",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: "dob",
    label: "Date of birth",
    regex:
      /\b(?:DOB|D\.O\.B\.|Date\s+of\s+Birth)\s*[:.\-]?\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/gi,
  },
  {
    category: "dob",
    label: "Date of birth (born …)",
    regex: /\bborn\b[^\n]{0,24}?(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/gi,
  },
  {
    category: "mrn",
    label: "Medical record / patient identifier",
    regex:
      /\b(?:MRN|M\.R\.N\.|Medical\s+Record(?:\s+(?:Number|No\.?|#))?|Patient\s+(?:ID|Identifier|No\.?|#))\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9-]{3,}\b/gi,
  },
  {
    category: "mrn",
    label: "Accession-style identifier",
    regex: /\b[A-Z]{2,4}\d{6,12}\b/g,
  },
  {
    category: "phone",
    label: "Telephone number",
    regex: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g,
  },
  {
    category: "address",
    label: "Street address",
    regex:
      /\b\d{1,5}\s+(?:[A-Z][A-Za-z.'-]*\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/g,
  },
  {
    category: "address",
    label: "Postal code (state + ZIP)",
    regex: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
  },
];

interface RawMatch {
  start: number;
  end: number;
  pattern: PhiPattern;
  text: string;
}

/** 1-based line number of `index` within `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Scan a block of text for identifiers that look like PHI/PII.
 *
 * Findings are returned in document order and carry only masked excerpts, so
 * the result is safe to log, print and persist. Overlapping matches are
 * collapsed to the highest-priority pattern.
 */
export function scanTextForPhi(text: string): PhiFinding[] {
  if (text.length === 0) return [];

  const matches: RawMatch[] = [];
  for (const pattern of PATTERNS) {
    // Clone so a module-level regex never carries `lastIndex` between calls.
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, pattern, text: m[0] });
      // Advance unconditionally: no pattern above can match zero-width, but a
      // future one that did would otherwise spin forever on `exec`.
      re.lastIndex = m.index + Math.max(1, m[0].length);
    }
  }

  // Priority order = PATTERNS order; within a pattern, document order.
  const accepted: RawMatch[] = [];
  for (const candidate of matches) {
    const overlaps = accepted.some((a) => candidate.start < a.end && a.start < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }

  return accepted
    .sort((a, b) => a.start - b.start)
    .map((m) => ({
      category: m.pattern.category,
      label: m.pattern.label,
      line: lineOf(text, m.start),
      excerpt: maskMatch(m.text),
    }));
}

/** Scan several already-read context files. Files with no findings are dropped. */
export function scanContextFilesForPhi(
  files: ReadonlyArray<{ path: string; text: string }>
): PhiFileFindings[] {
  const out: PhiFileFindings[] = [];
  for (const file of files) {
    const findings = scanTextForPhi(file.text);
    if (findings.length > 0) out.push({ path: file.path, findings });
  }
  return out;
}

/** Total number of findings across files. */
export function countPhiFindings(files: ReadonlyArray<PhiFileFindings>): number {
  return files.reduce((n, f) => n + f.findings.length, 0);
}

/** Categories present across all files, in a stable order. */
export function phiCategories(files: ReadonlyArray<PhiFileFindings>): PhiCategory[] {
  const seen = new Set<PhiCategory>();
  for (const f of files) for (const finding of f.findings) seen.add(finding.category);
  return PATTERNS.map((p) => p.category).filter((c, i, arr) => arr.indexOf(c) === i && seen.has(c));
}

/**
 * Render one warning line per finding, for stderr and for the run manifest's
 * `warnings[]`. Excerpts are already masked; nothing here reads the source text
 * again, so a warning can never widen the disclosure it is reporting.
 */
export function formatPhiWarnings(files: ReadonlyArray<PhiFileFindings>): string[] {
  const lines: string[] = [];
  for (const file of files) {
    for (const finding of file.findings) {
      lines.push(
        `PHI-scan: possible ${finding.label} in ${file.path}:${finding.line} — "${finding.excerpt}"`
      );
    }
  }
  return lines;
}
