import re

import pytest
from blueberrychain.sim.pdf import render_pdf


def test_pdf_structure_and_xref_offsets_are_valid():
    pdf = render_pdf(["Lot L-2291", "Pulp (core) temperature: 1.0 C"], title="Cert")
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")

    startxref = int(re.search(rb"startxref\n(\d+)\n", pdf).group(1))
    assert pdf[startxref:].startswith(b"xref")

    # every xref entry must point at the start of "<n> 0 obj"
    entries = re.findall(rb"(\d{10}) 00000 n ", pdf[startxref:])
    for number, offset in enumerate(entries, start=1):
        assert pdf[int(offset) :].startswith(b"%d 0 obj" % number)


def test_text_is_escaped_and_output_is_deterministic():
    pdf = render_pdf(["a (b) \\ c"])
    assert rb"a \(b\) \\ c" in pdf
    assert render_pdf(["same"]) == render_pdf(["same"])


def test_rejects_overflowing_page():
    with pytest.raises(ValueError):
        render_pdf(["x"] * 100)
