import { createClient } from '@/lib/supabase/server'

type DraftItem = {
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
}

type DraftOrder = {
  requisition_number: string
  po_number: string
  order_date: string | null
  entered_by: string | null
  items: DraftItem[]
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

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  const filePath: string = body.filePath
  const draft: DraftOrder = body.draft

  if (!draft?.requisition_number) {
    return Response.json(
      { error: 'Missing requisition number.' },
      { status: 400 }
    )
  }

  const isoOrderDate = auDateToIso(draft.order_date)

  if (draft.order_date && !isoOrderDate) {
    return Response.json(
      {
        error: `Invalid order date format: "${draft.order_date}". Expected something like 18/3/2026.`,
      },
      { status: 400 }
    )
  }

  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('requisition_number', draft.requisition_number)
    .maybeSingle()

  if (existingOrder) {
    return Response.json(
      { error: 'An order with that requisition number already exists.' },
      { status: 400 }
    )
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      requisition_number: draft.requisition_number,
      po_number: draft.po_number || null,
      order_date: isoOrderDate,
      entered_by: draft.entered_by || null,
      order_complete: false,
      uploaded_pdf_path: filePath || null,
    })
    .select()
    .single()

  if (orderError || !order) {
    return Response.json(
      { error: orderError?.message || 'Failed to create order.' },
      { status: 400 }
    )
  }

  const itemRows = draft.items.map((item) => ({
    order_id: order.id,
    line_no: item.line_no,
    item_no: item.item_no,
    item_name: item.item_name,
    qty_ordered: item.qty_ordered,
    qty_received: 0,
    complete: false,
    follow_up: false,
    comments: null,
  }))

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(itemRows)

  if (itemsError) {
    return Response.json(
      { error: itemsError.message },
      { status: 400 }
    )
  }

  return Response.json({ orderId: order.id })
}