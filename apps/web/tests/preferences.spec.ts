import { expect, test } from "@playwright/test"
import { readdirSync } from "node:fs"
import path from "node:path"

const appDirectory = path.join(process.cwd(), "src", "app")
const routes = collectPages(appDirectory).map((file) => {
  const relative = path.relative(appDirectory, path.dirname(file)).replaceAll("\\", "/")
  const pathname = relative ? `/${relative}` : "/"
  return pathname.replace("/usuarios/[id]", "/usuarios/77777777-7777-4777-8777-777777777777").replace("[id]", "2").replace("[provider]", "mercado-livre")
}).sort()
const viewports = [320, 375, 768, 1024, 1440]
const responsiveRoutes = [
  "/", "/cadastros/produtos/novo", "/estoque", "/compras/pedidos/novo", "/vendas/pdv",
  "/financeiro", "/fiscal", "/logistica", "/servicos", "/relatorios",
  "/preferencias/empresa/dados", "/preferencias/usuarios/77777777-7777-4777-8777-777777777777",
  "/vendas/pedidos/pv-1048", "/fiscal/notas-saida/NFE-000184", "/logistica/postagens/OBJ-2481",
  "/dashboards/vendas", "/eventos", "/assistente",
]

test("todas as rotas respondem sem 404", async ({ request }) => {
  test.setTimeout(90_000)
  for (const batch of chunk(routes, 10)) {
    const responses = await Promise.all(batch.map(async (route) => ({ route, response: await request.get(route) })))
    for (const { route, response } of responses) expect(response.ok(), `${route} deve responder com sucesso`).toBeTruthy()
  }
})

