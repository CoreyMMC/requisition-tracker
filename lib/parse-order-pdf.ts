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

function cleanPdfText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/￾/g, '-')
    .replace(/[‐‑–—]/g, '-')
}

function collapseWhitespace(value: string): string {
  return cleanPdfText(value).replace(/\s+/g, ' ').trim()
}

function parseMoney(value?: string): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function formatUsDateToAu(value?: string): string {
  if (!value) return ''
  const [month, day, year] = value.split('/')
  if (!month || !day || !year) return value
  return `${Number(day)}/${Number(month)}/${year}`
}

function extractHeader(text: string): ParsedOrderHeader {
  const normalized = collapseWhitespace(text)

  const requisitionNo =
    normalized.match(/\bRequisition\s+(\d{6,})\b/i)?.[1] ?? ''

  const reportDateUs =
    normalized.match(/\bReport Date\s+(\d{1,2}\/\d{1,2}\/\d{2})\b/i)?.[1] ?? ''

  const enteredBy =
    normalized.match(/\bEntered By\s+(.+?)\s+Approval Amount\b/i)?.[1] ?? ''

  const requisitionAmount = parseMoney(
    normalized.match(/\bRequisition Amount\s+([\d,]+\.\d{2})\s+AUD\b/i)?.[1] ??
      normalized.match(/\bRequisition\s+\d{6,}\s+\(([\d,]+\.\d{2})\s+AUD\)/i)?.[1]
  )

  // These Oracle requisition PDFs normally have no PO number; leave it blank.
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

// A code is optional. Do not mistake a name such as "NPi300" or
// "16-18 Bridle" for a catalogue number.
function isLikelyCatalogueCode(token: string): boolean {
  return /^\d{4,}$/.test(token) || /^(?=[A-Z0-9-]{5,}$)(?=.*[A-Z])(?=.*\d)[A-Z]+-\d{3,}$/i.test(token)
}

function startItemBlock(rawLine: string): ItemBlock | null {
  const match = cleanPdfText(rawLine).match(/^\s*(\d{1,3})(\s+)(\S+)(.*)$/)
  if (!match) return null

  const lineNo = Number(match[1])
  const spacesAfterLineNo = match[2].length
  const firstToken = match[3]
  const remainder = match[4] ?? ''

  // Quantity/UOM rows can start with a number too (e.g. '2 BOX 610.00').
  // They are NOT new requisition lines.
  if (/^(?:EACH|BOX|PACK|CART|SET|PAIR|BAG|ROLL|UNIT|KIT|CASE|EA|PKT|PK|BOTTLE|VIAL|TUBE)$/i.test(firstToken) &&
      /^\s+(?:ET\s+|ON\s+)?[\d,]+(?:\.\d{1,2})?\b/.test(remainder)) {
    return null
  }

  // In the Oracle table, the blank Item cell gives a much wider gap
  // (usually around 20 spaces versus ~8 when an item code is present).
  // The code-pattern fallback also works with PDF extractors that remove gaps.
  const hasCode = spacesAfterLineNo < 14 && isLikelyCatalogueCode(firstToken)
  const firstDescription = hasCode
    ? remainder.trim()
    : `${firstToken}${remainder}`.trim()

  return {
    line_no: lineNo,
    item_no: hasCode ? firstToken : '',
    lines: firstDescription ? [firstDescription] : [],
  }
}

function buildItemBlocks(text: string): ItemBlock[] {
  const blocks: ItemBlock[] = []
  let current: ItemBlock | null = null
  let seenLines = false
  let inItemTable = false

  const finishBlock = () => {
    if (current) blocks.push(current)
    current = null
  }

  for (const rawLine of cleanPdfText(text).split(/\r?\n/)) {
    const line = collapseWhitespace(rawLine)
    if (!line) continue

    if (/^Lines$/i.test(line)) {
      seenLines = true
      continue
    }
    if (!seenLines) continue

    if (/^End of Report$/i.test(line)) {
      finishBlock()
      break
    }

    // Only start items inside the Oracle 'Line / Item / Description' table.
    // This avoids creating phantom items from Distribution / Charge Account rows.
    if (/^Line\s+Item\s+Description\s+Category\b/i.test(line)) {
      inItemTable = true
      continue
    }

    if (/^Requester\b/i.test(line)) {
      finishBlock()
      inItemTable = false
      continue
    }
    if (/^Distribution\s+Charge Account\b/i.test(line)) {
      finishBlock()
      inItemTable = false
      continue
    }
    if (!inItemTable) continue

    if (/^(?:Name|Quantity\s+UOM|\(AUD\)|Status\s+Funds|Status)$/i.test(line)) {
      continue
    }

    const potential = startItemBlock(rawLine)
    // Order line numbers are 1, 2, 3 ...; descriptions and other table
    // content must not be mistaken for another line.
    const expectedNext = blocks.length + (current ? 2 : 1)
    if (potential && potential.line_no === expectedNext) {
      finishBlock()
      current = potential
      continue
    }

    if (current) current.lines.push(rawLine)
  }

  finishBlock()
  return blocks
}

function normaliseForMatching(value: string): string {
  return collapseWhitespace(value).replace(
    /(\d[\d,]*\.\d)\s+(\d)(?=\s+(?:AUD|[\d,]+\.\d{2}\b))/g,
    '$1$2'
  )
}

// Accept price wrapping (e.g. "1,550.0" on one line, "0 AUD" on the
// next), PACK/ET and CART/ON UOM wrapping, and line amounts with commas.
const QTY_PRICE_AMOUNT_REGEX =
  /\b(\d+(?:\.\d+)?)\s+(EACH|BOX|PACK(?:\s*ET)?|CART(?:\s*ON)?|SET|PAIR|BAG|ROLL|UNIT|KIT|CASE|EA|PKT|PK|BOTTLE|VIAL|TUBE)\s+([\d,]+(?:\.\d{1,2})?)\s+(?:AUD\s+)?([\d,]+\.\d{2})\b/i

const NON_DESCRIPTION_LINE =
  /^(?:other|general|medical|consumabl|es|consumables|aud|approved|liquidated|not applicable|not|applicable|laboratory|supplies\s*-?|pathology|equipment|pack|et|cart|on|status|funds|name)$/i

function cleanDescriptionFragment(rawLine: string): string {
  // Preserved double spaces identify the description column in Oracle PDFs.
  const firstColumn = cleanPdfText(rawLine).trim().split(/\s{2,}/)[0].trim()
  let line = firstColumn

  // Text extraction can sometimes remove layout gaps: trim category/price
  // fields if they were merged onto the same text line.
  line = line.replace(/\s+(?:Other|Laboratory|Pathology)(?:\s+General)?\s+\d+\s+(?:EACH|BOX|PACK|CART|SET|PAIR|BAG|UNIT)\b.*$/i, '')
  line = line.replace(/\s+(?:Other|Laboratory|Pathology)(?:\s+General)?$/i, '')
  line = line.replace(/\s+(?:Approved|Liquidated)\b.*$/i, '')

  const normalized = collapseWhitespace(line)
  if (!normalized || NON_DESCRIPTION_LINE.test(normalized)) return ''
  if (/^\d+(?:\.\d+)?\s+(?:EACH|BOX|PACK|CART|SET|PAIR|BAG|ROLL|UNIT|KIT|CASE|EA|PKT|PK|BOTTLE|VIAL|TUBE)(?:\s+(?:ET|ON))?(?:\s+[\d,]+(?:\.\d{1,2})?)?$/i.test(normalized)) return ''
  if (/^(?:EACH|BOX|PACK|CART|SET|PAIR|BAG|UNIT|PKT)\s+[\d,]+\.\d{1,2}/i.test(normalized)) return ''
  if (/^[\d,]+\.\d{2}(?:\s+AUD)?\b/i.test(normalized)) return ''
  if (/^\d+\s+AUD$/i.test(normalized)) return ''
  if (/^\d{1,2}\/\d{1,2}\/\d{2}\b/.test(normalized)) return ''
  if (/^(?:Requisition|Page|Requester|Supplier|Urgent|Deliver-to|Destination Type|Subinventory|Contact Phone|Requested Delivery|Distribution|Charge Account)\b/i.test(normalized)) return ''

  return normalized
}

function extractItemFromBlock(block: ItemBlock): ParsedOrderItem | null {
  const combined = normaliseForMatching(block.lines.join(' '))
  const match = combined.match(QTY_PRICE_AMOUNT_REGEX)
  if (!match) return null

  const qtyOrdered = Number(match[1])
  const amountAud = parseMoney(match[4])
  if (!Number.isFinite(qtyOrdered) || qtyOrdered <= 0 || amountAud === null) {
    return null
  }

  const nameParts: string[] = []
  for (const rawLine of block.lines) {
    const line = normaliseForMatching(rawLine)
    // Quantities and amounts are data columns, not part of the description.
    if (QTY_PRICE_AMOUNT_REGEX.test(line) && !/\s{2,}/.test(rawLine)) {
      // In collapsed text, strip the numerical suffix while retaining the name.
      const index = line.search(QTY_PRICE_AMOUNT_REGEX)
      const prefix = index >= 0 ? line.slice(0, index) : line
      const cleaned = cleanDescriptionFragment(prefix)
      if (cleaned) nameParts.push(cleaned)
      continue
    }
    const cleaned = cleanDescriptionFragment(rawLine)
    if (cleaned) nameParts.push(cleaned)
  }

  const itemName = collapseWhitespace(nameParts.join(' '))
    .replace(/\bOther General Medical Consumabl(?:es|\s+es)\b/gi, '')
    .replace(/\bGeneral Medical Consumabl(?:es|\s+es)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return itemName
    ? { line_no: block.line_no, item_no: block.item_no, item_name: itemName, qty_ordered: qtyOrdered, amount_aud: amountAud }
    : null
}

function extractItems(text: string): ParsedOrderItem[] {
  return buildItemBlocks(text)
    .map(extractItemFromBlock)
    .filter((item): item is ParsedOrderItem => item !== null)
}

export async function parseOrderPdf(buffer: Buffer): Promise<ParsedOrderResult> {
  const parser = new PDFParse({ data: buffer, CanvasFactory })

  try {
    const result = await parser.getText()
    const text = result.text || ''
    const lines = text.split(/\r?\n/).map(collapseWhitespace).filter(Boolean)
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
