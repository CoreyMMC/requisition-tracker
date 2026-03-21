'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import EditablePoInput from '@/components/EditablePoInput'
import EditableOrderField from '@/components/EditableOrderField'
import EditableOrderTitleSelect from '@/components/EditableOrderTitleSelect'

type Order = {
  id: string
  requisition_number: string | null
  po_number: string | null
  order_date: string | null
  order_date_sort?: string | null
  entered_by: string | null
  requisition_amount_aud: number | null
  title: string | null
  order_complete: boolean | null
}

type Props = {
  initialOrders: Order[]
}

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

function getSortableTimestamp(order: Order) {
  const raw = (order.order_date_sort || order.order_date || '').trim()

  if (!raw) return 0

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2]) - 1
    const day = Number(isoMatch[3])
    return new Date(year, month, day).getTime()
  }

  const auMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/)
  if (auMatch) {
    const day = Number(auMatch[1])
    const month = Number(auMatch[2]) - 1
    let year = Number(auMatch[3])

    if (auMatch[3].length === 2) {
      year += 2000
    }

    return new Date(year, month, day).getTime()
  }

  const fallback = new Date(raw).getTime()
  return Number.isNaN(fallback) ? 0 : fallback
}

export default function OrdersTableClient({ initialOrders }: Props) {
  const [editMode, setEditMode] = useState(false)

  const sortedOrders = useMemo(() => {
    return [...initialOrders].sort(
      (a, b) => getSortableTimestamp(b) - getSortableTimestamp(a)
    )
  }, [initialOrders])

  return (
    <main className="min-h-screen bg-white p-8 text-black">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders / Requisitions</h1>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setEditMode((prev) => !prev)}
            className="rounded border bg-white px-4 py-2 text-black"
          >
            {editMode ? 'Done Editing' : 'Edit'}
          </button>

          <Link
            href="/orders/new"
            className="rounded bg-black px-4 py-2 text-white"
          >
            New Order
          </Link>

          <Link
            href="/upload"
            className="rounded border bg-white px-4 py-2 text-black"
          >
            Upload PDF
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-100 text-left text-black">
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold">Req No.</th>
              <th className="p-3 font-semibold">Order Type</th>
              <th className="p-3 font-semibold">PO No.</th>
              <th className="p-3 font-semibold">Date</th>
              <th className="p-3 font-semibold">Entered By</th>
              <th className="p-3 font-semibold">Req Amount</th>
              <th className="p-3 font-semibold">Open</th>
            </tr>
          </thead>

          <tbody>
            {sortedOrders.map((order) => {
              const isComplete = order.order_complete === true

              return (
                <tr
                  key={order.id}
                  className="border-b bg-white text-black even:bg-gray-50"
                >
                  <td className="p-3">
                    <span
                      style={{
                        display: 'inline-block',
                        minWidth: '92px',
                        textAlign: 'center',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: 'white',
                        backgroundColor: isComplete ? '#16a34a' : '#dc2626',
                        border: `1px solid ${isComplete ? '#166534' : '#991b1b'}`,
                      }}
                    >
                      {isComplete ? 'Complete' : 'Open'}
                    </span>
                  </td>

                  <td className="p-3">
                    <EditableOrderField
                      orderId={order.id}
                      field="requisition_number"
                      initialValue={order.requisition_number}
                      editMode={editMode}
                    />
                  </td>

                  <td className="min-w-[220px] p-3">
                    <EditableOrderTitleSelect
                      orderId={order.id}
                      initialValue={order.title}
                    />
                  </td>

                  <td className="p-3">
                    <EditablePoInput
                      orderId={order.id}
                      initialValue={order.po_number}
                      placeholder="Enter PO(s)"
                      className="w-72 rounded border bg-white p-2 text-black"
                    />
                  </td>

                  <td className="p-3">
                    {editMode ? (
                      <EditableOrderField
                        orderId={order.id}
                        field="order_date"
                        initialValue={order.order_date}
                        editMode={editMode}
                      />
                    ) : (
                      formatDateForDisplay(order.order_date)
                    )}
                  </td>

                  <td className="p-3">{order.entered_by || '—'}</td>

                  <td className="p-3">
                    {formatCurrency(order.requisition_amount_aud)}
                  </td>

                  <td className="p-3">
                    <Link href={`/orders/${order.id}`} className="underline">
                      Open
                    </Link>
                  </td>
                </tr>
              )
            })}

            {sortedOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-gray-500">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}