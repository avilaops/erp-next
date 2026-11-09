"use client"
import { PageTitle } from "@/components/workspace/page-title"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { normalizedProfile, type TaxProfile } from "@/features/fiscal/settings/tax-profile-model"
import { LineTaxRulesEditor } from "@/features/fiscal/settings/line-tax-rules"
import { TaxProfileDefaultFields } from "@/features/fiscal/settings/tax-profile-default-fields"
export type Section = "products" | "parties" | "contact-types" | "tax-profiles"
type Data = {
  requireNcm?: boolean
  requireCest?: boolean
  upholsteryConfigurable?: boolean
  requireEmail?: boolean
  requirePhone?: boolean
  labels?: string[]
  profiles?: TaxProfile[]
}
type Snapshot = { tenantId: string; revision: number; canEdit: boolean; data: Data }
const titles: Record<Section, string> = {
  products: "Configurações de produtos",
  parties: "Configurações de clientes e fornecedores",
  "contact-types": "Tipos de contatos",
  "tax-profiles": "Perfis tributários"
}
const fields = {
  products: [
    ["requireNcm", "Exigir NCM no cadastro de produtos"],
    ["requireCest", "Exigir CEST no cadastro de produtos"],
    ["upholsteryConfigurable", "Permitir escolha de cor do estofado"]
  ],
  parties: [
    ["requireEmail", "Exigir e-mail de clientes e fornecedores"],
    ["requirePhone", "Exigir telefone de clientes e fornecedores"]
  ]
} as const
export function RegistrationSettings({ section }: { section: Section }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [data, setData] = useState<Data>({}),
    [etag, setEtag] = useState(""),
    [baseline, setBaseline] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [blocked, setBlocked] = useState(false),
    [reload, setReload] = useState(0)
  const pending = useRef(false),
    dirty = !!snapshot && JSON.stringify(data) !== baseline
  useEffect(() => {
    const controller = new AbortController()
    erpFetch(`/api/erp/registration-settings/${section}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!response.ok) throw Error(value.title || "Não foi possível carregar as configurações")
        const tag = response.headers.get("etag")
        if (!tag) throw Error("Resposta sem revisão")
        if (!controller.signal.aborted) {
          setSnapshot(value)
          setData(value.data)
          setBaseline(JSON.stringify(value.data))
          setEtag(tag)
          setBlocked(false)
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [section, reload])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || pending.current || blocked) return
    pending.current = true
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const response = await erpFetch(`/api/erp/registration-settings/${section}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag },
        body: JSON.stringify(section === "tax-profiles" ? { ...data, profiles: data.profiles?.map(normalizedProfile) } : data)
      })
      const value = await response.json()
      if (!response.ok) {
        if ([401, 403, 409, 412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw Error(value.title || "Não foi possível salvar")
      }
      const tag = response.headers.get("etag")
      if (!tag) {
        setBlocked(true)
        throw Error("Recarregue para confirmar a gravação")
      }
      setSnapshot(value)
      setData(value.data)
      setBaseline(JSON.stringify(value.data))
      setEtag(tag)
      setNotice("Configurações salvas para esta empresa.")
    } catch (reason) {
      if (reason instanceof TypeError) setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Falha ao salvar")
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  function profile(index: number, patch: Partial<TaxProfile>) {
    setData({
      ...data,
      profiles: data.profiles?.map((value, i) => (i === index ? { ...value, ...patch } : value))
    })
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 pb-28 pt-8">
      <header>
        <Link href="/preferencias?categoria=cadastros" className="text-sm text-primary underline">
          Preferências / Cadastros
        </Link>
        <PageTitle className="mt-3 text-3xl font-semibold">{titles[section]}</PageTitle>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!snapshot && !error && <p role="status">Carregando configurações…</p>}
      {snapshot && (
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={!snapshot.canEdit || saving || blocked} className="space-y-5">
            {(section === "products" || section === "parties") && (
              <>
                <p className="text-sm text-muted-foreground">
                  As exigências serão verificadas ao salvar cadastros novos ou editar os existentes. Os dados
                  atuais são preservados.
                </p>
                {fields[section].map(([key, label]) => (
                  <label key={key} className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={key === "upholsteryConfigurable" ? data[key] !== false : !!data[key]}
                      onChange={(event) => setData({ ...data, [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </>
            )}
            {section === "contact-types" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Cadastre áreas ou cargos sugeridos nos contatos adicionais de clientes e fornecedores.
                  Textos já cadastrados são preservados.
                </p>
                {data.labels?.map((label, index) => (
                  <div className="flex gap-2" key={index}>
                    <Input
                      aria-label={`Tipo de contato ${index + 1}`}
                      required
                      maxLength={80}
                      value={label}
                      onChange={(event) =>
                        setData({
                          ...data,
                          labels: data.labels?.map((v, i) => (i === index ? event.target.value : v))
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setData({ ...data, labels: data.labels?.filter((_, i) => i !== index) })}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={(data.labels?.length || 0) >= 30}
                  onClick={() => setData({ ...data, labels: [...(data.labels || []), ""] })}
                >
                  Adicionar tipo de contato
                </Button>
              </>
            )}
            {section === "tax-profiles" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Perfis preenchem a natureza da operação, PIS, COFINS, CST IBS/CBS e cClassTrib no rascunho
                  da NF-e. CFOP, origem, CST dos demais tributos e alíquotas restantes devem ser revisados em
                  cada operação.
                </p>
                {!data.profiles?.length && <p>Nenhum perfil tributário cadastrado nesta empresa.</p>}
                {data.profiles?.map((value, index) => (
                  <fieldset className="form-section grid gap-4 sm:grid-cols-2" key={index}>
                    <legend className="px-2 font-semibold">Perfil {index + 1}</legend>
                    {(
                      [
                        ["name", "Nome do perfil", 80],
                        ["operationNature", "Natureza da operação", 60],
                        ["pisRate", "PIS (%)", 7],
                        ["cofinsRate", "COFINS (%)", 7],
                        ["ibsCbsCst", "CST IBS/CBS", 3],
                        ["classCode", "cClassTrib", 6]
                      ] as const
                    ).map(([key, label, max]) => (
                      <label className="space-y-2 text-sm" key={key}>
                        {label}
                        <Input
                          required
                          aria-label={`Perfil ${index + 1}: ${label}`}
                          maxLength={max}
                          inputMode={key === "name" || key === "operationNature" ? "text" : "decimal"}
                          pattern={
                            key === "ibsCbsCst"
                              ? "[0-9]{3}"
                              : key === "classCode"
                                ? "[0-9]{6}"
                                : key.endsWith("Rate")
                                  ? "[0-9]{1,2}([.][0-9]{1,4})?"
                                  : undefined
                          }
                          value={value[key]}
                          onChange={(event) =>
                            profile(index, {
                              [key]: key.endsWith("Rate")
                                ? event.target.value.replace(",", ".")
                                : event.target.value
                            })
                          }
                        />
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={value.active}
                        onChange={(event) => profile(index, { active: event.target.checked })}
                      />
                      Perfil ativo
                    </label>
                    <LineTaxRulesEditor value={value} index={index + 1} update={patch => profile(index, patch)} />
                    <TaxProfileDefaultFields index={index} value={value.defaults ?? {}} onChange={defaults => profile(index, { defaults })} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setData({ ...data, profiles: data.profiles?.filter((_, i) => i !== index) })
                      }
                    >
                      Remover perfil
                    </Button>
                  </fieldset>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={(data.profiles?.length || 0) >= 30}
                  onClick={() =>
                    setData({
                      ...data,
                      profiles: [
                        ...(data.profiles || []),
                        {
                          name: "",
                          operationNature: "",
                          pisRate: "",
                          cofinsRate: "",
                          ibsCbsCst: "",
                          classCode: "",
                          active: true
                        }
                      ]
                    })
                  }
                >
                  Adicionar perfil tributário
                </Button>
              </>
            )}
          </fieldset>
          {!snapshot.canEdit && <p>Seu acesso permite apenas consultar estas configurações.</p>}
          <Button type="submit" disabled={!snapshot.canEdit || saving || blocked || !dirty}>
            {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
          {dirty && <p className="text-sm text-muted-foreground">Alterações ainda não salvas.</p>}
        </form>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={saving}
        onClick={() => {
          if (!dirty || window.confirm("Descartar a edição e carregar os dados do servidor?")) {
            setSnapshot(null)
            setError("")
            setNotice("")
            setReload((v) => v + 1)
          }
        }}
      >
        Recarregar dados
      </Button>
    </main>
  )
}
