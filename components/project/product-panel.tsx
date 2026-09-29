"use client";
import { useEffect, useState } from "react";
import {
  Box,
  ChevronDown,
  Search,
  ArrowLeft,
  LoaderCircle,
  Plus,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Requirement } from "@/lib/domain/models";
import { Product, productDraft } from "@/lib/domain/submittals";
import { api, pretty } from "@/lib/api-client";
import { toast } from "sonner";
export default function ProductPanel({
  row,
  onClose,
  onSaved,
  onSource,
}: {
  row: Requirement | null;
  onClose: () => void;
  onSaved: (createdIds: string[]) => Promise<void>;
  onSource: (p: Product) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [step, setStep] = useState(0),
    [mode, setMode] = useState("individual"),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setSelected(row?.productIds || []);
    setStep(0);
    setSearch("");
    setError("");
    setProducts([]);
    if (row) {
      setLoading(true);
      api(`documents/${row.docId}/products`)
        .then((d) => {
          if (live) {
            if (!d.complete)
              setError(
                "Generate the submittal log to prepare the full product catalog.",
              );
            else setProducts([...d.products, ...(d.excludedProducts || []).filter((p:Product)=>row?.productIds?.includes(p.id))]);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }
    return () => {
      live = false;
    };
  }, [row]);
  const chosen = products.filter((p) => selected.includes(p.id));
  const hasExcluded = chosen.some(p=>p.selectable===false);
  const drafts = row
    ? (mode === "combined" ? [chosen] : chosen.map((p) => [p]))
        .filter((p) => p.length)
        .map((p) => productDraft(row, p, mode === "combined" ? "combined" : "individual"))
    : [];
  const filtered = products.filter((p) =>
    (p.name + " " + p.group).toLowerCase().includes(search.toLowerCase()),
  );
  const groups = [...new Set(filtered.map((p) => p.group))];
  const toggle = (ids: string[], checked: boolean) =>
    setSelected((prev) =>
      checked
        ? [...new Set([...prev, ...ids.filter(id=>products.find(p=>p.id===id)?.selectable!==false)])]
        : prev.filter((id) => !ids.includes(id)),
    );
  return (
    <Sheet
      open={!!row}
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <SheetContent className="product-sheet">
        <SheetHeader>
          <SheetTitle>Groups &amp; Products</SheetTitle>
          <SheetDescription>
            {row?.section} · {row?.title}
          </SheetDescription>
        </SheetHeader>
        <div className="product-sheet-body">
          <span className="badge review capitalize">
            {pretty(row?.type || "")}
          </span>
          {step === 0 ? (
            <>
              <div className="search-field">
                <Search size={17} />
                <input
                  aria-label="Search groups and products"
                  placeholder="Search groups & products…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <p className="muted small">
                Products from this specification. Verify their applicability
                when reviewing the submittal.
              </p>
              {loading ? (
                <p className="row">
                  <LoaderCircle className="spin" />
                  Loading products…
                </p>
              ) : error ? (
                <div role="alert" className="error-box">
                  {error}
                </div>
              ) : !products.length ? (
                <p className="empty-caption">
                  No sourced products found. Generate the submittal log first;
                  some specifications contain no product catalog.
                </p>
              ) : (
                groups.map((group) => {
                  const items = filtered.filter((p) => p.group === group),
                    ids = items.map((p) => p.id),
                    count = ids.filter((id) => selected.includes(id)).length;
                  return (
                    <details open className="product-group" key={group}>
                      <summary>
                        <ChevronDown size={15} />
                        <Checkbox
                          aria-label={`Select ${group}`}
                          checked={
                            count === ids.length
                              ? true
                              : count
                                ? "indeterminate"
                                : false
                          }
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={(v) => toggle(ids, v === true)}
                        />
                        <b>{group}</b>
                        <small>{items.length} products</small>
                      </summary>
                      {items.map((p) => (
                        <div
                          className={
                            "product-option " +
                            (selected.includes(p.id) ? "selected" : "")
                          }
                          key={p.id}
                        >
                          <Checkbox
                            aria-label={`Select ${p.name}`}
                            disabled={p.selectable === false && !selected.includes(p.id)}
                            checked={selected.includes(p.id)}
                            onCheckedChange={(v) => toggle([p.id], v === true)}
                          />
                          <Box size={17} />
                          <button
                            className="product-name"
                            onClick={() => onSource(p)}
                            title="Compare with source specification"
                          >
                            {p.name}
                            <small>{p.description}</small>{p.usageStatus === "conditional" && <small>Conditional: {p.condition || p.quote}</small>}{p.selectable === false && <small role="alert">Previously linked · {p.classificationReason} Remove this selection if it is not applicable.</small>}
                          </button>
                        </div>
                      ))}
                    </details>
                  );
                })
              )}
            </>
          ) : step === 1 ? (
            <>
              <h3>How should these products be submitted?</h3>
              <RadioGroup
                value={mode}
                onValueChange={setMode}
                className="submission-options"
              >
                <label>
                  <RadioGroupItem value="combined" />
                  <div>
                    <b>One combined submittal</b>
                    <p>
                      Include all {chosen.length} products in a single new row.
                    </p>
                  </div>
                </label>
                <label>
                  <RadioGroupItem value="individual" />
                  <div>
                    <b>One submittal per product</b>
                    <p>
                      Create {chosen.length} individual rows, one for each
                      product.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </>
          ) : (
            <>
              <h3>
                Preview {drafts.length} new submittal
                {drafts.length === 1 ? "" : "s"}
              </h3>
              <p className="muted">
                Confirm adds these rows as drafts. You can edit them or compare
                them with the specification.
              </p>
              {drafts.map((r, i) => (
                <article className="generated-card" key={i}>
                  <Plus size={18} />
                  <div>
                    <span className="badge review capitalize">
                      {pretty(r.type)}
                    </span>
                    <h3>
                      {r.section} — {r.title}
                    </h3>
                    <p>{r.text}</p>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
        <div className="product-sheet-footer">
          <span>{chosen.length} products selected</span>
          <div className="row wrap">
            {step === 0 && (
              <button
                className="button secondary"
                disabled={saving || loading || !!error}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api(`requirements/${row!.id}/products`, "POST", {
                      productIds: selected,
                      mode: "attach",
                      revision: row!.revision,
                    });
                    await onSaved([]);
                    toast.success("Products saved to this submittal.");
                    onClose();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving && <LoaderCircle className="spin" size={16} />}
                Save to this submittal
              </button>
            )}
            {step > 0 && (
              <button
                className="button secondary"
                disabled={saving}
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}
            {step < 2 ? (
              <button
                className="button orange"
                disabled={!chosen.length || hasExcluded || loading || saving || !!error}
                onClick={() => setStep(step + 1)}
              >
                {step === 0 ? "Create new submittals" : "Preview submittals"}
              </button>
            ) : (
              <button
                className="button orange"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const result = await api(
                      `requirements/${row!.id}/products`,
                      "POST",
                      {
                        productIds: selected,
                        mode,
                      },
                    );
                    await onSaved(result.createdIds || []);
                    toast.success("Product submittals added.");
                    onClose();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? <LoaderCircle className="spin" size={16} /> : null}
                Confirm
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
