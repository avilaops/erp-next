from pathlib import Path
import re
import pytest
from mcp_fiscal_brasil.fiscal_schema import validar_xml_fiscal

XML = Path(__file__).parent.joinpath("fixtures/schema-valid-nfe.xml").read_text(encoding="utf-8")
KEY = "35261012345678000195550010000001231482917364"


def processed():
    nfe = re.sub(r"^<\?xml[^?]*\?>", "", XML)
    return f'<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">{nfe}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>TESTE-LOCAL</verAplic><chNFe>{KEY}</chNFe><dhRecbto>2026-10-17T10:01:00-03:00</dhRecbto><nProt>135260000000001</nProt><cStat>100</cStat><xMotivo>Autorizacao sintetica para teste local</xMotivo></infProt></protNFe></nfeProc>'


def test_pinned_nfe_and_processed_schema():
    assert validar_xml_fiscal(XML) == {"valido": True, "tipo": "nfe", "modelo": "55", "documento": "NFe", "chave_acesso": KEY}
    assert validar_xml_fiscal(processed())["documento"] == "nfeProc"


@pytest.mark.parametrize("xml,tipo", [
    (XML, "cte"), ("<NFe/>", "nfe"),
    (XML.replace("<mod>55</mod>", "<mod>999</mod>"), "nfe"),
    (re.sub(r"<Signature[\s\S]*?</Signature>", "", XML), "nfe"),
    ('<!DOCTYPE NFe [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + XML, "nfe"),
    ('<!DOCTYPE NFe SYSTEM "https://example.test/evil.dtd">' + XML, "nfe"),
    ("x" * 1_048_577, "nfe"),
])
def test_invalid_xml_fails_closed(xml, tipo):
    assert validar_xml_fiscal(xml, tipo)["valido"] is False


@pytest.mark.asyncio
async def test_mcp_schema_contract():
    from fastmcp import Client
    from mcp_fiscal_brasil.server import app
    async with Client(app) as client:
        tools = await client.list_tools()
        assert len(tools) == 47
        result = await client.call_tool("validar_xml_fiscal", {"xml_content": processed(), "tipo": "nfe"})
        assert result.data["valido"] is True
        assert result.data["documento"] == "nfeProc"
