import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
test.beforeEach(async ({ context })=>installFrontendFixture(context))
test("perfis da Ludus preservam códigos e salvam por empresa com revisão no celular",async({page})=>{
 let saved:unknown
 await page.route("**/api/erp/registration-settings/tax-profiles",route=>{if(route.request().method()==="PUT"){expect(route.request().headers()["if-match"]).toBe('"1"');expect(route.request().headers()["x-tenant-id"]).toBe(tenant);saved=route.request().postDataJSON()}return route.fulfill({headers:{ETag:saved?'"2"':'"1"'},json:{tenantId:tenant,revision:saved?2:1,canEdit:true,data:saved||{profiles:[]}}})})
 await page.setViewportSize({width:390,height:844});await page.goto("/preferencias/cadastros/perfis-tributarios")
 await page.getByRole("button",{name:"Preencher os dois perfis informados pelo contador da Ludus"}).click()
 await expect(page.getByLabel("Perfil 1: PIS (%)",{exact:true})).toHaveValue("1.6500")
 await expect(page.getByLabel("Perfil 2: COFINS (%)",{exact:true})).toHaveValue("7.6000")
 await expect(page.getByLabel("Perfil 1: CST IBS/CBS",{exact:true})).toHaveValue("000")
 await expect(page.getByLabel("Perfil 2: cClassTrib",{exact:true})).toHaveValue("000001")
 await page.getByRole("button",{name:"Salvar configurações",exact:true}).click()
 await expect(page.getByRole("status")).toHaveText("Configurações salvas para esta empresa.")
 await page.reload();await expect(page.getByLabel("Perfil 1: PIS (%)",{exact:true})).toHaveValue("1.6500")
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test("conflito preserva as exigências e impede nova gravação",async({page})=>{
 await page.route("**/api/erp/registration-settings/products",route=>route.request().method()==="PUT"?route.fulfill({status:412,json:{title:"Configuração alterada por outra pessoa"}}):route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,revision:1,canEdit:true,data:{requireNcm:false,requireCest:false}}}))
 await page.goto("/preferencias/cadastros/produtos");await page.getByLabel("Exigir NCM no cadastro de produtos").check();await page.getByRole("button",{name:"Salvar configurações",exact:true}).click()
 await expect(page.getByRole("alert")).toHaveText("Configuração alterada por outra pessoa")
 await expect(page.getByLabel("Exigir NCM no cadastro de produtos")).toBeChecked();await expect(page.getByRole("button",{name:"Salvar configurações",exact:true})).toBeDisabled()
})
