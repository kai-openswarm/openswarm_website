// CSV building for the signup export.

/** Quotes a field when needed (RFC 4180). */
export function csvField(value: unknown, opts: { guardFormula?: boolean } = {}): string {
  if (value == null) return ''
  let s = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Spreadsheet formula injection: UTM values and the like come from visitors' URLs.
  if (opts.guardFormula && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends object>(rows: T[], columns: (keyof T & string)[], trusted: ReadonlySet<string> = new Set()): string {
  const lines = [columns.map((c) => csvField(c)).join(',')]
  for (const r of rows) {
    lines.push(columns.map((c) => csvField(r[c], { guardFormula: !trusted.has(c) })).join(','))
  }
  // BOM so Excel opens UTF-8 (city names, etc.) correctly.
  return `﻿${lines.join('\r\n')}\r\n`
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
