'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  orderId: string
  initialValue: string | null
}

const ORDER_TYPE_OPTIONS = [
  'General Stock',
  'Non-catalogue',
  'PSA Stock',
  'Name Badges',
  'Other',
]

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

export default function EditableOrderTitleSelect({
  orderId,
  initialValue,
}: Props) {
  const supabase = createClient()

  const parsed = parseOrderType(initialValue)

  const [selectValue, setSelectValue] = useState(parsed.selectValue)
  const [extraValue, setExtraValue] = useState(parsed.extraValue)
  const [saving, setSaving] = useState(false)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const nextParsed = parseOrderType(initialValue)
    setSelectValue(nextParsed.selectValue)
    setExtraValue(nextParsed.extraValue)
  }, [initialValue])

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  async function saveValue(valueToSave: string | null) {
    setSaving(true)

    const { error } = await supabase
      .from('orders')
      .update({
        title: valueToSave,
      })
      .eq('id', orderId)

    setSaving(false)

    if (error) {
      alert(error.message)
    }
  }

  function scheduleSave(valueToSave: string | null) {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(() => {
      void saveValue(valueToSave)
    }, 500)
  }

  function handleSelectChange(nextValue: string) {
    setSelectValue(nextValue)

    if (nextValue === 'General Stock') {
      setExtraValue('')
      void saveValue('General Stock')
      return
    }

    if (nextValue === 'PSA Stock') {
      setExtraValue('')
      void saveValue('PSA Stock')
      return
    }

    if (nextValue === 'Name Badges') {
      setExtraValue('')
      void saveValue('Name Badges')
      return
    }

    if (nextValue === '') {
      setExtraValue('')
      void saveValue(null)
      return
    }

    if (nextValue === 'Non-catalogue') {
      setExtraValue('')
      return
    }

    if (nextValue === 'Other') {
      setExtraValue('')
      return
    }
  }

  function handleExtraChange(nextValue: string) {
    setExtraValue(nextValue)

    if (selectValue === 'Non-catalogue') {
      const valueToSave = nextValue.trim()
        ? `Non-catalogue - ${nextValue.trim()}`
        : 'Non-catalogue'

      scheduleSave(valueToSave)
      return
    }

    if (selectValue === 'Other') {
      scheduleSave(nextValue.trim() || null)
    }
  }

  function handleExtraBlur() {
    if (selectValue === 'Non-catalogue') {
      void saveValue(
        extraValue.trim()
          ? `Non-catalogue - ${extraValue.trim()}`
          : 'Non-catalogue'
      )
      return
    }

    if (selectValue === 'Other') {
      void saveValue(extraValue.trim() || null)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
        minWidth: '220px',
        width: '100%',
      }}
    >
      <select
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        style={{
          width: '100%',
          minWidth: '220px',
          backgroundColor: '#ffffff',
          color: '#000000',
          border: '1px solid #000000',
          borderRadius: '6px',
          padding: '10px 12px',
        }}
      >
        <option value="">Select</option>
        {ORDER_TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      {(selectValue === 'Non-catalogue' || selectValue === 'Other') && (
        <input
          type="text"
          value={extraValue}
          onChange={(e) => handleExtraChange(e.target.value)}
          onBlur={handleExtraBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleExtraBlur()
            }
          }}
          placeholder={
            selectValue === 'Non-catalogue'
              ? 'Type non-catalogue details'
              : 'Type custom order type'
          }
          style={{
            width: '100%',
            minWidth: '220px',
            backgroundColor: '#ffffff',
            color: '#000000',
            border: '1px solid #000000',
            borderRadius: '6px',
            padding: '10px 12px',
            boxSizing: 'border-box',
          }}
        />
      )}

      {saving && (
        <span
          style={{
            fontSize: '12px',
            color: '#6b7280',
          }}
        >
          Saving...
        </span>
      )}
    </div>
  )
}