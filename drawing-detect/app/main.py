"""FastAPI OpenCV table-detect sidecar for BuildERP (Vercel)."""

from __future__ import annotations

import secrets

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.detect import detect_tables_from_pdf_bytes
from app.settings import DRAWING_DETECT_SECRET

app = FastAPI(title="BuildERP drawing detect", version="1.0.0")
_bearer = HTTPBearer(auto_error=False)


def require_secret(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    authorization: str | None = Header(default=None),
) -> None:
    secret = DRAWING_DETECT_SECRET
    if not secret:
        raise HTTPException(
            status_code=503,
            detail="DRAWING_DETECT_SECRET is not configured on the detect service.",
        )
    token = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token or not secrets.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "drawing-detect"}


@app.post("/v1/detect-tables")
async def detect_tables(
    _: None = Depends(require_secret),
    file: UploadFile = File(...),
    page: int = Form(default=1),
) -> dict:
    """
    Detect schedule table regions on a single-page drawing PDF.

    Multipart form: ``file`` (application/pdf), optional ``page`` (1-based label
    for the response; the PDF itself must be one page).
    """
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    data = await file.read()
    if len(data) < 8 or not data[:5].startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Upload a single-page PDF.")
    try:
        return detect_tables_from_pdf_bytes(data, page=page)
    except ValueError as exc:
        # e.g. multi-page PDF or decode errors — return empty crops for 0 tables.
        message = str(exc)
        if "No schedule tables" in message or "zero tables" in message.lower():
            return {
                "page": page,
                "renderWidth": 0,
                "renderHeight": 0,
                "dpi": 300,
                "crops": [],
            }
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:  # noqa: BLE001 — surface as 500 for ops
        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {exc}",
        ) from exc
