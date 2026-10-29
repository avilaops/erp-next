"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, FileKey2, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type CertificateStatus = "not_configured" | "active" | "expiring" | "expired" | "not_yet_valid" | "company_mismatch" | "unavailable"
type CertificateSnapshot = {
  tenantId: string; revision: number; canEdit: boolean; uploadAvailable: boolean; companyTaxId: string; status: CertificateStatus
  data: { subject: string; issuer: string; taxId: string; fingerprint: string; serialNumber: string; validFrom: number; validUntil: number; validatedAt: number; chainVerified: boolean; revocationChecked: boolean } | null
}
const maximumFile = 64 * 1024
const statusLabel: Record<CertificateStatus, string> = {
  not_configured: "Nenhum certificado conectado", active: "Certificado conectado", expiring: "Certificado próximo do vencimento", expired: "Certificado vencido",
  not_yet_valid: "Certificado ainda não vigente", company_mismatch: "O certificado pertence a outro CNPJ", unavailable: "Credencial indisponível para uso",
}
const formatDate = (value: number) => new Date(value * 1000).toLocaleString("pt-BR")

export function DigitalCertificate() {
  const [certificate, setCertificate] = useState<CertificateSnapshot | null>(null)
  const [etag, setEtag] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState("")
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [blocked, setBlocked] = useState(false)
  const [reload, setReload] = useState(0)
  const active = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const tenant = useRef("")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/erp/fiscal/certificate", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar o certificado")
      const revision = response.headers.get("etag")
      if (!revision) throw new Error("Não foi possível confirmar a revisão do certificado")
      if (controller.signal.aborted) return
      if (tenant.current && tenant.current !== value.tenantId) {
        setFile(null); setPassword(""); setNotice("")
        if (fileInput.current) fileInput.current.value = ""
      }
      tenant.current = value.tenantId
      setCertificate(value); setEtag(revision); setBlocked(false); setError("")
    }).catch(reason => { if (!controller.signal.aborted) { setCertificate(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])
  useEffect(() => () => active.current?.abort(), [])

  async function save(remove = false) {
    if (!certificate?.canEdit || loading || active.current || blocked || !remove && (!file || !certificate.uploadAvailable)) return
    if (remove && !window.confirm("Remover o certificado armazenado nesta empresa? A remoção não revoga o certificado na autoridade certificadora.")) return
    const controller = new AbortController()
    active.current = controller; setBusy(remove ? "remove" : "upload"); setError(""); setNotice("")
    try {
      let body: string | undefined
      if (!remove && file) {
        if (!/\.(pfx|p12)$/i.test(file.name) || !file.size || file.size > maximumFile) throw new Error("Selecione um arquivo .pfx ou .p12 de até 64 KiB")
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ""
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        body = JSON.stringify({ pkcs12Base64: btoa(binary), password })
        bytes.fill(0)
      }
      const response = await fetch("/api/erp/fiscal/certificate", {
        method: remove ? "DELETE" : "PUT", cache: "no-store", body,
        headers: { "Content-Type": "application/json", "X-Tenant-Id": certificate.tenantId, "If-Match": etag },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
      })
      const value = await response.json()
      if (!response.ok) {
        if ([401, 403, 409, 412].includes(response.status)) setBlocked(true)
        throw new Error(value.title || "Não foi possível confirmar a alteração do certificado")
      }
      const revision = response.headers.get("etag")
      if (!revision || value.tenantId !== certificate.tenantId) throw new Error("Recarregue a tela para confirmar o resultado da operação")
      if (controller.signal.aborted) return
      setCertificate(value); setEtag(revision); setFile(null)
      if (fileInput.current) fileInput.current.value = ""
      setNotice(remove ? "Certificado removido desta empresa." : "Certificado validado e armazenado com criptografia nesta empresa.")
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "Não foi possível confirmar a operação. Atualize a tela antes de repetir")
    } finally {
      active.current = null
      if (!controller.signal.aborted) { setBusy(""); setPassword(""); setVisiblePassword(false) }
    }
  }

  return <main className="mx-auto max-w-4xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div><p className="text-sm text-primary">Preferências / Fiscal</p><h1 className="mt-2 text-3xl font-semibold">Certificado digital A1</h1><p className="mt-2 text-muted-foreground">Conecte o certificado da empresa para preparar suas operações fiscais.</p></div><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal">Configurações fiscais</Link></header>
    {loading && <p role="status">Consultando certificado da empresa…</p>}
    {certificate && <>
      <section className="form-section space-y-4" aria-labelledby="certificate-state-title">
        <h2 id="certificate-state-title" className="flex items-center gap-2 text-lg font-semibold"><FileKey2 className="size-5 text-primary" />{statusLabel[certificate.status]}</h2>
        <p className="text-sm">CNPJ da empresa ativa: <strong>{certificate.companyTaxId}</strong></p>
        {certificate.data && <>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Titular</dt><dd className="break-words">{certificate.data.subject}</dd></div>
            <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Autoridade certificadora</dt><dd className="break-words">{certificate.data.issuer}</dd></div>
            <div><dt className="text-muted-foreground">Válido desde</dt><dd>{formatDate(certificate.data.validFrom)}</dd></div>
            <div><dt className="text-muted-foreground">Válido até</dt><dd>{formatDate(certificate.data.validUntil)}</dd></div>
          </dl>
          {certificate.status === "expiring" && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">O certificado vence em até 30 dias. Providencie a renovação e substitua o arquivo nesta tela.</p>}
          {["expired", "not_yet_valid", "company_mismatch", "unavailable"].includes(certificate.status) && <p role="alert" className="text-sm text-destructive">Este certificado não está disponível para operações fiscais. Confira o CNPJ e a validade ou conecte um novo arquivo.</p>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Dados da verificação</summary><dl className="mt-3 space-y-2"><div><dt>Número de série</dt><dd className="break-all">{certificate.data.serialNumber}</dd></div><div><dt>SHA-256 do certificado</dt><dd className="break-all">{certificate.data.fingerprint}</dd></div><div><dt>Verificado em</dt><dd>{formatDate(certificate.data.validatedAt)}</dd></div></dl><p className="mt-3">Senha, chave privada, CNPJ, validade e cadeia de confiança são conferidos no envio. A situação de revogação não foi consultada.</p></details>
        </>}
        {!certificate.canEdit && <p className="text-sm text-muted-foreground">Seu acesso permite consultar a situação. A conexão e a remoção exigem permissão para gerenciar a configuração fiscal.</p>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy || loading} onClick={() => { setLoading(true); setReload(value => value + 1) }}><RefreshCw className="size-4" />Atualizar situação</Button>{certificate.canEdit && certificate.data && <Button variant="destructive" disabled={!!busy || blocked || loading} onClick={() => void save(true)}><Trash2 className="size-4" />{busy === "remove" ? "Removendo…" : "Remover certificado"}</Button>}</div>
      </section>
      {certificate.canEdit && <section className="form-section space-y-5" aria-labelledby="certificate-upload-title">
        <h2 id="certificate-upload-title" className="flex items-center gap-2 text-lg font-semibold"><Upload className="size-5 text-primary" />{certificate.data ? "Substituir certificado A1" : "Conectar certificado A1"}</h2>
        <p className="text-sm text-muted-foreground">Escolha o arquivo .pfx ou .p12 diretamente. Não é necessário instalar o certificado no Windows. O arquivo deve conter a chave privada e a cadeia da empresa.</p>
        {!certificate.uploadAvailable && <p role="alert" className="rounded-xl border p-4 text-sm">O armazenamento seguro de certificados precisa ser configurado para habilitar o envio.</p>}
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
          <label className="block space-y-2 text-sm">Arquivo do certificado A1<input ref={fileInput} type="file" aria-label="Arquivo do certificado A1" accept=".pfx,.p12,application/x-pkcs12" className="block w-full rounded-xl border p-3" disabled={!!busy || blocked || loading || !certificate.uploadAvailable} onChange={event => { setFile(event.target.files?.[0] || null); setError(""); setNotice("") }} /><span className="block text-xs text-muted-foreground">Até 64 KiB. O CNPJ deve corresponder à empresa ativa.</span></label>
          <div className="space-y-2"><label htmlFor="a1-password" className="text-sm">Senha do certificado</label><div className="flex gap-2"><Input id="a1-password" type={visiblePassword ? "text" : "password"} autoComplete="new-password" maxLength={1024} value={password} disabled={!!busy || blocked || loading || !certificate.uploadAvailable} onChange={event => setPassword(event.target.value)} /><Button type="button" variant="outline" aria-label={visiblePassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visiblePassword} onClick={() => setVisiblePassword(value => !value)}>{visiblePassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div><p className="text-xs text-muted-foreground">Use a senha definida na exportação do arquivo. Deixe vazio apenas se o arquivo foi exportado sem senha.</p></div>
          <Button type="submit" disabled={!file || !!busy || blocked || loading || !certificate.uploadAvailable}><ShieldCheck className="size-4" />{busy === "upload" ? "Validando e protegendo certificado…" : certificate.data ? "Validar e substituir certificado" : "Conectar certificado"}</Button>
        </form>
        <p className="text-xs text-muted-foreground">O arquivo e a senha são armazenados com criptografia por empresa e não ficam disponíveis para download. Conectar o A1 não autoriza a emissão de NF-e, que depende das demais etapas do motor fiscal.</p>
      </section>}
    </>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-primary/30 p-4 text-sm">{notice}</p>}
    {blocked && <Button variant="outline" disabled={!!busy || loading} onClick={() => { setLoading(true); setReload(value => value + 1) }}>Recarregar dados do servidor</Button>}
    {!certificate && !loading && <Button variant="outline" onClick={() => { setLoading(true); setReload(value => value + 1) }}>Tentar novamente</Button>}
    <p className="text-sm text-muted-foreground">Não é necessário certificado para <Link className="text-primary underline" href="/fiscal/monitor">importar um XML recebido</Link> ou <Link className="text-primary underline" href="/fiscal/danfe">gerar o DANFE de um XML já autorizado</Link>.</p>
  </main>
}