for (const route of responsiveRoutes) {
  test(`${route} representa seu template sem overflow`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator("h1").first()).toBeVisible()
    for (const width of viewports) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
      const dimensions = await page.evaluate(() => {
        const client = document.documentElement.clientWidth
        return { client, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll<HTMLElement>("body *")].map((element) => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, text: element.innerText?.slice(0, 40), className: element.className, right: Math.round(rect.right * 10) / 10 } }).filter((item) => item.right > client).slice(0, 5) }
      })
      expect(dimensions.scroll, `${route} não deve exceder ${width}px. ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.client)
    }
  })
}

test("acessos sem configuração não exibem usuários simulados", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 })
  for (const route of ["/preferencias/usuarios", "/preferencias/papeis"]) {
    await page.goto(route)
    await expect(page.getByRole("status")).toContainText("O login do ERP ainda não foi configurado")
    await expect(page.getByLabel("Simular estado")).toHaveCount(0)
  }
})

test("paleta Ctrl+K abre, recebe foco e devolve foco ao fechar", async ({ page }) => {
  await page.goto("/preferencias/empresa")
  const trigger = page.getByRole("button", { name: "Pesquisar no ERP" })
  if (await trigger.isVisible()) {
    await trigger.focus()
    await page.keyboard.press("Control+K")
    const input = page.getByPlaceholder("Buscar título, descrição ou categoria")
    await expect(input).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
  }
})

test("navegação móvel abre todos os módulos e a busca global", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "Módulos" }).click()
  const dialog = page.getByRole("dialog", { name: "Módulos do ERP" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("link", { name: "Fiscal" })).toBeVisible()
  await expect(dialog.getByRole("link", { name: "Logística" })).toBeVisible()
  await expect(dialog.getByRole("link", { name: "Serviços" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Buscar" }).click()
  const searchDialog = page.getByRole("dialog", { name: "Buscar no ERP" })
  await expect(searchDialog).toBeVisible()
  await expect(searchDialog.getByText("Cadastros", { exact: true })).toBeVisible()
})

test("menu superior expõe todos os destinos operacionais existentes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP" })
  const destinations = [
    "/cadastros/contas-financeiras", "/cadastros/categorias-financeiras",
    "/vendas/importacao", "/fiscal/notas-saida", "/fiscal/nfce",
    "/compras/notas-entrada", "/financeiro/faturamento-agrupado",
    "/financeiro/contador", "/financeiro/conta-digital",
    "/relatorios/vendas", "/relatorios/estoque", "/relatorios/financeiro",
    "/logistica/postagens", "/logistica/reversa", "/logistica/checkout",
    "/logistica/etiquetas", "/logistica/envios", "/servicos/contratos",
    "/servicos/ordens", "/servicos/cte", "/servicos/notas", "/servicos/cobrancas",
  ]
  for (const href of destinations) await expect(navigation.locator(`a[href="${href}"]`).first()).toHaveCount(1)
})

test("páginas principais não emitem erros no navegador", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  for (const route of responsiveRoutes) {
    await page.goto(route)
    await expect(page.locator("h1").first()).toBeVisible()
  }
  expect(errors, errors.join("\n")).toEqual([])
})

test("PDV controla quantidade, pagamento e limpeza da venda", async ({ page }) => {
  await page.goto("/vendas/pdv")
  await page.getByRole("button", { name: /Banco Regulável R\$/ }).click()
  await expect(page.getByText("2", { exact: true })).toBeVisible()
  const payment = page.getByRole("button", { name: "Simular pagamento" })
  await payment.click()
  await expect(page.getByRole("status")).toContainText("Pagamento aprovado")
  await expect(payment).toBeDisabled()
  await page.getByRole("button", { name: "Limpar venda" }).click()
  await expect(payment).toBeDisabled()
  await expect(page.getByText("R$ 0,00", { exact: true })).toBeVisible()
})

test("listagens demonstrativas expõem ações e paginação honestas", async ({ page }) => {
  await page.goto("/cadastros/vendedores")
  await page.getByRole("button", { name: "Importar" }).click()
  await expect(page.getByRole("status")).toContainText("nenhum arquivo foi enviado")
  await page.getByRole("button", { name: "Exportar" }).click()
  await expect(page.getByRole("status")).toContainText("nenhum arquivo foi gerado")
  await expect(page.getByText(/Exibindo 1–3 de 3 registros/)).toBeVisible()
  await page.getByLabel("Por página").selectOption("50")
})

test("formulários restauram coleções locais ao cancelar", async ({ page }) => {
  await page.goto("/compras/pedidos/novo")
  const save = page.getByRole("button", { name: "Salvar demonstração" })
  await expect(save).toBeDisabled()
  await page.getByRole("button", { name: "Adicionar" }).click()
  await expect(save).toBeEnabled()
  await page.getByRole("button", { name: "Cancelar" }).click()
  await expect(page.getByLabel("Descrição do item 2")).toHaveCount(0)
  await expect(save).toBeDisabled()
})

test.describe("cadastros navegam entre listagem, criação, detalhe e edição", () => {
  const flows = [
    ["vendedores", "Novo vendedor", "VEN-001"],
    ["funcionarios", "Novo funcionário", "FUN-001"],
    ["contas-financeiras", "Nova conta", "CTA-001"],
    ["categorias-financeiras", "Nova categoria", "CAT-001"],
    ["formas-pagamento", "Nova forma", "PAG-001"],
    ["categorias-produtos", "Nova categoria", "CPR-001"],
    ["listas-precos", "Nova lista", "LST-001"],
  ] as const

  for (const [module, createLabel, id] of flows) {
    test(module, async ({ page }) => {
      await page.goto(`/cadastros/${module}`)
      await expect(page.getByRole("link", { name: createLabel })).toHaveAttribute("href", `/cadastros/${module}/novo`)
      await expect(page.locator(`a[href="/cadastros/${module}/${id}"]`)).toBeVisible()
      await page.goto(`/cadastros/${module}/${id}`)
      await expect(page.locator("h1")).toBeVisible()
      await expect(page.locator(`a[href="/cadastros/${module}/${id}/editar"]`)).toBeVisible()
    })
  }
  test("pessoas exigem configuração de acesso", async ({ page }) => {
    for (const route of ["/cadastros/clientes-fornecedores", "/cadastros/clientes-fornecedores/novo", "/cadastros/clientes-fornecedores/00000000-0000-0000-0000-000000000000/editar"]) {
      await page.goto(route)
      await expect(page.getByRole("heading", { name: "Clientes e fornecedores", exact: true })).toBeVisible()
      await expect(page.getByRole("status")).toContainText("O login do ERP ainda não foi configurado")
      await expect(page.getByText("PES-001", { exact: true })).toHaveCount(0)
    }
  })
})

test("compras e estoque navegam para seus fluxos operacionais", async ({ page }) => {
  const purchaseFlows = [
    ["/compras/pedidos", "/compras/pedidos/pc-00482"],
    ["/compras/notas-entrada", "/compras/notas-entrada/000184322"],
    ["/compras/recebimentos", "/compras/recebimentos/rec-00215"],
    ["/compras/sugestoes", "/compras/sugestoes/sug-00118"],
  ] as const
  for (const [route, detail] of purchaseFlows) {
    await page.goto(route)
    await expect(page.locator(`a[href="${detail}"]`)).toBeVisible()
  }

  await page.goto("/compras/pedidos/pc-00482")
  await page.getByRole("button", { name: "Aprovar" }).click()
  await expect(page.getByRole("status")).toContainText(/aprovado/i)

  const inventoryFlows = [
    ["/estoque/inventarios", "/estoque/inventarios/novo", "/estoque/inventarios/INV-2026-004"],
    ["/estoque/depositos", "/estoque/depositos/novo", "/estoque/depositos/DEP-01"],
    ["/estoque/ordens-producao", "/estoque/ordens-producao/novo", "/estoque/ordens-producao/OP-00981"],
  ] as const
  for (const [route, create, detail] of inventoryFlows) {
    await page.goto(route)
    await expect(page.locator(`a[href="${create}"]`)).toBeVisible()
    await expect(page.locator(`a[href="${detail}"]`)).toBeVisible()
  }
  for (const route of ["/estoque", "/estoque/saldos", "/estoque/lancamentos", "/estoque/lancamentos/novo"]) {
    await page.goto(route)
    await expect(page.getByRole("heading", { name: "Saldos e movimentos", exact: true })).toBeVisible()
    await expect(page.getByRole("status")).toContainText("O login do ERP ainda não foi configurado")
    await expect(page.getByText("MOV-01842", { exact: true })).toHaveCount(0)
  }
})

test("vendas navega para seus fluxos detalhados", async ({ page }) => {
  const flows = [
    ["/vendas/propostas", "/vendas/propostas/novo", "/vendas/propostas/pc-382"],
    ["/vendas/anuncios", "/vendas/anuncios/novo", "/vendas/anuncios/an-210"],
    ["/vendas/garantias", "/vendas/garantias/novo", "/vendas/garantias/gar-091"],
  ] as const
  for (const [route, create, detail] of flows) {
    await page.goto(route)
    await expect(page.locator(`a[href="${create}"]`)).toBeVisible()
    await expect(page.locator(`a[href="${detail}"]`)).toBeVisible()
  }

  await page.goto("/vendas/pdv")
  await expect(page.locator('a[href="/vendas/pdv/fechamento"]')).toBeVisible()
  await expect(page.locator('a[href="/vendas/pdv/historico"]')).toBeVisible()
  for (const route of ["/vendas/pedidos", "/vendas/pedidos/novo", "/financeiro/contas-receber"]) {
    await page.goto(route)
    await expect(page.getByRole("status")).toContainText("O login do ERP ainda não foi configurado")
  }
})

test("fiscal navega para documentos, monitor e guias detalhados", async ({ page }) => {
  const flows = [
    ["/fiscal/notas-saida", "/fiscal/notas-saida/NFE-000184"],
    ["/fiscal/nfce", "/fiscal/nfce/NFCE-00428"],
    ["/fiscal/monitor", "/fiscal/monitor/NSU-009812"],
    ["/fiscal/guias", "/fiscal/guias/GUIA-091"],
  ] as const
  for (const [route, detail] of flows) {
    await page.goto(route)
    await expect(page.locator(`a[href="${detail}"]`)).toBeVisible()
  }
  await page.goto("/fiscal/guias")
  await expect(page.locator('a[href="/fiscal/guias/nova"]')).toBeVisible()
})

test("logística navega para criação, conferência e acompanhamento", async ({ page }) => {
  const flows = [
    ["/logistica/postagens", "/logistica/postagens/novo", "/logistica/postagens/OBJ-2481"],
    ["/logistica/reversa", "/logistica/reversa/nova", "/logistica/reversa/REV-091"],
    ["/logistica/checkout", "/logistica/checkout/PV-1048", "/logistica/checkout/PV-1048"],
    ["/logistica/etiquetas", "/logistica/etiquetas/nova", "/logistica/etiquetas/FILA-331"],
    ["/logistica/envios", "/logistica/envios/nova", "/logistica/envios/COT-1842"],
  ] as const
  for (const [route, create, detail] of flows) {
    await page.goto(route)
    await expect(page.locator(`a[href="${create}"]`).first()).toBeVisible()
    await expect(page.locator(`a[href="${detail}"]`).first()).toBeVisible()
  }
})

test("navegação por teclado mantém foco visível", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/preferencias/usuarios")
  await page.keyboard.press("Tab")
  const focused = page.locator(":focus")
  await expect(focused).toBeVisible()
  const focusStyle = await focused.evaluate((element) => { const style = getComputedStyle(element); return { outline: style.outlineStyle, shadow: style.boxShadow } })
  expect(focusStyle.outline !== "none" || focusStyle.shadow !== "none").toBeTruthy()
})

test("serviços executa fluxos específicos por operação", async ({ page }) => {
  await page.goto("/servicos/ordens")
  await page.getByRole("button", { name: /OS-2048/ }).click()
  await expect(page.getByRole("button", { name: "Iniciar execução" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Concluir ordem" })).toBeVisible()
  await page.getByRole("button", { name: "Nova ordem" }).click()
  await expect(page.getByRole("heading", { name: "Nova ordem" })).toBeVisible()
  await expect(page.getByLabel("Técnico")).toBeVisible()
})

test("financeiro protege ações e expõe formulário contextual", async ({ page }) => {
  await page.goto("/financeiro/contas-pagar")
  await page.getByRole("button", { name: /CP-2841/ }).click()
  await expect(page.getByRole("button", { name: "Registrar baixa" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Estornar baixa" })).toBeVisible()
  await page.getByRole("button", { name: "Nova obrigação" }).click()
  await expect(page.getByLabel("Fornecedor")).toBeVisible()
  await expect(page.getByLabel("Valor")).toBeVisible()
})

test("relatórios compara, agrupa e detalha dados", async ({ page }) => {
  await page.goto("/relatorios/financeiro")
  await page.getByLabel("Agrupar relatório").selectOption("Categoria")
  await page.getByText("Comparar período").click()
  await expect(page.getByText(/Comparação ativa/)).toBeVisible()
  await page.getByRole("button", { name: /Outubro\/2026/ }).click()
  await expect(page.getByText("Detalhamento por categoria")).toBeVisible()
})

test("menus expõem dashboards, central de trabalho e rotas operacionais", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.locator("summary").filter({ hasText: "Meu Negócio" }).click()
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP" })
  await expect(navigation.locator('a[href="/dashboards/margem-pedidos"]')).toBeVisible()
  await expect(navigation.locator('a[href="/eventos"]')).toBeVisible()
  await expect(navigation.locator('a[href="/assistente"]')).toBeVisible()
  await page.locator("summary").filter({ hasText: "Financeiro" }).click()
  await expect(navigation.locator('a[href="/financeiro/faturamento-agrupado"]')).toBeVisible()
  await expect(navigation.locator('a[href="/financeiro/conta-digital"]')).toBeVisible()
})

test("home gerencia atalhos sem inventar indicadores ou eventos", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Remover Pedidos de venda" }).click()
  await expect(page.getByRole("button", { name: "Adicionar Pedidos de venda" })).toBeVisible()
  await page.getByRole("button", { name: "30D" }).click()
  await expect(page.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Adicionar gráfico" }).click()
  await expect(page.getByRole("article", { name: "Gráfico Pedidos de venda", exact: true })).toContainText("A fonte de dados ainda não está conectada")
  await expect(page.getByText("Pedido de venda #1048", { exact: true })).toHaveCount(0)
  await expect(page.getByText("R$ 95.835,73", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Ludus Equipamentos", { exact: true })).toHaveCount(0)
  for (const width of [320, 375, 440, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
    const logistics = await page.getByRole("link", { name: "Logística Expedição, transportadoras e etiquetas" }).boundingBox()
    expect(logistics).not.toBeNull()
    expect(logistics!.x + logistics!.width).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 440, height: 956 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "../../evidencias/screenshots/erp-home-mobile-sem-dados-ficticios.png", fullPage: true })
})

test("central de trabalho controla eventos e notificações locais", async ({ page }) => {
  await page.goto("/eventos")
  await page.getByRole("button", { name: "Marcar como lido" }).first().click()
  await expect(page.getByRole("tab", { name: "Não lidos (1)" })).toBeVisible()
  await page.goto("/notificacoes")
  await page.getByRole("button", { name: "Marcar todas como lidas" }).click()
  await expect(page.getByRole("button", { name: "Lida", exact: true }).first()).toBeDisabled()
})

test("experiência opcional mantém assistente, novidades e plano locais", async ({ page }) => {
  await page.goto("/assistente")
  await page.getByLabel("Mensagem para o assistente").fill("Mostre os pedidos pendentes")
  await page.getByRole("button", { name: "Enviar" }).click()
  await expect(page.getByText(/nenhum dado foi consultado/)).toBeVisible()
  await page.goto("/novidades")
  await page.getByRole("button", { name: "Fiscal" }).click()
  await expect(page.getByRole("heading", { name: "Eventos fiscais na página inicial" })).toBeVisible()
  await page.goto("/preferencias/plano")
  await expect(page.getByRole("heading", { name: "ERP Next Completo" })).toBeVisible()
})

test("temas claro e escuro são aplicados", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/")
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.goto("/preferencias/sistema")
  await expect(page.getByRole("radio", { name: "Claro" })).toBeChecked()
  await page.getByRole("radio", { name: "Claro" }).check()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.getByRole("radio", { name: "Escuro" }).check()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.reload()
  await expect(page.getByRole("radio", { name: "Escuro" })).toBeChecked()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.goto("/")
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.goto("/preferencias/sistema")
  await page.getByRole("radio", { name: "Sistema", exact: true }).check()
  await page.emulateMedia({ colorScheme: "light" })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("radio", { name: "Claro" }).check()
  await page.goto("/")
  await expect(page.locator("html")).not.toHaveClass(/dark/)
})

function collectPages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? collectPages(target) : entry.name === "page.tsx" ? [target] : []
  })
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
}
