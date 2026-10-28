import { connection } from "next/server"
import Link from "next/link"
import { currentSession } from "@/lib/erp-session"
import { PageHeader } from "@/components/page-header"
import { Orders } from "./orders"
import { Receivables } from "./receivables"

export async function OperationsAccess({ area, id, create = false, edit = false }: { area: "orders" | "receivables"; id?: string; create?: boolean; edit?: boolean }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  const title = area === "orders" ? "Pedidos de venda" : "Contas a receber"
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!session ? <><PageHeader eyebrow={area === "orders" ? "Vendas" : "Financeiro"} title={title} description="Operações da empresa ativa." /><section className="form-section space-y-3"><p role="status">{configured ? "Entre para acessar as operações da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>{configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}</section></> : area === "orders" ? <Orders id={id} create={create} edit={edit} /> : <Receivables id={id} />}
  </div>
}
