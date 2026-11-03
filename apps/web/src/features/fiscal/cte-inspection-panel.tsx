import { Button } from "@/components/ui/button"
import { formatCteMoney } from "./cte-inspection-model"
import type { CteInspectionView } from "./cte-inspection-model"

const roles: Record<string, string> = { carrier: "Transportadora", sender: "Remetente", dispatcher: "Expedidor", receiver: "Recebedor", recipient: "Destinatário", taker: "Tomador", authorized_xml: "Autorizado a acessar XML", other: "Outro tomador" }
const modals: Record<string, string> = { "01": "Rodoviário", "02": "Aéreo", "03": "Aquaviário", "04": "Ferroviário", "05": "Dutoviário", "06": "Multimodal" }
const types: Record<string, string> = { "0": "Normal", "1": "Complementar", "3": "Substituição" }

export function CteInspectionPanel({ view, busy, checking, onInspect }: { view: CteInspectionView; busy: boolean; checking: boolean; onInspect: () => void }) {
  const data = view.data?.document
  return <section aria-label="Conferência local do CT-e" className="min-w-0 space-y-4 rounded-lg bg-muted/40 p-4">
    <h4 className="font-semibold">Conferência local do CT-e</h4>
    {!data ? <>
      <p>Nenhuma conferência local registrada.</p>
      {view.canInspect ? <Button disabled={busy} onClick={onInspect}>{checking ? "Conferindo XML…" : "Conferir XML"}</Button> : <p className="text-muted-foreground">Conferência local indisponível nesta empresa. O XML original continua disponível.</p>}
    </> : <>
      <p>Estrutura e assinatura conferidas localmente · CT-e {data.schemaVersion} · {types[data.documentType]} · {modals[data.modal]}.</p>
      <p className="text-muted-foreground">Confiança do certificado, autenticidade do protocolo e situação fiscal atual não verificadas.</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted-foreground">Transportadora</dt><dd className="break-words"><span className="block">{data.carrier.name || "Nome não informado"}</span><span>{data.carrier.kind} {data.carrier.value}</span></dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Tomador</dt><dd className="break-words"><span className="block">{data.taker.name || "Nome não informado"}</span><span>{data.taker.kind} {data.taker.value} · {roles[data.takerRole]}</span></dd></div>
        <div><dt className="text-muted-foreground">Participação da empresa</dt><dd>{data.companyRoles.map(role => roles[role]).join(" · ")}</dd></div>
        <div><dt className="text-muted-foreground">Número / série</dt><dd>{data.number} / {data.series}</dd></div>
        <div><dt className="text-muted-foreground">Valor da prestação</dt><dd>{formatCteMoney(data.serviceCents)}</dd></div>
        <div><dt className="text-muted-foreground">Valor a receber</dt><dd>{formatCteMoney(data.receivableCents)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Emissão informada</dt><dd className="break-words">{data.issuedAt.replace("T", " ")}</dd></div>
        <div><dt className="text-muted-foreground">Protocolo informado no arquivo</dt><dd className="break-all">{data.protocol.number} · Retorno {data.protocol.code}</dd></div>
        <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Chave CT-e</dt><dd className="break-all">{data.accessKey}</dd></div>
        <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">SHA-256 do XML original</dt><dd className="break-all font-mono text-xs">{view.sourceXmlSha256}</dd></div>
      </dl>
      <details open={data.nfeReferences.length <= 5}><summary className="cursor-pointer">NF-es referenciadas ({data.nfeReferences.length})</summary><ul className="mt-2 space-y-1">{data.nfeReferences.map(key => <li key={key} className="break-all">{key}</li>)}</ul></details>
      {!!data.cteReferences.length && <details open={data.cteReferences.length <= 5}><summary className="cursor-pointer">CT-e referenciados ({data.cteReferences.length})</summary><ul className="mt-2 space-y-1">{data.cteReferences.map(key => <li key={key} className="break-all">{key}</li>)}</ul></details>}
      <p className="text-muted-foreground">Referências do arquivo para conferência. Nenhum vínculo comercial ou lançamento foi criado.</p>
    </>}
  </section>
}
