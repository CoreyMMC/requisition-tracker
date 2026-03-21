'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import EditablePoInput from '@/components/EditablePoInput'

type Props = {
  order: {
    id: string
    requisition_number: string
    po_number: string | null
    order_date: string | null
    entered_by: string | null
    requisition_amount_aud: number | null
    title: string | null
    order_complete: boolean
  }
  editMode: boolean
  setEditMode: (value: boolean | ((prev: boolean) => boolean)) => void
}

const ORDER_TYPE_OPTIONS = [
  'General Stock',
  'Non-catalogue',
  'PSA Stock',
  'Name Badges',
  'Other',
]

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateForDisplay(value: string | null | undefined) {
  if (!value) return '—'

  const trimmed = value.trim()

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return `${pad2(day)}/${pad2(month)}/${year}`
  }

  const auMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/)
  if (auMatch) {
    const day = Number(auMatch[1])
    const month = Number(auMatch[2])
    let year = Number(auMatch[3])

    if (auMatch[3].length === 2) {
      year += 2000
    }

    return `${pad2(day)}/${pad2(month)}/${year}`
  }

  return trimmed
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

  return `${year.toString().padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

function parseOrderType(value: string | null | undefined) {
  const raw = (value || '').trim()

  if (!raw) {
    return {
      selectValue: '',
      extraValue: '',
    }
  }

  if (raw === 'General Stock') {
    return { selectValue: 'General Stock', extraValue: '' }
  }

  if (raw === 'PSA Stock') {
    return { selectValue: 'PSA Stock', extraValue: '' }
  }

  if (raw === 'Name Badges') {
    return { selectValue: 'Name Badges', extraValue: '' }
  }

  if (raw === 'Non-catalogue') {
    return { selectValue: 'Non-catalogue', extraValue: '' }
  }

  if (raw.startsWith('Non-catalogue - ')) {
    return {
      selectValue: 'Non-catalogue',
      extraValue: raw.replace(/^Non-catalogue - /, '').trim(),
    }
  }

  return {
    selectValue: 'Other',
    extraValue: raw,
  }
}

export default function OrderSummaryCard({
  order,
  editMode,
  setEditMode,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const initialType = parseOrderType(order.title)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [requisitionNumber, setRequisitionNumber] = useState(
    order.requisition_number || ''
  )
  const [orderDate, setOrderDate] = useState(
    order.order_date ? formatDateForDisplay(order.order_date) : ''
  )
  const [enteredBy, setEnteredBy] = useState(order.entered_by || '')
  const [requisitionAmount, setRequisitionAmount] = useState(
    order.requisition_amount_aud === null || order.requisition_amount_aud === undefined
      ? ''
      : String(order.requisition_amount_aud)
  )
  const [orderTypeSelect, setOrderTypeSelect] = useState(initialType.selectValue)
  const [orderTypeExtra, setOrderTypeExtra] = useState(initialType.extraValue)

  const actualOrderType = useMemo(() => {
    if (orderTypeSelect === 'Non-catalogue') {
      return orderTypeExtra.trim()
        ? `Non-catalogue - ${orderTypeExtra.trim()}`
        : 'Non-catalogue'
    }

    if (orderTypeSelect === 'Other') {
      return orderTypeExtra.trim()
    }

    return orderTypeSelect.trim()
  }, [orderTypeSelect, orderTypeExtra])

  function resetFields() {
    const nextType = parseOrderType(order.title)

    setRequisitionNumber(order.requisition_number || '')
    setOrderDate(order.order_date ? formatDateForDisplay(order.order_date) : '')
    setEnteredBy(order.entered_by || '')
    setRequisitionAmount(
      order.requisition_amount_aud === null || order.requisition_amount_aud === undefined
        ? ''
        : String(order.requisition_amount_aud)
    )
    setOrderTypeSelect(nextType.selectValue)
    setOrderTypeExtra(nextType.extraValue)
    setMessage('')
  }

  async function handleSave() {
    setMessage('')

    const isoDate = auDateToIso(orderDate)

    if (orderDate && !isoDate) {
      setMessage('Date must be entered as DD/MM/YYYY.')
      return
    }

    if (
      (orderTypeSelect === 'Other' || orderTypeSelect === 'Non-catalogue') &&
      !orderTypeExtra.trim()
    ) {
      setMessage('Please type the order type details.')
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('orders')
      .update({
        requisition_number: requisitionNumber || null,
        order_date: isoDate,
        order_date_sort: isoDate,
        entered_by: enteredBy || null,
        requisition_amount_aud:
          requisitionAmount.trim() === '' ? null : Number(requisitionAmount),
        title: actualOrderType || null,
      })
      .eq('id', order.id)

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Order details saved.')
    setEditMode(false)
    router.refresh()
  }

  return (
    <div className="mb-8 rounded border bg-white p-4 text-black">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (editMode) {
                resetFields()
              }
              setEditMode((prev) => !prev)
            }}
            className="rounded border border-black bg-white px-4 py-2 font-semibold text-black"
          >
            {editMode ? 'Cancel Edit' : 'Edit Order'}
          </button>

          {editMode && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Order Details'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded border border-gray-300 bg-gray-50 p-3 text-sm">
          {message}
        </div>
      )}

      <div className="grid gap-3">
        <p>
          <strong>Requisition No:</strong>{' '}
          {editMode ? (
            <input
              type="text"
              value={requisitionNumber}
              onChange={(e) => setRequisitionNumber(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          ) : (
            requisitionNumber || '—'
          )}
        </p>

        <p>
          <strong>Order Type:</strong>{' '}
          {editMode ? (
            <>
              <select
                value={orderTypeSelect}
                onChange={(e) => setOrderTypeSelect(e.target.value)}
                className="ml-2 rounded border px-2 py-1"
              >
                <option value="">Select order type</option>
                {ORDER_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {(orderTypeSelect === 'Other' ||
                orderTypeSelect === 'Non-catalogue') && (
                <input
                  type="text"
                  value={orderTypeExtra}
                  onChange={(e) => setOrderTypeExtra(e.target.value)}
                  placeholder={
                    orderTypeSelect === 'Non-catalogue'
                      ? 'Type non-catalogue details'
                      : 'Type custom order type'
                  }
                  className="ml-2 rounded border px-2 py-1"
                />
              )}
            </>
          ) : (
            actualOrderType || '—'
          )}
        </p>

        <div>
          <label className="mb-2 block font-semibold">PO Number(s)</label>

          <EditablePoInput
            orderId={order.id}
            initialValue={order.po_number}
            placeholder="Example: 5000678, 5000677, 5000668"
            className="w-full rounded border bg-white p-3 text-black"
          />

          <p className="mt-1 text-sm text-gray-600">
            Enter one or multiple PO numbers separated by commas.
          </p>
        </div>

        <p>
          <strong>Date:</strong>{' '}
          {editMode ? (
            <input
              type="text"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              placeholder="DD/MM/YYYY"
              className="ml-2 rounded border px-2 py-1"
            />
          ) : (
            formatDateForDisplay(order.order_date)
          )}
        </p>

        <p>
          <strong>Entered By:</strong>{' '}
          {editMode ? (
            <input
              type="text"
              value={enteredBy}
              onChange={(e) => setEnteredBy(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          ) : (
            enteredBy || '—'
          )}
        </p>

        <p>
          <strong>Requisition Amount (Total Cost):</strong>{' '}
          {editMode ? (
            <input
              type="number"
              step="0.01"
              value={requisitionAmount}
              onChange={(e) => setRequisitionAmount(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          ) : (
            formatCurrency(order.requisition_amount_aud)
          )}
        </p>

        <p>
          <strong>Order Complete:</strong> {order.order_complete ? 'Yes' : 'No'}
        </p>
      </div>
    </div>
  )
}