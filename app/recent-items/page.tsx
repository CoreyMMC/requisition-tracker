'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const RECENT_ORDER_LIMIT = 300
const RECENT_ITEM_LIMIT = 300

type OrderSummary = {
  id: string
  requisition_number: string | null
  po_number: string | null
  order_date: string | null
  order_date_sort: string | null
}

type RawRecentRow = {
  id: string
  order_id: string
  line_no: number | string
  item_no: string | null
  item_name: string | null
  qty_ordered: number | string | null
  qty_received: number | string | null
  complete: boolean | null
  follow_up: boolean | null
  comments: string | null
  order: OrderSummary | OrderSummary[] | null
}

type RecentRow = {
  id: string
  order_id: string
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  qty_received: number
  complete: boolean
  follow_up: boolean
  comments: string
  order: OrderSummary | null
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

function formatQty(value: number) {
  if (Number.isInteger(value)) return String(value)
  return String(value)
}

function getDefaultStatusMessage(showCompleted: boolean) {
  return showCompleted
    ? `Showing up to the last ${RECENT_ITEM_LIMIT} recent items`
    : `Showing up to the last ${RECENT_ITEM_LIMIT} recent items that still need action`
}

function normaliseRecentRows(
  rows: RawRecentRow[],
  orderRankMap: Map<string, number>
): RecentRow[] {
  return rows
    .map((row) => {
      const orderValue = Array.isArray(row.order)
        ? row.order[0] ?? null
        : row.order ?? null

      return {
        id: row.id,
        order_id: row.order_id,
        line_no: Number(row.line_no ?? 0),
        item_no: row.item_no ?? '',
        item_name: row.item_name ?? '',
        qty_ordered: Number(row.qty_ordered ?? 0),
        qty_received: Number(row.qty_received ?? 0),
        complete: row.complete === true,
        follow_up: row.follow_up === true,
        comments: row.comments ?? '',
        order: orderValue,
      }
    })
    .sort((a, b) => {
      const rankA = orderRankMap.get(a.order_id) ?? Number.MAX_SAFE_INTEGER
      const rankB = orderRankMap.get(b.order_id) ?? Number.MAX_SAFE_INTEGER

      if (rankA !== rankB) return rankA - rankB
      if (a.line_no !== b.line_no) return a.line_no - b.line_no

      return a.id.localeCompare(b.id)
    })
    .slice(0, RECENT_ITEM_LIMIT)
}

export default function RecentItemsPage() {
  const supabase = createClient()

  const [showCompleted, setShowCompleted] = useState(true)
  const [historyRows, setHistoryRows] = useState<RecentRow[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [statusMessage, setStatusMessage] = useState(
    'Loading recent items...'
  )

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const statusClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach(clearTimeout)

      if (statusClearTimer.current) {
        clearTimeout(statusClearTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    void loadRecentItems(true)
  }, [])

  function setTemporaryStatus(message: string) {
    setStatusMessage(message)

    if (statusClearTimer.current) {
      clearTimeout(statusClearTimer.current)
    }

    statusClearTimer.current = setTimeout(() => {
      setStatusMessage(getDefaultStatusMessage(showCompleted))
    }, 1800)
  }

  async function loadRecentItems(includeCompleted: boolean) {
    setLoadingRecent(true)
    setHistoryRows([])
    setStatusMessage(
      includeCompleted
        ? 'Loading recent items...'
        : 'Loading recent items still needing action...'
    )

    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('id, requisition_number, po_number, order_date, order_date_sort')
      .order('order_date_sort', { ascending: false, nullsFirst: false })
      .order('order_date', { ascending: false, nullsFirst: false })
      .order('requisition_number', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(RECENT_ORDER_LIMIT)

    if (ordersError) {
      setLoadingRecent(false)
      setStatusMessage(`Failed to load recent orders: ${ordersError.message}`)
      return
    }

    const recentOrders = (ordersData ?? []) as OrderSummary[]
    const orderIds = recentOrders.map((order) => order.id)

    if (orderIds.length === 0) {
      setLoadingRecent(false)
      setStatusMessage('No recent orders found')
      return
    }

    const orderRankMap = new Map<string, number>()
    recentOrders.forEach((order, index) => {
      orderRankMap.set(order.id, index)
    })

    let queryBuilder = supabase
      .from('order_items')
      .select(`
        id,
        order_id,
        line_no,
        item_no,
        item_name,
        qty_ordered,
        qty_received,
        complete,
        follow_up,
        comments,
        order:orders!inner (
          id,
          requisition_number,
          po_number,
          order_date,
          order_date_sort
        )
      `)
      .in('order_id', orderIds)

    if (!includeCompleted) {
      queryBuilder = queryBuilder.or('complete.neq.true,follow_up.eq.true')
    }

    const { data: itemsData, error: itemsError } = await queryBuilder

    setLoadingRecent(false)

    if (itemsError) {
      setStatusMessage(`Failed to load recent items: ${itemsError.message}`)
      return
    }

    const normalised = normaliseRecentRows(
      (itemsData ?? []) as RawRecentRow[],
      orderRankMap
    )

    setHistoryRows(normalised)

    if (normalised.length === 0) {
      setStatusMessage(
        includeCompleted
          ? 'No recent items found'
          : 'No recent incomplete or follow-up items found'
      )
      return
    }

    setStatusMessage(getDefaultStatusMessage(includeCompleted))
  }

  async function syncParentOrderComplete(orderId: string) {
    const { data, error } = await supabase
      .from('order_items')
      .select('complete')
      .eq('order_id', orderId)

    if (error) {
      throw new Error(error.message)
    }

    const orderComplete =
      (data ?? []).length > 0 && (data ?? []).every((row) => row.complete === true)

    const { error: updateError } = await supabase
      .from('orders')
      .update({ order_complete: orderComplete })
      .eq('id', orderId)

    if (updateError) {
      throw new Error(updateError.message)
    }
  }

  async function saveSingleHistoryRow(
    row: RecentRow,
    successMessage: string
  ) {
    setStatusMessage(`Saving requisition ${row.order?.requisition_number ?? 'row'}...`)

    const { error } = await supabase
      .from('order_items')
      .update({
        qty_received: row.qty_received,
        complete: row.complete,
        follow_up: row.follow_up,
        comments: row.comments,
      })
      .eq('id', row.id)

    if (error) {
      setStatusMessage(`Save failed: ${error.message}`)
      return
    }

    try {
      await syncParentOrderComplete(row.order_id)
      setTemporaryStatus(successMessage)
    } catch (syncError) {
      setStatusMessage(
        syncError instanceof Error
          ? `Item saved, but order status failed: ${syncError.message}`
          : 'Item saved, but order status failed'
      )
    }
  }

  function scheduleSave(row: RecentRow, successMessage: string, delay = 700) {
    if (autosaveTimers.current[row.id]) {
      clearTimeout(autosaveTimers.current[row.id])
    }

    autosaveTimers.current[row.id] = setTimeout(() => {
      void saveSingleHistoryRow(row, successMessage)
    }, delay)
  }

  function handleQtyReceivedChange(rowId: string, rawValue: string) {
    const parsed = Number(rawValue)

    setHistoryRows((prev) => {
      const updated = prev.map((row) => {
        if (row.id !== rowId) return row

        const safeQtyReceived = Number.isNaN(parsed) ? 0 : parsed
        const becomesComplete = safeQtyReceived >= row.qty_ordered

        return {
          ...row,
          qty_received: safeQtyReceived,
          complete: becomesComplete,
          follow_up: becomesComplete ? false : row.follow_up,
        }
      })

      const changedRow = updated.find((row) => row.id === rowId)
      if (changedRow) {
        scheduleSave(changedRow, `Saved ${changedRow.item_name}`, 700)
      }

      return updated
    })
  }

  function handleCompleteToggle(rowId: string) {
    setHistoryRows((prev) => {
      const updated = prev.map((row) => {
        if (row.id !== rowId) return row

        if (!row.complete) {
          return {
            ...row,
            qty_received: row.qty_ordered,
            complete: true,
            follow_up: false,
          }
        }

        return {
          ...row,
          complete: false,
        }
      })

      const changedRow = updated.find((row) => row.id === rowId)
      if (changedRow) {
        scheduleSave(changedRow, `Saved ${changedRow.item_name}`, 150)
      }

      return updated
    })
  }

  function handleFollowUpToggle(rowId: string) {
    setHistoryRows((prev) => {
      const updated = prev.map((row) =>
        row.id === rowId ? { ...row, follow_up: !row.follow_up } : row
      )

      const changedRow = updated.find((row) => row.id === rowId)
      if (changedRow) {
        scheduleSave(changedRow, `Saved ${changedRow.item_name}`, 150)
      }

      return updated
    })
  }

  function handleCommentsChange(rowId: string, value: string) {
    setHistoryRows((prev) => {
      const updated = prev.map((row) =>
        row.id === rowId ? { ...row, comments: value } : row
      )

      const changedRow = updated.find((row) => row.id === rowId)
      if (changedRow) {
        scheduleSave(changedRow, `Saved ${changedRow.item_name}`, 900)
      }

      return updated
    })
  }

  async function handleToggleShowCompleted() {
    const nextValue = !showCompleted
    setShowCompleted(nextValue)
    await loadRecentItems(nextValue)
  }

  return (
    <main className="min-h-screen bg-white p-8 text-black">
      <div
        style={{
          border: '4px solid blue',
          padding: '12px',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: '#f3f4f6',
        }}
      >
        <Link
          href="/orders"
          style={{
            backgroundColor: 'black',
            color: 'white',
            border: '2px solid black',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 700,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Back to Orders
        </Link>

        <div
          style={{
            fontWeight: 700,
            fontSize: '16px',
          }}
        >
          Recent Items
        </div>
      </div>

      <h1 className="mb-6 text-2xl font-bold">Recent Items</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleToggleShowCompleted()}
          style={{
            backgroundColor: showCompleted ? '#16a34a' : '#dc2626',
            color: '#ffffff',
            border: showCompleted ? '2px solid #166534' : '2px solid #991b1b',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: '14px',
            lineHeight: 1.2,
            display: 'inline-block',
            minWidth: '210px',
            textAlign: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          {showCompleted
            ? 'Toggle Completed: ON'
            : 'Toggle Completed: OFF'}
        </button>

        <button
          type="button"
          onClick={() => void loadRecentItems(showCompleted)}
          className="rounded border bg-white px-4 py-2 text-black"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 text-sm text-gray-700">{statusMessage}</div>

      {loadingRecent && (
        <div className="rounded border bg-white p-4">Loading recent items...</div>
      )}

      {!loadingRecent && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-100 text-left text-black">
                <th className="p-3 font-semibold">Req No.</th>
                <th className="p-3 font-semibold">PO No.</th>
                <th className="p-3 font-semibold">Item</th>
                <th className="p-3 font-semibold">Code</th>
                <th className="p-3 font-semibold">Qty Ordered</th>
                <th className="p-3 font-semibold">Qty Received</th>
                <th className="p-3 font-semibold">Date Ordered</th>
                <th className="p-3 font-semibold">Complete</th>
                <th className="p-3 font-semibold">Follow Up</th>
                <th className="p-3 font-semibold">Comments</th>
                <th className="p-3 font-semibold">Open Order</th>
              </tr>
            </thead>

            <tbody>
              {historyRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b align-top bg-white text-black even:bg-gray-50"
                >
                  <td className="p-3">{row.order?.requisition_number || '—'}</td>
                  <td className="p-3">{row.order?.po_number || '—'}</td>
                  <td className="p-3">{row.item_name || '—'}</td>
                  <td className="p-3">{row.item_no || '—'}</td>
                  <td className="p-3">{formatQty(row.qty_ordered)}</td>
                  <td className="p-3">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="w-24 rounded border bg-white p-2 text-black"
                      value={row.qty_received}
                      onChange={(e) =>
                        handleQtyReceivedChange(row.id, e.target.value)
                      }
                    />
                  </td>
                  <td className="p-3">
                    {formatDateForDisplay(row.order?.order_date)}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => handleCompleteToggle(row.id)}
                      title="Complete"
                      style={{
                        width: '20px',
                        height: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        border: row.complete
                          ? '2px solid #166534'
                          : '2px solid #9ca3af',
                        backgroundColor: row.complete ? '#16a34a' : '#ffffff',
                        color: row.complete ? '#ffffff' : 'transparent',
                        fontSize: '12px',
                        fontWeight: 700,
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      ✓
                    </button>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => handleFollowUpToggle(row.id)}
                      title="Follow Up"
                      style={{
                        width: '20px',
                        height: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        border: row.follow_up
                          ? '2px solid #991b1b'
                          : '2px solid #9ca3af',
                        backgroundColor: row.follow_up ? '#dc2626' : '#ffffff',
                        color: row.follow_up ? '#ffffff' : 'transparent',
                        fontSize: '12px',
                        fontWeight: 700,
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      ✓
                    </button>
                  </td>
                  <td className="p-3">
                    <input
                      type="text"
                      className="w-72 rounded border bg-white p-2 text-black"
                      value={row.comments}
                      onChange={(e) =>
                        handleCommentsChange(row.id, e.target.value)
                      }
                    />
                  </td>
                  <td className="p-3">
                    <Link href={`/orders/${row.order_id}`} className="underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}

              {historyRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-gray-500">
                    No recent items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}