'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  orderId: string
}

export default function DeleteWholeOrderButton({ orderId }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    const confirmed = window.confirm(
      'Are you sure you want to delete whole order?'
    )

    if (!confirmed) return

    setDeleting(true)

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'DELETE',
      })

      const text = await res.text()
      const data = text ? JSON.parse(text) : null

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete order.')
      }

      router.push('/orders')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Delete failed.')
      setDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDelete()}
      disabled={deleting}
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
        minWidth: '170px',
        textAlign: 'center',
        cursor: deleting ? 'not-allowed' : 'pointer',
        opacity: deleting ? 0.6 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }}
    >
      {deleting ? 'Deleting...' : 'Delete Whole Order'}
    </button>
  )
}