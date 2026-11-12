import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
const root="11111111-1111-4111-8111-111111111112", child="22222222-2222-4222-8222-222222222223", sibling="33333333-3333-4333-8333-333333333334"
const categories=[{id:root,revision:1,code:"PREMIUM",name:"Premium",parentId:null,sortOrder:1,status:"active",notes:null},{id:child,revision:1,code:"PRO",name:"Pro",parentId:root,sortOrder:0,status:"active",notes:null},{id:sibling,revision:1,code:"CORE",name:"Core",parentId:null,sortOrder:0,status:"active",notes:null}]
async function fixture(page:Page) {
 await page.route("**/api/erp/me",route=>route.fulfill({json:{tenant:{id:tenant,legalName:"Empresa teste"},permissions:["catalog.parties.read","catalog.parties.manage","catalog.products.read","catalog.products.manage","catalog.references.read","catalog.references.manage"]}}))
 await page.route(/\/api\/erp\/product-categories\?/,route=>route.fulfill({json:{tenantId:tenant,canEdit:true,total:3,data:categories}}))
 await page.route(`**/api/erp/product-categories/${root}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:categories[0]}}))
}
test.beforeEach(async({context})=>{await installFrontendFixture(context)})

test("pessoas preservam filtros e página ao abrir e voltar de um cadastro",async({page})=>{
 await fixture(page)
 const party={id:record,revision:1,personType:"juridica",legalName:"Fornecedor teste",tradeName:null,taxId:"04252011000110",email:null,phone:null,isCustomer:false,isSupplier:true,status:"active",addresses:[],contacts:[],fiscal:null}
 const queries:string[]=[]
 await page.route(/\/api\/erp\/parties\?/,route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{tenantId:tenant,canEdit:true,total:60,data:[party]}})})
 await page.route(`**/api/erp/parties/${record}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:party}}))
 await page.goto("/cadastros/clientes-fornecedores?q=teste&role=supplier&status=active&offset=25")
 await expect(page.getByLabel("Buscar nome ou documento")).toHaveValue("teste")
 await expect(page.getByRole("combobox",{name:"Relacionamento",exact:true})).toHaveValue("supplier")
 await expect.poll(()=>queries.some(q=>new URLSearchParams(q).get("offset")==="25")).toBe(true)
 await page.getByRole("link",{name:"Fornecedor teste",exact:true}).click()
 await page.getByRole("link",{name:"Voltar às pessoas",exact:true}).click()
 await expect(page.getByLabel("Buscar nome ou documento")).toHaveValue("teste")
 expect(new URL(page.url()).searchParams.get("offset")).toBe("25")
})

for(const width of [320,360,393,1280]) test(`categorias mostram hierarquia sem rolagem horizontal em ${width}px`,async({page},info)=>{
 await fixture(page);await page.setViewportSize({width,height:852})
 await page.goto("/cadastros/categorias-produtos")
 await expect(page.getByText("Premium / Pro",{exact:true})).toBeVisible()
 const region=page.getByRole("region",{name:"Lista de Categorias de produtos",exact:true})
 expect(await region.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await page.locator("main form").first().evaluate(form => {
   const bounds = form.getBoundingClientRect()
   return Array.from(form.querySelectorAll("input, select, button")).every(control => {
    const rect = control.getBoundingClientRect()
    return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
   })
  })).toBe(true)
 await page.screenshot({path:info.outputPath(`registry-categories-${width}.png`),fullPage:true})
})

test("seleção de categoria superior exclui a própria categoria e seus descendentes",async({page})=>{
 await fixture(page)
 await page.goto(`/cadastros/categorias-produtos/${root}/editar`)
 const select=page.getByRole("combobox",{name:"Categoria superior",exact:true})
 await expect(select).toBeEnabled()
 await expect(select.getByRole("option",{name:"Core",exact:true})).toHaveCount(1)
 await expect(select.locator(`option[value="${child}"]`)).toHaveCount(0)
 await expect(select.locator(`option[value="${root}"]`)).toHaveCount(0)
})

