'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import EditablePoInput from '@/components/EditablePoInput'
import EditableOrderField from '@/components/EditableOrderField'
import EditableOrderTitleSelect from '@/components/EditableOrderTitleSelect'

type OrderItemSummary = {
  id: string
  complete: boolean | null
  follow_up: boolean | null
}

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
  order_items?: OrderItemSummary[] | null
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

function compareNullableStringsAsc(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const aValue = (a || '').trim()
  const bValue = (b || '').trim()

  const aEmpty = aValue.length === 0
  const bEmpty = bValue.length === 0

  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  return aValue.localeCompare(bValue, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function compareOrders(a: Order, b: Order) {
  const dateDifference = getSortableTimestamp(b) - getSortableTimestamp(a)
  if (dateDifference !== 0) return dateDifference

  const requisitionDifference = compareNullableStringsAsc(
    a.requisition_number,
    b.requisition_number
  )
  if (requisitionDifference !== 0) return requisitionDifference

  return a.id.localeCompare(b.id)
}

function getOrderStatusSummary(order: Order) {
  const items = Array.isArray(order.order_items) ? order.order_items : []

  const totalItems = items.length
  const completeCount = items.filter((item) => item.complete === true).length

  const allComplete =
    totalItems > 0 && items.every((item) => item.complete === true)

  const allAddressed =
    totalItems > 0 &&
    items.every(
      (item) => item.complete === true || item.follow_up === true
    )

  const showFu = !allComplete && allAddressed

  return {
    totalItems,
    completeCount,
    allComplete,
    showFu,
  }
}

function renderStatusBadge(allComplete: boolean, showFu: boolean) {
  if (allComplete) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '92px',
          height: '34px',
          textAlign: 'center',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 700,
          color: 'white',
          backgroundColor: '#16a34a',
          border: '1px solid #166534',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        Complete
      </span>
    )
  }

  if (showFu) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: '92px',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '62px',
            height: '34px',
            textAlign: 'center',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            color: 'white',
            backgroundColor: '#dc2626',
            border: '1px solid #991b1b',
            boxSizing: 'border-box',
          }}
        >
          Open
        </span>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '34px',
            textAlign: 'center',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 800,
            color: 'white',
            backgroundColor: '#2563eb',
            border: '1px solid #1d4ed8',
            boxSizing: 'border-box',
          }}
        >
          FU
        </span>
      </div>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '92px',
        height: '34px',
        textAlign: 'center',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 700,
        color: 'white',
        backgroundColor: '#dc2626',
        border: '1px solid #991b1b',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      Open
    </span>
  )
}

export default function OrdersTableClient({ initialOrders }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [editMode, setEditMode] = useState(false)
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null)

  const sortedOrders = useMemo(() => {
    return [...orders].sort(compareOrders)
  }, [orders])

  async function handleDeleteOrder(order: Order) {
    const label = order.requisition_number
      ? `requisition ${order.requisition_number}`
      : 'this order'

    const confirmed = window.confirm(
      `Are you sure you want to delete ${label}?`
    )

    if (!confirmed) return

    setDeletingOrderId(order.id)

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'DELETE',
      })

      const raw = await res.text()
      let data: { error?: string } | null = null

      try {
        data = raw ? JSON.parse(raw) : null
      } catch {
        data = null
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete order.')
      }

      setOrders((prev) => prev.filter((row) => row.id !== order.id))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Delete failed.')
    } finally {
      setDeletingOrderId(null)
    }
  }

  return (
    <main className="min-h-screen bg-white p-8 text-black">
      <div className="mb-6 flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Orders / Requisitions</h1>

        <div className="flex flex-wrap gap-3">
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

          <Link
            href="/search-missing-item"
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: '2px solid #1d4ed8',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              fontSize: '14px',
              lineHeight: 1.2,
              display: 'inline-block',
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            Search Missing Item
          </Link>

          <Link
            href="/mks-stock-list-search-v2"
            style={{
              backgroundColor: '#7c3aed',
              color: '#ffffff',
              border: '2px solid #6d28d9',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              fontSize: '14px',
              lineHeight: 1.2,
              display: 'inline-block',
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            MKs Stock List Search V2
          </Link>

          <Link
            href="/non-catalogue-items-list"
            style={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: '2px solid #991b1b',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              fontSize: '14px',
              lineHeight: 1.2,
              display: 'inline-block',
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            Non-Catalogue Items List
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
              const isDeleting = deletingOrderId === order.id
              const { totalItems, completeCount, allComplete, showFu } =
                getOrderStatusSummary(order)

              return (
                <tr
                  key={order.id}
                  className="border-b bg-white text-black even:bg-gray-50"
                >
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        {renderStatusBadge(allComplete, showFu)}

                        <span
                          style={{
                            minWidth: '52px',
                            fontWeight: 700,
                            fontSize: '14px',
                            color: '#111111',
                          }}
                        >
                          {completeCount}/{totalItems}
                        </span>
                      </div>

                      {editMode && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteOrder(order)}
                          disabled={isDeleting}
                          style={{
                            backgroundColor: '#facc15',
                            color: '#111111',
                            border: '2px solid #ca8a04',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            fontWeight: 700,
                            fontSize: '13px',
                            lineHeight: 1.2,
                            display: 'inline-block',
                            minWidth: '86px',
                            textAlign: 'center',
                            cursor: isDeleting ? 'not-allowed' : 'pointer',
                            opacity: isDeleting ? 0.6 : 1,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                          }}
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
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