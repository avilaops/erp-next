import { forwardPosting } from "@/app/api/erp/logistics/postings/route"

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => context.params.then(({ id }) => forwardPosting(request, `/logistics/postings/${id}/packages`))
