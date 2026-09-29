import { correctSections } from "@/lib/domain/specifications";
import { getDocumentProxy } from "unpdf";
import {
  AppError,
  ParsedDocument,
  Evidence,
  VERSION,
} from "@/lib/domain/models";
export async function parsePDF(bytes: Uint8Array): Promise<ParsedDocument> {
  const doc = await getDocumentProxy(bytes, { useSystemFonts: true });
  try {
    if (doc.numPages > 200)
      throw new AppError(
        413,
        "This version supports PDFs up to 200 pages. Split larger specifications into smaller PDFs.",
      );
    const evidence: Evidence[] = [];
    const scannedPages: number[] = [];
    let section = "Document",
      clause = "";
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const page = await doc.getPage(pn);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let lines: {
        text: string;
        x: number;
        y: number;
        right: number;
        bottom: number;
        fontSize: number;
        bold: boolean;
      }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [x, y] = viewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        );
        const h = Math.abs(item.height) || 10;
        const line = lines.at(-1);
        if (line && Math.abs(line.bottom - y) < 3) {
          line.text += " " + item.str;
          line.bold ||= /bold|black|heavy/i.test(content.styles[item.fontName]?.fontFamily || item.fontName);
          line.fontSize = Math.max(line.fontSize,h);
          line.right = Math.max(line.right, x + item.width);
          line.x = Math.min(line.x, x);
          line.y = Math.min(line.y, y - h);
        } else
          lines.push({
            text: item.str,
            x,
            y: y - h,
            right: x + item.width,
            bottom: y,
            fontSize: h,
            bold: /bold|black|heavy/i.test(content.styles[item.fontName]?.fontFamily || item.fontName),
          });
      }
      const count = lines.reduce((n, l) => n + l.text.trim().length, 0);
      if (count < 30) scannedPages.push(pn);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i],
          text = l.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const sec =
          text.match(/^SECTION\s+([\d -]{5,10})\s*(.*)/i) ||
          text.match(/^(\d{2}\s\d{2}\s\d{2})\s+([A-Z].*)/);
        if (sec) {
          section = (sec[1] + " " + sec[2]).trim();
          clause = "";
        }
        evidence.push({
          id: `p${pn}-l${i + 1}`,
          page: pn,
          text: text.slice(0, 10000),
          box: [
            Math.max(0, l.x / viewport.width),
            Math.max(0, l.y / viewport.height),
            Math.min(1, (l.right - l.x) / viewport.width),
            Math.min(1, (l.bottom - l.y) / viewport.height),
          ],
          section,
          clause,
          source: "pdf",
          fontSize: l.fontSize,
          bold: l.bold,
        });
      }
      page.cleanup();
      if (evidence.length > 12000)
        throw new AppError(
          413,
          "This PDF contains too many text blocks. Split it into smaller documents.",
        );
    }
    return correctSections({
      version: VERSION,
      pages: doc.numPages,
      evidence,
      scannedPages,
      sections: [...new Set(evidence.map((e) => e.section))],
    });
  } finally {
    await doc.cleanup();
  }
}
