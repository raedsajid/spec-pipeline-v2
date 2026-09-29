import type { Evidence, ParsedDocument } from "./models";
export const STRUCTURE_VERSION = "layout-2";
const measurement = /^(?:\d+(?:\.\d+)?\s+)?(?:[.\d]|BTU\b|W\/|kg\b|mm\b|in\b|LEED\b|version\b)/i;
const headingTitle = (s:string) => /[a-z]/i.test(s) && !measurement.test(s) && !/[.;]$/.test(s) && s.length < 180;
// Two passes: learn article presentation, then assign ownership. A decimal
// candidate never changes ownership without independent heading evidence.
export function assignStructure(doc: ParsedDocument): ParsedDocument {
  let part = "", article = "", title = "", section = "", paragraph = "", item = "", context = "";
  const candidates = doc.evidence.map(e => ({e,m:e.text.match(/^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.+)$/)})).filter(x=>x.m && headingTitle(x.m[2]));
  const anchors = candidates.filter(({e,m}) => e.bold || m![2] === m![2].toUpperCase());
  const isHeading = (e:Evidence,m:RegExpMatchArray) => {
    if (!headingTitle(m[2]) || /^0\./.test(m[1]) || (part && m[1].split('.')[0] !== part)) return false;
    const sameStyle = anchors.some(a => a.e.section === e.section && a.e.box && e.box && Math.abs(a.e.box[0]-e.box[0]) < .018 && (!a.e.fontSize || !e.fontSize || Math.abs(a.e.fontSize-e.fontSize)<1));
    const uppercase = m[2] === m[2].toUpperCase();
    return !!(uppercase || e.bold || (sameStyle && /^[A-Z]/.test(m[2]) && m[2].split(/\s+/).length < 12));
  };
  let articleX:number|undefined;
  const evidence = doc.evidence.map(e => {
    if (section !== e.section) {section=e.section;part=article=title=paragraph=item=context="";articleX=undefined;}
    const text=e.text.trim();
    const p=text.match(/^PART\s+(\d+)\s*[-–—:]?\s*(.*)$/i);
    const a=text.match(/^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.+)$/);
    let structuralWarning: string|undefined;
    if (p) {part=p[1];article=title=paragraph=item=context="";articleX=undefined;}
    else if (a && isHeading(e,a)) {if(article!==a[1]) {paragraph=item=context="";} article=a[1];title=a[2];articleX=e.box?.[0];}
    else {
      if (a && !measurement.test(a[2])) structuralWarning="Unconfirmed decimal heading; retained the preceding article.";
      if (/^(?:(?:approved|acceptable) )?manufacturers?\s*[:.]?$/i.test(text)) context=text;
      const letter=text.match(/^([A-Z])\.\s+(.+)/);
      const child=text.match(/^(\d+)[.)]\s+(.+)/);
      if (letter && article && (articleX === undefined || !e.box || e.box[0] >= articleX-.01)) {paragraph=letter[1];item="";context=letter[2];}
      else if(child && paragraph) item=child[1];
    }
    return {...e,clause:[article,paragraph,item].filter(Boolean).join('.'),article,articleTitle:title,part,context,structuralWarning};
  });
  return {...doc,evidence,structureVersion:STRUCTURE_VERSION};
}
