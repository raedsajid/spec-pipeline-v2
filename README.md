# BuildERP

BuildERP is a Next.js specification workspace for uploaded construction PDFs,
evidence-linked requirement extraction, submittal generation, source review and
document-scoped chat.

This package targets **Vercel**. See [`VERCEL-DEPLOYMENT.md`](./VERCEL-DEPLOYMENT.md)
for the complete setup instructions.

## Architecture

| Layer | Location | Responsibility |
| --- | --- | --- |
| Presentation | `app`, `components` | Landing, account, project UI and PDF review |
| Domain | `lib/domain` | Evidence, schemas, classification and validation |
| Application | `lib/services` | Document processing, chat, review, exports and submittals |
| Database | Turso/libSQL | Users, projects, sessions, review state and processing cursors |
| Object storage | Cloudflare R2 S3 API | Original PDFs, parsed JSON, batches and embeddings |
| Delivery | `app/api/[...path]/route.ts` | Authenticated Next.js API routes on Vercel |
| AI | Gemini REST API | Extraction, OCR, embeddings and grounded answers |

## Local development

```bash
cp .env.example .env.local
npm install
npm run typecheck
npm run dev
```

Required environment variables are documented in `.env.example`.

## Document storage design

The application limit remains 10 MB / 200 pages per PDF. A browser first asks the
BuildERP API for a short-lived signed R2 upload URL, uploads the PDF directly to
R2, and then asks the API to validate and register it. This keeps large request
bodies out of Vercel Functions. BuildERP validates size and PDF signature, hashes
the uploaded bytes with SHA-256, and keeps the original content-addressed storage
and cross-project document reuse behavior.

PDF viewing follows the inverse pattern: BuildERP verifies ownership and redirects
the authorized request to a short-lived signed R2 URL. The R2 bucket can remain
private.

## Database compatibility

The service layer still uses the original prepared SQLite SQL. `lib/server/store.ts`
provides the small D1-shaped adapter backed by Turso/libSQL, so the domain/services
did not need a wholesale SQL rewrite. The final schema is initialized automatically
on first access, including the v2 `messages.doc_id` and `project_docs.log_version`
columns.

## Gemini settings

Defaults:

- `GEMINI_CHAT_MODEL=gemini-2.5-flash`
- `EMBEDDING_MODEL=gemini-embedding-001`

`SETTINGS_SECRET` encrypts the owner's saved Gemini API key at rest. Keep this
secret stable across deployments. The actual Gemini key is entered through the
BuildERP Settings screen and is not expected in source control.

## Security behavior retained

- PBKDF2-SHA256 password hashing with per-user salts.
- Random session tokens stored only as SHA-256 hashes.
- HttpOnly, Secure, SameSite=Lax cookies.
- Origin checks on mutations.
- Persistent authentication/upload/AI rate limits.
- Project ownership checks before document access.
- Short-lived signed URLs for private PDF objects.
- Evidence/revision checks before review state changes.

The first application account becomes admin/owner. For a brand-new public
production deployment, create that owner account before distributing the URL.

## Verification

After installing dependencies, run:

```bash
npm run typecheck
node --experimental-transform-types --import ./tests/resolve-types.mjs --test tests/domain.test.mjs tests/submittals.test.mjs
npm run build
```

Then perform the deployed acceptance checks in `VERCEL-DEPLOYMENT.md`, including a
PDF larger than 4.5 MB to verify direct-to-R2 uploads.


> Run `npm install` once locally to generate `package-lock.json`, then commit it for reproducible Vercel builds.
