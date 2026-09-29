import { assessProduct } from "./product-classification";
import { z } from "zod";
import { AppError, RequirementSchema, normalize } from "./models";
import type { Evidence, Requirement } from "./models";
export const ProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z
    .string()
    .max(4000)
    .nullish()
    .transform((v) => v ?? ""),
  group: z.string().max(240).nullish().transform(v => v || "Unresolved"),
  entityType: z.enum(["product","material","manufacturer","model","standard","performance_property","unclear"]).optional(),
  usageStatus: z.enum(["required","permitted","conditional","prohibited","unclear"]).optional(),
  condition: z.string().max(6000).nullish().transform(v => v || ""),
  clause: z
    .string()
    .max(100)
    .nullish()
    .transform((v) => v ?? ""),
  evidenceIds: z.array(z.string()).min(1).max(30),
  quote: z.string().min(8).max(6000),
});
export type Product = z.infer<typeof ProductSchema> & {
  id: string;
  page: number;
  section: string;
  docId?: string;
  selectable?: boolean;
  classificationReason?: string;
};
// Validate optional catalog entries independently from mandatory submittal rows.
// A short quote can be expanded only from its own verified source block.
const ProductCandidateSchema = ProductSchema.extend({
  quote: z
    .string()
    .max(6000)
    .nullish()
    .transform((v) => v ?? ""),
});
export function parseExtraction(value: unknown, evidence: Evidence[]) {
  const envelope = z
    .object({
      requirements: z.array(RequirementSchema).max(100),
      products: z.array(z.unknown()).max(150),
    })
    .safeParse(value);
  if (!envelope.success) {
    const fields = envelope.error.issues
      .map((i) => i.path.join("."))
      .slice(0, 3);
    throw new AppError(
      502,
      `Gemini returned invalid extraction data (${fields.join(", ")}). Progress is saved; retry generation.`,
      "invalid_extraction",
    );
  }
  const products: z.infer<typeof ProductSchema>[] = [];
  let omittedProducts = 0;
  for (const input of envelope.data.products) {
    const candidate = ProductCandidateSchema.safeParse(input);
    if (!candidate.success) {
      omittedProducts++;
      continue;
    }
    const p = candidate.data;
    const source = p.evidenceIds.map((id) => evidence.find((e) => e.id === id));
    if (source.some((e) => !e)) {
      omittedProducts++;
      continue;
    }
    if (normalize(p.quote).length < 8) {
      const block = source.find(
        (e) =>
          normalize(e!.text).length >= 8 &&
          e!.text.length <= 6000 &&
          normalize(e!.text).includes(normalize(p.name)) &&
          (!normalize(p.quote) ||
            normalize(e!.text).includes(normalize(p.quote))),
      );
      if (!block) {
        omittedProducts++;
        continue;
      }
      p.quote = block.text;
      p.evidenceIds = [block.id];
    }
    const parsed = ProductSchema.safeParse(p);
    if (
      !parsed.success ||
      !normalize(source.map((e) => e!.text).join(" ")).includes(
        normalize(p.quote),
      )
    ) {
      omittedProducts++;
      continue;
    }
    const blocks = p.evidenceIds.map(id => evidence.find(e=>e.id===id)!);
    const classified = assessProduct({...parsed.data,entityType:parsed.data.entityType || "unclear",usageStatus:parsed.data.usageStatus || "unclear"}, blocks);
    products.push({...parsed.data, ...classified});
  }
  return {
    requirements: envelope.data.requirements,
    products,
    omittedProducts,
  };
}
// A checklist is excluded by its heading, not simply by being on the last pages.
// A new numbered specification section ends the exclusion.
export function extractionEvidence(evidence: Evidence[]) {
  let checklist = false;
  let currentSection = "";
  return evidence.filter((e) => {
    const section = e.text
      .match(/^\s*SECTION\s+(\d[\d ]{3,10})/i)?.[1]
      ?.replace(/\s/g, "");
    if (section && section !== currentSection) {
      checklist = false;
      currentSection = section;
    }
    const heading = e.text
      .replace(/^\s*(?:\d+(?:\.\d+)*|[A-Z])[.)]?\s+/, "")
      .trim();
    if (
      /^(?:submittals?\s+(?:check\s*list|schedule|register)|check\s*list\s+(?:of\s+|for\s+)?submittals|list\s+of\s+submittals)\s*[:–—-]?$/i.test(
        heading,
      )
    )
      checklist = true;
    return !checklist;
  });
}

