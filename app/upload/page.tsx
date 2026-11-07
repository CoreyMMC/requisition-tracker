
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, DragEvent } from 'react'

type ParsedOrderHeader = {
  requisition_no?: string
  po_numbers?: string
  date?: string
  entered_by?: string
  requisition_amount_aud?: number | string | null
}

type ParsedOrderItem = {
  line_no: number | string
  item_no: string
  item_name: string
  qty_ordered: number | string
  amount_aud?: number | string | null
}

type ParseResponse = {
  ok?: boolean
  header?: ParsedOrderHeader
  items?: ParsedOrderItem[]
  raw_line_count?: number
  kept_line_count?: number
  error?: string
}

type ParseStatus = 'queued' | 'parsing' | 'ready' | 'error'
type ImportStatus =
  | 'idle'
  | 'importing'
  | 'success'
  | 'duplicate'
  | 'error'

type PdfEntry = {
  id: number
  file: File
  parseStatus: ParseStatus
  importStatus: ImportStatus
  header: ParsedOrderHeader | null
  items: ParsedOrderItem[]
  rawLineCount: number
  keptLineCount: number
  level: 3 | 5
  orderType: string
  orderTypeExtra: string
  selected: boolean
  expanded: boolean
  confirmMismatch: boolean
  error: string
  importMessage: string
}

const ORDER_TYPES = [
  'General Stock',
  'Non-catalogue',
  'PSA Stock',
  'WINC',
  'Allanby',
  'Name Badges',
  'Other',
]

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 9,
  border: '1px solid #aaa',
  borderRadius: 6,
  color: '#111',
  background: '#fff',
  boxSizing: 'border-box',
}

const cellStyle: CSSProperties = {
  padding: 8,
  border: '1px solid #ddd',
  verticalAlign: 'top',
}

const buttonBase: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 700,
}

const HEADER_FIELDS: {
  field: keyof ParsedOrderHeader
  label: string
  type?: string
}[] = [
  { field: 'requisition_no', label: 'Requisition No' },
  { field: 'po_numbers', label: 'PO Number(s)' },
  { field: 'date', label: 'Date (DD/MM/YYYY)' },
  { field: 'entered_by', label: 'Entered By' },
  {
    field: 'requisition_amount_aud',
    label: 'Requisition Amount (AUD)',
    type: 'number',
  },
]

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

function getTitle(entry: PdfEntry): string | null {
  const selected = entry.orderType
  const extra = entry.orderTypeExtra.trim()

  if (selected === 'Non-catalogue') {
    return extra ? `Non-catalogue - ${extra}` : 'Non-catalogue'
  }

  if (selected === 'Other') {
    return extra || null
  }

  return selected || null
}

function itemTotal(items: ParsedOrderItem[]) {
  return items.reduce(
    (total, item) => total + (Number(item.amount_aud) || 0),
    0
  )
}

function totalMismatch(entry: PdfEntry) {
  const amount = entry.header?.requisition_amount_aud

  if (amount === null || amount === undefined || amount === '') {
    return false
  }

  return Math.abs(Number(amount) - itemTotal(entry.items)) > 0.01
}

