import { correctSections } from "@/lib/domain/specifications";
import { z } from "zod";
import { catalog } from "./submittals";
import {
  AppError,
  ParsedDocument,
  Requirement,
  RequirementSchema,
  validateRequirement,
  mayApprove,
  User,
} from "@/lib/domain/models";
import { one, run, getJSON, now, event, ownedDoc } from "@/lib/server/store";
import { parsedKey } from "./documents";
import { SUBMITTAL_LOG_VERSION } from "@/lib/domain/submittals";
export async function reviewRequirement(rid: string, u: User, b: any) {
  const row = await one(
    "SELECT r.*,pd.hash,pd.project_id FROM requirements r JOIN project_docs pd ON pd.id=r.doc_id JOIN projects p ON p.id=pd.project_id WHERE r.id=? AND p.user_id=?",
    rid,
    u.id,
  );
  if (!row) throw new AppError(404, "Requirement not found.");
  const cached = await getJSON<ParsedDocument>(parsedKey(row.hash));
  const parsed = cached ? correctSections(cached) : null;
  if (!parsed) throw new AppError(409, "Source evidence is unavailable.");
  const input = RequirementSchema.parse(b.data);
  let productIds: string[] | undefined = JSON.parse(row.data).productIds;
  if (b.data.productIds !== undefined) {
    productIds = [
      ...new Set(z.array(z.string()).max(60).parse(b.data.productIds)),
    ];
    const available = await catalog(row.doc_id, u.id);
    const chosen = productIds.map((id) =>
      available.products.find((p) => p.id === id) || (JSON.parse(row.data).productIds?.includes(id) ? available.excludedProducts.find(p=>p.id===id) : undefined),
    );
    if (chosen.some((p) => !p))
      throw new AppError(400, "Choose products from this specification.");
    input.products = chosen.map((p) => p!.name);
  }
  const ev = parsed.evidence.find((e) => input.evidenceIds.includes(e.id));
  const r: Requirement = {
    ...input,
    parentId: JSON.parse(row.data).parentId,
    productMode: JSON.parse(row.data).productMode,
    productIds,
    id: rid,
    section: ev?.section || "Unresolved",
    page: ev?.page || 1,
    clause: ev?.clause || "",
    ...validateRequirement(input, parsed.evidence),
    status: "needs_review",
  };
  if (r.parentId || r.productIds?.length)
    r.warnings.push(
      "Verify that the selected products are covered by this submittal requirement.",
    );
  const note = String(b.reviewNote || "").slice(0, 2000);
  if (b.status === "approved") {
    if (!mayApprove(r, b.confirmed === true, note))
      throw new AppError(
        422,
        "Verify the source, fix blocking evidence errors, and add a review note for warnings before approval.",
      );
    r.status = "approved";
  } else if (b.status === "rejected") {
    if (note.trim().length < 8)
      throw new AppError(
        422,
        "Add a short reason before rejecting a requirement.",
      );
    r.status = "rejected";
  }
  const result = await run(
    "UPDATE requirements SET data=?,status=?,review_note=?,revision=revision+1,updated=? WHERE id=? AND revision=?",
    JSON.stringify(r),
    r.status,
    note,
    now(),
    rid,
    Number(b.revision),
  );
  if (!result.meta.changes)
    throw new AppError(
      409,
      "This requirement changed in another tab. Reload before saving.",
    );
  await event(
    row.project_id,
    `${r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Edited"}: ${r.title.slice(0, 100)}`,
  );
  return { ok: true };
}
export async function confirmEmpty(docId: string, u: User, note: string) {
  const d = await ownedDoc(docId, u.id);
  if (d.log_version !== SUBMITTAL_LOG_VERSION && d.status !== "ready")
    throw new AppError(
      409,
      "Finish extraction before confirming an empty result.",
    );
  const count = await one<{ n: number }>(
    "SELECT count(*) n FROM requirements WHERE doc_id=?",
    docId,
  );
  if (count?.n)
    throw new AppError(409, "This document has requirements to review.");
  if (note.trim().length < 8)
    throw new AppError(400, "Add a note describing your source review.");
  await run(
    "UPDATE project_docs SET empty_review=? WHERE id=?",
    note.slice(0, 2000),
    docId,
  );
  await event(d.project_id, "Confirmed no submittals: " + d.filename);
  return { ok: true };
}
