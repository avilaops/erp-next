import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { desktopMenus, navigationDestinations } from "../src/components/shell/navigation-catalog.ts"
import { preferenceCategories } from "../src/components/shell/preference-catalog.ts"

test("todos os módulos operacionais têm entrada própria e visão geral", () => {
  for (const [label, href] of [["Cadastros", "/cadastros"], ["Vendas", "/vendas"], ["Estoque", "/estoque"], ["Compras", "/compras"], ["Financeiro", "/financeiro"], ["Fiscal", "/fiscal"], ["Logística", "/logistica"], ["Serviços", "/servicos"], ["Relatórios", "/relatorios"]]) {
    const menu = desktopMenus.find(menu => menu.label === label)
    assert.ok(menu, `Módulo ausente: ${label}`)
    assert.ok(menu.columns.flatMap(group => group.items).some(item => item.href === href), `Visão geral ausente: ${label}`)
  }
})

test("operações antes ausentes são acessíveis no módulo correspondente", () => {
  const expected = { Cadastros: [ "/cadastros/grupos-produtos", "/cadastros/grupos-tags", "/cadastros/tags"], Fiscal: ["/fiscal/ctes", "/fiscal/nfses", "/fiscal/danfe", "/fiscal/guias", "/fiscal/monitor"], Vendas: ["/vendas/pdv/fechamento", "/vendas/pdv/historico"], Serviços: ["/servicos/contratos/modelos"] }
  for (const [label, paths] of Object.entries(expected)) {
    const links = desktopMenus.find(menu => menu.label === label)?.columns.flatMap(group => group.items.map(item => item.href)) ?? []
    for (const path of paths) assert.ok(links.includes(path), `${label}: ${path}`)
  }
})

test("todas as configurações disponíveis são encontradas na busca sem destinos repetidos", () => {
  const paths = navigationDestinations.map(item => item.href)
  assert.equal(paths.length, new Set(paths).size)
  for (const category of preferenceCategories) for (const section of category.sections) for (const item of section.items) {
    if (item.href) assert.ok(paths.includes(item.href), `Configuração ausente: ${item.label}`)
  }
})

test("links do menu levam a páginas existentes e não se repetem no mesmo módulo", () => {
  for (const menu of desktopMenus) {
    const paths = menu.columns.flatMap(group => group.items.map(item => item.href))
    assert.equal(paths.length, new Set(paths).size, `Duplicação em ${menu.label}`)
    for (const href of paths) {
      const path = href.split("?")[0]
      let directories = [fileURLToPath(new URL("../src/app", import.meta.url))]
      for (const part of path.split("/").filter(Boolean)) directories = directories.flatMap(directory => readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && (entry.name === part || /^\[[^\]]+\]$/.test(entry.name))).map(entry => `${directory}/${entry.name}`))
      assert.ok(directories.some(directory => existsSync(`${directory}/page.tsx`)), href)
    }
  }
})

test("Serviços oferece os módulos implementados sem bloqueio fixo de indisponibilidade", () => {
  const services = preferenceCategories.find(category => category.id === "servicos")
  const items = services.sections.flatMap(section => section.items)
  for (const href of ["/servicos/ordens", "/servicos/notas", "/servicos/cte", "/servicos/contratos/modelos", "/servicos/cobrancas"]) {
    assert.ok(items.some(item => item.href === href && !item.unavailable), href)
  }
  assert.ok(items.every(item => !item.unavailable))
})

test("pagamentos de funcionários pertence a Contas a pagar e sai de Cadastros", () => {
  assert.ok(navigationDestinations.some(item => item.href === "/financeiro/contas-pagar?aba=funcionarios" && item.category === "Financeiro / Contas a pagar"))
  assert.ok(!desktopMenus.find(menu => menu.label === "Cadastros").columns.flatMap(group => group.items).some(item => item.href.includes("/pagamentos")))
})
