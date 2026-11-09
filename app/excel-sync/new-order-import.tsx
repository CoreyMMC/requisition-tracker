
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatPoNumbers } from '@/lib/po-numbers'
import type { ReviewResult } from '@/lib/excel-sync-review'

type Props = {
  items: ReviewResult[]
  onChanged: () => Promise<void>
}

type DraftLine = {
  id: string
  itemNo: string
  name: string
  quantity: string
  amount: string
}

type Draft = {
  date: string
  level: string
  type: string
  details: string
  enteredBy: string
  po: string
  lines: DraftLine[]
}

type UndoRun = {
  id: string
  remaining: number
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

const button: CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #b9c2cc',
  borderRadius: 8,
  background: '#fff',
  color: '#111827',
  fontWeight: 700,
  cursor: 'pointer',
}

const field: CSSProperties = {
  width: '100%',
  display: 'block',
  padding: 9,
  marginTop: 6,
  border: '1px solid #b9c2cc',
  borderRadius: 7,
  background: '#fff',
  color: '#111827',
  boxSizing: 'border-box',
}

function todayMelbourne() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const part = (name: string) =>
    parts.find((entry) => entry.type === name)?.value ?? ''

  return `${part('year')}-${part('month')}-${part('day')}`
}

function initialDraft(item: ReviewResult): Draft {
  const req = item.combined.requisition

  return {
    date: todayMelbourne(),
    level: req.level ? String(req.level) : '',
    type: 'General Stock',
    details: '',
    enteredBy: req.enteredBy,
    po: formatPoNumbers(
      [...req.pos, ...req.transfers].join(' ')
    ),
    lines: req.lines.map((line, index) => ({
      id: `excel-${line.row}-${index}`,
      itemNo: line.item,
      name: line.description,
      quantity:
        line.quantity == null ? '' : String(line.quantity),
      amount:
        line.amount == null ? '' : String(line.amount),
    })),
  }
}

function errorMessage(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error
  ) {
    return String(error.message)
  }

  return String(error)
}

function validate(
  draft: Draft,
  item: ReviewResult
): string[] {
  const problems: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    problems.push('Choose a valid order date.')
  }

  if (!['3', '5'].includes(draft.level)) {
    problems.push('Select L3 or L5.')
  }

  if (!ORDER_TYPES.includes(draft.type)) {
    problems.push('Select an order type.')
  }

  if (
    draft.type === 'Other' &&
    !draft.details.trim()
  ) {
    problems.push('Describe the Other order type.')
  }

  if (draft.details.length > 150) {
    problems.push('Additional details are too long.')
  }

  if (draft.enteredBy.length > 200) {
    problems.push('Entered By is too long.')
  }

  if (draft.po.length > 2000) {
    problems.push('PO field is too long.')
  }

  if (
    draft.lines.length < 1 ||
    draft.lines.length > 200
  ) {
    problems.push('An order needs 1–200 item lines.')
  }

  draft.lines.forEach((line, index) => {
    const quantity = Number(line.quantity)
    const amount = Number(line.amount)

    if (!line.name.trim()) {
      problems.push(`Line ${index + 1}: description missing.`)
    }

    if (
      line.itemNo.length > 200 ||
      line.name.length > 1000
    ) {
      problems.push(`Line ${index + 1}: text too long.`)
    }

    if (
      !line.quantity.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000
    ) {
      problems.push(`Line ${index + 1}: invalid quantity.`)
    }

    if (
      line.amount.trim() &&
      (!Number.isFinite(amount) ||
        Math.abs(amount) > 100000000)
    ) {
      problems.push(`Line ${index + 1}: invalid amount.`)
    }
  })

  if (item.combined.requisition.statuses.length === 0) {
    problems.push('Excel status is missing.')
  }

  return problems
}

