import { z } from "zod";
import { AppError, ParsedDocument, User } from "@/lib/domain/models";
import { correctSections } from "@/lib/domain/specifications";
import {
  dedupeMatchesForEquipmentLog,
  loadEquipmentMap,
  matchScheduleRows,
  type ScheduleRowInput,
} from "@/lib/domain/equipment";
import {
  all,
  db,
  event,
  getJSON,
  id,
  now,
  one,
  ownedProject,
  putJSON,
  run,
} from "@/lib/server/store";
import { parsedKey } from "@/lib/services/documents";

export const scheduleRowsKey = (hash: string) =>
  `cache/drawings-v1/${hash}/schedule-rows.json`;

type ScheduleRowsFile = {
  rows: ScheduleRowInput[];
  updated?: number;
};

export async function projectCsiCatalog(pid: string, uid: string) {
  await ownedProject(pid, uid);
  const docs = await all<{ id: string; hash: string; filename: string }>(
    "SELECT id,hash,filename FROM project_docs WHERE project_id=? AND COALESCE(doc_kind,'spec')='spec' ORDER BY created",
    pid,
  );
  const byCsi = new Map<string, { csi: string; title: string }>();
  for (const d of docs) {
    const cached = await getJSON<ParsedDocument>(parsedKey(d.hash));
    if (!cached) continue;
    const parsed = correctSections(cached);
    for (const section of parsed.sections || []) {
      const m = String(section).match(/^(\d{5,6})\b/);
      if (!m) continue;
      const csi = m[1]!;
      if (!byCsi.has(csi)) {
        byCsi.set(csi, {
          csi,
          title: String(section).replace(/^\d{5,6}\s*[-–—:]?\s*/, "").trim() ||
            d.filename.replace(/\.pdf$/i, ""),
        });
      }
    }
    for (const e of parsed.evidence || []) {
      const sec = String(e.section || "");
      const m = sec.match(/^(\d{5,6})\b/);
      if (!m) continue;
      const csi = m[1]!;
      if (!byCsi.has(csi)) {
        byCsi.set(csi, {
          csi,
          title: sec.replace(/^\d{5,6}\s*[-–—:]?\s*/, "").trim() || csi,
        });
      }
    }
  }
  return [...byCsi.values()].sort((a, b) => a.csi.localeCompare(b.csi));
}

async function loadProjectScheduleRows(pid: string): Promise<{
  rows: ScheduleRowInput[];
  drawingDocById: Map<string, string>;
}> {
  const drawings = await all<{ id: string; hash: string }>(
    "SELECT id,hash FROM project_docs WHERE project_id=? AND COALESCE(doc_kind,'spec')='drawing' ORDER BY created",
    pid,
  );
  const rows: ScheduleRowInput[] = [];
  const drawingDocById = new Map<string, string>();
  for (const d of drawings) {
    drawingDocById.set(d.id, d.hash);
    const file = await getJSON<ScheduleRowsFile>(scheduleRowsKey(d.hash));
    if (!file?.rows?.length) continue;
    for (const entry of file.rows) {
      const payload = entry.row_payload || entry;
      const doc = {
        ...(payload.document || {}),
        drawing_id: String(
          (payload.document as any)?.drawing_id || d.id,
        ),
      };
      rows.push({
        ...entry,
        row_payload: entry.row_payload
          ? { ...entry.row_payload, document: doc }
          : undefined,
        document: entry.row_payload ? entry.document : doc,
        id: entry.id || `${d.id}:${payload.table_id || "t"}:${payload.row_index || 0}`,
      });
    }
  }
  return { rows, drawingDocById };
}

async function ensureLog(pid: string) {
  const existing = await one<{ id: string; revision: number }>(
    "SELECT id,revision FROM equipment_logs WHERE project_id=?",
    pid,
  );
  if (existing) return existing;
  const logId = id();
  const t = now();
  await run(
    "INSERT INTO equipment_logs (id,project_id,revision,created,updated) VALUES (?,?,?,?,?)",
    logId,
    pid,
    0,
    t,
    t,
  );
  return { id: logId, revision: 0 };
}

function itemStatusForBand(band: string) {
  if (band === "auto") return "proposed";
  if (band === "no_match") return "needs_review";
  return "needs_review";
}

