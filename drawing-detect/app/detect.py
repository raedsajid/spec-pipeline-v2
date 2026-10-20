"""Detect schedule-table crops from a single-page drawing PDF (OpenCV path)."""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.pdf_rendering.pdf_to_image import render_pdf_to_image
from app.settings import DRAWING_RENDER_DPI
from app.table_cropping.table_crop import pad_table_box
from app.table_detection.cell_detection import detect_cells
from app.table_detection.line_detection import detect_grid_lines
from app.table_detection.table_assembly import (
    assemble_tables,
    filter_schedule_tables,
)


def _table_id(index: int) -> str:
    return f"table_{index:02d}"


def detect_tables_from_pdf_bytes(
    pdf_bytes: bytes,
    *,
    page: int = 1,
    dpi: int | None = None,
) -> dict:
    """
    Run BuildERP-AI detect → pad; return normalized crop boxes for Next.js.

    Inputs: single-page PDF bytes (caller splits multi-page drawings).
    Outputs: {page, renderWidth, renderHeight, dpi, crops:[{id,page,bbox}]}.
    """
    resolved_dpi = dpi if dpi is not None else DRAWING_RENDER_DPI
    with tempfile.TemporaryDirectory(prefix="drawing-detect-") as tmp:
        pdf_path = Path(tmp) / "page.pdf"
        pdf_path.write_bytes(pdf_bytes)
        png_bytes = render_pdf_to_image(pdf_path, dpi=resolved_dpi)

    grid = detect_grid_lines(png_bytes)
    width, height = grid.width, grid.height
    cells = detect_cells(grid)
    tables = filter_schedule_tables(
        assemble_tables(cells, grid),
        width=width,
    )
    del cells
    del grid

    crops: list[dict] = []
    for index, box in enumerate(tables, start=1):
        padded = pad_table_box(box, width=width, height=height)
        bbox = [
            padded.x / width,
            padded.y / height,
            padded.w / width,
            padded.h / height,
        ]
        crops.append(
            {
                "id": _table_id(index),
                "page": page,
                "bbox": bbox,
            }
        )

    return {
        "page": page,
        "renderWidth": width,
        "renderHeight": height,
        "dpi": resolved_dpi,
        "crops": crops,
    }
