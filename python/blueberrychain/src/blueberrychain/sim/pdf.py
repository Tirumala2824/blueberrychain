"""Minimal, dependency-free PDF writer for simulated documents.

Produces single-page PDFs with a real text layer (Helvetica), which is what
Cortex AI_EXTRACT needs. Output is deterministic for the same input, so
generated documents hash identically across runs.
"""

from __future__ import annotations

PAGE_WIDTH, PAGE_HEIGHT = 612, 792  # US Letter, points
MARGIN_LEFT, TOP, LEADING = 72, 720, 16


def _escape(text: str) -> str:
    # PDF literal strings: escape backslash and parentheses; keep Latin-1 only.
    safe = text.encode("latin-1", "replace").decode("latin-1")
    return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(lines: list[str], title: str = "", font_size: int = 11) -> bytes:
    """Render text lines onto one page and return the PDF bytes."""
    if len(lines) > (TOP - 60) // LEADING:
        raise ValueError("too many lines for a single page")

    ops = ["BT", f"/F1 {font_size} Tf", f"{LEADING} TL", f"{MARGIN_LEFT} {TOP} Td"]
    for i, line in enumerate(lines):
        ops.append(f"({_escape(line)}) Tj" if i == 0 else f"({_escape(line)}) '")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")

    info = f"<< /Title ({_escape(title)}) /Producer (BlueberryChain OS simulator) >>"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ).encode("latin-1"),
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        info.encode("latin-1"),
    ]

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        len(objects),
        xref_at,
    )
    return bytes(out)
