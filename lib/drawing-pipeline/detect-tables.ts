/**
 * Detect schedule-table regions on a drawing page.
 *
 * BuildERP-AI does this with OpenCV (lines → cells → assemble → pad).
 * Native OpenCV is not practical inside Vercel Node, so this stage asks Gemini
 * for the *same output shape*: multiple tight table boxes (not the full page).
 * Padding / title-block filters match BuildERP-AI table_crop + filter_schedule_tables.
 */
import { z } from "zod";
import { generate } from "@/lib/server/gemini";
import {
  isNearFullPage,
  isTitleBlockScrap,
  padNormalizedBox,
  type NormBox,
} from "./pad";

const DETECT_SYSTEM = `You locate mechanical equipment SCHEDULE TABLES on an engineering drawing page.
Return JSON only:
{
  "tables": [
    { "bbox": [x, y, w, h] }
  ]
}
bbox is normalized 0–1 with origin at the TOP-LEFT of the page:
- x,y = top-left of the ruled schedule table (include the schedule title row above the top rule)
- w,h = width and height of that table region

Rules (same intent as OpenCV schedule detection):
- One bbox per distinct schedule table grid (exhaust fan, AHU, pump, etc.).
- Boxes must be TIGHT around each table — never the whole drawing sheet.
- Skip notes, legends, load summaries, and right-side title-block scraps.
- If there are no schedule tables, return {"tables":[]}.`;

const DetectSchema = z.object({
  tables: z
    .array(
      z.object({
        bbox: z.tuple([
          z.number(),
          z.number(),
          z.number(),
          z.number(),
        ]),
      }),
    )
    .max(40)
    .default([]),
});

function sanitizeBox(raw: NormBox): NormBox | null {
  let [x, y, w, h] = raw;
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  // Accept 0–100 percentages if the model returns them.
  if (x > 1 || y > 1 || w > 1 || h > 1) {
    x /= 100;
    y /= 100;
    w /= 100;
    h /= 100;
  }
  x = Math.min(0.98, Math.max(0, x));
  y = Math.min(0.98, Math.max(0, y));
  w = Math.min(1 - x, Math.max(0.02, w));
  h = Math.min(1 - y, Math.max(0.02, h));
  const box: NormBox = [x, y, w, h];
  if (isNearFullPage(box)) return null;
  if (isTitleBlockScrap(box)) return null;
  return padNormalizedBox(box);
}

/** Detect padded schedule-table crops for one PDF page (as single-page PDF bytes). */
export async function detectScheduleTablesOnPage(
  pagePdf: Uint8Array,
  uid: string,
  meta: { filename: string; page: number; pages: number },
): Promise<NormBox[]> {
  const raw = await generate(
    DETECT_SYSTEM,
    `Find equipment schedule table regions on ${meta.filename}, page ${meta.page} of ${meta.pages}.`,
    uid,
    pagePdf,
  );
  const parsed = DetectSchema.parse(raw);
  const out: NormBox[] = [];
  for (const t of parsed.tables) {
    const box = sanitizeBox(t.bbox as NormBox);
    if (box) out.push(box);
  }
  // Drop boxes that nearly contain another (parent mega-frames).
  return dropContainingParents(out);
}

function area(b: NormBox) {
  return b[2] * b[3];
}

function containment(inner: NormBox, outer: NormBox) {
  const [ix, iy, iw, ih] = inner;
  const [ox, oy, ow, oh] = outer;
  const x1 = Math.max(ix, ox);
  const y1 = Math.max(iy, oy);
  const x2 = Math.min(ix + iw, ox + ow);
  const y2 = Math.min(iy + ih, oy + oh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return area(inner) > 0 ? inter / area(inner) : 0;
}

function dropContainingParents(boxes: NormBox[]): NormBox[] {
  const sorted = [...boxes].sort((a, b) => area(a) - area(b));
  const kept: NormBox[] = [];
  for (const box of sorted) {
    const isParent = kept.some((small) => containment(small, box) >= 0.85);
    if (!isParent) kept.push(box);
  }
  return kept.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
