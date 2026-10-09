import { assessProduct } from "./product-classification";
import { z } from "zod";
import { AppError, RequirementSchema, normalize, sourceIncludes } from "./models";
import type { Evidence, Requirement } from "./models";

export const SUBMITTAL_EXTRACTION_VERSION = 6;
export const SUBMITTAL_LOG_VERSION = 6;
export const SUBMITTAL_CACHE_PREFIX = `cache/submittals-v${SUBMITTAL_EXTRACTION_VERSION}`;

export type ExtractionRole = "submittal" | "product" | "other";
export type TaggedEvidence = Evidence & { role: ExtractionRole };

const SUBMITTAL_ARTICLE_RE =
  /^(?:supplemental\s+)?(?:action|informational|quality\s+control|closeout)?\s*submittals?\s*$|^(?:operation\s+and\s+)?maintenance\s+data$|^quality\s+control\s+submittals?$/i;
const PRODUCT_ARTICLE_RE =
  /\b(?:products?|materials?|systems?|equipment|fabrication|fabricated|manufacturers?|assembl(?:y|ies))\b/i;

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
  catalogRole: z.enum(["standalone_item","constituent_material","attribute","integral_component","generic_reference","unclear"]).optional(),
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
  aliases?: ProductAlias[];
  mergedInto?: string;
};
export type ProductAlias = {
  id: string;
  name: string;
  page: number;
  clause: string;
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
      const blocks = quoteWindows(source as Evidence[], evidence).find(
        (w) => {
          const text = w.map((e) => e.text).join(" ");
          return (
            normalize(text).length >= 8 &&
            text.length <= 6000 &&
            sourceIncludes(text, p.name) &&
            (!normalize(p.quote) || sourceIncludes(text, p.quote))
          );
        },
      );
      if (!blocks) {
        omittedProducts++;
        continue;
      }
      p.quote = blocks.map((e) => e.text).join(" ");
      p.evidenceIds = blocks.map((e) => e.id);
    }
    const parsed = ProductSchema.safeParse(p);
    if (
      !parsed.success ||
      !sourceIncludes(source.map((e) => e!.text).join(" "), p.quote)
    ) {
      omittedProducts++;
      continue;
    }
    const blocks = p.evidenceIds.map(id => evidence.find(e=>e.id===id)!);
    const classified = assessProduct(parsed.data, blocks);
    products.push({...parsed.data, ...classified});
  }
  return {
    requirements: envelope.data.requirements,
    products,
    omittedProducts,
  };
}
// Runs of up to three cited blocks that are adjacent in reading order,
// shortest first, so a name wrapped across lines can still be recovered.
function quoteWindows(cited: Evidence[], evidence: Evidence[]) {
  const position = new Map(evidence.map((e, i) => [e.id, i]));
  const ordered = [...new Set(cited)].sort(
    (a, b) => position.get(a.id)! - position.get(b.id)!,
  );
  const windows: Evidence[][] = [];
  for (let size = 1; size <= 3; size++)
    for (let i = 0; i + size <= ordered.length; i++) {
      const run = ordered.slice(i, i + size);
      if (
        run.every(
          (e, j) =>
            !j || position.get(e.id)! === position.get(run[j - 1].id)! + 1,
        )
      )
        windows.push(run);
    }
  return windows;
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
      /^(?:submittals?\s+(?:check\s*list|schedule|register|log|index)|check\s*list\s+(?:of\s+|for\s+)?submittals|list\s+of\s+submittals)\s*[:–—-]?$/i.test(
        heading,
      )
    )
      checklist = true;
    return !checklist;
  });
}

function stripHeadingPrefix(text: string) {
  return text.replace(/^\s*(?:\d+(?:\.\d+)*|[A-Z])[.)]?\s+/, "").trim();
}

function isSubmittalArticleHeading(e: Evidence) {
  const title = (e.articleTitle || "").trim();
  if (title && SUBMITTAL_ARTICLE_RE.test(title)) return true;
  const heading = stripHeadingPrefix(e.text);
  return SUBMITTAL_ARTICLE_RE.test(heading);
}

function isProductCatalogEvidence(e: Evidence) {
  if (e.part === "2") return true;
  const title = (e.articleTitle || "").trim();
  if (title && PRODUCT_ARTICLE_RE.test(title)) return true;
  if (/^PART\s+2\b/i.test(e.text.trim())) return true;
  return PRODUCT_ARTICLE_RE.test(stripHeadingPrefix(e.text));
}

function isPartBoundary(e: Evidence) {
  return /^PART\s+\d+\b/i.test(e.text.trim());
}

function isSectionBoundary(e: Evidence) {
  return /^\s*SECTION\s+\d/i.test(e.text.trim());
}

export type TaggedExtraction = {
  tagged: TaggedEvidence[];
  /** True when at least one Submittals-like article was detected. */
  hasSubmittalRegion: boolean;
};

/** Tag checklist-eligible lines as submittal / product / other for obligation-first extraction. */
export function tagExtractionEvidence(evidence: Evidence[]): TaggedExtraction {
  const eligible = extractionEvidence(evidence);
  const submittalIds = new Set<string>();
  let activeArticle: string | undefined;
  let inSubmittal = false;

  for (const e of eligible) {
    if (isSectionBoundary(e) || isPartBoundary(e)) {
      inSubmittal = false;
      activeArticle = undefined;
    }
    if (isSubmittalArticleHeading(e)) {
      inSubmittal = true;
      activeArticle = e.article || undefined;
      submittalIds.add(e.id);
      continue;
    }
    if (inSubmittal) {
      if (
        activeArticle &&
        e.article &&
        e.article !== activeArticle &&
        !e.article.startsWith(activeArticle + ".")
      ) {
        // New numbered article ends the submittal region unless it is itself a submittal heading.
        if (isSubmittalArticleHeading(e)) {
          activeArticle = e.article;
          submittalIds.add(e.id);
          continue;
        }
        inSubmittal = false;
        activeArticle = undefined;
      } else {
        submittalIds.add(e.id);
      }
    }
  }

  const hasSubmittalRegion = submittalIds.size > 0;
  const tagged = eligible.map((e) => {
    if (hasSubmittalRegion && submittalIds.has(e.id))
      return { ...e, role: "submittal" as const };
    if (isProductCatalogEvidence(e))
      return { ...e, role: "product" as const };
    // Fallback: no Submittals article — every eligible line may ground a requirement.
    if (!hasSubmittalRegion) return { ...e, role: "submittal" as const };
    return { ...e, role: "other" as const };
  });
  return { tagged, hasSubmittalRegion };
}

/** IDs allowed to ground requirements (submittal role, or all eligible when falling back). */
export function submittalEvidenceIds(result: TaggedExtraction) {
  if (!result.hasSubmittalRegion)
    return new Set(result.tagged.map((e) => e.id));
  return new Set(
    result.tagged.filter((e) => e.role === "submittal").map((e) => e.id),
  );
}

/** Drop requirements that cite no allowed submittal evidence when a region exists. */
export function filterRequirementsBySubmittalEvidence<
  T extends { evidenceIds: string[] },
>(requirements: T[], submittalIds: Set<string>): T[] {
  if (!submittalIds.size) return requirements;
  return requirements.filter((r) =>
    r.evidenceIds.some((id) => submittalIds.has(id)),
  );
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
