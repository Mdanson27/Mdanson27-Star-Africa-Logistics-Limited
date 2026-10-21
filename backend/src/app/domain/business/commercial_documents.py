from __future__ import annotations

from collections.abc import Iterable
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

COMPANY_NAME = "Star Africa Logistics Limited"
COMPANY_ADDRESS = ""
COMPANY_POSTAL = ""
COMPANY_EMAIL = "info@starafricalogistics.com"
COMPANY_PHONE = ""
COMPANY_TIN = ""
LOGO_PATH = Path(__file__).resolve().parents[2] / "assets" / "star-africa-logo.png"


def _invariant_canvas(*args, **kwargs):
    """Create deterministic PDFs so unchanged records do not create fake new versions."""
    kwargs["invariant"] = 1
    return Canvas(*args, **kwargs)


def money(value: float) -> str:
    return f"UGX {value:,.0f}"


def _logo(max_width: float = 42 * mm, max_height: float = 28 * mm):
    if not LOGO_PATH.exists():
        return Spacer(1, 1)
    reader = ImageReader(str(LOGO_PATH))
    width, height = reader.getSize()
    scale = min(max_width / width, max_height / height)
    return Image(str(LOGO_PATH), width=width * scale, height=height * scale)


def _styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="DocTitle",
            parent=styles["Heading1"],
            fontSize=17,
            leading=20,
            textColor=colors.HexColor("#022E55"),
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            name="RightSmall",
            parent=styles["BodyText"],
            fontSize=8.5,
            leading=11,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#35495E"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["BodyText"],
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#35495E"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="Section",
            parent=styles["Heading2"],
            fontSize=10,
            leading=12,
            textColor=colors.HexColor("#022E55"),
            spaceBefore=6,
            spaceAfter=4,
        )
    )
    return styles


def _header(styles, document_title: str, document_number: str):
    company_lines = [f"<b>{COMPANY_NAME}</b>"]
    company_lines.extend(
        value for value in (COMPANY_ADDRESS, COMPANY_POSTAL, COMPANY_EMAIL, COMPANY_PHONE) if value
    )
    if COMPANY_TIN:
        company_lines.append(f"TIN: {COMPANY_TIN}")
    company = Paragraph("<br/>".join(company_lines), styles["RightSmall"])
    header = Table([[_logo(), company]], colWidths=[70 * mm, 105 * mm])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.8, colors.HexColor("#D8E2EC")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    title = Table(
        [
            [
                Paragraph(document_title.upper(), styles["DocTitle"]),
                Paragraph(f"<b>{document_number}</b>", styles["RightSmall"]),
            ]
        ],
        colWidths=[105 * mm, 70 * mm],
    )
    return [header, Spacer(1, 6 * mm), title, Spacer(1, 2 * mm)]


