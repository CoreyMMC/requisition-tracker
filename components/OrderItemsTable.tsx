'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type OrderItem = {
  id: string
  order_id: string
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  amount_aud: number | null
  qty_received: number
  complete: boolean
  follow_up: boolean
  comments: string | null
}

type Props = {
  orderId: string
  initialItems: OrderItem[]
  editMode: boolean
}

type EditableField =
  | 'line_no'
  | 'item_no'
  | 'item_name'
  | 'qty_ordered'
  | 'amount_aud'

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
}

function sortByLineNo(rows: OrderItem[]) {
  return [...rows].sort((a, b) => a.line_no - b.line_no)
}

export default function OrderItemsTable({
  orderId,
  initialItems,
  editMode,
}: Props) {
  const supabase = createClient()

  const [items, setItems] = useState(sortByLineNo(initialItems))
  const [statusMessage, setStatusMessage] = useState('Autosave is on')
  const [savingAll, setSavingAll] = useState(false)

  const [editingCell, setEditingCell] = useState<{
    itemId: string
    field: EditableField
  } | null>(null)
  const [cellDraft, setCellDraft] = useState('')

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const statusClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setItems(sortByLineNo(initialItems))
  }, [initialItems])

  useEffect(() => {
    if (!editMode) {
      setEditingCell(null)
      setCellDraft('')
    }
  }, [editMode])

  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach(clearTimeout)
      if (statusClearTimer.current) clearTimeout(statusClearTimer.current)
    }
  }, [])

  function setTemporaryStatus(message: string) {
    setStatusMessage(message)

    if (statusClearTimer.current) {
      clearTimeout(statusClearTimer.current)
    }

    statusClearTimer.current = setTimeout(() => {
      setStatusMessage('Autosave is on')
    }, 1500)
  }

  async function saveSingleItem(item: OrderItem, allItems: OrderItem[]) {
    setStatusMessage(`Saving line ${item.line_no}...`)

    const { error } = await supabase
      .from('order_items')
      .update({
        line_no: item.line_no,
        item_no: item.item_no,
        item_name: item.item_name,
        qty_ordered: item.qty_ordered,
        amount_aud: item.amount_aud,
        qty_received: item.qty_received,
        complete: item.complete,
        follow_up: item.follow_up,
        comments: item.comments,
      })
      .eq('id', item.id)

    if (error) {
      setStatusMessage(`Autosave failed on line ${item.line_no}: ${error.message}`)
      return
    }

    const orderComplete = allItems.every((row) => row.complete)

    const { error: orderError } = await supabase
      .from('orders')
      .update({ order_complete: orderComplete })
      .eq('id', orderId)

    if (orderError) {
      setStatusMessage(`Item saved, but order status failed: ${orderError.message}`)
      return
    }

    setTemporaryStatus(`Saved line ${item.line_no}`)
  }

  async function saveAllItems(
    itemsToSave: OrderItem[],
    successMessage = 'All changes saved'
  ) {
    setSavingAll(true)
    setStatusMessage('Saving all changes...')

    Object.values(autosaveTimers.current).forEach(clearTimeout)
    autosaveTimers.current = {}

    const updateResults = await Promise.all(
      itemsToSave.map((item) =>
        supabase
          .from('order_items')
          .update({
            line_no: item.line_no,
            item_no: item.item_no,
            item_name: item.item_name,
            qty_ordered: item.qty_ordered,
            amount_aud: item.amount_aud,
            qty_received: item.qty_received,
            complete: item.complete,
            follow_up: item.follow_up,
            comments: item.comments,
          })
          .eq('id', item.id)
      )
    )

    const firstError = updateResults.find((result) => result.error)?.error

    if (firstError) {
      setSavingAll(false)
      setStatusMessage(`Save failed: ${firstError.message}`)
      return
    }

    const orderComplete = itemsToSave.every((item) => item.complete)

    const { error: orderError } = await supabase
      .from('orders')
      .update({ order_complete: orderComplete })
      .eq('id', orderId)

    setSavingAll(false)

    if (orderError) {
      setStatusMessage(`Items saved, but order status failed: ${orderError.message}`)
      return
    }

    setTemporaryStatus(successMessage)
  }

  function scheduleAutosave(item: OrderItem, allItems: OrderItem[], delay = 700) {
    if (autosaveTimers.current[item.id]) {
      clearTimeout(autosaveTimers.current[item.id])
    }

    autosaveTimers.current[item.id] = setTimeout(() => {
      void saveSingleItem(item, allItems)
    }, delay)
  }

  function handleQtyReceivedChange(id: string, rawValue: string) {
    const qtyReceived = Number(rawValue)

    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item

        const safeQtyReceived = Number.isNaN(qtyReceived) ? 0 : qtyReceived
        const becomesComplete = safeQtyReceived >= item.qty_ordered

        return {
          ...item,
          qty_received: safeQtyReceived,
          complete: becomesComplete,
          follow_up: becomesComplete ? false : item.follow_up,
        }
      })

      const changedItem = updated.find((item) => item.id === id)
      if (changedItem) {
        scheduleAutosave(changedItem, updated, 700)
      }

      return sortByLineNo(updated)
    })
  }

  function handleCompleteChange(id: string, checked: boolean) {
    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item

        if (checked) {
          return {
            ...item,
            complete: true,
            qty_received: item.qty_ordered,
            follow_up: false,
          }
        }

        return {
          ...item,
          complete: false,
        }
      })

      const changedItem = updated.find((item) => item.id === id)
      if (changedItem) {
        scheduleAutosave(changedItem, updated, 150)
      }

      return sortByLineNo(updated)
    })
  }

  function handleFollowUpChange(id: string, checked: boolean) {
    setItems((prev) => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, follow_up: checked } : item
      )

      const changedItem = updated.find((item) => item.id === id)
      if (changedItem) {
        scheduleAutosave(changedItem, updated, 150)
      }

      return sortByLineNo(updated)
    })
  }

  function handleCommentsChange(id: string, value: string) {
    setItems((prev) => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, comments: value } : item
      )

      const changedItem = updated.find((item) => item.id === id)
      if (changedItem) {
        scheduleAutosave(changedItem, updated, 900)
      }

      return sortByLineNo(updated)
    })
  }

  function handleCompleteAll() {
    const updated = items.map((item) => ({
      ...item,
      qty_received: item.qty_ordered,
      complete: true,
      follow_up: false,
    }))

    setItems(sortByLineNo(updated))
    void saveAllItems(updated, 'All lines marked complete and saved')
  }

  function startCellEdit(item: OrderItem, field: EditableField) {
    if (!editMode) return

    setEditingCell({
      itemId: item.id,
      field,
    })

    const rawValue = item[field]
    setCellDraft(rawValue === null || rawValue === undefined ? '' : String(rawValue))
  }

  function saveEditedCell(itemId: string, field: EditableField) {
    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== itemId) return item

        if (field === 'line_no') {
          const nextValue = Number(cellDraft)
          return {
            ...item,
            line_no: Number.isNaN(nextValue) ? item.line_no : nextValue,
          }
        }

        if (field === 'qty_ordered') {
          const nextValue = Number(cellDraft)
          const safeQty = Number.isNaN(nextValue) ? item.qty_ordered : nextValue
          const becomesComplete = item.qty_received >= safeQty

          return {
            ...item,
            qty_ordered: safeQty,
            complete: becomesComplete,
            follow_up: becomesComplete ? false : item.follow_up,
          }
        }

        if (field === 'amount_aud') {
          if (cellDraft.trim() === '') {
            return {
              ...item,
              amount_aud: null,
            }
          }

          const nextValue = Number(cellDraft)
          return {
            ...item,
            amount_aud: Number.isNaN(nextValue) ? item.amount_aud : nextValue,
          }
        }

        if (field === 'item_no') {
          return {
            ...item,
            item_no: cellDraft,
          }
        }

        return {
          ...item,
          item_name: cellDraft,
        }
      })

      const changedItem = updated.find((item) => item.id === itemId)
      if (changedItem) {
        scheduleAutosave(changedItem, updated, 250)
      }

      return sortByLineNo(updated)
    })

    setEditingCell(null)
    setCellDraft('')
  }

  function renderEditableCell(
    item: OrderItem,
    field: EditableField,
    displayValue: string
  ) {
    const isEditing =
      editingCell?.itemId === item.id && editingCell?.field === field

    if (isEditing) {
      return (
        <input
          autoFocus
          type={
            field === 'line_no' || field === 'qty_ordered' || field === 'amount_aud'
              ? 'number'
              : 'text'
          }
          step={field === 'amount_aud' ? '0.01' : undefined}
          value={cellDraft}
          onChange={(e) => setCellDraft(e.target.value)}
          onBlur={() => saveEditedCell(item.id, field)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEditedCell(item.id, field)
            if (e.key === 'Escape') {
              setEditingCell(null)
              setCellDraft('')
            }
          }}
          className="w-full rounded border bg-white p-2 text-black"
        />
      )
    }

    return (
      <span
        onDoubleClick={() => startCellEdit(item, field)}
        className={editMode ? 'cursor-pointer rounded px-1 hover:bg-yellow-100' : ''}
        title={editMode ? 'Double click to edit' : undefined}
      >
        {displayValue}
      </span>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-gray-600">
          {editMode
            ? `${statusMessage} • Double click line no, item no, item name, qty ordered, or amount to edit`
            : statusMessage}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCompleteAll}
            className="rounded border bg-white px-4 py-2 text-black"
          >
            Complete All
          </button>

          <button
            type="button"
            onClick={() => void saveAllItems(items)}
            disabled={savingAll}
            className="rounded border bg-white px-4 py-2 text-black disabled:opacity-50"
          >
            {savingAll ? 'Saving...' : 'Save All Now'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-100 text-left text-black">
              <th className="p-3 font-semibold">Line No.</th>
              <th className="p-3 font-semibold">Item No.</th>
              <th className="p-3 font-semibold">Item Name</th>
              <th className="p-3 font-semibold">Qty Ordered</th>
              <th className="p-3 font-semibold">Amount (AUD)</th>
              <th className="p-3 font-semibold">Qty Received</th>
              <th className="p-3 font-semibold">Complete</th>
              <th className="p-3 font-semibold">Follow Up</th>
              <th className="p-3 font-semibold">Comments</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b align-top bg-white text-black even:bg-gray-50"
              >
                <td className="p-3">
                  {renderEditableCell(item, 'line_no', String(item.line_no))}
                </td>
                <td className="p-3">
                  {renderEditableCell(item, 'item_no', item.item_no)}
                </td>
                <td className="p-3">
                  {renderEditableCell(item, 'item_name', item.item_name)}
                </td>
                <td className="p-3">
                  {renderEditableCell(item, 'qty_ordered', String(item.qty_ordered))}
                </td>
                <td className="p-3">
                  {renderEditableCell(item, 'amount_aud', formatCurrency(item.amount_aud))}
                </td>
                <td className="p-3">
                  <input
                    type="number"
                    min="0"
                    className="w-24 rounded border bg-white p-2 text-black"
                    value={item.qty_received}
                    onChange={(e) =>
                      handleQtyReceivedChange(item.id, e.target.value)
                    }
                  />
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() =>
                      handleCompleteChange(item.id, !item.complete)
                    }
                    title="Complete"
                    style={{
                      width: '20px',
                      height: '20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      border: item.complete ? '2px solid #166534' : '2px solid #9ca3af',
                      backgroundColor: item.complete ? '#16a34a' : '#ffffff',
                      color: item.complete ? '#ffffff' : 'transparent',
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
                    onClick={() =>
                      handleFollowUpChange(item.id, !item.follow_up)
                    }
                    title="Follow Up"
                    style={{
                      width: '20px',
                      height: '20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      border: item.follow_up ? '2px solid #991b1b' : '2px solid #9ca3af',
                      backgroundColor: item.follow_up ? '#dc2626' : '#ffffff',
                      color: item.follow_up ? '#ffffff' : 'transparent',
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
                    className="w-64 rounded border bg-white p-2 text-black"
                    value={item.comments || ''}
                    onChange={(e) =>
                      handleCommentsChange(item.id, e.target.value)
                    }
                  />
                </td>
              </tr>
            ))}

            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No items found for this order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}