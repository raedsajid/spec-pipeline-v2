"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Requirement } from "@/lib/domain/models";
import { Product } from "@/lib/domain/submittals";
import {
  prioritizeProductGroups,
  suggestProductsForRequirement,
} from "@/lib/domain/product-suggestions";
import { api, pretty } from "@/lib/api-client";
import { Save, LoaderCircle, Sparkles } from "lucide-react";
export default function EditSubmittalPanel({
  row,
  onClose,
  onSave,
}: {
  row: Requirement | null;
  onClose: () => void;
  onSave: (row: Requirement, confirmed: boolean) => Promise<void>;
}) {
  const [edit, setEdit] = useState<Requirement | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [prioritize, setPrioritize] = useState(true);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    seededFor.current = null;
    setEdit(row ? { ...row } : null);
    setProducts([]);
    setError("");
    setPrioritize(true);
    setLoading(!!row);
    if (row)
      api(`documents/${row.docId}/products`)
        .then((d) => {
          if (live)
            setProducts([
              ...d.products,
              ...(d.excludedProducts || []).filter((p: Product) =>
                row?.productIds?.includes(p.id),
              ),
            ]);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    return () => {
      live = false;
    };
  }, [row]);
  const suggestions = useMemo(
    () =>
      edit && products.length
        ? suggestProductsForRequirement(edit, products)
        : [],
    [edit, products],
  );
  const suggestedIds = useMemo(
    () => new Set(suggestions.map((s) => s.id)),
    [suggestions],
  );
  useEffect(() => {
    if (!edit || loading || !products.length || seededFor.current === edit.id)
      return;
    seededFor.current = edit.id;
    if (edit.productIds?.length) return;
    if (prioritize && suggestions.length)
      setEdit((prev) =>
        prev ? { ...prev, productIds: suggestions.map((s) => s.id) } : prev,
      );
  }, [edit?.id, edit?.productIds, loading, products.length, suggestions, prioritize]);
  if (!row || !edit) return null;
  const set = (key: string, value: unknown) =>
    setEdit({ ...edit, [key]: value });
  function setPrioritizeAndSelection(on: boolean) {
    setPrioritize(on);
    if (on) set("productIds", suggestions.map((s) => s.id));
    else
      set(
        "productIds",
        (edit!.productIds || []).filter((id) => !suggestedIds.has(id)),
      );
  }
  const toggle = (ids: string[], checked: boolean) =>
    set(
      "productIds",
      checked
        ? [
            ...new Set([
              ...(edit.productIds || []),
              ...ids.filter(
                (id) => products.find((p) => p.id === id)?.selectable !== false,
              ),
            ]),
          ]
        : (edit.productIds || []).filter((id) => !ids.includes(id)),
    );
  const rankedGroups = prioritizeProductGroups(
    products,
    suggestedIds,
    prioritize,
  );
  return (
    <Sheet
      open={!!row}
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <SheetContent className="edit-submittal-sheet">
        <SheetHeader>
          <SheetTitle>Edit submittal</SheetTitle>
          <SheetDescription>
            {row.filename} · {row.section}
          </SheetDescription>
        </SheetHeader>
        <form
          className="edit-submittal-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              await onSave({ ...edit, status: "needs_review" }, false);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="edit-submittal-fields">
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <label>
              Submittal title
              <input
                required
                maxLength={240}
                value={edit.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label>
              Deliverable type
              <Select value={edit.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "product_data",
                    "shop_drawings",
                    "sample",
                    "certification",
                    "test_report",
                    "quality_control",
                    "operation_and_maintenance",
                    "closeout",
                    "warranty",
                    "other",
                  ].map((t) => (
                    <SelectItem key={t} value={t}>
                      {pretty(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              Requirement
              <textarea
                required
                rows={5}
                maxLength={6000}
                value={edit.text}
                onChange={(e) => set("text", e.target.value)}
              />
            </label>
            <label>
              Condition, if any
              <textarea
                rows={2}
                maxLength={1500}
                value={edit.condition}
                onChange={(e) => set("condition", e.target.value)}
              />
            </label>
            <h3>Groups &amp; Products</h3>
            {loading ? (
              <p>Loading products…</p>
            ) : products.length ? (
              <>
                <div className="suggestion-toolbar">
                  <label className="suggestion-toggle">
                    <Sparkles size={16} aria-hidden />
                    <span>Prioritize suggestions</span>
                    <Switch
                      checked={prioritize}
                      onCheckedChange={setPrioritizeAndSelection}
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
                      onClick={() => {
                        setPrioritize(true);
                        set("productIds", suggestions.map((s) => s.id));
                      }}
                    >
                      Reset to suggestions
                    </button>
                  )}
                </div>
                {rankedGroups.map(({ group, items, matches }) => {
                  const ids = items.map((p) => p.id),
                    count = ids.filter((id) =>
                      edit.productIds?.includes(id),
                    ).length;
                  return (
                    <details className="product-group" open key={group}>
                      <summary>
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
                        {group}
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
                        <label
                          className={
                            "product-option " +
                            (edit.productIds?.includes(p.id) ? "selected" : "")
                          }
                          key={p.id}
                        >
                          <Checkbox
                            checked={edit.productIds?.includes(p.id) || false}
                            onCheckedChange={(v) =>
                              toggle([p.id], v === true)
                            }
                          />
                          <span>
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
                          </span>
                        </label>
                      ))}
                    </details>
                  );
                })}
              </>
            ) : (
              <p className="muted">
                No product catalog is available for this specification.
              </p>
            )}
          </div>
          <div className="edit-submittal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button orange"
              disabled={saving || loading}
            >
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save changes
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
