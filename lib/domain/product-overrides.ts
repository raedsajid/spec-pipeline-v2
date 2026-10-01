import type { Product } from "./submittals";

export type CatalogStatus = "approved" | "excluded";
export type CatalogOverrides = Record<string, CatalogStatus>;

/**
 * Apply user catalog placements after classifier/merge. Unknown IDs in
 * overrides are ignored. Products without an override keep their computed side.
 */
export function applyCatalogOverrides(
  products: Product[],
  excludedProducts: Product[],
  overrides: CatalogOverrides,
) {
  const byId = new Map<string, Product>();
  for (const p of [...products, ...excludedProducts]) byId.set(p.id, p);
  const approved: Product[] = [];
  const excluded: Product[] = [];
  const defaultApproved = new Set(products.map((p) => p.id));

  for (const p of byId.values()) {
    const status =
      overrides[p.id] ||
      (defaultApproved.has(p.id) ? "approved" : "excluded");
    if (status === "approved") {
      approved.push({
        ...p,
        selectable: true,
        classificationReason:
          overrides[p.id] === "approved"
            ? p.classificationReason
              ? `${p.classificationReason} Moved to approved by review.`
              : "Moved to approved by review."
            : p.classificationReason,
      });
    } else {
      excluded.push({
        ...p,
        selectable: false,
        classificationReason:
          overrides[p.id] === "excluded"
            ? p.classificationReason
              ? `${p.classificationReason} Moved to excluded by review.`
              : "Moved to excluded by review."
            : p.classificationReason ||
              "Candidate is not a standalone catalog item.",
      });
    }
  }

  const order = (list: Product[], preferred: Product[]) => {
    const rank = new Map(preferred.map((p, i) => [p.id, i]));
    return [...list].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  };

  return {
    products: order(approved, products),
    excludedProducts: order(excluded, excludedProducts),
  };
}