export async function generateEquipmentLog(pid: string, user: User) {
  await ownedProject(pid, user.id);
  const { rows } = await loadProjectScheduleRows(pid);
  const slim = loadEquipmentMap();
  const matches = dedupeMatchesForEquipmentLog(matchScheduleRows(rows, slim));
  const log = await ensureLog(pid);
  const t = now();
  const revision = (log.revision || 0) + 1;

  await db().batch([
    db()
      .prepare("DELETE FROM equipment_log_items WHERE log_id=?")
      .bind(log.id),
    db()
      .prepare(
        "UPDATE equipment_logs SET revision=?, updated=? WHERE id=?",
      )
      .bind(revision, t, log.id),
  ]);

  for (const m of matches) {
    const selected =
      m.band === "auto" && m.proposedSpecNumber
        ? {
            csi: m.proposedSpecNumber,
            description: m.proposedDescription,
          }
        : { csi: null as string | null, description: null as string | null };
    await run(
      `INSERT INTO equipment_log_items (
        id,log_id,drawing_doc_id,unit_tag,sheet_number,schedule_title,table_id,row_index,
        band,match_method,proposed_csi,proposed_description,selected_csi,selected_description,
        status,basis_of_design,raw_fields,candidates,equipment_types,revision,updated
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(),
      log.id,
      m.drawingId || null,
      m.unitTag,
      m.sheetNumber,
      m.scheduleTitle,
      m.tableId,
      m.rowIndex,
      m.band,
      m.matchMethod,
      m.proposedSpecNumber,
      m.proposedDescription,
      selected.csi,
      selected.description,
      itemStatusForBand(m.band),
      m.basisOfDesign,
      JSON.stringify(m.rawRowFields),
      JSON.stringify(
        m.candidates.map((c) => ({
          spec_number: c.specNumber,
          description: c.description,
          source: c.source,
          support: c.support,
        })),
      ),
      JSON.stringify(m.equipmentTypes),
      revision,
      t,
    );
  }

  await event(
    pid,
    `Generated equipment log · ${matches.length} units (${matches.filter((m) => m.band === "auto").length} auto / ${matches.filter((m) => m.band === "review").length} review / ${matches.filter((m) => m.band === "no_match").length} no match)`,
  );

  return listEquipmentLog(pid, user.id);
}

export async function listEquipmentLog(pid: string, uid: string) {
  await ownedProject(pid, uid);
  const log = await one<{
    id: string;
    revision: number;
    updated: number;
  }>("SELECT id,revision,updated FROM equipment_logs WHERE project_id=?", pid);
  if (!log) {
    return {
      log: null,
      items: [] as any[],
      counts: { total: 0, auto: 0, review: 0, no_match: 0 },
      catalog: await projectCsiCatalog(pid, uid),
    };
  }
  const items = await all(
    "SELECT * FROM equipment_log_items WHERE log_id=? ORDER BY schedule_title, unit_tag",
    log.id,
  );
  const mapped = items.map((r: any) => ({
    id: r.id,
    drawingDocId: r.drawing_doc_id,
    unitTag: r.unit_tag,
    sheetNumber: r.sheet_number,
    scheduleTitle: r.schedule_title,
    tableId: r.table_id,
    rowIndex: r.row_index,
    band: r.band,
    matchMethod: r.match_method,
    proposedCsi: r.proposed_csi,
    proposedDescription: r.proposed_description,
    selectedCsi: r.selected_csi,
    selectedDescription: r.selected_description,
    status: r.status,
    basisOfDesign: r.basis_of_design,
    rawFields: JSON.parse(r.raw_fields || "{}"),
    candidates: JSON.parse(r.candidates || "[]"),
    equipmentTypes: JSON.parse(r.equipment_types || "[]"),
    revision: r.revision,
    updated: r.updated,
  }));
  return {
    log: { id: log.id, revision: log.revision, updated: log.updated },
    items: mapped,
    counts: {
      total: mapped.length,
      auto: mapped.filter((i) => i.band === "auto").length,
      review: mapped.filter((i) => i.band === "review").length,
      no_match: mapped.filter((i) => i.band === "no_match").length,
    },
    catalog: await projectCsiCatalog(pid, uid),
  };
}

export async function patchEquipmentLogItem(
  itemId: string,
  user: User,
  body: unknown,
) {
  const b = z
    .object({
      selectedCsi: z.string().trim().max(32).nullable().optional(),
      selectedDescription: z.string().trim().max(240).nullable().optional(),
      status: z
        .enum(["needs_review", "proposed", "confirmed", "rejected"])
        .optional(),
    })
    .parse(body);

  const row = await one<any>(
    `SELECT i.*, l.project_id FROM equipment_log_items i
     JOIN equipment_logs l ON l.id=i.log_id
     JOIN projects p ON p.id=l.project_id
     WHERE i.id=? AND p.user_id=?`,
    itemId,
    user.id,
  );
  if (!row) throw new AppError(404, "Equipment log item not found.");

  const selectedCsi =
    b.selectedCsi !== undefined ? b.selectedCsi : row.selected_csi;
  const selectedDescription =
    b.selectedDescription !== undefined
      ? b.selectedDescription
      : row.selected_description;
  let status = b.status ?? row.status;
  if (b.selectedCsi !== undefined && b.status === undefined) {
    status = b.selectedCsi ? "confirmed" : "needs_review";
  }

  await run(
    `UPDATE equipment_log_items
     SET selected_csi=?, selected_description=?, status=?, revision=revision+1, updated=?
     WHERE id=?`,
    selectedCsi,
    selectedDescription,
    status,
    now(),
    itemId,
  );
  await event(row.project_id, `Updated equipment ${row.unit_tag}`);
  return listEquipmentLog(row.project_id, user.id);
}

export async function putScheduleRows(
  hash: string,
  rows: ScheduleRowInput[],
) {
  await putJSON(scheduleRowsKey(hash), {
    rows,
    updated: now(),
  } satisfies ScheduleRowsFile);
}
