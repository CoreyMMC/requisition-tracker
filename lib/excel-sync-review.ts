
import type { ExcelLine, ExcelReq, ExcelWorkbook } from './parse-requisitions-excel'

export type Coverage = 'unknown' | '3' | '5' | 'both'

export type UploadedExport = {
  id: string
  name: string
  label: string
  coverage: Coverage
  workbook: ExcelWorkbook | null
  error: string
}

export type SavedOrder = {
  id: string
  requisition_number: string
  po_number: string | null
  order_date: string | null
  title: string | null
  level: number | null
}

export type HistoricalEntry = {
  requisition_number: string
  disposition: 'baseline' | 'historical_only' | 'excluded'
}

export type ReviewGroup =
  | 'po'
  | 'review'
  | 'new'
  | 'historical'
  | 'unchanged'

export type CombinedOrder = {
  requisition: ExcelReq
  sources: string[]
  issues: string[]
}

export type ReviewResult = {
  combined: CombinedOrder
  saved: SavedOrder | null
  historical: HistoricalEntry | null
  group: ReviewGroup
  proposedPo: string
  missingReferences: string[]
}

export const norm = (value: string) =>
  value.trim().toUpperCase()

export function unique(values: string[]) {
  const seen = new Set<string>()

  return values.map((value) => value.trim()).filter((value) => {
    const id = norm(value)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function lineSignature(lines: ExcelLine[]) {
  return JSON.stringify(
    lines.map((line) => JSON.stringify([
      line.item,
      line.description,
      line.quantity,
      line.price,
      line.amount,
      line.supplier,
      line.supplierItem,
    ])).sort()
  )
}

export function combineExports(uploads: UploadedExport[]) {
  const records = new Map<string, CombinedOrder>()
  const excluded = new Map<string, {
    number: string
    reasons: string[]
    sources: string[]
  }>()

  for (const upload of uploads) {
    if (!upload.workbook) continue

    for (const entry of upload.workbook.excluded) {
      const id = norm(entry.number)
      const previous = excluded.get(id)

      excluded.set(id, {
        number: entry.number,
        reasons: unique([
          ...(previous?.reasons ?? []),
          entry.reason,
        ]),
        sources: unique([
          ...(previous?.sources ?? []),
          upload.label,
        ]),
      })
    }

    for (const req of upload.workbook.requisitions) {
      const id = norm(req.number)
      const current = records.get(id)

      if (!current) {
        records.set(id, {
          requisition: {
            ...req,
            statuses: [...req.statuses],
            pos: [...req.pos],
            transfers: [...req.transfers],
            locations: [...req.locations],
            lines: [...req.lines],
            issues: [...req.issues],
          },
          sources: [upload.label],
          issues: [...req.issues],
        })
        continue
      }

      const previous = current.requisition

      if (lineSignature(previous.lines) !== lineSignature(req.lines)) {
        current.issues.push(
          'Item lines differ between staff exports.'
        )
      }

      const statuses = unique([
        ...previous.statuses,
        ...req.statuses,
      ])

      if (statuses.length > previous.statuses.length) {
        current.issues.push(
          'Different requisition statuses between exports.'
        )
      }

      if (
        previous.enteredBy &&
        req.enteredBy &&
        norm(previous.enteredBy) !== norm(req.enteredBy)
      ) {
        current.issues.push('Entered By differs between exports.')
      }

      previous.statuses = statuses
      previous.pos = unique([...previous.pos, ...req.pos])
      previous.transfers = unique([
        ...previous.transfers,
        ...req.transfers,
      ])
      previous.locations = unique([
        ...previous.locations,
        ...req.locations,
      ])

      current.sources = unique([
        ...current.sources,
        upload.label,
      ])
      current.issues.push(...req.issues)
    }
  }

  // Any excluded status in any export excludes that
  // requisition from all baseline/import candidates.
  for (const id of excluded.keys()) {
    records.delete(id)
  }

  for (const entry of records.values()) {
    const location = entry.requisition.locations
      .join(' ')
      .toUpperCase()

    const l3 = /\bL3\b|\bLEVEL[\s-]*3\b/.test(location)
    const l5 = /\bL5\b|\bLEVEL[\s-]*5\b/.test(location)

    entry.requisition.level =
      l3 === l5 ? null : l3 ? 3 : 5

    for (const upload of uploads) {
      if (
        !entry.sources.includes(upload.label) ||
        upload.coverage === 'unknown' ||
        upload.coverage === 'both'
      ) continue

      if (
        (upload.coverage === '3' && entry.requisition.level === 5) ||
        (upload.coverage === '5' && entry.requisition.level === 3)
      ) {
        entry.issues.push('Delivery level conflicts with export coverage.')
      }
    }

    entry.issues = unique(entry.issues)
  }

  return {
    records: [...records.values()],
    excluded: [...excluded.values()],
  }
}

export function compareExports(
  records: CombinedOrder[],
  orders: SavedOrder[],
  history: HistoricalEntry[],
  baselineExists: boolean
): ReviewResult[] {
  const savedIndex = new Map<string, SavedOrder[]>()

  for (const order of orders) {
    const id = norm(order.requisition_number)
    const matches = savedIndex.get(id) ?? []
    matches.push(order)
    savedIndex.set(id, matches)
  }

  const historyIndex = new Map(
    history.map((entry) => [
      norm(entry.requisition_number),
      entry,
    ])
  )

  return records.map((combined) => {
    const req = combined.requisition
    const id = norm(req.number)
    const matches = savedIndex.get(id) ?? []
    const saved = matches.length === 1 ? matches[0] : null
    const historical = historyIndex.get(id) ?? null

    const result: ReviewResult = {
      combined,
      saved,
      historical,
      group: 'review',
      proposedPo: saved?.po_number ?? '',
      missingReferences: [],
    }

    if (matches.length > 1) return result

    // An existing real order always takes priority over
    // any historical entry.
    if (saved) {
      if (combined.issues.length) return result

      const known = new Set(
        (saved.po_number ?? '')
          .split(/[\s,;/|]+/)
          .map(norm)
          .filter(Boolean)
      )

      result.missingReferences = unique([
        ...req.pos,
        ...req.transfers,
      ]).filter((ref) => {
        if (known.has(norm(ref))) return false
        known.add(norm(ref))
        return true
      })

      result.proposedPo = [
        saved.po_number?.trim() ?? '',
        ...result.missingReferences,
      ].filter(Boolean).join(' ')

      result.group = result.missingReferences.length
        ? 'po'
        : 'unchanged'

      return result
    }

    // A previously approved historical decision wins,
    // even when the next export differs.
    if (historical) {
      result.group = 'historical'
      return result
    }

    if (combined.issues.length) return result

    result.group = baselineExists ? 'new' : 'historical'
    return result
  })
}
