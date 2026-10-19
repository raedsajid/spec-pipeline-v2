/** Normalize drawing schedule titles for matching / semantic queries. */

const PAREN_RE = /\([^)]*\)/g;
const SCHEDULE_SUFFIX_RE = /\b(?:schedule|sch\.?)\s*(?:\d+|[ivxlc]+)?\s*$/i;
const CONT_PREFIX_RE = /^(?:cont\.?|continuation\s+of)\s+/i;
const CONT_SUFFIX_RE = /\b(?:cont\.?|continuation)\s*$/i;

export function normalizeScheduleName(rawName: string): string {
  let text = String(rawName || "").trim();
  if (!text) return "";
  text = text.replace(PAREN_RE, " ");
  text = text.replace(CONT_PREFIX_RE, "");
  text = text.replace(CONT_SUFFIX_RE, "");
  text = text.replace(SCHEDULE_SUFFIX_RE, "");
  text = text.replace(/[^\w\s/-]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.toLowerCase();
}

export function scheduleTitleQuery(rawTitle: string): string {
  return normalizeScheduleName(rawTitle);
}
