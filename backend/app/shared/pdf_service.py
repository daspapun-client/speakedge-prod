"""Server-side PDF generation for invoices, CEFR report cards, certificates.

Uses ReportLab (pure-Python, no system deps) so it runs on Windows locally
without WeasyPrint/GTK. Output is stored via file_service and returned as a URL.
"""
import io
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.shared import file_service

BRAND_BLUE = (0 / 255, 82 / 255, 155 / 255)  # #00529B
BRAND_GOLD = (244 / 255, 180 / 255, 0 / 255)  # #F4B400


def _header(c: canvas.Canvas, title: str) -> None:
    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(0, 277 * mm, 210 * mm, 20 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(15 * mm, 283 * mm, "SpeakEdge")
    c.setFont("Helvetica", 11)
    c.drawRightString(195 * mm, 283 * mm, title)
    c.setFillColorRGB(0, 0, 0)


def generate_invoice(invoice_no: str, student_name: str, student_id: str, item: str, amount_paise: int) -> str:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _header(c, "TAX INVOICE")
    y = 255 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(15 * mm, y, f"Invoice #: {invoice_no}")
    c.setFont("Helvetica", 11)
    c.drawString(15 * mm, y - 8 * mm, f"Date: {datetime.utcnow():%Y-%m-%d}")
    c.drawString(15 * mm, y - 16 * mm, f"Billed to: {student_name} ({student_id})")

    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(15 * mm, y - 30 * mm, 180 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(18 * mm, y - 28 * mm, "Description")
    c.drawRightString(192 * mm, y - 28 * mm, "Amount (INR)")

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 11)
    amt = amount_paise / 100
    c.drawString(18 * mm, y - 40 * mm, item)
    c.drawRightString(192 * mm, y - 40 * mm, f"{amt:,.2f}")
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(192 * mm, y - 55 * mm, f"Total: INR {amt:,.2f}")

    c.setFont("Helvetica-Oblique", 9)
    c.drawString(15 * mm, 20 * mm, "Sujyoti EdTech Pvt. Ltd.  •  GST-ready invoice  •  This is a computer-generated document.")
    c.showPage()
    c.save()
    buf.seek(0)
    return file_service.save_bytes(buf.getvalue(), "invoices", ext="pdf")


def order_receipt_bytes(*, order_number: str, buyer_name: str, phone: str, status: str,
                        lines: list[tuple[str, int]], total_paise: int,
                        placed_on: datetime, address: str | None = None) -> bytes:
    """Order receipt for the checkout confirmation screen. Returned as bytes
    (not persisted) — it is rendered on demand from the order, so a buyer can
    download it the moment the order exists, before payment is reconciled."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _header(c, "ORDER RECEIPT")
    y = 255 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(15 * mm, y, f"Order #: {order_number}")
    c.setFont("Helvetica", 11)
    c.drawString(15 * mm, y - 8 * mm, f"Date: {placed_on:%Y-%m-%d}")
    c.drawString(15 * mm, y - 16 * mm, f"Status: {status}")
    c.drawString(15 * mm, y - 24 * mm, f"Billed to: {buyer_name} ({phone})")
    if address:
        c.setFont("Helvetica", 9)
        c.drawString(15 * mm, y - 31 * mm, f"Delivery: {address[:110]}")

    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(15 * mm, y - 45 * mm, 180 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(18 * mm, y - 43 * mm, "Description")
    c.drawRightString(192 * mm, y - 43 * mm, "Amount (INR)")

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 11)
    row = y - 55 * mm
    for label, paise in lines:
        c.drawString(18 * mm, row, label)
        c.drawRightString(192 * mm, row, f"{paise / 100:,.2f}")
        row -= 8 * mm
    c.line(15 * mm, row + 3 * mm, 195 * mm, row + 3 * mm)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(192 * mm, row - 5 * mm, f"Total: INR {total_paise / 100:,.2f}")

    c.setFont("Helvetica-Bold", 10)
    c.drawString(15 * mm, 35 * mm, "What happens next")
    c.setFont("Helvetica", 9)
    c.drawString(15 * mm, 29 * mm, "Our executive will contact you by phone at the number provided within 48 hours")
    c.drawString(15 * mm, 24 * mm, "to guide you through the next step of your SpeakEdge journey.")
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(15 * mm, 15 * mm, "Sujyoti EdTech Pvt. Ltd.  -  This is a computer-generated document.")
    c.showPage()
    c.save()
    return buf.getvalue()


def generate_certificate(title: str, student_name: str, student_id: str, verification_code: str) -> str:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(10 * mm, 10 * mm, 190 * mm, 277 * mm, fill=0, stroke=1)
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(105 * mm, 240 * mm, "Certificate of Achievement")
    c.setFillColorRGB(*BRAND_GOLD)
    c.rect(60 * mm, 232 * mm, 90 * mm, 2 * mm, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 14)
    c.drawCentredString(105 * mm, 200 * mm, "This is proudly presented to")
    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(105 * mm, 185 * mm, student_name)
    c.setFont("Helvetica", 13)
    c.drawCentredString(105 * mm, 165 * mm, title)
    c.setFont("Helvetica", 10)
    c.drawCentredString(105 * mm, 60 * mm, f"Student ID: {student_id}")
    c.drawCentredString(105 * mm, 52 * mm, f"Verification code: {verification_code}")
    c.drawCentredString(105 * mm, 44 * mm, "Verify at /verify/{code}")
    c.showPage()
    c.save()
    buf.seek(0)
    return file_service.save_bytes(buf.getvalue(), "certificates", ext="pdf")


def generate_cefr_report(student_name: str, student_id: str, level: str, scores: dict, verification_code: str) -> str:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _header(c, "CEFR REPORT CARD")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(15 * mm, 255 * mm, f"{student_name}  ({student_id})")
    c.setFont("Helvetica-Bold", 40)
    c.setFillColorRGB(*BRAND_BLUE)
    c.drawString(15 * mm, 235 * mm, f"CEFR Level: {level}")
    c.setFillColorRGB(0, 0, 0)
    y = 215 * mm
    c.setFont("Helvetica", 12)
    for k, v in (scores or {}).items():
        c.drawString(15 * mm, y, f"{k}: {v}")
        y -= 8 * mm
    c.setFont("Helvetica", 10)
    c.drawString(15 * mm, 30 * mm, f"Verification code: {verification_code}")
    c.showPage()
    c.save()
    buf.seek(0)
    return file_service.save_bytes(buf.getvalue(), "reports", ext="pdf")
