"use client";
import { useEffect, useState } from "react";
import { Search, FileText, Box } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Evidence, Requirement } from "@/lib/domain/models";
import { Product } from "@/lib/domain/submittals";
import { api, pretty, specLabel } from "@/lib/api-client";
import ContinuousPDFViewer from "../continuous-pdf-viewer";
export default function SpecsView({
  documents,
  requirements,
  onReview,
  initial,
}: {
  documents: any[];
  requirements: Requirement[];
  onReview: (r: Requirement) => void;
  initial?: { docId: string; product?: Product; row?: Requirement } | null;
}) {
  const [docId, setDocId] = useState(initial?.docId || documents[0]?.id || ""),
    [evidence, setEvidence] = useState<Evidence[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [excluded, setExcluded] = useState<Product[]>([]),
    [page, setPage] = useState(1),
    [highlight, setHighlight] = useState<string[]>([]),
    [tab, setTab] = useState(initial?.product ? "products" : "submittals"),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const doc = documents.find((d) => d.id === docId);
  useEffect(() => {
    if (initial) {
      setDocId(initial.docId);
      setTab(initial.product ? "products" : "submittals");
    }
  }, [initial]);
  useEffect(() => {
    let live = true;
    setEvidence([]);
    setProducts([]);
    setPage(1);
    setHighlight([]);
    setError("");
    if (docId)
      Promise.all([
        api(`documents/${docId}/evidence`),
        api(`documents/${docId}/products`),
      ])
        .then(([e, p]) => {
          if (live) {
            setEvidence(e.evidence);
            setProducts(p.products);
            setExcluded(p.excludedProducts || []);
            const item =
              initial && initial.docId === docId
                ? initial.product || initial.row
                : null;
            if (item) {
              setPage(item.page);
              setHighlight(item.evidenceIds);
            }
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [docId, initial]);
  function focus(item: { page: number; evidenceIds: string[] }) {
    setPage(item.page);
    setHighlight(item.evidenceIds);
  }
  const rows = requirements.filter(
    (r) =>
      r.docId === docId &&
      (r.title + " " + r.text).toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = products.filter((p) =>
    (p.name + " " + p.group).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="specs-workspace">
      <div className="specs-heading">
        <Select value={docId} onValueChange={setDocId}>
          <SelectTrigger aria-label="Specification to compare">
            <SelectValue placeholder="Select specification" />
          </SelectTrigger>
          <SelectContent>
            {documents.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {specLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <div className="error-box">{error}</div>}
      {doc ? (
        <div className="specs-columns">
          <div className="specs-original" data-source-scroll>
            <ContinuousPDFViewer
              key={docId}
              docId={docId}
              page={page}
              evidence={evidence.filter((e) => highlight.includes(e.id))}
            />
          </div>
          <aside className="specs-findings">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="finding-tabs">
                <TabsTrigger value="submittals">
                  <FileText size={15} />
                  Submittals
                </TabsTrigger>
                <TabsTrigger value="products">
                  <Box size={15} />
                  Products
                </TabsTrigger>
              </TabsList>
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search findings"
                  placeholder={`Search ${tab}…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <p className="muted small">
                Hover or focus a card to highlight its source.
              </p>
              <TabsContent value="submittals">
                <p className="finding-count">{rows.length} submittals</p>
                {rows.map((r) => (
                  <article
                    tabIndex={0}
                    onMouseEnter={() => focus(r)}
                    onFocus={() => focus(r)}
                    key={r.id}
                    className={
                      "finding-card " +
                      (r.evidenceIds.some((id) => highlight.includes(id))
                        ? "active"
                        : "")
                    }
                  >
                    <span className="badge review capitalize">
                      {pretty(r.type)}
                    </span>
                    <h3>{r.title}</h3>
                    <p>{r.text}</p>
                    {r.condition && (
                      <p>
                        <b>Condition:</b> {r.condition}
                      </p>
                    )}
                    <button
                      className="button secondary full"
                      onClick={() => onReview(r)}
                    >
                      Edit submittal
                    </button>
                  </article>
                ))}
                {!rows.length && (
                  <p className="empty-caption">
                    Generate a submittal log to review its source here.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="products">
                <p className="finding-count">{filtered.length} products</p>
                {!!excluded.length && <details className="product-group"><summary>{excluded.length} excluded candidates · view reasons</summary>{excluded.map(p=><div className="product-option" key={p.id}><button className="product-name" >{p.name}<small>{p.classificationReason}</small></button></div>)}</details>}
                {[...new Set(filtered.map((p) => p.group))].map((group) => {
                  const items = filtered.filter((p) => p.group === group);
                  return (
                    <details className="product-group" open key={group}>
                      <summary
                        onMouseEnter={() =>
                          focus({
                            page: items[0].page,
                            evidenceIds: items.flatMap((p) => p.evidenceIds),
                          })
                        }
                        onFocus={() =>
                          focus({
                            page: items[0].page,
                            evidenceIds: items.flatMap((p) => p.evidenceIds),
                          })
                        }
                      >
                        {group}
                        <small>{items.length} products</small>
                      </summary>
                      {items.map((p) => (
                        <article
                          tabIndex={0}
                          onMouseEnter={() => focus(p)}
                          onFocus={() => focus(p)}
                          className={
                            "finding-card product-finding " +
                            (p.evidenceIds.some((id) => highlight.includes(id))
                              ? "active"
                              : "")
                          }
                          key={p.id}
                        >
                          <h3>
                            <Box size={16} />
                            {p.name}
                          </h3>
                          <p>{p.description}</p>
                          <small>
                            Page {p.page} · {p.clause}
                          </small>
                        </article>
                      ))}
                    </details>
                  );
                })}
                {!products.length && (
                  <p className="empty-caption">
                    Products appear after log generation when the specification
                    contains a product catalog.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      ) : (
        <p className="empty-caption">Upload a specification to begin.</p>
      )}
    </div>
  );
}
