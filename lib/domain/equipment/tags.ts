/** Unit-tag parsing helpers for schedule rows and equipment-map keys. */

const DRAWING_TAG =
  /\b([A-Z]{1,6}\d{0,2})[-–—\s]*(\d{1,3})(?:\.(\d{1,3}))?(?:[-–—](\d{1,3}))?([A-Z]?)\b/gi;
const TAG_KEY =
  /(designation|unit\s*no\.?|^tag$|mark|equip|^no\.?$|^no$|sym)/i;
const MODELISH = /\d{2,}[A-Z]|[A-Z]{2,}\d{4,}|CGM|F\d-/i;
const FULL_TAG =
  /^[A-Z]{1,6}\d{0,2}[-–—\s]?\d{1,3}(?:\.\d{1,3})?(?:[-–—]\d{1,3})?[A-Z]?$/i;

export function isModelish(text: string): boolean {
  return MODELISH.test(text || "");
}

export function normalizeTag(
  prefix: string,
  num: string,
  sub: string | null | undefined = null,
  suffix = "",
  decimal: string | null | undefined = null,
): string {
  let base = `${prefix.toUpperCase()}-${parseInt(num, 10)}`;
  if (decimal != null && String(decimal).trim() !== "") {
    base = `${base}.${parseInt(decimal, 10)}`;
  }
  if (sub) base = `${base}-${parseInt(sub, 10)}`;
  if (suffix) base = `${base}${suffix.toUpperCase()}`;
  return base;
}

export function tagType(tag: string): string {
  return tag.split("-")[0]!;
}

export function expandDrawingTags(ref: string): string[] {
  if (!ref || !String(ref).trim()) return [];
  const text = String(ref).trim().replace(/[–—]/g, "-");
  if (isModelish(text)) return [];
  const matches = [...text.matchAll(DRAWING_TAG)];
  if (!matches.length) return [];
  const tags: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    tags.push(
      normalizeTag(m[1]!, m[2]!, m[4], m[5] || "", m[3]),
    );
    if (m[3] || m[4]) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1]!.index ?? text.length)
        : text.length;
    const trail = text.slice(start, end);
    const mtrail = trail.match(/^([\s,;/&\d]+(?:\s*(?:and|&)\s*\d+)*)/i);
    if (mtrail && !/[A-Za-z]/.test(mtrail[1]!)) {
      for (const n of mtrail[1]!.match(/\d{1,3}/g) || []) {
        tags.push(normalizeTag(m[1]!, n));
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function extractTagsFromRow(
  row: Record<string, unknown> | null | undefined,
): string[] {
  if (!row || typeof row !== "object") return [];
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const [key, val] of Object.entries(row)) {
    if (val == null) continue;
    const text = String(val).trim();
    if (!text || text.includes("%")) continue;
    let tags = expandDrawingTags(text);
    if (!tags.length) tags = expandDrawingTags(text.replace(/ /g, "-"));
    if (!tags.length) continue;
    const keyS = String(key).trim();
    if (
      TAG_KEY.test(keyS) ||
      ["DESIGNATION", "TAG", "UNIT NO.", "UNIT NO", "MARK", "NO.", "NO", "UNIT"].includes(
        keyS.toUpperCase(),
      )
    ) {
      preferred.push(...tags);
      continue;
    }
    if (FULL_TAG.test(text)) fallback.push(...tags);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of preferred.length ? preferred : fallback) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function compoundTypeKey(types: string[]): string | null {
  const uniq: string[] = [];
  for (const t of types) {
    if (t && !uniq.includes(t)) uniq.push(t);
  }
  if (uniq.length < 2) return null;
  return uniq.join("/");
}
