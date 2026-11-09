
'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseRequisitionsExcel } from '@/lib/parse-requisitions-excel'
import {
  combineExports,
  compareExports,
  type Coverage,
  type UploadedExport,
  type SavedOrder,
  type HistoricalEntry,
  type ReviewGroup,
  type ReviewResult,
} from '@/lib/excel-sync-review'
import PoSyncControls from './po-sync-controls'
import NewOrderImport from './new-order-import'

type Snapshot = {
  orders: SavedOrder[]
  history: HistoricalEntry[]
  baseline: boolean
}

const panel: CSSProperties = {
  background: '#fff',
  border: '1px solid #d7dde3',
  borderRadius: 12,
  padding: 18,
  marginBottom: 16,
  color: '#111827',
}

const button: CSSProperties = {
  border: '1px solid #b9c2cc',
  borderRadius: 8,
  background: '#fff',
  color: '#111827',
  padding: '10px 15px',
  fontWeight: 700,
  cursor: 'pointer',
}

const input: CSSProperties = {
  width: '100%',
  padding: 9,
  background: '#fff',
  color: '#111827',
  border: '1px solid #b9c2cc',
  borderRadius: 7,
  boxSizing: 'border-box',
}

const muted: CSSProperties = {
  color: '#64748b',
  fontSize: 13,
}

function dateText(date: string | null) {
  if (!date) return 'Not recorded'
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return parts
    ? `${parts[3]}/${parts[2]}/${parts[1]}`
    : date
}

