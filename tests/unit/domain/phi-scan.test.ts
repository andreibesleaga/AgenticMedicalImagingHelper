/**
 * PHI/PII scanner (HIPAA §164.514(b), GDPR Art. 9).
 *
 * Two properties matter more than recall: (1) every pattern family that the
 * CLI claims to detect is actually detected, and (2) **no finding ever carries
 * the raw value** — the warning must not become a second disclosure. Every
 * assertion below that checks an excerpt also checks that the source value is
 * absent from it.
 */
import { describe, it, expect } from "@jest/globals";
import {
  MAX_EXCERPT_LENGTH,
  countPhiFindings,
  formatPhiWarnings,
  maskMatch,
  phiCategories,
  scanContextFilesForPhi,
  scanTextForPhi,
  type PhiCategory,
} from "../../../src/domain/phi-scan.js";

function categoriesOf(text: string): PhiCategory[] {
  return scanTextForPhi(text).map((f) => f.category);
}

describe("maskMatch", () => {
  it("keeps the first character and the punctuation shape, stars every other letter/digit", () => {
    expect(maskMatch("123-45-6789")).toBe("1**-**-****");
    expect(maskMatch("Jane Roe")).toBe("J*** ***");
  });

  it("never returns the raw value for a multi-character match", () => {
    const raw = "MRN: 4471902";
    const masked = maskMatch(raw);
    expect(masked).not.toBe(raw);
    expect(masked).not.toContain("4471902");
    expect(masked).toContain("*");
  });

  it("preserves a single character verbatim (nothing after it to mask)", () => {
    expect(maskMatch("X")).toBe("X");
  });

  it("elides a match longer than the excerpt cap", () => {
    const long = `A${"b".repeat(80)}`;
    const masked = maskMatch(long);
    expect(masked).toHaveLength(MAX_EXCERPT_LENGTH + 1); // + the ellipsis
    expect(masked.endsWith("…")).toBe(true);
  });

  it("does not elide a match exactly at the cap", () => {
    const exact = "A".repeat(MAX_EXCERPT_LENGTH);
    expect(maskMatch(exact).endsWith("…")).toBe(false);
    expect(maskMatch(exact)).toHaveLength(MAX_EXCERPT_LENGTH);
  });
});

describe("scanTextForPhi — pattern families", () => {
  it("returns nothing for empty text", () => {
    expect(scanTextForPhi("")).toEqual([]);
  });

  it("returns nothing for a de-identified radiology note (no false positive)", () => {
    const clean =
      "Chest radiograph, PA and lateral.\n" +
      "Mild cardiomegaly, no pleural effusion. A 12 mm nodule at 3 cm depth.\n" +
      "Comparison: prior study 3 months ago. Follow-up in 6 months.";
    expect(scanTextForPhi(clean)).toEqual([]);
  });

  it("detects a US Social Security Number", () => {
    const [finding] = scanTextForPhi("SSN 123-45-6789 on file");
    expect(finding?.category).toBe("ssn");
    expect(finding?.excerpt).toBe("1**-**-****");
  });

  it("detects an email address", () => {
    const [finding] = scanTextForPhi("contact jane.roe@example.org");
    expect(finding?.category).toBe("email");
    expect(finding?.excerpt).not.toContain("jane.roe");
  });

  it("detects a keyword-anchored medical record number", () => {
    expect(categoriesOf("MRN: 4471902")).toEqual(["mrn"]);
    expect(categoriesOf("Patient ID 88213366")).toEqual(["mrn"]);
    expect(categoriesOf("Medical Record Number: AB-99120")).toEqual(["mrn"]);
  });

  it("detects an accession-style identifier with no keyword", () => {
    const [finding] = scanTextForPhi("Accession ACC0004471902");
    expect(finding?.category).toBe("mrn");
    expect(finding?.label).toMatch(/Accession/);
  });

  it("detects a date of birth by keyword and by 'born'", () => {
    expect(categoriesOf("DOB: 04/11/1968")).toEqual(["dob"]);
    expect(categoriesOf("Date of Birth 1968-04-11")).toEqual(["dob"]);
    expect(categoriesOf("He was born on 1968-04-11 in Ohio.")).toEqual(["dob"]);
  });

  it("detects a telephone number in several layouts", () => {
    expect(categoriesOf("call (415) 555-0134")).toEqual(["phone"]);
    expect(categoriesOf("tel 415.555.0134")).toEqual(["phone"]);
    expect(categoriesOf("+1 415 555 0134")).toEqual(["phone"]);
  });

  it("detects a named-patient line", () => {
    const [finding] = scanTextForPhi("Patient Name: Jane A. Roe\nHistory: cough");
    expect(finding?.category).toBe("name");
    expect(finding?.excerpt).not.toContain("Jane");
  });

  it("detects a street address and a state + ZIP", () => {
    const found = categoriesOf("1600 Pennsylvania Avenue, Washington DC 20500");
    expect(found).toEqual(["address", "address"]);
  });
});

