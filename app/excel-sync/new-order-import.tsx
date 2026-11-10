
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

type ImportResult = {
  succeeded: number
  failed: number
  cancelled: boolean
}

export type NewOrderController = {
  validateImport: () => string[]
  importAll: () => Promise<ImportResult>
}

type Props = {
  items: ReviewResult[]
  onChanged: () => Promise<void>
  onRegister?: (
    controller: NewOrderController | null
  ) => void
}

const types = [
  'General Stock',
  'Non-catalogue',
  'PSA Stock',
  'WINC',
  'Allanby',
  'Name Badges',
  'Other',
]

const field: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 9,
  marginTop: 6,
  border: '1px solid #b9c2cc',
  borderRadius: 7,
  color: '#111827',
  background: '#fff',
}

const button: CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #b9c2cc',
  borderRadius: 8,
  color: '#111827',
  background: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
}

function todayMelbourne() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const read = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? ''

  return `${read('year')}-${read('month')}-${read('day')}`
}

function makeDraft(item: ReviewResult): Draft {
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
        line.quantity == null
          ? ''
          : String(line.quantity),
      amount:
        line.amount == null
          ? ''
          : String(line.amount),
    })),
  }
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

function validate(
  draft: Draft,
  item: ReviewResult
): string[] {
  const problems: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    problems.push('Choose a valid date.')
  }

  if (!['3', '5'].includes(draft.level)) {
    problems.push('Choose L3 or L5.')
  }

  if (!types.includes(draft.type)) {
    problems.push('Select an order type.')
  }

  if (
    draft.type === 'Other' &&
    !draft.details.trim()
  ) {
    problems.push(
      'Enter a description for Other.'
    )
  }

  if (draft.details.length > 150) {
    problems.push(
      'Order details are too long.'
    )
  }

  if (draft.enteredBy.length > 200) {
    problems.push(
      'Entered By is too long.'
    )
  }

  if (draft.po.length > 2000) {
    problems.push(
      'PO field is too long.'
    )
  }

  if (
    draft.lines.length < 1 ||
    draft.lines.length > 200
  ) {
    problems.push(
      'An order must contain 1–200 item lines.'
    )
  }

  draft.lines.forEach((line, index) => {
    const qty = Number(line.quantity)
    const amount = Number(line.amount)

    if (!line.name.trim()) {
      problems.push(
        `Line ${index + 1}: description missing.`
      )
    }

    if (
      line.name.length > 1000 ||
      line.itemNo.length > 200
    ) {
      problems.push(
        `Line ${index + 1}: item text too long.`
      )
    }

    if (
      !line.quantity.trim() ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      qty > 1000000
    ) {
      problems.push(
        `Line ${index + 1}: invalid quantity.`
      )
    }

    if (
      line.amount.trim() &&
      (!Number.isFinite(amount) ||
        Math.abs(amount) > 100000000)
    ) {
      problems.push(
        `Line ${index + 1}: invalid amount.`
      )
    }
  })

  if (!item.combined.requisition.statuses.length) {
    problems.push(
      'Excel requisition status is missing.'
    )
  }

  return problems
}