def render_commercial_document(
    *,
    document_title: str,
    document_number: str,
    party_label: str,
    party_name: str,
    party_lines: Iterable[str] = (),
    date_rows: Iterable[tuple[str, str]] = (),
    items: Iterable[tuple[str, float, float]],
    total_ugx: float,
    status: str,
    notes: str | None = None,
    financial_rows: Iterable[tuple[str, str]] = (),
    footer_note: str | None = None,
) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    styles = _styles()
    story = _header(styles, document_title, document_number)

    party_text = f"<b>{party_label}</b><br/><b>{party_name}</b>"
    for line in party_lines:
        if line:
            party_text += f"<br/>{line}"
    dates_text = "<b>Document details</b>"
    for label, value in date_rows:
        dates_text += f"<br/>{label}: {value}"
    dates_text += f"<br/>Status: {status.replace('_', ' ').title()}"
    detail = Table(
        [[Paragraph(party_text, styles["Small"]), Paragraph(dates_text, styles["RightSmall"])]],
        colWidths=[95 * mm, 80 * mm],
    )
    detail.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D8E2EC")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FC")),
                ("PADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([detail, Spacer(1, 6 * mm)])

    rows = [["#", "Description", "Qty", "Unit Price", "Amount"]]
    for index, (description, quantity, unit_price) in enumerate(items, start=1):
        rows.append(
            [
                str(index),
                Paragraph(description, styles["Small"]),
                f"{quantity:g}",
                money(unit_price),
                money(quantity * unit_price),
            ]
        )
    rows.append(["", "", "", "TOTAL", money(total_ugx)])
    table = Table(rows, colWidths=[10 * mm, 78 * mm, 18 * mm, 34 * mm, 35 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#022E55")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -2), 0.4, colors.HexColor("#D8E2EC")),
                ("LINEABOVE", (3, -1), (-1, -1), 0.8, colors.HexColor("#022E55")),
                ("FONTNAME", (3, -1), (-1, -1), "Helvetica-Bold"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend([table, Spacer(1, 5 * mm)])

    extra_rows = list(financial_rows)
    if extra_rows:
        fin = Table(
            [
                [
                    Paragraph(f"<b>{label}</b>", styles["Small"]),
                    Paragraph(value, styles["RightSmall"]),
                ]
                for label, value in extra_rows
            ],
            colWidths=[105 * mm, 70 * mm],
        )
        fin.setStyle(
            TableStyle(
                [
                    ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E6EBF0")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.extend([fin, Spacer(1, 4 * mm)])

    if notes:
        story.extend(
            [
                Paragraph("Notes / Terms", styles["Section"]),
                Paragraph(notes.replace("\n", "<br/>"), styles["Small"]),
                Spacer(1, 5 * mm),
            ]
        )
    story.extend(
        [
            Spacer(1, 4 * mm),
            Paragraph(
                footer_note or "Generated by Star Africa Logistics Operating System.",
                styles["Small"],
            ),
        ]
    )
    doc.build(story, canvasmaker=_invariant_canvas)
    return buf.getvalue()


def render_statement(
    *,
    document_title: str,
    document_number: str,
    party_label: str,
    party_name: str,
    party_lines: Iterable[str] = (),
    rows: Iterable[tuple[str, str, str, float, float, float]],
    summary_rows: Iterable[tuple[str, str]] = (),
    period_label: str = "All activity",
) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )
    styles = _styles()
    story = _header(styles, document_title, document_number)
    party = f"<b>{party_label}</b><br/><b>{party_name}</b>"
    for line in party_lines:
        if line:
            party += f"<br/>{line}"
    story.extend(
        [
            Paragraph(party, styles["Small"]),
            Paragraph(f"Period: {period_label}", styles["Small"]),
            Spacer(1, 5 * mm),
        ]
    )
    data = [["Date", "Type", "Reference", "Debit", "Credit", "Balance"]]
    for entry_date, kind, reference, debit, credit, balance in rows:
        data.append(
            [
                entry_date,
                kind,
                reference,
                money(debit) if debit else "?",
                money(credit) if credit else "?",
                money(balance),
            ]
        )
    if len(data) == 1:
        data.append(["?", "?", "No activity", "?", "?", "?"])
    table = Table(
        data, colWidths=[23 * mm, 23 * mm, 45 * mm, 28 * mm, 28 * mm, 30 * mm], repeatRows=1
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#022E55")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D8E2EC")),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([table, Spacer(1, 5 * mm)])
    summary = list(summary_rows)
    if summary:
        summary_table = Table(
            [
                [
                    Paragraph(f"<b>{label}</b>", styles["Small"]),
                    Paragraph(value, styles["RightSmall"]),
                ]
                for label, value in summary
            ],
            colWidths=[105 * mm, 72 * mm],
        )
        summary_table.setStyle(
            TableStyle(
                [
                    ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E6EBF0")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(summary_table)
    story.extend(
        [
            Spacer(1, 5 * mm),
            Paragraph("Generated by Star Africa Logistics Operating System.", styles["Small"]),
        ]
    )
    doc.build(story, canvasmaker=_invariant_canvas)
    return buf.getvalue()
