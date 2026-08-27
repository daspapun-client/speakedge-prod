"""Tabular exports in the three formats the spec asks for: CSV, Excel, PDF.

One helper so every export surface (analytics, partner reports) streams the
same way and picks up new formats at once. ``rows`` may be any iterable of
sequences — a generator keeps large exports off the heap for CSV.
"""
from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence

from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

EXPORT_FORMATS = ("csv", "xlsx", "pdf")

try:  # openpyxl is optional; exports fall back to CSV if it is not installed.
    from openpyxl import Workbook
    _HAS_XLSX = True
except ImportError:  # pragma: no cover
    _HAS_XLSX = False


def _attachment(name: str) -> dict:
    return {"Content-Disposition": f"attachment; filename={name}"}


def _csv_stream(header: list[str], rows: Iterable[Sequence]):
    def _iter():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(header)
        yield buf.getvalue(); buf.seek(0); buf.truncate(0)
        for row in rows:
            w.writerow(row)
            yield buf.getvalue(); buf.seek(0); buf.truncate(0)
    return _iter


def table_pdf_bytes(title: str, header: list[str], rows: Iterable[Sequence]) -> bytes:
    """A landscape A4 table — readable for the wide report exports."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                            leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm)
    styles = getSampleStyleSheet()
    cell = styles["BodyText"]
    cell.fontSize = 8
    cell.leading = 10

    data = [[Paragraph(f"<b>{h}</b>", cell) for h in header]]
    data += [[Paragraph(str(v if v is not None else ""), cell) for v in row] for row in rows]
    if len(data) == 1:
        data.append([Paragraph("No records", cell)] + [""] * (len(header) - 1))

    table = Table(data, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f2c59")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9d2e0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f6fa")]),
    ]))
    doc.build([Paragraph(f"<b>{title}</b>", styles["Title"]), table])
    return buf.getvalue()


def export_response(basename: str, header: list[str], rows: Iterable[Sequence],
                    fmt: str = "csv", title: str | None = None) -> StreamingResponse:
    """CSV (default), XLSX or PDF StreamingResponse for the given rows."""
    if fmt == "xlsx" and _HAS_XLSX:
        wb = Workbook()
        ws = wb.active
        ws.append(header)
        for row in rows:
            ws.append(list(row))
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=_attachment(f"{basename}.xlsx"))
    if fmt == "pdf":
        pdf = table_pdf_bytes(title or basename.replace("_", " ").title(), header, rows)
        return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                                 headers=_attachment(f"{basename}.pdf"))
    return StreamingResponse(_csv_stream(header, rows)(), media_type="text/csv",
                             headers=_attachment(f"{basename}.csv"))
