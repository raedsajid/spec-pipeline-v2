"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";

export type CropBox = {
  id: string;
  page: number;
  /** Normalized [x, y, w, h] in 0–1 page space (top-left origin) */
  bbox: [number, number, number, number];
};

type DragMode =
  | { kind: "move"; id: string; startX: number; startY: number; orig: CropBox["bbox"] }
  | {
      kind: "resize";
      id: string;
      handle: "nw" | "ne" | "sw" | "se";
      startX: number;
      startY: number;
      orig: CropBox["bbox"];
    };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function clampBbox(
  [x, y, w, h]: CropBox["bbox"],
): CropBox["bbox"] {
  const nx = clamp(x, 0, 0.98);
  const ny = clamp(y, 0, 0.98);
  const nw = clamp(w, 0.02, 1 - nx);
  const nh = clamp(h, 0.02, 1 - ny);
  return [nx, ny, nw, nh];
}

/** Visual crop gate: drawing page + red adjustable regions (before AI extract). */
export default function CropReviewDialog({
  open,
  onOpenChange,
  docId,
  filename,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  filename: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [crops, setCrops] = useState<CropBox[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [renderError, setRenderError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPage(1);
    setSelectedId(null);
    api(`documents/${docId}/crops`)
      .then((d) => {
        const list = (d.crops || []) as CropBox[];
        setCrops(list);
        const maxPage = list.reduce((m, c) => Math.max(m, c.page), 1);
        setPageCount((prev) => Math.max(prev, maxPage));
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, docId]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    let task: { destroy: () => void } | undefined;
    let renderTask: { cancel: () => void } | undefined;
    setRendering(true);
    setRenderError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (dead) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      task = pdfjs.getDocument({ url: `/api/documents/${docId}/pdf` });
      const pdf = await (task as any).promise;
      if (dead) return;
      setPageCount(pdf.numPages);
      const safePage = Math.min(Math.max(1, page), pdf.numPages);
      if (safePage !== page) {
        setPage(safePage);
        return;
      }
      const p = await pdf.getPage(safePage);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(960 / base.width, 720 / base.height);
      const viewport = p.getViewport({ scale });
      const el = canvasRef.current;
      if (!el || dead) return;
      el.width = viewport.width;
      el.height = viewport.height;
      setStageSize({ w: viewport.width, h: viewport.height });
      renderTask = p.render({ canvas: el, viewport });
      await (renderTask as any).promise;
      if (!dead) setRendering(false);
    })().catch(() => {
      if (!dead) {
        setRenderError("Could not render this drawing page.");
        setRendering(false);
      }
    });
    return () => {
      dead = true;
      renderTask?.cancel();
      task?.destroy();
    };
  }, [open, docId, page]);

  const pageCrops = useMemo(
    () => crops.filter((c) => c.page === page),
    [crops, page],
  );

  function updateCrop(id: string, bbox: CropBox["bbox"]) {
    setCrops((prev) =>
      prev.map((c) => (c.id === id ? { ...c, bbox: clampBbox(bbox) } : c)),
    );
  }

  function onPointerDown(
    e: React.PointerEvent,
    crop: CropBox,
    mode: "move" | "resize",
    handle: "nw" | "ne" | "sw" | "se" = "se",
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(crop.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current =
      mode === "move"
        ? {
            kind: "move",
            id: crop.id,
            startX: e.clientX,
            startY: e.clientY,
            orig: [...crop.bbox] as CropBox["bbox"],
          }
        : {
            kind: "resize",
            id: crop.id,
            handle,
            startX: e.clientX,
            startY: e.clientY,
            orig: [...crop.bbox] as CropBox["bbox"],
          };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !stageSize.w) return;
    const dx = (e.clientX - drag.startX) / stageSize.w;
    const dy = (e.clientY - drag.startY) / stageSize.h;
    const [ox, oy, ow, oh] = drag.orig;
    if (drag.kind === "move") {
      updateCrop(drag.id, [ox + dx, oy + dy, ow, oh]);
      return;
    }
    let x = ox,
      y = oy,
      w = ow,
      h = oh;
    if (drag.handle.includes("e")) w = ow + dx;
    if (drag.handle.includes("s")) h = oh + dy;
    if (drag.handle.includes("w")) {
      x = ox + dx;
      w = ow - dx;
    }
    if (drag.handle.includes("n")) {
      y = oy + dy;
      h = oh - dy;
    }
    if (w < 0.02) {
      if (drag.handle.includes("w")) x = ox + ow - 0.02;
      w = 0.02;
    }
    if (h < 0.02) {
      if (drag.handle.includes("n")) y = oy + oh - 0.02;
      h = 0.02;
    }
    updateCrop(drag.id, [x, y, w, h]);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function addRegion() {
    const id = `manual-${Date.now()}`;
    setCrops((prev) => [
      ...prev,
      { id, page, bbox: [0.1, 0.1, 0.8, 0.35] },
    ]);
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setCrops((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
  }

  async function save() {
    if (!crops.length) {
      toast.error("Keep at least one crop region.");
      return;
    }
    setSaving(true);
    try {
      await api(`documents/${docId}/crops`, "POST", { crops });
      toast.success("Crops saved. Run Extract (AI) when you are ready.");
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="crop-review-dialog">
        <DialogHeader>
          <DialogTitle>Review schedule crops</DialogTitle>
          <DialogDescription>
            {filename} — drag red boxes to move, use corners to resize. Delete
            regions you do not need, then Save before Extract (AI).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="muted">Loading crops…</p>
        ) : !crops.length ? (
          <p className="muted">
            No crops yet. Click Prepare crops first (no AI).
          </p>
        ) : (
          <div className="crop-review-workspace">
            <div className="crop-review-toolbar">
              <button
                type="button"
                className="button secondary small-button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
                Prev
              </button>
              <span className="muted small">
                Page {page} / {pageCount} · {pageCrops.length} region
                {pageCrops.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="button secondary small-button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                className="button secondary small-button"
                onClick={addRegion}
              >
                Add region
              </button>
              <button
                type="button"
                className="button secondary small-button"
                disabled={!selectedId}
                onClick={deleteSelected}
              >
                Delete selected
              </button>
            </div>

            <div
              className="crop-review-stage"
              ref={stageRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {(rendering || renderError) && (
                <div className="crop-review-stage-status">
                  {rendering ? (
                    <>
                      <LoaderCircle className="spin" size={18} />
                      Rendering page…
                    </>
                  ) : (
                    renderError
                  )}
                </div>
              )}
              <canvas ref={canvasRef} className="crop-review-canvas" />
              <div
                className="crop-review-overlay"
                style={{ width: stageSize.w, height: stageSize.h }}
              >
                {pageCrops.map((crop) => {
                  const [x, y, w, h] = crop.bbox;
                  const selected = crop.id === selectedId;
                  return (
                    <div
                      key={crop.id}
                      className={`crop-box${selected ? " selected" : ""}`}
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${w * 100}%`,
                        height: `${h * 100}%`,
                      }}
                      onPointerDown={(e) => onPointerDown(e, crop, "move")}
                    >
                      <span className="crop-box-label">{crop.id}</span>
                      {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                        <i
                          key={handle}
                          className={`crop-handle crop-handle-${handle}`}
                          onPointerDown={(e) =>
                            onPointerDown(e, crop, "resize", handle)
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="button secondary"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
          <button
            type="button"
            className="button orange"
            disabled={saving || loading || !crops.length}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save crops"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
