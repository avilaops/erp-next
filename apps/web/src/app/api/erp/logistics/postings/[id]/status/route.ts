import { forwardPosting, validPostingId } from "../../route"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validPostingId(id)) return Response.json({ title: "Identificador de postagem inválido" }, { status: 400 })
  return forwardPosting(request, `/logistics/postings/${id}/status`)
}