test("produto mostra o caminho completo da categoria sem gravar alterações",async({page})=>{
 await fixture(page)
 const writes:string[]=[]
 await page.route(`**/api/erp/products/${record}`,route=>{if(route.request().method()!=="GET")writes.push(route.request().method());return route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:{id:record,revision:1,sku:"LD-B001",name:"Equipamento teste",unit:"UN",basePrice:"100.00",ncm:"95069100",cest:null,status:"active",categoryId:child,structureColors:[],upholsteryColors:[],plateHolderTypes:[],plateHolderColors:[],hasPhoto:false,photoUrl:null,upholsteryConfigurable:true}}})})
 await page.goto(`/cadastros/produtos/${record}/editar`)
 await expect(page.getByRole("combobox",{name:"Categoria",exact:true}).getByRole("option",{name:"Premium / Pro",exact:true})).toHaveCount(1)
 expect(writes).toEqual([])
})

test("busca automática mantém foco e espaço entre palavras e aceita busca repetida",async({page})=>{
 await fixture(page)
 const queries:string[]=[]
 await page.route(/\/api\/erp\/parties\?/,route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{tenantId:tenant,canEdit:true,total:0,data:[]}})})
 await page.goto("/cadastros/clientes-fornecedores")
 const input=page.getByLabel("Buscar nome ou documento")
 await input.fill("teste ")
 await expect.poll(()=>queries.some(q=>new URLSearchParams(q).get("q")==="teste")).toBe(true)
 await expect(input).toBeFocused();await expect(input).toHaveValue("teste ")
 await input.press("End");await input.pressSequentially("LTDA")
 await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("teste LTDA")
 await expect(input).toBeFocused()
 const count=queries.length
 await page.getByRole("button",{name:"Buscar",exact:true}).click()
 await expect.poll(()=>queries.length).toBeGreaterThan(count)
 await expect(page.getByRole("button",{name:"Buscar",exact:true})).toBeEnabled()
})

test("mudar natureza financeira pede uma nova categoria superior compatível",async({page})=>{
 await fixture(page)
 const rows=categories.map(row=>({...row,direction:row.id===sibling?"expense":"income"}))
 await page.route(/\/api\/erp\/financial-categories\?/,route=>route.fulfill({json:{tenantId:tenant,canEdit:true,total:3,data:rows}}))
 await page.route(`**/api/erp/financial-categories/${child}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:rows[1]}}))
 await page.goto(`/cadastros/categorias-financeiras/${child}/editar`)
 const parent=page.getByRole("combobox",{name:"Categoria superior",exact:true})
 await expect(parent).toHaveValue(root)
 await page.getByRole("combobox",{name:"Natureza",exact:true}).selectOption("expense")
 await expect(parent).toHaveValue("")
 await expect(parent.locator(`option[value="${root}"]`)).toHaveCount(0)
 await expect(parent.locator(`option[value="${sibling}"]`)).toHaveCount(1)
})

test("falha nas categorias preserva o vínculo do produto e oferece nova consulta",async({page})=>{
 await fixture(page)
 await page.route(/\/api\/erp\/product-categories\?/,route=>route.fulfill({status:503,json:{title:"Indisponível"}}))
 await page.route(`**/api/erp/products/${record}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:{id:record,revision:1,sku:"TEST-1",name:"Produto preservado",unit:"UN",basePrice:"100.00",ncm:null,cest:null,status:"active",categoryId:child,structureColors:[],upholsteryColors:[],plateHolderTypes:[],plateHolderColors:[],hasPhoto:false,photoUrl:null}}}))
 await page.goto(`/cadastros/produtos/${record}/editar`)
 const select=page.getByRole("combobox",{name:"Categoria",exact:true})
 await expect(select).toBeDisabled();await expect(select).toHaveValue(child)
 await expect(page.getByRole("button",{name:"Atualizar categorias",exact:true})).toBeVisible()
 await expect(page.getByRole("textbox",{name:"Nome do produto",exact:true})).toHaveValue("Produto preservado")
})

