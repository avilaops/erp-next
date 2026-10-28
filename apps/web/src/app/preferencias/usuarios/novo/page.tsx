import Link from "next/link"
import { PageHeader } from "@/components/page-header"

export default function NewUserPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><PageHeader eyebrow="Preferências / Usuários" title="Novos usuários" description="O cadastro de identidade pertence ao Auth central." /><section className="form-section space-y-3"><p role="status">O envio de convites ainda depende da integração de provisionamento com o Auth. Nenhum usuário foi criado e nenhum e-mail foi enviado.</p><Link className="text-primary underline" href="/preferencias/usuarios">Voltar aos usuários</Link></section></div>
}
