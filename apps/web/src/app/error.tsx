"use client"

import Link from "next/link"

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <section role="alert" className="mx-auto max-w-2xl space-y-4 px-4 py-12">
    <title>Não foi possível abrir esta tela · ERP Next · Ávila Ops</title>
    <h1 className="text-3xl font-semibold">Não foi possível abrir esta tela</h1>
    <p>Tente carregar novamente. Se houve uma gravação em andamento, confira o registro antes de repetir a operação.</p>
    <div className="flex flex-wrap gap-4">
      <button type="button" className="min-h-11 rounded-xl border px-4 py-2" onClick={retry}>Tentar novamente</button>
      <Link className="inline-flex min-h-11 items-center text-primary underline" href="/">Voltar ao início</Link>
    </div>
  </section>
}
