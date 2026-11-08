"""Pinned PL_010g v1.03 XML validation, entirely local and closed to external imports."""
from functools import lru_cache
from hashlib import sha256
from importlib.resources import files
import re

from lxml import etree

NS = "http://www.portalfiscal.inf.br/nfe"
PINNED = {
    "nfe_v4.00.xsd": "adce3646c13ceb54922ec3142fc1dc45bd4fb839ac35ad583e86c733c07d27df",
    "leiauteNFe_v4.00.xsd": "e8470f5d85ded3d99010676087907214aef71c9626140b672abbafa72656c0f5",
    "tiposBasico_v4.00.xsd": "772619c85723e598840667ca66e7298a250442df47eeb94b397d2a333ce62047",
    "DFeTiposBasicos_v1.00.xsd": "2da0785a6c70db4f93571187a28514dde715cfd0b0f41e746176fbf3444549f2",
    "xmldsig-core-schema_v1.01.xsd": "f56744a5f51c03f027de13f39f869307091781a9ef1d91b1ebe14719ce28e1ac",
    "procNFe_v4.00.xsd": "d61d15303f8ccf77e6e5d77a8153255a6906e0d00385dc5000db19ed3bfa96e0",
}


@lru_cache(maxsize=2)
def _schema(document: str) -> etree.XMLSchema:
    resources = files("mcp_fiscal_brasil").joinpath("schemas", "nfe")
    sources = {}
    for name, digest in PINNED.items():
        content = resources.joinpath(name).read_bytes()
        if sha256(content).hexdigest() != digest:
            raise ValueError("Pinned schema integrity mismatch")
        sources[name] = content

    class ClosedResolver(etree.Resolver):
        def resolve(self, url, public_id, context):
            # Only literal names from the immutable vendor set can be loaded.
            if url not in sources:
                raise ValueError("External schema import rejected")
            return self.resolve_string(sources[url], context, base_url=url)

    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
    parser.resolvers.add(ClosedResolver())
    entry = "procNFe_v4.00.xsd" if document == "nfeProc" else "nfe_v4.00.xsd"
    return etree.XMLSchema(etree.fromstring(sources[entry], parser, base_url=entry))


def validar_xml_fiscal(xml_content: str, tipo: str = "nfe") -> dict:
    """Checks XSD only; neither verifies signatures nor proves authorization."""
    invalid = {"valido": False, "tipo": tipo}
    try:
        if tipo != "nfe" or not isinstance(xml_content, str) or len(xml_content.encode("utf-8")) > 1_048_576:
            return invalid
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml_content, re.I) or "\0" in xml_content:
            return invalid
        root = etree.fromstring(xml_content.encode("utf-8"), etree.XMLParser(
            resolve_entities=False, load_dtd=False, no_network=True))
        tag = etree.QName(root)
        if tag.namespace != NS or tag.localname not in ("NFe", "nfeProc"):
            return invalid
        document = tag.localname
        if not _schema(document).validate(root):
            return invalid
        nodes = root.xpath("self::n:NFe/n:infNFe | self::n:nfeProc/n:NFe/n:infNFe", namespaces={"n": NS})
        if len(nodes) != 1:
            return invalid
        info = nodes[0]
        key = info.get("Id", "").removeprefix("NFe")
        model = info.findtext(f"{{{NS}}}ide/{{{NS}}}mod")
        if model not in ("55", "65") or not re.fullmatch(r"[0-9A-Z]{44}", key):
            return invalid
        return {"valido": True, "tipo": "nfe", "modelo": model,
                "documento": document, "chave_acesso": key}
    except Exception:
        # Do not return raw XML, certificate content, local paths or parser diagnostics.
        return invalid