export default function NewOrderImport({
  items,
  onChanged,
  onRegister,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const containerRef = useRef<HTMLDivElement>(null)
  const nextLine = useRef(1)
  const processing = useRef(false)

  const [drafts, setDrafts] =
    useState<Record<string, Draft>>({})

  const [working, setWorking] = useState(false)
  const [latest, setLatest] = useState<UndoRun | null>(
    null
  )
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  function getDraft(item: ReviewResult): Draft {
    return (
      drafts[item.combined.requisition.number] ??
      makeDraft(item)
    )
  }

  function updateDraft(
    item: ReviewResult,
    changes: Partial<Draft>
  ) {
    const number = item.combined.requisition.number

    setDrafts((current) => ({
      ...current,
      [number]: {
        ...(current[number] ?? makeDraft(item)),
        ...changes,
      },
    }))
  }

  function updateLine(
    item: ReviewResult,
    id: string,
    changes: Partial<DraftLine>
  ) {
    const draft = getDraft(item)

    updateDraft(item, {
      lines: draft.lines.map((line) =>
        line.id === id
          ? { ...line, ...changes }
          : line
      ),
    })
  }

  function expandAll(open: boolean) {
    containerRef.current
      ?.querySelectorAll<HTMLDetailsElement>(
        'details[data-requisition]'
      )
      .forEach((element) => {
        element.open = open
      })
  }

  function validateAll(): string[] {
    const problems: string[] = []

    if (items.length > 25) {
      problems.push(
        'A maximum of 25 new requisitions can ' +
        'be imported per transaction.'
      )
    }

    for (const item of items) {
      const errors = validate(
        getDraft(item),
        item
      )

      for (const message of errors) {
        problems.push(
          `${item.combined.requisition.number}: ${message}`
        )
      }
    }

    return problems
  }

  const refreshUndo = useCallback(async () => {
    const { data: auth, error: authError } =
      await supabase.auth.getUser()

    if (authError || !auth.user) {
      setLatest(null)
      return
    }

    const { data: runs, error: runError } = await supabase
      .from('excel_sync_import_runs')
      .select('id,created_at')
      .eq('created_by', auth.user.id)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (runError) throw runError

    const run = runs?.[0]

    if (!run) {
      setLatest(null)
      return
    }

    const { count, error: countError } = await supabase
      .from('excel_sync_import_changes')
      .select('id', {
        count: 'exact',
        head: true,
      })
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
        `${current} Refresh the page to update the preview.`
      )
    }
  }

  async function importAll(): Promise<ImportResult> {
    if (processing.current || !items.length) {
      return {
        succeeded: 0,
        failed: processing.current ? 1 : 0,
        cancelled: false,
      }
    }

    const problems = validateAll()

    if (problems.length) {
      setError(problems.join('\n'))

      return {
        succeeded: 0,
        failed: items.length,
        cancelled: false,
      }
    }

    const summary = items
      .map((item) => {
        const draft = getDraft(item)
        const req = item.combined.requisition

        return (
          `${req.number}: ` +
          `${draft.type}, ` +
          `L${draft.level}, ` +
          `${draft.date}, ` +
          `${draft.lines.length} lines`
        )
      })
      .join('\n')

    const confirmed = window.confirm(
      `IMPORT ${items.length} NEW REQUISITION(S)?\n\n` +
      summary
    )

    if (!confirmed) {
      return {
        succeeded: 0,
        failed: 0,
        cancelled: true,
      }
    }

    const payload = items.map((item) => {
      const draft = getDraft(item)
      const req = item.combined.requisition

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

    processing.current = true
    setWorking(true)
    setError('')
    setNotice('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_import_new_orders',
        { p_orders: payload }
      )

      if (rpcError) throw rpcError

      const result = data as {
        imported?: number
      } | null

      const count =
        result?.imported ?? items.length

      setNotice(
        `${count} new requisition(s) imported successfully.`
      )

      setDrafts({})
      await refreshAfterWrite()

      return {
        succeeded: count,
        failed: 0,
        cancelled: false,
      }
    } catch (caught) {
      setError(
        `Import failed: ${errorText(caught)}`
      )

      return {
        succeeded: 0,
        failed: items.length,
        cancelled: false,
      }
    } finally {
      processing.current = false
      setWorking(false)
    }
  }

  const controllerRef =
    useRef<NewOrderController | null>(null)

  controllerRef.current = {
    validateImport: validateAll,
    importAll,
  }

  useEffect(() => {
    if (!onRegister) return

    const controller: NewOrderController = {
      validateImport: () =>
        controllerRef.current!.validateImport(),
      importAll: () =>
        controllerRef.current!.importAll(),
    }

    onRegister(controller)

    return () => onRegister(null)
  }, [onRegister])

  async function undoImport() {
    if (processing.current || !latest) return

    if (!window.confirm(
      'Undo the last new-order Excel import?\n\n' +
      'Only untouched orders will be removed.'
    )) return

    processing.current = true
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
        `${result?.undone ?? 0} undone, ` +
        `${result?.skipped ?? 0} protected, ` +
        `${result?.remaining ?? 0} remaining.`
      )

      await refreshAfterWrite()
    } catch (caught) {
      setError(
        `Undo failed: ${errorText(caught)}`
      )
    } finally {
      processing.current = false
      setWorking(false)
    }
  }

  return (
    <section
      style={{
        padding: 17,
        border: '2px solid #93c5fd',
        borderRadius: 11,
        background: '#f8fbff',
        marginBottom: 16,
        color: '#111827',
      }}
    >
      <h2
        style={{
          fontSize: 21,
          fontWeight: 800,
        }}
      >
        2. New Requisitions ({items.length})
      </h2>

      <div
        style={{
          display: 'flex',
          gap: 9,
          margin: '14px 0',
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

      <div ref={containerRef}>
        {items.map((item) => {
          const req = item.combined.requisition
          const draft = getDraft(item)
          const problems = validate(draft, item)

          return (
            <details
              key={req.number}
              data-requisition
              ref={(element) => {
                if (
                  element &&
                  !element.dataset.initialised
                ) {
                  element.open = true
                  element.dataset.initialised = '1'
                }
              }}
              style={{
                padding: 14,
                marginBottom: 12,
                border: '1px solid #d9e2eb',
                borderRadius: 9,
                background: '#fff',
              }}
            >
              <summary
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Requisition {req.number}
                {' · '}
                {draft.lines.length} items
              </summary>

              <div style={{ marginTop: 15 }}>
                <p
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    marginBottom: 13,
                  }}
                >
                  {req.enteredBy || 'Unknown staff'}
                  {' · '}
                  {req.statuses.join(' / ')}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit,minmax(185px,1fr))',
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
                      <option value="">
                        Select L3/L5
                      </option>

                      <option value="3">
                        L3
                      </option>

                      <option value="5">
                        L5
                      </option>
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
                      {types.map((type) => (
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
                    />
                  </label>
                )}

                <label
                  style={{
                    display: 'block',
                    marginTop: 13,
                  }}
                >
                  <strong>
                    PO / Transfer Order Numbers
                  </strong>

                  <input
                    style={field}
                    value={draft.po}
                    disabled={working}
                    placeholder="123456, 123457"
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
                    gap: 10,
                    margin: '18px 0 10px',
                  }}
                >
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 800,
                    }}
                  >
                    Items ({draft.lines.length})
                  </h3>

                  <button
                    type="button"
                    style={button}
                    disabled={
                      working ||
                      draft.lines.length >= 200
                    }
                    onClick={() =>
                      updateDraft(item, {
                        lines: [
                          ...draft.lines,
                          {
                            id:
                              `added-${nextLine.current++}`,
                            itemNo: '',
                            name: '',
                            quantity: '1',
                            amount: '',
                          },
                        ],
                      })
                    }
                  >
                    + Add Line
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
                    <thead
                      style={{
                        background: '#f1f5f9',
                      }}
                    >
                      <tr>
                        {[
                          'Item No.',
                          'Description',
                          'Qty',
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
                      {draft.lines.map((line) => (
                        <tr key={line.id}>
                          <td style={{ padding: 5 }}>
                            <input
                              style={field}
                              value={line.itemNo}
                              disabled={working}
                              onChange={(event) =>
                                updateLine(
                                  item,
                                  line.id,
                                  {
                                    itemNo:
                                      event.target.value,
                                  }
                                )
                              }
                            />
                          </td>

                          <td
                            style={{
                              padding: 5,
                              minWidth: 220,
                            }}
                          >
                            <input
                              style={field}
                              value={line.name}
                              disabled={working}
                              onChange={(event) =>
                                updateLine(
                                  item,
                                  line.id,
                                  {
                                    name:
                                      event.target.value,
                                  }
                                )
                              }
                            />
                          </td>

                          <td style={{ padding: 5 }}>
                            <input
                              type="number"
                              step="any"
                              style={field}
                              value={line.quantity}
                              disabled={working}
                              onChange={(event) =>
                                updateLine(
                                  item,
                                  line.id,
                                  {
                                    quantity:
                                      event.target.value,
                                  }
                                )
                              }
                            />
                          </td>

                          <td style={{ padding: 5 }}>
                            <input
                              type="number"
                              step="0.01"
                              style={field}
                              value={line.amount}
                              disabled={working}
                              onChange={(event) =>
                                updateLine(
                                  item,
                                  line.id,
                                  {
                                    amount:
                                      event.target.value,
                                  }
                                )
                              }
                            />
                          </td>

                          <td style={{ padding: 5 }}>
                            <button
                              type="button"
                              style={button}
                              disabled={
                                working ||
                                draft.lines.length <= 1
                              }
                              onClick={() =>
                                updateDraft(item, {
                                  lines:
                                    draft.lines.filter(
                                      (entry) =>
                                        entry.id !==
                                        line.id
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
                      marginTop: 14,
                      padding: 12,
                      background: '#fffbeb',
                      color: '#92400e',
                      borderRadius: 8,
                    }}
                  >
                    <strong>
                      Check before importing
                    </strong>

                    {problems.map(
                      (problem, index) => (
                        <p key={index}>
                          {problem}
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            </details>
          )
        })}
      </div>

      <details
        style={{
          marginTop: 15,
          paddingTop: 14,
          borderTop: '1px solid #cbd5e1',
        }}
      >
        <summary
          style={{
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Undo Last New-Order Excel Import
        </summary>

        <p
          style={{
            fontSize: 13,
            color: '#64748b',
            margin: '10px 0',
          }}
        >
          {latest
            ? `${latest.remaining} order(s) available.`
            : 'No outstanding import found.'}
        </p>

        <button
          type="button"
          style={button}
          disabled={
            working ||
            !latest ||
            latest.remaining === 0
          }
          onClick={() => void undoImport()}
        >
          Undo Last New-Order Import
        </button>
      </details>

      {notice && (
        <p
          role="status"
          style={{
            marginTop: 12,
            color: '#166534',
          }}
        >
          {notice}
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: '#fef2f2',
            color: '#b91c1c',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </p>
      )}
    </section>
  )
}
