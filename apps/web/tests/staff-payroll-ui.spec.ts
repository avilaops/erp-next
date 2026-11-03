import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
const rid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const settings={salary:"2500.00",pixType:"email",pixKey:"maria@example.test",recurring:true,businessDay:5,startsOn:"2026-11-01",excludedDates:["2026-11-02"],bank:"",branch:"",account:""}
const request={id:rid,staffId:record,name:"Maria",kind:"settings",payload:settings,baseRevision:0,revision:1,status:"pending",requestedBy:"accountant",createdAt:"2026-11-03T10:00:00Z"}

test.beforeEach(async({context})=>installFrontendFixture(context))
test("aprovação financeira é explícita, mantém o motivo e funciona no celular",async({page})=>{
 let approved=false
 await page.route("**/api/erp/staff-payroll?*",route=>route.fulfill({json:{tenantId:tenant,canEdit:true,canApprove:true,data:[{...request,status:approved?"approved":"pending",revision:approved?2:1}],total:1}}))
 await page.route(`**/api/erp/staff-payroll/requests/${rid}/review`,route=>{expect(route.request().headers()["if-match"]).toBe('"1"');expect(route.request().postDataJSON()).toEqual({approve:true,reason:"Conferido com a empresa"});approved=true;return route.fulfill({headers:{ETag:'"2"'},json:{id:rid,revision:2,status:"approved"}})})
 await page.setViewportSize({width:390,height:844})
 await page.goto("/cadastros/funcionarios/pagamentos")
 await expect(page.getByRole("heading",{name:"Pagamentos da equipe"})).toBeVisible()
 await page.getByLabel("Motivo",{exact:true}).fill("Conferido com a empresa")
 page.once("dialog",dialog=>dialog.accept())
 await page.getByRole("button",{name:"Confirmar decisão"}).click()
 await expect(page.getByText("Aprovado",{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test("perfil de consulta não recebe botão de aprovação e a página preserva estado vazio",async({page})=>{
 await page.route("**/api/erp/staff-payroll?*",route=>route.fulfill({json:{tenantId:tenant,canEdit:false,canApprove:false,data:[request],total:1}}))
 await page.goto("/cadastros/funcionarios/pagamentos")
 await expect(page.getByRole("button",{name:"Confirmar decisão"})).toHaveCount(0)
 await expect(page.getByRole("button",{name:"Gerar contas do mês"})).toHaveCount(0)
 await expect(page.getByText("Aguardando aprovação",{exact:true}).last()).toBeVisible()
})
test("pagamento avulso pede aprovação e o histórico leva ao financeiro",async({page})=>{
 await page.route(`**/api/erp/staff/${record}`,route=>route.fulfill({headers:{ETag:'"1"'},json:{tenantId:tenant,canEdit:true,data:{id:record,revision:1,name:"Maria",code:"EQ-001",jobTitle:"Comercial",email:"maria@example.test",phone:null,isEmployee:true,isSeller:false,status:"active",profile:{}}}}))
 await page.route(`**/api/erp/staff/${record}/payroll`,route=>route.fulfill({json:{tenantId:tenant,staffId:record,name:"Maria",revision:1,canEdit:true,canApprove:false,settings,requests:[],payments:[{id:rid,kind:"one_off",competence:"2026-11-01",category:"Benefício",note:"",dueDate:"2026-11-10",amount:"100.00",paidAmount:"100.00",status:"paid"}]}}))
 await page.route(`**/api/erp/staff/${record}/payroll/requests`,route=>{expect(route.request().postDataJSON()).toEqual({kind:"payment",payment:{amount:"100.00",dueDate:"2026-11-10",category:"Vale-transporte",note:"Novembro"}});return route.fulfill({headers:{ETag:'"1"'},status:201,json:{id:rid,revision:1,status:"pending"}})})
 await page.goto(`/cadastros/funcionarios/${record}`)
 await page.getByRole("tab",{name:"Pagamento avulso"}).click()
 await page.getByLabel("Valor (R$)",{exact:true}).fill("100,00")
 await page.getByLabel("Vencimento",{exact:true}).fill("2026-11-10")
 await page.getByLabel("Categoria",{exact:true}).fill("Vale-transporte")
 await page.getByLabel("Observação",{exact:true}).fill("Novembro")
 await page.getByRole("button",{name:"Solicitar pagamento",exact:true}).click()
 await expect(page.getByRole("tab",{name:"Solicitações"})).toHaveAttribute("aria-selected","true")
 await page.getByRole("tab",{name:"Histórico",exact:true}).click()
 await expect(page.getByRole("link",{name:"Ver pagamentos e estornos"})).toHaveAttribute("href",`/financeiro/contas-pagar/${rid}`)
})
