"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react"

export function CompanyPicker() {
  const router = useRouter()
  const [companies, setCompanies] = useState<{ id: string; legalName: string }[]>([])
  const [status, setStatus] = useState("Carregando suas empresas…")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    fetch("/api/erp/companies", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? "Entre novamente para continuar" : "Não foi possível consultar suas empresas")
      const body = await response.json()
      if (active) { setCompanies(body.data); setStatus(body.data.length ? "Selecione a empresa que deseja acessar" : "Você ainda não possui empresas cadastradas") }
    }).catch(error => { if (active) setStatus(error.message) })
    return () => { active = false }
  }, [])
  async function select(tenantId: string) {
    setBusy(true)
    try {
      const response = await fetch("/api/auth/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }) })
      if (!response.ok) throw new Error((await response.json()).title)
      router.push("/preferencias/empresa/dados")
      router.refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Tente novamente"); setBusy(false) }
  }
  return <section className="form-section space-y-4">
    <p role="status">{status}</p>
    {companies.map(company => <button disabled={busy} type="button" className="block rounded-xl border px-4 py-3" key={company.id} onClick={() => select(company.id)}>{company.legalName}</button>)}
    <Link className="inline-block underline" href="/cadastro/empresa">Cadastrar nova empresa</Link>
    <Link className="ml-4 inline-block underline" href="/entrar">Entrar com Ávila Ops</Link>
  </section>
}

const subscribe = () => () => {}

export function CompanySignup() {
  const router = useRouter()
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  // Retain the key across ambiguous network failures; changing the payload gets a new key.
  const command = useRef<{ body: string; key: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setStatus("Salvando cadastro…")
    const values = new FormData(event.currentTarget)
    const data = Object.fromEntries(values)
    const body = JSON.stringify({ ...data, segments: values.getAll("segments") })
    if (!command.current || command.current.body !== body) command.current = { body, key: crypto.randomUUID() }
    try {
      let tenantId = created
      if (!tenantId) {
        const response = await fetch("/api/erp/companies", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key }, body })
        const result = await response.json()
        if (!response.ok) throw new Error([result.title, ...(result.errors || []).map((error: { field: string; message: string }) => `${error.field}: ${error.message}`)].join(". "))
        tenantId = result.tenantId
        setCreated(tenantId)
      }
      const selected = await fetch("/api/auth/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }) })
      if (!selected.ok) throw new Error("Empresa cadastrada. Acesse Suas empresas para selecioná-la")
      router.push("/preferencias/empresa/dados")
      router.refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente"); setBusy(false) }
  }
  const fields = [["legalName", "Nome empresarial"], ["tradeName", "Nome fantasia"], ["taxId", "CPF ou CNPJ"], ["postalCode", "CEP"], ["city", "Cidade"], ["street", "Rua"], ["number", "Número"], ["district", "Bairro"], ["email", "E-mail da empresa"]]
  return <form onSubmit={submit} className="form-section space-y-4">
    <p>Cadastre sua empresa com sua conta Ávila Ops. Você será o administrador desta empresa.</p>
    <fieldset disabled={!hydrated || busy || Boolean(created)} className="grid gap-4 sm:grid-cols-2">
      {fields.map(([name, label]) => <label className="field" key={name}>{label}<input name={name} maxLength={300} type={name === "email" ? "email" : "text"} required={!["tradeName", "email"].includes(name)} /></label>)}
      <label className="field">Tipo de pessoa<select name="personType" defaultValue="juridica"><option value="juridica">Pessoa jurídica</option><option value="fisica">Pessoa física</option></select></label>
      <label className="field">Regime tributário<select name="taxRegime" required defaultValue=""><option value="" disabled>Selecione</option><option value="simples">Simples Nacional</option><option value="presumido">Lucro presumido</option><option value="real">Lucro real</option></select></label>
      <label className="field">UF<select aria-label="UF" name="state" required defaultValue=""><option value="" disabled>Selecione</option>{"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map(state => <option key={state}>{state}</option>)}</select></label>
      <label className="field">Segmento<select aria-label="Segmento" name="segments" required defaultValue=""><option value="" disabled>Selecione</option>{["Comércio", "E-commerce", "Serviços", "Indústria"].map(segment => <option key={segment}>{segment}</option>)}</select></label>
    </fieldset>
    <p role="status" aria-live="polite">{status}</p>
    <button type="submit" disabled={!hydrated || busy} className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">{busy ? "Salvando…" : created ? "Acessar empresa cadastrada" : "Cadastrar empresa"}</button>
    <Link href="/empresas" className="ml-4 underline">Suas empresas</Link>
  </form>
}
