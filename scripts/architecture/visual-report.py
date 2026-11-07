"""Produce a local gallery and an explicit coverage report from Brave evidence."""
import html
import json
import re
from pathlib import Path
from urllib.parse import quote

from PIL import Image

directory = Path(__file__).resolve().parents[2] / "artifacts" / "ui-audit"
inventory = json.loads((directory / "inventory.json").read_text(encoding="utf-8"))
captures = json.loads((directory / "captures.json").read_text(encoding="utf-8"))
captured_routes = {item["route"].split("?")[0] for item in captures}
missing = [item["route"] for item in inventory["routes"] if item["route"] not in captured_routes and not item["requiresRecord"]]
cards = []
findings = []
for item in captures:
    figures = []
    notes = []
    for capture in item["captures"]:
        text = capture["text"]
        if capture.get("url", "").split("?")[0] == "/entrar" and item["route"].split("?")[0] != "/entrar":
            notes.append("Redirecionamento para login; tela interna não validada")
        if capture["scroll"] > capture["width"]:
            notes.append("Rolagem horizontal no documento")
        if "Funcionalidade indisponível" in text:
            notes.append("Funcionalidade indisponível nesta versão")
        elif any(term in text for term in ["Não foi possível", "indisponível", "resposta vazia", "resposta inválida", "não autorizado", "Sem permissão", "Registro não encontrado"]):
            notes.append("Consulta com erro ou recurso indisponível; operação não validada")
        if any(term in text for term in ["Carregando", "Validando acesso", "Consultando serviço"]):
            notes.append("Há carregamento na captura")
        size = Image.open(directory / capture["file"]).size
        if capture["viewport"] == "mobile" and capture["width"] > 410:
            notes.append("Viewport mobile incorreto; recaptura necessária")
        if size[0] < capture["width"] * .8:
            notes.append("Imagem reduzida pelo navegador; legibilidade limitada")
        if not capture.get("fullPage", False) and size[0] >= capture["width"] * .8 and capture.get("height", size[1]) > size[1] + 30:
            notes.append("Captura parcial da página longa")
        filename = quote(capture["file"])
        caption = f'{capture["viewport"]} · viewport {capture["width"]} px · arquivo {size[0]} × {size[1]}'
        figures.append(f'<figure><figcaption>{html.escape(caption)}</figcaption><a href="{filename}"><img loading="lazy" src="{filename}" alt="{html.escape(item["route"])} — {capture["viewport"]}"></a></figure>')
    notes = list(dict.fromkeys(notes))
    findings.append({"route": item["route"], "notes": notes, "review": item.get("review", "pending")})
    cards.append(f'<article><h2>{html.escape(item["route"])}</h2><p>{html.escape(" · ".join(notes) or "Captura disponível; não equivale a aprovação funcional.")}</p><div class="pair">{"".join(figures)}</div></article>')

supplemental = [
    ("Formulário da empresa — desktop", "company-desktop.jpg"),
    ("Formulário da empresa — mobile", "company-mobile.jpg"),
    ("Menu Estoque — mobile", "menu-stock-mobile.jpg"),
    ("Menu Cadastros — mobile", "menu-records-mobile.jpg"),
    ("Menu Meu Negócio — mobile", "menu-business-mobile.jpg"),
    ("Relatório de estoque — desktop", "stock-desktop.jpg"),
    ("Relatório de estoque — mobile", "stock-mobile.jpg"),
]
for label, filename in supplemental:
    if (directory / filename).exists():
        cards.append(f'<article><h2>{label}</h2><p>Captura complementar da área visível, sem redimensionar para acomodar a página.</p><a href="{filename}"><img loading="lazy" src="{filename}" alt="{label}"></a></article>')

# Match concrete record routes without counting static /novo pages as records.
static_routes = {item["route"] for item in inventory["routes"] if not item["requiresRecord"]}
dynamic = []
for item in inventory["routes"]:
    if not item["requiresRecord"]:
        continue
    pattern = "^" + re.sub(r"\[[^\]]+\]", "[^/]+", item["route"]) + "$"
    examples = sorted(route for route in captured_routes if route not in static_routes and re.match(pattern, route))
    dynamic.append({"template": item["route"], "examples": examples, "status": "captured" if examples else "sem registro ou link acessível nesta sessão"})
summary = {"staticTotal": len(static_routes), "staticCaptured": len(static_routes & captured_routes), "missingStatic": missing,
           "concreteRoutes": len(captures), "screenshots": sum(len(item["captures"]) for item in captures),
           "dynamic": dynamic, "findings": findings}
(directory / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
unresolved = "".join(f'<li>{html.escape(item["template"])}</li>' for item in dynamic if not item["examples"])
page = f'''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auditoria visual · Ávila ERP</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f5f6f8;color:#172033;font:15px/1.55 system-ui,sans-serif}}
header,main{{max-width:1440px;margin:auto;padding:32px}}h1{{font-size:32px;letter-spacing:-.04em}}h2{{font-size:18px;overflow-wrap:anywhere}}
article{{margin:24px 0;padding:24px;background:white;border:1px solid #dce1e8;border-radius:16px}}
.pair{{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,390px);gap:24px;align-items:start}}figure{{margin:0;min-width:0}}
figcaption{{color:#566174;margin-bottom:12px}}img{{display:block;max-width:100%;height:auto;border:1px solid #dce1e8}}details{{margin:24px 0}}
@media(max-width:700px){{header,main{{padding:16px}}.pair{{grid-template-columns:1fr}}article{{padding:16px}}}}
</style><header><h1>Auditoria visual do ERP</h1>
<p>{summary["staticCaptured"]}/{summary["staticTotal"]} rotas estáticas · {summary["concreteRoutes"]} URLs e estados · {summary["screenshots"]} capturas.</p>
<p>Ambiente local, Brave, desktop 1440 × 1000 e mobile 390 × 844. Dados consultados pela sessão autorizada. Nenhuma gravação operacional foi executada para produzir os prints.</p>
<p>Capturas demonstram o estado observado. Erros, módulos indisponíveis, páginas reduzidas e falta de registros limitam a validação. A galeria não declara que todas as operações funcionam.</p>
<details><summary>Rotas dinâmicas sem exemplo acessível ({sum(not item["examples"] for item in dynamic)})</summary><ul>{unresolved}</ul></details>
<a href="report.json">Relatório estruturado</a></header><main>{"".join(cards)}</main></html>'''
(directory / "index.html").write_text(page, encoding="utf-8")
print(json.dumps({key: summary[key] for key in ["staticTotal", "staticCaptured", "concreteRoutes", "screenshots", "missingStatic"]}))
