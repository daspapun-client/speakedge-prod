"""Server-side PDF generation for invoices, CEFR report cards, certificates.

Uses ReportLab (pure-Python, no system deps) so it runs on Windows locally
without WeasyPrint/GTK. Output is stored via file_service and returned as a URL.
"""
import io
from datetime import datetime
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.core.config import settings
from app.shared import file_service

BRAND_BLUE = (0 / 255, 82 / 255, 155 / 255)  # #00529B
BRAND_GOLD = (244 / 255, 180 / 255, 0 / 255)  # #F4B400

# Brand mark printed on every customer-facing document (invoice, order receipt,
# report card, certificate). Bundled with the backend so a PDF never depends on
# the frontend build or a network fetch.
LOGO_PATH = Path(__file__).with_name("assets") / "speakedge-logo.png"
# Fixed artwork the dashboard CertificateSheet overlays — same file, same layout.
CERT_ART_PATH = Path(__file__).with_name("assets") / "certificate-cefr.png"
# Matches frontend print CSS (.cert-sheet @ 280mm × 186.667mm, 3:2).
CERT_SHEET_W = 280 * mm
CERT_SHEET_H = CERT_SHEET_W * 2 / 3
CERT_NAVY = (11 / 255, 39 / 255, 92 / 255)  # #0b275c
CERT_NAVY_DARK = (10 / 255, 36 / 255, 88 / 255)  # #0a2458


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


def invoice_bytes(invoice_no: str, student_name: str, student_id: str, item: str,
                  amount_paise: int, *, taxable_amount: int | None = None,
                  cgst: int | None = None, sgst: int | None = None,
                  igst: int | None = None, gstin: str | None = None) -> bytes:
    """Invoice PDF bytes. Passing a GSTIN and the tax split prints a real tax
    breakup; without them the document is a plain invoice for a tax-inclusive
    price, which is what it must say when the seller is not GST-registered.

    Rendered on demand the same way as the receipt — the copy written to disk at
    fulfilment is a cache, and downloads must not depend on it still being there
    (Railway's filesystem is ephemeral unless a volume is mounted)."""
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
    return buf.getvalue()


def generate_invoice(invoice_no: str, student_name: str, student_id: str, item: str,
                     amount_paise: int, *, taxable_amount: int | None = None,
                     cgst: int | None = None, sgst: int | None = None,
                     igst: int | None = None, gstin: str | None = None) -> str:
    """Persist an invoice at fulfilment and return the /media URL for it."""
    return file_service.save_bytes(
        invoice_bytes(invoice_no, student_name, student_id, item, amount_paise,
                      taxable_amount=taxable_amount, cgst=cgst, sgst=sgst,
                      igst=igst, gstin=gstin),
        "invoices", ext="pdf")


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


