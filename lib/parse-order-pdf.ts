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
    .replace(/\bWaste Disposal\b/gi, '')
    .replace(/\bPACK ET\b/gi, 'PACKET')
    .replace(/\bCART ON\b/gi, 'CARTON')
    .replace(/\s+/g, ' ')
    .trim()
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
    normalized.match(/\b(?:PO|Purchase Order)\b\s*(?:No|Number)?[:#]?\s*([A-Z0-9,\-\/ ]{4,})\b/i)?.[1]?.trim() ??
    ''

  return {
    requisition_no: requisitionNo,
    po_numbers: poNumbers,
    date: formatUsDateToAu(reportDateUs),
    entered_by: enteredBy,
    requisition_amount_aud: requisitionAmount,
  }
}

function extractItems(text: string): ParsedOrderItem[] {
  const cleaned = cleanPdfText(text)
  const items: ParsedOrderItem[] = []

  const blockRegex = /(?:^|\n)(\d{1,2})\s+(\d{5,6})\s+([\s\S]*?)\nRequester\b/gm

  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(cleaned)) !== null) {
    const lineNo = Number(match[1])
    const itemNo = match[2]
    const block = collapseWhitespace(match[3])

    const qtyPriceAmountMatch = block.match(
      /(\d+(?:\.\d+)?)\s+([A-Z]+(?:\s+[A-Z]+)?)\s+([\d,]+\.\d{2})\s+AUD\s+([\d,]+\.\d{2})\s+Pending\b/i
    )

    if (!qtyPriceAmountMatch) {
      continue
    }

    const itemNameRaw = block.slice(0, qtyPriceAmountMatch.index).trim()
    const itemName = cleanItemName(itemNameRaw)

    const qtyOrdered = Number(qtyPriceAmountMatch[1]) || 0
    const amountAud = parseMoney(qtyPriceAmountMatch[4])

    if (!itemName) continue

    items.push({
      line_no: lineNo,
      item_no: itemNo,
      item_name: itemName,
      qty_ordered: qtyOrdered,
      amount_aud: amountAud,
    })
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