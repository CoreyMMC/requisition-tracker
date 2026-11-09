 
import { createClient } from '@/lib/supabase/server'
import OrdersTableClient from '@/components/OrdersTableClient'

export default async function OrdersPage() {
  const supabase = await createClient()

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('order_date_sort', {
      ascending: false,
      nullsFirst: false,
    })
    .order('order_date', {
      ascending: false,
      nullsFirst: false,
    })
    .order('requisition_number', {
      ascending: false,
    })
    .order('id', {
      ascending: false,
    })

  if (error) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <p style={{ color: '#b91c1c' }}>
          Could not load orders: {error.message}
        </p>
      </main>
    )
  }

  return (
    <OrdersTableClient initialOrders={orders ?? []} />
  )
}
