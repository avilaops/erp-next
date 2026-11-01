"use client"

import { useState } from "react"
import { Orders } from "@/features/operations/orders"
import { Button } from "@/components/ui/button"

export function HelpOrders() {
  const [opened, setOpened] = useState(false)
  if (!opened) return <Button type="button" onClick={() => setOpened(true)}>Criar rascunho neste guia</Button>
  return <section className="mt-5 rounded-xl border p-4" aria-label="Criar pedido pelo guia">
    <p className="mb-4 text-sm">Este é o formulário operacional do ERP. Salvar cria um pedido real na empresa ativa; confira os dados antes de confirmar.</p>
    <Orders create />
  </section>
}
