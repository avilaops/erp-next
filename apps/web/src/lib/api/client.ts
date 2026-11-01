import type { ApiPath, JsonBody, JsonReply } from "./types"

export function erpFetch(resource: string, init: RequestInit = {}): Promise<Response> {
  if (!resource.startsWith("/api/erp/") || resource.includes("\\") || resource.includes("#")) {
    return Promise.reject(new Error("Recurso do ERP inválido"))
  }
  return fetch(resource, { cache: "no-store", ...init, credentials: "same-origin" })
}

export async function readApi<Path extends ApiPath>(
  path: Path, signal?: AbortSignal,
): Promise<{ data: JsonReply<Path, "get" & keyof import("./generated").paths[Path]>; etag: string }> {
  const response = await erpFetch(path.replace("/api/v1/", "/api/erp/"), { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.title || "Consulta indisponível")
  return { data, etag: response.headers.get("etag") || "" }
}

export type CompanyUpdate = JsonBody<"/api/v1/company", "put">