export function sameRequirement(a: Requirement, b: Requirement) {
  return (
    a.type === b.type &&
    (normalize(a.text) === normalize(b.text) ||
      normalize(a.quote) === normalize(b.quote))
  );
}
export function productDraft(
  parent: Requirement,
  products: Product[],
  mode: "combined" | "individual" = "individual",
): Requirement {
  const names = products.map((p) => p.name);
  return {
    ...parent,
    id: "preview",
    title: mode === "combined" ? parent.title : `${parent.title} - ${names.join(" + ")}`.slice(0, 240),
    productMode: mode,
    text: parent.text,
    products: names,
    status: "needs_review",
    revision: 0,
    reviewNote: "",
    parentId: parent.id,
    productIds: products.map((p) => p.id),
    warnings: [
      ...parent.warnings,
      "Verify that the selected products are covered by this submittal requirement.",
    ],
  };
}

// Stable source order, with derived rows immediately following their parent.
export function sortSubmittals(rows: Requirement[], mode = "source") {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const natural = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const anchor = (r: Requirement): Requirement => {
    const seen = new Set<string>();
    while (r.parentId && byId.has(r.parentId) && !seen.has(r.id)) {
      seen.add(r.id);
      r = byId.get(r.parentId)!;
    }
    return r;
  };
  return [...rows].sort((a, b) => {
    const selected =
      mode === "title"
        ? natural(a.title, b.title)
        : mode === "status"
          ? natural(a.status, b.status)
          : 0;
    if (selected) return selected;
    const x = anchor(a),
      y = anchor(b);
    if (x.id !== y.id)
      return (
        natural(x.filename || x.section, y.filename || y.section) ||
        natural(x.docId || "", y.docId || "") ||
        x.page - y.page ||
        (x.sourceOrder ?? Number.MAX_SAFE_INTEGER) -
          (y.sourceOrder ?? Number.MAX_SAFE_INTEGER) ||
        natural(x.clause, y.clause) ||
        natural(x.title, y.title) ||
        natural(x.id, y.id)
      );
    if (a.id === x.id && b.id !== x.id) return -1;
    if (b.id === x.id && a.id !== x.id) return 1;
    return natural(a.title, b.title) || natural(a.id, b.id);
  });
}

// Repair only recognizable generated combined titles, preserving custom edits.
export function normalizeCombinedTitles(rows: Requirement[]) {
  const byId = new Map(rows.map(r => [r.id, r]));
  return rows.map(r => {
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (!parent || r.productMode === "individual" || r.products.length < 2) return r;
    const names = r.products.join(" + ");
    const generated = r.title === `${parent.title} - ${names}`.slice(0,240) || r.title === names.slice(0,240);
    return generated ? {...r, title: parent.title, productMode: "combined" as const} : r;
  });
}

export function groupSubmittals(rows: Requirement[]) {
  const groups = new Map<string, {key:string; section:string; filename:string; rows:Requirement[]}>();
  for (const row of rows) {
    const key = JSON.stringify([row.docId || row.filename || "", row.section]);
    if (!groups.has(key)) groups.set(key, {key, section:row.section, filename:row.filename || "", rows:[]});
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a,b)=>a.section.localeCompare(b.section, undefined, {numeric:true}) || a.filename.localeCompare(b.filename,undefined,{numeric:true}));
}
