export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n")
}

export function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", serializeCsv(rows)], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
