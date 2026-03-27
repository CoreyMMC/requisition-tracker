'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AliasType = 'Catalogue' | 'Non-Catalogue'

type StockItem = {
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
  supplier_rep: string | null
  previous_item_codes: string | null
  search_tags: string | null
  comments: string | null
  created_at?: string | null
  updated_at?: string | null
}

type NewItemDraft = {
  section: string
  item_code: string
  item_name: string
  simple_description: string
  price_aud: string
  box_vs_each: string
  price_per_unit: string
  alias: string
  supplier: string
  supplier_rep: string
  previous_item_codes: string
  search_tags: string
  comments: string
}

type Props = {
  title: string
  fixedAlias?: AliasType | null
  showUnderDevelopment?: boolean
  showSupplierRepNearFront?: boolean
}

type EditableField =
  | 'section'
  | 'item_code'
  | 'item_name'
  | 'simple_description'
  | 'price_aud'
  | 'box_vs_each'
  | 'price_per_unit'
  | 'alias'
  | 'supplier'
  | 'supplier_rep'
  | 'previous_item_codes'
  | 'search_tags'
  | 'comments'

type EditingCell = {
  rowId: string
  field: EditableField
} | null

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
}

function normaliseText(value: string | null | undefined) {
  return value ?? ''
}

function parseNullableNumber(value: string) {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function sortItems(rows: StockItem[]) {
  return [...rows].sort((a, b) =>
    normaliseText(a.item_name).localeCompare(normaliseText(b.item_name))
  )
}

export default function StockListManager({
  title,
  fixedAlias = null,
  showUnderDevelopment = false,
  showSupplierRepNearFront = false,
}: Props) {
  const supabase = createClient()

  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Loading stock items...')
  const [filterText, setFilterText] = useState('')
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)
  const [editAllMode, setEditAllMode] = useState(false)

  const isNonCatalogueList = fixedAlias === 'Non-Catalogue'

  const [newItem, setNewItem] = useState<NewItemDraft>({
    section: '',
    item_code: '',
    item_name: '',
    simple_description: '',
    price_aud: '',
    box_vs_each: '',
    price_per_unit: '',
    alias: fixedAlias ?? 'Catalogue',
    supplier: '',
    supplier_rep: '',
    previous_item_codes: '',
    search_tags: '',
    comments: '',
  })

  useEffect(() => {
    void loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedAlias])

  useEffect(() => {
    setNewItem((prev) => ({
      ...prev,
      alias: fixedAlias ?? prev.alias ?? 'Catalogue',
    }))
  }, [fixedAlias])

  async function loadItems() {
    setLoading(true)
    setStatusMessage('Loading stock items...')

    let queryBuilder = supabase
      .from('stock_items')
      .select('*')
      .order('item_name', { ascending: true })

    if (fixedAlias) {
      queryBuilder = queryBuilder.eq('alias', fixedAlias)
    }

    const { data, error } = await queryBuilder

    setLoading(false)

    if (error) {
      setStatusMessage(`Load failed: ${error.message}`)
      return
    }

    const rows = sortItems((data ?? []) as StockItem[])
    setItems(rows)
    setStatusMessage(`Loaded ${rows.length} stock item${rows.length === 1 ? '' : 's'}`)
  }

  const filteredItems = useMemo(() => {
    const q = filterText.trim().toLowerCase()

    if (!q) return items

    return items.filter((row) =>
      [
        row.section,
        row.item_code,
        row.item_name,
        row.simple_description,
        row.alias,
        row.supplier,
        row.supplier_rep,
        row.previous_item_codes,
        row.search_tags,
        row.comments,
      ]
        .map((value) => normaliseText(value).toLowerCase())
        .some((value) => value.includes(q))
    )
  }, [items, filterText])

  function updateRowTextField(
    id: string,
    field: Exclude<EditableField, 'price_aud' | 'price_per_unit'>,
    value: string
  ) {
    setItems((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    )
  }

  function updateRowNumberField(
    id: string,
    field: 'price_aud' | 'price_per_unit',
    value: string
  ) {
    setItems((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: parseNullableNumber(value),
            }
          : row
      )
    )
  }

  function getRowById(rowId: string) {
    return items.find((row) => row.id === rowId) ?? null
  }

  async function saveSingleRow(rowId: string) {
    const row = getRowById(rowId)
    if (!row) return

    setSavingRowId(rowId)
    setStatusMessage(`Saving ${row.item_name || row.item_code || 'item'}...`)

    const { error } = await supabase
      .from('stock_items')
      .update({
        section: normaliseText(row.section),
        item_code: normaliseText(row.item_code),
        item_name: normaliseText(row.item_name),
        simple_description: normaliseText(row.simple_description),
        price_aud: row.price_aud,
        box_vs_each: normaliseText(row.box_vs_each),
        price_per_unit: row.price_per_unit,
        alias: fixedAlias ?? normaliseText(row.alias || 'Catalogue'),
        supplier: normaliseText(row.supplier),
        supplier_rep: normaliseText(row.supplier_rep),
        previous_item_codes: normaliseText(row.previous_item_codes),
        search_tags: normaliseText(row.search_tags),
        comments: normaliseText(row.comments),
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId)

    setSavingRowId(null)

    if (error) {
      setStatusMessage(`Save failed: ${error.message}`)
      return
    }

    setStatusMessage(`Saved ${row.item_name || row.item_code || 'item'}`)
  }

  function resetNewItemForm() {
    setNewItem({
      section: '',
      item_code: '',
      item_name: '',
      simple_description: '',
      price_aud: '',
      box_vs_each: '',
      price_per_unit: '',
      alias: fixedAlias ?? 'Catalogue',
      supplier: '',
      supplier_rep: '',
      previous_item_codes: '',
      search_tags: '',
      comments: '',
    })
  }

  async function handleSaveNewItem() {
    if (!newItem.item_name.trim()) {
      setStatusMessage('Please enter an item name before saving')
      return
    }

    setAdding(true)
    setStatusMessage('Saving new stock item...')

    const payload = {
      section: newItem.section.trim(),
      item_code: newItem.item_code.trim(),
      item_name: newItem.item_name.trim(),
      simple_description: newItem.simple_description.trim(),
      price_aud: parseNullableNumber(newItem.price_aud),
      box_vs_each: newItem.box_vs_each.trim(),
      price_per_unit: parseNullableNumber(newItem.price_per_unit),
      alias: fixedAlias ?? (newItem.alias.trim() || 'Catalogue'),
      supplier: newItem.supplier.trim(),
      supplier_rep: newItem.supplier_rep.trim(),
      previous_item_codes: newItem.previous_item_codes.trim(),
      search_tags: newItem.search_tags.trim(),
      comments: newItem.comments.trim(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('stock_items')
      .insert(payload)
      .select('*')
      .single()

    setAdding(false)

    if (error || !data) {
      setStatusMessage(`Add failed: ${error?.message || 'Unknown error'}`)
      return
    }

    setItems((prev) => [data as StockItem, ...prev])
    setStatusMessage(`Added ${data.item_name || 'new item'}`)
    resetNewItemForm()
    setShowAddForm(false)
  }

  async function handleDeleteItem(row: StockItem) {
    const label = row.item_name?.trim() || row.item_code?.trim() || 'this item'

    const confirmed = window.confirm(
      `Are you sure you want to delete item "${label}"?`
    )

    if (!confirmed) return

    setStatusMessage(`Deleting ${label}...`)

    const { error } = await supabase
      .from('stock_items')
      .delete()
      .eq('id', row.id)

    if (error) {
      setStatusMessage(`Delete failed: ${error.message}`)
      return
    }

    setItems((prev) => prev.filter((item) => item.id !== row.id))
    setStatusMessage(`Deleted ${label}`)
  }

  function renderDisplayText(value: string | null | undefined) {
    const text = normaliseText(value)
    return text.trim() ? text : '—'
  }

  function isCellEditing(rowId: string, field: EditableField) {
    return editAllMode || (editingCell?.rowId === rowId && editingCell?.field === field)
  }

  function finishEditing(rowId: string) {
    if (!editAllMode) {
      setEditingCell(null)
    }
    void saveSingleRow(rowId)
  }

  function renderEditableTextCell(
    row: StockItem,
    field:
      | 'section'
      | 'item_code'
      | 'item_name'
      | 'simple_description'
      | 'box_vs_each'
      | 'supplier'
      | 'supplier_rep'
      | 'previous_item_codes'
      | 'search_tags'
      | 'comments',
    widthClass = 'w-full'
  ) {
    const editing = isCellEditing(row.id, field)
    const value = normaliseText(row[field])

    if (!editing) {
      return (
        <div
          onDoubleClick={() => setEditingCell({ rowId: row.id, field })}
          title="Double click to edit"
          className="min-h-[24px] cursor-text px-1 py-1"
        >
          {renderDisplayText(value)}
        </div>
      )
    }

    return (
      <input
        autoFocus={!editAllMode}
        type="text"
        value={value}
        onChange={(e) => updateRowTextField(row.id, field, e.target.value)}
        onBlur={() => finishEditing(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape' && !editAllMode) {
            setEditingCell(null)
          }
        }}
        className={`${widthClass} rounded border bg-white p-2 text-black`}
      />
    )
  }

  function renderEditableNumberCell(row: StockItem, field: 'price_aud' | 'price_per_unit') {
    const editing = isCellEditing(row.id, field)
    const value = row[field]

    if (!editing) {
      return (
        <div
          onDoubleClick={() => setEditingCell({ rowId: row.id, field })}
          title="Double click to edit"
          className="min-h-[24px] cursor-text px-1 py-1"
        >
          {formatCurrency(value)}
        </div>
      )
    }

    return (
      <input
        autoFocus={!editAllMode}
        type="number"
        step="0.01"
        value={value ?? ''}
        onChange={(e) => updateRowNumberField(row.id, field, e.target.value)}
        onBlur={() => finishEditing(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape' && !editAllMode) {
            setEditingCell(null)
          }
        }}
        className="w-28 rounded border bg-white p-2 text-black"
      />
    )
  }

  function renderEditableAliasCell(row: StockItem) {
    if (fixedAlias) {
      return <span>{fixedAlias}</span>
    }

    const editing = isCellEditing(row.id, 'alias')

    if (!editing) {
      return (
        <div
          onDoubleClick={() => setEditingCell({ rowId: row.id, field: 'alias' })}
          title="Double click to edit"
          className="min-h-[24px] cursor-text px-1 py-1"
        >
          {row.alias || '—'}
        </div>
      )
    }

    return (
      <select
        autoFocus={!editAllMode}
        value={row.alias || 'Catalogue'}
        onChange={(e) => updateRowTextField(row.id, 'alias', e.target.value)}
        onBlur={() => finishEditing(row.id)}
        className="rounded border bg-white p-2 text-black"
      >
        <option value="Catalogue">Catalogue</option>
        <option value="Non-Catalogue">Non-Catalogue</option>
      </select>
    )
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
            href="/mks-stock-list-search-v2"
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
              textAlign: 'center',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            MKs Stock List Search V2
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

      <h1 className="mb-4 text-2xl font-bold">{title}</h1>

      {showUnderDevelopment && (
        <div
          style={{
            backgroundColor: '#dc2626',
            color: '#ffffff',
            border: '3px solid #991b1b',
            borderRadius: '12px',
            padding: '18px 20px',
            fontWeight: 900,
            fontSize: '20px',
            display: 'inline-block',
            marginBottom: '18px',
          }}
        >
          UNDER DEVELOPMENT
        </div>
      )}

      <div className="mb-4 text-sm text-gray-700">
        {savingRowId ? 'Autosaving row...' : statusMessage}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setShowAddForm((prev) => !prev)
            if (!showAddForm) {
              resetNewItemForm()
            }
          }}
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
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          {showAddForm ? 'Cancel New Item' : 'Add New Item'}
        </button>

        <button
          type="button"
          onClick={() => {
            setEditAllMode((prev) => !prev)
            setEditingCell(null)
          }}
          className="rounded border bg-white px-4 py-2 text-black"
        >
          {editAllMode ? 'Done Editing All' : 'Edit All'}
        </button>

        <input
          type="text"
          placeholder="Filter current list"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full max-w-md rounded border bg-white p-3 text-black"
        />
      </div>

      {showAddForm && (
        <div className="mb-6 rounded border bg-gray-50 p-4">
          <h2 className="mb-4 text-lg font-semibold">Add New Item</h2>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              type="text"
              placeholder="Section"
              value={newItem.section}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, section: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Item Code"
              value={newItem.item_code}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, item_code: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Name"
              value={newItem.item_name}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, item_name: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Simple Description"
              value={newItem.simple_description}
              onChange={(e) =>
                setNewItem((prev) => ({
                  ...prev,
                  simple_description: e.target.value,
                }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="number"
              step="0.01"
              placeholder="Price"
              value={newItem.price_aud}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, price_aud: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="BOX vs EACH"
              value={newItem.box_vs_each}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, box_vs_each: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="number"
              step="0.01"
              placeholder="Price Per Unit"
              value={newItem.price_per_unit}
              onChange={(e) =>
                setNewItem((prev) => ({
                  ...prev,
                  price_per_unit: e.target.value,
                }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            {fixedAlias ? (
              <input
                type="text"
                value={fixedAlias}
                disabled
                className="rounded border bg-gray-100 p-2 text-black"
              />
            ) : (
              <select
                value={newItem.alias}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, alias: e.target.value }))
                }
                className="rounded border bg-white p-2 text-black"
              >
                <option value="Catalogue">Catalogue</option>
                <option value="Non-Catalogue">Non-Catalogue</option>
              </select>
            )}

            <input
              type="text"
              placeholder="Supplier"
              value={newItem.supplier}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, supplier: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Supplier / Rep"
              value={newItem.supplier_rep}
              onChange={(e) =>
                setNewItem((prev) => ({
                  ...prev,
                  supplier_rep: e.target.value,
                }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Previous Item Codes"
              value={newItem.previous_item_codes}
              onChange={(e) =>
                setNewItem((prev) => ({
                  ...prev,
                  previous_item_codes: e.target.value,
                }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Search Tags"
              value={newItem.search_tags}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, search_tags: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />

            <input
              type="text"
              placeholder="Comments"
              value={newItem.comments}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, comments: e.target.value }))
              }
              className="rounded border bg-white p-2 text-black"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSaveNewItem()}
              disabled={adding}
              style={{
                backgroundColor: '#16a34a',
                color: '#ffffff',
                border: '2px solid #166534',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: 700,
                fontSize: '14px',
                lineHeight: 1.2,
                display: 'inline-block',
                textAlign: 'center',
                cursor: adding ? 'not-allowed' : 'pointer',
                opacity: adding ? 0.6 : 1,
                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              }}
            >
              {adding ? 'Saving...' : 'Save New Item'}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAddForm(false)
                resetNewItemForm()
              }}
              className="rounded border bg-white px-4 py-2 text-black"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded border bg-white p-4">Loading stock items...</div>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-100 text-left text-black">
                {isNonCatalogueList ? (
                  <>
                    <th className="p-3 font-semibold">Supplier / Rep</th>
                    <th className="p-3 font-semibold">Name</th>
                    <th className="p-3 font-semibold">Simple Description</th>
                    <th className="p-3 font-semibold">ALIAS</th>
                    <th className="p-3 font-semibold">Comments</th>
                    {editAllMode && (
                      <>
                        <th className="p-3 font-semibold">Search Tags</th>
                        <th className="p-3 font-semibold">Price</th>
                        <th className="p-3 font-semibold">BOX vs EACH</th>
                        <th className="p-3 font-semibold">Price Per Unit</th>
                        <th className="p-3 font-semibold">Previous Item Codes</th>
                      </>
                    )}
                    <th className="p-3 font-semibold">Delete</th>
                  </>
                ) : (
                  <>
                    <th className="p-3 font-semibold">Section</th>
                    {showSupplierRepNearFront && (
                      <th className="p-3 font-semibold">Supplier / Rep</th>
                    )}
                    <th className="p-3 font-semibold">Item Code</th>
                    <th className="p-3 font-semibold">Name</th>
                    <th className="p-3 font-semibold">Simple Description</th>
                    <th className="p-3 font-semibold">Price</th>
                    <th className="p-3 font-semibold">BOX vs EACH</th>
                    <th className="p-3 font-semibold">Price Per Unit</th>
                    <th className="p-3 font-semibold">ALIAS</th>
                    <th className="p-3 font-semibold">Supplier</th>
                    {!showSupplierRepNearFront && (
                      <th className="p-3 font-semibold">Supplier / Rep</th>
                    )}
                    <th className="p-3 font-semibold">Previous Item Codes</th>
                    <th className="p-3 font-semibold">Search Tags</th>
                    <th className="p-3 font-semibold">Comments</th>
                    <th className="p-3 font-semibold">Delete</th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {filteredItems.map((row) => {
                const isNonCatalogue = row.alias === 'Non-Catalogue'

                return (
                  <tr
                    key={row.id}
                    className="border-b align-top text-black"
                    style={{
                      backgroundColor: isNonCatalogue ? '#fef2f2' : '#ffffff',
                    }}
                  >
                    {isNonCatalogueList ? (
                      <>
                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'supplier_rep',
                            'min-w-[180px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'item_name',
                            'min-w-[220px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'simple_description',
                            'min-w-[240px]'
                          )}
                        </td>

                        <td className="p-3">{renderEditableAliasCell(row)}</td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'comments',
                            'min-w-[220px]'
                          )}
                        </td>

                        {editAllMode && (
                          <>
                            <td className="p-3">
                              {renderEditableTextCell(
                                row,
                                'search_tags',
                                'min-w-[240px]'
                              )}
                            </td>

                            <td className="p-3">
                              {renderEditableNumberCell(row, 'price_aud')}
                            </td>

                            <td className="p-3">
                              {renderEditableTextCell(
                                row,
                                'box_vs_each',
                                'min-w-[120px]'
                              )}
                            </td>

                            <td className="p-3">
                              {renderEditableNumberCell(row, 'price_per_unit')}
                            </td>

                            <td className="p-3">
                              {renderEditableTextCell(
                                row,
                                'previous_item_codes',
                                'min-w-[180px]'
                              )}
                            </td>
                          </>
                        )}

                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(row)}
                            style={{
                              backgroundColor: '#facc15',
                              color: '#111111',
                              border: '2px solid #ca8a04',
                              borderRadius: '8px',
                              padding: '8px 12px',
                              fontWeight: 700,
                              fontSize: '13px',
                              lineHeight: 1.2,
                              display: 'inline-block',
                              minWidth: '86px',
                              textAlign: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-3">
                          {renderEditableTextCell(row, 'section', 'min-w-[120px]')}
                        </td>

                        {showSupplierRepNearFront && (
                          <td className="p-3">
                            {renderEditableTextCell(
                              row,
                              'supplier_rep',
                              'min-w-[180px]'
                            )}
                          </td>
                        )}

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'item_code',
                            'min-w-[120px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'item_name',
                            'min-w-[220px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'simple_description',
                            'min-w-[240px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableNumberCell(row, 'price_aud')}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'box_vs_each',
                            'min-w-[120px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableNumberCell(row, 'price_per_unit')}
                        </td>

                        <td className="p-3">{renderEditableAliasCell(row)}</td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'supplier',
                            'min-w-[180px]'
                          )}
                        </td>

                        {!showSupplierRepNearFront && (
                          <td className="p-3">
                            {renderEditableTextCell(
                              row,
                              'supplier_rep',
                              'min-w-[180px]'
                            )}
                          </td>
                        )}

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'previous_item_codes',
                            'min-w-[180px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'search_tags',
                            'min-w-[240px]'
                          )}
                        </td>

                        <td className="p-3">
                          {renderEditableTextCell(
                            row,
                            'comments',
                            'min-w-[220px]'
                          )}
                        </td>

                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(row)}
                            style={{
                              backgroundColor: '#facc15',
                              color: '#111111',
                              border: '2px solid #ca8a04',
                              borderRadius: '8px',
                              padding: '8px 12px',
                              fontWeight: 700,
                              fontSize: '13px',
                              lineHeight: 1.2,
                              display: 'inline-block',
                              minWidth: '86px',
                              textAlign: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td
                    colSpan={isNonCatalogueList ? (editAllMode ? 11 : 6) : 15}
                    className="p-6 text-center text-gray-500"
                  >
                    No stock items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}