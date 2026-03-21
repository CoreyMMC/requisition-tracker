'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import OrderItemsTable from '@/components/OrderItemsTable'
import OrderSummaryCard from '@/components/OrderSummaryCard'

type Order = {
  id: string
  requisition_number: string
  po_number: string | null
  order_date: string | null
  entered_by: string | null
  requisition_amount_aud: number | null
  title: string | null
  order_complete: boolean
}

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
  order: Order
  initialItems: OrderItem[]
}

export default function OrderDetailContent({ order, initialItems }: Props) {
  const router = useRouter()
  const [editMode, setEditMode] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    const confirmed = window.confirm(
      'Are you sure you want to delete whole order?'
    )

    if (!confirmed) return

    setDeleting(true)

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
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

        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          style={{
            backgroundColor: 'red',
            color: 'white',
            border: '4px solid black',
            borderRadius: '8px',
            padding: '14px 20px',
            fontWeight: 900,
            fontSize: '16px',
            display: 'inline-block',
            minWidth: '220px',
          }}
        >
          {deleting ? 'Deleting...' : 'DELETE WHOLE ORDER'}
        </button>
      </div>

      <h1 className="mb-6 text-2xl font-bold">
        Requisition {order.requisition_number}
        {order.title ? ` — ${order.title}` : ''}
      </h1>

      <OrderSummaryCard
        order={order}
        editMode={editMode}
        setEditMode={setEditMode}
      />

      <OrderItemsTable
        orderId={order.id}
        initialItems={initialItems}
        editMode={editMode}
      />
    </main>
  )
}