import type { RowMatch } from "./match-rows";

function nonemptyFieldCount(fields: Record<string, unknown>): number {
  return Object.values(fields).filter(
    (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length),
  ).length;
}

/** Keep one line item per (drawingId, unitTag); prefer richer raw fields. */
export function dedupeMatchesForEquipmentLog(matches: RowMatch[]): RowMatch[] {
  const best = new Map<string, RowMatch>();
  const order: string[] = [];
  let emptySeq = 0;

  for (const match of matches) {
    const tag = (match.unitTag || "").trim().toUpperCase();
    let key: string;
    if (!tag) {
      key = `${match.drawingId}::__empty__:${emptySeq++}`;
      best.set(key, match);
      order.push(key);
      continue;
    }
    key = `${match.drawingId}::${tag}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, match);
      order.push(key);
      continue;
    }
    if (
      nonemptyFieldCount(match.rawRowFields) >
      nonemptyFieldCount(existing.rawRowFields)
    ) {
      best.set(key, match);
    }
  }
  return order.map((k) => best.get(k)!);
}
