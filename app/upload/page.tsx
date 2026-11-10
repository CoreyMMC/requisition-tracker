
'use client'

import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { formatPoNumbers } from '@/lib/po-numbers'
import {
  PdfUploadContext,
  type PdfController,
  type UploadResult,
  type ImportResult,
} from './combined-upload-shell'

type Header = {
  requisition_no?: string
  po_numbers?: string
  date?: string
  entered_by?: string
  requisition_amount_aud?: number | string | null
}

type Item = {
  line_no: number | string
  item_no: string
  item_name: string
  qty_ordered: number | string
  amount_aud?: number | string | null
}

type Entry = {
  id: number
  file: File
  parse: 'parsing' | 'ready' | 'error'
  imported:
    | 'idle'
    | 'importing'
    | 'success'
    | 'duplicate'
    | 'error'
  header: Header | null
  items: Item[]
  level: 3 | 5
  orderType: string
  details: string
  expanded: boolean
  mismatchApproved: boolean
  error: string
  message: string
}

type ParseResponse = {
  header?: Header
  items?: Item[]
  error?: string
}

const orderTypes = [
  'General Stock',
  'Non-catalogue',
  'PSA Stock',
  'WINC',
  'Allanby',
  'Name Badges',
  'Other',
]

const field: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: 9,
  marginTop: 6,
  border: '1px solid #b9c2cc',
  borderRadius: 7,
  color: '#111827',
  background: '#fff',
  boxSizing: 'border-box',
}

const button: CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid #aaa',
  color: '#111827',
  background: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
}

function identity(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function newEntry(file: File, id: number): Entry {
  return {
    id,
    file,
    parse: 'parsing',
    imported: 'idle',
    header: null,
    items: [],
    level: 3,
    orderType: '',
    details: '',
    expanded: true,
    mismatchApproved: false,
    error: '',
    message: '',
  }
}

function currency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const number = Number(value)

  if (!Number.isFinite(number)) return String(value)

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(number)
}

function itemTotal(items: Item[]) {
  return items.reduce(
    (sum, item) => sum + (Number(item.amount_aud) || 0),
    0
  )
}

function hasMismatch(entry: Entry) {
  const amount = entry.header?.requisition_amount_aud

  if (amount === null || amount === undefined ||
      amount === '') {
    return false
  }

  return Math.abs(
    Number(amount) - itemTotal(entry.items)
  ) > 0.01
}

function validDate(value?: string) {
  if (!value) return false

  const au = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/
  )
  const iso = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  )

  if (!au && !iso) return false

  const year = au
    ? Number(au[3].length === 2 ? `20${au[3]}` : au[3])
    : Number(iso![1])

  const month = Number(au ? au[2] : iso![2])
  const day = Number(au ? au[1] : iso![3])

  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function getTitle(entry: Entry) {
  if (entry.orderType === 'Other') {
    return entry.details.trim() || null
  }

  if (entry.orderType === 'Non-catalogue') {
    return entry.details.trim()
      ? `Non-catalogue - ${entry.details.trim()}`
      : 'Non-catalogue'
  }

  return entry.orderType || null
}

function validateEntry(entry: Entry): string | null {
  const header = entry.header

  if (!header?.requisition_no?.trim()) {
    return 'Requisition number is missing.'
  }

  if (!validDate(header.date)) {
    return 'Enter a valid date (DD/MM/YYYY).'
  }

  if (
    entry.orderType === 'Other' &&
    !entry.details.trim()
  ) {
    return 'Enter the custom order type.'
  }

  if (!entry.items.length) {
    return 'No item lines were recognised.'
  }

  const used = new Set<number>()

  for (const item of entry.items) {
    const line = Number(item.line_no)
    const quantity = Number(item.qty_ordered)
    const amount = Number(item.amount_aud)

    if (!Number.isInteger(line) || line < 1) {
      return 'Invalid line number.'
    }

    if (used.has(line)) {
      return `Line ${line} appears more than once.`
    }

    used.add(line)

    if (!item.item_name?.trim()) {
      return `Line ${line}: item name is required.`
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `Line ${line}: invalid quantity.`
    }

    if (
      item.amount_aud === null ||
      item.amount_aud === undefined ||
      item.amount_aud === '' ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      return `Line ${line}: invalid amount.`
    }
  }

  if (
    header.requisition_amount_aud != null &&
    header.requisition_amount_aud !== '' &&
    !Number.isFinite(Number(
      header.requisition_amount_aud
    ))
  ) {
    return 'Invalid requisition total.'
  }

  if (
    hasMismatch(entry) &&
    !entry.mismatchApproved
  ) {
    return (
      'Item amounts differ from the requisition total. ' +
      'Review and acknowledge the difference.'
    )
  }

  return null
}

