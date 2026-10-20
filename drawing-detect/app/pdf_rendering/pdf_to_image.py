"""
Convert a single-page drawing PDF into an in-memory PNG image.

First stage of the drawing pipeline: render the drawing sheet at a
configurable DPI using PyMuPDF and return it as PNG bytes. Downstream stages
(table detection, extraction) decode these bytes; keeping the image in memory
avoids writing a throwaway page file to disk.
"""

from __future__ import annotations

from pathlib import Path

import fitz

from app.settings import DRAWING_RENDER_DPI

# PyMuPDF refuses to rasterize pixmaps above an internal size limit and can
# hand back a near-empty image for very large sheets at high DPI. A rendered
# page smaller than this many bytes is treated as that failure and re-rendered
# at ``_FALLBACK_DPI``.
_MIN_VALID_PNG_BYTES = 1_500_000
_FALLBACK_DPI = 200


def render_pdf_to_image(pdf_path: str | Path, *, dpi: int | None = None) -> bytes:
    """
    Render a single-page drawing PDF to a PNG byte string.

    Inputs:
        pdf_path: path to the source PDF file (must contain exactly one page).
        dpi: render resolution; defaults to ``settings.drawing_render_dpi``.
    Outputs: PNG-encoded bytes for the drawing sheet.
    Raises: ``ValueError`` if the PDF does not contain exactly one page.
    """
    resolved_dpi = dpi if dpi is not None else DRAWING_RENDER_DPI
    document = fitz.open(str(pdf_path))
    try:
        if document.page_count != 1:
            raise ValueError(
                "Expected a single-page drawing PDF, "
                f"got {document.page_count} page(s)."
            )
        png_bytes = _render_page_at_dpi(document, 0, resolved_dpi)
        if len(png_bytes) < _MIN_VALID_PNG_BYTES and resolved_dpi > _FALLBACK_DPI:
            png_bytes = _render_page_at_dpi(document, 0, _FALLBACK_DPI)
        return png_bytes
    finally:
        document.close()


def _render_page_at_dpi(document: fitz.Document, page_index: int, dpi: int) -> bytes:
    """
    Render one page at an exact DPI and encode it as PNG.

    Stamps the render DPI into the PNG resolution metadata so the true pixel
    density is reported correctly to image viewers.

    Inputs: open PyMuPDF document, zero-based page index, and DPI.
    Outputs: PNG-encoded bytes for that page.
    """
    page = document.load_page(page_index)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix)
    pixmap.set_dpi(dpi, dpi)
    return pixmap.tobytes("png")
