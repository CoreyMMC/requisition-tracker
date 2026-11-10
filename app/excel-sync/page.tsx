
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  CSSProperties,
  DragEvent,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseRequisitionsExcel } from '@/lib/parse-requisitions-excel'
import { formatPoNumbers } from '@/lib/po-numbers'
import {
  combineExports,
  compareExports,
  type UploadedExport,
  type SavedOrder,
  type HistoricalEntry,
  type ReviewResult,
} from '@/lib/excel-sync-review'
import PoSyncControls from './po-sync-controls'
import NewOrderImport from './new-order-import'
import type {
  NewOrderController,
} from './new-order-import'

type UploadResult = {
  succeeded: number
  failed: File[]
  errors: string[]
}

type ImportResult = {
  succeeded: number
  failed: number
  cancelled: boolean
}

export type ExcelSyncController = {
  upload: (files: File[]) => Promise<UploadResult>
  validateImport: () => string[]
  importAll: () => Promise<ImportResult>
  reset: () => void
}

type ExcelStatus = {
  uploaded: number
  newCount: number
  poCount: number
}

type Props = {
  embedded?: boolean
  onRegister?: (
    controller: ExcelSyncController | null
  ) => void
  onStatus?: (status: ExcelStatus) => void
}

type Snapshot = {
  orders: SavedOrder[]
  history: HistoricalEntry[]
  baseline: boolean
}

const panel: CSSProperties = {
  padding: 17,
  marginBottom: 16,
  border: '1px solid #d1d5db',
  borderRadius: 11,
  color: '#111827',
  background: '#fff',
}

const button: CSSProperties = {
  padding: '10px 15px',
  border: '1px solid #b9c2cc',
  borderRadius: 8,
  color: '#111827',
  background: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
}

const muted: CSSProperties = {
  fontSize: 13,
  color: '#64748b',
}

