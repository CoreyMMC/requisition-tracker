import { CanvasFactory, getData } from 'pdf-parse/worker'
import { PDFParse } from 'pdf-parse'

PDFParse.setWorker(getData())

export type ParsedOrderHeader = {
  requisition_no: string
  po_numbers: string
  date: string
  entered_by: string
  requisition_amount_aud: number | null
}

export type ParsedOrderItem = {
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  amount_aud: number | null
}

export type ParsedOrderResult = {
  header: ParsedOrderHeader
  items: ParsedOrderItem[]
  raw_line_count: number
  kept_line_count: number
}

type ItemBlock = {
  line_no: number
  item_no: string
  lines: string[]
}

const HEADER_SKIP_PATTERNS = [
  /^Requisition \d+ \([\d,]+\.\d{2} AUD\) Report Date\b/i,
  /^Page \d+ of \d+$/i,
  /^Requisitioning BU\b/i,
  /^Entered By\b/i,
  /^Status Pending approval Procurement Card$/i,
  /^Description\b/i,
  /^Emergency Requisition\b/i,
  /^Lines$/i,
  /^Line Item Description Category$/i,
  /^Name$/i,
  /^Quantity UOM Price Amount$/i,
  /^\(AUD\)$/i,
  /^Status Funds$/i,
  /^Status$/i,
]

/**
 * Supports BOTH:
 *   1 ABC-123 Some description here
 * and:
 *   1 ABC-123
 *   Description on next line
 */
const ITEM_START_REGEX = /^(\d{1,2})\s+([A-Z0-9][A-Z0-9-]{4,})(?:\s+(.*))?$/i

const QTY_PRICE_AMOUNT_REGEX =
  /(\d+(?:\.\d+)?)\s+([A-Z]+(?:\s+[A-Z]+)?)\s+([\d,]+\.\d{2})\s+(?:AUD\s+)?([\d,]+\.\d{2})\b/i

function cleanPdfText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/￾/g, '-')
    .replace(/[‐-–—]/g, '-')
}

function collapseWhitespace(value: string): string {
  return cleanPdfText(value).replace(/\s+/g, ' ').trim()
}

function parseMoney(value?: string): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isNaN(parsed) ? null : parsed
}

function formatUsDateToAu(value?: string): string {
  if (!value) return ''
  const [month, day, year] = value.split('/')
  if (!month || !day || !year) return value
  return `${Number(day)}/${Number(month)}/${year}`
}

