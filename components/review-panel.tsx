"use client";
import { useEffect, useState } from "react";
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
import { Requirement } from "@/lib/domain/models";
import { Product } from "@/lib/domain/submittals";
import { api, pretty } from "@/lib/api-client";
import { Save, LoaderCircle } from "lucide-react";
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
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setEdit(row ? { ...row } : null);
    setProducts([]);
    setError("");
    setLoading(!!row);
    if (row)
      api(`documents/${row.docId}/products`)
        .then((d) => {
          if (live) setProducts([...d.products, ...(d.excludedProducts || []).filter((p:Product)=>row?.productIds?.includes(p.id))]);
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
  if (!row || !edit) return null;
  const set = (key: string, value: unknown) =>
    setEdit({ ...edit, [key]: value });
  const toggle = (ids: string[], checked: boolean) =>
    set(
      "productIds",
      checked
        ? [...new Set([...(edit.productIds || []), ...ids.filter(id=>products.find(p=>p.id===id)?.selectable!==false)])]
        : (edit.productIds || []).filter((id) => !ids.includes(id)),
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
              [...new Set(products.map((p) => p.group))].map((group) => {
                const items = products.filter((p) => p.group === group),
                  ids = items.map((p) => p.id),
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
                      <small>{items.length} products</small>
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
                          onCheckedChange={(v) => toggle([p.id], v === true)}
                        />
                        <span>
                          {p.name}
                          <small>{p.description}</small>{p.usageStatus === "conditional" && <small>Conditional: {p.condition || p.quote}</small>}{p.selectable === false && <small role="alert">Previously linked · {p.classificationReason} Remove this selection if it is not applicable.</small>}
                        </span>
                      </label>
                    ))}
                  </details>
                );
              })
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
