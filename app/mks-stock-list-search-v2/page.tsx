'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type SearchResult = {
  id: string
  section: string | null
  item_code: string | null
  item_name: string
  simple_description: string | null
  price_aud: number | null
  box_vs_each: string | null
  price_per_unit: number | null
  alias: string
  supplier: string | null
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
}

function asText(value: string | null | undefined) {
  return value ?? ''
}

export default function MKsStockListSearchV2Page() {
  const supabase = createClient()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    'Type an item name, current code, old code, supplier or tag and click Search'
  )

  async function handleSearch() {
    const trimmed = query.trim()

    if (!trimmed) {
      setResults([])
      setStatusMessage('Enter something to search first')
      return
    }

    setSearching(true)
    setStatusMessage('Searching stock list...')

    const safe = trimmed.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

    const { data, error } = await supabase
      .from('stock_items')
      .select(
        'id, section, item_code, item_name, simple_description, price_aud, box_vs_each, price_per_unit, alias, supplier'
      )
      .or(
        `item_code.ilike.%${safe}%,previous_item_codes.ilike.%${safe}%,item_name.ilike.%${safe}%,simple_description.ilike.%${safe}%,supplier.ilike.%${safe}%,search_tags.ilike.%${safe}%`
      )
      .order('item_name', { ascending: true })
      .limit(250)

    setSearching(false)

    if (error) {
      setStatusMessage(`Search failed: ${error.message}`)
      return
    }

    const rows = (data ?? []) as SearchResult[]
    setResults(rows)

    if (rows.length === 0) {
      setStatusMessage('No stock items matched your search')
      return
    }

    setStatusMessage(`Found ${rows.length} matching stock item${rows.length === 1 ? '' : 's'}`)
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
          flexWrap: 'wrap',
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

        <div className="flex flex-wrap gap-3">
          <Link
            href="/manage-stock-list"
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: '2px solid #1d4ed8',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              fontSize: '14px',
              lineHeight: 1.2,
              display: 'inline-block',
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            Manage Stock List
          </Link>

          <Link
            href="/non-catalogue-items-list"
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
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            Non-Catalogue Items List
          </Link>
        </div>
      </div>

      <h1 className="mb-4 text-2xl font-bold">MKs Stock List Search V2</h1>

      <div className="mb-4 text-sm text-gray-700">{statusMessage}</div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSearch()
        }}
        className="mb-4 flex flex-wrap items-center gap-3"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stock item"
          className="w-full max-w-xl rounded border bg-white p-3 text-black"
        />

        <button
          type="submit"
          disabled={searching}
          style={{
            backgroundColor: '#7c3aed',
            color: '#ffffff',
            border: '2px solid #6d28d9',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: '14px',
            lineHeight: 1.2,
            display: 'inline-block',
            minWidth: '110px',
            textAlign: 'center',
            cursor: searching ? 'not-allowed' : 'pointer',
            opacity: searching ? 0.6 : 1,
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>

        <button
          type="button"
          onClick={() => {
            setQuery('')
            setResults([])
            setStatusMessage(
              'Type an item name, current code, old code, supplier or tag and click Search'
            )
          }}
          className="rounded border bg-white px-4 py-2 text-black"
        >
          Clear
        </button>
      </form>

      <div className="mb-3 text-sm font-semibold text-gray-700">
        Section: coming soon. Leaving blank for now.
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-100 text-left text-black">
              <th className="p-3 font-semibold">Section</th>
              <th className="p-3 font-semibold">Item Code</th>
              <th className="p-3 font-semibold">Name</th>
              <th className="p-3 font-semibold">Simple Description</th>
              <th className="p-3 font-semibold">Price</th>
              <th className="p-3 font-semibold">BOX vs EACH</th>
              <th className="p-3 font-semibold">Price Per Unit</th>
              <th className="p-3 font-semibold">ALIAS</th>
              <th className="p-3 font-semibold">Supplier</th>
            </tr>
          </thead>

          <tbody>
            {results.map((row) => {
              const isNonCatalogue = row.alias === 'Non-Catalogue'

              return (
                <tr
                  key={row.id}
                  className="border-b text-black"
                  style={{
                    backgroundColor: isNonCatalogue ? '#fef2f2' : '#ffffff',
                  }}
                >
                  <td className="p-3">{asText(row.section) || '—'}</td>
                  <td className="p-3">{asText(row.item_code) || '—'}</td>
                  <td className="p-3">{row.item_name || '—'}</td>
                  <td className="p-3">{asText(row.simple_description) || '—'}</td>
                  <td className="p-3">{formatCurrency(row.price_aud)}</td>
                  <td className="p-3">{asText(row.box_vs_each) || '—'}</td>
                  <td className="p-3">{formatCurrency(row.price_per_unit)}</td>
                  <td className="p-3">
                    <span
                      style={{
                        display: 'inline-block',
                        minWidth: '128px',
                        textAlign: 'center',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: 'white',
                        backgroundColor: isNonCatalogue ? '#dc2626' : '#16a34a',
                        border: `1px solid ${isNonCatalogue ? '#991b1b' : '#166534'}`,
                      }}
                    >
                      {row.alias || '—'}
                    </span>
                  </td>
                  <td className="p-3">{asText(row.supplier) || '—'}</td>
                </tr>
              )
            })}

            {results.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}