"""Independent PDF extraction, embedded-font, pagination, and geometry checks.

Requires PyMuPDF. Only reads PDFs; optional rendered PNGs and extracted text go to
the selected output directory. No browser or business API is used.
"""
import argparse
import json
from pathlib import Path

import fitz


def inspect(source: Path, output: Path, render: bool) -> dict:
    document = fitz.open(source)
    text = ""
    for index, page in enumerate(document):
        assert abs(page.rect.width - 595.2756) < 0.02, "expected A4 width"
        assert abs(page.rect.height - 841.8898) < 0.02, "expected A4 height"
        page_text = page.get_text()
        assert "PEDIDO DE VENDA" in page_text, "missing repeated identity"
        assert "Revisão" in page_text and "Página" in page_text, "missing revision/page"
        text += page_text
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    assert x0 >= 40 and x1 <= 555.3, (index + 1, "horizontal clipping", span)
                    assert y0 >= 20 and y1 <= 825, (index + 1, "vertical clipping", span)
        for font in page.get_fonts(full=True):
            assert document.extract_font(font[0])[3], ("font not embedded", font)
        if render:
            page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(
                output / f"{source.stem}-page-{index + 1}.png"
            )
    assert "TOTAL DO PEDIDO" in text, "missing total"
    assert "comprova" in text and "recebimento" in text, "missing planned-payment qualification"
    assert "\ufffd" not in text, "text extraction lost Unicode characters"
    (output / f"{source.stem}.txt").write_text(text, encoding="utf-8")
    return {"file": str(source), "pages": len(document), "bytes": source.stat().st_size,
            "a4": True, "embedded_fonts": True, "searchable": True, "bounds": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    print(json.dumps([inspect(path, args.output, args.render) for path in args.pdf]))


if __name__ == "__main__":
    main()
