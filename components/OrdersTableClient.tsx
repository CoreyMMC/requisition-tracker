'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  level?: number | null
  order_items?: OrderItemSummary[] | null
}
type Props = {
  initialOrders: Order[]
}
const STATUS_TILE_WIDTH = 118
const STATUS_TILE_HEIGHT = 34
const SPLIT_TILE_GAP = 4
const SPLIT_OPEN_WIDTH = 42
const SPLIT_FOLLOW_UP_WIDTH =
  STATUS_TILE_WIDTH - SPLIT_OPEN_WIDTH - SPLIT_TILE_GAP
function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
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
  const auMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
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
// The warning is based on the order date, using calendar days (not 24-hour periods).
function isOrderAtLeastSevenDaysOld(order: Order) {
  const dateText = (order.order_date_sort || order.order_date || '').trim()
  if (!dateText) return false

  const orderTimestamp = getSortableTimestamp(order)
  if (!orderTimestamp || !Number.isFinite(orderTimestamp)) return false

  const orderDate = new Date(orderTimestamp)
  const today = new Date()
  const orderDay = Date.UTC(
    orderDate.getFullYear(),
    orderDate.getMonth(),
    orderDate.getDate()
  )
  const todayDay = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  )

  return (todayDay - orderDay) / (1000 * 60 * 60 * 24) >= 7
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
    items.every((item) => item.complete === true || item.follow_up === true)
  const showFollowUp = !allComplete && allAddressed
  // Do not warn if every remaining open item is already flagged for Follow Up.
  const showOverdueWarning =
    isOrderAtLeastSevenDaysOld(order) &&
    items.some((item) => item.complete !== true && item.follow_up !== true)

  return {
    totalItems,
    completeCount,
    allComplete,
    showFollowUp,
    showOverdueWarning,
  }
}
function baseStatusTileStyle(backgroundColor: string, borderColor: string) {
  return {
    display: 'inline-flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: `${STATUS_TILE_WIDTH}px`,
    height: `${STATUS_TILE_HEIGHT}px`,
    textAlign: 'center' as const,
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#ffffff',
    backgroundColor,
    border: `1px solid ${borderColor}`,
    boxSizing: 'border-box' as const,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    padding: '0 10px',
  }
}
function renderStatusBadge(allComplete: boolean, showFollowUp: boolean) {
  if (allComplete) {
    return (
      <span style={baseStatusTileStyle('#16a34a', '#166534')}>
        Complete
      </span>
    )
  }
  if (showFollowUp) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: `${STATUS_TILE_WIDTH}px`,
          gap: `${SPLIT_TILE_GAP}px`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: `${SPLIT_OPEN_WIDTH}px`,
            height: `${STATUS_TILE_HEIGHT}px`,
            textAlign: 'center',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#ffffff',
            backgroundColor: '#dc2626',
            border: '1px solid #991b1b',
            boxSizing: 'border-box',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            padding: '0 4px',
          }}
        >
          Open
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: `${SPLIT_FOLLOW_UP_WIDTH}px`,
            height: `${STATUS_TILE_HEIGHT}px`,
            textAlign: 'center',
            borderRadius: '8px',
            fontSize: '9px',
            fontWeight: 800,
            color: '#ffffff',
            backgroundColor: '#2563eb',
            border: '1px solid #1d4ed8',
            boxSizing: 'border-box',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            padding: '0 3px',
            letterSpacing: '0.1px',
          }}
        >
          Follow Up ✓
        </span>
      </div>
    )
  }
  return (
    <span style={baseStatusTileStyle('#dc2626', '#991b1b')}>
      Open
    </span>
  )
}
export default function OrdersTableClient({ initialOrders }: Props) {
  const router = useRouter()
  const [orders, setOrders] = useState(initialOrders)
  const [editMode, setEditMode] = useState(false)
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null)
  const [selectedLevels, setSelectedLevels] = useState<number[]>([3, 5])

  // Use the latest orders when the server refreshes this page.
  useEffect(() => {
    setOrders(initialOrders)
  }, [initialOrders])

  // Refresh order/item statuses on return from an order details page.
  // Next.js preserves the current scroll position during router.refresh().
  useEffect(() => {
    router.refresh()
  }, [router])

  // Keep the selected levels when navigating between tracker pages.
  useEffect(() => {
    const saved = window.localStorage.getItem('requisition-tracker-visible-levels')
    if (saved === '3') setSelectedLevels([3])
    if (saved === '5') setSelectedLevels([5])
    if (saved === '3,5' || saved === '5,3') setSelectedLevels([3, 5])
  }, [])

  function selectLevels(levels: number[]) {
    setSelectedLevels(levels)
    window.localStorage.setItem(
      'requisition-tracker-visible-levels',
      levels.join(',')
    )
  }

  const sortedOrders = useMemo(() => {
    return [...orders].sort(compareOrders)
  }, [orders])

  const visibleOrders = useMemo(() => {
    return sortedOrders.filter((order) =>
      selectedLevels.includes(order.level === 5 ? 5 : 3)
    )
  }, [sortedOrders, selectedLevels])
  function handleBackToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }
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
        <div>
          <h1 className="text-4xl font-black tracking-tight">
            Requisition Tracker V3
          </h1>
          <h2 className="mt-2 text-2xl font-bold">
            Orders / Requisitions
          </h2>
        </div>
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
            Manual Order Entry
          </Link>
          <Link
            href="/upload"
            style={{
              backgroundColor: '#22c55e',
              color: '#111111',
              border: '4px solid #166534',
              borderRadius: '10px',
              padding: '14px 22px',
              fontWeight: 900,
              fontSize: '16px',
              lineHeight: 1.1,
              display: 'inline-block',
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              letterSpacing: '0.4px',
            }}
          >
            UPLOAD PDF
          </Link>
          <Link
            href="/recent-items"
            style={{
              backgroundColor: '#0f766e',
              color: '#ffffff',
              border: '2px solid #115e59',
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
            Recent Items
          </Link>
          <Link
            href="/outstanding-items"
            style={{
              backgroundColor: '#ea580c',
              color: '#ffffff',
              border: '2px solid #c2410c',
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
            Outstanding Items
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
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border-2 border-gray-300 bg-white p-4">
        <span className="text-base font-bold text-black">Show orders:</span>
        {[
          { label: 'L3', levels: [3] },
          { label: 'L5', levels: [5] },
          { label: 'Both Levels', levels: [3, 5] },
        ].map((option) => {
          const active =
            selectedLevels.length === option.levels.length &&
            option.levels.every((level) => selectedLevels.includes(level))
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => selectLevels(option.levels)}
              className="focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{
                backgroundColor: active ? '#facc15' : '#ffffff',
                color: '#111111',
                border: active ? '3px solid #a16207' : '3px solid #111111',
                borderRadius: '10px',
                padding: '12px 20px',
                fontSize: '16px',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: active ? '0 3px 7px rgba(0,0,0,0.22)' : 'none',
              }}
            >
              {active ? '✓ ' : ''}{option.label}
            </button>
          )
        })}
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-100 text-left text-black">
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold">Level</th>
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
              const {
                totalItems,
                completeCount,
                allComplete,
                showFollowUp,
                showOverdueWarning,
              } = getOrderStatusSummary(order)
              return (
                <tr
                  key={order.id}
                  style={{
                    display: selectedLevels.includes(order.level === 5 ? 5 : 3)
                      ? undefined
                      : 'none',
                  }}
                  className="border-b bg-white text-black even:bg-gray-50"
                >
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        {renderStatusBadge(allComplete, showFollowUp)}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                            flexShrink: 0,
                            fontWeight: 700,
                            fontSize: '14px',
                            color: '#111111',
                          }}
                        >
                          {/* A five-character count slot keeps warning triangles vertically aligned.
                              The triangle stays close to a count such as 28/42; shorter counts
                              such as 4/9 begin at the same left edge. */}
                          <span
                            style={{
                              width: '5ch',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                              fontVariantNumeric: 'tabular-nums',
                              textAlign: 'left',
                            }}
                          >
                            {completeCount}/{totalItems}
                          </span>
                          {showOverdueWarning && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '24px',
                                height: '24px',
                                flexShrink: 0,
                              }}
                            >
                              <svg
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                role="img"
                                aria-label="Overdue: an open item is at least 7 days old and is not marked Follow Up"
                              >
                                <title>
                                  At least 7 days old: an open item needs follow-up
                                </title>
                                <path
                                  d="M12 2.5 22.2 20.5H1.8L12 2.5Z"
                                  fill="#facc15"
                                  stroke="#111111"
                                  strokeWidth="2"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M12 8v5.8"
                                  fill="none"
                                  stroke="#111111"
                                  strokeWidth="2.4"
                                  strokeLinecap="round"
                                />
                                <circle cx="12" cy="17.4" r="1.25" fill="#111111" />
                              </svg>
                            </span>
                          )}
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
                  <td className="whitespace-nowrap p-3 font-semibold">
                    L{order.level === 5 ? 5 : 3}
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
                    <EditableOrderField
                      orderId={order.id}
                      field="order_date"
                      initialValue={order.order_date}
                      editMode={editMode}
                    />
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
            {visibleOrders.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No orders found for the selected level(s).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={handleBackToTop}
        aria-label="Back to top"
        style={{
          position: 'fixed',
          right: '24px',
          bottom: '24px',
          zIndex: 9999,
          backgroundColor: '#111111',
          color: '#ffffff',
          border: '2px solid #000000',
          borderRadius: '9999px',
          padding: '12px 18px',
          fontWeight: 800,
          fontSize: '14px',
          lineHeight: 1,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        ↑ Back to top
      </button>
    </main>
  )
}
