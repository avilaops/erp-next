import { forwardCatalogMedia } from "@/server/bff/catalog-media-proxy"
type Context = { params: Promise<{ id: string; mediaId: string }> }
export const GET = async (request: Request, { params }: Context) => { const { id, mediaId } = await params; return forwardCatalogMedia(request, id, mediaId) }
