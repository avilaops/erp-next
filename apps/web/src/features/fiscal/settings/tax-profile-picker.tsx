"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { erpFetch } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import type { TaxProfile, FiscalScenario } from "./tax-profile-model"
export function TaxProfilePicker({
  tenant,
  onApply
}: {
  tenant: string
  onApply: (profile: TaxProfile, revision: number, scenario?: FiscalScenario) => void
}) {
  const [profiles, setProfiles] = useState<TaxProfile[]>([]),
    [selected, setSelected] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0)
  const [scenario, setScenario] = useState<FiscalScenario | "">("")
  useEffect(() => {
    const controller = new AbortController()
    erpFetch("/api/erp/registration-settings/tax-profiles", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!response.ok) throw Error(value.title || "Não foi possível carregar os perfis tributários")
        if (value.tenantId !== tenant) throw Error("A empresa da sessão mudou. Reabra a nota")
        if (!controller.signal.aborted) {
          setProfiles(value.data.profiles.filter((v: TaxProfile) => v.active))
          setRevision(value.revision)
          setSelected("")
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [tenant, reload])
  return (
    <section className="form-section space-y-3" aria-label="Perfil tributário">
      <h2 className="font-semibold">Perfil tributário</h2>
      <p className="text-sm text-muted-foreground">
        Selecione e aplique o perfil. Revise CFOP, origem, CST e as demais alíquotas de cada operação antes de
        salvar.
      </p>
      <label className="grid gap-2 text-sm">
        Perfil cadastrado
        <select
          className="min-h-11 w-full min-w-0 max-w-full rounded-lg border bg-background px-3"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value)
            setNotice("")
          }}
        >
          <option value="">Selecione um perfil</option>
          {profiles.map((profile, index) => (
            <option key={profile.name} value={index}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      {profiles[Number(selected)]?.lineRules && selected !== "" && <label className="grid gap-2 text-sm">Cenário da operação<select className="min-h-10 rounded-lg border bg-background px-3" value={scenario} onChange={e => setScenario(e.target.value as FiscalScenario)}><option value="">Confira origem, destino e contribuinte</option><option value="sameState">Dentro do estado</option><option value="interstateTaxpayer">Contribuinte de outro estado</option><option value="interstateNonTaxpayer">Não contribuinte de outro estado</option></select></label>}
      <Button
        type="button"
        variant="outline"
        disabled={selected === "" || Boolean(profiles[Number(selected)]?.lineRules && !scenario)}
        onClick={() => {
          const profile = profiles[Number(selected)]
          if (
            profile &&
            window.confirm(
              "Aplicar o perfil substitui os campos fiscais declarados nele e os CFOPs do cenário escolhido. Confira o enquadramento antes de salvar. Continuar?"
            )
          ) {
            onApply(profile, revision, scenario || undefined)
            setNotice("Perfil aplicado à edição. Confira os demais campos e salve o rascunho.")
          }
        }}
      >
        Aplicar perfil à nota
      </Button>
      <Link
        href="/preferencias/cadastros/perfis-tributarios"
        className="ml-3 text-sm text-primary underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        Gerenciar perfis
      </Link>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setProfiles([])
          setSelected("")
          setNotice("")
          setError("")
          setReload((v) => v + 1)
        }}
      >
        Atualizar perfis
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  )
}
