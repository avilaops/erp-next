"use client"

import { Button } from "@/components/ui/button"

type PaginationProps = {
  offset: number
  pageSize: number
  total: number
  maxOffset?: number
  loading?: boolean
  showPageSize?: boolean
  onOffsetChange: (offset: number) => void
}

export function Pagination({ offset, pageSize, total, maxOffset = Infinity, loading = false, showPageSize = false, onOffsetChange }: PaginationProps) {
  const size = Math.max(1, pageSize)
  const page = Math.floor(Math.max(0, offset) / size) + 1
  const pages = Math.max(1, Math.min(Math.ceil(Math.max(0, total) / size), Math.floor(maxOffset / size) + 1))

  return (
    <nav aria-label="Paginação" className="workspace-pagination">
      <Button type="button" variant="outline" disabled={loading || offset <= 0} onClick={() => onOffsetChange(Math.max(0, offset - size))}>Anterior</Button>
      <span aria-live="polite" className="text-sm text-muted-foreground"><span>Página {page}</span>{showPageSize ? ` · ${size} por página` : ` de ${pages}`}</span>
      <Button type="button" variant="outline" disabled={loading || offset + size >= total || offset + size > maxOffset} onClick={() => onOffsetChange(offset + size)}>Próxima</Button>
    </nav>
  )
}
