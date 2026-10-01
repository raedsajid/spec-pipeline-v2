import { correctSections } from "@/lib/domain/specifications";
import type { ParsedDocument } from "@/lib/domain/models";
import { z } from "zod";
import { auth, user, csrf, logout, changePassword } from "@/lib/server/auth";
import { AppError } from "@/lib/domain/models";
import {
  all,
  one,
  run,
  db,
  id,
  now,
  getJSON,
  bucket,
  event,
  ownedProject,
  ownedDoc,
  signedDownloadUrl,
  signedObjectDownloadUrl,
} from "@/lib/server/store";
import {
  keyConfigured,
  saveKey,
  chatModel,
  embedModel,
  generate,
  embed,
} from "@/lib/server/gemini";
import {
  createUpload,
  completeUpload,
  projectDetail,
  processStep,
  indexStep,
  parsedKey,
} from "@/lib/services/documents";
import { reviewRequirement, confirmEmpty } from "@/lib/services/review";
import { ask } from "@/lib/services/chat";
import { exportProject } from "@/lib/services/export";
import {
  catalog,
  generateLogStep,
  createProductSubmittals,
  setProductCatalogStatus,
} from "@/lib/services/submittals";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname
      .replace(/^\/api\//, "")
      .split("/");
    const method = request.method;
    if (method !== "GET") csrf(request);
    const [resource, key, action] = path;
    if (resource === "health")
      return Response.json({ status: "ok", version: "1.0" });
    if (
      resource === "auth" &&
      method === "POST" &&
      ["login", "signup"].includes(key)
    )
      return await auth(request, key === "signup");
    if (resource === "auth" && key === "logout" && method === "POST")
      return await logout(request);
    const u = await user(request);
    let output: any;
    if (resource === "me" && method === "GET")
      output = {
        user: u,
        aiConfigured: await keyConfigured(),
        chatModel: chatModel(),
        embeddingModel: embedModel(),
      };
    else if (resource === "password" && method === "POST")
      output = await changePassword(u, await request.json());
    else if (resource === "settings" && method === "POST") {
      if (u.role !== "admin")
        throw new AppError(
          403,
          "Only the owner can change the shared AI settings.",
        );
      const b = (await request.json()) as any;
      if (b.apiKey) await saveKey(String(b.apiKey).trim());
      if (b.test) {
        const a = await generate(
          'Return JSON {"ok":true}.',
          "Connection check.",
          u.id,
        );
        await embed(["BuildERP connection check"], u.id);
        output = { ok: !!a.ok };
      } else output = { ok: true };
    } else if (resource === "projects" && !key && method === "GET")
      output = {
        projects: await all(
          "SELECT p.*, (SELECT count(*) FROM project_docs d WHERE d.project_id=p.id) document_count,(SELECT count(*) FROM requirements r JOIN project_docs d ON d.id=r.doc_id WHERE d.project_id=p.id) requirement_count FROM projects p WHERE user_id=? ORDER BY created DESC",
          u.id,
        ),
      };
    else if (resource === "projects" && !key && method === "POST") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          description: z.string().max(1000).default(""),
        })
        .parse(await request.json());
      const pid = id();
      await run(
        "INSERT INTO projects (id,user_id,name,description,created) VALUES (?,?,?,?,?)",
        pid,
        u.id,
        b.name,
        b.description,
        now(),
      );
      await event(pid, "Project created");
      output = { id: pid };
    } else if (resource === "projects" && key && !action && method === "GET")
      output = await projectDetail(key, u.id);
    else if (
      resource === "projects" &&
      key &&
      action === "upload-url" &&
      method === "POST"
    ) {
      const body = z
        .object({
          filename: z.string().min(1).max(240),
          size: z.number().int().min(8).max(10 * 1024 * 1024),
        })
        .parse(await request.json());
      output = await createUpload(u.id, key, body.filename, body.size);
    } else if (
      resource === "projects" &&
      key &&
      action === "upload-complete" &&
      method === "POST"
    ) {
      const body = z
        .object({
          objectKey: z.string().min(1).max(500),
          filename: z.string().min(1).max(240),
          size: z.number().int().min(8).max(10 * 1024 * 1024),
        })
        .parse(await request.json());
      output = await completeUpload(u.id, key, body);
    }
    else if (
      resource === "projects" &&
      key &&
      action === "chat" &&
      method === "POST"
    ) {
      const b = z
        .object({ question: z.string().max(2000), docId: z.string().min(1) })
        .parse(await request.json());
      output = await ask(key, u, b.question, b.docId);
    } else if (
      resource === "projects" &&
      key &&
      action === "export" &&
      method === "GET"
    ) {
      const url = new URL(request.url);
      return await exportProject(
        key,
        u.id,
        url.searchParams.get("format") || "json",
        url.searchParams.get("approved") === "1" ||
          (url.searchParams.has("ids") && !url.searchParams.has("approved")),
        (url.searchParams.get("ids") || "").split(",").filter(Boolean),
      );
    } else if (resource === "projects" && key && method === "DELETE") {
      await ownedProject(key, u.id);
      await db().batch([
        db()
          .prepare(
            "DELETE FROM requirements WHERE doc_id IN (SELECT id FROM project_docs WHERE project_id=?)",
          )
          .bind(key),
        db().prepare("DELETE FROM project_docs WHERE project_id=?").bind(key),
        db().prepare("DELETE FROM messages WHERE project_id=?").bind(key),
        db().prepare("DELETE FROM events WHERE project_id=?").bind(key),
        db()
          .prepare("DELETE FROM projects WHERE id=? AND user_id=?")
          .bind(key, u.id),
      ]);
      output = { ok: true };
    } else if (
      resource === "documents" &&
      key &&
      action === "process" &&
      method === "POST"
    )
      output = await processStep(key, u);
    else if (
      resource === "documents" &&
      key &&
      action === "prepare" &&
      method === "POST"
    )
      output = await processStep(key, u, true);
    else if (
      resource === "documents" &&
      key &&
      action === "generate" &&
      method === "POST"
    )
      output = await generateLogStep(key, u);
    else if (
      resource === "documents" &&
      key &&
      action === "messages" &&
      method === "GET"
    ) {
      await ownedDoc(key, u.id);
      output = {
        messages: (
          await all(
            "SELECT * FROM messages WHERE doc_id=? ORDER BY created DESC LIMIT 200",
            key,
          )
        ).reverse(),
      };
    } else if (
      resource === "documents" &&
      key &&
      action === "products" &&
      method === "GET"
    )
      output = await catalog(key, u.id);
    else if (
      resource === "documents" &&
      key &&
      action === "products" &&
      method === "POST"
    )
      output = await setProductCatalogStatus(key, u.id, await request.json());
    else if (
      resource === "requirements" &&
      key &&
      action === "products" &&
      method === "POST"
    )
      output = await createProductSubmittals(key, u, await request.json());
    else if (
      resource === "documents" &&
      key &&
      action === "index" &&
      method === "POST"
    )
      output = await indexStep(key, u);
    else if (
      resource === "documents" &&
      key &&
      action === "confirm-empty" &&
      method === "POST"
    ) {
      const b = (await request.json()) as any;
      output = await confirmEmpty(key, u, String(b.note || ""));
    } else if (
      resource === "documents" &&
      key &&
      action === "evidence" &&
      method === "GET"
    ) {
      const d = await ownedDoc(key, u.id);
      const cached = await getJSON<ParsedDocument>(parsedKey(d.hash));
      output = (cached ? correctSections(cached) : null) || {
        evidence: [],
        pages: d.pages,
      };
    } else if (
      resource === "documents" &&
      key &&
      action === "pdf" &&
      method === "GET"
    ) {
      const d = await ownedDoc(key, u.id);
      const url = await signedDownloadUrl("pdf/" + d.hash);
      return Response.redirect(url, 302);
    } else if (resource === "requirements" && key && method === "PATCH")
      output = await reviewRequirement(key, u, await request.json());
    else throw new AppError(404, "This action is not available.");

    const serialized = JSON.stringify(output ?? null);
    if (new TextEncoder().encode(serialized).byteLength > 3.5 * 1024 * 1024) {
      const responseKey = `responses/${u.id}/${id()}.json`;
      await bucket().put(responseKey, serialized, {
        httpMetadata: { contentType: "application/json" },
      });
      return Response.redirect(
        await signedObjectDownloadUrl(responseKey, 10 * 60),
        302,
      );
    }

    return new Response(serialized, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error: "Some fields are invalid. Check the form and try again.",
          code: "validation_failed",
          details: e.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .slice(0, 3),
        },
        { status: 400 },
      );
    if (e instanceof AppError)
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    console.error(
      "BuildERP request failed:",
      e instanceof Error ? e.name : "UnknownError",
    );
    return Response.json(
      {
        error:
          "This action could not finish. Your saved work is safe; please retry.",
        code: "internal_error",
      },
      { status: 500 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
