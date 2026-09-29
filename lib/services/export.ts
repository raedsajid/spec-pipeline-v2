import { correctSections } from "@/lib/domain/specifications";
import { zipSync, strToU8 } from "fflate";
import { AppError, ParsedDocument, Requirement } from "@/lib/domain/models";
import { SUBMITTAL_LOG_VERSION } from "@/lib/domain/submittals";
import { bucket, getJSON, id, signedObjectDownloadUrl } from "@/lib/server/store";
import { projectDetail, parsedKey } from "./documents";
const xml = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const md = (s: unknown) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
function column(n: number) {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function makeWorkbook(sheets: { name: string; rows: unknown[][] }[]) {
  const f: Record<string, Uint8Array> = {};
  const add = (n: string, s: string) => (f[n] = strToU8(s));
  add(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  add(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((s, i) =>
    add(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="20" width="25" customWidth="1"/></cols><sheetData>${s.rows.map((r, j) => `<row r="${j + 1}">${r.map((v, k) => `<c r="${column(k)}${j + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v ?? "").slice(0, 32767))}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${column((s.rows[0]?.length || 1) - 1)}${Math.max(1, s.rows.length)}"/></worksheet>`,
    ),
  );
  return zipSync(f, { level: 6 });
}
export async function exportProject(
  pid: string,
  uid: string,
  format: string,
  approved: boolean,
  selectedIds: string[] = [],
) {
  const data = await projectDetail(pid, uid);
  if (!data.documents.length)
    throw new AppError(409, "Upload a document before exporting.");
  if (selectedIds.length) {
    const selected = data.requirements.filter((r) =>
      selectedIds.includes(r.id),
    );
    if (
      selected.length !== new Set(selectedIds).size ||
      (approved && selected.some((r) => r.status !== "approved"))
    )
      throw new AppError(
        422,
        approved
          ? "Select only approved rows from this project to export."
          : "Select rows from this project to export.",
      );
  }
  if (approved && !selectedIds.length) {
    const unfinished = data.documents.some(
      (d) =>
        (d.log_version !== SUBMITTAL_LOG_VERSION && d.status !== "ready") ||
        (!data.requirements.some((r) => r.docId === d.id) && !d.empty_review),
    );
    const unreviewed = data.requirements.some(
      (r) => !["approved", "rejected"].includes(r.status),
    );
    if (unfinished || unreviewed)
      throw new AppError(
        409,
        "Review all requirements and confirm every empty result before exporting an approved register.",
      );
  }
  const rows: Requirement[] = data.requirements.filter((r) =>
    selectedIds.length
      ? selectedIds.includes(r.id)
      : !approved || r.status === "approved",
  );
  const headers = [
    "Source file",
    "Section",
    "Clause",
    "Page",
    "Type",
    "Title",
    "Requirement",
    "Condition",
    "Products",
    "Status",
    "Warnings",
    "Evidence IDs",
    "Source quote",
    "Review note",
  ];
  const matrix = rows.map((r) => [
    r.filename,
    r.section,
    r.clause,
    r.page,
    r.type,
    r.title,
    r.text,
    r.condition,
    r.products.join("; "),
    r.status,
    [...r.blocking, ...r.warnings].join("; "),
    r.evidenceIds.join(", "),
    r.quote,
    r.reviewNote,
  ]);
  const sourceRows: unknown[][] = [
    [
      "Source file",
      "Evidence ID",
      "Page",
      "Section",
      "Clause",
      "Text",
      "Method",
    ],
  ];
  const files = [];
  for (const d of data.documents) {
    const cached = await getJSON<ParsedDocument>(parsedKey(d.hash));
  const parsed = cached ? correctSections(cached) : null;
    for (const e of parsed?.evidence || [])
      sourceRows.push([
        d.filename,
        e.id,
        e.page,
        e.section,
        e.clause,
        e.text,
        e.source,
      ]);
    files.push({
      id: d.id,
      filename: d.filename,
      status: d.status,
      pages: d.pages,
      emptyReview: d.empty_review,
      sections: [
        ...new Set(rows.filter((r) => r.docId === d.id).map((r) => r.section)),
      ].map((section) => ({
        section,
        requirements: rows.filter(
          (r) => r.docId === d.id && r.section === section,
        ),
      })),
      evidence: parsed?.evidence || [],
    });
  }
  const name =
    data.project.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) +
    "_" +
    (approved ? "approved" : "draft");
  const summary = [
    ["File", "Status", "Extraction batches", "No-submittals review"],
    ...data.documents.map((d) => [
      d.filename,
      d.status,
      `${d.cursor}/${d.total}`,
      d.empty_review || "Not confirmed",
    ]),
  ];
  let content: BodyInit, type: string, ext: string;
  if (format === "xlsx") {
    content = makeWorkbook([
      { name: "Submittal register", rows: [headers, ...matrix] },
      { name: "Source evidence", rows: sourceRows },
      { name: "Processing status", rows: summary },
    ]) as unknown as BodyInit;
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    ext = "xlsx";
  } else if (format === "md") {
    content = `# ${md(data.project.name)} — ${approved ? "Approved" : "DRAFT"} register\n\n${approved ? "Human-reviewed register." : "Draft: includes unresolved findings. See each row status and warnings."}\n\n| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${matrix.map((r) => "| " + r.map(md).join(" | ") + " |").join("\n")}\n\n## Processing status\n\n${summary
      .slice(1)
      .map((r) => "- " + r.map(md).join(" · "))
      .join("\n")}`;
    type = "text/markdown";
    ext = "md";
  } else if (format === "json") {
    content = JSON.stringify(
      {
        schemaVersion: "1.0",
        exportStatus: approved ? "approved" : "draft",
        exportedAt: new Date().toISOString(),
        project: {
          name: data.project.name,
          description: data.project.description,
        },
        documents: files,
      },
      null,
      2,
    );
    type = "application/json";
    ext = "json";
  } else throw new AppError(400, "Unsupported export format.");

  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : content instanceof Uint8Array
        ? content
        : null;

  // Vercel Functions cap buffered response payloads at 4.5 MB. Large exports are
  // therefore placed in private R2 storage and returned through a signed redirect.
  if (bytes && bytes.byteLength > 3.5 * 1024 * 1024) {
    const filename = `${name}.${ext}`;
    const key = `exports/${uid}/${id()}/${filename}`;
    await bucket().put(key, bytes, {
      httpMetadata: {
        contentType: type,
        contentDisposition: `attachment; filename="${filename}"`,
      },
    });
    return Response.redirect(await signedObjectDownloadUrl(key, 15 * 60), 302);
  }

  return new Response(content, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
