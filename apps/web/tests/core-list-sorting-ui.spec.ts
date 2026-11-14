import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const cases = [
 { path: "/cadastros/produtos", endpoint: "products", title: "Catálogo de produtos", headers: ["Produto","SKU","Unidade","Preço base","Situação"], field: "price", label: "Preço base", search: "Buscar nome ou SKU", create: "Novo produto", row: { id: record, revision: 1, name: "Árvore grande", sku: "P-001", unit: "UN", basePrice: "123456789.01", status: "active", hasPhoto: false } },
 { path: "/cadastros/clientes-fornecedores", endpoint: "parties", title: "Pessoas cadastradas", headers: ["Nome","CPF / CNPJ","Relacionamento","Contato","Situação no ERP"], field: "taxId", label: "CPF / CNPJ", search: "Buscar nome ou documento", create: "Nova pessoa", row: { id: record, revision: 1, legalName: "Árvore grande", taxId: "04252011000110", email: "pessoa@teste.test", isCustomer: true, isSupplier: false, status: "active" } },
 { path: "/cadastros/funcionarios", endpoint: "staff", title: "Equipe cadastrada", headers: ["Código","Nome","Cargo","Contato","Situação"], field: "code", label: "Código", search: "Buscar nome, código ou cargo", create: "Novo cadastro", row: { id: record, revision: 1, name: "Árvore grande", code: "F-001", jobTitle: "Analista", email: "pessoa@teste.test", isEmployee: true, isSeller: false, status: "active" } },
 { path: "/estoque/depositos", endpoint: "warehouses", title: "Depósitos de estoque", headers: ["Código","Nome","Localização","Situação",""], field: "location", label: "Localização", search: "Buscar nome ou código", create: "Novo cadastro", row: { id: record, revision: 1, code: "D-001", name: "Árvore grande", location: "Centro", status: "active" } },
]

test.beforeEach(async ({ context, page }) => {
 await installFrontendFixture(context)
 await page.route("**/api/erp/me", route => route.fulfill({json:{tenant:{id:tenant,legalName:"Empresa teste"},permissions:[]}}))
 await page.route("**/api/erp/preferences", route => route.fulfill({json:{tenantId:tenant,data:{productPageSize:25}}}))
 await page.route(/\/api\/erp\/product-categories\?/, route => route.fulfill({json:{tenantId:tenant,canEdit:true,total:0,data:[]}}))
})

for (const config of cases) test(`${config.endpoint}: keyboard sort keeps filters, page and empty structure`, async ({ page }, info) => {
 let empty = false, canEdit = true, error = false
 const queries: URLSearchParams[] = []
 await page.route(new RegExp(`/api/erp/${config.endpoint}\\?`), route => {
  queries.push(new URL(route.request().url()).searchParams)
  return route.fulfill(error ? {status:503,json:{title:"Consulta indisponível"}} : {json:{tenantId:tenant,canEdit,total:empty?0:75,data:empty?[]:[config.row]}})
 })
 await page.route(`**/api/erp/${config.endpoint}/${record}`, route => route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:config.row}}))
 await page.goto(`${config.path}?q=Árvore&status=active&offset=25&returnTo=keep#records`)
 await expect(page.getByRole("heading",{level:1,name:config.title,exact:true})).toBeVisible()
 await expect(page.locator("main h1")).toHaveCount(1)
 const header = page.getByRole("columnheader").filter({has:page.getByRole("button",{name:config.label,exact:true})})
 await header.getByRole("button").focus(); await page.keyboard.press("Enter")
 await expect.poll(()=>queries.at(-1)?.get("sortBy")).toBe(config.field)
 await expect(header).toHaveAttribute("aria-sort","ascending")
 expect(new URL(page.url()).searchParams.get("offset")).toBe("25")
 expect(new URL(page.url()).searchParams.get("returnTo")).toBe("keep")
 expect(new URL(page.url()).hash).toBe("#records")
 await header.getByRole("button").press("Enter")
 await expect.poll(()=>queries.at(-1)?.get("sortOrder")).toBe("desc")
 await page.getByRole("button",{name:"Próxima",exact:true}).click()
 await expect.poll(()=>queries.at(-1)?.get("offset")).toBe("50")
 expect(queries.at(-1)?.get("sortOrder")).toBe("desc")
 await page.getByRole("link",{name:"Árvore grande",exact:true}).click()
 await expect(page).toHaveURL(new RegExp(`/${record}`))
 await page.goBack()
 await expect(page.getByRole("heading",{level:1,name:config.title,exact:true})).toBeVisible()
 expect(new URL(page.url()).searchParams.get("sortOrder")).toBe("desc")
 expect(new URL(page.url()).searchParams.get("offset")).toBe("50")
 await page.getByLabel(config.search,{exact:true}).fill("Nova busca")
 await expect.poll(()=>queries.at(-1)?.get("q")).toBe("Nova busca")
 expect(queries.at(-1)?.get("sortBy")).toBe(config.field)
 await page.getByRole("button",{name:"Limpar",exact:true}).click()
 await expect(page.getByLabel(config.search,{exact:true})).toHaveValue("")
 await expect.poll(()=>queries.at(-1)?.get("q") || "").toBe("")
 expect(queries.at(-1)?.get("sortOrder")).toBe("desc")
 expect(new URL(page.url()).searchParams.get("returnTo")).toBe("keep")
 for (const width of [375,768,1024,1440]) {
  await page.setViewportSize({width,height:900})
  await expect(page.getByRole("columnheader")).toHaveCount(config.headers.length)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const region = page.locator(".workspace-responsive-table")
  expect(await region.evaluate(element=>element.getBoundingClientRect().right<=innerWidth+1)).toBe(true)
  if (config.endpoint === "products") await expect(page.locator(".workspace-currency-cell")).toHaveCSS("white-space","nowrap")
  await page.screenshot({path:info.outputPath(`${config.endpoint}-${width}.png`),fullPage:true})
 }
 empty=true;canEdit=false
 await page.reload()
 await expect(page.getByText("Nenhum registro cadastrado",{exact:true})).toBeVisible()
 await expect(page.getByRole("columnheader")).toHaveCount(config.headers.length)
 await expect(page.getByRole("link",{name:config.create,exact:true})).toHaveCount(0)
 await page.goto(`${config.path}?q=ausente&sortBy=${config.field}&sortOrder=desc`)
 await expect(page.getByText("Nenhum resultado encontrado",{exact:true})).toBeVisible()
 canEdit=true
 await page.reload()
 await expect(page.getByRole("link",{name:config.create,exact:true})).toHaveCount(2)
 error=true
 await page.reload()
 await expect(page.getByRole("alert").getByText("Consulta indisponível",{exact:true})).toBeVisible()
 await expect(page.getByText("Nenhum resultado encontrado",{exact:true})).toHaveCount(0)
})
