/**
 * Input guard: checks that run before anything is sent to a model provider.
 *
 * Three pure, deterministic checks (no I/O here; the caller reads the bytes):
 *
 * 1. {@link sniffImageType} — what a file really is, from its first bytes, so a
 *    renamed file (a DICOM, a PDF, an executable) cannot pass as a `.png`.
 * 2. {@link findImageMetadata} — text and metadata chunks embedded in a PNG or
 *    JPEG (PNG `tEXt`/`zTXt`/`iTXt`/`eXIf`/`tIME`, JPEG EXIF/XMP/comment/IPTC).
 *    They can carry patient identifiers or instruction-like text, and the
 *    pass-through path would otherwise send them to the provider untouched.
 *    The image pre-flight re-encodes any file that has them, which drops them.
 * 3. {@link scanTextForInjection} — instruction-like phrases in operator-supplied
 *    context text ("ignore previous instructions", "you are now", role tags,
 *    requests to reveal the prompt). Context is already delimited and capped;
 *    this adds detection, recorded in the manifest, and a refusal under `--secure`.
 *
 * OWASP Top 10 for LLM Applications 2025: LLM01 (prompt injection) and LLM02
 * (sensitive information disclosure). Heuristics: a clean result means "nothing
 * obvious", never "safe".
 */

export type SniffedType = "png" | "jpeg" | "dicom" | "unknown";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify a file from its leading bytes (at least 132 bytes for DICOM). */
export function sniffImageType(head: Uint8Array): SniffedType {
  if (head.length >= 8 && PNG_SIGNATURE.every((b, i) => head[i] === b)) return "png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (
    head.length >= 132 &&
    head[128] === 0x44 &&
    head[129] === 0x49 &&
    head[130] === 0x43 &&
    head[131] === 0x4d
  ) {
    return "dicom";
  }
  return "unknown";
}

/** The type an extension promises, or undefined for anything else. */
export function typeForExtension(ext: string): "png" | "jpeg" | undefined {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "png") return "png";
  if (e === "jpg" || e === "jpeg") return "jpeg";
  return undefined;
}

/** PNG ancillary chunks that carry text or metadata rather than pixels. */
export const PNG_METADATA_CHUNKS = ["tEXt", "zTXt", "iTXt", "eXIf", "tIME"] as const;

/**
 * Names of metadata blocks found in a PNG or JPEG file. Empty for a clean file
 * or an unrecognised format. Walks the container structure; never decodes pixels.
 */
export function findImageMetadata(bytes: Uint8Array): string[] {
  const type = sniffImageType(bytes);
  if (type === "png") return pngMetadata(bytes);
  if (type === "jpeg") return jpegMetadata(bytes);
  return [];
}

function u32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
}

function pngMetadata(b: Uint8Array): string[] {
  const found = new Set<string>();
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if ((PNG_METADATA_CHUNKS as readonly string[]).includes(type)) found.add(`png:${type}`);
    if (type === "IEND") break;
    const next = i + 12 + len;
    if (next <= i) break; // malformed length; stop rather than loop
    i = next;
  }
  return [...found];
}

function jpegMetadata(b: Uint8Array): string[] {
  const found = new Set<string>();
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    // Standalone markers without a length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = (b[i + 2]! << 8) + b[i + 3]!;
    const payload = b.subarray(i + 4, Math.min(b.length, i + 2 + len));
    const tag = String.fromCharCode(...payload.subarray(0, 4));
    if (marker === 0xe1 && tag === "Exif") found.add("jpeg:EXIF");
    else if (marker === 0xe1) found.add("jpeg:XMP");
    else if (marker === 0xed) found.add("jpeg:IPTC");
    else if (marker === 0xfe) found.add("jpeg:COM");
    if (len < 2) break;
    i += 2 + len;
  }
  return [...found];
}

export interface InjectionHit {
  /** Which pattern family matched. */
  readonly kind:
    | "override-instructions"
    | "role-reassignment"
    | "prompt-exfiltration"
    | "role-tag"
    | "output-manipulation"
    | "tool-or-link";
  /** The matched text, at most 80 characters. */
  readonly match: string;
}

const INJECTION_PATTERNS: ReadonlyArray<{ kind: InjectionHit["kind"]; re: RegExp }> = [
  {
    kind: "override-instructions",
    re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|system|these|your)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules|guidelines|directions)\b/i,
  },
  {
    kind: "override-instructions",
    re: /\b(?:new|updated|real)\s+instructions?\s*:/i,
  },
  {
    kind: "role-reassignment",
    re: /\b(?:you are now|from now on,? you|act as (?:an?|the)|pretend (?:to be|you are)|roleplay as|you must now)\b/i,
  },
  {
    kind: "prompt-exfiltration",
    re: /\b(?:reveal|print|show|repeat|output|leak)\b[^.\n]{0,30}\b(?:system prompt|your prompt|your instructions|hidden instructions|api key|secret)\b/i,
  },
  {
    kind: "role-tag",
    re: /<\|?\s*(?:system|assistant|im_start|im_end|endoftext)\s*\|?>|^\s*(?:system|assistant)\s*:|\[\/?INST\]|<<\/?SYS>>/im,
  },
  {
    kind: "output-manipulation",
    re: /\b(?:always|must)\s+(?:say|answer|report|conclude|state)\b[^.\n]{0,40}\b(?:normal|no findings|healthy|malignant|cancer|improving|worsening)\b/i,
  },
  {
    kind: "output-manipulation",
    re: /\b(?:do not|don't|never)\s+(?:mention|report|include|flag)\b[^.\n]{0,40}\b(?:finding|abnormalit|disclaimer|review|warning)/i,
  },
  {
    kind: "tool-or-link",
    re: /\b(?:https?:\/\/|www\.)\S+|\b(?:curl|wget|fetch|browse|visit)\s+(?:https?:|the url|this link)/i,
  },
];

/**
 * Instruction-like phrases in operator-supplied text. Empty when nothing is
 * found. Each pattern family is reported at most once, with its first match.
 */
export function scanTextForInjection(text: string): InjectionHit[] {
  const hits: InjectionHit[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of INJECTION_PATTERNS) {
    const m = re.exec(text ?? "");
    if (!m) continue;
    const key = `${kind}:${m[0].toLowerCase()}`;
    if (seen.has(kind) || seen.has(key)) continue;
    seen.add(kind);
    hits.push({ kind, match: m[0].replace(/\s+/g, " ").slice(0, 80) });
  }
  return hits;
}

/** Warning lines for the manifest; empty when nothing is found. */
export function injectionWarnings(files: ReadonlyArray<{ path: string; text: string }>): string[] {
  const lines: string[] = [];
  let total = 0;
  for (const f of files) {
    for (const h of scanTextForInjection(f.text)) {
      total++;
      lines.push(`input-guard [${h.kind}] ${f.path}: "${h.match}"`);
    }
  }
  if (total === 0) return [];
  return [
    `input-guard: ${total} instruction-like phrase(s) in context file(s). Context is delimited ` +
      `and treated as data, but review it; --secure refuses such input.`,
    ...lines,
  ];
}
