/**
 * Map-first per-row CSI matching for drawing schedule rows.
 * Ported from BuildERP-AI app/matching/match_rows.py (map path; semantic optional).
 */

import {
  compoundTypeKey,
  extractTagsFromRow,
  tagType,
} from "./tags";
import {
  normalizeScheduleName,
  scheduleTitleQuery,
} from "./title-normalize";
import equipmentMapJson from "./equipment_map.json";

const EXCLUDE_TITLE =
  /(load\s+summary|outdoor\s+air\s+requirement|air\s+requirement|ventilation\s+schedule.*nyc|nyc\s+mc)/i;

export const FAMILY_ALIASES: Record<string, readonly string[]> = {
  EF: ["GEF", "SA", "TX"],
  GEF: ["EF", "SA", "TX"],
  SA: ["EF", "GEF", "TX"],
  TX: ["EF", "GEF", "SA"],
  CUH: ["EUH", "HWUH", "ECUH", "REC"],
  EUH: ["CUH", "HWUH", "ECUH", "REC"],
  HWUH: ["CUH", "EUH", "ECUH", "REC"],
  ECUH: ["CUH", "EUH", "HWUH", "REC"],
  REC: ["CUH", "EUH", "HWUH", "ECUH"],
  P: ["HWP"],
  HWP: ["P"],
};

export type MapHit = {
  specNumber: string;
  description: string | null;
  projects: string[];
  mapType: string;
  support: number;
};

export type EvidenceSnippet = {
  chunkId: string;
  text: string;
  similarity: number;
  headingPath?: string;
  sectionNumber?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
};

export type Candidate = {
  specNumber: string;
  description: string | null;
  source: "map" | "family" | "semantic";
  projects: string[];
  support: number;
  score?: number | null;
  evidence?: EvidenceSnippet[];
};

export type RowMatch = {
  chromaRowId: string | null;
  drawingId: string;
  tableId: string;
  rowIndex: number;
  scheduleTitle: string;
  sheetNumber: string;
  unitTag: string;
  equipmentTypes: string[];
  rawRowFields: Record<string, unknown>;
  candidates: Candidate[];
  band: "auto" | "review" | "no_match";
  matchMethod: string | null;
  proposedSpecNumber: string | null;
  proposedDescription: string | null;
  proposedSource: string | null;
  basisOfDesign: string | null;
};

export type EquipmentMapEntry = {
  tag?: string;
  tags?: string[];
  spec_number?: string;
  description?: string | null;
  projects?: string[];
  project?: string;
  support?: number;
};

export type ScheduleRowInput = {
  id?: string;
  chroma_row_id?: string;
  row_payload?: ScheduleRowPayload;
  schedule_title?: string;
  table_id?: string;
  row_index?: number;
  row?: Record<string, unknown>;
  document?: Record<string, unknown>;
  schedule_metadata?: Record<string, unknown>;
};

export type ScheduleRowPayload = {
  schedule_title?: string;
  table_id?: string;
  row_index?: number;
  row?: Record<string, unknown>;
  document?: Record<string, unknown>;
  schedule_metadata?: Record<string, unknown>;
};

export function excludeTitle(title: string): boolean {
  return EXCLUDE_TITLE.test(title || "");
}

export function loadEquipmentMap(
  data: EquipmentMapEntry[] = equipmentMapJson as EquipmentMapEntry[],
): EquipmentMapEntry[] {
  if (!Array.isArray(data)) throw new Error("Expected equipment map list");
  return data;
}

export function buildTypeIndex(
  slim: EquipmentMapEntry[],
): Map<string, MapHit[]> {
  const index = new Map<string, MapHit[]>();
  for (const row of slim) {
    let tags: string[] = [];
    if (row.tag) tags = [String(row.tag)];
    else if (row.tags) tags = row.tags.map(String);
    const spec = String(row.spec_number || "");
    if (!tags.length || !spec) continue;
    let projects = (row.projects || []).map(String);
    if (!projects.length && row.project) projects = [String(row.project)];
    const description =
      row.description == null ? null : String(row.description);
    const support = Number(row.support || 1);
    for (const t of tags) {
      const list = index.get(t) || [];
      list.push({
        specNumber: spec,
        description,
        projects,
        mapType: t,
        support,
      });
      index.set(t, list);
    }
  }
  return index;
}

export function lookupTypes(
  types: string[],
  index: Map<string, MapHit[]>,
): Candidate[] {
  const bySpec = new Map<
    string,
    {
      specNumber: string;
      description: string | null;
      source: "map" | "family";
      projects: Set<string>;
      support: number;
    }
  >();

  function addHit(hit: MapHit, source: "map" | "family") {
    const cur = bySpec.get(hit.specNumber);
    if (!cur) {
      bySpec.set(hit.specNumber, {
        specNumber: hit.specNumber,
        description: hit.description,
        source,
        projects: new Set(hit.projects),
        support: hit.support,
      });
      return;
    }
    if (source === "map" && cur.source === "family") cur.source = "map";
    for (const p of hit.projects) cur.projects.add(p);
    cur.support = Math.max(cur.support, hit.support);
    if (hit.description && (source === "map" || !cur.description)) {
      cur.description = hit.description;
    }
  }

  for (const typ of types) {
    const keys = [typ, ...(FAMILY_ALIASES[typ] || [])];
    for (const key of keys) {
      for (const hit of index.get(key) || []) {
        addHit(hit, key === typ ? "map" : "family");
      }
    }
  }

  return [...bySpec.values()].map((v) => ({
    specNumber: v.specNumber,
    description: v.description,
    source: v.source,
    projects: [...v.projects].sort(),
    support: v.support,
  }));
}

