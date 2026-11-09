
import { readSheet } from 'read-excel-file/browser'

export type Exclusion =
  | 'Draft'
  | 'Cancelled'
  | 'Rejected'
  | 'Withdrawn'
  | 'Returned'
  | 'Voided'

export type ExcelLine = {
  row: number
  item: string
  description: string
  quantity: number | null
  price: number | null
  amount: number | null
  supplier: string
  supplierItem: string
}

export type ExcelReq = {
  number: string
  enteredBy: string
  statuses: string[]
  locations: string[]
  level: 3 | 5 | null
  pos: string[]
  transfers: string[]
  lines: ExcelLine[]
  issues: string[]
}

export type ExcelExcluded = {
  number: string
  reason: Exclusion
  statuses: string[]
  lines: number
}

export type ExcelWorkbook = {
  name: string
  rows: number
  skipped: number
  requisitions: ExcelReq[]
  excluded: ExcelExcluded[]
}

const text = (value: unknown) =>
  value == null ? '' : String(value).trim()

const key = (value: string) => value.trim().toUpperCase()

function number(value: unknown): number | null {
  const raw = text(value)
    .replace(/[$,]/g, '')
    .replace(/AUD/gi, '')
    .trim()

  if (!raw) return null

  const negative = raw.startsWith('(') && raw.endsWith(')')
  const parsed = Number(negative ? raw.slice(1, -1) : raw)

  return Number.isFinite(parsed)
    ? negative ? -parsed : parsed
    : null
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()

  return values
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = key(value)
      if (!normalized || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
}

function refs(value: unknown): string[] {
  return text(value)
    .split(/[\s,;|]+/)
    .filter((value) => value && value !== '-')
}

function levelOf(locations: string[]): 3 | 5 | null {
  const location = locations.join(' ').toUpperCase()
  const l3 = /\bL3\b|\bLEVEL[\s-]*3\b/.test(location)
  const l5 = /\bL5\b|\bLEVEL[\s-]*5\b/.test(location)

  return l3 === l5 ? null : l3 ? 3 : 5
}

function excludedStatus(statuses: string[]): Exclusion | null {
  const joined = statuses.join(' | ').toLowerCase()

  if (/\bdraft\b/.test(joined)) return 'Draft'
  if (/\bcancelled\b|\bcanceled\b/.test(joined)) return 'Cancelled'
  if (/\brejected\b/.test(joined)) return 'Rejected'
  if (/\bwithdrawn\b/.test(joined)) return 'Withdrawn'
  if (/\breturned\b/.test(joined)) return 'Returned'
  if (/\bvoided\b/.test(joined)) return 'Voided'

  return null
}

export async function parseRequisitionsExcel(
  file: File
): Promise<ExcelWorkbook> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Only .xlsx files are supported.')
  }

  const rows = (await readSheet(file)) as unknown[][]
  const headerRow = rows.findIndex((row) => {
    const names = row.map((cell) => text(cell).toLowerCase())
    return names.includes('requisition') &&
      names.includes('status') &&
      names.includes('item description')
  })

  if (headerRow < 0) {
    throw new Error('Requisition, Status or Item Description header missing.')
  }

  const headers = rows[headerRow].map((cell) =>
    text(cell).replace(/\s+/g, ' ').toLowerCase()
  )

  const required = [
    'requisition',
    'status',
    'item description',
    'quantity',
    'purchase order',
    'transfer order',
    'deliver-to location',
  ]

  const missing = required.filter((name) => !headers.includes(name))

  if (missing.length) {
    throw new Error(`Missing columns: ${missing.join(', ')}`)
  }

  const cell = (row: unknown[], name: string) => {
    const index = headers.indexOf(name.toLowerCase())
    return index < 0 ? null : row[index]
  }

  const grouped = new Map<string, {
    req: ExcelReq
    rawStatuses: string[]
  }>()

  let sourceRows = 0
  let skipped = 0

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]

    if (!row?.some((value) => text(value))) continue

    sourceRows++

    const numberValue = text(cell(row, 'requisition'))

    if (!numberValue) {
      skipped++
      continue
    }

    const normalized = key(numberValue)
    let group = grouped.get(normalized)

    if (!group) {
      group = {
        req: {
          number: numberValue,
          enteredBy: text(cell(row, 'entered by')),
          statuses: [],
          locations: [],
          level: null,
          pos: [],
          transfers: [],
          lines: [],
          issues: [],
        },
        rawStatuses: [],
      }

      grouped.set(normalized, group)
    }

    const req = group.req
    const status = text(cell(row, 'status'))
    group.rawStatuses.push(status)

    const enteredBy = text(cell(row, 'entered by'))
    if (!req.enteredBy) req.enteredBy = enteredBy

    if (
      enteredBy &&
      req.enteredBy &&
      key(enteredBy) !== key(req.enteredBy)
    ) {
      req.issues.push('Conflicting Entered By names.')
    }

    req.pos.push(...refs(cell(row, 'purchase order')))
    req.transfers.push(...refs(cell(row, 'transfer order')))

    const location = text(cell(row, 'deliver-to location'))
    if (location) req.locations.push(location)

    req.lines.push({
      row: i + 1,
      item: text(cell(row, 'item')),
      description: text(cell(row, 'item description')),
      quantity: number(cell(row, 'quantity')),
      price: number(cell(row, 'price')),
      amount: number(cell(row, 'amount')),
      supplier: text(cell(row, 'supplier')),
      supplierItem: text(cell(row, 'supplier item')),
    })
  }

  const requisitions: ExcelReq[] = []
  const excluded: ExcelExcluded[] = []

  for (const { req, rawStatuses } of grouped.values()) {
    req.statuses = unique(rawStatuses)
    req.locations = unique(req.locations)
    req.pos = unique(req.pos)
    req.transfers = unique(req.transfers)
    req.level = levelOf(req.locations)
    req.issues = unique(req.issues)

    const reason = excludedStatus(rawStatuses)

    // Exclusion wins even when one line has another status.
    if (reason) {
      excluded.push({
        number: req.number,
        reason,
        statuses: req.statuses,
        lines: req.lines.length,
      })
      continue
    }

    if (rawStatuses.some((status) => !status)) {
      req.issues.push('Missing Status on one or more Excel lines.')
    }

    if (req.statuses.length > 1) {
      req.issues.push('Different Status values within this requisition.')
    }

    if (req.lines.some((line) => !line.description)) {
      req.issues.push('One or more item descriptions are missing.')
    }

    if (
      req.lines.some((line) =>
        line.quantity === null || line.quantity <= 0
      )
    ) {
      req.issues.push('One or more quantities are missing or invalid.')
    }

    requisitions.push(req)
  }

  return {
    name: file.name,
    rows: sourceRows,
    skipped,
    requisitions,
    excluded,
  }
}
