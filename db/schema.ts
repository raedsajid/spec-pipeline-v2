import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("member"),
  created: integer("created").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expires: integer("expires").notNull(),
  },
  (t) => [index("session_user").on(t.userId)],
);
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    created: integer("created").notNull(),
  },
  (t) => [index("project_owner").on(t.userId)],
);
export const documents = sqliteTable("documents", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("uploaded"),
  pages: integer("pages").notNull().default(0),
  cursor: integer("cursor").notNull().default(0),
  total: integer("total").notNull().default(0),
  indexCursor: integer("index_cursor").notNull().default(0),
  indexed: integer("indexed").notNull().default(0),
  lease: integer("lease").notNull().default(0),
  error: text("error"),
  created: integer("created").notNull(),
});
export const projectDocs = sqliteTable(
  "project_docs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    hash: text("hash")
      .notNull()
      .references(() => documents.hash),
    filename: text("filename").notNull(),
    docKind: text("doc_kind").notNull().default("spec"),
    logVersion: integer("log_version").notNull().default(0),
    imported: integer("imported").notNull().default(0),
    emptyReview: text("empty_review"),
    created: integer("created").notNull(),
  },
  (t) => [
    uniqueIndex("project_hash").on(t.projectId, t.hash),
    index("project_docs_owner").on(t.projectId),
  ],
);
export const requirements = sqliteTable(
  "requirements",
  {
    id: text("id").primaryKey(),
    docId: text("doc_id")
      .notNull()
      .references(() => projectDocs.id),
    data: text("data").notNull(),
    status: text("status").notNull().default("needs_review"),
    reviewNote: text("review_note").notNull().default(""),
    revision: integer("revision").notNull().default(0),
    updated: integer("updated").notNull(),
  },
  (t) => [index("req_doc").on(t.docId)],
);
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    docId: text("doc_id"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citations: text("citations").notNull().default("[]"),
    created: integer("created").notNull(),
  },
  (t) => [index("chat_project_time").on(t.projectId, t.created)],
);
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    message: text("message").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("event_project_time").on(t.projectId, t.created)],
);
export const limits = sqliteTable("limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expires: integer("expires").notNull(),
});

export const submittalJobs = sqliteTable("submittal_jobs", {
  hash: text("hash").primaryKey(),
  status: text("status").notNull().default("pending"),
  cursor: integer("cursor").notNull().default(0),
  total: integer("total").notNull().default(0),
  lease: integer("lease").notNull().default(0),
  error: text("error"),
});

export const drawingJobs = sqliteTable("drawing_jobs", {
  hash: text("hash").primaryKey(),
  status: text("status").notNull().default("pending"),
  cursor: integer("cursor").notNull().default(0),
  total: integer("total").notNull().default(0),
  lease: integer("lease").notNull().default(0),
  error: text("error"),
});

export const equipmentLogs = sqliteTable(
  "equipment_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    revision: integer("revision").notNull().default(0),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [uniqueIndex("equipment_log_project").on(t.projectId)],
);

export const equipmentLogItems = sqliteTable(
  "equipment_log_items",
  {
    id: text("id").primaryKey(),
    logId: text("log_id")
      .notNull()
      .references(() => equipmentLogs.id),
    drawingDocId: text("drawing_doc_id"),
    unitTag: text("unit_tag").notNull(),
    sheetNumber: text("sheet_number").notNull().default(""),
    scheduleTitle: text("schedule_title").notNull().default(""),
    tableId: text("table_id").notNull().default(""),
    rowIndex: integer("row_index").notNull().default(0),
    band: text("band").notNull().default("no_match"),
    matchMethod: text("match_method"),
    proposedCsi: text("proposed_csi"),
    proposedDescription: text("proposed_description"),
    selectedCsi: text("selected_csi"),
    selectedDescription: text("selected_description"),
    status: text("status").notNull().default("needs_review"),
    basisOfDesign: text("basis_of_design"),
    rawFields: text("raw_fields").notNull().default("{}"),
    candidates: text("candidates").notNull().default("[]"),
    equipmentTypes: text("equipment_types").notNull().default("[]"),
    revision: integer("revision").notNull().default(0),
    updated: integer("updated").notNull(),
  },
  (t) => [
    index("equipment_items_log").on(t.logId),
    uniqueIndex("equipment_item_dedupe").on(t.logId, t.drawingDocId, t.unitTag),
  ],
);