function validDate(value?: string) {
  if (!value) return false

  const text = value.trim()
  const au = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/
  )
  const iso = text.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  )

  let day: number
  let month: number
  let year: number

  if (au) {
    day = Number(au[1])
    month = Number(au[2])
    year = Number(au[3])
    if (au[3].length === 2) year += 2000
  } else if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else {
    return false
  }

  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validateEntry(entry: PdfEntry): string | null {
  if (!entry.header) return 'Missing requisition header.'

  if (!entry.header.requisition_no?.trim()) {
    return 'Requisition number is missing.'
  }

  if (!validDate(entry.header.date)) {
    return 'Please enter a valid date (DD/MM/YYYY).'
  }

  if (entry.orderType === 'Other' &&
      !entry.orderTypeExtra.trim()) {
    return 'Enter an order type description for Other.'
  }

  if (!entry.items.length) {
    return 'The requisition contains no items.'
  }

  const seenLines = new Set<number>()

  for (const item of entry.items) {
    const lineNumber = Number(item.line_no)
    const quantity = Number(item.qty_ordered)
    const amount = Number(item.amount_aud)

    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      return 'An item has an invalid line number.'
    }

    if (seenLines.has(lineNumber)) {
      return `Line number ${lineNumber} appears more than once.`
    }

    seenLines.add(lineNumber)

    if (!item.item_name?.trim()) {
      return `Line ${lineNumber}: item name is required.`
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `Line ${lineNumber}: invalid quantity.`
    }

    if (
      item.amount_aud === null ||
      item.amount_aud === undefined ||
      item.amount_aud === '' ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      return `Line ${lineNumber}: invalid amount.`
    }
  }

  if (
    entry.header.requisition_amount_aud !== null &&
    entry.header.requisition_amount_aud !== undefined &&
    entry.header.requisition_amount_aud !== '' &&
    !Number.isFinite(
      Number(entry.header.requisition_amount_aud)
    )
  ) {
    return 'Invalid requisition amount.'
  }

  if (totalMismatch(entry) && !entry.confirmMismatch) {
    return 'Item amounts do not match the requisition total. Please review and acknowledge the difference.'
  }

  return null
}

function newEntry(file: File, id: number): PdfEntry {
  return {
    id,
    file,
    parseStatus: 'queued',
    importStatus: 'idle',
    header: null,
    items: [],
    rawLineCount: 0,
    keptLineCount: 0,
    level: 3,
    orderType: '',
    orderTypeExtra: '',
    selected: false,
    expanded: true,
    confirmMismatch: false,
    error: '',
    importMessage: '',
  }
}

