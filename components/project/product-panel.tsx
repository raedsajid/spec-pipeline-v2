"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  Search,
  ArrowLeft,
  LoaderCircle,
  Plus,
  Sparkles,
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
import { Switch } from "@/components/ui/switch";
import { Requirement } from "@/lib/domain/models";
import { Product, productDraft } from "@/lib/domain/submittals";
import {
  prioritizeProductGroups,
  suggestProductsForRequirement,
} from "@/lib/domain/product-suggestions";
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
    [error, setError] = useState(""),
    [prioritize, setPrioritize] = useState(true);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    seededFor.current = null;
    setSelected(row?.productIds || []);
    setStep(0);
    setSearch("");
    setError("");
    setProducts([]);
    setPrioritize(true);
    if (row) {
      setLoading(true);
      api(`documents/${row.docId}/products`)
        .then((d) => {
          if (live) {
            if (!d.complete)
              setError(
                "Generate the submittal log to prepare the full product catalog.",
              );
            else
              setProducts([
                ...d.products,
                ...(d.excludedProducts || []).filter((p: Product) =>
                  row?.productIds?.includes(p.id),
                ),
              ]);
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
  const suggestions = useMemo(
    () => (row && products.length ? suggestProductsForRequirement(row, products) : []),
    [row, products],
  );
  const suggestedIds = useMemo(
    () => new Set(suggestions.map((s) => s.id)),
    [suggestions],
  );
  useEffect(() => {
    if (!row || loading || !products.length || seededFor.current === row.id)
      return;
    seededFor.current = row.id;
    if (!(row.productIds && row.productIds.length) && suggestions.length)
      setSelected(suggestions.map((s) => s.id));
  }, [row, loading, products, suggestions]);
  const chosen = products.filter((p) => selected.includes(p.id));
  const hasExcluded = chosen.some((p) => p.selectable === false);
  const drafts = row
    ? mode === "combined"
      ? [
          {
            ...row,
            productIds: chosen.map((p) => p.id),
            products: chosen.map((p) => p.name),
            productMode: "combined" as const,
          },
        ]
      : chosen
          .map((p) => [p])
          .filter((p) => p.length)
          .map((p) => productDraft(row, p, "individual"))
    : [];
  const filtered = products.filter((p) =>
    (p.name + " " + p.group).toLowerCase().includes(search.toLowerCase()),
  );
  const rankedGroups = prioritizeProductGroups(
    filtered,
    suggestedIds,
    prioritize,
  );
  const toggle = (ids: string[], checked: boolean) =>
    setSelected((prev) =>
      checked
        ? [
            ...new Set([
              ...prev,
              ...ids.filter(
                (id) => products.find((p) => p.id === id)?.selectable !== false,
              ),
            ]),
          ]
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
              {!!products.length && !loading && !error && (
                <div className="suggestion-toolbar">
                  <label className="suggestion-toggle">
                    <Sparkles size={16} aria-hidden />
                    <span>Prioritize suggestions</span>
                    <Switch
                      checked={prioritize}
                      onCheckedChange={setPrioritize}
                      aria-label="Prioritize suggestions"
                    />
                    {prioritize && suggestions.length > 0 && (
                      <span className="suggestion-match-pill">
                        {suggestions.length} match
                        {suggestions.length === 1 ? "" : "es"}
                      </span>
                    )}
                  </label>
                  {suggestions.length > 0 && (
                    <button
                      type="button"
                      className="text-link suggestion-reset"
                      onClick={() =>
                        setSelected(suggestions.map((s) => s.id))
                      }
                    >
                      Reset to suggestions
                    </button>
                  )}
                </div>
              )}
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
                rankedGroups.map(({ group, items, matches }) => {
                  const ids = items.map((p) => p.id),
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
                        {prioritize && matches > 0 && (
                          <span className="suggestion-match-pill">
                            {matches} match{matches === 1 ? "" : "es"}
                          </span>
                        )}
                        <small>
                          {items.length} product{items.length === 1 ? "" : "s"}
                        </small>
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
                            disabled={
                              p.selectable === false &&
                              !selected.includes(p.id)
                            }
                            checked={selected.includes(p.id)}
                            onCheckedChange={(v) =>
                              toggle([p.id], v === true)
                            }
                          />
                          <Box size={17} />
                          <button
                            className="product-name"
                            onClick={() => onSource(p)}
                            title="Compare with source specification"
                          >
                            <span className="product-name-row">
                              {p.name}
                              {prioritize && suggestedIds.has(p.id) && (
                                <Sparkles
                                  size={14}
                                  className="suggestion-sparkle"
                                  aria-label="Suggested for this submittal"
                                />
                              )}
                            </span>
                            <small>{p.description}</small>
                            {!!p.aliases?.length && (
                              <small>
                                Also referenced as{" "}
                                {p.aliases.map((a) => a.name).join("; ")}
                              </small>
                            )}
                            {p.usageStatus === "conditional" && (
                              <small>
                                Conditional: {p.condition || p.quote}
                              </small>
                            )}
                            {p.selectable === false && (
                              <small role="alert">
                                Previously linked · {p.classificationReason}{" "}
                                Remove this selection if it is not applicable.
                              </small>
                            )}
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
                      Include all {chosen.length} products on this row. Replaces
                      any earlier product rows created from it.
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
                {mode === "combined"
                  ? "Preview update to this submittal"
                  : `Preview ${drafts.length} new submittal${drafts.length === 1 ? "" : "s"}`}
              </h3>
              <p className="muted">
                {mode === "combined"
                  ? "Confirm updates this row with the selected products and removes duplicate product packages from it."
                  : "Confirm adds these rows as drafts. You can edit them or compare them with the specification."}
              </p>
              {drafts.map((r, i) => (
                <article className="generated-card" key={i}>
                  {mode === "combined" ? <Box size={18} /> : <Plus size={18} />}
                  <div>
                    <span className="badge review capitalize">
                      {pretty(r.type)}
                    </span>
                    <h3>
                      {r.section} — {r.title}
                    </h3>
                    <p>
                      {chosen.length} product{chosen.length === 1 ? "" : "s"}{" "}
                      included
                      {mode === "combined" ? " on this submittal" : ""}
                    </p>
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
                disabled={
                  !chosen.length ||
                  hasExcluded ||
                  loading ||
                  saving ||
                  !!error
                }
                onClick={() => setStep(step + 1)}
              >
                {step === 0
                  ? "Create new submittals"
                  : mode === "combined"
                    ? "Preview update"
                    : "Preview submittals"}
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
                        ...(mode === "combined"
                          ? { revision: row!.revision }
                          : {}),
                      },
                    );
                    await onSaved(result.createdIds || []);
                    toast.success(
                      mode === "combined"
                        ? "Products saved on this submittal."
                        : "Product submittals added.",
                    );
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
