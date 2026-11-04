'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type LevelFilter = 3 | 5 | 'both'

type ItemSuggestion = {
  item_no: string
  item_name: string
}

type OrderSummary = {
  id: string
  requisition_number: string | null
  po_number: string | null
  order_date: string | null
  level: number | null
}

type RawHistoryRow = {
  id: string
  order_id: string
  line_no: number | string
  item_no: string | null
  item_name: string | null
  qty_ordered: number | string | null
  qty_received: number | string | null
  complete: boolean | null
  follow_up: boolean | null
  back_order: boolean | null
  comments: string | null
  order: OrderSummary | OrderSummary[] | null
}

type HistoryRow = {
  id: string
  order_id: string
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  qty_received: number
  complete: boolean
  follow_up: boolean
  back_order: boolean
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

function getSortableTimestamp(value: string | null | undefined) {
  if (!value) return 0

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

  const fallback = new Date(trimmed).getTime()
  return Number.isNaN(fallback) ? 0 : fallback
}

function formatQty(value: number) {
  if (Number.isInteger(value)) return String(value)
  return String(value)
}

function normaliseHistoryRows(rows: RawHistoryRow[]): HistoryRow[] {
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
        back_order: row.back_order === true,
        comments: row.comments ?? '',
        order: orderValue,
      }
    })
    .sort((a, b) => {
      const dateDiff =
        getSortableTimestamp(b.order?.order_date) -
        getSortableTimestamp(a.order?.order_date)

      if (dateDiff !== 0) return dateDiff

      return b.line_no - a.line_no
    })
}

function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function normaliseNameForNoCodeDedup(value: string) {
  return cleanText(value).toLowerCase()
}

function scoreSuggestionName(name: string) {
  const cleaned = cleanText(name)
  const lower = cleaned.toLowerCase()

  let score = 0

  score += cleaned.length

  if (lower.includes('approved liquidated')) score += 500
  if (/\bapproved\b/.test(lower)) score += 100
  if (/\bliquidated\b/.test(lower)) score += 100

  const decimalMatches = cleaned.match(/\b\d+\.\d{1,2}\b/g)
  if (decimalMatches) {
    score += decimalMatches.length * 120
  }

  const packetCountMatches = cleaned.match(/\b\d+\s+packet\b/gi)
  if (packetCountMatches) {
    score += packetCountMatches.length * 50
  }

  return score
}

