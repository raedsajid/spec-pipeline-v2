# BuildERP — Vercel deployment

This version runs the Next.js application and API on Vercel while keeping object
storage in Cloudflare R2. Cloudflare Worker/D1 bindings are no longer required.

## 1. Create the database

Create a Turso/libSQL database. Obtain:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

No manual schema migration is required for a new database. BuildERP creates its
schema on first use and applies the v2 compatibility columns automatically.

If you need the data from an existing Cloudflare D1 database, migrate/export that
SQLite data into Turso separately before using the production app. The source ZIP
itself never contained your production database.

## 2. Configure Cloudflare R2

You can reuse an existing R2 bucket. Create an R2 API token with read/write access
to that bucket and obtain:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

The bucket does **not** need to be public. BuildERP uses short-lived signed URLs.

### R2 CORS

Browser-to-R2 upload and the PDF.js viewer require CORS on the bucket. For a fixed
production domain, use that exact origin. Example:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range", "If-Range"],
    "ExposeHeaders": ["ETag", "Accept-Ranges", "Content-Range", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

During initial Vercel preview testing you may temporarily allow `*`, or add the
specific preview origin you are testing. Restrict it to your final domain when the
production URL is stable. PDF.js may issue range requests, which is why `Range`
and the range-response headers are included above.

BuildERP uses `incoming/` for incomplete direct uploads and may place oversized
JSON responses and exports under `responses/` and `exports/` to avoid Vercel's
function response-size limit. Add R2 lifecycle rules that delete all three temporary
prefixes after one day. Original PDFs under `pdf/` and cached processing data under
`cache/` should not use that short lifecycle.

## 3. Configure application secrets

Set these values locally in `.env.local` and in Vercel Project Settings >
Environment Variables:

```text
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
SETTINGS_SECRET=...
GEMINI_CHAT_MODEL=gemini-2.5-flash
EMBEDDING_MODEL=gemini-embedding-001
```

Use a long random value for `SETTINGS_SECRET` and preserve it across deployments.
The Gemini API key itself is still entered in the BuildERP Settings screen and is
encrypted using this secret.

## 4. Local verification

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

Open the local URL, create the first account, add the Gemini key, create a project,
and upload a representative PDF.

## 5. Deploy to Vercel

Push this folder to a Git repository, import it in Vercel, and use the defaults:

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank/default

Add the environment variables before the production deployment.

The API route explicitly uses the Node.js runtime and permits a 300-second maximum
execution duration where the selected Vercel plan/runtime supports it.

## What changed from the Cloudflare version

- `vinext`, Wrangler and the Cloudflare Vite plugin were removed.
- Native `next dev`, `next build`, and `next start` are used.
- D1 binding calls are mapped to Turso/libSQL through a compatibility adapter.
- R2 binding calls are mapped to the R2 S3-compatible API.
- PDF upload is two-stage: the API issues a signed PUT URL, the browser uploads
  directly to R2, and the API then verifies/hash-registers the object.
- PDF download verifies project ownership and redirects to a one-hour signed R2 URL.
- Vercel forwarding headers are used for authentication rate limiting.

## Acceptance checks after deployment

1. `/api/health` returns `{ "status": "ok", "version": "1.0" }`.
2. The first signup succeeds and becomes the admin account.
3. Saving/testing the Gemini API key succeeds.
4. Upload a PDF larger than 4.5 MB and confirm it completes; this proves direct R2
   upload/CORS is working rather than proxying the file through a Vercel Function.
5. Open the PDF source viewer and verify pages render.
6. Run extraction, indexing, document chat, submittal generation, review/editing,
   and an export.
