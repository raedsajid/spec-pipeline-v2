# BuildERP drawing-detect sidecar

Python FastAPI service that runs **BuildERP-AI’s OpenCV table detection** (render → lines → cells → assemble → pad) and returns normalized crop boxes for the Next.js app.

Gemini extract stays in Next.js. This service does **detection only**.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | none |
| `POST` | `/v1/detect-tables` | `Authorization: Bearer $DRAWING_DETECT_SECRET` |

`POST /v1/detect-tables` multipart fields:

- `file` — **single-page** PDF
- `page` — 1-based page label for the response (optional, default `1`)

Response:

```json
{
  "page": 1,
  "renderWidth": 7200,
  "renderHeight": 10800,
  "dpi": 300,
  "crops": [{ "id": "table_01", "page": 1, "bbox": [0.1, 0.2, 0.5, 0.3] }]
}
```

`bbox` is normalized `[x, y, w, h]` (0–1, top-left origin), after BuildERP-AI pad fractions.

## Local run

```bash
cd drawing-detect
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
set DRAWING_DETECT_SECRET=dev-secret   # PowerShell: $env:DRAWING_DETECT_SECRET="dev-secret"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

In the Next.js app `.env.local`:

```
DRAWING_DETECT_URL=http://localhost:8080
DRAWING_DETECT_SECRET=dev-secret
```

## Deploy to Fly.io (so Vercel can reach it)

Vercel cannot call your laptop. Deploy this sidecar to a public HTTPS host.

```bash
cd drawing-detect
fly launch --no-deploy   # or use existing fly.toml
fly secrets set DRAWING_DETECT_SECRET=your-long-random-secret
fly deploy
```

Then in the **Vercel** project → Settings → Environment Variables:

| Name | Value |
|------|--------|
| `DRAWING_DETECT_URL` | `https://builderp-drawing-detect.fly.dev` (your Fly URL, no trailing slash) |
| `DRAWING_DETECT_SECRET` | same secret as Fly |

Redeploy the Next.js app. Upload a schedule drawing → crops come from OpenCV → review → Extract (AI).

## Docker (any host)

```bash
cd drawing-detect
docker build -t builderp-drawing-detect .
docker run --rm -p 8080:8080 \
  -e DRAWING_DETECT_SECRET=your-long-random-secret \
  builderp-drawing-detect
```

## Notes

- Modules under `app/table_detection`, `app/pdf_rendering`, and `app/table_cropping` are ported from BuildERP-AI’s drawing pipeline.
- Memory: 300 DPI sheets are large; Fly `fly.toml` requests 2GB RAM.
- Empty `crops` means no schedule tables were detected (not necessarily a crash).
