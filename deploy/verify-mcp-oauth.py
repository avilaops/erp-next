"""HTTP smoke checks run on GitHub CI, without a human identity or business writes."""
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

if os.environ.get("GITHUB_ACTIONS") != "true":
    raise RuntimeError("VERIFICATION_REQUIRES_GITHUB_CI")

ORIGIN = "https://erp.avilaops.com"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)


def request(path, data=None, content_type=None):
    headers = {"Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(ORIGIN + path, data=data, headers=headers)
    try:
        response = opener.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    body = response.read(65536)
    return response.code, response.headers, body


status, _, body = request("/.well-known/oauth-protected-resource/mcp")
assert status == 200 and json.loads(body)["resource"] == ORIGIN + "/mcp"
status, _, body = request("/.well-known/oauth-authorization-server")
metadata = json.loads(body)
assert status == 200 and metadata["issuer"] == ORIGIN
assert metadata["code_challenge_methods_supported"] == ["S256"]
status, headers, _ = request("/mcp")
assert status == 401 and "resource_metadata=" in headers.get("WWW-Authenticate", "")

name = "CI MCP verification " + os.environ["GITHUB_RUN_ID"]
payload = json.dumps({"client_name": name, "redirect_uris": ["https://client.example/callback"],
                      "token_endpoint_auth_method": "none"}).encode()
status, _, body = request("/mcp/oauth/register", payload, "application/json")
assert status == 201, "OAuth registration is unavailable"
client_id = json.loads(body)["client_id"]
assert re.fullmatch(r"mcp_client_[A-Za-z0-9_-]{43}", client_id)
try:
    common = {"client_id": client_id, "resource": ORIGIN + "/mcp"}
    for fields in [dict(grant_type="authorization_code", code="invalid", redirect_uri="https://client.example/callback", code_verifier="v" * 64),
                   dict(grant_type="refresh_token", refresh_token="invalid")]:
        status, _, body = request("/mcp/oauth/token", urllib.parse.urlencode({**common, **fields}).encode(),
                                  "application/x-www-form-urlencoded")
        assert status == 400 and json.loads(body)["error"] == "invalid_grant"
    query = urllib.parse.urlencode({**common, "redirect_uri": "https://client.example/callback",
                                   "response_type": "code", "code_challenge": "a" * 43,
                                   "code_challenge_method": "S256", "scope": "erp.read erp.write", "state": "ci"})
    status, headers, _ = request("/mcp/oauth/authorize?" + query)
    assert status == 303 and headers.get("Location", "").startswith(ORIGIN + "/api/auth/login?")
finally:
    # Delete only the unconsented client created by this smoke check.
    subprocess.run(["psql", os.environ["DATABASE_URL"], "-X", "-v", "ON_ERROR_STOP=1",
                    "-v", "client_id=" + client_id, "-v", "client_name=" + name],
                   input="DELETE FROM mcp_oauth_clients c WHERE c.id=:'client_id' AND c.name=:'client_name' AND NOT EXISTS(SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id=c.id);",
                   text=True, check=True, capture_output=True)
print("PASS: public discovery, Bearer challenge, dynamic client registration, token validation, login redirect; temporary client removed.")