describe("scanTextForPhi — ordering, overlap and line numbers", () => {
  const multiline =
    "Patient Name: Jane A. Roe\n" + // line 1
    "MRN: 4471902\n" + // line 2
    "SSN 123-45-6789\n" + // line 3
    "\n" +
    "Reachable at jane.roe@example.org\n"; // line 5

  it("reports findings in document order with 1-based line numbers", () => {
    const findings = scanTextForPhi(multiline);
    expect(findings.map((f) => f.line)).toEqual([1, 2, 3, 5]);
    expect(findings.map((f) => f.category)).toEqual(["name", "mrn", "ssn", "email"]);
  });

  it("reports an overlapping span once, under the higher-priority pattern", () => {
    // "123-45-6789" is an SSN; it must not also be offered as anything else.
    const findings = scanTextForPhi("123-45-6789");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("ssn");
  });

  it("collapses identifiers nested in a patient-name line into that one finding", () => {
    // The whole-line name pattern outranks the MRN sitting inside it: the
    // operator is told "line 1 is a patient-name line", not given fragments.
    const findings = scanTextForPhi("Patient Name: Jane A. Roe (MRN 4471902)");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("name");
    expect(JSON.stringify(findings)).not.toContain("4471902");
    expect(JSON.stringify(findings)).not.toContain("Jane");
  });

  it("keeps two adjacent, non-overlapping matches", () => {
    const findings = scanTextForPhi("123-45-6789 and 987-65-4321");
    expect(findings).toHaveLength(2);
  });

  it("never leaks the raw text of any match into a finding", () => {
    const findings = scanTextForPhi(multiline);
    const serialized = JSON.stringify(findings);
    for (const secret of ["Jane", "4471902", "6789", "jane.roe"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("scanContextFilesForPhi and its summaries", () => {
  const files = [
    { path: "series_1/context.txt", text: "MRN: 4471902" },
    { path: "series_2/context.txt", text: "No identifiers here." },
    { path: "study.txt", text: "SSN 123-45-6789\ncall (415) 555-0134" },
  ];

  it("drops files with no findings", () => {
    const result = scanContextFilesForPhi(files);
    expect(result.map((r) => r.path)).toEqual(["series_1/context.txt", "study.txt"]);
  });

  it("counts findings across files", () => {
    expect(countPhiFindings(scanContextFilesForPhi(files))).toBe(3);
    expect(countPhiFindings([])).toBe(0);
  });

  it("lists the distinct categories present, deduplicated and in pattern order", () => {
    expect(phiCategories(scanContextFilesForPhi(files))).toEqual(["ssn", "mrn", "phone"]);
    expect(
      phiCategories(scanContextFilesForPhi([{ path: "a.txt", text: "Patient Name: J R" }]))
    ).toEqual(["name"]);
  });

  it("lists no categories when nothing was found", () => {
    expect(phiCategories(scanContextFilesForPhi([{ path: "a.txt", text: "clean" }]))).toEqual([]);
  });

  it("formats one masked warning line per finding, naming file and line", () => {
    const lines = formatPhiWarnings(scanContextFilesForPhi(files));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/series_1\/context\.txt:1/);
    expect(lines.join("\n")).not.toContain("4471902");
    expect(lines.join("\n")).not.toContain("6789");
  });

  it("formats nothing when there are no findings", () => {
    expect(formatPhiWarnings([])).toEqual([]);
  });
});
