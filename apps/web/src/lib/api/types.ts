import type { components, paths } from "./generated"

export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name]
export type ApiPath = keyof paths
export type Operation<Path extends ApiPath, Method extends keyof paths[Path]> = NonNullable<paths[Path][Method]>
export type JsonBody<Path extends ApiPath, Method extends keyof paths[Path]> =
  Operation<Path, Method> extends { requestBody?: { content: { "application/json": infer Body } } } ? Body : never
export type JsonReply<Path extends ApiPath, Method extends keyof paths[Path], Status extends number = 200> =
  Operation<Path, Method> extends { responses: infer Replies }
    ? Status extends keyof Replies
      ? Replies[Status] extends { content: { "application/json": infer Body } } ? Body : never
      : never
    : never