def _cert_date(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.strftime("%d %b %Y")


def _cert_art() -> ImageReader | None:
    try:
        return ImageReader(str(CERT_ART_PATH))
    except Exception:  # pragma: no cover - only when the asset is absent
        return None


def _cert_y(sheet_bottom: float, pct_from_top: float) -> float:
    """Vertical centre for a field positioned with CSS top + translateY(-50%)."""
    return sheet_bottom + CERT_SHEET_H * (1 - pct_from_top / 100)


def _cert_font(c: canvas.Canvas, family: str, cqw: float) -> None:
    """Font size in cqw — a percentage of the sheet width, like the web layout."""
    c.setFont(family, CERT_SHEET_W * cqw / 100)


def _draw_cert_qr(c: canvas.Canvas, url: str, left: float, bottom: float,
                  width: float, height: float) -> None:
    pad = CERT_SHEET_W * 0.003
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(*CERT_NAVY)
    c.setLineWidth(CERT_SHEET_W * 0.0012)
    c.roundRect(left, bottom, width, height, CERT_SHEET_W * 0.0045, fill=1, stroke=1)
    qr = QrCodeWidget(url)
    bounds = qr.getBounds()
    bw = bounds[2] - bounds[0]
    bh = bounds[3] - bounds[1]
    inner = min(width - 2 * pad, height - 2 * pad)
    d = Drawing(inner, inner, transform=[inner / bw, 0, 0, inner / bh, 0, 0])
    d.add(qr)
    renderPDF.draw(d, c, left + (width - inner) / 2, bottom + (height - inner) / 2)


def certificate_pdf_bytes(
    *,
    student_name: str,
    student_id: str,
    verification_code: str,
    cefr_level: str | None = None,
    assessment_date: datetime | None = None,
    issue_date: datetime | None = None,
) -> bytes:
    """Landscape certificate matching the dashboard CertificateSheet overlay."""
    buf = io.BytesIO()
    page = landscape(A4)
    c = canvas.Canvas(buf, pagesize=page)
    page_w, page_h = page
    sheet_x = (page_w - CERT_SHEET_W) / 2
    sheet_y = (page_h - CERT_SHEET_H) / 2

    art = _cert_art()
    if art is not None:
        c.drawImage(art, sheet_x, sheet_y, width=CERT_SHEET_W, height=CERT_SHEET_H,
                    preserveAspectRatio=False)

    def x_pct(pct: float) -> float:
        return sheet_x + CERT_SHEET_W * pct / 100

    detail_rows = (
        (41.26, student_name),
        (46.44, student_id),
        (51.71, _cert_date(assessment_date)),
        (56.98, _cert_date(issue_date)),
        (62.26, verification_code),
    )
    c.setFillColorRGB(*CERT_NAVY)
    for top, value in detail_rows:
        if not value:
            continue
        _cert_font(c, "Helvetica-Bold", 1.08)
        c.drawString(x_pct(19.9), _cert_y(sheet_y, top), value)

    name = student_name or student_id
    c.setFillColorRGB(*CERT_NAVY_DARK)
    _cert_font(c, "Times-Italic", 2.2)
    name_x = x_pct(34.35)
    name_w = CERT_SHEET_W * 0.34
    c.drawCentredString(name_x + name_w / 2, _cert_y(sheet_y, 43), name)

    if cefr_level:
        _cert_font(c, "Times-Bold", 2.66)
        level_x = x_pct(79.6)
        level_w = CERT_SHEET_W * 0.10
        c.drawCentredString(level_x + level_w / 2, _cert_y(sheet_y, 47.7), cefr_level)

    verify_url = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/verify/{verification_code}"
    qr_w = CERT_SHEET_W * 0.069
    qr_h = CERT_SHEET_H * 0.087
    qr_left = x_pct(81.1)
    qr_top = sheet_y + CERT_SHEET_H * (1 - 83.9 / 100)
    _draw_cert_qr(c, verify_url, qr_left, qr_top - qr_h, qr_w, qr_h)

    c.showPage()
    c.save()
    return buf.getvalue()


def generate_certificate(
    *,
    student_name: str,
    student_id: str,
    verification_code: str,
    cefr_level: str | None = None,
    assessment_date: datetime | None = None,
    issue_date: datetime | None = None,
) -> str:
    return file_service.save_bytes(
        certificate_pdf_bytes(
            student_name=student_name,
            student_id=student_id,
            verification_code=verification_code,
            cefr_level=cefr_level,
            assessment_date=assessment_date,
            issue_date=issue_date,
        ),
        "certificates", ext="pdf",
    )


def cefr_report_pdf_bytes(
    student_name: str, student_id: str, level: str, scores: dict, verification_code: str,
) -> bytes:
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
    verify_url = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/verify/{verification_code}"
    c.drawString(15 * mm, 24 * mm, f"Verify this report at {verify_url}")
    c.showPage()
    c.save()
    return buf.getvalue()


def generate_cefr_report(student_name: str, student_id: str, level: str, scores: dict, verification_code: str) -> str:
    return file_service.save_bytes(
        cefr_report_pdf_bytes(student_name, student_id, level, scores, verification_code),
        "reports", ext="pdf",
    )