function fileIdentity(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`
}

export default function UploadPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const nextId = useRef(1)
  const operationLock = useRef(false)

  const [entries, setEntries] = useState<PdfEntry[]>([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [message, setMessage] = useState(
    'Select or drag one or more PDFs to begin.'
  )

  const busy = parsing || importing

  function patchEntry(id: number, patch: Partial<PdfEntry>) {
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      )
    )
  }

  function addFiles(files: File[]) {
    if (busy || operationLock.current) return

    const existing = new Set(
      entries.map((entry) => fileIdentity(entry.file))
    )

    const added: PdfEntry[] = []
    let rejected = 0
    let repeated = 0

    for (const file of files) {
      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')

      if (!isPdf) {
        rejected++
        continue
      }

      const identity = fileIdentity(file)

      if (existing.has(identity)) {
        repeated++
        continue
      }

      existing.add(identity)
      added.push(newEntry(file, nextId.current++))
    }

    if (added.length) {
      setEntries((previous) => [...previous, ...added])
    }

    setMessage(
      `${added.length} PDF(s) added.` +
        (repeated ? ` ${repeated} repeated file(s) skipped.` : '') +
        (rejected ? ` ${rejected} non-PDF file(s) skipped.` : '')
    )
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []))

    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  function removeEntry(id: number) {
    if (busy) return

    setEntries((previous) =>
      previous.filter((entry) => entry.id !== id)
    )
  }

  function updateHeader(
    id: number,
    field: keyof ParsedOrderHeader,
    value: string
  ) {
    setEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== id || !entry.header) return entry

        return {
          ...entry,
          header: {
            ...entry.header,
            [field]: value,
          },
          confirmMismatch: false,
        }
      })
    )
  }

  function updateItem(
    id: number,
    index: number,
    field: keyof ParsedOrderItem,
    value: string
  ) {
    setEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== id) return entry

        return {
          ...entry,
          items: entry.items.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, [field]: value }
              : item
          ),
          confirmMismatch: false,
        }
      })
    )
  }

  function addItem(id: number) {
    if (busy) return

    setEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== id ||
            entry.importStatus === 'success') {
          return entry
        }

        const lastLine = Math.max(
          0,
          ...entry.items.map((item) => Number(item.line_no) || 0)
        )

        const newItem: ParsedOrderItem = {
          line_no: lastLine + 1,
          item_no: '',
          item_name: '',
          qty_ordered: 1,
          amount_aud: '',
        }

        return {
          ...entry,
          items: [...entry.items, newItem],
          expanded: true,
          confirmMismatch: false,
        }
      })
    )
  }

  function removeItem(id: number, index: number) {
    if (busy) return

    setEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== id ||
            entry.importStatus === 'success') {
          return entry
        }

        return {
          ...entry,
          items: entry.items.filter(
            (_, itemIndex) => itemIndex !== index
          ),
          confirmMismatch: false,
        }
      })
    )
  }

  async function uploadPdfs() {
    if (operationLock.current) return

    const pending = entries.filter(
      (entry) =>
        entry.parseStatus === 'queued' ||
        entry.parseStatus === 'error'
    )

    if (!pending.length) {
      setMessage('No PDFs waiting to upload.')
      return
    }

    operationLock.current = true
    setParsing(true)

    let succeeded = 0
    let failed = 0

    try {
      for (const entry of pending) {
        patchEntry(entry.id, {
          parseStatus: 'parsing',
          error: '',
          importMessage: '',
        })

        const formData = new FormData()
        formData.append('file', entry.file)

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
              `Upload failed (${response.status}).`
            )
          }

          if (!data.header?.requisition_no) {
            throw new Error(
              'Requisition number could not be detected.'
            )
          }

          if (!data.items?.length) {
            throw new Error('No requisition items detected.')
          }

          patchEntry(entry.id, {
            parseStatus: 'ready',
            importStatus: 'idle',
            header: data.header,
            items: data.items,
            rawLineCount: data.raw_line_count ?? 0,
            keptLineCount: data.kept_line_count ?? data.items.length,
            selected: true,
            expanded: true,
            confirmMismatch: false,
            error: '',
          })

          succeeded++
        } catch (error) {
          patchEntry(entry.id, {
            parseStatus: 'error',
            selected: false,
            error:
              error instanceof Error
                ? error.message
                : 'Unknown PDF error.',
          })

          failed++
        }
      }

      setMessage(
        `Upload finished: ${succeeded} successful, ${failed} failed. Review each requisition before importing.`
      )
    } finally {
      operationLock.current = false
      setParsing(false)
    }
  }

  async function sendImport(
    entry: PdfEntry,
    overrideDuplicate: boolean
  ): Promise<'success' | 'duplicate' | 'error'> {
    patchEntry(entry.id, {
      importStatus: 'importing',
      importMessage: 'Importing...',
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
            requisition_amount_aud:
              entry.header?.requisition_amount_aud === null ||
              entry.header?.requisition_amount_aud === undefined ||
              entry.header?.requisition_amount_aud === ''
                ? null
                : Number(entry.header.requisition_amount_aud),
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
        ok?: boolean
        duplicate?: boolean
        error?: string
        orderId?: string
      }

      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error(
          'The server returned an invalid response. Check Orders before retrying.'
        )
      }

      if (response.status === 409) {
        patchEntry(entry.id, {
          importStatus: 'duplicate',
          selected: false,
          importMessage:
            data.error ||
            `Requisition ${entry.header?.requisition_no} already exists.`,
        })

        return 'duplicate'
      }

      if (!response.ok) {
        throw new Error(
          data.error || `Import failed (${response.status}).`
        )
      }

      patchEntry(entry.id, {
        importStatus: 'success',
        selected: false,
        importMessage: overrideDuplicate
          ? 'Successfully imported as a new copy.'
          : 'Successfully imported.',
      })

      return 'success'
    } catch (error) {
      patchEntry(entry.id, {
        importStatus: 'error',
        selected: false,
        importMessage:
          (error instanceof Error
            ? error.message
            : 'Unknown import error.') +
          ' Check the Orders page before retrying.',
      })

      return 'error'
    }
  }

  async function importSelected() {
    if (operationLock.current) return

    const selected = entries.filter(
      (entry) =>
        entry.selected &&
        entry.parseStatus === 'ready' &&
        entry.importStatus !== 'success'
    )

    if (!selected.length) {
      alert('Select at least one requisition.')
      return
    }

    const counts = new Map<string, number>()

    for (const entry of selected) {
      const number = entry.header?.requisition_no?.trim() ?? ''
      counts.set(number, (counts.get(number) ?? 0) + 1)
    }

    const problems: string[] = []

    for (const entry of selected) {
      const problem = validateEntry(entry)
      const number = entry.header?.requisition_no?.trim() ?? ''

      if (problem) {
        problems.push(`${entry.file.name}: ${problem}`)
      }

      if (number && (counts.get(number) ?? 0) > 1) {
        problems.push(
          `${entry.file.name}: requisition ${number} is selected more than once.`
        )
      }
    }

    if (problems.length) {
      alert(
        'Please correct these issues:\n\n' +
          problems.join('\n')
      )
      return
    }

    if (
      !window.confirm(
        `Import ${selected.length} requisition(s) into Supabase?\n\nContinue?`
      )
    ) {
      return
    }

    operationLock.current = true
    setImporting(true)

    let succeeded = 0
    let duplicates = 0
    let failed = 0

    try {
      for (const entry of selected) {
        const result = await sendImport(entry, false)

        if (result === 'success') succeeded++
        if (result === 'duplicate') duplicates++
        if (result === 'error') failed++
      }

      setMessage(
        `Import finished: ${succeeded} imported, ${duplicates} duplicates, ${failed} failed.`
      )

      // Return to homepage when all selected imports succeed.
      // Keep the page open for duplicates and errors.
      if (succeeded > 0 && duplicates === 0 && failed === 0) {
        router.replace('/orders')
        router.refresh()
      }
    } finally {
      operationLock.current = false
      setImporting(false)
    }
  }

  async function importDuplicateCopy(entry: PdfEntry) {
    if (operationLock.current) return

    const problem = validateEntry(entry)

    if (problem) {
      alert(problem)
      return
    }

    const confirmed = window.confirm(
      `Requisition ${entry.header?.requisition_no} already exists.\n\nImporting as a NEW COPY creates another order and does not update the existing one.\n\nAre you sure?`
    )

    if (!confirmed) return

    operationLock.current = true
    setImporting(true)

    try {
      const result = await sendImport(entry, true)

      if (result === 'success') {
        router.replace('/orders')
        router.refresh()
      } else {
        setMessage('Please review the duplicate import result.')
      }
    } finally {
      operationLock.current = false
      setImporting(false)
    }
  }

  const waitingCount = entries.filter(
    (entry) =>
      entry.parseStatus === 'queued' ||
      entry.parseStatus === 'error'
  ).length

  const readyCount = entries.filter(
    (entry) => entry.parseStatus === 'ready'
  ).length

  const selectedCount = entries.filter(
    (entry) =>
      entry.selected &&
      entry.parseStatus === 'ready' &&
      entry.importStatus !== 'success'
  ).length

  const successfulCount = entries.filter(
    (entry) => entry.importStatus === 'success'
  ).length

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1300,
        margin: '0 auto',
        color: '#111',
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/orders"
          style={{
            ...buttonBase,
            display: 'inline-block',
            border: '2px solid black',
            background: 'white',
            color: 'black',
            textDecoration: 'none',
          }}
        >
          Back to Orders
        </Link>
      </div>

      <h1 style={{ fontSize: 30, fontWeight: 800 }}>
        Upload PDF Requisitions
      </h1>

      <p style={{ marginTop: 8, color: '#555' }}>
        Upload multiple PDFs, review each requisition and
        import the selected orders.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(event) => handleInput(event)}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={handleDrop}
        onClick={() => {
          if (!busy) inputRef.current?.click()
        }}
        style={{
          marginTop: 20,
          padding: '36px 24px',
          border: dragActive
            ? '3px solid #111'
            : '2px dashed #777',
          borderRadius: 12,
          background: dragActive ? '#fef9c3' : '#fafafa',
          cursor: busy ? 'not-allowed' : 'pointer',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Drag PDF requisitions here
        </div>

        <div style={{ fontSize: 17 }}>
          Or click to choose one or multiple PDFs
        </div>

        <div style={{ color: '#666', marginTop: 8 }}>
          PDF files only
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => void uploadPdfs()}
          disabled={busy || waitingCount === 0}
          style={{
            ...buttonBase,
            border: '2px solid #166534',
            background: '#16a34a',
            color: 'white',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy || waitingCount === 0 ? 0.5 : 1,
          }}
        >
          {parsing
            ? 'Uploading...'
            : waitingCount === 1
              ? 'Upload PDF'
              : `Upload PDFs (${waitingCount})`}
        </button>

        <button
          type="button"
          onClick={() => void importSelected()}
          disabled={busy || selectedCount === 0}
          style={{
            ...buttonBase,
            border: '2px solid #1d4ed8',
            background: '#2563eb',
            color: 'white',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy || selectedCount === 0 ? 0.5 : 1,
          }}
        >
          {importing
            ? 'Importing...'
            : `Import Selected Requisitions (${selectedCount})`}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEntries([])
            setMessage('Queue cleared.')
            if (inputRef.current) {
              inputRef.current.value = ''
            }
          }}
          style={{
            ...buttonBase,
            border: '1px solid #999',
            background: '#fff',
            color: '#111',
          }}
        >
          Clear All
        </button>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 15,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: '#f7f7f7',
        }}
      >
        <strong>Status:</strong>
        <div style={{ marginTop: 6 }}>{message}</div>

        <div
          style={{
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            marginTop: 12,
            fontWeight: 600,
          }}
        >
          <span>Files: {entries.length}</span>
          <span>Uploaded: {readyCount}</span>
          <span>Selected: {selectedCount}</span>
          <span>Imported: {successfulCount}</span>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {entries.map((entry) => {
          const mismatch = totalMismatch(entry)

          const sameReqCount = entries.filter(
            (other) =>
              other.parseStatus === 'ready' &&
              other.header?.requisition_no?.trim() &&
              other.header?.requisition_no?.trim() ===
                entry.header?.requisition_no?.trim()
          ).length

          return (
            <section
              key={entry.id}
              style={{
                border: '2px solid #d1d5db',
                borderRadius: 12,
                marginBottom: 20,
                overflow: 'hidden',
                background: 'white',
              }}
            >
              <div
                style={{
                  padding: 16,
                  background: '#f3f4f6',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 240px' }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 18,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {entry.file.name}
                  </div>

                  <div style={{ color: '#555', marginTop: 4 }}>
                    {entry.parseStatus === 'queued' &&
                      'Waiting to upload'}
                    {entry.parseStatus === 'parsing' &&
                      'Uploading PDF...'}
                    {entry.parseStatus === 'error' &&
                      'Upload failed'}
                    {entry.parseStatus === 'ready' &&
                      `Requisition ${
                        entry.header?.requisition_no || '—'
                      } · ${entry.items.length} item(s)`}
                  </div>
                </div>

                {entry.parseStatus === 'ready' &&
                  entry.importStatus !== 'success' && (
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontWeight: 700,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={entry.selected}
                        disabled={busy}
                        onChange={(event) =>
                          patchEntry(entry.id, {
                            selected: event.target.checked,
                          })
                        }
                      />
                      Include in batch
                    </label>
                  )}

                {entry.importStatus === 'success' && (
                  <strong style={{ color: '#166534' }}>
                    ✓ Imported
                  </strong>
                )}

                {entry.parseStatus === 'ready' && (
                  <button
                    type="button"
                    onClick={() =>
                      patchEntry(entry.id, {
                        expanded: !entry.expanded,
                      })
                    }
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #999',
                      borderRadius: 6,
                      background: 'white',
                      color: 'black',
                    }}
                  >
                    {entry.expanded ? 'Hide Review' : 'Show Review'}
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeEntry(entry.id)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #991b1b',
                    borderRadius: 6,
                    color: '#991b1b',
                    background: 'white',
                  }}
                >
                  Remove
                </button>
              </div>

              {entry.error && (
                <div
                  role="alert"
                  style={{
                    padding: 14,
                    background: '#fee2e2',
                    color: '#991b1b',
                  }}
                >
                  {entry.error}
                </div>
              )}

              {entry.importMessage && (
                <div
                  role="status"
                  style={{
                    padding: 14,
                    background:
                      entry.importStatus === 'success'
                        ? '#dcfce7'
                        : entry.importStatus === 'duplicate'
                          ? '#fef3c7'
                          : entry.importStatus === 'error'
                            ? '#fee2e2'
                            : '#eff6ff',
                    color: '#111',
                    fontWeight: 600,
                  }}
                >
                  {entry.importMessage}

                  {entry.importStatus === 'duplicate' && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void importDuplicateCopy(entry)
                        }
                        style={{
                          ...buttonBase,
                          background: '#dc2626',
                          color: 'white',
                          border: '2px solid #991b1b',
                        }}
                      >
                        Import as New Copy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {entry.parseStatus === 'ready' &&
                entry.expanded &&
                entry.header && (
                  <div style={{ padding: 18 }}>
                    {sameReqCount > 1 && (
                      <div
                        style={{
                          padding: 12,
                          background: '#fef3c7',
                          border: '1px solid #d97706',
                          borderRadius: 6,
                          marginBottom: 16,
                        }}
                      >
                        ⚠ This requisition number appears
                        more than once in your upload queue.
                      </div>
                    )}

                    <h3
                      style={{
                        fontSize: 19,
                        fontWeight: 800,
                        marginBottom: 14,
                      }}
                    >
                      Requisition Details
                    </h3>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: 15,
                        marginBottom: 20,
                      }}
                    >
                      {HEADER_FIELDS.map((field) => (
                        <label key={field.field}>
                          <strong>{field.label}</strong>
                          <input
                            type={field.type || 'text'}
                            step={
                              field.type === 'number'
                                ? '0.01'
                                : undefined
                            }
                            value={
                              entry.header?.[field.field] ?? ''
                            }
                            disabled={
                              busy ||
                              entry.importStatus === 'success'
                            }
                            onChange={(event) =>
                              updateHeader(
                                entry.id,
                                field.field,
                                event.target.value
                              )
                            }
                            style={inputStyle}
                          />
                          {field.field === 'date' && (
                            <span
                              style={{
                                display: 'block',
                                fontSize: 12,
                                color: '#666',
                                marginTop: 4,
                              }}
                            >
                              Check the date — the PDF may
                              contain its report date.
                            </span>
                          )}
                        </label>
                      ))}

                      <label>
                        <strong>Order Type</strong>
                        <select
                          value={entry.orderType}
                          disabled={
                            busy ||
                            entry.importStatus === 'success'
                          }
                          onChange={(event) =>
                            patchEntry(entry.id, {
                              orderType: event.target.value,
                              orderTypeExtra: '',
                            })
                          }
                          style={inputStyle}
                        >
                          <option value="">Select</option>
                          {ORDER_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(entry.orderType === 'Other' ||
                        entry.orderType === 'Non-catalogue') && (
                        <label>
                          <strong>
                            {entry.orderType === 'Other'
                              ? 'Custom Order Type'
                              : 'Non-catalogue Details (optional)'}
                          </strong>
                          <input
                            type="text"
                            value={entry.orderTypeExtra}
                            placeholder={
                              entry.orderType === 'Other'
                                ? 'Enter order type'
                                : 'e.g. Initial L5 Order'
                            }
                            disabled={
                              busy ||
                              entry.importStatus === 'success'
                            }
                            onChange={(event) =>
                              patchEntry(entry.id, {
                                orderTypeExtra:
                                  event.target.value,
                              })
                            }
                            style={inputStyle}
                          />
                        </label>
                      )}
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <strong
                        style={{
                          display: 'block',
                          marginBottom: 10,
                        }}
                      >
                        Import to:
                      </strong>

                      <div
                        style={{
                          display: 'flex',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        {([3, 5] as const).map((level) => (
                          <button
                            key={level}
                            type="button"
                            disabled={
                              busy ||
                              entry.importStatus === 'success'
                            }
                            aria-pressed={entry.level === level}
                            onClick={() =>
                              patchEntry(entry.id, { level })
                            }
                            style={{
                              ...buttonBase,
                              border: '3px solid #111',
                              background:
                                entry.level === level
                                  ? '#facc15'
                                  : '#fff',
                              color: '#111',
                            }}
                          >
                            {entry.level === level ? '✓ ' : ''}
                            Level {level}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <h3
                        style={{
                          fontSize: 19,
                          fontWeight: 800,
                        }}
                      >
                        Items ({entry.items.length})
                      </h3>

                      <button
                        type="button"
                        disabled={
                          busy ||
                          entry.importStatus === 'success'
                        }
                        onClick={() => addItem(entry.id)}
                        style={{
                          ...buttonBase,
                          background: '#16a34a',
                          color: 'white',
                          border: '2px solid #166534',
                        }}
                      >
                        + Add Line
                      </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          minWidth: 800,
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#f3f4f6' }}>
                            {[
                              'Line No.',
                              'Item No.',
                              'Item Name',
                              'Qty Ordered',
                              'Amount (AUD)',
                              'Action',
                            ].map((name) => (
                              <th key={name} style={cellStyle}>
                                {name}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          {entry.items.map((item, index) => (
                            <tr key={`${entry.id}-${index}`}>
                              {(
                                [
                                  'line_no',
                                  'item_no',
                                  'item_name',
                                  'qty_ordered',
                                  'amount_aud',
                                ] as const
                              ).map((field) => (
                                <td
                                  key={field}
                                  style={cellStyle}
                                >
                                  <input
                                    type={
                                      field === 'line_no' ||
                                      field === 'qty_ordered' ||
                                      field === 'amount_aud'
                                        ? 'number'
                                        : 'text'
                                    }
                                    step={
                                      field === 'amount_aud'
                                        ? '0.01'
                                        : undefined
                                    }
                                    value={item[field] ?? ''}
                                    disabled={
                                      busy ||
                                      entry.importStatus === 'success'
                                    }
                                    onChange={(event) =>
                                      updateItem(
                                        entry.id,
                                        index,
                                        field,
                                        event.target.value
                                      )
                                    }
                                    style={inputStyle}
                                  />
                                </td>
                              ))}

                              <td style={cellStyle}>
                                <button
                                  type="button"
                                  disabled={
                                    busy ||
                                    entry.importStatus === 'success'
                                  }
                                  onClick={() =>
                                    removeItem(entry.id, index)
                                  }
                                  style={{
                                    padding: '8px 10px',
                                    background: 'white',
                                    border: '1px solid #dc2626',
                                    borderRadius: 6,
                                    color: '#b91c1c',
                                    fontWeight: 700,
                                  }}
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
                        marginTop: 18,
                        padding: 14,
                        background: mismatch
                          ? '#fef3c7'
                          : '#f3f4f6',
                        border: mismatch
                          ? '1px solid #d97706'
                          : '1px solid #ddd',
                        borderRadius: 7,
                      }}
                    >
                      <div>
                        <strong>Requisition Total:</strong>{' '}
                        {currency(
                          entry.header.requisition_amount_aud
                        )}
                      </div>

                      <div style={{ marginTop: 5 }}>
                        <strong>Sum of Item Amounts:</strong>{' '}
                        {currency(itemTotal(entry.items))}
                      </div>

                      {mismatch && (
                        <label
                          style={{
                            display: 'flex',
                            gap: 9,
                            marginTop: 12,
                            alignItems: 'flex-start',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={entry.confirmMismatch}
                            disabled={
                              busy ||
                              entry.importStatus === 'success'
                            }
                            onChange={(event) =>
                              patchEntry(entry.id, {
                                confirmMismatch:
                                  event.target.checked,
                              })
                            }
                          />
                          <span>
                            <strong>
                              I have reviewed this amount
                              difference.
                            </strong>
                            <div style={{ fontSize: 13 }}>
                              Check that every item was
                              extracted or manually added
                              before importing.
                            </div>
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

      {successfulCount > 0 && (
        <div style={{ marginTop: 14 }}>
          <Link
            href="/orders"
            style={{
              ...buttonBase,
              display: 'inline-block',
              background: '#111',
              color: '#fff',
              textDecoration: 'none',
            }}
          >
            View Orders
          </Link>
        </div>
      )}
    </main>
  )
}
