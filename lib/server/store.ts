import { createClient, type Client, type ResultSet } from "@libsql/client";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@/lib/domain/models";

export const runtime = () => ({
  SETTINGS_SECRET: process.env.SETTINGS_SECRET || "",
  GEMINI_CHAT_MODEL: process.env.GEMINI_CHAT_MODEL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
});

let sqlClient: Client | null = null;
let schemaReady: Promise<void> | null = null;

function databaseClient() {
  if (sqlClient) return sqlClient;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url)
    throw new AppError(
      503,
      "Database storage is unavailable. Configure TURSO_DATABASE_URL in Vercel.",
    );
  sqlClient = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return sqlClient;
}

async function tableColumns(client: Client, table: string) {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row: any) => String(row.name ?? row[1])));
}

async function addColumnIfMissing(
  client: Client,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await tableColumns(client, table);
  if (columns.has(column)) return;
  try {
    await client.execute(`ALTER TABLE ${table} ADD ${column} ${definition}`);
  } catch (error) {
    // Two cold starts can race during first deployment. A duplicate-column error
    // means the other instance completed the same migration successfully.
    if (!String(error).toLowerCase().includes("duplicate column")) throw error;
  }
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const client = databaseClient();
    await client.execute(
      `CREATE TABLE IF NOT EXISTS _builderp_meta (key text PRIMARY KEY NOT NULL, value text NOT NULL)`,
    );
    const version = await client.execute({
      sql: "SELECT value FROM _builderp_meta WHERE key=?",
      args: ["schema_version"],
    });
    const currentVersion = version.rows[0] as any;
    if (String(currentVersion?.value ?? currentVersion?.[0] ?? "") === "2")
      return;

    const statements = [
      `PRAGMA foreign_keys=ON`,
      `CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY NOT NULL,
        username text NOT NULL UNIQUE,
        password text NOT NULL,
        role text DEFAULT 'member' NOT NULL,
        created integer NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token text PRIMARY KEY NOT NULL,
        user_id text NOT NULL REFERENCES users(id),
        expires integer NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY NOT NULL,
        value text NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS projects (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL REFERENCES users(id),
        name text NOT NULL,
        description text DEFAULT '' NOT NULL,
        created integer NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS project_owner ON projects(user_id)`,
      `CREATE TABLE IF NOT EXISTS documents (
        hash text PRIMARY KEY NOT NULL,
        size integer NOT NULL,
        status text DEFAULT 'uploaded' NOT NULL,
        pages integer DEFAULT 0 NOT NULL,
        cursor integer DEFAULT 0 NOT NULL,
        total integer DEFAULT 0 NOT NULL,
        index_cursor integer DEFAULT 0 NOT NULL,
        indexed integer DEFAULT 0 NOT NULL,
        lease integer DEFAULT 0 NOT NULL,
        error text,
        created integer NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS project_docs (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL REFERENCES projects(id),
        hash text NOT NULL REFERENCES documents(hash),
        filename text NOT NULL,
        log_version integer DEFAULT 0 NOT NULL,
        imported integer DEFAULT 0 NOT NULL,
        empty_review text,
        created integer NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS project_hash ON project_docs(project_id,hash)`,
      `CREATE INDEX IF NOT EXISTS project_docs_owner ON project_docs(project_id)`,
      `CREATE TABLE IF NOT EXISTS requirements (
        id text PRIMARY KEY NOT NULL,
        doc_id text NOT NULL REFERENCES project_docs(id),
        data text NOT NULL,
        status text DEFAULT 'needs_review' NOT NULL,
        review_note text DEFAULT '' NOT NULL,
        revision integer DEFAULT 0 NOT NULL,
        updated integer NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS req_doc ON requirements(doc_id)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL REFERENCES projects(id),
        doc_id text,
        role text NOT NULL,
        content text NOT NULL,
        citations text DEFAULT '[]' NOT NULL,
        created integer NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS chat_project_time ON messages(project_id,created)`,
      `CREATE TABLE IF NOT EXISTS events (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL REFERENCES projects(id),
        message text NOT NULL,
        created integer NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS event_project_time ON events(project_id,created)`,
      `CREATE TABLE IF NOT EXISTS limits (
        key text PRIMARY KEY NOT NULL,
        count integer NOT NULL,
        expires integer NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS submittal_jobs (
        hash text PRIMARY KEY NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        cursor integer DEFAULT 0 NOT NULL,
        total integer DEFAULT 0 NOT NULL,
        lease integer DEFAULT 0 NOT NULL,
        error text
      )`,
    ];
    for (const sql of statements) await client.execute(sql);

    // Compatibility with an imported v1 D1/SQLite database.
    await addColumnIfMissing(client, "messages", "doc_id", "text");
    await addColumnIfMissing(
      client,
      "project_docs",
      "log_version",
      "integer DEFAULT 0 NOT NULL",
    );
    await client.execute({
      sql: "INSERT INTO _builderp_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      args: ["schema_version", "2"],
    });
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function normalizeValue(value: unknown) {
  return typeof value === "bigint" ? Number(value) : value;
}

function rowsFrom<T>(result: ResultSet): T[] {
  return result.rows.map((row: any) => {
    const out: Record<string, unknown> = {};
    result.columns.forEach((column, index) => {
      const indexed = row[index];
      out[column] = normalizeValue(indexed !== undefined ? indexed : row[column]);
    });
    return out as T;
  });
}

class PreparedStatement {
  constructor(
    readonly sql: string,
    readonly args: any[] = [],
  ) {}

  bind(...values: any[]) {
    return new PreparedStatement(
      this.sql,
      values.map((value) => (value === undefined ? null : value)),
    );
  }

  async first<T = any>(): Promise<T | null> {
    await ensureSchema();
    const result = await databaseClient().execute({ sql: this.sql, args: this.args });
    return rowsFrom<T>(result)[0] ?? null;
  }

  async all<T = any>(): Promise<{ results: T[] }> {
    await ensureSchema();
    const result = await databaseClient().execute({ sql: this.sql, args: this.args });
    return { results: rowsFrom<T>(result) };
  }

  async run() {
    await ensureSchema();
    const result = await databaseClient().execute({ sql: this.sql, args: this.args });
    return { meta: { changes: Number(result.rowsAffected || 0) } };
  }
}

class DatabaseAdapter {
  prepare(sql: string) {
    return new PreparedStatement(sql);
  }

  async batch(statements: PreparedStatement[]) {
    await ensureSchema();
    if (!statements.length) return [];
    const results = await databaseClient().batch(
      statements.map((statement) => ({
        sql: statement.sql,
        args: statement.args,
      })),
      "write",
    );
    return results.map((result) => ({
      meta: { changes: Number(result.rowsAffected || 0) },
    }));
  }
}

const database = new DatabaseAdapter();
export function db() {
  return database;
}

let objectClient: S3Client | null = null;
function s3() {
  if (objectClient) return objectClient;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey)
    throw new AppError(
      503,
      "Document storage is unavailable. Configure the R2 environment variables in Vercel.",
    );
  objectClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return objectClient;
}

