import { expect, test } from "@playwright/test"

test("preferências expõe os fluxos reais de importação e exportação de produtos", async ({ page }) => {
  await page.goto("/preferencias/dados/importacao")
  await expect(page.getByRole("heading", { name: "Importação de produtos" })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", ".csv,text/csv")

  await page.goto("/preferencias/dados/exportacao")
  await expect(page.getByRole("heading", { name: "Exportação de produtos" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar produtos.csv" })).toBeVisible()
  await expect(page.getByText("Exportação indisponível")).toHaveCount(0)
})

test("catálogo de integrações não apresenta conexões fictícias", async ({ page }) => {
  await page.route("**/api/erp/integrations/service-keys", (route) => route.fulfill({ json: { data: [] } }))
  await page.goto("/preferencias/integracoes")
  await expect(page.getByRole("heading", { name: "Integrações" })).toBeVisible()
  await expect(page.getByText("Configuração pendente")).toBeVisible()
  await expect(page.getByText("Dados simulados")).toHaveCount(0)
})

test("papéis usam nomenclatura de permissões", async ({ page }) => {
  await page.goto("/preferencias/papeis")
  await expect(page.getByRole("heading", { name: "Papéis e permissões" })).toBeVisible()
  await expect(page.getByText("Papéis e horários", { exact: true })).toHaveCount(0)
})
