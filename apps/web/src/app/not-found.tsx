import Link from "next/link"

export default function NotFound() {
  return <section className="mx-auto max-w-2xl space-y-4 px-4 py-12">
    <title>Página não encontrada · ERP Next · Ávila Ops</title>
    <h1 className="text-3xl font-semibold">Página não encontrada</h1>
    <p>O endereço não existe ou não está disponível. Confira o link ou volte ao início para escolher outra área.</p>
    <Link className="inline-flex min-h-11 items-center font-medium text-primary underline" href="/">Voltar ao início</Link>
  </section>
}