export function orderCandidates(candidates: Candidate[]): Candidate[] {
  const sourceRank: Record<string, number> = {
    map: 0,
    family: 1,
    semantic: 2,
  };
  return [...candidates].sort((a, b) => {
    const r =
      (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9) ||
      b.support - a.support ||
      (b.score || 0) - (a.score || 0) ||
      a.specNumber.localeCompare(b.specNumber);
    return r;
  });
}

export function bandFor(
  candidates: Candidate[],
): "auto" | "review" | "no_match" {
  if (!candidates.length) return "no_match";
  if (candidates[0]!.source === "family" || candidates[0]!.source === "semantic")
    return "review";
  const mapHits = candidates.filter((c) => c.source === "map");
  if (mapHits.length === 1) return "auto";
  return "review";
}

function sheetNumber(
  doc: Record<string, unknown>,
  meta: Record<string, unknown>,
): string {
  for (const key of [
    "sheet_number",
    "drawing_number",
    "erp_drawing_number",
    "number",
  ]) {
    const val = doc[key] ?? meta[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return "";
}

function basisOfDesign(meta: Record<string, unknown>): string | null {
  for (const key of [
    "basis_of_design",
    "basis of design",
    "design_basis",
    "selection_based_on",
    "selection based on",
  ]) {
    const val = meta[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

export function matchScheduleRows(
  rows: ScheduleRowInput[],
  slim: EquipmentMapEntry[],
  options?: {
    semanticRetriever?: (query: string) => Candidate[];
  },
): RowMatch[] {
  const index = buildTypeIndex(slim);
  const results: RowMatch[] = [];
  const semanticCache = new Map<string, Candidate[]>();
  const semanticRetriever = options?.semanticRetriever;

  for (const entry of rows) {
    let payload: ScheduleRowPayload;
    let chromaId: string | undefined;
    if (entry.row_payload) {
      payload = entry.row_payload;
      chromaId = entry.id;
    } else {
      payload = entry;
      chromaId = entry.id || entry.chroma_row_id;
    }

    const title = String(payload.schedule_title || "");
    if (excludeTitle(title)) continue;
    const row = (payload.row || {}) as Record<string, unknown>;
    const tags = extractTagsFromRow(row);
    if (!tags.length) continue;

    const doc = (payload.document || {}) as Record<string, unknown>;
    const meta = (payload.schedule_metadata || {}) as Record<string, unknown>;
    const drawingId = String(doc.drawing_id || "");
    const tableId = String(payload.table_id || "");
    const rowIndex = Number(payload.row_index || 0);
    const sheet = sheetNumber(doc, meta);
    const bod = basisOfDesign(meta);

    const uniqTypes: string[] = [];
    for (const t of tags.map(tagType)) {
      if (!uniqTypes.includes(t)) uniqTypes.push(t);
    }

    const compound = compoundTypeKey(uniqTypes);
    let ordered: Candidate[] = [];
    let displayTypes = [...uniqTypes];
    if (compound) {
      let compoundHits = lookupTypes([compound], index);
      if (!compoundHits.length) {
        const reversedKey = [...uniqTypes].reverse().join("/");
        if (reversedKey !== compound) {
          compoundHits = lookupTypes([reversedKey], index);
        }
      }
      if (compoundHits.length) {
        ordered = orderCandidates(compoundHits);
        displayTypes = [compound];
      }
    }
    if (!ordered.length) {
      ordered = orderCandidates(lookupTypes(uniqTypes, index));
    }

    if (!ordered.length && semanticRetriever) {
      const cacheKey = normalizeScheduleName(title);
      if (!semanticCache.has(cacheKey)) {
        const query = scheduleTitleQuery(title);
        semanticCache.set(
          cacheKey,
          query ? [...semanticRetriever(query)] : [],
        );
      }
      ordered = [...(semanticCache.get(cacheKey) || [])];
    }

    const band = bandFor(ordered);
    const top = ordered[0] || null;
    const method = top?.source ?? null;

    for (const tag of tags) {
      results.push({
        chromaRowId: chromaId != null ? String(chromaId) : null,
        drawingId,
        tableId,
        rowIndex,
        scheduleTitle: title,
        sheetNumber: sheet,
        unitTag: tag,
        equipmentTypes: [...displayTypes],
        rawRowFields: { ...row },
        candidates: ordered,
        band,
        matchMethod: method,
        proposedSpecNumber: top?.specNumber ?? null,
        proposedDescription: top?.description ?? null,
        proposedSource: top?.source ?? null,
        basisOfDesign: bod,
      });
    }
  }
  return results;
}

export function rowMatchToApi(match: RowMatch) {
  return {
    chroma_row_id: match.chromaRowId,
    drawing_id: match.drawingId,
    table_id: match.tableId,
    row_index: match.rowIndex,
    schedule_title: match.scheduleTitle,
    sheet_number: match.sheetNumber,
    unit_tag: match.unitTag,
    equipment_types: match.equipmentTypes,
    raw_row_fields: match.rawRowFields,
    band: match.band,
    match_method: match.matchMethod,
    proposed_spec_number: match.proposedSpecNumber,
    proposed_description: match.proposedDescription,
    proposed_source: match.proposedSource,
    basis_of_design: match.basisOfDesign,
    candidates: match.candidates.map((c) => ({
      spec_number: c.specNumber,
      description: c.description,
      source: c.source,
      projects: c.projects,
      support: c.support,
      score: c.score ?? null,
      evidence: c.evidence,
    })),
  };
}
