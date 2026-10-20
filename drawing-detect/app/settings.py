"""Sidecar settings (no Gemini / no BuildERP-AI app.config)."""

import os

DRAWING_RENDER_DPI = int(os.environ.get("DRAWING_RENDER_DPI", "300"))
DRAWING_DETECT_SECRET = os.environ.get("DRAWING_DETECT_SECRET", "")
