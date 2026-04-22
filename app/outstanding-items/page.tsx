'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const THRESHOLD_OPTIONS = [7, 14, 28] as const

type ThresholdDays = (typeof THRESHOLD_OPTIONS)[number]
type SortMode = 'recent_to_oldest' | 'oldest_to_recent'

type OrderSummary = {
  id: string
  requisition_number: string | null
  po_number: string | null
  order_date: string | null
  order_date_sort: string | null
}

type RawOutstandingRow = {
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

type OutstandingRow = {
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

function parseDateToTimestamp(value: string | null | undefined) {
  if (!value) return NaN

  const trimmed = value.trim()

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2]) - 1
    const day = Number(isoMatch[3])
    return new Date(year, month, day).getTime()
  }

  const auMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/)
  if (auMatch) {
    const day = Number(auMatch[1])
    const month = Number(auMatch[2]) - 1
    let year = Number(auMatch[3])

    if (auMatch[3].length === 2) {
      year += 2000
    }

    return new Date(year, month, day).getTime()
  }

  return new Date(trimmed).getTime()
}

function getDaysOld(order: OrderSummary | null) {
  const rawDate = order?.order_date_sort || order?.order_date || null
  const orderTimestamp = parseDateToTimestamp(rawDate)

  if (Number.isNaN(orderTimestamp)) return -1

  const orderDate = new Date(orderTimestamp)
  const today = new Date()

  const orderStart = new Date(
    orderDate.getFullYear(),
    orderDate.getMonth(),
    orderDate.getDate()
  )

  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  )

  const diffMs = todayStart.getTime() - orderStart.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function formatQty(value: number) {
  if (Number.isInteger(value)) return String(value)
  return String(value)
}

function getThresholdHeading(days: ThresholdDays) {
  if (days === 7) return 'Items not arrived exceeding 7 days'
  if (days === 14) return 'Items not arrived exceeding 14 days'
  return 'Items not arrived exceeding 28 days'
}

