/** BuildERP-AI table_crop.py pad fractions (sheet-relative). */
export const TOP_PAD_FRAC = 0.008;
export const SIDE_PAD_FRAC = 0.004;
export const BOTTOM_PAD_FRAC = 0.004;

/** Title-block scrap filter from filter_schedule_tables. */
export const TITLE_BLOCK_LEFT_FRAC = 0.85;
export const TITLE_BLOCK_MAX_W_FRAC = 0.15;

export type NormBox = [number, number, number, number];

export function padNormalizedBox(box: NormBox): NormBox {
  const [x, y, w, h] = box;
  const x1 = Math.max(0, x - SIDE_PAD_FRAC);
  const y1 = Math.max(0, y - TOP_PAD_FRAC);
  const x2 = Math.min(1, x + w + SIDE_PAD_FRAC);
  const y2 = Math.min(1, y + h + BOTTOM_PAD_FRAC);
  return [x1, y1, Math.max(0.02, x2 - x1), Math.max(0.02, y2 - y1)];
}

export function isTitleBlockScrap(box: NormBox): boolean {
  const [x, , w] = box;
  return x >= TITLE_BLOCK_LEFT_FRAC && w <= TITLE_BLOCK_MAX_W_FRAC;
}

export function isNearFullPage(box: NormBox): boolean {
  const [x, y, w, h] = box;
  return x <= 0.02 && y <= 0.02 && w >= 0.96 && h >= 0.96;
}