function cleanItemName(value: string): string {
  return collapseWhitespace(value)
    .replace(/\bOther General Medical Consumables\b/gi, '')
    .replace(/\bOther General Medical Consumabl es\b/gi, '')
    .replace(/\bGeneral Medical Consumables\b/gi, '')
    .replace(/\bGeneral Medical Consumabl es\b/gi, '')
    .replace(/\bWaste Disposal\b/gi, '')
    .replace(/\bPACK ET\b/gi, 'PACKET')
    .replace(/\bCART ON\b/gi, 'CARTON')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseForMatching(value: string): string {
  return collapseWhitespace(value).replace(
    /(\d[\d,]*\.\d)\s+(\d)(?=\s+(?:AUD|[\d,]+\.\d{2}\b))/g,
    '$1$2'
  )
}

function extractHeader(text: string): ParsedOrderHeader {
  const normalized = collapseWhitespace(text)

  const requisitionNo =
    normalized.match(/\bRequisition\s+(\d{6,})\b/i)?.[1] ?? ''

  const reportDateUs =
    normalized.match(/\bReport Date\s+(\d{1,2}\/\d{1,2}\/\d{2})\b/i)?.[1] ?? ''

  const enteredBy =
    normalized.match(/\bEntered By\s+(.+?)\s+Approval Amount\b/i)?.[1] ?? ''

  const requisitionAmount =
    parseMoney(
      normalized.match(/\bRequisition Amount\s+([\d,]+\.\d{2})\s+AUD\b/i)?.[1] ??
        normalized.match(/\bRequisition\s+\d{6,}\s+\(([\d,]+\.\d{2})\s+AUD\)/i)?.[1]
    )

  const poNumbers =
    normalized.match(
      /\b(?:PO|Purchase Order)\b\s*(?:No|Number)?[:#]?\s*([A-Z0-9,\-\/ ]{4,})\b/i
    )?.[1]?.trim() ?? ''

  return {
    requisition_no: requisitionNo,
    po_numbers: poNumbers,
    date: formatUsDateToAu(reportDateUs),
    entered_by: enteredBy,
    requisition_amount_aud: requisitionAmount,
  }
}

function shouldSkipHeaderLine(line: string): boolean {
  return HEADER_SKIP_PATTERNS.some((pattern) => pattern.test(line))
}

function isDescriptionLine(line: string): boolean {
  const normalized = collapseWhitespace(line)
  if (!normalized) return false

  const lower = normalized.toLowerCase()

  if (
    [
      'other',
      'general',
      'medical',
      'consumabl',
      'es',
      'consumables',
      'aud',
      'approval',
      'not',
      'reserved',
      'aud approval reserved',
    ].includes(lower)
  ) {
    return false
  }

  if (/^[\d,]+\.\d{2}\s+pending\b/i.test(normalized)) return false
  if (/^\d+\s+aud$/i.test(normalized)) return false
  if (/^pending\b/i.test(normalized)) return false

  if (
    /^(urgent|requested delivery date|deliver-to|contact phone|supplier item|destination type|subinventory|note to buyer|distribution charge account budget|date|percentage quantity amount|funds)\b/i.test(
      normalized
    )
  ) {
    return false
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2}\s+\d+/i.test(normalized)) return false

  if (/^[A-Z0-9-]+$/i.test(normalized) && normalized.length > 12) return false

  if (
    /^\d+(?:\.\d+)?\s+[A-Z]+(?:\s+[A-Z]+)?\s+[\d,]+\.\d{1,2}$/i.test(normalized)
  ) {
    return false
  }

  return true
}

function buildItemBlocks(text: string): ItemBlock[] {
  const rawLines = cleanPdfText(text).split(/\r?\n/)
  const blocks: ItemBlock[] = []

  let current: ItemBlock | null = null
  let inLinesSection = false

  for (const rawLine of rawLines) {
    const line = collapseWhitespace(rawLine)
    if (!line) continue

    // Start parsing only once we hit a Lines table
    if (/^Lines$/i.test(line)) {
      inLinesSection = true
      continue
    }

    if (!inLinesSection) continue

    // End of the whole report
    if (line === 'End of Report') {
      if (current) {
        blocks.push(current)
        current = null
      }
      break
    }

    if (shouldSkipHeaderLine(line)) continue

    const startMatch = line.match(ITEM_START_REGEX)

    if (startMatch) {
      if (current) {
        blocks.push(current)
      }

      current = {
        line_no: Number(startMatch[1]),
        item_no: startMatch[2],
        lines: startMatch[3]?.trim() ? [startMatch[3].trim()] : [],
      }

      continue
    }

    // Save current item, then keep scanning for the next one
    if (line.startsWith('Requester ')) {
      if (current) {
        blocks.push(current)
        current = null
      }
      continue
    }

    if (!current) {
      continue
    }

    current.lines.push(line)
  }

  if (current) {
    blocks.push(current)
  }

  return blocks
}

function extractItemFromBlock(block: ItemBlock): ParsedOrderItem | null {
  const joined = normaliseForMatching(block.lines.join(' '))
  const qtyMatch = joined.match(QTY_PRICE_AMOUNT_REGEX)

  if (!qtyMatch) {
    return null
  }

  const qtyOrdered = Number(qtyMatch[1]) || 0
  const amountAud = parseMoney(qtyMatch[4])

  const nameParts: string[] = []

  for (const rawLine of block.lines) {
    const line = collapseWhitespace(rawLine)
    if (!line) continue

    const normalizedLine = normaliseForMatching(line)
    const inlineQtyMatch = normalizedLine.match(QTY_PRICE_AMOUNT_REGEX)

    if (inlineQtyMatch) {
      const qtyStartIndex = inlineQtyMatch.index ?? -1
      const prefix =
        qtyStartIndex >= 0
          ? normalizedLine.slice(0, qtyStartIndex).trim()
          : ''

      const cleanedPrefix = prefix.replace(/\bOther\s*$/i, '').trim()

      if (cleanedPrefix && isDescriptionLine(cleanedPrefix)) {
        nameParts.push(cleanedPrefix)
      }

      continue
    }

    if (isDescriptionLine(line)) {
      nameParts.push(line)
    }
  }

  const itemName = cleanItemName(nameParts.join(' '))

  if (!itemName) {
    return null
  }

  return {
    line_no: block.line_no,
    item_no: block.item_no,
    item_name: itemName,
    qty_ordered: qtyOrdered,
    amount_aud: amountAud,
  }
}

function extractItems(text: string): ParsedOrderItem[] {
  const blocks = buildItemBlocks(text)
  const items: ParsedOrderItem[] = []

  for (const block of blocks) {
    const item = extractItemFromBlock(block)
    if (item) {
      items.push(item)
    }
  }

  return items
}

export async function parseOrderPdf(buffer: Buffer): Promise<ParsedOrderResult> {
  const parser = new PDFParse({
    data: buffer,
    CanvasFactory,
  })

  try {
    const result = await parser.getText()
    const text = result.text || ''

    const lines = text
      .split(/\r?\n/)
      .map((line) => collapseWhitespace(line))
      .filter(Boolean)

    const header = extractHeader(text)
    const items = extractItems(text)

    return {
      header,
      items,
      raw_line_count: lines.length,
      kept_line_count: items.length,
    }
  } finally {
    await parser.destroy()
  }
}