test("equipe preserva filtros na URL e protege edição ao navegar",async({page})=>{
 await fixture(page)
 const staff={id:record,revision:1,name:"Pessoa da equipe",code:"LUD-001",jobTitle:"Vendedor",email:null,phone:null,isEmployee:true,isSeller:true,status:"active",profile:{}}
 await page.route(/\/api\/erp\/staff\?/,route=>route.fulfill({json:{tenantId:tenant,canEdit:true,total:30,data:[staff]}}))
 await page.route(`**/api/erp/staff/${record}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:staff}}))
 await page.goto("/cadastros/funcionarios?q=equipe&status=active&offset=25")
 await expect(page.getByLabel("Buscar nome, código ou cargo")).toHaveValue("equipe")
 await page.getByRole("link",{name:"Pessoa da equipe",exact:true}).click()
 await expect(page).toHaveURL(new RegExp(`/cadastros/funcionarios/${record}(?:\\?|$)`))
 await expect(page.getByRole("heading",{name:"Pessoa da equipe",exact:true})).toBeVisible()
 await page.goBack()
 await expect(page.getByLabel("Buscar nome, código ou cargo")).toHaveValue("equipe")
 await page.goto(`/cadastros/funcionarios/${record}/editar`)
 await page.getByRole("textbox",{name:"Nome",exact:true}).fill("Edição pendente")
 page.once("dialog",dialog=>dialog.dismiss())
 await page.getByRole("link",{name:"Voltar à listagem",exact:true}).click()
 await expect(page).toHaveURL(/\/editar$/)
 let confirmations=0
 page.on("dialog",dialog=>{confirmations++;return dialog.accept()})
 await page.getByRole("link",{name:"Voltar à listagem",exact:true}).click()
 await expect(page).toHaveURL(/\/cadastros\/funcionarios$/)
 expect(confirmations).toBe(1)
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.includes("staff-draft")))).toEqual([])
})

for (const kind of ["reference", "party", "staff"] as const) test(`gravação conserva a lista filtrada de origem: ${kind}`, async ({ page }) => {
 await fixture(page)
 const list = kind === "reference" ? "/cadastros/categorias-produtos" : kind === "party" ? "/cadastros/clientes-fornecedores" : "/cadastros/funcionarios"
 const target = list + "?q=teste&status=active&offset=25"
 const editor = kind === "reference" ? `${list}/${root}/editar` : `${list}/novo`
 if (kind === "reference") {
  let current = categories[0]
  await page.route(`**/api/erp/product-categories/${root}`, route => {
   if (route.request().method() === "PUT") current = { ...current, ...route.request().postDataJSON(), revision: 2 }
   return route.fulfill({ headers: { ETag: `"${current.revision}"` }, json: { tenantId: tenant, canEdit: true, data: current } })
  })
 } else if (kind === "party") {
  const party = { id: record, revision: 1, personType: "juridica", legalName: "Nova pessoa", tradeName: null, taxId: "04252011000110", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [], fiscal: null }
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 60, data: [party] } }))
  await page.route("**/api/erp/parties", route => route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: party } }))
  await page.route(`**/api/erp/parties/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: party } }))
 } else {
  const staff = { id: record, revision: 1, name: "Nova pessoa", code: "LUD-TEST", jobTitle: "Vendedor", email: null, phone: null, isEmployee: true, isSeller: true, status: "active", profile: {} }
  await page.route(/\/api\/erp\/staff\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 60, data: [staff] } }))
  await page.route("**/api/erp/staff", route => route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: staff } }))
  await page.route(`**/api/erp/staff/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: staff } }))
 }
 await page.goto(editor + "?" + new URLSearchParams({ returnTo: target }))
 if (kind === "party") {
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill("04252011000110")
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Nova pessoa")
 } else {
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Nova pessoa")
  if (kind === "staff") await page.getByRole("textbox", { name: "Código", exact: true }).fill("LUD-TEST")
 }
 await page.getByRole("button", { name: kind === "party" ? "Salvar pessoa" : "Salvar cadastro", exact: true }).click()
 await expect(page).toHaveURL(new RegExp(`${list}/${kind === "reference" ? root : record}(?:\\?|$)`))
 expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target)
 await page.getByRole("link", { name: kind === "party" ? "Voltar às pessoas" : "Voltar à listagem", exact: true }).click()
 await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(target)
})
