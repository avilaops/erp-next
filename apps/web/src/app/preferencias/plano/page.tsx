import { redirect } from "next/navigation"

export default function Page() {
  redirect("/preferencias/empresa/conta/plano")
}

export const metadata = { title: "Plano e limites" }
