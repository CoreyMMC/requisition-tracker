'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  orderId: string
  initialValue: string | null
  placeholder?: string
  className?: string
}

export default function EditablePoInput({
  orderId,
  initialValue,
  placeholder = 'Enter PO number(s)',
  className = '',
}: Props) {
  const supabase = createClient()

  const [value, setValue] = useState(initialValue || '')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedValueRef = useRef(initialValue || '')

  useEffect(() => {
    const nextValue = initialValue || ''
    setValue(nextValue)
    lastSavedValueRef.current = nextValue
  }, [initialValue])

  async function saveValue(nextValue: string) {
    const trimmedValue = nextValue.trim()

    if (trimmedValue === lastSavedValueRef.current.trim()) {
      setSaving(false)
      setStatus('')
      return
    }

    const { error } = await supabase
      .from('orders')
      .update({
        po_number: trimmedValue || null,
      })
      .eq('id', orderId)

    setSaving(false)

    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }

    lastSavedValueRef.current = trimmedValue
    setStatus('Saved')

    setTimeout(() => {
      setStatus('')
    }, 1200)
  }

  function scheduleSave(nextValue: string) {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    setSaving(true)
    setStatus('Saving...')

    timeoutRef.current = setTimeout(() => {
      saveValue(nextValue)
    }, 700)
  }

  function handleChange(nextValue: string) {
    setValue(nextValue)
    scheduleSave(nextValue)
  }

  function handleBlur() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    setSaving(true)
    setStatus('Saving...')
    saveValue(value)
  }

  return (
    <div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className={className}
      />

      <div className="mt-1 min-h-[20px] text-xs text-gray-600">
        {saving ? 'Saving...' : status}
      </div>
    </div>
  )
}