"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Box,
  CheckCheck,
  ChevronRight,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FileText,
  Layers3,
  LoaderCircle,
  Search,
  Upload,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { Requirement } from "@/lib/domain/models";
import {
  Product,
  SUBMITTAL_LOG_VERSION,
  sortSubmittals,
  groupSubmittals,
} from "@/lib/domain/submittals";
import { api, pretty, specLabel } from "@/lib/api-client";
import ProductPanel from "./product-panel";
import SpecsView from "./specs-view";
import DocumentChat from "./document-chat";
type Work = { stage: string; file: string; progress: number };
export default function Workbench({
  detail,
  tab,
  setTab,
  refresh,
  onReview,
  onSource,
  onEmpty,
}: {
  detail: any;
  tab: string;
  setTab: (s: string) => void;
  refresh: () => Promise<void>;
  onReview: (r: Requirement) => void;
  onSource: (s: any) => void;
  onEmpty: (d: any) => void;
}) {
  const docs: any[] = detail.documents,
    rows: Requirement[] = detail.requirements,
    pid = detail.project.id;
  const [collapsedSpecs, setCollapsedSpecs] = useState<string[]>([]);
  const [work, setWork] = useState<Work | null>(null),
    [error, setError] = useState(""),
    [failed, setFailed] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("source"),
    [selected, setSelected] = useState<string[]>([]),
    [newRowIds, setNewRowIds] = useState<string[]>([]),
    [productRow, setProductRow] = useState<Requirement | null>(null),
    [initial, setInitial] = useState<{
      docId: string;
      product?: Product;
      row?: Requirement;
    } | null>(null),
    [format, setFormat] = useState("xlsx"),
    [uploading, setUploading] = useState(false);
  const running = useRef(false),
    dead = useRef(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dead.current = false;
    return () => {
      dead.current = true;
    };
  }, []);
  // One operation at a time prevents the same browser from racing shared PDF leases.
  useEffect(() => {
    const next = docs.find((d) => !d.indexed && !failed.includes(d.id));
    if (next && !running.current && !uploading) {
      void prepare(next);
    }
  }, [docs, failed, uploading, work]);
  async function prepare(doc: any) {
    running.current = true;
    setError("");
    try {
      let ready = false;
      setWork({
        stage: "Reading specification",
        file: specLabel(doc),
        progress: 5,
      });
      for (let n = 0; n < 500 && !dead.current; n++) {
        const p = await api(`documents/${doc.id}/prepare`, "POST", {});
        if (p.status === "prepared") {
          ready = true;
          break;
        }
        setWork({
          stage:
            p.status === "ocr"
              ? "Reading scanned pages"
              : "Reading specification",
          file: specLabel(doc),
          progress: 20,
        });
      }
      if (!ready) return;
      setWork({
        stage: "Preparing document chat",
        file: specLabel(doc),
        progress: 30,
      });
      for (let n = 0; n < 500 && !dead.current; n++) {
        const p = await api(`documents/${doc.id}/index`, "POST", {});
        setWork({
          stage: "Preparing document chat",
          file: specLabel(doc),
          progress: 30 + Math.round(p.progress * 0.7),
        });
        if (p.done) break;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setFailed((prev) => [...prev, doc.id]);
    } finally {
      running.current = false;
      setWork(null);
    }
  }
  async function upload(files: FileList | null) {
    if (!files || running.current || uploading) return;
    setUploading(true);
    running.current = true;
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        setWork({
          stage: "Uploading specification",
          file: files[i].name,
          progress: Math.round((i / files.length) * 100),
        });
        const ticket = await api(`projects/${pid}/upload-url`, "POST", {
          filename: files[i].name,
          size: files[i].size,
        });
        const uploaded = await fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: files[i],
        });
        if (!uploaded.ok)
          throw new Error(
            "The PDF could not be uploaded to document storage. Check the R2 CORS settings and try again.",
          );
        await api(`projects/${pid}/upload-complete`, "POST", {
          objectKey: ticket.objectKey,
          filename: files[i].name,
          size: files[i].size,
        });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setWork(null);
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function generate() {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      const pending = docs.filter((d) => d.log_version !== SUBMITTAL_LOG_VERSION);
      for (let i = 0; i < pending.length && !dead.current; i++) {
        let done = false;
        setWork({
          stage: "Generating submittal log",
          file: specLabel(pending[i]),
          progress: Math.round((i / pending.length) * 100),
        });
        for (let n = 0; n < 500 && !dead.current; n++) {
          const r = await api(
            `documents/${pending[i].id}/generate`,
            "POST",
            {},
          );
          setWork({
            stage: "Generating submittal log",
            file: specLabel(pending[i]),
            progress: Math.round(
              ((i + r.progress / 100) / pending.length) * 100,
            ),
          });
          if (r.done) {
            if (r.warning) toast.warning(r.warning, { duration: 15000 });
            done = true;
            break;
          }
        }
        if (!done) break;
        await refresh();
      }
      toast.success(
        "Submittal log generated. Compare it with the source before exporting.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setWork(null);
      await refresh();
    }
  }
  async function download(selectedOnly: boolean) {
    try {
      const ids = selected.filter((id) => rows.some((r) => r.id === id));
      if (selectedOnly && !ids.length) return;
      const res = await fetch(
        `/api/projects/${pid}/export?format=${format}&approved=0${selectedOnly ? "&ids=" + ids.join(",") : ""}`,
      );
      if (!res.ok)
        throw new Error(((await res.json()) as { error: string }).error);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download =
        detail.project.name.replace(/[^a-z0-9_-]/gi, "_") +
        (selectedOnly ? "_selected_draft" : "_draft") +
        "." +
        format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const visible = sortSubmittals(rows, sort).filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (
        r.title +
        " " +
        r.section +
        " " +
        r.filename +
        " " +
        r.products.join(" ")
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectable = visible;
  const selectedCount = selected.filter((id) =>
    rows.some((r) => r.id === id),
  ).length;
  const ready = docs.length && docs.every((d) => d.indexed),
    generated =
      docs.length && docs.every((d) => d.log_version === SUBMITTAL_LOG_VERSION),
    progress = work?.progress ?? (generated ? 100 : ready ? 50 : 0);
  function compare(r: Requirement) {
    setInitial({ docId: r.docId!, row: r });
    setTab("specs");
  }
  return (
    <div className="project-workbench">
      {tab === "documents" && (
        <div
          className={"workflow-progress " + (error ? "has-error" : "")}
          aria-live="polite"
        >
          <div className="row space">
            <div className="row">
              {work ? (
                <LoaderCircle className="spin" size={17} />
              ) : generated ? (
                <CheckCheck size={17} />
              ) : (
                <Layers3 size={17} />
              )}
              <b>
                {work?.stage ||
                  (error
                    ? "Processing paused"
                    : generated
                      ? "Submittal log ready"
                      : ready
                        ? "Specifications ready · generate your submittal log"
                        : "Upload specifications to begin")}
              </b>
            </div>
            <span>{progress}%</span>
          </div>
          {work && <small>{work.file}</small>}
          <Progress value={progress} />
          <div className="workflow-stages">
            <span>01 · Upload</span>
            <span>02 · Read & prepare chat</span>
            <span>03 · Generate log</span>
            <span>04 · Edit & export</span>
          </div>
          {error && (
            <div className="workflow-error" role="alert">
              {error}
              <button
                className="text-link"
                onClick={() => {
                  if (failed.length) {
                    setError("");
                    setFailed([]);
                  } else if (ready && !generated) {
                    void generate();
                  } else {
                    setError("");
                  }
                }}
              >
                {failed.length
                  ? "Retry preparation"
                  : ready && !generated
                    ? "Retry generation"
                    : "Dismiss"}
              </button>
            </div>
          )}
        </div>
      )}
      {tab !== "documents" && error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {tab === "documents" && (
        <>
          <div className="section-row">
            <div>
              <h2>Specifications</h2>
              <p className="muted">
                Upload once. Reading and chat preparation start automatically.
              </p>
            </div>
            <button
              className="button orange"
              disabled={!!work || uploading}
              onClick={() => input.current?.click()}
            >
              <Upload size={17} />
              Upload PDFs
            </button>
            <input
              hidden
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => upload(e.target.files)}
            />
          </div>
          <div className="document-list">
            {docs.map((d) => (
              <article className="document-card" key={d.id}>
                <div className="document-row">
                  <div className="document-info">
                    <h3>
                      <button
                        className="spec-list-title"
                        onClick={() => {
                          setInitial({ docId: d.id });
                          setTab("specs");
                        }}
                      >
                        {specLabel(d)}
                      </button>
                    </h3>
                    <p>
                      {d.pages ? `${d.pages} pages · ` : ""}
                      {d.filename}
                    </p>
                  </div>
                  <span
                    className={"badge " + (d.indexed ? "approved" : "review")}
                  >
                    {d.indexed ? "Ready" : "Preparing"}
                  </span>
                </div>
                {d.log_version === SUBMITTAL_LOG_VERSION &&
                  !rows.some((r) => r.docId === d.id) && (
                  <div className="warning-box">
                    {d.empty_review ? (
                      "Source reviewed: " + d.empty_review
                    ) : (
                      <>
                        <span>
                          No submittals detected. Review the source to confirm.
                        </span>
                        <button
                          className="text-link"
                          onClick={() => onEmpty(d)}
                        >
                          Review empty result
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {work && (
            <p className="muted small">
              Keep this workspace open while processing. Completed steps are
              saved.
            </p>
          )}
        </>
      )}
      {tab === "register" && (
        <>
          <div className="section-row">
            <div>
              <h2>Submittal log</h2>
              <p className="muted">{rows.length} submittals</p>
            </div>
            <button
              className="button orange"
              onClick={generate}
              disabled={!!work || !ready || !!generated}
            >
              <Layers3 size={17} />
              {generated ? "Log generated" : "Generate submittal log"}
            </button>
          </div>
          <div className="register-toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search submittals"
                placeholder="Search submittals, sections, products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger aria-label="Filter status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "needs_review", "approved", "rejected"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v === "all"
                      ? "All statuses"
                      : v === "needs_review"
                        ? "Draft"
                        : pretty(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label="Sort submittals" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">Source order</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="log-actions">
            <span>{selectedCount} rows selected</span>
            <div className="row wrap">
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger aria-label="Export format" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">Excel</SelectItem>
                  <SelectItem value="md">Markdown</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
              <button
                className="button secondary small-button"
                disabled={!rows.length}
                onClick={() => download(false)}
              >
                Draft export
              </button>
              <button
                className="button dark small-button"
                disabled={!selectedCount}
                onClick={() => download(true)}
              >
                <Download size={15} />
                Export selected
              </button>
            </div>
          </div>
          {rows.length ? (
            <div className="table-wrap submittal-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Checkbox
                        aria-label="Select all visible rows"
                        disabled={!selectable.length}
                        checked={
                          selectable.length > 0 &&
                          selectable.every((r) => selected.includes(r.id))
                        }
                        onCheckedChange={(v) =>
                          setSelected((prev) =>
                            v
                              ? [
                                  ...new Set([
                                    ...prev,
                                    ...selectable.map((r) => r.id),
                                  ]),
                                ]
                              : prev.filter(
                                  (id) => !selectable.some((r) => r.id === id),
                                ),
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Spec section</TableHead>
                    <TableHead>Submittal title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Groups / Products</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupSubmittals(visible).map(group => <Fragment key={group.key}>
                    <TableRow className="spec-group-row"><TableCell colSpan={6}>
                      <button className="spec-group-toggle" aria-expanded={!collapsedSpecs.includes(group.key)} onClick={() => setCollapsedSpecs(prev => prev.includes(group.key) ? prev.filter(key => key !== group.key) : [...prev, group.key])}>
                        {collapsedSpecs.includes(group.key) ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}
                        <b>{group.section}</b><span>{group.filename}</span><small>{group.rows.length} {group.rows.length === 1 ? "item" : "items"}</small>
                      </button>
                    </TableCell></TableRow>
                  {!collapsedSpecs.includes(group.key) && group.rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className={
                        newRowIds.includes(r.id)
                          ? "new-submittal-row"
                          : undefined
                      }
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${r.title}`}

                          checked={selected.includes(r.id)}
                          onCheckedChange={(v) =>
                            setSelected((prev) =>
                              v
                                ? [...prev, r.id]
                                : prev.filter((id) => id !== r.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <b>{r.section}</b>
                        <small>{r.filename}</small>
                      </TableCell>
                      <TableCell>
                        <button
                          className="submittal-title"
                          onClick={() => onReview(r)}
                        >
                          {r.title}
                        </button>
                        <small className="capitalize">
                          {pretty(r.type)}
                          {r.parentId ? " · Product submittal" : ""}
                          {newRowIds.includes(r.id) ? " · Newly added" : ""}
                        </small>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            "badge " +
                            (r.status === "approved" ? "approved" : "review")
                          }
                        >
                          {r.status === "needs_review"
                            ? "Draft"
                            : pretty(r.status)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button
                          className="products-available"
                          onClick={() => setProductRow(r)}
                        >
                          <Box size={16} />
                          {r.productIds?.length
                            ? `${r.productIds.length} products included`
                            : "Products Available"}
                        </button>
                      </TableCell>
                      <TableCell>
                        <button
                          className="text-link"
                          aria-label={`Compare source for ${r.title}`}
                          onClick={() => compare(r)}
                        >
                          <Eye size={16} />
                          p. {r.page}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                  </Fragment>)}
                </TableBody>
              </Table>
              {!visible.length && (
                <p className="empty-caption">
                  No submittals match your filter.
                </p>
              )}
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <CheckCheck size={32} />
              <h2>Build your submittal log.</h2>
              <p>
                {ready
                  ? "Generate the log, select products, then compare each requirement with its source."
                  : "Upload specifications and wait for automatic preparation to finish."}
              </p>
            </div>
          )}
          <p className="muted small">
            Open a title to edit its details and products. Use the source link
            to compare with the specification. Exports are drafts.
          </p>
        </>
      )}
      {tab === "specs" && (
        <SpecsView
          documents={docs}
          requirements={rows}
          onReview={onReview}
          initial={initial}
        />
      )}
      {tab === "chat" && (
        <DocumentChat
          documents={docs}
          pid={pid}
          legacy={detail.messages.filter((m: any) => !m.doc_id)}
          onSource={onSource}
        />
      )}
      {tab === "activity" && (
        <>
          <div className="section-row">
            <h2>Project activity</h2>
          </div>
          <div className="activity-list">
            {detail.events.map((e: any) => (
              <div key={e.id}>
                <span className="activity-icon">
                  <Clock size={16} />
                </span>
                <div>
                  <b>{e.message}</b>
                  <small>{new Date(e.created).toLocaleString()}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <ProductPanel
        row={productRow}
        onClose={() => setProductRow(null)}
        onSaved={async (ids) => {
          setNewRowIds((previous) => [...new Set([...previous, ...ids])]);
          await refresh();
        }}
        onSource={(p) => {
          setInitial({ docId: productRow!.docId!, product: p });
          setProductRow(null);
          setTab("specs");
        }}
      />
    </div>
  );
}
