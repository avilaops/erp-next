import { DataTable } from "@/components/workspace/data-table"
import Image from "next/image"
import { ProductThumbnail } from "@/features/catalog/product-thumbnail"
import type { Schema } from "@/lib/api/types"
import { commercialMoney, commercialQuantity } from "./order-presentation"

export type ProposalIssuer = { legalName: string; tradeName?: string | null; taxId?: string | null; email?: string | null; phone?: string | null; logoDataUrl?: string | null }
const labels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceita", rejected: "Rejeitada", cancelled: "Cancelada", expired: "Expirada", superseded: "Substituída" }
function date(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

export function ProposalDocument({ snapshot, issuer, issuerName }: { snapshot: Schema<"ProposalSnapshot">; issuer?: ProposalIssuer; issuerName?: string }) {
  const { data, items } = snapshot
  const name = issuer?.legalName || issuerName
  const status = data.expired ? "expired" : data.status
  return <article data-proposal-document className="proposal-document" aria-label={`Proposta comercial ${data.number}`}>
    <header className="proposal-document-header">
      <div className="proposal-issuer">
        {issuer?.logoDataUrl && /^data:image\/(png|jpeg|webp);base64,/.test(issuer.logoDataUrl) && <Image unoptimized className="proposal-company-logo" src={issuer.logoDataUrl} alt="Logo da empresa" width={1024} height={1024} />}
        {name && <p className="proposal-issuer-name">{name}</p>}
        {issuer?.tradeName && issuer.tradeName !== name && <p>{issuer.tradeName}</p>}
        {issuer?.taxId && <p>CPF/CNPJ: {issuer.taxId}</p>}
        {issuer?.email && <p>{issuer.email}</p>}{issuer?.phone && <p>{issuer.phone}</p>}
      </div>
      <div className="proposal-document-title"><h2>Proposta comercial</h2><p className="proposal-number">Nº {data.number}</p><p>Versão {data.version} · {labels[status] || status}</p></div>
    </header>
    <div className="proposal-parties">
      <section><h3>Cliente</h3><p className="proposal-customer-name">{data.customerName}</p>{data.customerTaxId && <p className="proposal-aux">CPF/CNPJ: {data.customerTaxId}</p>}</section>
      <dl className="proposal-dates">{data.createdAt && <div><dt>Emissão</dt><dd>{date(data.createdAt)}</dd></div>}<div><dt>Validade</dt><dd>{date(data.validUntil)}</dd></div></dl>
    </div>
    <section className="proposal-items" aria-label="Itens da proposta"><DataTable className="proposal-items-table">
      <caption className="sr-only">Itens da proposta</caption><colgroup><col className="proposal-product-column" /><col className="proposal-quantity-column" /><col className="proposal-unit-price-column" /><col /></colgroup>
      <thead><tr><th scope="col">Produto</th><th scope="col" className="proposal-quantity-column">Quantidade</th><th scope="col" className="proposal-unit-price-column">Unitário</th><th scope="col">Total</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.productId}>
        <td><div className="proposal-product-identity flex flex-col gap-2 sm:flex-row">
          <ProductThumbnail key={`${snapshot.tenantId}:${item.productId}`} id={item.productId} name={item.name} tenantId={snapshot.tenantId} eager />
          <div className="min-w-0"><p className="proposal-item-name">{item.name}</p><p className="proposal-aux">{item.sku}</p><p className="proposal-mobile-pricing proposal-aux"><span>Qtd. {commercialQuantity(item.quantity)} {item.unit}</span><span>Unit. {commercialMoney(item.unitPrice)}</span></p><p className="proposal-aux">{[item.structureColor && `Estrutura: ${item.structureColor}`, `Tipo de anilheiro: ${item.plateHolderType || "Não se aplica"}`, item.upholsteryColor && `Estofado: ${item.upholsteryColor}`].filter(Boolean).join(" · ")}</p></div>
        </div></td>
        <td className="proposal-quantity-column">{commercialQuantity(item.quantity)} {item.unit}</td><td className="proposal-unit-price-column">{commercialMoney(item.unitPrice)}</td><td>{commercialMoney(item.amount)}</td>
      </tr>)}</tbody>
    </DataTable></section>
    <div className="proposal-total"><p>Total: {commercialMoney(data.amount)}</p></div>
    <div className="proposal-conditions">
      {data.paymentTerms && <section><h3>Pagamento</h3><p>{data.paymentTerms}</p></section>}
      {data.deliveryTerms && <section><h3>Entrega</h3><p>{data.deliveryTerms}</p></section>}
      {data.notes && <section className="proposal-notes"><h3>Observações</h3><p>{data.notes}</p></section>}
    </div>
    {!data.isCurrent && <p className="proposal-history">Versão histórica · versão {data.version}</p>}
  </article>
}
