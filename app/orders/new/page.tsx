'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewOrderPage() {
  const supabase = createClient()
  const router = useRouter()

  const [requisitionNumber, setRequisitionNumber] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [enteredBy, setEnteredBy] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')
    setLoading(true)

    const { error } = await supabase.from('orders').insert({
      requisition_number: requisitionNumber,
      po_number: poNumber || null,
      order_date: orderDate || null,
      entered_by: enteredBy || null,
      order_complete: false,
    })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push('/orders')
    router.refresh()
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">New Order</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded border p-6">
        <div>
          <label className="mb-2 block font-medium">Requisition Number</label>
          <input
            className="w-full rounded border p-3"
            value={requisitionNumber}
            onChange={(e) => setRequisitionNumber(e.target.value)}
            placeholder="e.g. 40033680"
            required
          />
        </div>

        <div>
          <label className="mb-2 block font-medium">PO Number</label>
          <input
            className="w-full rounded border p-3"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="Optional for now"
          />
        </div>

        <div>
          <label className="mb-2 block font-medium">Date</label>
          <input
            className="w-full rounded border p-3"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block font-medium">Entered By</label>
          <input
            className="w-full rounded border p-3"
            value={enteredBy}
            onChange={(e) => setEnteredBy(e.target.value)}
            placeholder="e.g. Lauren Hendry"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-3 text-white disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Create Order'}
        </button>

        {message && <p className="text-sm text-red-600">{message}</p>}
      </form>
    </main>
  )
}