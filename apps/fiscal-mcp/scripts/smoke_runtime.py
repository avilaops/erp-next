"""Exercise the packaged MCP using synthetic XML; never calls SEFAZ."""
import base64
import json
from pathlib import Path
import runpy
import sys
import time
import urllib.request

origin = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8093"
headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


def rpc(method, request_id=None, params=None):
    body = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        body["id"] = request_id
    if params is not None:
        body["params"] = params
    request = urllib.request.Request(origin + "/mcp", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.headers.get("Mcp-Session-Id"):
            headers["Mcp-Session-Id"] = response.headers["Mcp-Session-Id"]
        if response.status == 202:
            return None
        if "application/json" in response.headers.get("Content-Type", ""):
            value = json.load(response)
        else:
            value = None
            for line in response:
                if line.startswith(b"data:"):
                    candidate = json.loads(line[5:])
                    if candidate.get("id") == request_id:
                        value = candidate
                        break
        if not value or "error" in value:
            raise RuntimeError("MCP request failed: " + method)
        return value["result"]


def tool(name, arguments, request_id):
    value = rpc("tools/call", request_id, {"name": name, "arguments": arguments})
    if value.get("isError"):
        raise RuntimeError("MCP tool failed: " + name)
    return value.get("structuredContent") or json.loads(next(item["text"] for item in value["content"] if item["type"] == "text"))


for attempt in range(30):
    try:
        with urllib.request.urlopen(origin + "/health", timeout=3) as response:
            assert response.status == 200
        break
    except Exception:
        if attempt == 29:
            raise
        time.sleep(1)

rpc("initialize", 1, {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "erp-release-smoke", "version": "1"}})
rpc("notifications/initialized")
headers["MCP-Protocol-Version"] = "2025-06-18"
tools = rpc("tools/list", 2)["tools"]
names = {entry["name"] for entry in tools}
assert {"validar_xml_fiscal", "validar_assinatura_nfe", "gerar_danfe_simplificado_tipo2"} <= names
root = Path(__file__).resolve().parents[1]
xml = (root / "tests/fixtures/schema-valid-nfe.xml").read_text(encoding="utf-8")
assert tool("validar_xml_fiscal", {"xml_content": xml}, 3)["valido"] is True
synthetic = runpy.run_path(str(root / "tests/test_simplified_danfe.py"))["fixture"]()
pdf = tool("gerar_danfe_simplificado_tipo2", {"xml_content": synthetic}, 4)
assert base64.b64decode(pdf["pdf_base64"], validate=True).startswith(b"%PDF-")
print(json.dumps({"tools": len(names), "schemaValidation": "passed", "syntheticPdf": "passed"}))
