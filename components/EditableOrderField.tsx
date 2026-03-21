'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  orderId: string
  field: 'requisition_number' | 'order_date'
  initialValue: string | null
  editMode: boolean
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateForDisplay(value: string | null | undefined) {
  if (!value) return ''

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

  return `${year}-${pad2(month)}-${pad2(day)}`
}

export default function EditableOrderField({
  orderId,
  field,
  initialValue,
  editMode,
}: Props) {
  const supabase = createClient()

  const [value, setValue] = useState(
    field === 'order_date'
      ? formatDateForDisplay(initialValue)
      : initialValue || ''
  )
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(
      field === 'order_date'
        ? formatDateForDisplay(initialValue)
        : initialValue || ''
    )
  }, [field, initialValue])

  async function saveValue() {
    setSaving(true)

    const updatePayload: Record<string, string | null> = {
      [field]:
        field === 'order_date'
          ? auDateToIso(value)
          : value || null,
    }

    if (field === 'order_date') {
      const isoDate = auDateToIso(value)

      if (value && !isoDate) {
        alert('Please enter the date as DD/MM/YYYY')
        setSaving(false)
        return
      }

      updatePayload.order_date = isoDate
      updatePayload.order_date_sort = isoDate
    }

    const { error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)

    setSaving(false)

    if (!error) {
      setEditing(false)
    } else {
      alert(error.message)
    }
  }

  if (!editMode) {
    return <span>{value || '—'}</span>
  }

  if (!editing) {
    return (
      <span
        onDoubleClick={() => setEditing(true)}
        className="cursor-pointer rounded px-1 hover:bg-yellow-100"
        title="Double click to edit"
      >
        {value || '—'}
      </span>
    )
  }

  return (
    <input
      autoFocus
      type="text"
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void saveValue()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void saveValue()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-full rounded border bg-white px-2 py-1 text-black"
      placeholder={field === 'order_date' ? 'DD/MM/YYYY' : ''}
    />
  )
}