function bucketName() {
  const name = process.env.R2_BUCKET;
  if (!name)
    throw new AppError(
      503,
      "Document storage is unavailable. Configure R2_BUCKET in Vercel.",
    );
  return name;
}

async function bodyBytes(body: any): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (typeof body.transformToByteArray === "function")
    return new Uint8Array(await body.transformToByteArray());
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>)
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function isMissingObject(error: any) {
  return (
    error?.name === "NoSuchKey" ||
    error?.name === "NotFound" ||
    error?.$metadata?.httpStatusCode === 404
  );
}

class BucketAdapter {
  async get(key: string) {
    try {
      const result = await s3().send(
        new GetObjectCommand({ Bucket: bucketName(), Key: key }),
      );
      return {
        body: result.Body,
        async arrayBuffer() {
          const bytes = await bodyBytes(result.Body);
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
        async json<T>() {
          const bytes = await bodyBytes(result.Body);
          return JSON.parse(new TextDecoder().decode(bytes)) as T;
        },
      };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async put(
    key: string,
    body: string | Uint8Array | ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
    },
  ) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: key,
        Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
        ContentType: options?.httpMetadata?.contentType,
        ContentDisposition: options?.httpMetadata?.contentDisposition,
      }),
    );
  }

  async head(key: string) {
    try {
      return await s3().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: key }),
      );
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await s3().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
  }
}

const objectBucket = new BucketAdapter();
export function bucket() {
  return objectBucket;
}

export async function signedUploadUrl(key: string, contentType = "application/pdf") {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 10 * 60 },
  );
}

export async function signedObjectDownloadUrl(
  key: string,
  expiresIn = 60 * 60,
) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucketName(), Key: key }),
    { expiresIn },
  );
}

export async function signedDownloadUrl(key: string) {
  return signedObjectDownloadUrl(key, 60 * 60);
}

export const now = () => Date.now();
export const id = (): string => crypto.randomUUID();

export async function one<T = any>(sql: string, ...values: any[]): Promise<T | null> {
  return db().prepare(sql).bind(...values).first<T>();
}

export async function all<T = any>(sql: string, ...values: any[]): Promise<T[]> {
  return (await db().prepare(sql).bind(...values).all<T>()).results;
}

export async function run(sql: string, ...values: any[]) {
  return db().prepare(sql).bind(...values).run();
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const object = await bucket().get(key);
  return object ? await object.json<T>() : null;
}

export async function putJSON(key: string, data: unknown) {
  await bucket().put(key, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function sha(data: BufferSource | string) {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function ownedProject(pid: string, uid: string) {
  const project = await one(
    "SELECT * FROM projects WHERE id=? AND user_id=?",
    pid,
    uid,
  );
  if (!project) throw new AppError(404, "Project not found.");
  return project;
}

export async function ownedDoc(docId: string, uid: string) {
  const document = await one(
    "SELECT pd.*,d.status,d.pages,d.cursor,d.total,d.index_cursor,d.indexed,d.error FROM project_docs pd JOIN projects p ON p.id=pd.project_id JOIN documents d ON d.hash=pd.hash WHERE pd.id=? AND p.user_id=?",
    docId,
    uid,
  );
  if (!document) throw new AppError(404, "Document not found.");
  return document;
}

export async function event(pid: string, message: string) {
  await run(
    "INSERT INTO events (id,project_id,message,created) VALUES (?,?,?,?)",
    id(),
    pid,
    message,
    now(),
  );
}

export async function consumeLimit(key: string, max: number, windowMs: number) {
  const time = now();
  const slot = Math.floor(time / windowMs);
  const limitKey = `${key}:${slot}`;
  const row = await one<{ count: number }>(
    "INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
    limitKey,
    (slot + 1) * windowMs,
    max,
  );
  if (!row)
    throw new AppError(
      429,
      "Usage limit reached. Your progress is saved; try again after the limit resets.",
      "rate_limit",
    );
}
