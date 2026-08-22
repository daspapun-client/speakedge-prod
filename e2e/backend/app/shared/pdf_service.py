"""Server-side PDF generation for invoices, CEFR report cards, certificates.

Uses ReportLab (pure-Python, no system deps) so it runs on Windows locally
without WeasyPrint/GTK. Output is stored via file_service and returned as a URL.
"""
import io
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.shared import file_service

BRAND_BLUE = (0 / 255, 82 / 255, 155 / 255)  # #00529B
BRAND_GOLD = (244 / 255, 180 / 255, 0 / 255)  # #F4B400

# Brand mark printed on every customer-facing document (invoice, order receipt,
# report card, certificate). Bundled with the backend so a PDF never depends on
# the frontend build or a network fetch.
LOGO_PATH = Path(__file__).with_name("assets") / "speakedge-logo.png"


def _logo() -> ImageReader | None:
    """The brand mark, or None if the asset is missing — a document is still
    worth producing without it."""
    try:
        return ImageReader(str(LOGO_PATH))
    except Exception:  # pragma: no cover - only when the asset is absent
        return None


def draw_logo(c: canvas.Canvas, x: float, y: float, size: float) -> bool:
    """Draw the logo in a white rounded tile (the web lockup) at (x, y).

    The mark is white-backed artwork, so the tile is what keeps it from reading
    as a hard square against the blue band. True when it was drawn."""
    img = _logo()
    if img is None:
        return False
    pad = size * 0.08
    c.setFillColorRGB(1, 1, 1)
    c.roundRect(x, y, size, size, size * 0.22, fill=1, stroke=0)
    c.drawImage(img, x + pad, y + pad, width=size - 2 * pad, height=size - 2 * pad,
                mask="auto", preserveAspectRatio=True)
    return True


def _header(c: canvas.Canvas, title: str) -> None:
    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(0, 277 * mm, 210 * mm, 20 * mm, fill=1, stroke=0)
    # Logo first, wordmark beside it; text falls back to the left margin when
    # the asset is unavailable so the header never looks half-drawn.
    text_x = 15 * mm
    if draw_logo(c, 15 * mm, 280.5 * mm, 13 * mm):
        text_x = 31 * mm
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(text_x, 283 * mm, "SpeakEdge")
    c.setFont("Helvetica", 11)
    c.drawRightString(195 * mm, 283 * mm, title)
    c.setFillColorRGB(0, 0, 0)