function errorText(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error
  ) {
    return String(error.message)
  }

  return String(error)
}

export default function UploadPage() {
  const bridge = useContext(PdfUploadContext)
  const nextId = useRef(1)
  const locked = useRef(false)

  const [entries, setEntries] = useState<Entry[]>([])
  const entriesRef = useRef<Entry[]>([])
  const [working, setWorking] = useState(false)

  function updateEntries(
    update: (current: Entry[]) => Entry[]
  ) {
    const next = update(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
  }

  function patch(id: number, changes: Partial<Entry>) {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, ...changes }
          : entry
      )
    )
  }

  function reset() {
    if (locked.current) return
    updateEntries(() => [])
  }

  async function uploadPdfs(
    files: File[]
  ): Promise<UploadResult> {
    if (locked.current) {
      return {
        succeeded: 0,
        failed: files,
        errors: ['PDF importer is busy.'],
      }
    }

    locked.current = true
    setWorking(true)

    let succeeded = 0
    const failed: File[] = []
    const errors: string[] = []

    try {
      for (const file of files) {
        const key = identity(file)

        const existing = entriesRef.current.find(
          (entry) => identity(entry.file) === key
        )

        if (existing?.parse === 'ready') {
          continue
        }

        const id = existing?.id ?? nextId.current++

        if (existing) {
          patch(id, {
            parse: 'parsing',
            imported: 'idle',
            error: '',
            message: '',
          })
        } else {
          updateEntries((current) => [
            ...current,
            newEntry(file, id),
          ])
        }

        const formData = new FormData()
        formData.append('file', file)

        try {
          const response = await fetch('/api/import-order', {
            method: 'POST',
            body: formData,
          })

          const raw = await response.text()

          let data: ParseResponse

          try {
            data = JSON.parse(raw)
          } catch {
            throw new Error(
              `Invalid server response (${response.status}).`
            )
          }

          if (!response.ok || data.error) {
            throw new Error(
              data.error ||
              `PDF parsing failed (${response.status}).`
            )
          }

          if (!data.header?.requisition_no) {
            throw new Error(
              'Requisition number was not recognised.'
            )
          }

          if (!data.items?.length) {
            throw new Error(
              'No item lines were recognised.'
            )
          }

          patch(id, {
            parse: 'ready',
            imported: 'idle',
            header: {
              ...data.header,
              po_numbers: formatPoNumbers(
                data.header.po_numbers
              ),
            },
            items: data.items,
            expanded: true,
            mismatchApproved: false,
            error: '',
            message: '',
          })

          succeeded++
        } catch (caught) {
          const message = errorText(caught)

          patch(id, {
            parse: 'error',
            error: message,
          })

          failed.push(file)
          errors.push(`${file.name}: ${message}`)
        }
      }
    } finally {
      locked.current = false
      setWorking(false)
    }

    return { succeeded, failed, errors }
  }

  function getImportable() {
    return entriesRef.current.filter(
      (entry) =>
        entry.parse === 'ready' &&
        (entry.imported === 'idle' ||
          entry.imported === 'error')
    )
  }

  function validateAll(): string[] {
    const selected = getImportable()
    const counts = new Map<string, number>()
    const problems: string[] = []

    for (const entry of selected) {
      const number =
        entry.header?.requisition_no?.trim() || ''

      counts.set(
        number,
        (counts.get(number) ?? 0) + 1
      )
    }

    for (const entry of selected) {
      const problem = validateEntry(entry)

      if (problem) {
        problems.push(
          `${entry.file.name}: ${problem}`
        )
      }

      const number =
        entry.header?.requisition_no?.trim() || ''

      if (number && (counts.get(number) ?? 0) > 1) {
        problems.push(
          `Requisition ${number} appears more than once.`
        )
      }
    }

    return problems
  }

  async function sendImport(
    entry: Entry,
    overrideDuplicate: boolean
  ): Promise<'success' | 'duplicate' | 'error'> {
    patch(entry.id, {
      imported: 'importing',
      message: 'Importing...',
    })

    try {
      const response = await fetch('/api/import-order', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          header: {
            ...entry.header,
            po_numbers: formatPoNumbers(
              entry.header?.po_numbers
            ),
            requisition_amount_aud:
              entry.header?.requisition_amount_aud == null ||
              entry.header.requisition_amount_aud === ''
                ? null
                : Number(
                    entry.header.requisition_amount_aud
                  ),
          },
          items: entry.items.map((item) => ({
            ...item,
            line_no: Number(item.line_no),
            qty_ordered: Number(item.qty_ordered),
            amount_aud: Number(item.amount_aud),
          })),
          title: getTitle(entry),
          level: entry.level,
          overrideDuplicate,
        }),
      })

      const raw = await response.text()

      let data: {
        error?: string
        ok?: boolean
      }

      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error(
          'Server returned an invalid response. ' +
          'Check Orders before retrying.'
        )
      }

      if (response.status === 409) {
        patch(entry.id, {
          imported: 'duplicate',
          message:
            data.error ||
            'This requisition already exists.',
        })

        return 'duplicate'
      }

      if (!response.ok) {
        throw new Error(
          data.error || 'Import failed.'
        )
      }

      patch(entry.id, {
        imported: 'success',
        message: 'Imported successfully.',
      })

      return 'success'
    } catch (caught) {
      patch(entry.id, {
        imported: 'error',
        message: errorText(caught),
      })

      return 'error'
    }
  }

  async function importAll(): Promise<ImportResult> {
    if (locked.current) {
      return {
        succeeded: 0,
        failed: 1,
        cancelled: false,
      }
    }

    const selected = getImportable()

    if (!selected.length) {
      return {
        succeeded: 0,
        failed: 0,
        cancelled: false,
      }
    }

    const problems = validateAll()

    if (problems.length) {
      window.alert(problems.join('\n'))

      return {
        succeeded: 0,
        failed: selected.length,
        cancelled: false,
      }
    }

    locked.current = true
    setWorking(true)

    let succeeded = 0
    let failed = 0

    try {
      for (const entry of selected) {
        const result = await sendImport(entry, false)

        if (result === 'success') {
          succeeded++
        } else {
          failed++
        }
      }
    } finally {
      locked.current = false
      setWorking(false)
    }

    return {
      succeeded,
      failed,
      cancelled: false,
    }
  }

  async function importDuplicate(entry: Entry) {
    if (locked.current) return

    const problem = validateEntry(entry)

    if (problem) {
      window.alert(problem)
      return
    }

    if (!window.confirm(
      `Requisition ${entry.header?.requisition_no} already exists.\n\n` +
      'Importing another copy creates a duplicate. Continue?'
    )) return

    locked.current = true
    setWorking(true)

    try {
      await sendImport(entry, true)
    } finally {
      locked.current = false
      setWorking(false)
    }
  }

  function updateHeader(
    id: number,
    name: keyof Header,
    value: string
  ) {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id !== id || !entry.header
          ? entry
          : {
              ...entry,
              header: {
                ...entry.header,
                [name]: value,
              },
              mismatchApproved: false,
            }
      )
    )
  }

  function updateItem(
    id: number,
    index: number,
    name: keyof Item,
    value: string
  ) {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id !== id
          ? entry
          : {
              ...entry,
              mismatchApproved: false,
              items: entry.items.map((item, itemIndex) =>
                index === itemIndex
                  ? { ...item, [name]: value }
                  : item
              ),
            }
      )
    )
  }

  function addLine(id: number) {
    updateEntries((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry

        const next = Math.max(
          0,
          ...entry.items.map(
            (item) => Number(item.line_no) || 0
          )
        ) + 1

        return {
          ...entry,
          mismatchApproved: false,
          items: [
            ...entry.items,
            {
              line_no: next,
              item_no: '',
              item_name: '',
              qty_ordered: 1,
              amount_aud: '',
            },
          ],
        }
      })
    )
  }

  // Controller always uses the latest component functions.
  const controllerRef = useRef<PdfController | null>(null)

  controllerRef.current = {
    upload: uploadPdfs,
    validateImport: validateAll,
    importAll,
    reset,
  }

  useEffect(() => {
    if (!bridge) return

    const controller: PdfController = {
      upload: (files) =>
        controllerRef.current!.upload(files),
      validateImport: () =>
        controllerRef.current!.validateImport(),
      importAll: () =>
        controllerRef.current!.importAll(),
      reset: () =>
        controllerRef.current!.reset(),
    }

    bridge.registerPdf(controller)

    return () => bridge.registerPdf(null)
  }, [bridge?.registerPdf])

  useEffect(() => {
    if (!bridge) return

    bridge.reportPdf({
      uploaded: entries.filter(
        (entry) => entry.parse === 'ready'
      ).length,
      importable: entries.filter(
        (entry) =>
          entry.parse === 'ready' &&
          (entry.imported === 'idle' ||
            entry.imported === 'error')
      ).length,
      imported: entries.filter(
        (entry) => entry.imported === 'success'
      ).length,
      failed: entries.filter(
        (entry) => entry.parse === 'error'
      ).length,
    })
  }, [entries, bridge?.reportPdf])

  const visible = entries.filter(
    (entry) =>
      entry.parse === 'ready' ||
      entry.parse === 'error'
  )

  return (
    <div style={{ color: '#111827' }}>
      {visible.map((entry) => {
        const lockedEntry =
          working || entry.imported === 'success'

        return (
          <section
            key={entry.id}
            style={{
              marginBottom: 17,
              border: '2px solid #d1d5db',
              borderRadius: 11,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '15px 17px',
                background: '#f3f4f6',
              }}
            >
              <strong
                style={{
                  fontSize: 18,
                  flex: 1,
                }}
              >
                {entry.header?.requisition_no
                  ? `Requisition ${entry.header.requisition_no} · ${entry.items.length} items`
                  : entry.file.name}
              </strong>

              {entry.imported === 'success' && (
                <span
                  style={{
                    color: '#166534',
                    fontWeight: 800,
                  }}
                >
                  ✓ Imported
                </span>
              )}

              {entry.parse === 'ready' && (
                <button
                  type="button"
                  style={{
                    ...button,
                    fontSize: 20,
                  }}
                  aria-label="Expand or collapse requisition"
                  onClick={() =>
                    patch(entry.id, {
                      expanded: !entry.expanded,
                    })
                  }
                >
                  {entry.expanded ? '⌃' : '⌄'}
                </button>
              )}

              <button
                type="button"
                style={{
                  ...button,
                  color: '#b91c1c',
                }}
                disabled={working}
                onClick={() =>
                  updateEntries((current) =>
                    current.filter(
                      (item) => item.id !== entry.id
                    )
                  )
                }
              >
                Remove
              </button>
            </div>

            {entry.error && (
              <p
                role="alert"
                style={{
                  padding: 12,
                  background: '#fef2f2',
                  color: '#b91c1c',
                }}
              >
                {entry.error}
              </p>
            )}

            {entry.message && (
              <div
                style={{
                  padding: 12,
                  background:
                    entry.imported === 'success'
                      ? '#f0fdf4'
                      : entry.imported === 'duplicate'
                        ? '#fffbeb'
                        : entry.imported === 'error'
                          ? '#fef2f2'
                          : '#eff6ff',
                }}
              >
                {entry.message}

                {entry.imported === 'duplicate' && (
                  <button
                    type="button"
                    disabled={working}
                    style={{
                      ...button,
                      display: 'block',
                      marginTop: 10,
                      color: '#991b1b',
                    }}
                    onClick={() =>
                      void importDuplicate(entry)
                    }
                  >
                    Import as New Copy
                  </button>
                )}
              </div>
            )}

            {entry.parse === 'ready' &&
              entry.expanded &&
              entry.header && (
                <div style={{ padding: 17 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit,minmax(220px,1fr))',
                      gap: 13,
                      marginBottom: 18,
                    }}
                  >
                    {([
                      ['requisition_no', 'Requisition No'],
                      ['po_numbers', 'PO Number(s)'],
                      ['date', 'Date (DD/MM/YYYY)'],
                      ['entered_by', 'Entered By'],
                      [
                        'requisition_amount_aud',
                        'Requisition Amount (AUD)',
                      ],
                    ] as const).map(([name, label]) => (
                      <label key={name}>
                        <strong>{label}</strong>

                        <input
                          style={field}
                          type={
                            name ===
                            'requisition_amount_aud'
                              ? 'number'
                              : 'text'
                          }
                          step={
                            name ===
                            'requisition_amount_aud'
                              ? '0.01'
                              : undefined
                          }
                          value={entry.header?.[name] ?? ''}
                          disabled={lockedEntry}
                          onChange={(event) =>
                            updateHeader(
                              entry.id,
                              name,
                              event.target.value
                            )
                          }
                          onBlur={
                            name === 'po_numbers'
                              ? () =>
                                  updateHeader(
                                    entry.id,
                                    'po_numbers',
                                    formatPoNumbers(
                                      entry.header?.po_numbers
                                    )
                                  )
                              : undefined
                          }
                        />
                      </label>
                    ))}

                    <label>
                      <strong>Order Type</strong>

                      <select
                        style={field}
                        value={entry.orderType}
                        disabled={lockedEntry}
                        onChange={(event) =>
                          patch(entry.id, {
                            orderType: event.target.value,
                            details: '',
                          })
                        }
                      >
                        <option value="">Select type</option>

                        {orderTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>

                    {(entry.orderType === 'Other' ||
                      entry.orderType ===
                        'Non-catalogue') && (
                      <label>
                        <strong>Order Details</strong>

                        <input
                          style={field}
                          value={entry.details}
                          disabled={lockedEntry}
                          onChange={(event) =>
                            patch(entry.id, {
                              details: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      marginBottom: 18,
                    }}
                  >
                    <strong>Import to:</strong>

                    {([3, 5] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        style={{
                          ...button,
                          border: '2px solid #111',
                          background:
                            entry.level === level
                              ? '#facc15'
                              : '#fff',
                        }}
                        disabled={lockedEntry}
                        onClick={() =>
                          patch(entry.id, { level })
                        }
                      >
                        {entry.level === level ? '✓ ' : ''}
                        L{level}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                      }}
                    >
                      Items ({entry.items.length})
                    </h3>

                    <button
                      type="button"
                      style={{
                        ...button,
                        background: '#16a34a',
                        color: '#fff',
                      }}
                      disabled={lockedEntry}
                      onClick={() => addLine(entry.id)}
                    >
                      + Add Line
                    </button>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        minWidth: 720,
                        borderCollapse: 'collapse',
                      }}
                    >
                      <thead style={{ background: '#f3f4f6' }}>
                        <tr>
                          {[
                            'Line No.',
                            'Item No.',
                            'Item Name',
                            'Qty Ordered',
                            'Amount (AUD)',
                            '',
                          ].map((name, index) => (
                            <th
                              key={index}
                              style={{
                                padding: 8,
                                textAlign: 'left',
                              }}
                            >
                              {name}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {entry.items.map((item, index) => (
                          <tr key={`${entry.id}-${index}`}>
                            {([
                              'line_no',
                              'item_no',
                              'item_name',
                              'qty_ordered',
                              'amount_aud',
                            ] as const).map((name) => (
                              <td
                                key={name}
                                style={{
                                  padding: 5,
                                  borderBottom:
                                    '1px solid #eee',
                                }}
                              >
                                <input
                                  style={field}
                                  value={item[name] ?? ''}
                                  disabled={lockedEntry}
                                  type={
                                    name === 'item_no' ||
                                    name === 'item_name'
                                      ? 'text'
                                      : 'number'
                                  }
                                  step={
                                    name === 'amount_aud'
                                      ? '0.01'
                                      : undefined
                                  }
                                  onChange={(event) =>
                                    updateItem(
                                      entry.id,
                                      index,
                                      name,
                                      event.target.value
                                    )
                                  }
                                />
                              </td>
                            ))}

                            <td style={{ padding: 5 }}>
                              <button
                                type="button"
                                style={button}
                                disabled={
                                  lockedEntry ||
                                  entry.items.length <= 1
                                }
                                onClick={() =>
                                  patch(entry.id, {
                                    items:
                                      entry.items.filter(
                                        (_, i) => i !== index
                                      ),
                                    mismatchApproved: false,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      padding: 13,
                      background: hasMismatch(entry)
                        ? '#fffbeb'
                        : '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                    }}
                  >
                    <p>
                      <strong>Requisition Total:</strong>{' '}
                      {currency(
                        entry.header.requisition_amount_aud
                      )}
                    </p>

                    <p style={{ marginTop: 6 }}>
                      <strong>Item Total:</strong>{' '}
                      {currency(itemTotal(entry.items))}
                    </p>

                    {hasMismatch(entry) && (
                      <label
                        style={{
                          display: 'flex',
                          gap: 9,
                          marginTop: 11,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            entry.mismatchApproved
                          }
                          disabled={lockedEntry}
                          onChange={(event) =>
                            patch(entry.id, {
                              mismatchApproved:
                                event.target.checked,
                            })
                          }
                        />

                        <span>
                          I have reviewed this difference.
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              )}
          </section>
        )
      })}
    </div>
  )
}