function choosePreferredSuggestion(rows: ItemSuggestion[]) {
  const cleanedRows = rows
    .map((row) => ({
      item_no: cleanText(row.item_no),
      item_name: cleanText(row.item_name),
    }))
    .filter((row) => row.item_no || row.item_name)

  if (cleanedRows.length === 0) {
    return {
      item_no: '',
      item_name: '',
    }
  }

  const sorted = [...cleanedRows].sort((a, b) => {
    const scoreDiff = scoreSuggestionName(a.item_name) - scoreSuggestionName(b.item_name)
    if (scoreDiff !== 0) return scoreDiff

    const nameLengthDiff = a.item_name.length - b.item_name.length
    if (nameLengthDiff !== 0) return nameLengthDiff

    return a.item_name.localeCompare(b.item_name, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  })

  return sorted[0]
}

function dedupeSuggestions(rows: ItemSuggestion[]) {
  const byCode = new Map<string, ItemSuggestion[]>()
  const noCodeMap = new Map<string, ItemSuggestion>()

  for (const row of rows) {
    const itemNo = cleanText(row.item_no)
    const itemName = cleanText(row.item_name)

    if (!itemNo && !itemName) continue

    if (itemNo) {
      const existing = byCode.get(itemNo) ?? []
      existing.push({
        item_no: itemNo,
        item_name: itemName,
      })
      byCode.set(itemNo, existing)
      continue
    }

    const noCodeKey = normaliseNameForNoCodeDedup(itemName)
    if (!noCodeMap.has(noCodeKey)) {
      noCodeMap.set(noCodeKey, {
        item_no: '',
        item_name: itemName,
      })
    }
  }

  const dedupedByCode = Array.from(byCode.values()).map((group) =>
    choosePreferredSuggestion(group)
  )

  const dedupedNoCode = Array.from(noCodeMap.values())

  return [...dedupedByCode, ...dedupedNoCode].sort((a, b) => {
    const nameCompare = a.item_name.localeCompare(b.item_name, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
    if (nameCompare !== 0) return nameCompare

    return a.item_no.localeCompare(b.item_no, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  })
}

export default function SearchMissingItemPage() {
  const supabase = createClient()

  const [query, setQuery] = useState('')
  const [activeLevel, setActiveLevel] = useState<LevelFilter>('both')
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [selectedItem, setSelectedItem] = useState<ItemSuggestion | null>(null)
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    'Type an item name or item code, then click Search'
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

  function setTemporaryStatus(message: string) {
    setStatusMessage(message)

    if (statusClearTimer.current) {
      clearTimeout(statusClearTimer.current)
    }

    statusClearTimer.current = setTimeout(() => {
      setStatusMessage('Ready')
    }, 1800)
  }

  async function handleSearch(level: LevelFilter = activeLevel) {
    const trimmed = query.trim()

    if (!trimmed) {
      setSuggestions([])
      setSelectedItem(null)
      setHistoryRows([])
      setStatusMessage('Enter an item code or item name first')
      return
    }

    setSearching(true)
    setSelectedItem(null)
    setHistoryRows([])
    setSuggestions([])
    setStatusMessage('Searching matching items...')

    // Search only orders from the selected level (or both levels).
    const codeQuery = supabase
      .from('order_items')
      .select('item_no, item_name, order:orders!inner(level)')
      .ilike('item_no', `%${trimmed}%`)
      .limit(25)

    const nameQuery = supabase
      .from('order_items')
      .select('item_no, item_name, order:orders!inner(level)')
      .ilike('item_name', `%${trimmed}%`)
      .limit(25)

    if (level !== 'both') {
      codeQuery.eq('order.level', level)
      nameQuery.eq('order.level', level)
    }

    const [codeResult, nameResult] = await Promise.all([codeQuery, nameQuery])

    setSearching(false)

    const firstError = codeResult.error || nameResult.error

    if (firstError) {
      setStatusMessage(`Search failed: ${firstError.message}`)
      return
    }

    const merged = dedupeSuggestions([
      ...((codeResult.data ?? []) as ItemSuggestion[]),
      ...((nameResult.data ?? []) as ItemSuggestion[]),
    ])

    setSuggestions(merged)

    if (merged.length === 0) {
      setStatusMessage('No matching items found')
      return
    }

    setStatusMessage(
      `Found ${merged.length} matching item${merged.length === 1 ? '' : 's'} — click the exact one`
    )
  }

  async function loadHistoryForSuggestion(
    suggestion: ItemSuggestion,
    level: LevelFilter = activeLevel
  ) {
    setSelectedItem(suggestion)
    setLoadingHistory(true)
    setHistoryRows([])
    setStatusMessage('Loading order history...')

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
        back_order,
        comments,
        order:orders!inner (
          id,
          requisition_number,
          po_number,
          order_date,
          level
        )
      `)

    if (suggestion.item_no.trim()) {
      queryBuilder = queryBuilder.eq('item_no', suggestion.item_no.trim())
    } else {
      queryBuilder = queryBuilder.eq('item_name', suggestion.item_name.trim())
    }

    if (level !== 'both') {
      queryBuilder = queryBuilder.eq('order.level', level)
    }

    const { data, error } = await queryBuilder

    setLoadingHistory(false)

    if (error) {
      setStatusMessage(`Failed to load order history: ${error.message}`)
      return
    }

    const normalised = normaliseHistoryRows((data ?? []) as RawHistoryRow[])
    setHistoryRows(normalised)

    if (normalised.length === 0) {
      setStatusMessage('No historical orders found for that item')
      return
    }

    setStatusMessage(
      `Showing ${normalised.length} order row${normalised.length === 1 ? '' : 's'}`
    )
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
    row: HistoryRow,
    successMessage: string
  ) {
    setStatusMessage(`Saving requisition ${row.order?.requisition_number ?? 'row'}...`)

    const { error } = await supabase
      .from('order_items')
      .update({
        qty_received: row.qty_received,
        complete: row.complete,
        follow_up: row.follow_up,
        back_order: row.back_order,
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

  function scheduleSave(row: HistoryRow, successMessage: string, delay = 700) {
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

  function handleBackOrderToggle(rowId: string) {
    setHistoryRows((prev) => {
      const updated = prev.map((row) =>
        row.id === rowId ? { ...row, back_order: !row.back_order } : row
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

  function handleLevelChange(level: LevelFilter) {
    setActiveLevel(level)

    if (selectedItem) {
      // Keep the chosen item and reload its history for the selected level.
      setSuggestions([])
      void loadHistoryForSuggestion(selectedItem, level)
    } else if (query.trim()) {
      // Refresh search suggestions when switching levels.
      void handleSearch(level)
    } else {
      setStatusMessage('Type an item name or item code, then click Search')
    }
  }

  function clearSearch() {
    setQuery('')
    setSuggestions([])
    setSelectedItem(null)
    setHistoryRows([])
    setStatusMessage('Type an item name or item code, then click Search')
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
          Search Missing Item
        </div>
      </div>

      <h1 className="mb-6 text-2xl font-bold">Search Missing Item</h1>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 font-bold">Show level:</span>
        {([3, 5, 'both'] as const).map((level) => {
          const isActive = activeLevel === level
          return (
            <button
              key={level}
              type="button"
              onClick={() => handleLevelChange(level)}
              aria-pressed={isActive}
              style={{
                backgroundColor: isActive ? '#facc15' : '#ffffff',
                color: '#111111',
                border: '3px solid #111111',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: 800,
                fontSize: '15px',
                cursor: 'pointer',
                boxShadow: isActive ? '0 2px 5px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              {isActive ? '✓ ' : ''}
              {level === 'both' ? 'Both Levels' : `Level ${level}`}
            </button>
          )
        })}
      </div>

      <div className="mb-4 text-sm text-gray-700">{statusMessage}</div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSearch()
        }}
        className="mb-6 flex flex-wrap items-center gap-3"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by item code or item name"
          className="w-full max-w-xl rounded border bg-white p-3 text-black"
        />

        <button
          type="submit"
          disabled={searching}
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
            minWidth: '110px',
            textAlign: 'center',
            cursor: searching ? 'not-allowed' : 'pointer',
            opacity: searching ? 0.6 : 1,
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>

        <button
          type="button"
          onClick={clearSearch}
          className="rounded border bg-white px-4 py-2 text-black"
        >
          Clear
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="mb-8 rounded border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Matching Items — click the exact one
          </h2>

          <div className="grid gap-3">
            {suggestions.map((suggestion) => {
              const key = `${suggestion.item_no}|||${suggestion.item_name}`
              const isSelected =
                selectedItem?.item_no === suggestion.item_no &&
                selectedItem?.item_name === suggestion.item_name

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void loadHistoryForSuggestion(suggestion)}
                  style={{
                    backgroundColor: isSelected ? '#dbeafe' : '#ffffff',
                    color: '#111111',
                    border: isSelected
                      ? '2px solid #2563eb'
                      : '1px solid #d1d5db',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div>{suggestion.item_name || 'Unnamed item'}</div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#4b5563',
                      marginTop: '4px',
                    }}
                  >
                    Code: {suggestion.item_no || '—'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selectedItem && (
        <div className="mb-4 rounded border bg-gray-50 p-4">
          <div className="font-semibold">Selected Item</div>
          <div className="mt-1">{selectedItem.item_name || 'Unnamed item'}</div>
          <div className="text-sm text-gray-600">
            Code: {selectedItem.item_no || '—'}
          </div>
        </div>
      )}

      {loadingHistory && (
        <div className="rounded border bg-white p-4">Loading order history...</div>
      )}

      {!loadingHistory && selectedItem && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-100 text-left text-black">
                <th className="p-3 font-semibold">Req No.</th>
                <th className="p-3 font-semibold">Level</th>
                <th className="p-3 font-semibold">PO No.</th>
                <th className="p-3 font-semibold">Item</th>
                <th className="p-3 font-semibold">Code</th>
                <th className="p-3 font-semibold">Qty Ordered</th>
                <th className="p-3 font-semibold">Qty Received</th>
                <th className="p-3 font-semibold">Date Ordered</th>
                <th className="p-3 font-semibold">Complete</th>
                <th className="p-3 font-semibold">Follow Up</th>
                <th className="p-3 font-semibold">Back Order</th>
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
                  <td className="p-3">
                    {row.order?.level === 3 || row.order?.level === 5
                      ? `Level ${row.order.level}`
                      : '—'}
                  </td>
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
                    <button
                      type="button"
                      onClick={() => handleBackOrderToggle(row.id)}
                      title="Back Order"
                      aria-label="Back Order"
                      aria-pressed={row.back_order}
                      style={{
                        width: '20px',
                        height: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        border: row.back_order
                          ? '2px solid #c2410c'
                          : '2px solid #9ca3af',
                        backgroundColor: row.back_order ? '#f97316' : '#ffffff',
                        color: row.back_order ? '#ffffff' : 'transparent',
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
                  <td colSpan={13} className="p-6 text-center text-gray-500">
                    No order history found for this item.
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