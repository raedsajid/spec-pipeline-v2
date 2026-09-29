"use client";
import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@/lib/domain/models";
import { LoaderCircle } from "lucide-react";
export default function PDFViewer({
  docId,
  page,
  evidence = [],
  autoScroll = false,
}: {
  docId: string;
  page: number;
  evidence?: Evidence[];
  autoScroll?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let dead = false,
      task: any,
      render: any;
    setLoading(true);
    setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (dead) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      task = pdfjs.getDocument({ url: "/api/documents/" + docId + "/pdf" });
      const pdf = await task.promise;
      if (dead) return;
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 }),
        viewport = p.getViewport({ scale: 900 / base.width });
      const el = canvas.current;
      if (!el || dead) return;
      el.width = viewport.width;
      el.height = viewport.height;
      render = p.render({ canvas: el, viewport });
      await render.promise;
      if (!dead) setLoading(false);
    })().catch((e) => {
      if (!dead) {
        setError(
          "The page could not be rendered. Open the original PDF below.",
        );
        setLoading(false);
      }
    });
    return () => {
      dead = true;
      render?.cancel();
      task?.destroy();
    };
  }, [docId, page]);
  useEffect(() => {
    if (!autoScroll || loading) return;
    const frame = requestAnimationFrame(() => {
      const target = wrapper.current?.querySelector<HTMLElement>(
        ".evidence-highlight",
      );
      const scroller = wrapper.current?.closest<HTMLElement>(
        "[data-source-scroll]",
      );
      if (target && scroller) {
        const top =
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop -
          scroller.clientHeight / 3;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, evidence, page, loading]);
  return (
    <div className="pdf-view" ref={wrapper}>
      <div className="pdf-toolbar">
        <span>
          ORIGINAL PDF <b>Page {page}</b>
        </span>
        <a
          href={`/api/documents/${docId}/pdf#page=${page}`}
          target="_blank"
          rel="noreferrer"
        >
          Open original ↗
        </a>
      </div>
      {loading && (
        <div className="pdf-loading">
          <LoaderCircle className="spin" /> Loading page…
        </div>
      )}
      {error && <p className="error-box">{error}</p>}
      <div className="pdf-paper">
        <canvas ref={canvas} />
        {!loading &&
          !error &&
          evidence
            .filter((e) => e.page === page && e.box)
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
      {evidence.some((e) => e.page === page && !e.box) && (
        <p className="muted">
          OCR evidence has no exact bounding box. Compare its text with the
          original page.
        </p>
      )}
    </div>
  );
}
