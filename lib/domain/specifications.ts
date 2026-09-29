import { assignStructure } from "./structure";
import type { ParsedDocument } from "./models";

// Section references in body text must never change the document's identity.
// Read only standalone headings in the header/footer area; retain page scope
// for PDFs containing more than one specification.
export function correctSections(parsed: ParsedDocument): ParsedDocument {
  const headings = new Map<number, string>();
  for (const e of parsed.evidence) {
    const text = e.text.trim();
    const match = text.match(/^(?:SECTION\s+)?(\d{5,6}|\d{2}[ -]\d{2}[ -]\d{2})(?:\s*[-–—:]?\s+([A-Z][A-Z0-9 &/()'’–—-]*))?$/);
    if (!match || (e.box && e.box[1] > 0.3 && e.box[1] < 0.85)) continue;
    // Bare digits are accepted only in page margins, not as body quantities.
    if (!/^SECTION\s/.test(text) && !match[2] && (!e.box || (e.box[1] > 0.15 && e.box[1] < 0.85))) continue;
    if (!headings.has(e.page)) headings.set(e.page, match[1].replace(/[ -]/g, ""));
  }
  let current = headings.size ? [...headings.entries()].sort((a,b)=>a[0]-b[0])[0][1] : "Unresolved";
  const byPage = new Map<number, string>();
  for (let page = 1; page <= parsed.pages; page++) {
    current = headings.get(page) || current;
    byPage.set(page, current);
  }
  const evidence = parsed.evidence.map(e => ({...e, section: byPage.get(e.page) || "Unresolved"}));
  return assignStructure({...parsed, evidence, sections: [...new Set(evidence.map(e=>e.section))]});
}
