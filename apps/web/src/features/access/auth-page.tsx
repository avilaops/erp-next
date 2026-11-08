import Image from "next/image"
import { ArrowRight } from "lucide-react"
import EntryContent from "@/content/entry/entrar.mdx"
import { PageTitle } from "@/components/workspace/page-title"

type AuthPageProps = {
  loginHref: string
  ready: boolean
  error?: string
}

function AccessActions({ loginHref, ready, error }: AuthPageProps) {
  const signupHref = loginHref + "&intent=signup"

  return (
    <div className="entry-access">
      <p className="entry-access-label">Acesse com sua conta Ávila Ops</p>
      {ready ? (
        <div className="entry-actions">
          <a className="entry-button" href={loginHref} aria-describedby={error ? "access-error" : undefined}>Entrar <ArrowRight aria-hidden="true" size={16} /></a>
          <a className="entry-button entry-button-secondary" href={signupHref}>Criar minha conta</a>
        </div>
      ) : (
        <p role="status">Acesso temporariamente indisponível. Fale com o responsável pelo ERP na sua empresa.</p>
      )}
      <p className="entry-access-note">O acesso continua no login da Ávila Ops. Recebeu um convite? Use o e-mail convidado.</p>
    </div>
  )
}

export function AuthPage({ loginHref, ready, error }: AuthPageProps) {
  const accessActions = <AccessActions loginHref={loginHref} ready={ready} error={error} />
  if (error) {
    return (
      <div className="entry-page entry-recovery">
        <main className="entry-recovery-content">
          <PageTitle>Retome o acesso</PageTitle>
          <p id="access-error" role="alert">{error}</p>
          {accessActions}
        </main>
      </div>
    )
  }

  return (
    <div className="entry-page">
      <a className="entry-skip" href="#conteudo">Pular para o conteúdo</a>
      <header className="entry-header entry-container">
        <a className="entry-brand" href="#inicio" aria-label="Avila ERP: início">
          <Image src="/brand/avila-erp-symbol.svg" alt="" width={34} height={34} />
          <span>Avila ERP<small>por Ávila Ops</small></span>
        </a>
        <nav aria-label="Navegação da apresentação">
          <a href="#quem-somos">Quem somos</a>
          <a href="#como-comecar">Como começar</a>
          <a href="#acessar">Entrar <ArrowRight aria-hidden="true" size={14} /></a>
        </nav>
      </header>
      <main id="conteudo">
        <EntryContent accessActions={accessActions} />
      </main>
      <footer className="entry-footer entry-container">
        <span>Avila ERP · Um produto Ávila Ops</span>
        <a href="#inicio">Voltar ao início ↑</a>
      </footer>
    </div>
  )
}
