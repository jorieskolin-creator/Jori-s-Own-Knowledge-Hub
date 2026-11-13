"""Generate the fictional Knowledge Hub corpus (requires reportlab)."""
import argparse
from html import escape
import json
from pathlib import Path

from reportlab.pdfgen.canvas import Canvas


def generate(fixture, directory):
    target = directory / fixture["file"]
    title, sentence = fixture["title"], fixture["text"]
    if target.suffix == ".html":
        prefix = ""
        if fixture.get("long_prefix"):
            prefix = "".join(
                f"<h2>Background {i}</h2><p>"
                + ("The catalog lists fictional inventory labels and ordinary housekeeping details. " * 15)
                + "</p>"
                for i in range(125)
            )
        target.write_text(
            f"<!doctype html><html lang='en'><meta charset='utf-8'><title>{escape(title)}</title>"
            f"<body><h1>{escape(title)}</h1>{prefix}<h2>Verification and findings</h2>"
            f"<p>{escape(sentence)}</p></body></html>\n", encoding="utf-8"
        )
    else:
        pdf = Canvas(str(target), invariant=1)
        pdf.setTitle(title)
        pdf.drawString(54, 770, title)
        if fixture.get("two_columns"):
            pdf.drawString(54, 735, "Exercise record")
            pdf.drawString(225, 735, sentence.split(" restored")[0])
            pdf.drawString(54, 719, "Grove Reach")
            pdf.drawString(225, 719, "restored" + sentence.split(" restored")[1])
        else:
            pdf.drawString(54, 735, sentence)
        pdf.showPage()
        if fixture.get("blank_second_page"):
            pdf.rect(54, 700, 240, 45)
            pdf.showPage()
        pdf.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    corpus = json.loads(Path(__file__).with_name("corpus-v1.json").read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    for fixture in corpus["fixtures"]:
        generate(fixture, args.output)


if __name__ == "__main__":
    main()
