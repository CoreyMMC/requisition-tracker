import { createClient } from '@/lib/supabase/server'
import OrderDetailContent from '@/components/OrderDetailContent'

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', id)
    .order('line_no', { ascending: true })

  if (orderError) {
    return (
      <main className="p-8">
        <div>Error loading order: {orderError.message}</div>
      </main>
    )
  }

  if (itemsError) {
    return (
      <main className="p-8">
        <div>Error loading order items: {itemsError.message}</div>
      </main>
    )
  }

  if (!order) {
    return (
      <main className="p-8">
        <div>Order not found.</div>
      </main>
    )
  }

  return <OrderDetailContent order={order} initialItems={items || []} />
}