function fileIdentity(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function ExcelLines({ item }: { item: ReviewResult }) {
  const lines = item.combined.requisition.lines

  return (
    <div style={{ overflowX: 'auto', marginTop: 13 }}>
      <table
        style={{
          width: '100%',
          minWidth: 590,
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead style={{ background: '#f1f5f9' }}>
          <tr>
            {[
              'Item No.',
              'Description',
              'Qty',
              'Amount',
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  padding: 9,
                  textAlign: 'left',
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.row}-${index}`}>
              <td style={{ padding: 8 }}>
                {line.item || '—'}
              </td>

              <td style={{ padding: 8 }}>
                {line.description}
              </td>

              <td style={{ padding: 8 }}>
                {line.quantity ?? '—'}
              </td>

              <td style={{ padding: 8 }}>
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

function ReviewGroup({
  title,
  items,
  initiallyExpanded,
  onMark,
  onUnmark,
}: {
  title: string
  items: ReviewResult[]
  initiallyExpanded: boolean
  onMark: (number: string) => void
  onUnmark: (number: string) => void
}) {
  if (!items.length) return null

  return (
    <details
      ref={(element) => {
        if (element && !element.dataset.initialised) {
          element.open = initiallyExpanded
          element.dataset.initialised = '1'
        }
      }}
      style={panel}
    >
      <summary
        style={{
          fontSize: 20,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        {title} ({items.length})
      </summary>

      {items.map((item) => {
        const req = item.combined.requisition

        return (
          <details
            key={req.number}
            ref={(element) => {
              if (
                element &&
                !element.dataset.initialised
              ) {
                element.open = initiallyExpanded
                element.dataset.initialised = '1'
              }
            }}
            style={{
              padding: 13,
              marginTop: 11,
              border: '1px solid #d9e2eb',
              borderRadius: 9,
              background: '#f8fafc',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              Requisition {req.number}
              {' · '}
              {req.lines.length} items
            </summary>

            <div style={{ marginTop: 12 }}>
              <p style={muted}>
                {req.enteredBy || 'Unknown staff'}
                {' · '}
                {req.statuses.join(' / ')}
              </p>

              <p style={{ marginTop: 8 }}>
                <strong>Delivery:</strong>{' '}
                {req.locations.join(' / ') || 'Unknown'}
              </p>

              <p style={{ marginTop: 8 }}>
                <strong>PO / Transfer:</strong>{' '}
                {formatPoNumbers(
                  [...req.pos, ...req.transfers].join(' ')
                ) || '—'}
              </p>

              {item.combined.issues.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    background: '#fffbeb',
                  }}
                >
                  {item.combined.issues.map(
                    (issue, index) => (
                      <p key={index}>{issue}</p>
                    )
                  )}
                </div>
              )}

              {item.group === 'review' &&
                !item.saved &&
                !item.historical && (
                  <button
                    type="button"
                    style={{
                      ...button,
                      marginTop: 12,
                    }}
                    onClick={() => onMark(req.number)}
                  >
                    Mark Historical Only
                  </button>
                )}

              {item.historical?.disposition ===
                'historical_only' && (
                <button
                  type="button"
                  style={{
                    ...button,
                    marginTop: 12,
                  }}
                  onClick={() => onUnmark(req.number)}
                >
                  Return to Review
                </button>
              )}

              <ExcelLines item={item} />
            </div>
          </details>
        )
      })}
    </details>
  )
}

export default function ExcelSyncPage({
  embedded = false,
  onRegister,
  onStatus,
}: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const fileInput = useRef<HTMLInputElement>(null)

  const processing = useRef(false)
  const uploadsRef = useRef<UploadedExport[]>([])
  const newController = useRef<NewOrderController | null>(
    null
  )

  const [uploads, setUploads] = useState<UploadedExport[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(
    null
  )
  const [pending, setPending] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const registerNew = useCallback(
    (controller: NewOrderController | null) => {
      newController.current = controller
    },
    []
  )

  function reset() {
    if (processing.current) return

    uploadsRef.current = []
    setUploads([])
    setSnapshot(null)
    setPending([])
    setError('')
    setNotice('')
  }

  async function loadSnapshot() {
    const { data: auth, error: authError } =
      await supabase.auth.getUser()

    if (authError || !auth.user) {
      throw new Error(
        'Please sign in to Requisition Tracker.'
      )
    }

    const orders: SavedOrder[] = []
    const history: HistoricalEntry[] = []

    for (let start = 0; ; start += 1000) {
      const { data, error: queryError } = await supabase
        .from('orders')
        .select(
          'id,requisition_number,po_number,order_date,title,level'
        )
        .order('id')
        .range(start, start + 999)

      if (queryError) {
        throw new Error(queryError.message)
      }

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

      if (queryError) {
        throw new Error(queryError.message)
      }

      const page = (data ?? []) as HistoricalEntry[]
      history.push(...page)

      if (page.length < 1000) break
    }

    const { data: runs, error: runError } = await supabase
      .from('excel_sync_runs')
      .select('id')
      .eq('kind', 'baseline')
      .limit(1)

    if (runError) {
      throw new Error(runError.message)
    }

    setSnapshot({
      orders,
      history,
      baseline: (runs?.length ?? 0) > 0,
    })
  }

  async function addFiles(
    files: File[]
  ): Promise<UploadResult> {
    if (processing.current) {
      return {
        succeeded: 0,
        failed: files,
        errors: ['Excel importer is busy.'],
      }
    }

    if (!files.length) {
      return {
        succeeded: 0,
        failed: [],
        errors: [],
      }
    }

    processing.current = true
    setBusy(true)
    setError('')
    setNotice('')

    const known = new Set(
      uploadsRef.current.map((file) => file.id)
    )

    const added: UploadedExport[] = []
    const failed: File[] = []
    const errors: string[] = []

    let succeeded = 0

    try {
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
          failed.push(file)
          errors.push(
            `${file.name}: Only XLSX files are supported.`
          )
          continue
        }

        const id = fileIdentity(file)

        if (known.has(id)) continue

        known.add(id)

        try {
          const workbook =
            await parseRequisitionsExcel(file)

          added.push({
            id,
            name: file.name,
            label: file.name.replace(/\.xlsx$/i, ''),
            coverage: 'unknown',
            workbook,
            error: '',
          })

          succeeded++
        } catch (caught) {
          failed.push(file)
          errors.push(
            `${file.name}: ${
              caught instanceof Error
                ? caught.message
                : 'Could not read Excel file.'
            }`
          )
        }
      }

      if (added.length) {
        const next = [
          ...uploadsRef.current,
          ...added,
        ]

        uploadsRef.current = next
        setUploads(next)
      }

      await loadSnapshot()
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Could not compare the spreadsheets.'

      errors.push(message)

      // Comparison failed: retain the supplied files
      // for another attempt after the error is resolved.
      for (const file of files) {
        if (!failed.includes(file)) failed.push(file)
      }
    } finally {
      processing.current = false
      setBusy(false)
    }

    if (errors.length) {
      setError(errors.join('\n'))
    }

    return { succeeded, failed, errors }
  }

  const combined = useMemo(
    () => combineExports(uploads),
    [uploads]
  )

  const compared = useMemo(
    () =>
      snapshot
        ? compareExports(
            combined.records,
            snapshot.orders,
            snapshot.history,
            snapshot.baseline
          )
        : [],
    [combined, snapshot]
  )

  const validFiles = uploads.filter(
    (file) => file.workbook !== null
  )

  const poItems = compared.filter(
    (item) => item.group === 'po'
  )

  const newItems = compared.filter(
    (item) => item.group === 'new'
  )

  const reviewItems = compared.filter(
    (item) => item.group === 'review'
  )

  const historicalItems = compared.filter(
    (item) => item.group === 'historical'
  )

  const unchangedItems = compared.filter(
    (item) => item.group === 'unchanged'
  )

  useEffect(() => {
    onStatus?.({
      uploaded: snapshot ? validFiles.length : 0,
      newCount: newItems.length,
      poCount: poItems.length,
    })
  }, [
    onStatus,
    snapshot,
    validFiles.length,
    newItems.length,
    poItems.length,
  ])

  function validateImport(): string[] {
    if (!newItems.length) return []

    if (!newController.current) {
      return ['New requisition review is still loading.']
    }

    return newController.current.validateImport()
  }

  async function importAll(): Promise<ImportResult> {
    if (!newItems.length) {
      return {
        succeeded: 0,
        failed: 0,
        cancelled: false,
      }
    }

    if (!newController.current) {
      setError('New requisition review is not ready.')

      return {
        succeeded: 0,
        failed: newItems.length,
        cancelled: false,
      }
    }

    return newController.current.importAll()
  }

  const controllerRef =
    useRef<ExcelSyncController | null>(null)

  controllerRef.current = {
    upload: addFiles,
    validateImport,
    importAll,
    reset,
  }

  useEffect(() => {
    if (!onRegister) return

    const controller: ExcelSyncController = {
      upload: (files) =>
        controllerRef.current!.upload(files),
      validateImport: () =>
        controllerRef.current!.validateImport(),
      importAll: () =>
        controllerRef.current!.importAll(),
      reset: () =>
        controllerRef.current!.reset(),
    }

    onRegister(controller)

    return () => onRegister(null)
  }, [onRegister])

  const initialHistorical = compared.filter(
    (item) =>
      item.group === 'historical' &&
      !item.historical
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
      validFiles.map(
        (file) => file.label.trim().toUpperCase()
      )
    ).size >= 5 &&
    initialHistorical.length > 0

  async function establishBaseline() {
    if (!readyForBaseline || busy) return

    if (!window.confirm(
      `Save ${initialHistorical.length} historical requisitions?`
    )) return

    setBusy(true)
    setError('')

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

      if (rpcError) throw rpcError

      await loadSnapshot()

      setNotice(
        `${data} historical requisitions saved.`
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : String(caught)
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeHistorical(
    number: string,
    remove: boolean
  ) {
    if (!snapshot?.baseline || busy) return

    if (!window.confirm(
      remove
        ? `Return ${number} to review?`
        : `Mark ${number} as historical only?`
    )) return

    setBusy(true)
    setError('')

    try {
      const { error: rpcError } = await supabase.rpc(
        remove
          ? 'excel_sync_unmark_historical'
          : 'excel_sync_mark_historical',
        { p_requisition_number: number }
      )

      if (rpcError) throw rpcError

      await loadSnapshot()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : String(caught)
      )
    } finally {
      setBusy(false)
    }
  }

  function queueFiles(files: File[]) {
    setPending((current) => {
      const known = new Set(
        current.map(fileIdentity)
      )

      return [
        ...current,
        ...files.filter((file) => {
          if (
            !file.name.toLowerCase().endsWith('.xlsx')
          ) return false

          const id = fileIdentity(file)

          if (known.has(id)) return false

          known.add(id)
          return true
        }),
      ]
    })
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    queueFiles(Array.from(event.dataTransfer.files))
  }

  async function standaloneUpload() {
    const files = [...pending]
    if (!files.length) return

    const result = await addFiles(files)
    setPending(result.failed)
  }

  async function standaloneImport() {
    const problems = validateImport()

    if (problems.length) {
      setError(problems.join('\n'))
      return
    }

    const result = await importAll()

    if (
      !result.cancelled &&
      result.failed === 0 &&
      result.succeeded > 0
    ) {
      router.replace('/orders')
      router.refresh()
    }
  }

  return (
    <div
      style={{
        color: '#111827',
        maxWidth: 1250,
        margin: '0 auto',
      }}
    >
      {!embedded && (
        <div style={{ padding: '22px 16px' }}>
          <Link href="/upload">
            ← Back to Upload
          </Link>

          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragging(false)
            }}
            onDrop={handleDrop}
            onClick={() => fileInput.current?.click()}
            style={{
              padding: 35,
              marginTop: 17,
              border: dragging
                ? '3px solid #16a34a'
                : '2px dashed #888',
              borderRadius: 11,
              background: '#fafafa',
              textAlign: 'center',
              cursor: 'pointer',
            }}
          >
            <strong>
              Drag Excel requisitions here
            </strong>

            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={(event) => {
                queueFiles(
                  Array.from(event.target.files ?? [])
                )
                event.target.value = ''
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 15,
            }}
          >
            <button
              type="button"
              style={{
                ...button,
                color: '#fff',
                background: '#16a34a',
              }}
              disabled={busy || pending.length === 0}
              onClick={() => void standaloneUpload()}
            >
              Upload Files ({pending.length})
            </button>

            <button
              type="button"
              style={{
                ...button,
                color: '#fff',
                background: '#2563eb',
              }}
              disabled={busy || newItems.length === 0}
              onClick={() => void standaloneImport()}
            >
              Import Requisitions ({newItems.length})
            </button>

            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={reset}
            >
              Clear All
            </button>
          </div>
        </div>
      )}

      {busy && (
        <p style={{ ...muted, marginBottom: 13 }}>
          Reading Excel spreadsheets...
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            ...panel,
            background: '#fef2f2',
            color: '#b91c1c',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          style={{
            ...panel,
            background: '#f0fdf4',
            color: '#166534',
          }}
        >
          {notice}
        </p>
      )}

      {snapshot && validFiles.length > 0 && (
        <>
          <PoSyncControls
            items={poItems}
            onChanged={loadSnapshot}
          />

          {newItems.length > 0 && (
            <NewOrderImport
              items={newItems}
              onChanged={loadSnapshot}
              onRegister={registerNew}
            />
          )}

          <ReviewGroup
            title="3. Needs Review"
            items={reviewItems}
            initiallyExpanded
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />

          {combined.excluded.length > 0 && (
            <details
              ref={(element) => {
                if (
                  element &&
                  !element.dataset.initialised
                ) {
                  element.open = true
                  element.dataset.initialised = '1'
                }
              }}
              style={panel}
            >
              <summary
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                4. Excluded Requisitions
                {' '}
                ({combined.excluded.length})
              </summary>

              {combined.excluded.map((entry) => (
                <div
                  key={entry.number}
                  style={{
                    padding: 12,
                    marginTop: 10,
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                  }}
                >
                  <strong>{entry.number}</strong>
                  {' · '}
                  {entry.reasons.join(' / ')}
                </div>
              ))}
            </details>
          )}

          <ReviewGroup
            title="Historical Requisitions"
            items={historicalItems}
            initiallyExpanded={false}
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />

          <ReviewGroup
            title="Unchanged Requisitions"
            items={unchangedItems}
            initiallyExpanded={false}
            onMark={(number) =>
              void changeHistorical(number, false)
            }
            onUnmark={(number) =>
              void changeHistorical(number, true)
            }
          />

          {!snapshot.baseline && (
            <details style={panel}>
              <summary
                style={{ cursor: 'pointer' }}
              >
                Initial Historical Baseline Setup
              </summary>

              <p
                style={{
                  ...muted,
                  marginTop: 12,
                }}
              >
                Initial setup requires five distinct staff
                exports with confirmed L3/L5 coverage.
              </p>

              {uploads.map((file) => (
                <label
                  key={file.id}
                  style={{
                    display: 'block',
                    marginTop: 11,
                  }}
                >
                  {file.name}

                  <select
                    style={{
                      display: 'block',
                      padding: 8,
                      marginTop: 6,
                    }}
                    value={file.coverage}
                    onChange={(event) => {
                      const next = uploads.map((item) =>
                        item.id === file.id
                          ? {
                              ...item,
                              coverage:
                                event.target.value as
                                  UploadedExport['coverage'],
                            }
                          : item
                      )

                      uploadsRef.current = next
                      setUploads(next)
                    }}
                  >
                    <option value="unknown">
                      Unknown
                    </option>
                    <option value="3">L3</option>
                    <option value="5">L5</option>
                    <option value="both">
                      Both
                    </option>
                  </select>
                </label>
              ))}

              <button
                type="button"
                style={{
                  ...button,
                  marginTop: 13,
                }}
                disabled={!readyForBaseline || busy}
                onClick={() =>
                  void establishBaseline()
                }
              >
                Establish Historical Baseline
              </button>
            </details>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit,minmax(140px,1fr))',
              gap: 10,
              marginTop: 20,
            }}
          >
            {[
              ['Excel Files', validFiles.length],
              ['Eligible', combined.records.length],
              ['Updated POs', poItems.length],
              ['New Requisitions', newItems.length],
              ['Needs Review', reviewItems.length],
              ['Excluded', combined.excluded.length],
              ['Saved Historical', snapshot.history.length],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{
                  ...panel,
                  marginBottom: 0,
                  padding: 14,
                }}
              >
                <div style={muted}>
                  {label}
                </div>

                <strong
                  style={{
                    display: 'block',
                    fontSize: 24,
                    marginTop: 5,
                  }}
                >
                  {value}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
