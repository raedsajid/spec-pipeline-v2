import { z } from "zod";
export const VERSION = "builderp-v1";
export type Evidence = {
  id: string;
  page: number;
  text: string;
  box: number[] | null;
  section: string;
  clause: string;
  source: "pdf" | "ocr";
  fontSize?: number;
  bold?: boolean;
  part?: string;
  article?: string;
  articleTitle?: string;
  context?: string;
  structuralWarning?: string;
};
export type ParsedDocument = {
  version: string;
  structureVersion?: string;
  pages: number;
  evidence: Evidence[];
  scannedPages: number[];
  sections: string[];
};
export const RequirementSchema = z.object({
  title: z.string().min(1).max(240),
  text: z.string().min(1).max(6000),
  type: z.enum([
    "product_data",
    "shop_drawings",
    "sample",
    "certification",
    "test_report",
    "quality_control",
    "operation_and_maintenance",
    "closeout",
    "warranty",
    "other",
  ]),
  // Gemini may represent an absent condition as null or omit it entirely.
  // Normalize only absence; unexpected types and overlong text remain invalid.
  condition: z
    .string()
    .max(1500)
    .nullish()
    .transform((value) => value ?? ""),
  evidenceIds: z.array(z.string()).min(1).max(30),
  quote: z.string().min(1).max(6000),
  products: z.array(z.string().max(200)).max(60).default([]),
});
export type RequirementInput = z.infer<typeof RequirementSchema>;
export type Requirement = RequirementInput & {
  id: string;
  section: string;
  clause: string;
  page: number;
  warnings: string[];
  blocking: string[];
  sourceOrder?: number;
  parentId?: string;
  productMode?: "combined" | "individual";
  productIds?: string[];
  docId?: string;
  filename?: string;
  status: string;
  reviewNote?: string;
  revision?: number;
};
export type User = { id: string; username: string; role: string };
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export function normalize(s: string) {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
// Evidence is stored per PDF line, so a quote may span a wrap such as
// "Y-" / "type strainer". Compare without whitespace or hyphenation.
export function sourceKey(s: string) {
  return normalize(s).replace(/[\s\u00ad\u2010\u2011\u2012\u2013-]+/g, "");
}
export function sourceIncludes(source: string, quote: string) {
  const q = sourceKey(quote);
  return !!q && sourceKey(source).includes(q);
}
export function validateRequirement(
  r: RequirementInput,
  evidence: Evidence[],
): { warnings: string[]; blocking: string[] } {
  const known = new Map(evidence.map((e) => [e.id, e]));
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!r.evidenceIds.length || r.evidenceIds.some((id) => !known.has(id)))
    blocking.push("Select valid source evidence for this requirement.");
  const source = r.evidenceIds.map((id) => known.get(id)?.text || "").join(" ");
  if (!sourceIncludes(source, r.quote) || normalize(r.quote).length < 8)
    blocking.push("The evidence quote must match the selected source text.");
  if (r.evidenceIds.some((id) => known.get(id)?.source === "ocr"))
    warnings.push("OCR text: compare this requirement with the original page.");
  if (r.condition && !sourceIncludes(source, r.condition))
    warnings.push("Confirm the condition against the original wording.");
  for (const product of r.products) {
    if (!sourceIncludes(source, product))
      warnings.push("Product selection needs source verification: " + product);
  }
  return { warnings, blocking };
}
export function mayApprove(r: Requirement, confirmed: boolean, note: string) {
  return (
    confirmed &&
    !r.blocking.length &&
    (!r.warnings.length || note.trim().length >= 8)
  );
}
export function buildBatches(evidence: Evidence[], budget = 14000) {
  const batches: Evidence[][] = [];
  let b: Evidence[] = [],
    n = 0;
  for (const e of evidence) {
    const cost = e.text.length + 100;
    if (n + cost > budget && b.length) {
      batches.push(b);
      b = [];
      n = 0;
    }
    b.push(e);
    n += cost;
  }
  if (b.length) batches.push(b);
  return batches;
}
