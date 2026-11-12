export const pipelineStages = { new: "Novo", contacted: "Contato feito", proposed: "Proposta enviada", negotiation: "Negociação", won: "Ganho", lost: "Perdido" }
export type PipelineStage = keyof typeof pipelineStages
export type PipelineQuery = { q: string; stage: PipelineStage | ""; offset: number }
export const pipelinePageSize = 25

export function readPipelineQuery(params: Pick<URLSearchParams, "get">): PipelineQuery {
  const q = Array.from((params.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, 160).join("")
  const stage = params.get("stage") || ""
  const rawOffset = params.get("offset") || "0"
  const offset = /^\d{1,6}$/.test(rawOffset) && Number(rawOffset) <= 100000 ? Math.floor(Number(rawOffset) / pipelinePageSize) * pipelinePageSize : 0
  return { q, stage: Object.hasOwn(pipelineStages, stage) ? stage as PipelineStage : "", offset }
}

export function pipelineHref(query: PipelineQuery) {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.stage) params.set("stage", query.stage)
  if (query.offset) params.set("offset", String(query.offset))
  return `/vendas/funil${params.size ? `?${params}` : ""}`
}

export type PipelineTotal = { stage: PipelineStage; count: number; estimatedCents: number }
export function pipelineMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) return "Valor indisponível"
  const value = BigInt(cents)
  return `R$\u00a0${(value / BigInt(100)).toLocaleString("pt-BR")},${String(value % BigInt(100)).padStart(2, "0")}`
}

export function pipelineSummary(totals?: PipelineTotal[]) {
  if (!Array.isArray(totals)) return null
  const result = { open: { count: 0, estimatedCents: 0 }, won: { count: 0, estimatedCents: 0 }, lost: { count: 0, estimatedCents: 0 } }
  const seen = new Set<string>()
  for (const total of totals) {
    if (!Object.hasOwn(pipelineStages, total.stage) || seen.has(total.stage) || !Number.isSafeInteger(total.count) || total.count < 0 || !Number.isSafeInteger(total.estimatedCents) || total.estimatedCents < 0) return null
    seen.add(total.stage)
    const target = result[total.stage === "won" || total.stage === "lost" ? total.stage : "open"]
    target.count += total.count
    target.estimatedCents += total.estimatedCents
    if (!Number.isSafeInteger(target.count) || !Number.isSafeInteger(target.estimatedCents)) return null
  }
  return result
}
