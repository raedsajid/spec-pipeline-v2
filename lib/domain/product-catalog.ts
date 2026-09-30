import { assessProduct } from "./product-classification";
import { normalize } from "./models";
import type { Evidence } from "./models";
import type { Product } from "./submittals";

const stopWords = new Set([
  "a", "an", "and", "all", "each", "for", "in", "of", "or", "the", "to", "type", "with",
]);
const singular = (w: string) =>
  w.length >= 4 && /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w;
const terms = (name: string) =>
  normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))
    .map(singular);
const alternatives = (name: string) =>
  name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+or\s+|\s+\/\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
// The last significant word of each alternative names what the item is.
const heads = (name: string) =>
  new Set(alternatives(name).map((a) => terms(a).at(-1)).filter(Boolean) as string[]);

/**
 * Relatedness of a scope phrase to a detailed item. Both must name the same
 * kind of item (shared head noun) and share at least one qualifier, so
 * "safety relief valves" matches "Water Relief Valves" but not
 * "temperature regulating valve".
 */
export function familyScore(scope: string, detail: string) {
  const sharedHeads = [...heads(scope)].filter((h) => heads(detail).has(h));
  if (!sharedHeads.length) return 0;
  const detailTerms = new Set(terms(detail));
  const shared = [...new Set(terms(scope))].filter((t) => detailTerms.has(t));
  return shared.length > sharedHeads.length ? shared.length : 0;
}

/** "Boiler Blowdown Separators or Tanks:" -> "Boiler Blowdown Separator / Tank" */
export function canonicalName(label: string) {
  return alternatives(label.replace(/[:.]\s*$/, ""))
    .map((alt) => {
      const words = alt.split(/\s+/);
      words[words.length - 1] = singular(words[words.length - 1]);
      return words.join(" ");
    })
    .join(" / ");
}

const headingPattern = /^(?:[A-Z]|\d{1,2})[.)]\s+(.{3,80}?)\s*:\s*$/;
const nonItemHeading =
  /^(?:provide|furnish|install|submit)\b|\b(?:not used|not applicable|n\/a|manufacturers?|general|requirements?|description|performance|quality|execution|following)\b/i;

function equipmentHeadings(evidence: Evidence[]) {
  return evidence.flatMap((e) => {
    const label = e.part === "2" ? e.text.trim().match(headingPattern)?.[1] : undefined;
    return label && !/[.;]/.test(label) && label.split(/\s+/).length <= 8 && !nonItemHeading.test(label)
      ? [{ e, label }]
      : [];
  });
}

const within = (clause: string, owner: string) =>
  !!owner && (clause === owner || clause.startsWith(owner + "."));

/**
 * Consolidate a validated catalog. Part 1 scope phrases (for example
 * "steam boiler blowdown separators" in DESCRIPTION OF WORK) are folded into
 * the specific Part 2 product they summarize and kept as aliases. When the
 * model returned only the scope phrase, the Part 2 equipment heading becomes
 * the catalog product. Folded candidates stay in `excluded` so existing links
 * remain resolvable.
 */
export function consolidateCatalog(
  products: Product[],
  excluded: Product[],
  evidence: Evidence[],
  idFor: (heading: Evidence) => string,
) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const position = new Map(evidence.map((e, i) => [e.id, i]));
  const blocks = (p: Product) =>
    p.evidenceIds.map((id) => byId.get(id)).filter(Boolean) as Evidence[];
  const isScope = (p: Product) => {
    const b = blocks(p);
    return b.length > 0 && b.every((e) => e.part === "1");
  };
  const detailed = products.filter((p) => !isScope(p)).map((p) => ({ ...p }));
  const scope = products.filter(isScope);
  const headings = equipmentHeadings(evidence);
  const synthesized: Product[] = [];
  const merged: Product[] = [];
  const fold = (from: Product, into: Product[]) => {
    for (const target of into)
      target.aliases = [
        ...(target.aliases || []),
        { id: from.id, name: from.name, page: from.page, clause: from.clause },
        ...(from.aliases || []),
      ];
    const names = into.map((t) => t.name).join(", ");
    merged.push({
      ...from,
      selectable: false,
      mergedInto: names,
      classificationReason: `Merged into ${names}, the item specified in the product article.`,
    });
  };

  for (const s of scope) {
    let targets = [...detailed, ...synthesized].filter((p) => familyScore(s.name, p.name));
    if (!targets.length) {
      const best = headings
        .map((h) => ({ ...h, score: familyScore(s.name, h.label) }))
        .filter((h) => h.score)
        .sort((a, b) => b.score - a.score)[0];
      const product = best && fromHeading(best.e, best.label, s);
      if (product) {
        synthesized.push(product);
        targets = [product];
      }
    }
    if (targets.length) fold(s, targets);
  }

  // A detailed candidate for the same item under a synthesized heading
  // (e.g. "Tank" under "Boiler Blowdown Separators or Tanks") is folded too.
  for (const host of synthesized)
    for (const d of [...detailed]) {
      const own = heads(d.name);
      if (
        own.size &&
        [...own].every((h) => heads(host.name).has(h)) &&
        blocks(d).some((e) => within(e.clause, host.clause))
      ) {
        detailed.splice(detailed.indexOf(d), 1);
        fold(d, [host]);
      }
    }

  function fromHeading(heading: Evidence, label: string, scopeItem: Product): Product | undefined {
    const name = canonicalName(label);
    const assessment = assessProduct(
      {
        name,
        quote: heading.text,
        entityType: "product",
        usageStatus: scopeItem.usageStatus || "required",
        catalogRole: "standalone_item",
        condition: scopeItem.condition,
      },
      [heading],
    );
    if (!assessment.selectable) return undefined;
    const start = position.get(heading.id)!;
    let description = "";
    for (const e of evidence.slice(start + 1)) {
      if (!within(e.clause, heading.clause) || description.length >= 240) break;
      description = (description + " " + e.text).trim();
    }
    return {
      name,
      description: description.length > 240 ? description.slice(0, 240).trimEnd() + "…" : description,
      group: heading.article
        ? `${heading.article} ${heading.articleTitle || ""}`.trim()
        : "Unresolved source group",
      clause: heading.clause,
      evidenceIds: [heading.id],
      quote: heading.text,
      ...assessment,
      id: idFor(heading),
      page: heading.page,
      section: heading.section,
      docId: scopeItem.docId,
    };
  }

  const order = (p: Product) =>
    Math.min(...p.evidenceIds.map((id) => position.get(id) ?? Number.MAX_SAFE_INTEGER));
  const mergedIds = new Set(merged.map((p) => p.id));
  return {
    products: [...scope.filter((p) => !mergedIds.has(p.id)), ...detailed, ...synthesized].sort(
      (a, b) => order(a) - order(b),
    ),
    excludedProducts: [...excluded, ...merged],
  };
}
