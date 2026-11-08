"""DANFE Simplificado Tipo 2, NT 2026.003 v1.00 (model 55, tpImp=6).

Pure local rendering. The caller must validate XML/signature/authorization before
rendering; a PDF is never evidence of SEFAZ authorization. No endpoint defaults.
Dependencies: fpdf2 and qrcode (error correction M, UTF-8).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import textwrap
from zoneinfo import ZoneInfo

from lxml import etree

NS = {"n": "http://www.portalfiscal.inf.br/nfe"}


def gerar_danfe_simplificado_tipo2(xml_content: str) -> dict:
    """MCP result compatible with gerar_danfe, exclusively for tpImp=6."""
    import base64
    from .nfe.danfe import DanfeGenerationError, _extrair_metadados_xml

    try:
        if not isinstance(xml_content, str) or len(xml_content.encode("utf-8")) > 1_048_576:
            raise ValueError("XML must be a string of at most 1 MiB")
        # Existing safe parser and metadata extraction are retained as the input boundary.
        key, model, number, series = _extrair_metadados_xml(xml_content)
        if model != 55:
            raise ValueError("Requires NF-e model 55")
        pdf = render_simplified_danfe(xml_content)
        if not isinstance(pdf, bytes) or not pdf.startswith(b"%PDF-") or not pdf.rstrip().endswith(b"%%EOF"):
            raise ValueError("Renderer returned invalid PDF")
        return {"pdf_base64": base64.b64encode(pdf).decode("ascii"), "modelo": 55,
                "chave_acesso": key, "numero": number, "serie": series,
                "nome_arquivo": f"DANFE_SIMPLIFICADO_TIPO2_{key}.pdf"}
    except Exception as exc:
        raise DanfeGenerationError(field="xml", value="<xml>",
                                   reason=f"Não foi possível gerar DANFE Simplificado Tipo 2: {exc}") from exc


def render_simplified_danfe(xml: str, *, width_mm: float = 80,
                            timezone: str = "America/Sao_Paulo",
                            font_path: str | None = None) -> bytes:
    """Return thermal PDF; offline XML generates consumer + establishment pages."""
    from fpdf import FPDF
    import qrcode

    if not 56 <= width_mm <= 210:
        raise ValueError("Paper width must be between 56 and 210 mm")
    if len(xml.encode("utf-8")) > 1_048_576 or "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
        raise ValueError("Unsafe or oversized XML")
    root = etree.fromstring(xml.encode("utf-8"), etree.XMLParser(resolve_entities=False, no_network=True))
    infos = root.xpath("self::n:NFe/n:infNFe | self::n:nfeProc/n:NFe/n:infNFe", namespaces=NS)
    if len(infos) != 1:
        raise ValueError("Expected exactly one NF-e")
    info = infos[0]

    def get(path, default="", node=info):
        values = node.xpath(path.replace("/", "/n:") if path.startswith("n:") else "n:" + path.replace("/", "/n:"), namespaces=NS)
        if len(values) > 1:
            raise ValueError("Ambiguous field")
        return (values[0].text or "") if values else default

    if get("ide/mod") != "55" or get("ide/tpImp") != "6":
        raise ValueError("Requires NF-e model 55 / tpImp 6")
    if any(get(f"ide/{name}") != "1" for name in ("finNFe", "indFinal", "idDest", "tpNF")) or get("ide/indPres") not in ("1", "4", "5") or info.xpath("n:ide/n:dhSaiEnt | n:ide/n:NFref", namespaces=NS):
        raise ValueError("NT 2026.002: requires domestic normal final-consumer sale, presence 1/4/5, no dhSaiEnt or NFref")
    forbidden = ("IPI", "II", "PISST", "COFINSST", "ICMSUFDest", "cobr", "retirada", "veicTransp", "retTransp", "reboque", "vagao", "balsa", "compra", "cana")
    if info.xpath(" | ".join(f".//n:{name}" for name in forbidden), namespaces=NS):
        raise ValueError("NT 2026.002: forbidden tax, billing, pickup or transport group")
    if get("transp/modFrete", "9") != "9" and get("ide/indPres") != "4":
        raise ValueError("NT 2026.002: freight requires home delivery, presence 4")
    issuer_uf = get("emit/enderEmit/UF")
    recipient_uf = get("dest/enderDest/UF")
    if recipient_uf and recipient_uf != issuer_uf:
        raise ValueError("NT 2026.002: requires domestic same-state sale")
    allowed = {"5101", "5102", "5103", "5104", "5115", "5405", "5656", "5667", "5910", "5933"}
    for item in info.xpath("n:det", namespaces=NS):
        cfop = get("prod/CFOP", node=item)
        sp_exception = issuer_uf == "SP" and cfop == "5949" and item.xpath("n:imposto/n:ICMS/*/n:CST[text()='40']", namespaces=NS)
        if cfop not in allowed and not sp_exception:
            raise ValueError("NT 2026.002: forbidden CFOP for DANFE Simplificado Tipo 2")
    if Decimal(get("total/ICMSTot/vNF", "0")) > Decimal("200000.00"):
        raise ValueError("NT 2026.002: invoice total exceeds R$ 200.000,00")
    key = info.get("Id", "").removeprefix("NFe")
    if len(key) != 44 or not key.isdigit() or key[20:22] != "55":
        raise ValueError("Invalid model-55 access key")
    nfe = info.getparent()
    qr = get("infNFeSupl/qrCode", node=nfe)
    url = get("infNFeSupl/urlChave", node=nfe)
    if not qr or not url:
        raise ValueError("QR code and access-key consultation URL are mandatory")
    offline = get("ide/tpEmis") == "9"
    parameters = qr.partition("?p=")[2].split("|")
    if len(parameters) != (8 if offline else 3) or parameters[:3] != [key, "3", get("ide/tpAmb")]:
        raise ValueError("NT 2026.002: requires QR version 3 bound to the invoice key, environment and emission mode")
    protocols = root.xpath("n:protNFe/n:infProt", namespaces=NS)
    protocol = protocols[0] if len(protocols) == 1 else None
    if not offline and (protocol is None or get("cStat", node=protocol) not in ("100", "150")):
        raise ValueError("Online printing requires authorized nfeProc protocol")
    if not offline and get("chNFe", node=protocol) != key:
        raise ValueError("Authorization protocol is for another access key")
    tz = ZoneInfo(timezone)

    def date(value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Timestamp must have timezone")
        return parsed.astimezone(tz).strftime("%d/%m/%Y %H:%M:%S")

    def money(value, preserve_precision=False):
        digits = max(2, len(value.partition(".")[2])) if preserve_precision else 2
        return f"{Decimal(value or '0'):,.{digits}f}".replace(",", "_").replace(".", ",").replace("_", ".")

    def address(node, path):
        return ", ".join(filter(None, (get(f"{path}/{name}", node=node) for name in
                                      ("xLgr", "nro", "xCpl", "xBairro", "xMun", "UF", "CEP"))))

    def identity(value):
        if len(value) == 14:
            return f"{value[:2]}.{value[2:5]}.{value[5:8]}/{value[8:12]}-{value[12:]}"
        if len(value) == 11:
            return f"{value[:3]}.{value[3:6]}.{value[6:9]}-{value[9:]}"
        return value

    payment_names = {"01": "Dinheiro", "02": "Cheque", "03": "Cartão de crédito", "04": "Cartão de débito",
                     "05": "Crédito loja", "10": "Vale alimentação", "11": "Vale refeição", "12": "Vale presente",
                     "13": "Vale combustível", "15": "Boleto", "16": "Depósito bancário", "17": "PIX",
                     "18": "Transferência / carteira digital", "19": "Fidelidade", "20": "PIX estático",
                     "21": "Crédito em loja", "22": "Pagamento eletrônico não informado", "90": "Sem pagamento", "99": "Outros"}
    rows = [identity(get("emit/CNPJ") or get("emit/CPF")), get("emit/xNome"), address(info, "emit/enderEmit"), "DANFE Simplificado Tipo 2"]
    contingency = ["EMITIDA EM CONTINGÊNCIA", "Pendente de autorização"]
    if offline:
        rows.extend(contingency)
    rows.append("-" * 20)
    items = info.xpath("n:det", namespaces=NS)
    for item in items:
        rows.extend([get("prod/cProd", node=item) + " " + get("prod/xProd", node=item),
                     f'{get("prod/qCom", node=item).replace(".", ",")} {get("prod/uCom", node=item)} x {money(get("prod/vUnCom", node=item), True)} = {money(get("prod/vProd", node=item))}'])
    rows.extend(["-" * 20, f"Qtde. Total de Itens: {len(items)}", f'Valor Total R$: {money(get("total/ICMSTot/vProd"))}'])
    extra = sum(Decimal(get(f"total/ICMSTot/{name}", "0")) for name in ("vFrete", "vSeg", "vOutro"))
    discount = Decimal(get("total/ICMSTot/vDesc", "0"))
    if extra or discount:
        rows.extend([f"Acréscimos R$: {money(str(extra))}", f"Desconto R$: {money(str(discount))}", f'Valor a Pagar R$: {money(get("total/ICMSTot/vNF"))}'])
    for payment in info.xpath("n:pag/n:detPag", namespaces=NS):
        code = get("tPag", node=payment)
        rows.append(f'{get("xPag", node=payment) or payment_names.get(code, "Pagamento " + code)} R$: {money(get("vPag", node=payment))}')
    rows.append(f'Troco R$: {money(get("pag/vTroco", "0"))}')
    for label, path in [("CBS", "total/IBSCBSTot/gCBS/vCBS"), ("IBS", "total/IBSCBSTot/gIBS/vIBS"), ("IS", "total/ISTot/vIS")]:
        value = get(path)
        if value:
            rows.append(f"(+) {label} R$: {money(value)}")
    rows.extend(["Consulte pela Chave de Acesso em", url, " ".join(key[i:i+4] for i in range(0, 44, 4))])
    rows.append("__QR__")
    recipient_id = get("dest/CNPJ") or get("dest/CPF") or get("dest/idEstrangeiro")
    kind = "CNPJ" if get("dest/CNPJ") else "CPF" if get("dest/CPF") else "ID ESTRANGEIRO"
    rows.extend([f"CONSUMIDOR {kind}: {identity(recipient_id)}", get("dest/xNome")])
    if get("ide/indPres") == "4":
        delivery = address(info, "entrega") or address(info, "dest/enderDest")
        if not get("dest/xNome") or not delivery:
            raise ValueError("Non-presential sale requires recipient name and delivery address")
        rows.append(delivery)
    rows.extend([f'NF-e {get("ide/nNF")} Série {get("ide/serie")}', date(get("ide/dhEmi"))])
    if offline:
        rows.extend(contingency)
    else:
        rows.extend(["Protocolo de autorização: " + get("nProt", node=protocol), date(get("dhRecbto", node=protocol))])
    rows.append(get("infAdic/infAdFisco"))
    if get("ide/tpAmb") == "2":
        rows.append("EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL")
    rows.append(get("infAdic/infCpl"))
    # Fixed-width typography makes height and wrapping deterministic at all paper widths.
    chars = int((width_mm - 4) / (7 * 0.352778 * 0.6))
    lines = [line for row in rows if row for line in textwrap.wrap(row, chars, break_long_words=True, replace_whitespace=True)]
    warning_lines = set(textwrap.wrap("EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL", chars)) | set(contingency)
    height = max(100, len(lines) * 3.5 + 48)
    pdf = FPDF(unit="mm", format=(width_mm, height))
    pdf.set_margins(2, 2, 2)
    pdf.set_auto_page_break(False)
    candidates = [font_path] if font_path else ["C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    available = next((p for p in candidates if p and Path(p).is_file()), None)
    if available:
        pdf.add_font("Receipt", fname=available)
        bold = Path(available).with_name("consolab.ttf" if Path(available).name == "consola.ttf" else "DejaVuSansMono-Bold.ttf")
        pdf.add_font("Receipt", style="B", fname=str(bold if bold.is_file() else available))
    image = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=8)
    image.add_data(qr.encode("utf-8")); image.make(fit=True)
    image.border = (image.modules_count + 7) // 8
    image_bytes = BytesIO(); image.make_image().save(image_bytes, format="PNG")
    for copy in range(2 if offline else 1):
        pdf.add_page(); pdf.set_font("Receipt" if available else "Courier", size=7)
        for line in lines:
            if line == "__QR__":
                qr_size = min(40, width_mm - 4)
                pdf.image(BytesIO(image_bytes.getvalue()), x=(width_mm - qr_size) / 2, y=pdf.get_y()+2, w=qr_size, h=qr_size)
                pdf.set_y(pdf.get_y() + qr_size + 4)
                continue
            if copy and line == date(get("ide/dhEmi")):
                pdf.cell(0, 3.5, "Via do Estabelecimento", new_x="LMARGIN", new_y="NEXT")
            highlighted = line in warning_lines
            pdf.set_font("Receipt" if available else "Courier", style="B" if highlighted else "", size=7)
            pdf.cell(0, 3.5, line, align="C" if highlighted else "L", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
