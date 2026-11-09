import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("configuração NFC-e salva dados do usuário e não devolve o CSC", async ({page},testInfo) => {
  let saved: Record<string,unknown> | null = null
  await page.route("**/api/erp/fiscal/settings/nfce",async route=>{
    if(route.request().method()==="PUT") {
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      const {csc,...data}=route.request().postDataJSON()
      expect(csc).toBe("12345678-1234-1234-1234-123456789ABC")
      saved={...data,cscConfigured:true}
    }
    await route.fulfill({headers:{ETag:saved?'"2"':'"1"'},json:{tenantId:tenant,revision:saved?2:1,canEdit:true,secretStorageAvailable:true,data:saved}})
  })
  await page.setViewportSize({width:390,height:844})
  await page.goto("/preferencias/fiscal/nfce")
  await page.getByLabel("Ambiente",{exact:true}).selectOption("production")
  await page.getByLabel("UF do emitente").fill("SP")
  await page.getByLabel("Série da NFC-e").fill("2")
  await page.getByLabel("Próximo número da NFC-e").fill("145")
  await page.getByLabel("Identificador do CSC").fill("000001")
  await page.getByLabel("Código de segurança do contribuinte (CSC)").fill("12345678-1234-1234-1234-123456789ABC")
  await page.getByRole("button",{name:"Salvar configuração",exact:true}).click()
  await expect(page.getByRole("status")).toHaveText("Configuração salva no servidor.")
  await expect(page.getByLabel("Código de segurança do contribuinte (CSC)")).toHaveValue("")
  await page.reload()
  await expect(page.getByLabel("Próximo número da NFC-e")).toHaveValue("145")
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await testInfo.attach("nfce-config-mobile",{body:await page.screenshot({fullPage:true}),contentType:"image/png"})
})

