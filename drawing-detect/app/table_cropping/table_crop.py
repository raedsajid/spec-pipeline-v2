"""
Crop schedule-table regions from a rendered drawing sheet.

Fifth stage of the drawing pipeline (after ``table_assembly``). Each assembled
table box wraps the ruled grid body; schedule titles usually sit above the top
rule. This stage applies asymmetric padding (more upward) and slices tight BGR
crops for downstream LLM extraction.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.table_detection.cell_detection import Box

# Padding fractions are resolution-relative so they hold across render DPIs.

# Upward pad captures the title row above the top rule.
_TOP_PAD_FRAC = 0.008
# Side/bottom pads keep outer rules visible without swallowing neighbors.
_SIDE_PAD_FRAC = 0.004
_BOTTOM_PAD_FRAC = 0.004


@dataclass(frozen=True)
class TableCrop:
    """
    One padded table crop extracted from a full sheet.

    Attributes:
        source_box: table box from ``assemble_tables`` before padding.
        padded_box: clamped box used for the slice.
        image: BGR crop pixels (a view-safe copy from the source sheet).
    """

    source_box: Box
    padded_box: Box
    image: np.ndarray


def pad_table_box(
    box: Box,
    *,
    width: int,
    height: int,
    top_pad_frac: float = _TOP_PAD_FRAC,
    side_pad_frac: float = _SIDE_PAD_FRAC,
    bottom_pad_frac: float = _BOTTOM_PAD_FRAC,
) -> Box:
    """
    Expand a table box with asymmetric padding, clamped to the sheet bounds.

    More padding is applied upward so schedule titles above the top rule are
    included; side and bottom pads are smaller to avoid bleeding into neighbors
    on packed sheets.

    Inputs:
        box: table bounding box from ``assemble_tables``.
        width: source sheet width in pixels.
        height: source sheet height in pixels.
        top_pad_frac: upward pad as a fraction of sheet height.
        side_pad_frac: left/right pad as a fraction of sheet width.
        bottom_pad_frac: downward pad as a fraction of sheet height.
    Outputs: padded ``Box`` clamped inside the sheet.
    """
    pad_top = max(int(height * top_pad_frac), 1)
    pad_side = max(int(width * side_pad_frac), 1)
    pad_bottom = max(int(height * bottom_pad_frac), 1)

    x1 = max(0, box.x - pad_side)
    y1 = max(0, box.y - pad_top)
    x2 = min(width, box.x + box.w + pad_side)
    y2 = min(height, box.y + box.h + pad_bottom)
    return Box(x1, y1, x2 - x1, y2 - y1)


def crop_one_table(
    sheet_bgr: np.ndarray,
    box: Box,
    *,
    top_pad_frac: float = _TOP_PAD_FRAC,
    side_pad_frac: float = _SIDE_PAD_FRAC,
    bottom_pad_frac: float = _BOTTOM_PAD_FRAC,
) -> TableCrop:
    """
    Slice one padded table crop from a full sheet.

    Prefer this in the production pipeline so only one crop bitmap exists at a
    time (``crop_tables`` materializes every table copy at once).

    Inputs:
        sheet_bgr: full-page drawing sheet as a BGR ``uint8`` array.
        box: one table box from ``assemble_tables``.
        top_pad_frac / side_pad_frac / bottom_pad_frac: pad fractions.
    Outputs: one ``TableCrop`` with a copied BGR slice.
    Raises: ``ValueError`` if ``sheet_bgr`` is not a 3-channel image.
    """
    if sheet_bgr.ndim != 3 or sheet_bgr.shape[2] != 3:
        raise ValueError("sheet_bgr must be a 3-channel BGR image.")

    height, width = sheet_bgr.shape[:2]
    padded = pad_table_box(
        box,
        width=width,
        height=height,
        top_pad_frac=top_pad_frac,
        side_pad_frac=side_pad_frac,
        bottom_pad_frac=bottom_pad_frac,
    )
    slice_y2 = padded.y + padded.h
    slice_x2 = padded.x + padded.w
    image = sheet_bgr[padded.y : slice_y2, padded.x : slice_x2].copy()
    return TableCrop(source_box=box, padded_box=padded, image=image)


def crop_tables(
    sheet_bgr: np.ndarray,
    tables: list[Box],
    *,
    top_pad_frac: float = _TOP_PAD_FRAC,
    side_pad_frac: float = _SIDE_PAD_FRAC,
    bottom_pad_frac: float = _BOTTOM_PAD_FRAC,
) -> list[TableCrop]:
    """
    Slice padded crops for each assembled table box.

    Convenience for demos/overlays. Production prefers ``crop_one_table`` in a
    loop so all crop bitmaps are not held at once.

    Inputs:
        sheet_bgr: full-page drawing sheet as a BGR ``uint8`` array.
        tables: table boxes from ``assemble_tables``.
        top_pad_frac: upward pad as a fraction of sheet height.
        side_pad_frac: left/right pad as a fraction of sheet width.
        bottom_pad_frac: downward pad as a fraction of sheet height.
    Outputs: one ``TableCrop`` per input table, in the same order.
    Raises: ``ValueError`` if ``sheet_bgr`` is not a 3-channel image.
    """
    return [
        crop_one_table(
            sheet_bgr,
            box,
            top_pad_frac=top_pad_frac,
            side_pad_frac=side_pad_frac,
            bottom_pad_frac=bottom_pad_frac,
        )
        for box in tables
    ]
