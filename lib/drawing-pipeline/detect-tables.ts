/**
 * Call the Python OpenCV drawing-detect sidecar (BuildERP-AI detect path).
 * Requires DRAWING_DETECT_URL + DRAWING_DETECT_SECRET.
 */
import { AppError } from "@/lib/domain/models";
import type { NormBox } from "./pad";

export type DetectedCrop = {
  id: string;
  page: number;
  bbox: NormBox;
};

export type DetectTablesResult = {
  page: number;
  renderWidth: number;
  renderHeight: number;
  dpi: number;
  crops: DetectedCrop[];
};

function detectConfig() {
  const url = (process.env.DRAWING_DETECT_URL || "").replace(/\/$/, "");
  const secret = process.env.DRAWING_DETECT_SECRET || "";
  return { url, secret };
}

/** Detect padded schedule-table crops for one PDF page (as single-page PDF bytes). */
export async function detectScheduleTablesOnPage(
  pagePdf: Uint8Array,
  _uid: string,
  meta: { filename: string; page: number; pages: number },
): Promise<DetectedCrop[]> {
  const { url, secret } = detectConfig();
  if (!url || !secret) {
    throw new AppError(
      503,
      "Drawing detect service is not configured. Set DRAWING_DETECT_URL and DRAWING_DETECT_SECRET.",
      "detect_unavailable",
    );
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pagePdf)], { type: "application/pdf" }),
    `${meta.filename.replace(/\.pdf$/i, "")}-p${meta.page}.pdf`,
  );
  form.append("page", String(meta.page));

  let response: Response;
  try {
    response = await fetch(`${url}/v1/detect-tables`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
  } catch {
    throw new AppError(
      503,
      "Drawing detect service unavailable. Check DRAWING_DETECT_URL and that the sidecar is running.",
      "detect_unavailable",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new AppError(
      response.status === 401 ? 502 : 503,
      detail
        ? `Drawing detect failed: ${detail}`
        : "Drawing detect service returned an error.",
      "detect_failed",
    );
  }

  const data = (await response.json()) as DetectTablesResult;
  const crops = Array.isArray(data.crops) ? data.crops : [];
  return crops
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        Array.isArray(c.bbox) &&
        c.bbox.length === 4 &&
        c.bbox.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
    .map((c) => ({
      id: c.id,
      page: Number(c.page) || meta.page,
      bbox: c.bbox as NormBox,
    }));
}
