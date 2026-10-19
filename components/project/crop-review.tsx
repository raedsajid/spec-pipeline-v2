"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

export type CropBox = {
  id: string;
  page: number;
  /** Normalized [x, y, w, h] in 0–1 page space */
  bbox: [number, number, number, number];
};

/** Optional human gate before / after schedule extract. */
export default function CropReviewDialog({
  open,
  onOpenChange,
  docId,
  filename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  filename: string;
}) {
  const [crops, setCrops] = useState<CropBox[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api(`documents/${docId}/crops`)
      .then((d) => setCrops(d.crops || []))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, docId]);

  function updateBbox(i: number, j: number, value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setCrops((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const bbox = [...c.bbox] as [number, number, number, number];
        bbox[j] = Math.min(1, Math.max(0, n));
        return { ...c, bbox };
      }),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await api(`documents/${docId}/crops`, "POST", { crops });
      toast.success("Crops saved. Re-process the drawing to re-extract.");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Review schedule crops</DialogTitle>
          <DialogDescription>
            Adjust detected regions on {filename}. Delete false positives or
            edit normalized boxes (x, y, w, h). Full sheet overlay editor comes
            with table detection.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="muted">Loading crops…</p>
        ) : !crops.length ? (
          <p className="muted">
            No crops stored yet. Process the drawing first (full-page regions are
            recorded per sheet).
          </p>
        ) : (
          <div className="crop-review-list">
            {crops.map((c, i) => (
              <div className="crop-review-row" key={c.id}>
                <label className="muted small">p{c.page}</label>
                <div className="row wrap" style={{ gap: 6 }}>
                  {(["x", "y", "w", "h"] as const).map((label, j) => (
                    <input
                      key={label}
                      aria-label={`${label} page ${c.page}`}
                      value={c.bbox[j]}
                      onChange={(e) => updateBbox(i, j, e.target.value)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="button secondary small-button"
                  onClick={() =>
                    setCrops((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  Delete
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary small-button"
              onClick={() =>
                setCrops((prev) => [
                  ...prev,
                  {
                    id: `manual-${Date.now()}`,
                    page: prev[0]?.page || 1,
                    bbox: [0.05, 0.05, 0.9, 0.4],
                  },
                ])
              }
            >
              Add region
            </button>
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
            disabled={saving || loading}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save crops"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
