"use client";
import { useEffect, useState } from "react";
import { Search, FileText, Box, ArrowLeftRight } from "lucide-react";
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
import { toast } from "sonner";

function ProductCatalogList({
  items,
  search,
  highlight,
  onFocus,
  actionLabel,
  onMove,
  movingId,
  empty,
}: {
  items: Product[];
  search: string;
  highlight: string[];
  onFocus: (item: { page: number; evidenceIds: string[] }) => void;
  actionLabel: string;
  onMove: (productId: string) => void;
  movingId: string | null;
  empty: string;
}) {
  const filtered = items.filter((p) =>
    (p.name + " " + p.group + " " + (p.description || ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const groups = [...new Set(filtered.map((p) => p.group))];
  return (
    <>
      <p className="finding-count">
        {filtered.length} product{filtered.length === 1 ? "" : "s"}
      </p>
      {groups.map((group) => {
        const groupItems = filtered.filter((p) => p.group === group);
        return (
          <details className="product-group" open key={group}>
            <summary
              onMouseEnter={() =>
                onFocus({
                  page: groupItems[0].page,
                  evidenceIds: groupItems.flatMap((p) => p.evidenceIds),
                })
              }
              onFocus={() =>
                onFocus({
                  page: groupItems[0].page,
                  evidenceIds: groupItems.flatMap((p) => p.evidenceIds),
                })
              }
            >
              {group}
              <small>
                {groupItems.length} product
                {groupItems.length === 1 ? "" : "s"}
              </small>
            </summary>
            {groupItems.map((p) => (
              <article
                tabIndex={0}
                onMouseEnter={() => onFocus(p)}
                onFocus={() => onFocus(p)}
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
                {!!p.aliases?.length && (
                  <small>
                    Also referenced as{" "}
                    {p.aliases
                      .map((a) => `${a.name} (${a.clause})`)
                      .join("; ")}
                  </small>
                )}
                {p.classificationReason && (
                  <small className="product-exclude-reason">
                    {p.classificationReason}
                  </small>
                )}
                <small>
                  Page {p.page} · {p.clause}
                </small>
                <button
                  type="button"
                  className="button secondary full product-move-btn"
                  disabled={movingId === p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(p.id);
                  }}
                >
                  <ArrowLeftRight size={15} />
                  {movingId === p.id ? "Moving…" : actionLabel}
                </button>
              </article>
            ))}
          </details>
        );
      })}
      {!filtered.length && <p className="empty-caption">{empty}</p>}
    </>
  );
}

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
    [productTab, setProductTab] = useState(
      initial?.product?.selectable === false ? "excluded" : "approved",
    ),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [movingId, setMovingId] = useState<string | null>(null);
  const doc = documents.find((d) => d.id === docId);
  useEffect(() => {
    if (initial) {
      setDocId(initial.docId);
      setTab(initial.product ? "products" : "submittals");
      if (initial.product)
        setProductTab(
          initial.product.selectable === false ? "excluded" : "approved",
        );
    }
  }, [initial]);
  useEffect(() => {
    let live = true;
    setEvidence([]);
    setProducts([]);
    setExcluded([]);
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
  async function moveProduct(
    productId: string,
    status: "approved" | "excluded",
  ) {
    setMovingId(productId);
    setError("");
    try {
      const result = await api(`documents/${docId}/products`, "POST", {
        productId,
        status,
      });
      setProducts(result.products || []);
      setExcluded(result.excludedProducts || []);
      setProductTab(status === "approved" ? "approved" : "excluded");
      toast.success(
        status === "approved"
          ? "Product moved to approved."
          : "Product moved to excluded.",
      );
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setMovingId(null);
    }
  }
  const rows = requirements.filter(
    (r) =>
      r.docId === docId &&
      (r.title + " " + r.text).toLowerCase().includes(search.toLowerCase()),
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
                <Tabs value={productTab} onValueChange={setProductTab}>
                  <TabsList className="finding-tabs product-catalog-tabs">
                    <TabsTrigger value="approved">
                      Approved ({products.length})
                    </TabsTrigger>
                    <TabsTrigger value="excluded">
                      Excluded ({excluded.length})
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="approved">
                    <ProductCatalogList
                      items={products}
                      search={search}
                      highlight={highlight}
                      onFocus={focus}
                      actionLabel="Move to excluded"
                      onMove={(id) => moveProduct(id, "excluded")}
                      movingId={movingId}
                      empty={
                        products.length
                          ? "No approved products match this search."
                          : "No approved products yet. Generate the submittal log, or move items here from Excluded."
                      }
                    />
                  </TabsContent>
                  <TabsContent value="excluded">
                    <ProductCatalogList
                      items={excluded}
                      search={search}
                      highlight={highlight}
                      onFocus={focus}
                      actionLabel="Move to approved"
                      onMove={(id) => moveProduct(id, "approved")}
                      movingId={movingId}
                      empty={
                        excluded.length
                          ? "No excluded products match this search."
                          : "No excluded product candidates for this specification."
                      }
                    />
                  </TabsContent>
                </Tabs>
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
