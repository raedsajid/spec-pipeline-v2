import { normalize } from "./models";
import { familyScore } from "./product-catalog";
import type { Product } from "./submittals";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "all",
  "detail",
  "each",
  "for",
  "gag",
  "in",
  "of",
  "or",
  "submit",
  "the",
  "to",
  "type",
  "with",
]);

const singular = (w: string) =>
  w.length >= 4 && /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w;

const terms = (s: string) =>
  normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))
    .map(singular);

const labelsOf = (p: Product) => [
  p.name,
  ...(p.aliases || []).map((a) => a.name),
];

export type ProductSuggestion = { id: string; score: number };

type SuggestableRequirement = {
  title?: string;
  text?: string;
  quote?: string;
  products?: string[];
  productIds?: string[];
};

function namedScore(named: string, product: Product) {
  const n = normalize(named);
  if (!n) return 0;
  for (const label of labelsOf(product)) {
    const l = normalize(label);
    if (n === l) return 100;
    const related = familyScore(named, label);
    if (related && (l.includes(n) || n.includes(l))) return 80 + related;
    if (related >= 2) return 60 + related;
  }
  return 0;
}

function lexicalScore(query: string, product: Product) {
  const q = new Set(terms(query));
  if (q.size < 2) return 0;
  let best = 0;
  for (const label of labelsOf(product)) {
    const related = familyScore(query, label);
    if (!related) continue;
    const labelTerms = new Set(terms(label));
    const shared = [...q].filter((t) => labelTerms.has(t)).length;
    if (shared >= 2) best = Math.max(best, 20 + shared + related);
  }
  return best;
}

/**
 * Rank catalog products for a submittal row using Gemini-named products on the
 * requirement, then a lexical fallback against title/text/quote.
 */
export function suggestProductsForRequirement(
  requirement: SuggestableRequirement,
  products: Product[],
): ProductSuggestion[] {
  const linked = new Set(requirement.productIds || []);
  const named = requirement.products || [];
  const query = [requirement.title, requirement.text, requirement.quote]
    .filter(Boolean)
    .join(" ");
  const scores = new Map<string, number>();

  for (const p of products) {
    if (p.selectable === false && !linked.has(p.id)) continue;
    let score = 0;
    for (const name of named) score = Math.max(score, namedScore(name, p));
    if (score < 60) score = Math.max(score, lexicalScore(query, p));
    if (score > 0) scores.set(p.id, score);
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort(
      (a, b) =>
        b.score - a.score || a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
}

/** Order groups and products for the prioritize-suggestions UI. */
export function prioritizeProductGroups(
  products: Product[],
  suggestedIds: Set<string>,
  prioritize: boolean,
) {
  const groups = [...new Set(products.map((p) => p.group))];
  const ranked = groups.map((group, index) => {
    const items = products.filter((p) => p.group === group);
    const matches = items.filter((p) => suggestedIds.has(p.id)).length;
    const ordered = prioritize
      ? [
          ...items.filter((p) => suggestedIds.has(p.id)),
          ...items.filter((p) => !suggestedIds.has(p.id)),
        ]
      : items;
    return { group, items: ordered, matches, index };
  });
  if (prioritize)
    ranked.sort(
      (a, b) => b.matches - a.matches || a.index - b.index,
    );
  return ranked;
}
