import StockListManager from '@/components/StockListManager'

export default function NonCatalogueItemsListPage() {
  return (
    <StockListManager
      title="Non-Catalogue Items List"
      fixedAlias="Non-Catalogue"
      showUnderDevelopment
      showSupplierRepNearFront
    />
  )
}