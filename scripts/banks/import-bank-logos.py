"""Import pinned bank SVGs. Run from the repository root with Python 3.

No runtime network access is needed by the app. The allowlist deliberately rejects
active SVG content, external references, entities, and non-SVG embedded documents.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import quote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

COMMIT = "fe1d43f0cf379135bd01c987bc147a04fdf48c6d"
REPOSITORY = "https://github.com/Tgentil/Bancos-em-SVG"
ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "apps/web/public/banks"
SVG = "http://www.w3.org/2000/svg"
ALLOWED = set("svg g path defs rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask pattern title desc style use symbol switch text tspan filter feGaussianBlur feBlend feColorMatrix feOffset feFlood feComposite feMerge feMergeNode".split())
NUMBER = r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
SEPARATOR = r"(?:[ \t\r\n]+|[ \t\r\n]*,[ \t\r\n]*)"
PREFERRED = {
    "ABC Brasil": "logoabc.svg", "Ailos": "logo-ailos.svg", "Almah Conta": "Almah.svg",
    "Artta": "artta.svg", "Banco BTG Pacutal": "btg-pactual.svg", "Banco C6 S.A": "c6 bank.svg",
    "Banco Daycoval": "logo-Daycoval.svg", "Banco Original S.A": "banco-original-logo-verde.svg",
    "Banco Safra S.A": "logo-safra.svg", "Banco do Brasil S.A": "banco-do-brasil-sem-fundo.svg",
    "Banco do Estado do Para": "banpara-logo-sem-fundo.svg", "Bradesco S.A": "bradesco.svg",
    "Caixa Econômica Federal": "caixa-economica-federal-X.svg", "Cresol": "Icone-original.svg",
    "Cora Sociedade Credito Direto S.A": "icone-cora-rosa-2500px.svg", "Efí - Gerencianet": "logo-efi-bank-laranja.svg",
    "Itaú Unibanco S.A": "itau-fundo-azul.svg", "Nu Pagamentos S.A": "nubank-logo-2021.svg",
    "Quality Digital Bank": "quality-logo-cinza.svg", "Sicredi": "logo-svg2.svg",
    "Stone Pagamentos S.A": "stone.svg", "Zemo Bank": "logowhite.svg",
}


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "AvilaERP-bank-assets-import"}), timeout=45) as response:
        return response.read()


def slug(name):
    import unicodedata
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def sanitize(raw):
    # Some upstream Illustrator files have a public SVG DTD with no internal
    # subset. Strip that declaration; never resolve or retain any DTD/entity.
    text = raw.decode("utf-8-sig")
    text = re.sub(r'<!DOCTYPE\s+svg\s+PUBLIC\s+"[^"]*"\s+"[^"]*"\s*>', "", text, flags=re.I)
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", text, re.I):
        raise ValueError("DTD, entity or stylesheet instruction")
    root = ET.fromstring(text)
    if root.tag != f"{{{SVG}}}svg":
        raise ValueError("Not an SVG document")
    for parent in root.iter():
        for child in list(parent):
            local = child.tag.split("}")[-1]
            if local == "metadata" or not child.tag.startswith(f"{{{SVG}}}"):
                parent.remove(child)  # Remove editor-only metadata/named views.
    for element in root.iter():
        tag = element.tag.split("}")[-1]
        if tag not in ALLOWED:
            raise ValueError(f"Disallowed SVG element: {tag}")
        for key, value in list(element.attrib.items()):
            local = key.split("}")[-1]
            namespace = key[1:].split("}")[0] if key.startswith("{") else ""
            if namespace and namespace not in (SVG, "http://www.w3.org/1999/xlink", "http://www.w3.org/XML/1998/namespace"):
                del element.attrib[key]
                continue
            if local.lower().startswith("on") or local.lower() in ("src", "base"):
                raise ValueError(f"Active attribute: {local}")
            if local == "href" and not re.fullmatch(r"#[\w:.-]+", value):
                raise ValueError("Nonlocal href")
            check_css(value)
        if tag == "style":
            check_css(element.text or "")
    ensure_viewbox(root)
    ET.register_namespace("", SVG)
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def ensure_viewbox(root):
    if "viewBox" not in root.attrib:
        dimensions = [(root.get(attribute) or "").strip() for attribute in ("width", "height")]
        for dimension in dimensions:
            if not re.fullmatch(NUMBER, dimension) or not math.isfinite(float(dimension)) or float(dimension) <= 0:
                raise ValueError("Missing viewBox requires positive finite unitless width and height")
        root.set("viewBox", f"0 0 {dimensions[0]} {dimensions[1]}")
    viewbox = root.get("viewBox", "").strip()
    if not re.fullmatch(rf"{NUMBER}(?:{SEPARATOR}{NUMBER}){{3}}", viewbox):
        raise ValueError("Invalid SVG viewBox coordinates")
    bounds = [float(number) for number in re.split(r"[,\s]+", viewbox)]
    if not all(math.isfinite(number) for number in bounds) or bounds[2] <= 0 or bounds[3] <= 0:
        raise ValueError("SVG viewBox requires finite coordinates and positive dimensions")


def check_css(value):
    if re.search(r"@|\\|/\*|javascript:|data:|https?:|expression\s*\(", value, re.I):
        raise ValueError("External or active CSS/reference")
    for reference in re.findall(r"url\s*\((.*?)\)", value, re.I):
        if not re.fullmatch(r"['\"]?#[\w:.-]+['\"]?", reference.strip()):
            raise ValueError("Nonlocal CSS reference")


def main():
    tree = json.loads(fetch(f"https://api.github.com/repos/Tgentil/Bancos-em-SVG/git/trees/{COMMIT}?recursive=1"))
    groups = {}
    for item in tree["tree"]:
        if item["type"] == "blob" and item["path"].lower().endswith(".svg") and not item["path"].startswith("Bancos Escuros"):
            groups.setdefault(item["path"].split("/")[0], []).append(item["path"])
    DEST.mkdir(parents=True, exist_ok=True)

    def import_one(pair):
        name, paths = pair
        preferred = f"{name}/{PREFERRED.get(name, '')}"
        ordered = sorted(paths, key=lambda path: (path != preferred, bool(re.search(r"branco|white|negativ|nome|fundo", path, re.I)), len(path)))
        errors = []
        for path in ordered:
            url = f"https://raw.githubusercontent.com/Tgentil/Bancos-em-SVG/{COMMIT}/{quote(path)}"
            raw = fetch(url)
            try:
                output = sanitize(raw)
            except (ValueError, ET.ParseError) as error:
                errors.append(f"{path}: {error}")
                continue
            local = f"{slug(name)}.svg"
            (DEST / local).write_bytes(output)
            return {"name": name, "id": slug(name), "path": path, "url": url, "file": local,
                    "sourceSha256": hashlib.sha256(raw).hexdigest(), "sha256": hashlib.sha256(output).hexdigest(), "rejectedVariants": errors}
        return {"name": name, "id": slug(name), "file": None, "rejectedVariants": errors}

    with ThreadPoolExecutor(max_workers=4) as pool:
        assets = list(pool.map(import_one, sorted(groups.items())))
    manifest = {"repository": REPOSITORY, "commit": COMMIT, "author": "Thiago da Silveira Gentil",
                "rights": "Logos belong to their respective banks; follow each brand's guidelines. No MIT license is declared upstream.",
                "transformations": "Public DTD declaration, editor metadata and editor attributes removed; SVG allowlist applied. Local fragment references only. Missing viewBox derived as 0 0 width height only from positive finite unitless root dimensions; existing valid viewBox preserved.",
                "assets": assets}
    (DEST / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {sum(bool(row['file']) for row in assets)}/{len(assets)} bank logos at {COMMIT}")
    for row in assets:
        if row["rejectedVariants"]:
            print(row["name"], row["rejectedVariants"])


if __name__ == "__main__":
    main()
