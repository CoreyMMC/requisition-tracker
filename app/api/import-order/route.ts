import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseOrderPdf } from '@/lib/parse-order-pdf'

type ImportHeader = {
  requisition_no: string
  po_numbers: string
  date: string
  entered_by: string
  requisition_amount_aud: number | null
}

type ImportItem = {
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  amount_aud: number | null
}

function auDateToIso(value: string | null | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  let year = Number(match[3])

  if (!day || !month) return null

  if (match[3].length === 2) {
    year += 2000
  }

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function toDisplayAuDate(value: string | null | undefined): string {
  if (!value) return ''

  const trimmed = value.trim()

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return `${day}/${month}/${year}`
  }

  const auMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/)
  if (auMatch) {
    const day = Number(auMatch[1])
    const month = Number(auMatch[2])
    let year = Number(auMatch[3])

    if (auMatch[3].length === 2) {
      year += 2000
    }

    return `${day}/${month}/${year}`
  }

  return trimmed
}

// POST = parse preview
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file received under field name "file"' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const parsed = await parseOrderPdf(buffer)

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      fileSize: file.size,
      header: {
        ...parsed.header,
        date: toDisplayAuDate(parsed.header.date),
      },
      items: parsed.items,
      raw_line_count: parsed.raw_line_count,
      kept_line_count: parsed.kept_line_count,
    })
  } catch (error) {
    console.error('PARSE ROUTE ERROR:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}

// PUT = final import into Supabase
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()

    const body = await request.json()
    const header: ImportHeader = body.header
    const items: ImportItem[] = body.items ?? []
    const title: string | null = body.title ?? null
    const overrideDuplicate = body.overrideDuplicate === true

    if (!header?.requisition_no) {
      return NextResponse.json(
        { error: 'Requisition number is required before import.' },
        { status: 400 }
      )
    }

    const isoOrderDate = auDateToIso(header.date)

    if (header.date && !isoOrderDate) {
      return NextResponse.json(
        {
          error: `Invalid order date format: "${header.date}". Expected something like 18/3/2026.`,
        },
        { status: 400 }
      )
    }

    const { data: existingOrders, error: existingOrdersError } = await supabase
      .from('orders')
      .select('id')
      .eq('requisition_number', header.requisition_no)
      .limit(1)

    if (existingOrdersError) {
      return NextResponse.json(
        { error: existingOrdersError.message },
        { status: 500 }
      )
    }

    const duplicateExists = (existingOrders?.length ?? 0) > 0

    if (duplicateExists && !overrideDuplicate) {
      return NextResponse.json(
        {
          error: `Requisition ${header.requisition_no} already exists.`,
          duplicate: true,
        },
        { status: 409 }
      )
    }

    const orderPayload = {
      requisition_number: header.requisition_no,
      po_number: header.po_numbers || null,
      order_date: isoOrderDate,
      order_date_sort: isoOrderDate,
      entered_by: header.entered_by || null,
      requisition_amount_aud: header.requisition_amount_aud ?? null,
      title: title || null,
      order_complete: false,
    }

    const { data: insertedOrder, error: orderError } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select('id')
      .single()

    if (orderError || !insertedOrder) {
      return NextResponse.json(
        { error: orderError?.message || 'Failed to create order.' },
        { status: 500 }
      )
    }

    if (items.length > 0) {
      const itemRows = items.map((item) => ({
        order_id: insertedOrder.id,
        line_no: item.line_no,
        item_no: item.item_no,
        item_name: item.item_name,
        qty_ordered: item.qty_ordered,
        amount_aud: item.amount_aud ?? null,
        qty_received: 0,
        complete: false,
        follow_up: false,
        comments: '',
      }))

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(itemRows)

      if (itemsError) {
        return NextResponse.json(
          { error: itemsError.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      ok: true,
      orderId: insertedOrder.id,
      createdDuplicateCopy: duplicateExists && overrideDuplicate,
    })
  } catch (error) {
    console.error('IMPORT ROUTE ERROR:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}