export default function NewOrderImport({
  items,
  onChanged,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const nextLine = useRef(1)

  const [drafts, setDrafts] =
    useState<Record<string, Draft>>({})

  const [selected, setSelected] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [version, setVersion] = useState(0)
  const [latest, setLatest] = useState<UndoRun | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  function getDraft(item: ReviewResult) {
    return (
      drafts[item.combined.requisition.number] ??
      initialDraft(item)
    )
  }

  function updateDraft(
    item: ReviewResult,
    patch: Partial<Draft>
  ) {
    const number = item.combined.requisition.number

    setDrafts((current) => ({
      ...current,
      [number]: {
        ...(current[number] ?? initialDraft(item)),
        ...patch,
      },
    }))
  }

  function changeLine(
    item: ReviewResult,
    id: string,
    patch: Partial<DraftLine>
  ) {
    const draft = getDraft(item)

    updateDraft(item, {
      lines: draft.lines.map((line) =>
        line.id === id
          ? { ...line, ...patch }
          : line
      ),
    })
  }

  function toggleSelected(number: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? Array.from(new Set([...current, number]))
        : current.filter((entry) => entry !== number)
    )
  }

  function expandAll(value: boolean) {
    setExpanded(value)
    setVersion((current) => current + 1)
  }

  const chosen = items.filter((item) =>
    selected.includes(item.combined.requisition.number)
  )

  const refreshUndo = useCallback(async () => {
    const { data: auth, error: authError } =
      await supabase.auth.getUser()

    if (authError || !auth.user) {
      setLatest(null)
      return
    }

    const { data: runs, error: runsError } = await supabase
      .from('excel_sync_import_runs')
      .select('id,created_at')
      .eq('created_by', auth.user.id)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (runsError) throw runsError

    const run = runs?.[0]

    if (!run) {
      setLatest(null)
      return
    }

    const { count, error: countError } = await supabase
      .from('excel_sync_import_changes')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .is('undone_at', null)

    if (countError) throw countError

    setLatest({
      id: run.id,
      remaining: count ?? 0,
    })
  }, [supabase])

  useEffect(() => {
    void refreshUndo().catch(console.error)
  }, [refreshUndo])

  async function refreshAfterWrite() {
    try {
      await onChanged()
      await refreshUndo()
    } catch {
      setNotice((current) =>
        `${current} Refresh the Excel page to update the preview.`
      )
    }
  }

  async function importSelected() {
    if (working || chosen.length === 0) return

    if (chosen.length > 25) {
      setError('Select a maximum of 25 orders per import.')
      return
    }

    for (const item of chosen) {
      const problems = validate(getDraft(item), item)

      if (problems.length) {
        setError(
          `${item.combined.requisition.number}: ` +
          problems.join(' ')
        )
        return
      }
    }

    const summary = chosen
      .slice(0, 10)
      .map((item) => {
        const draft = getDraft(item)

        return (
          `${item.combined.requisition.number}: ` +
          `${draft.type}, L${draft.level}, ` +
          `${draft.date}, ${draft.lines.length} lines`
        )
      })
      .join('\n')

    const confirmed = window.confirm(
      `IMPORT ${chosen.length} NEW REQUISITION(S)?\n\n` +
      `${summary}\n\n` +
      (chosen.length > 10
        ? `...and ${chosen.length - 10} more.\n\n`
        : '') +
      `These will become active Orders in Supabase.\n\n` +
      `Today's date and General Stock are only defaults.\n` +
      `Verify all dates, L3/L5 locations, order types, ` +
      `PO numbers and quantities.\n\n` +
      `Import these selected requisitions?`
    )

    if (!confirmed) return

    const payload = chosen.map((item) => {
      const req = item.combined.requisition
      const draft = getDraft(item)

      return {
        number: req.number,
        statuses: req.statuses,
        confirmed: true,
        date: draft.date,
        level: Number(draft.level),
        type: draft.type,
        details: draft.details.trim(),
        entered_by: draft.enteredBy.trim(),
        po: formatPoNumbers(draft.po),
        items: draft.lines.map((line) => ({
          item_no: line.itemNo.trim(),
          name: line.name.trim(),
          quantity: Number(line.quantity),
          amount:
            line.amount.trim() === ''
              ? null
              : Number(line.amount),
        })),
      }
    })

    setWorking(true)
    setError('')
    setNotice('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_import_new_orders',
        { p_orders: payload }
      )

      if (rpcError) throw rpcError

      const result = data as { imported?: number } | null

      setSelected([])
      setDrafts({})

      setNotice(
        `${result?.imported ?? chosen.length} new requisition(s) ` +
        'imported successfully, including their item lines.'
      )

      await refreshAfterWrite()
    } catch (caught) {
      console.error('Excel import failed:', caught)
      setError(`Import failed: ${errorMessage(caught)}`)
    } finally {
      setWorking(false)
    }
  }

  async function undoImport() {
    if (working || !latest) return

    if (!window.confirm(
      `UNDO LAST NEW-ORDER EXCEL IMPORT?\n\n` +
      `${latest.remaining} order(s) remain in that import.\n\n` +
      `Only untouched orders will be removed.\n` +
      `Orders with later edits or receiving records will be skipped.\n\n` +
      `Continue?`
    )) return

    setWorking(true)
    setError('')
    setNotice('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_undo_last_new_import'
      )

      if (rpcError) throw rpcError

      const result = data as {
        undone?: number
        skipped?: number
        remaining?: number
      } | null

      setNotice(
        `Undo complete: ${result?.undone ?? 0} removed, ` +
        `${result?.skipped ?? 0} protected, ` +
        `${result?.remaining ?? 0} remaining.`
      )

      await refreshAfterWrite()
    } catch (caught) {
      setError(`Undo failed: ${errorMessage(caught)}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section
      style={{
        padding: 18,
        marginBottom: 18,
        border: '2px solid #93c5fd',
        borderRadius: 12,
        background: '#f8fbff',
        color: '#111827',
      }}
    >
      <h2 style={{ fontSize: 22, fontWeight: 800 }}>
        2. New Requisitions ({items.length})
      </h2>

      <p
        style={{
          color: '#64748b',
          fontSize: 13,
          marginTop: 7,
        }}
      >
        All requisitions start expanded for review.
        Select the orders you want, then import them together.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 9,
          alignItems: 'center',
          margin: '17px 0',
        }}
      >
        <button
          type="button"
          style={button}
          disabled={working || items.length === 0}
          onClick={() =>
            setSelected(
              items.slice(0, 25).map(
                (item) => item.combined.requisition.number
              )
            )
          }
        >
          Select All{items.length > 25 ? ' (first 25)' : ''}
        </button>

        <button
          type="button"
          style={button}
          disabled={working || selected.length === 0}
          onClick={() => setSelected([])}
        >
          Deselect All
        </button>

        <button
          type="button"
          style={{
            ...button,
            background: chosen.length ? '#2563eb' : '#ddd',
            color: chosen.length ? '#fff' : '#666',
          }}
          disabled={working || chosen.length === 0}
          onClick={() => void importSelected()}
        >
          {working
            ? 'Importing...'
            : `Import ${chosen.length} Requisition(s)`}
        </button>

        <strong>{chosen.length} selected</strong>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 9,
          marginBottom: 15,
        }}
      >
        <button
          type="button"
          style={button}
          onClick={() => expandAll(true)}
        >
          Expand All
        </button>

        <button
          type="button"
          style={button}
          onClick={() => expandAll(false)}
        >
          Collapse All
        </button>
      </div>

      {items.length === 0 && (
        <p
          style={{
            padding: 15,
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            background: '#fff',
            color: '#1d4ed8',
          }}
        >
          No new requisitions detected.
        </p>
      )}

      {items.map((item) => {
        const req = item.combined.requisition
        const number = req.number
        const draft = getDraft(item)
        const checked = selected.includes(number)
        const problems = validate(draft, item)

        return (
          <div
            key={number}
            style={{
              display: 'flex',
              gap: 12,
              padding: 14,
              marginBottom: 12,
              border: checked
                ? '2px solid #3b82f6'
                : '1px solid #d9e2eb',
              borderRadius: 10,
              background: '#fff',
            }}
          >
            <input
              type="checkbox"
              aria-label={`Select ${number}`}
              checked={checked}
              disabled={working}
              onChange={(event) =>
                toggleSelected(number, event.target.checked)
              }
              style={{
                marginTop: 4,
                width: 19,
                height: 19,
              }}
            />

            <details
              key={`${version}-${number}`}
              open={expanded}
              style={{ flex: 1, minWidth: 0 }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 800,
                }}
              >
                Requisition {number}

                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: '#64748b',
                    marginLeft: 10,
                  }}
                >
                  {draft.lines.length} lines
                  {' · '}
                  {req.enteredBy || 'Unknown staff'}
                </span>
              </summary>

              <div style={{ marginTop: 14 }}>
                <p
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    marginBottom: 13,
                  }}
                >
                  Status: {req.statuses.join(' / ')}
                  {' · '}
                  Delivery: {req.locations.join(' / ') || 'Unknown'}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit,minmax(190px,1fr))',
                    gap: 12,
                  }}
                >
                  <label>
                    <strong>Order Date</strong>
                    <input
                      type="date"
                      style={field}
                      value={draft.date}
                      disabled={working}
                      onChange={(event) =>
                        updateDraft(item, {
                          date: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    <strong>Level</strong>
                    <select
                      style={field}
                      value={draft.level}
                      disabled={working}
                      onChange={(event) =>
                        updateDraft(item, {
                          level: event.target.value,
                        })
                      }
                    >
                      <option value="">Choose L3 or L5</option>
                      <option value="3">L3</option>
                      <option value="5">L5</option>
                    </select>
                  </label>

                  <label>
                    <strong>Order Type</strong>
                    <select
                      style={field}
                      value={draft.type}
                      disabled={working}
                      onChange={(event) =>
                        updateDraft(item, {
                          type: event.target.value,
                          details: '',
                        })
                      }
                    >
                      {ORDER_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <strong>Entered By</strong>
                    <input
                      style={field}
                      value={draft.enteredBy}
                      disabled={working}
                      onChange={(event) =>
                        updateDraft(item, {
                          enteredBy: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                {(draft.type === 'Other' ||
                  draft.type === 'Non-catalogue') && (
                  <label
                    style={{
                      display: 'block',
                      marginTop: 12,
                    }}
                  >
                    <strong>Additional Details</strong>

                    <input
                      style={field}
                      value={draft.details}
                      disabled={working}
                      onChange={(event) =>
                        updateDraft(item, {
                          details: event.target.value,
                        })
                      }
                      placeholder="Optional description, required for Other"
                    />
                  </label>
                )}

                <label
                  style={{
                    display: 'block',
                    marginTop: 12,
                  }}
                >
                  <strong>PO / Transfer-Order Numbers</strong>

                  <input
                    style={field}
                    value={draft.po}
                    disabled={working}
                    placeholder="123456, 123457, 123458"
                    onChange={(event) =>
                      updateDraft(item, {
                        po: event.target.value,
                      })
                    }
                    onBlur={() =>
                      updateDraft(item, {
                        po: formatPoNumbers(draft.po),
                      })
                    }
                  />
                </label>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                    margin: '18px 0 9px',
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    Item Lines ({draft.lines.length})
                  </h3>

                  <button
                    type="button"
                    style={button}
                    disabled={working || draft.lines.length >= 200}
                    onClick={() =>
                      updateDraft(item, {
                        lines: [
                          ...draft.lines,
                          {
                            id: `added-${nextLine.current++}`,
                            itemNo: '',
                            name: '',
                            quantity: '1',
                            amount: '',
                          },
                        ],
                      })
                    }
                  >
                    + Add Item
                  </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: 680,
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
                          'Amount (AUD)',
                          '',
                        ].map((heading, index) => (
                          <th
                            key={index}
                            style={{
                              padding: 8,
                              textAlign: 'left',
                            }}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {draft.lines.map((line) => (
                        <tr key={line.id}>
                          <td style={{ padding: 4 }}>
                            <input
                              style={field}
                              value={line.itemNo}
                              disabled={working}
                              onChange={(event) =>
                                changeLine(item, line.id, {
                                  itemNo: event.target.value,
                                })
                              }
                            />
                          </td>

                          <td
                            style={{
                              padding: 4,
                              minWidth: 230,
                            }}
                          >
                            <input
                              style={field}
                              value={line.name}
                              disabled={working}
                              onChange={(event) =>
                                changeLine(item, line.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </td>

                          <td
                            style={{
                              padding: 4,
                              width: 110,
                            }}
                          >
                            <input
                              type="number"
                              step="any"
                              style={field}
                              value={line.quantity}
                              disabled={working}
                              onChange={(event) =>
                                changeLine(item, line.id, {
                                  quantity: event.target.value,
                                })
                              }
                            />
                          </td>

                          <td
                            style={{
                              padding: 4,
                              width: 135,
                            }}
                          >
                            <input
                              type="number"
                              step="0.01"
                              style={field}
                              value={line.amount}
                              disabled={working}
                              onChange={(event) =>
                                changeLine(item, line.id, {
                                  amount: event.target.value,
                                })
                              }
                            />
                          </td>

                          <td style={{ padding: 4 }}>
                            <button
                              type="button"
                              style={button}
                              disabled={
                                working || draft.lines.length <= 1
                              }
                              onClick={() =>
                                updateDraft(item, {
                                  lines: draft.lines.filter(
                                    (entry) => entry.id !== line.id
                                  ),
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

                {problems.length > 0 && (
                  <div
                    style={{
                      background: '#fffbeb',
                      color: '#92400e',
                      padding: 12,
                      borderRadius: 8,
                      marginTop: 14,
                    }}
                  >
                    <strong>Check before importing:</strong>

                    <ul
                      style={{
                        paddingLeft: 19,
                        marginTop: 6,
                      }}
                    >
                      {problems.map((problem, index) => (
                        <li key={index}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </div>
        )
      })}

      {items.length > 25 && (
        <p style={{ color: '#92400e', fontSize: 13 }}>
          The database accepts up to 25 new orders per transaction.
          Import these first, then select the remaining orders.
        </p>
      )}

      <div
        style={{
          borderTop: '1px solid #cbd5e1',
          paddingTop: 15,
          marginTop: 20,
        }}
      >
        <strong>Undo Last New-Order Excel Import</strong>

        <p
          style={{
            fontSize: 13,
            color: '#64748b',
            margin: '8px 0',
          }}
        >
          {latest
            ? `${latest.remaining} order(s) available to undo.`
            : 'No outstanding new-order Excel import.'}
        </p>

        <button
          type="button"
          style={button}
          disabled={working || !latest || latest.remaining === 0}
          onClick={() => void undoImport()}
        >
          Undo Last New-Order Import
        </button>
      </div>

      {notice && (
        <p role="status" style={{ color: '#166534', marginTop: 12 }}>
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: '#b91c1c', marginTop: 12 }}>
          {error}
        </p>
      )}
    </section>
  )
}
