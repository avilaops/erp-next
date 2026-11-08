"use client"

import Link from "next/link"

export default function GlobalError({ retry }: { retry: () => void }) {
  return <html lang="pt-BR"><body style={{ fontFamily: "system-ui, sans-serif", fontSize: 14, margin: "2rem", lineHeight: 1.6 }}>
    <title>Falha ao abrir o ERP · Avila Ops</title>
    <main role="alert"><h1 style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.45 }}>Não foi possível abrir o ERP</h1>
      <p>Tente novamente. Se houve uma gravação em andamento, confira o registro antes de repetir a operação.</p>
      <button type="button" onClick={retry} style={{ font: "inherit", minHeight: 44, padding: "0.5rem 1rem", marginRight: "1rem" }}>Tentar novamente</button>
      <Link href="/" prefetch={false}>Voltar ao início</Link>
    </main>
  </body></html>
}
