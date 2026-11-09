
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatPoNumbers } from '@/lib/po-numbers'

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
  const supabase = useRef(createClient()).current

  const [value, setValue] = useState(
    formatPoNumbers(initialValue)
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const timeout = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const saved = useRef(formatPoNumbers(initialValue))
  const version = useRef(0)

  useEffect(() => {
    const next = formatPoNumbers(initialValue)

    setValue(next)
    saved.current = next
  }, [initialValue])

  useEffect(() => {
    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current)
      }
    }
  }, [])

  async function saveValue(raw: string, currentVersion: number) {
    const formatted = formatPoNumbers(raw)

    if (formatted === saved.current) {
      if (currentVersion === version.current) {
        setSaving(false)
        setStatus('')
        setValue(formatted)
      }
      return
    }

    const { error } = await supabase
      .from('orders')
      .update({
        po_number: formatted || null,
      })
      .eq('id', orderId)

    if (error) {
      setStatus(`Error: ${error.message}`)
      setSaving(false)
      return
    }

    saved.current = formatted

    if (currentVersion === version.current) {
      setValue(formatted)
      setSaving(false)
      setStatus('Saved')
    }
  }

  function scheduleSave(raw: string) {
    if (timeout.current) {
      clearTimeout(timeout.current)
    }

    version.current += 1
    const currentVersion = version.current

    setSaving(true)
    setStatus('Saving...')

    timeout.current = setTimeout(() => {
      void saveValue(raw, currentVersion)
    }, 700)
  }

  function handleChange(raw: string) {
    setValue(raw)
    scheduleSave(raw)
  }

  function handleBlur() {
    if (timeout.current) {
      clearTimeout(timeout.current)
    }

    version.current += 1
    const currentVersion = version.current

    setSaving(true)
    void saveValue(value, currentVersion)
  }

  return (
    <div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(event) =>
          handleChange(event.target.value)
        }
        onBlur={handleBlur}
      />

      <div className="mt-1 min-h-[20px] text-xs text-gray-600">
        {saving ? 'Saving...' : status}
      </div>
    </div>
  )
}
