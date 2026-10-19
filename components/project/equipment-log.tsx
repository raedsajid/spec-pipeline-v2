"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cog,
  LoaderCircle,
  Search,
  Upload,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { api, pretty } from "@/lib/api-client";
import CropReviewDialog from "./crop-review";

type CatalogEntry = { csi: string; title: string };
type EquipItem = {
  id: string;
  unitTag: string;
  sheetNumber: string;
  scheduleTitle: string;
  band: string;
  proposedCsi: string | null;
  proposedDescription: string | null;
  selectedCsi: string | null;
  selectedDescription: string | null;
  status: string;
  equipmentTypes: string[];
};

type EquipState = {
  log: { id: string; revision: number; updated: number } | null;
  items: EquipItem[];
  counts: { total: number; auto: number; review: number; no_match: number };
  catalog: CatalogEntry[];
};

export default function EquipmentLogView({
  detail,
  refresh,
}: {
  detail: any;
  refresh: () => Promise<void>;
}) {
  const pid = detail.project.id as string;
  const drawings = (detail.documents || []).filter(
    (d: any) => (d.doc_kind || "spec") === "drawing",
  );
  const [data, setData] = useState<EquipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [bandFilter, setBandFilter] = useState("all");
  const [work, setWork] = useState<{
    stage: string;
    file: string;
    progress: number;
  } | null>(null);
  const [cropDoc, setCropDoc] = useState<{ id: string; filename: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);
  const dead = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`projects/${pid}/equipment-log`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    dead.current = false;
    void load();
    return () => {
      dead.current = true;
    };
  }, [load]);

  async function uploadDrawings(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        setWork({
          stage: "Uploading drawing",
          file: files[i]!.name,
          progress: Math.round((i / files.length) * 100),
        });
        const ticket = await api(`projects/${pid}/upload-url`, "POST", {
          filename: files[i]!.name,
          size: files[i]!.size,
        });
        const uploaded = await fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: files[i],
        });
        if (!uploaded.ok)
          throw new Error(
            "The PDF could not be uploaded. Check R2 CORS and try again.",
          );
        await api(`projects/${pid}/upload-complete`, "POST", {
          objectKey: ticket.objectKey,
          filename: files[i]!.name,
          size: files[i]!.size,
          docKind: "drawing",
        });
      }
      await refresh();
      toast.success("Drawing uploaded. Process schedules next.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
      if (input.current) input.current.value = "";
    }
  }

  async function prepareCrops(doc: any) {
    if (busy) return;
    setBusy(true);
    setError("");
    setWork({
      stage: "Preparing crop regions",
      file: doc.filename,
      progress: 30,
    });
    try {
      const p = await api(
        `documents/${doc.id}/prepare-drawing-crops`,
        "POST",
        {},
      );
      setWork({
        stage: "Crops ready for review",
        file: doc.filename,
        progress: 100,
      });
      await refresh();
      toast.success(
        `Prepared ${p.cropCount} region(s). Review crops, then extract.`,
      );
      setCropDoc({ id: doc.id, filename: doc.filename });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
    }
  }

  async function extractDrawing(doc: any) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      for (let n = 0; n < 80 && !dead.current; n++) {
        const p = await api(`documents/${doc.id}/process-drawing`, "POST", {});
        setWork({
          stage:
            p.status === "ready"
              ? "Schedules ready"
              : "Extracting schedule tables (AI)",
          file: doc.filename,
          progress: p.progress ?? 0,
        });
        if (p.status === "ready") break;
      }
      await refresh();
      toast.success(`Schedules extracted from ${doc.filename}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
    }
  }

  function drawingStatusLabel(d: any) {
    switch (d.drawing_status) {
      case "crops_ready":
        return "Crops ready · review, then extract";
      case "extracting":
        return "Extracting…";
      case "ready":
        return "Schedules ready";
      case "error":
        return d.drawing_error || "Error";
      default:
        return "Upload received · prepare crops";
    }
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    setWork({
      stage: "Matching equipment map",
      file: detail.project.name,
      progress: 40,
    });
    try {
      const next = await api(`projects/${pid}/equipment-log`, "POST", {});
      setData(next);
      toast.success(
        next.counts.total
          ? `Equipment log generated · ${next.counts.total} units`
          : "No tagged schedule rows found. Process drawings first.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
    }
  }

  async function patchItem(
    item: EquipItem,
    patch: { selectedCsi?: string | null; status?: string },
  ) {
    const catalog = data?.catalog || [];
    const title =
      patch.selectedCsi != null
        ? catalog.find((c) => c.csi === patch.selectedCsi)?.title ||
          item.proposedDescription
        : undefined;
    try {
      const next = await api(`equipment-items/${item.id}`, "PATCH", {
        ...patch,
        selectedDescription:
          patch.selectedCsi === undefined
            ? undefined
            : patch.selectedCsi
              ? title || null
              : null,
      });
      setData(next);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const items = (data?.items || []).filter((item) => {
    if (bandFilter !== "all" && item.band !== bandFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.unitTag.toLowerCase().includes(q) ||
      item.scheduleTitle.toLowerCase().includes(q) ||
      (item.selectedCsi || item.proposedCsi || "")
        .toLowerCase()
        .includes(q) ||
      item.sheetNumber.toLowerCase().includes(q)
    );
  });

  const readyDrawings = drawings.filter((d: any) => d.drawing_status === "ready");

  return (
    <>
      <div className="section-row">
        <div>
          <h2>Equipment log</h2>
          <p className="muted">
            {data?.counts.total
              ? `${data.counts.total} units · ${data.counts.auto} auto · ${data.counts.review} review · ${data.counts.no_match} no match`
              : "Upload drawings → prepare crops → review → extract (AI) → generate log."}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={17} />
            Upload drawings
          </button>
          <button
            className="button orange"
            onClick={() => void generate()}
            disabled={busy || !readyDrawings.length}
          >
            <Cog size={17} />
            {data?.log ? "Regenerate equipment log" : "Generate equipment log"}
          </button>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => void uploadDrawings(e.target.files)}
      />

      {work && (
        <div className="work-banner">
          <LoaderCircle className="spin" size={18} />
          <div>
            <b>{work.stage}</b>
            <p className="muted small">{work.file}</p>
          </div>
          <Progress value={work.progress} className="work-progress" />
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="equipment-drawings">
        <h3>Drawings</h3>
        {!drawings.length ? (
          <p className="muted">No schedule drawings yet.</p>
        ) : (
          <ul className="equipment-drawing-list">
            {drawings.map((d: any) => {
              const status = d.drawing_status || "pending";
              const canReview =
                status === "crops_ready" ||
                status === "extracting" ||
                status === "ready" ||
                status === "error";
              const canExtract =
                status === "crops_ready" ||
                status === "extracting" ||
                status === "ready" ||
                status === "error";
              return (
                <li key={d.id}>
                  <span>{d.filename}</span>
                  <span className="muted small">{drawingStatusLabel(d)}</span>
                  <button
                    className="button secondary small-button"
                    disabled={busy}
                    onClick={() => void prepareCrops(d)}
                  >
                    {canReview ? "Re-prepare crops" : "Prepare crops"}
                  </button>
                  <button
                    className="button secondary small-button"
                    disabled={busy || !canReview}
                    onClick={() =>
                      setCropDoc({ id: d.id, filename: d.filename })
                    }
                  >
                    Review crops
                  </button>
                  <button
                    className="button orange small-button"
                    disabled={busy || !canExtract}
                    onClick={() => void extractDrawing(d)}
                  >
                    {status === "ready" ? "Re-extract (AI)" : "Extract (AI)"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {cropDoc && (
        <CropReviewDialog
          open={!!cropDoc}
          onOpenChange={(open) => {
            if (!open) setCropDoc(null);
          }}
          docId={cropDoc.id}
          filename={cropDoc.filename}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}

      <div className="register-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search equipment"
            placeholder="Search unit, schedule, CSI…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={bandFilter} onValueChange={setBandFilter}>
          <SelectTrigger aria-label="Filter band" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bands</SelectItem>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="no_match">No match</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="muted">Loading equipment log…</p>
      ) : (
        <div className="table-shell">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Proposed CSI</TableHead>
                <TableHead>Selected Spec</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="muted">
                    No equipment rows yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <b>{item.unitTag}</b>
                      {item.equipmentTypes?.length ? (
                        <div className="muted small">
                          {item.equipmentTypes.join(", ")}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{item.scheduleTitle || "—"}</TableCell>
                    <TableCell>{item.sheetNumber || "—"}</TableCell>
                    <TableCell>
                      <span className={`band-pill band-${item.band}`}>
                        {item.band.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.proposedCsi || "—"}
                      {item.proposedDescription ? (
                        <div className="muted small">
                          {item.proposedDescription}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={item.selectedCsi || "__none__"}
                        onValueChange={(v) =>
                          void patchItem(item, {
                            selectedCsi: v === "__none__" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue placeholder="Select CSI" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {item.proposedCsi &&
                            !(data?.catalog || []).some(
                              (c) => c.csi === item.proposedCsi,
                            ) && (
                              <SelectItem value={item.proposedCsi}>
                                {item.proposedCsi} (proposed)
                              </SelectItem>
                            )}
                          {(data?.catalog || []).map((c) => (
                            <SelectItem key={c.csi} value={c.csi}>
                              {c.csi} · {c.title.slice(0, 40)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={item.status}
                        onValueChange={(v) =>
                          void patchItem(item, { status: v })
                        }
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            "needs_review",
                            "proposed",
                            "confirmed",
                            "rejected",
                          ].map((s) => (
                            <SelectItem key={s} value={s}>
                              {s === "needs_review" ? "Needs review" : pretty(s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