function normaliseOutstandingRows(rows: RawOutstandingRow[]): OutstandingRow[] {
  return rows.map((row) => {
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
}

function sortOutstandingRows(
  rows: OutstandingRow[],
  sortMode: SortMode
) {
  return [...rows].sort((a, b) => {
    const dateA = parseDateToTimestamp(a.order?.order_date_sort || a.order?.order_date)
    const dateB = parseDateToTimestamp(b.order?.order_date_sort || b.order?.order_date)

    if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
      return sortMode === 'recent_to_oldest' ? dateB - dateA : dateA - dateB
    }

    const reqA = a.order?.requisition_number ?? ''
    const reqB = b.order?.requisition_number ?? ''

    const reqCompare = reqA.localeCompare(reqB, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
    if (reqCompare !== 0) return reqCompare

    if (a.line_no !== b.line_no) {
      return a.line_no - b.line_no
    }

    return a.id.localeCompare(b.id)
  })
}

export default function OutstandingItemsPage() {
  const supabase = createClient()

  const [activeThreshold, setActiveThreshold] = useState<ThresholdDays>(7)
  const [sortMode, setSortMode] = useState<SortMode>('recent_to_oldest')
  const [historyRows, setHistoryRows] = useState<OutstandingRow[]>([])
  const [loadingOutstanding, setLoadingOutstanding] = useState(true)
  const [statusMessage, setStatusMessage] = useState('Loading outstanding items...')

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
    void loadOutstandingItems(activeThreshold)
  }, [])

  const sortedHistoryRows = useMemo(() => {
    return sortOutstandingRows(historyRows, sortMode)
  }, [historyRows, sortMode])

  function setTemporaryStatus(message: string) {
    setStatusMessage(message)

    if (statusClearTimer.current) {
      clearTimeout(statusClearTimer.current)
    }

    statusClearTimer.current = setTimeout(() => {
      setStatusMessage(getThresholdHeading(activeThreshold))
    }, 1800)
  }

  async function loadOutstandingItems(thresholdDays: ThresholdDays) {
    setLoadingOutstanding(true)
    setHistoryRows([])
    setStatusMessage(`Loading items not arrived exceeding ${thresholdDays} days...`)

    const { data, error } = await supabase
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
      .or('complete.eq.false,complete.is.null')

    setLoadingOutstanding(false)

    if (error) {
      setStatusMessage(`Failed to load outstanding items: ${error.message}`)
      return
    }

    const normalised = normaliseOutstandingRows((data ?? []) as RawOutstandingRow[])

    const filtered = normalised.filter((row) => {
      if (row.complete) return false

      const daysOld = getDaysOld(row.order)
      return daysOld >= thresholdDays
    })

    setHistoryRows(filtered)

    if (filtered.length === 0) {
      setStatusMessage(`No outstanding items found exceeding ${thresholdDays} days`)
      return
    }

    setStatusMessage(getThresholdHeading(thresholdDays))
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
    row: OutstandingRow,
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

  function scheduleSave(row: OutstandingRow, successMessage: string, delay = 700) {
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

  async function handleThresholdChange(days: ThresholdDays) {
    setActiveThreshold(days)
    await loadOutstandingItems(days)
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
          Outstanding Items
        </div>
      </div>

      <h1 className="mb-4 text-2xl font-bold">Outstanding Items</h1>

      <div
        style={{
          marginBottom: '16px',
          padding: '12px 14px',
          border: '1px solid #d1d5db',
          borderRadius: '8px',
          backgroundColor: '#f9fafb',
          fontWeight: 700,
          fontSize: '16px',
        }}
      >
        {getThresholdHeading(activeThreshold)}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {THRESHOLD_OPTIONS.map((days) => {
          const isActive = activeThreshold === days

          return (
            <button
              key={days}
              type="button"
              onClick={() => void handleThresholdChange(days)}
              style={{
                backgroundColor: isActive ? '#16a34a' : '#ffffff',
                color: isActive ? '#ffffff' : '#111111',
                border: isActive ? '2px solid #166534' : '2px solid #111111',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: 700,
                fontSize: '14px',
                lineHeight: 1.2,
                display: 'inline-block',
                minWidth: '190px',
                textAlign: 'center',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              }}
            >
              {days === 7
                ? 'Exceeding 7 days'
                : days === 14
                  ? 'Exceeding 14 days'
                  : 'Exceeding 28 days'}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setSortMode('recent_to_oldest')}
          style={{
            backgroundColor: sortMode === 'recent_to_oldest' ? '#16a34a' : '#ffffff',
            color: sortMode === 'recent_to_oldest' ? '#ffffff' : '#111111',
            border: sortMode === 'recent_to_oldest' ? '2px solid #166534' : '2px solid #111111',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: '14px',
            lineHeight: 1.2,
            display: 'inline-block',
            minWidth: '190px',
            textAlign: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          Sort: Recent to Oldest
        </button>

        <button
          type="button"
          onClick={() => setSortMode('oldest_to_recent')}
          style={{
            backgroundColor: sortMode === 'oldest_to_recent' ? '#16a34a' : '#ffffff',
            color: sortMode === 'oldest_to_recent' ? '#ffffff' : '#111111',
            border: sortMode === 'oldest_to_recent' ? '2px solid #166534' : '2px solid #111111',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: '14px',
            lineHeight: 1.2,
            display: 'inline-block',
            minWidth: '190px',
            textAlign: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          Sort: Oldest to Recent
        </button>

        <button
          type="button"
          onClick={() => void loadOutstandingItems(activeThreshold)}
          className="rounded border bg-white px-4 py-2 text-black"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 text-sm text-gray-700">{statusMessage}</div>

      {loadingOutstanding && (
        <div className="rounded border bg-white p-4">
          Loading outstanding items...
        </div>
      )}

      {!loadingOutstanding && (
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
              {sortedHistoryRows.map((row) => (
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

              {sortedHistoryRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-gray-500">
                    No outstanding items found for this threshold.
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