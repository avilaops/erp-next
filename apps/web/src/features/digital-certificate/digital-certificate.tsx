"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { FileKey2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"

type CertificateState = { certificateVerified: boolean; data: { certificateReference: string } | null }

export function DigitalCertificate() {
  const [certificate, setCertificate] = useState<CertificateState | null>(null)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/erp/fiscal/config", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar o certificado")
      if (!controller.signal.aborted) { setCertificate(value); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [reload])
  return <div className="mx-auto max-w-4xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header><p className="text-sm text-primary">Preferências / Fiscal</p><h1 className="mt-2 text-3xl font-semibold">Certificado digital A1</h1></header>
    <section className="form-section space-y-4"><FileKey2 className="size-7 text-primary" />
      {!certificate && !error && <p role="status">Consultando a configuração da empresa…</p>}
      {certificate && <><h2 className="text-lg font-semibold">{certificate.certificateVerified ? "Certificado verificado" : "Certificado não verificado"}</h2><p className="text-sm">Referência cadastrada: {certificate.data?.certificateReference || "Nenhuma"}.</p></>}
      <p className="text-sm text-muted-foreground">A conexão e a validação do arquivo A1 ainda não estão disponíveis no ERP. Uma referência cadastrada não comprova a instalação, a validade ou a autorização para emissão.</p>
      <p className="text-sm text-muted-foreground">Não é necessário informar a senha ou enviar o certificado para importar um XML recebido ou gerar o DANFE de um XML já autorizado.</p>
      <div className="flex flex-wrap gap-3"><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal">Configurações fiscais</Link><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/monitor">Notas recebidas</Link></div>
    </section>
    {error && <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Tentar novamente</Button><Link className="ml-3 text-sm text-primary underline" href="/entrar">Entrar no ERP</Link></div>}
  </div>
}