function ExcelLineTable({ item }: { item: ReviewResult }) {
  const lines = item.combined.requisition.lines

  return (
    <div style={{ overflowX: 'auto', marginTop: 14 }}>
      <table
        style={{
          width: '100%',
          minWidth: 610,
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead style={{ background: '#f1f5f9' }}>
          <tr>
            {['Item No.', 'Description', 'Qty', 'Amount'].map(
              (heading) => (
                <th
                  key={heading}
                  style={{
                    padding: 10,
                    textAlign: 'left',
                    borderBottom: '1px solid #cbd5e1',
                  }}
                >
                  {heading}
                </th>
              )
            )}
          </tr>
        </thead>

        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.row}-${index}`}>
              <td style={{ padding: 9, borderBottom: '1px solid #eee' }}>
                {line.item || '—'}
              </td>
              <td style={{ padding: 9, borderBottom: '1px solid #eee' }}>
                {line.description}
              </td>
              <td style={{ padding: 9, borderBottom: '1px solid #eee' }}>
                {line.quantity ?? '—'}
              </td>
              <td style={{ padding: 9, borderBottom: '1px solid #eee' }}>
                {line.amount == null
                  ? '—'
                  : `$${line.amount.toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReviewCard({
  item,
  defaultOpen,
  busy,
  baseline,
  onMark,
  onUnmark,
}: {
  item: ReviewResult
  defaultOpen: boolean
  busy: boolean
  baseline: boolean
  onMark: (number: string) => void
  onUnmark: (number: string) => void
}) {
  const req = item.combined.requisition

  return (
    <details
      open
      style={{
        background: '#fff',
        border: '1px solid #d9e0e7',
        borderRadius: 10,
        padding: 14,
        marginTop: 10,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontWeight: 800,
          fontSize: 15,
        }}
      >
        {req.number}
        <span style={{ ...muted, marginLeft: 10 }}>
          {req.lines.length} lines · {req.enteredBy || 'Unknown staff'}
        </span>
      </summary>

      <div style={{ marginTop: 14, lineHeight: 1.7 }}>
        <p><strong>Excel Status:</strong> {req.statuses.join(' / ')}</p>
        <p><strong>Sources:</strong> {item.combined.sources.join(', ')}</p>
        <p>
          <strong>Delivery:</strong>{' '}
          {req.locations.join(' / ') || 'Unknown'}
        </p>

        {item.saved && (
          <div
            style={{
              background: '#eff6ff',
              padding: 12,
              borderRadius: 8,
              marginTop: 12,
            }}
          >
            <strong>Existing Order</strong>
            <p>Date: {dateText(item.saved.order_date)}</p>
            <p>Order Type: {item.saved.title || 'Not recorded'}</p>
            <p>Level: {item.saved.level ?? 'Not recorded'}</p>
            <p>PO: {item.saved.po_number || '(blank)'}</p>
          </div>
        )}

        {item.combined.issues.length > 0 && (
          <div
            style={{
              padding: 12,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 8,
              marginTop: 12,
            }}
          >
            <strong>Issues requiring review</strong>
            <ul style={{ paddingLeft: 20, marginTop: 7 }}>
              {item.combined.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {item.group === 'review' &&
          baseline &&
          !item.saved &&
          !item.historical && (
            <button
              type="button"
              style={{ ...button, marginTop: 13 }}
              disabled={busy}
              onClick={() => onMark(req.number)}
            >
              Mark Historical Only
            </button>
          )}

        {item.historical?.disposition === 'historical_only' && (
          <button
            type="button"
            style={{ ...button, marginTop: 13 }}
            disabled={busy}
            onClick={() => onUnmark(req.number)}
          >
            Return to Review
          </button>
        )}

        <ExcelLineTable item={item} />
      </div>
    </details>
  )
}

function ReviewSection({
  title,
  items,
  initialOpen,
  baseline,
  busy,
  onMark,
  onUnmark,
}: {
  title: string
  items: ReviewResult[]
  initialOpen: boolean
  baseline: boolean
  busy: boolean
  onMark: (number: string) => void
  onUnmark: (number: string) => void
}) {
  const [visible, setVisible] = useState(initialOpen)
  const [allOpen, setAllOpen] = useState(initialOpen)
  const [version, setVersion] = useState(0)

  function expand(value: boolean) {
    setAllOpen(value)
    setVersion((current) => current + 1)
  }

  return (
    <section style={panel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>
          {title} ({items.length})
        </h2>

        <button
          type="button"
          style={button}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? 'Minimise Section' : 'Show Section'}
        </button>
      </div>

      {visible && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 9,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              style={button}
              onClick={() => expand(true)}
            >
              Expand All
            </button>
            <button
              type="button"
              style={button}
              onClick={() => expand(false)}
            >
              Collapse All
            </button>
          </div>

          {items.length === 0 && (
            <p style={{ ...muted, marginTop: 13 }}>
              No requisitions in this section.
            </p>
          )}

          {items.map((item) => (
            <ReviewCard
              key={`${version}-${item.combined.requisition.number}`}
              item={item}
              defaultOpen={allOpen}
              busy={busy}
              baseline={baseline}
              onMark={onMark}
              onUnmark={onUnmark}
            />
          ))}
        </>
      )}
    </section>
  )
}

export default function ExcelSyncPage() {
  const supabase = useMemo(() => createClient(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const working = useRef(false)

  const [uploads, setUploads] = useState<UploadedExport[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadSnapshot() {
    const { data: auth, error: authError } =
      await supabase.auth.getUser()

    if (authError || !auth.user) {
      throw new Error('Please sign in first.')
    }

    const orders: SavedOrder[] = []
    const history: HistoricalEntry[] = []

    for (let start = 0; ; start += 1000) {
      const { data, error: queryError } = await supabase
        .from('orders')
        .select('id,requisition_number,po_number,order_date,title,level')
        .order('id')
        .range(start, start + 999)

      if (queryError) throw new Error(queryError.message)

      const page = (data ?? []) as SavedOrder[]
      orders.push(...page)
      if (page.length < 1000) break
    }

    for (let start = 0; ; start += 1000) {
      const { data, error: queryError } = await supabase
        .from('excel_sync_requisitions')
        .select('requisition_number,disposition')
        .order('requisition_number')
        .range(start, start + 999)

      if (queryError) throw new Error(queryError.message)

      const page = (data ?? []) as HistoricalEntry[]
      history.push(...page)
      if (page.length < 1000) break
    }

    const { data: baselineRuns, error: runError } =
      await supabase
        .from('excel_sync_runs')
        .select('id')
        .eq('kind', 'baseline')
        .limit(1)

    if (runError) throw new Error(runError.message)

    setSnapshot({
      orders,
      history,
      baseline: (baselineRuns?.length ?? 0) > 0,
    })
  }

  async function addFiles(files: File[]) {
    if (working.current || busy || files.length === 0) return

    working.current = true
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const seen = new Set(uploads.map((file) => file.id))
      const added: UploadedExport[] = []

      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
          setError('Only XLSX Excel files are supported.')
          continue
        }

        const id = `${file.name}:${file.size}:${file.lastModified}`
        if (seen.has(id)) continue
        seen.add(id)

        try {
          const workbook = await parseRequisitionsExcel(file)

          added.push({
            id,
            name: file.name,
            label: file.name.replace(/\.xlsx$/i, ''),
            coverage: 'unknown',
            workbook,
            error: '',
          })
        } catch (caught) {
          added.push({
            id,
            name: file.name,
            label: file.name.replace(/\.xlsx$/i, ''),
            coverage: 'unknown',
            workbook: null,
            error:
              caught instanceof Error
                ? caught.message
                : 'Unable to read Excel file.',
          })
        }
      }

      setUploads((current) => [...current, ...added])
      await loadSnapshot()

      setNotice(
        added.length
          ? `${added.filter((file) => file.workbook).length} spreadsheet(s) loaded.`
          : 'These files have already been added.'
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load requisitions.'
      )
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    if (!busy) void addFiles(Array.from(event.dataTransfer.files))
  }

  const combined = useMemo(
    () => combineExports(uploads),
    [uploads]
  )

  const compared = useMemo(
    () => snapshot
      ? compareExports(
          combined.records,
          snapshot.orders,
          snapshot.history,
          snapshot.baseline
        )
      : [],
    [combined, snapshot]
  )

  const validFiles = uploads.filter((file) => file.workbook !== null)

  const initialHistorical = compared.filter(
    (item) => item.group === 'historical' && !item.historical
  )

  const readyForBaseline =
    Boolean(snapshot && !snapshot.baseline) &&
    validFiles.length >= 5 &&
    validFiles.length === uploads.length &&
    validFiles.every(
      (file) =>
        file.coverage !== 'unknown' &&
        file.label.trim().length > 0
    ) &&
    new Set(
      validFiles.map((file) => file.label.trim().toUpperCase())
    ).size >= 5 &&
    initialHistorical.length > 0

  async function establishBaseline() {
    if (!readyForBaseline || busy) return

    if (!window.confirm(
      `Establish the historical baseline using ${validFiles.length} files?\n\n` +
      `${initialHistorical.length} requisitions will be saved as historical.\n` +
      `Existing orders will not be modified.`
    )) return

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_create_baseline',
        {
          p_entries: initialHistorical.map((item) => ({
            number: item.combined.requisition.number,
            sources: item.combined.sources,
          })),
          p_file_names: validFiles.map(
            (file) => `${file.name} (${file.label})`
          ),
        }
      )

      if (rpcError) throw new Error(rpcError.message)

      await loadSnapshot()
      setNotice(`Historical baseline saved: ${data} requisitions.`)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Baseline could not be saved.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeHistorical(number: string, remove: boolean) {
    if (!snapshot?.baseline || busy) return

    if (!window.confirm(
      remove
        ? `Return ${number} to review?`
        : `Mark ${number} Historical Only?\n\nIt will be excluded from future new-order imports.`
    )) return

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const { error: rpcError } = await supabase.rpc(
        remove
          ? 'excel_sync_unmark_historical'
          : 'excel_sync_mark_historical',
        { p_requisition_number: number }
      )

      if (rpcError) throw new Error(rpcError.message)

      await loadSnapshot()
      setNotice(
        remove
          ? `${number} returned to review.`
          : `${number} marked Historical Only.`
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update historical decision.'
      )
    } finally {
      setBusy(false)
    }
  }

  const filtered = compared.filter((item) => {
    const query = search.trim().toLowerCase()
    const req = item.combined.requisition

    return (
      !query ||
      req.number.toLowerCase().includes(query) ||
      req.enteredBy.toLowerCase().includes(query) ||
      item.combined.sources.some((source) =>
        source.toLowerCase().includes(query)
      ) ||
      req.lines.some((line) =>
        line.description.toLowerCase().includes(query)
      )
    )
  })

  const byGroup = (group: ReviewGroup) =>
    filtered.filter((item) => item.group === group)

  const count = (group: ReviewGroup) =>
    compared.filter((item) => item.group === group).length

  return (
    <main
      style={{
        maxWidth: 1250,
        margin: '0 auto',
        padding: '24px 16px 50px',
        color: '#111827',
      }}
    >
      <nav style={{ display: 'flex', gap: 18, marginBottom: 18 }}>
        <Link href="/orders">← Orders</Link>
        <Link href="/upload">Upload PDF</Link>
      </nav>

      <header
        style={{
          background: '#166534',
          color: '#fff',
          padding: 24,
          borderRadius: 14,
          marginBottom: 18,
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>
          Excel Synchronisation
        </h1>

        <p style={{ marginTop: 7 }}>
          Review updated POs and new requisitions before saving.
        </p>
      </header>

      <section style={panel}>
        <h2 style={{ fontSize: 21, fontWeight: 800 }}>
          Upload Excel Requisitions
        </h2>

        <p style={{ ...muted, marginTop: 7, marginBottom: 16 }}>
          Upload one staff export or multiple XLSX spreadsheets.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (!busy) setDragActive(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragActive(false)
          }}
          onDrop={onDrop}
          style={{
            textAlign: 'center',
            padding: '35px 20px',
            border: dragActive
              ? '3px dashed #15803d'
              : '2px dashed #a7b7aa',
            background: dragActive ? '#ecfdf5' : '#f8fbf9',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 40 }}>📊</div>

          <h3
            style={{
              fontSize: 19,
              fontWeight: 800,
              margin: '10px 0',
            }}
          >
            Drag and drop Excel files here
          </h3>

          <p style={{ ...muted, marginBottom: 16 }}>
            Or select files from your computer.
          </p>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xlsx"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            style={{
              ...button,
              background: '#15803d',
              color: '#fff',
              padding: '13px 22px',
            }}
          >
            {busy ? 'Processing...' : 'Choose Excel Files'}
          </button>

          <p style={{ ...muted, marginTop: 12 }}>
            XLSX only · Nothing is imported until you confirm.
          </p>
        </div>

        {uploads.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 16,
                gap: 10,
              }}
            >
              <strong>{uploads.length} file(s) loaded</strong>

              <button
                type="button"
                style={button}
                disabled={busy}
                onClick={() => {
                  setUploads([])
                  setSnapshot(null)
                  setSearch('')
                  setError('')
                  setNotice('')
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Clear Files
              </button>
            </div>

            {uploads.map((file) => (
              <div
                key={file.id}
                style={{
                  background: '#f8fafc',
                  padding: 13,
                  border: '1px solid #e2e8f0',
                  borderRadius: 9,
                  marginTop: 11,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <strong>{file.name}</strong>
                  <button
                    type="button"
                    style={button}
                    disabled={busy}
                    onClick={() =>
                      setUploads((current) =>
                        current.filter((f) => f.id !== file.id)
                      )
                    }
                  >
                    Remove
                  </button>
                </div>

                {file.workbook ? (
                  <p style={{ ...muted, margin: '7px 0' }}>
                    {file.workbook.requisitions.length} eligible ·{' '}
                    {file.workbook.excluded.length} excluded
                  </p>
                ) : (
                  <p style={{ color: '#b91c1c' }}>
                    {file.error || 'File could not be parsed.'}
                  </p>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit,minmax(180px,1fr))',
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <label>
                    <strong>Staff / Export Label</strong>
                    <input
                      style={{ ...input, marginTop: 6 }}
                      value={file.label}
                      disabled={busy}
                      onChange={(event) =>
                        setUploads((current) =>
                          current.map((f) =>
                            f.id === file.id
                              ? { ...f, label: event.target.value }
                              : f
                          )
                        )
                      }
                    />
                  </label>

                  <label>
                    <strong>Level Coverage</strong>
                    <select
                      style={{ ...input, marginTop: 6 }}
                      value={file.coverage}
                      disabled={busy}
                      onChange={(event) =>
                        setUploads((current) =>
                          current.map((f) =>
                            f.id === file.id
                              ? {
                                  ...f,
                                  coverage:
                                    event.target.value as Coverage,
                                }
                              : f
                          )
                        )
                      }
                    >
                      <option value="unknown">Not specified</option>
                      <option value="3">L3</option>
                      <option value="5">L5</option>
                      <option value="both">Both Levels</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </>
        )}

        {error && (
          <p
            role="alert"
            style={{
              color: '#b91c1c',
              background: '#fef2f2',
              padding: 12,
              borderRadius: 8,
              marginTop: 12,
            }}
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            style={{
              color: '#166534',
              background: '#f0fdf4',
              padding: 12,
              borderRadius: 8,
              marginTop: 12,
            }}
          >
            {notice}
          </p>
        )}
      </section>

      {snapshot && validFiles.length > 0 && (
        <>
          <section
            style={{
              ...panel,
              background: '#f0fdf4',
              borderColor: '#bbf7d0',
            }}
          >
            <strong style={{ color: '#166534' }}>
              {snapshot.baseline
                ? '✓ Historical Baseline Established'
                : 'Historical Baseline Not Yet Saved'}
            </strong>

            <p style={{ ...muted, marginTop: 7 }}>
              Existing requisitions and saved historical
              classifications are protected.
            </p>

            {!snapshot.baseline && (
              <button
                type="button"
                style={{
                  ...button,
                  marginTop: 12,
                  background: readyForBaseline
                    ? '#166534'
                    : '#e5e7eb',
                  color: readyForBaseline ? '#fff' : '#6b7280',
                }}
                disabled={!readyForBaseline || busy}
                onClick={() => void establishBaseline()}
              >
                Establish Historical Baseline
              </button>
            )}
          </section>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
              marginBottom: 18,
            }}
          >
            {[
              ['Excel Files', validFiles.length],
              ['Eligible', combined.records.length],
              ['Updated POs', count('po')],
              ['New Requisitions', count('new')],
              ['Needs Review', count('review')],
              ['Excluded', combined.excluded.length],
              ['Saved Historical', snapshot.history.length],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{ ...panel, padding: 13, marginBottom: 0 }}
              >
                <p style={muted}>{label}</p>
                <strong style={{ fontSize: 24 }}>{value}</strong>
              </div>
            ))}
          </div>

          <section style={panel}>
            <label>
              <strong>Search Review Results</strong>
              <input
                style={{ ...input, marginTop: 8 }}
                value={search}
                placeholder="Requisition number, staff or item..."
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </section>

          {/* 1. UPDATED POs */}
          <PoSyncControls
            items={byGroup('po')}
            onChanged={loadSnapshot}
          />

          {/* 2. NEW REQUISITIONS */}
          <NewOrderImport
            items={byGroup('new')}
            onChanged={loadSnapshot}
          />

          {/* 3. NEEDS REVIEW */}
          <ReviewSection
            title="Needs Review"
            items={byGroup('review')}
            initialOpen={true}
            baseline={snapshot.baseline}
            busy={busy}
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />

          {/* 4. EXCLUDED REQUISITIONS */}
          <section style={panel}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>
              Excluded Requisitions ({combined.excluded.length})
            </h2>

            <p style={{ ...muted, marginTop: 6 }}>
              Draft, cancelled, rejected and other excluded orders.
              These cannot be imported through Excel Sync.
            </p>

            {combined.excluded.length === 0 && (
              <p style={{ ...muted, marginTop: 13 }}>
                No excluded requisitions.
              </p>
            )}

            {combined.excluded.map((entry) => (
              <details
                key={entry.number}
                open
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 9,
                  marginTop: 10,
                  padding: 12,
                  background: '#f8fafc',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontWeight: 800,
                  }}
                >
                  {entry.number}
                  {' · '}
                  {entry.reasons.join(' / ')}
                </summary>

                <p style={{ ...muted, marginTop: 8 }}>
                  Excluded from active imports and historical baseline.
                </p>
              </details>
            ))}
          </section>

          {/* 5. ARCHIVE / UNCHANGED */}
          <ReviewSection
            title="Historical Requisitions"
            items={byGroup('historical')}
            initialOpen={false}
            baseline={snapshot.baseline}
            busy={busy}
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />

          <ReviewSection
            title="Unchanged Requisitions"
            items={byGroup('unchanged')}
            initialOpen={false}
            baseline={snapshot.baseline}
            busy={busy}
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />
        </>
      )}
    </main>
  )
}