def generate_invoice(invoice_no: str, student_name: str, student_id: str, item: str,
                     amount_paise: int, *, taxable_amount: int | None = None,
                     cgst: int | None = None, sgst: int | None = None,
                     igst: int | None = None, gstin: str | None = None) -> str:
    """Invoice PDF. Passing a GSTIN and the tax split prints a real tax breakup
    (taxable value + CGST/SGST or IGST); without them the document is a plain
    receipt for a tax-inclusive price, which is what it must say when the seller
    is not GST-registered."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _header(c, "TAX INVOICE" if gstin else "INVOICE")
    y = 255 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(15 * mm, y, f"Invoice #: {invoice_no}")
    c.setFont("Helvetica", 11)
    c.drawString(15 * mm, y - 8 * mm, f"Date: {datetime.utcnow():%Y-%m-%d}")
    c.drawString(15 * mm, y - 16 * mm, f"Billed to: {student_name} ({student_id})")
    if gstin:
        c.setFont("Helvetica", 9)
        c.drawString(15 * mm, y - 22 * mm, f"Seller GSTIN: {gstin}")

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

    row = y - 40 * mm
    if taxable_amount is not None:
        c.drawRightString(192 * mm, row, f"{taxable_amount / 100:,.2f}")
        for label, value in (("CGST", cgst), ("SGST", sgst), ("IGST", igst)):
            if not value:
                continue
            row -= 7 * mm
            c.drawString(18 * mm, row, label)
            c.drawRightString(192 * mm, row, f"{value / 100:,.2f}")
    else:
        c.drawRightString(192 * mm, row, f"{amt:,.2f}")

    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(192 * mm, row - 15 * mm, f"Total: INR {amt:,.2f}")

    c.setFont("Helvetica-Oblique", 9)
    footer = "Sujyoti EdTech Pvt. Ltd.  •  This is a computer-generated document."
    if not gstin:
        footer = ("Sujyoti EdTech Pvt. Ltd.  •  Price is inclusive of all applicable taxes."
                  "  •  This is a computer-generated document.")
    c.drawString(15 * mm, 20 * mm, footer)
    c.showPage()
    c.save()
    buf.seek(0)
    return file_service.save_bytes(buf.getvalue(), "invoices", ext="pdf")


# One receipt design, five transaction types. The key drives what the document
# calls itself and the closing note; each builder decides which key applies, so
# only information relevant to that transaction ever appears.
RECEIPT_TYPES = {
    "new_membership": "New Membership",
    "membership_upgrade": "Membership Upgrade",
    "membership_renewal": "Membership Renewal",
    "monthly_class": "Monthly Teacher-led Class Payment",
    "monthly_class_restart": "Monthly Teacher-led Class Payment",
    "book_purchase": "Book Purchase",
    "general": "General Payment",
}

# (heading, body). Bodies may carry {placeholders} the caller formats in.
RECEIPT_NOTES = {
    "new_membership": (
        "What Happens Next?",
        "Our executive will contact you by phone at the number provided within 48 hours "
        "to guide you through the next steps of your SpeakEdge membership activation.",
    ),
    "membership_upgrade": (
        "Membership Upgraded",
        "Your payment has been successfully received and your SpeakEdge membership has "
        "been upgraded to {plan}. The applicable upgraded membership benefits and "
        "validity will be reflected in your account.",
    ),
    "membership_renewal": (
        "Membership Confirmed",
        "Your payment has been successfully received and your SpeakEdge membership is "
        "active. The applicable benefits and validity are reflected in your account.",
    ),
    "monthly_class": (
        "Payment Confirmed",
        "Your monthly payment has been successfully received. Your Teacher-led Class "
        "access will continue for the applicable monthly period.",
    ),
    "monthly_class_restart": (
        "Teacher-led Classes Resumed",
        "Your monthly payment has been successfully received. Your Teacher-led Class "
        "access will resume according to your applicable membership and class schedule.",
    ),
    "book_purchase": (
        "Order Confirmed",
        "Your payment has been successfully received. Your book order will be processed "
        "according to the selected delivery or collection method.",
    ),
    "general": (
        "Payment Confirmed",
        "Your payment of {amount} towards {purpose} has been successfully received.",
    ),
}


def receipt_note(key: str, **fields) -> tuple[str, str]:
    """The (heading, body) for a receipt type, with any placeholders filled."""
    title, body = RECEIPT_NOTES[key]
    return title, body.format(**fields) if fields else body


def _wrap(c: canvas.Canvas, text: str, width: float, font: str, size: float) -> list[str]:
    """Split `text` into lines that fit `width` at the given font."""
    from reportlab.lib.utils import simpleSplit

    return simpleSplit(text, font, size, width)


def payment_receipt_bytes(*, receipt_no: str, date: datetime, status: str,
                          customer_name: str, mobile: str,
                          lines: list[tuple[str, int | str]], total_paise: int,
                          transaction_type: str | None = None,
                          student_id: str | None = None, delivery: str | None = None,
                          extra_meta: list[tuple[str, str]] | None = None,
                          total_label: str = "Total Paid",
                          payment_status: str = "Paid",
                          transaction_id: str | None = None,
                          note_title: str | None = None,
                          note_body: str | None = None) -> bytes:
    """The Payment / Order Receipt — one design for every kind of payment.

    Everything below the header is dynamic, and the caller passes only what
    applies to that transaction: `transaction_type` names it (New Membership,
    Membership Upgrade, Monthly Teacher-led Class Payment, Book Purchase,
    General Payment), `student_id` and `delivery` are omitted where they do not
    apply (a guest has no ID; nothing ships on an upgrade, a monthly fee or a
    general payment), `extra_meta` carries type-specific rows such as the
    previous and upgraded membership, and `note_title`/`note_body` close the
    document — see RECEIPT_NOTES / receipt_note().

    Returned as bytes rather than persisted: it is rendered on demand from the
    order/payment, so it is downloadable before the payment is reconciled."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _header(c, "PAYMENT / ORDER RECEIPT")

    left, right = 15 * mm, 195 * mm
    y = 258 * mm

    rows = [("Receipt / Order No.", receipt_no), ("Date", f"{date:%d %b %Y}")]
    if transaction_type:
        rows.append(("Transaction Type", transaction_type))
    rows.append(("Status", status))
    rows.append(("Customer", customer_name))
    if student_id:                      # guests, and book-only buyers, have none
        rows.append(("Student ID", student_id))
    rows.append(("Mobile", mobile))
    rows.extend(extra_meta or [])       # e.g. previous / upgraded membership
    if delivery:                        # only where something physical moves
        rows.append(("Delivery", delivery))

    # Size the value column to the widest label present, so a long label never
    # runs into its own value and a short set of rows is not left with a gap.
    label_w = max(c.stringWidth(f"{label}:", "Helvetica-Bold", 10)
                  for label, _ in rows) + 4 * mm
    for label, value in rows:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left, y, f"{label}:")
        c.setFont("Helvetica", 10)
        # A delivery address is long enough to need wrapping rather than a
        # truncation that cuts a place name in half.
        for i, row in enumerate(_wrap(c, value, right - left - label_w, "Helvetica", 10)):
            c.drawString(left + label_w, y - i * 5 * mm, row)
            if i:
                y -= 5 * mm
        y -= 6.5 * mm

    # ---- Payment details ------------------------------------------------
    y -= 4 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "PAYMENT DETAILS")
    y -= 7 * mm

    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(left, y - 2 * mm, right - left, 8 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(left + 3 * mm, y + 0.5 * mm, "Description")
    c.drawRightString(right - 3 * mm, y + 0.5 * mm, "Amount (INR)")
    c.setFillColorRGB(0, 0, 0)
    y -= 10 * mm

    c.setFont("Helvetica", 10.5)
    for label, paise in lines:
        c.drawString(left + 3 * mm, y, label[:70])
        # A line may carry a word instead of a figure ("Included") for something
        # supplied at no charge — printing 0.00 there reads like a pricing bug.
        c.drawRightString(right - 3 * mm, y,
                          paise if isinstance(paise, str) else f"{paise / 100:,.2f}")
        y -= 7.5 * mm

    c.line(left, y + 2.5 * mm, right, y + 2.5 * mm)
    y -= 4 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left + 3 * mm, y, total_label)
    c.drawRightString(right - 3 * mm, y, f"{total_paise / 100:,.2f}")
    y -= 8 * mm

    c.setFont("Helvetica", 10)
    c.drawString(left + 3 * mm, y, f"Payment Status: {payment_status}")
    if transaction_id:
        y -= 6 * mm
        c.drawString(left + 3 * mm, y, f"Transaction ID: {transaction_id}")

    # ---- Closing note ----------------------------------------------------
    if note_body:
        body = _wrap(c, note_body, right - left - 12 * mm, "Helvetica", 9.5)
        box_h = 12 * mm + len(body) * 5 * mm
        y = max(y - 12 * mm - box_h, 30 * mm)
        c.setFillColorRGB(0.96, 0.97, 0.99)
        c.roundRect(left, y, right - left, box_h, 3 * mm, fill=1, stroke=0)
        c.setFillColorRGB(*BRAND_BLUE)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left + 6 * mm, y + box_h - 7 * mm, (note_title or "").upper())
        c.setFillColorRGB(0.15, 0.18, 0.22)
        c.setFont("Helvetica", 9.5)
        for i, row in enumerate(body):
            c.drawString(left + 6 * mm, y + box_h - 13 * mm - i * 5 * mm, row)
        c.setFillColorRGB(0, 0, 0)

    c.setFont("Helvetica-Bold", 9)
    c.drawString(left, 20 * mm, "Sujyoti EdTech Pvt. Ltd.")
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(left, 15 * mm,
                 "This is a computer-generated document and does not require a "
                 "physical signature.")
    c.showPage()
    c.save()
    return buf.getvalue()


def generate_certificate(title: str, student_name: str, student_id: str, verification_code: str) -> str:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFillColorRGB(*BRAND_BLUE)
    c.rect(10 * mm, 10 * mm, 190 * mm, 277 * mm, fill=0, stroke=1)
    draw_logo(c, 95 * mm, 258 * mm, 20 * mm)
    c.setFillColorRGB(0, 0, 0)
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
