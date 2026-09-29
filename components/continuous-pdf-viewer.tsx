"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Evidence } from "@/lib/domain/models";
import { LoaderCircle } from "lucide-react";
function Page({
  pdf,
  number,
  evidence,
  defaultRatio,
}: {
  defaultRatio: number;
  pdf: PDFDocumentProxy;
  number: number;
  evidence: Evidence[];
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false),
    [ratio, setRatio] = useState(defaultRatio),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: el.closest("[data-source-scroll]"), rootMargin: "1200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let dead = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setReady(false);
    setError("");
    (async () => {
      const p = await pdf.getPage(number);
      if (dead || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      setRatio(base.width / base.height);
      const viewport = p.getViewport({ scale: 1000 / base.width });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      render = p.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (!dead) setReady(true);
    })().catch(() => {
      if (!dead) setError("Unable to render this page. Open the original PDF.");
    });
    return () => {
      dead = true;
      render?.cancel();
    };
  }, [near, pdf, number]);
  return (
    <div ref={holder} className="continuous-pdf-page" data-pdf-page={number}>
      <div className="pdf-page-label">Page {number}</div>
      <div className="pdf-paper" style={{ aspectRatio: String(ratio) }}>
        {near && (
          <canvas
            ref={canvas}
            style={{ visibility: ready ? "visible" : "hidden" }}
          />
        )}
        {near && !ready && !error && (
          <div className="pdf-page-loading">
            <LoaderCircle className="spin" size={18} />
          </div>
        )}
        {error && <p className="error-box">{error}</p>}
        {ready &&
          near &&
          evidence
            .filter((e) => e.box)
            .map((e) => (
              <div
                className="evidence-highlight"
                key={e.id}
                title={e.text}
                style={{
                  left: e.box![0] * 100 + "%",
                  top: e.box![1] * 100 + "%",
                  width: e.box![2] * 100 + "%",
                  height: e.box![3] * 100 + "%",
                }}
              />
            ))}
      </div>
      {evidence.some((e) => !e.box) && (
        <p className="muted small">
          OCR source: compare the cited text with this page.
        </p>
      )}
    </div>
  );
}
export default function ContinuousPDFViewer({
  docId,
  page,
  evidence,
}: {
  docId: string;
  page: number;
  evidence: Evidence[];
}) {
  const [defaultRatio, setDefaultRatio] = useState(0.707);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setPdf(null);
    setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (dead) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      task = pdfjs.getDocument({ url: `/api/documents/${docId}/pdf` });
      const document = await task.promise;
      const firstPage = await document.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      if (!dead) {
        setDefaultRatio(viewport.width / viewport.height);
        setPdf(document);
      }
    })().catch(() => {
      if (!dead)
        setError("The PDF could not load. Open the original PDF or try again.");
    });
    return () => {
      dead = true;
      void task?.destroy();
    };
  }, [docId]);
  const evidenceKey = evidence.map((e) => e.id).join(",");
  useEffect(() => {
    if (!pdf || !evidence.length) return;
    const frame = requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(
        `[data-pdf-page="${page}"]`,
      );
      const scroller = root.current?.closest<HTMLElement>(
        "[data-source-scroll]",
      );
      if (!el || !scroller) return;
      const first = evidence.find((e) => e.page === page && e.box);
      const paper = el.querySelector<HTMLElement>(".pdf-paper");
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        (first?.box?.[1] || 0) * (paper?.clientHeight || 0) -
        60;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pdf, page, evidenceKey]);
  return (
    <div ref={root} className="continuous-pdf">
      <div className="pdf-toolbar">
        <span>
          Original specification {pdf ? `· ${pdf.numPages} pages` : ""}
        </span>
        <a
          href={`/api/documents/${docId}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          Open original ↗
        </a>
      </div>
      {error && <p className="error-box">{error}</p>}
      {!pdf && !error && (
        <div className="pdf-loading">
          <LoaderCircle className="spin" />
          Loading specification…
        </div>
      )}
      {pdf &&
        Array.from({ length: pdf.numPages }, (_, i) => (
          <Page
            key={i + 1}
            pdf={pdf}
            defaultRatio={defaultRatio}
            number={i + 1}
            evidence={evidence.filter((e) => e.page === i + 1)}
          />
        ))}
    </div>
  );
}