test("e-mail e pessoas autorizadas ao XML persistem por revisão e empresa", async ({ page }, testInfo) => {
  let saved: Record<string, unknown> | null = null
  await page.route("**/api/erp/fiscal/settings/delivery", async route => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      saved = route.request().postDataJSON()
    }
    await route.fulfill({
      headers: { ETag: saved ? '"2"' : '"1"' },
      json: {
        tenantId: tenant,
        revision: saved ? 2 : 1,
        canEdit: true,
        secretStorageAvailable: true,
        data: saved || { notificationEmail: null, authorizedPeople: [] }
      }
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/fiscal/delivery")
  await page.getByLabel("E-mail fiscal para avisos").fill("fiscal@example.test")
  await page.getByRole("button", { name: "Adicionar pessoa" }).click()
  const person = page.getByRole("region", { name: "Pessoa autorizada 1", exact: true })
  await person.getByLabel("Nome completo").fill("Transportadora Teste")
  await person.getByLabel("E-mail autorizado").fill("xml@example.test")
  await person.getByLabel("CPF ou CNPJ").fill("04.252.011/0001-10")
  await person.getByLabel("Função ou relação").fill("transportadora")
  await page.getByRole("button", { name: "Salvar configuração", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Configuração salva no servidor.")
  expect(saved).toMatchObject({ notificationEmail: "fiscal@example.test" })
  await page.reload()
  await expect(page.getByLabel("E-mail fiscal para avisos")).toHaveValue("fiscal@example.test")
  await expect(person.getByLabel("CPF ou CNPJ")).toHaveValue("04.252.011/0001-10")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await testInfo.attach("fiscal-delivery-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
})

test("naturezas persistem e conflito preserva a edição sem repetir gravação",async ({page},testInfo)=>{
  let saved: unknown = {items:[]}
  let writes=0
  await page.route("**/api/erp/fiscal/settings/operation-natures",route=>{
    if(route.request().method()==="PUT") {
      writes++
      if(writes>1)return route.fulfill({status:412,json:{title:"Naturezas alteradas por outra pessoa"}})
      saved=route.request().postDataJSON()
    }
    return route.fulfill({headers:{ETag:writes?'"2"':'"1"'},json:{tenantId:tenant,revision:writes?2:1,canEdit:true,secretStorageAvailable:true,data:saved}})
  })
  await page.setViewportSize({width:390,height:844})
  await page.goto("/preferencias/fiscal/naturezas")
  await page.getByRole("button",{name:"Adicionar natureza"}).click()
  const nature=page.getByRole("region",{name:"Natureza 1",exact:true})
  await nature.getByLabel("Código",{exact:true}).fill("VENDA")
  await nature.getByLabel("Descrição da natureza").fill("Venda de produção")
  await nature.getByLabel("Operação",{exact:true}).selectOption("outgoing")
  await nature.getByLabel("CFOP interno").fill("5101")
  await page.getByRole("button",{name:"Salvar configuração",exact:true}).click()
  await expect(page.getByRole("status")).toHaveText("Configuração salva no servidor.")
  await page.reload()
  await expect(nature.getByLabel("CFOP interno")).toHaveValue("5101")
  await nature.getByLabel("Descrição da natureza").fill("Venda revisada")
  await page.getByRole("button",{name:"Salvar configuração",exact:true}).click()
  await expect(page.getByRole("alert").filter({hasText:"Naturezas alteradas por outra pessoa"})).toHaveText("Naturezas alteradas por outra pessoa")
  await expect(nature.getByLabel("Descrição da natureza")).toHaveValue("Venda revisada")
  await expect(page.getByRole("button",{name:"Salvar configuração",exact:true})).toBeDisabled()
  expect(writes).toBe(2)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await testInfo.attach("naturezas-mobile",{body:await page.screenshot({fullPage:true}),contentType:"image/png"})
})

test("consultas fiscais mostram eventos reais e falha não aparece como lista vazia",async ({page})=>{
  let fail=false
  await page.route("**/api/erp/fiscal/nfe-events?**",route=>{
    if(fail)return route.fulfill({status:503,json:{title:"Consulta fiscal indisponível"}})
    const kind=new URL(route.request().url()).searchParams.get("kind")
    return route.fulfill({json:{tenantId:tenant,nextCursor:null,data:kind==="correcao"?[]:[{id:"event-1",documentId:null,kind,sequence:1,status:"unknown",environment:"homologation",series:null,number:null,accessKey:null,request:{year:2026,series:1,first:3,last:5,text:"Justificativa registrada pelo operador"},result:{code:"timeout",reason:"Consulte antes de repetir"},createdAt:"2026-11-05T10:00:00-03:00"}]}})
  })
  await page.goto("/preferencias/fiscal/inutilizacoes")
  await expect(page.getByText("Faixa: 3 a 5")).toBeVisible()
  await expect(page.getByText("Sem confirmação",{exact:true})).toBeVisible()
  fail=true
  await page.getByRole("button",{name:"Atualizar consulta"}).click()
  await expect(page.getByRole("alert").filter({hasText:"Consulta fiscal indisponível"})).toHaveText("Consulta fiscal indisponível")
  await expect(page.getByText("Faixa: 3 a 5")).toHaveCount(0)
  await expect(page.getByText("Nenhum evento desta categoria registrado nesta empresa.")).toHaveCount(0)
  fail=false
  await page.goto("/preferencias/fiscal/correcoes")
  await expect(page.getByText("Nenhum evento desta categoria registrado nesta empresa.")).toBeVisible()
})
test("perfis da Ludus preservam códigos e salvam por empresa com revisão no celular", async ({ page }) => {
  let saved: unknown
  await page.route("**/api/erp/registration-settings/tax-profiles", (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      saved = route.request().postDataJSON()
      const profiles = (saved as { profiles: { productLine?: string; lineRules?: unknown }[] }).profiles
      if (profiles.some(profile => Boolean(profile.productLine) !== Boolean(profile.lineRules))) {
        return route.fulfill({ status: 422, json: { title: "Regras da nota exigem uma linha comercial válida" } })
      }
    }
    return route.fulfill({
      headers: { ETag: saved ? '"2"' : '"1"' },
      json: { tenantId: tenant, revision: saved ? 2 : 1, canEdit: true, data: saved || { profiles: [] } }
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/cadastros/perfis-tributarios")
  await expect(
    page.getByRole("button", { name: "Preencher os dois perfis informados pelo contador da Ludus" })
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .getByRole("button", { name: "Preencher os dois perfis informados pelo contador da Ludus" })
    .click()
  await expect(page.getByLabel("Perfil 1: PIS (%)", { exact: true })).toHaveValue("1.6500")
  await expect(page.getByLabel("Perfil 2: COFINS (%)", { exact: true })).toHaveValue("7.6000")
  await expect(page.getByLabel("Perfil 1: CST IBS/CBS", { exact: true })).toHaveValue("000")
  await expect(page.getByLabel("Perfil 2: cClassTrib", { exact: true })).toHaveValue("000001")
  await expect(page.getByLabel("Perfil 1: linha comercial", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Perfil 2: linha comercial", { exact: true })).toHaveValue("")
  await expect(page.getByRole("combobox", { name: "Perfil 1: CST do ICMS", exact: true })).toHaveValue("00")
  await expect(page.getByRole("combobox", { name: "Perfil 1: CST do IPI", exact: true })).toHaveValue("50")
  await expect(page.getByRole("combobox", { name: "Perfil 2: CST do IPI", exact: true })).toHaveValue("53")
  await expect(page.getByLabel("Perfil 1: Enquadramento do IPI", { exact: true })).toHaveValue("999")
  await expect(page.getByLabel("Perfil 2: IBS municipal (%)", { exact: true })).toHaveValue("0.0000")
  await page.getByRole("combobox", { name: "Perfil 2: Consumidor final", exact: true }).selectOption("false")
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Configurações salvas para esta empresa.")
  await page.reload()
  await expect(page.getByLabel("Perfil 1: PIS (%)", { exact: true })).toHaveValue("1.6500")
  await expect(page.getByRole("combobox", { name: "Perfil 2: Consumidor final", exact: true })).toHaveValue("false")
  await expect(page.getByRole("combobox", { name: "Perfil 1: CST do ICMS", exact: true })).toHaveValue("00")
  await expect(page.getByLabel("Perfil 2: IBS municipal (%)", { exact: true })).toHaveValue("0.0000")
  expect(saved).toMatchObject({ profiles: [
    { defaults: { icmsCst: "00", ipiCst: "50", ibsCityRate: "0.0000", finalConsumer: true } },
    { defaults: { icmsCst: "00", ipiCst: "53", ibsCityRate: "0.0000", finalConsumer: false } }
  ] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test("conflito preserva as exigências e impede nova gravação", async ({ page }) => {
  await page.route("**/api/erp/registration-settings/products", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 412, json: { title: "Configuração alterada por outra pessoa" } })
      : route.fulfill({
          headers: { ETag: '"1"' },
          json: {
            tenantId: tenant,
            revision: 1,
            canEdit: true,
            data: { requireNcm: false, requireCest: false }
          }
        })
  )
  await page.goto("/preferencias/cadastros/produtos")
  await page.getByLabel("Exigir NCM no cadastro de produtos").check()
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "Configuração alterada por outra pessoa" })
  ).toHaveText("Configuração alterada por outra pessoa")
  await expect(page.getByLabel("Exigir NCM no cadastro de produtos")).toBeChecked()
  await expect(page.getByRole("button", { name: "Salvar configurações", exact: true })).toBeDisabled()
})
