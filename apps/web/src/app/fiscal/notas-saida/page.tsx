import { NfeDrafts } from "@/features/fiscal/nfe-drafts"
import { IssuedNfes } from "@/features/fiscal/issued-nfes"

export default function Page() {
  return <main className="space-y-8">
    <NfeDrafts />
    <div className="mx-auto max-w-6xl px-4 pb-24 lg:px-6">
      <IssuedNfes />
    </div>
  </main>
}

export const metadata = { title: "NF-e de saída" }
