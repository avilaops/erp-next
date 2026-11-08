"""Synthetic local receipts; no certificate, fiscal service or real invoice."""
import importlib.util
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfReader

spec = importlib.util.spec_from_file_location("simplified_danfe", Path(__file__).parents[1] / "src/mcp_fiscal_brasil/simplified_danfe.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
render = module.render_simplified_danfe


def fixture(offline=False, count=1):
    key = "35261112345678000195550010000000011000000000"
    qr_suffix = "|08|10.00|1|11222333000181|QUJDRA==" if offline else ""
    item = '<det><prod><cProd>TESTE</cProd><xProd>Produto fictício com descrição longa para conferir impressão e quebra de linha</xProd><CFOP>5102</CFOP><qCom>1.00</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>'
    return f'''<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe{key}">
    <ide><mod>55</mod><tpImp>6</tpImp><finNFe>1</finNFe><indFinal>1</indFinal><idDest>1</idDest><tpNF>1</tpNF><tpEmis>{9 if offline else 1}</tpEmis><tpAmb>2</tpAmb><indPres>1</indPres><nNF>1</nNF><serie>1</serie><dhEmi>2026-11-08T12:00:00Z</dhEmi></ide>
    <emit><CNPJ>12345678000195</CNPJ><xNome>EMPRESA FICTÍCIA</xNome><enderEmit><xLgr>Rua de teste</xLgr><nro>1</nro><xMun>São Paulo</xMun><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>11222333000181</CNPJ><xNome>CLIENTE FICTÍCIO</xNome></dest>{item * count}
    <total><ICMSTot><vProd>{count * 10}.00</vProd><vNF>{count * 10}.00</vNF></ICMSTot><IBSCBSTot><gIBS><vIBS>0.10</vIBS></gIBS><gCBS><vCBS>0.90</vCBS></gCBS></IBSCBSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag><vTroco>0.00</vTroco></pag>
    <infAdic><infAdFisco>Mensagem fiscal de teste</infAdFisco><infCpl>Informação complementar de teste</infCpl></infAdic>
    </infNFe><infNFeSupl><qrCode>https://teste.sefaz.gov.br/nfe/qrcode?p={key}|3|2{qr_suffix}</qrCode><urlChave>https://teste.sefaz.gov.br/nfe/consulta</urlChave></infNFeSupl></NFe>
    <protNFe><infProt><cStat>100</cStat><chNFe>{key}</chNFe><nProt>135260000000001</nProt><dhRecbto>2026-11-08T12:01:00Z</dhRecbto></infProt></protNFe></nfeProc>'''


def test_online_complete_receipt():
    pdf = PdfReader(BytesIO(render(fixture())))
    assert len(pdf.pages) == 1
    text = " ".join(pdf.pages[0].extract_text().split())
    for expected in ("DANFE Simplificado Tipo 2", "Produto fictício", "Qtde. Total de Itens: 1", "Troco R$: 0,00", "CBS R$: 0,90", "IBS R$: 0,10", "CONSUMIDOR CNPJ", "Protocolo de autorização", "08/11/2026 09:00:00", "SEM VALOR FISCAL", "Informação complementar"):
        assert expected in text
    assert len(pdf.pages[0].images) == 1
    assert float(pdf.pages[0].mediabox.width) == pytest.approx(80 * 72 / 25.4, abs=.01)


def test_offline_has_two_copies_and_both_contingency_warnings():
    pdf = PdfReader(BytesIO(render(fixture(True))))
    assert len(pdf.pages) == 2
    for page in pdf.pages:
        text = page.extract_text()
        assert text.count("EMITIDA EM CONTINGÊNCIA") == 2
        assert "Protocolo de autorização" not in text
    assert "Via do Estabelecimento" in pdf.pages[1].extract_text()


def test_minimum_width_long_receipt_and_invalid_mode():
    pdf = PdfReader(BytesIO(render(fixture(count=100), width_mm=56)))
    assert "Qtde. Total de Itens: 100" in pdf.pages[0].extract_text()
    assert len(pdf.pages) == 1
    with pytest.raises(ValueError):
        render(fixture().replace("<tpImp>6", "<tpImp>2"))
    with pytest.raises(ValueError):
        render(fixture(), width_mm=55)
    with pytest.raises(ValueError):
        render(fixture().replace("<cStat>100", "<cStat>110"))


@pytest.mark.parametrize("original,replacement", [
    ("<indPres>1", "<indPres>9"), ("<indFinal>1", "<indFinal>0"),
    ("<idDest>1", "<idDest>2"), ("<tpNF>1", "<tpNF>0"),
    ("<finNFe>1", "<finNFe>4"), ("</ide>", "<dhSaiEnt>2026-11-08T09:00:00-03:00</dhSaiEnt></ide>"),
    ("</ide>", "<NFref><refNFe>35261112345678000195550010000000011000000000</refNFe></NFref></ide>"),
    ("|3|2</qrCode>", "|2|2</qrCode>"),
])
def test_rejects_ineligible_operation(original, replacement):
    with pytest.raises(ValueError, match="NT 2026.002"):
        render(fixture().replace(original, replacement))


@pytest.mark.parametrize("group", ["IPI", "II", "PISST", "COFINSST", "ICMSUFDest", "cobr", "retirada", "veicTransp", "retTransp", "reboque", "vagao", "balsa", "compra", "cana"])
def test_rejects_forbidden_xml_groups(group):
    with pytest.raises(ValueError, match="NT 2026.002"):
        render(fixture().replace("</infNFe>", f"<{group}/></infNFe>"))


def test_cfop_whitelist_sp_exception_freight_and_limit():
    with pytest.raises(ValueError, match="CFOP"):
        render(fixture().replace("<CFOP>5102", "<CFOP>5901"))
    sp = fixture().replace("<CFOP>5102", "<CFOP>5949").replace("</det>", "<imposto><ICMS><ICMS40><CST>40</CST></ICMS40></ICMS></imposto></det>")
    assert render(sp).startswith(b"%PDF-")
    with pytest.raises(ValueError, match="CFOP"):
        render(sp.replace("<UF>SP</UF>", "<UF>RJ</UF>"))
    with pytest.raises(ValueError, match="freight"):
        render(fixture().replace("</infNFe>", "<transp><modFrete>0</modFrete></transp></infNFe>"))
    with pytest.raises(ValueError, match="200.000"):
        render(fixture().replace("<vNF>10.00", "<vNF>200000.01"))


def test_home_delivery_prints_recipient_and_delivery_address_with_destination_fallback():
    address = "<xLgr>Rua Entrega Fictícia</xLgr><nro>456</nro><xCpl>Apto 7</xCpl><xBairro>Centro</xBairro><xMun>São Paulo</xMun><UF>SP</UF><CEP>01001000</CEP>"
    delivery = fixture().replace("<indPres>1", "<indPres>4").replace("</infNFe>", f"<entrega>{address}</entrega></infNFe>")
    text = " ".join(PdfReader(BytesIO(render(delivery))).pages[0].extract_text().split())
    assert "CLIENTE FICTÍCIO" in text
    assert "Rua Entrega Fictícia, 456, Apto 7, Centro, São Paulo, SP, 01001000" in text
    fallback = delivery.replace(f"<entrega>{address}</entrega>", "").replace("</dest>", f"<enderDest>{address}</enderDest></dest>")
    text = " ".join(PdfReader(BytesIO(render(fallback))).pages[0].extract_text().split())
    assert "Rua Entrega Fictícia, 456, Apto 7, Centro, São Paulo, SP, 01001000" in text
    preferred = fallback.replace("</infNFe>", f"<entrega>{address.replace('Rua Entrega Fictícia', 'Rua Preferencial')}</entrega></infNFe>")
    text = " ".join(PdfReader(BytesIO(render(preferred))).pages[0].extract_text().split())
    assert "Rua Preferencial" in text
    assert "Rua Entrega Fictícia" not in text
    with pytest.raises(ValueError, match="delivery address"):
        render(fixture().replace("<indPres>1", "<indPres>4"))


@pytest.mark.asyncio
async def test_mcp_tool_contract_and_invalid_output(monkeypatch):
    import base64
    from mcp_fiscal_brasil import simplified_danfe
    from mcp_fiscal_brasil.server import tool_gerar_danfe_simplificado_tipo2
    result = await tool_gerar_danfe_simplificado_tipo2(fixture())
    assert result["modelo"] == 55
    assert result["numero"] == "1"
    assert result["serie"] == "1"
    assert result["chave_acesso"] in result["nome_arquivo"]
    assert base64.b64decode(result["pdf_base64"]).startswith(b"%PDF-")
    with pytest.raises(Exception):
        await tool_gerar_danfe_simplificado_tipo2(fixture().replace("<tpImp>6", "<tpImp>2"))
    monkeypatch.setattr(simplified_danfe, "render_simplified_danfe", lambda _: b"not a PDF")
    with pytest.raises(Exception, match="invalid PDF"):
        await tool_gerar_danfe_simplificado_tipo2(fixture())


@pytest.mark.asyncio
async def test_mcp_tools_preserved():
    from mcp_fiscal_brasil.server import app
    from fastmcp import Client
    async with Client(app) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools}
        assert "gerar_danfe" in names
        assert "gerar_danfe_simplificado_tipo2" in names
        assert len(tools) == 47
        result = await client.call_tool("gerar_danfe_simplificado_tipo2", {"xml_content": fixture(True)})
        assert not result.is_error
        assert result.data["modelo"] == 55
