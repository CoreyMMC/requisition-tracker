import { createClient } from '@/lib/supabase/server'
import OrdersTableClient from '@/components/OrdersTableClient'

export default async function OrdersPage() {
  const supabase = await createClient()

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        id,
        complete,
        follow_up
      )
    `)
    .order('order_date_sort', { ascending: false, nullsFirst: false })
    .order('order_date', { ascending: false, nullsFirst: false })
    .order('requisition_number', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })

  if (error) {
    return (
      <div className="p-8">
        Error loading orders: {error.message}
      </div>
    )
  }

  return <OrdersTableClient initialOrders={orders || []} />
}