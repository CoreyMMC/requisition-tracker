
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
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

type UndoRun = {
  id: string
  remaining: number
}

const button: CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #b9c2cc',
  borderRadius: 8,
  background: '#fff',
  color: '#111827',
  fontWeight: 700,
  cursor: 'pointer',
}

const referencePattern =
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/

function canUpdate(item: ReviewResult) {
  return Boolean(
    item.group === 'po' &&
    item.saved &&
    item.missingReferences.length > 0 &&
    item.missingReferences.length <= 50 &&
    item.missingReferences.every((reference) =>
      referencePattern.test(reference)
    )
  )
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

export default function PoSyncControls({
  items,
  onChanged,
}: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [selected, setSelected] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [version, setVersion] = useState(0)
  const [latest, setLatest] = useState<UndoRun | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const eligible = items.filter(canUpdate)
  const blocked = items.filter((item) => !canUpdate(item))

  const chosen = eligible.filter((item) =>
    selected.includes(item.combined.requisition.number)
  )

  function expandAll(next: boolean) {
    setExpanded(next)
    setVersion((current) => current + 1)
  }

  function selectNumber(number: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? Array.from(new Set([...current, number]))
        : current.filter((value) => value !== number)
    )
  }

  const refreshUndo = useCallback(async () => {
    const { data: auth, error: authError } =
      await supabase.auth.getUser()

    if (authError || !auth.user) {
      setLatest(null)
      return
    }

    const { data: runs, error: runError } = await supabase
      .from('excel_sync_runs')
      .select('id,created_at')
      .eq('kind', 'po_update')
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
      .from('excel_sync_po_changes')
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

  async function refreshAfterChange() {
    try {
      await onChanged()
      await refreshUndo()
    } catch {
      setNotice((current) =>
        `${current} Refresh the page to update the preview.`
      )
    }
  }

  async function applyUpdates() {
    if (working || chosen.length === 0) return

    const preview = chosen
      .slice(0, 8)
      .map((item) => {
        const req = item.combined.requisition.number
        const additions = formatPoNumbers(
          item.missingReferences.join(' ')
        )

        return `${req}: +${additions}`
      })
      .join('\n')

    const confirmed = window.confirm(
      `APPLY ${chosen.length} PO UPDATE(S)?\n\n` +
      preview +
      '\n\n' +
      (chosen.length > 8
        ? `...and ${chosen.length - 8} more.\n\n`
        : '') +
      `Only PO fields will be updated.\n` +
      `Existing dates, order types, levels, quantities, ` +
      `receiving, completion and comments remain unchanged.\n\n` +
      `Confirm?`
    )

    if (!confirmed) return

    setWorking(true)
    setError('')
    setNotice('')

    const updates = chosen.map((item) => ({
      number: item.combined.requisition.number,
      expected_po: item.saved!.po_number,
      references: item.missingReferences,
    }))

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_confirm_po_updates',
        { p_updates: updates }
      )

      if (rpcError) throw rpcError

      const result = data as { updated?: number } | null

      setSelected([])
      setNotice(
        `${result?.updated ?? chosen.length} PO fields updated. ` +
        'An Undo record was saved.'
      )

      await refreshAfterChange()
    } catch (caught) {
      setError(`PO update failed: ${errorMessage(caught)}`)
    } finally {
      setWorking(false)
    }
  }

  async function undoLast() {
    if (working || !latest) return

    const confirmed = window.confirm(
      `UNDO LAST PO SYNCHRONISATION?\n\n` +
      `${latest.remaining} changes are available.\n\n` +
      `More recent manual PO edits will be protected.\n\n` +
      `Continue?`
    )

    if (!confirmed) return

    setWorking(true)
    setError('')
    setNotice('')

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'excel_sync_undo_last_po_sync'
      )

      if (rpcError) throw rpcError

      const result = data as {
        undone?: number
        skipped?: number
        remaining?: number
      } | null

      setNotice(
        `Undo: ${result?.undone ?? 0} restored, ` +
        `${result?.skipped ?? 0} skipped, ` +
        `${result?.remaining ?? 0} remaining.`
      )

      await refreshAfterChange()
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
        border: '2px solid #86efac',
        borderRadius: 12,
        background: '#f8fdf9',
        marginBottom: 18,
        color: '#111827',
      }}
    >
      <h2 style={{ fontSize: 22, fontWeight: 800 }}>
        1. Updated POs ({eligible.length})
      </h2>

      <p
        style={{
          fontSize: 13,
          color: '#64748b',
          marginTop: 7,
        }}
      >
        Compare current and updated PO/transfer-order
        numbers before applying changes.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 9,
          alignItems: 'center',
          flexWrap: 'wrap',
          margin: '16px 0',
        }}
      >
        <button
          type="button"
          style={button}
          disabled={working || eligible.length === 0}
          onClick={() =>
            setSelected(
              eligible.map(
                (item) => item.combined.requisition.number
              )
            )
          }
        >
          Select All ({eligible.length})
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
            background: chosen.length ? '#15803d' : '#ddd',
            color: chosen.length ? '#fff' : '#666',
          }}
          disabled={working || chosen.length === 0}
          onClick={() => void applyUpdates()}
        >
          {working
            ? 'Processing...'
            : `Apply ${chosen.length} PO Update(s)`}
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

      {eligible.length === 0 && (
        <p
          style={{
            background: '#fff',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            padding: 14,
            color: '#166534',
          }}
        >
          No outstanding PO updates in these spreadsheets.
        </p>
      )}

      {blocked.length > 0 && (
        <p
          style={{
            background: '#fffbeb',
            color: '#92400e',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          {blocked.length} update(s) have unsupported
          reference values and are excluded from Select All.
        </p>
      )}

      {eligible.map((item) => {
        const req = item.combined.requisition
        const number = req.number
        const checked = selected.includes(number)

        return (
          <div
            key={number}
            style={{
              display: 'flex',
              gap: 12,
              padding: 13,
              border: checked
                ? '2px solid #16a34a'
                : '1px solid #d9e2dc',
              borderRadius: 10,
              background: '#fff',
              marginBottom: 11,
            }}
          >
            <input
              type="checkbox"
              aria-label={`Select ${number}`}
              checked={checked}
              disabled={working}
              onChange={(event) =>
                selectNumber(number, event.target.checked)
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
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: 'pointer',
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
                  {req.lines.length} lines
                  {' · '}
                  {item.saved?.title || 'Existing Order'}
                </span>
              </summary>

              <div
                style={{
                  marginTop: 14,
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(210px,1fr))',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    background: '#f1f5f9',
                    borderRadius: 8,
                    padding: 13,
                  }}
                >
                  <strong>Current PO</strong>
                  <p
                    style={{
                      marginTop: 8,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {formatPoNumbers(item.saved?.po_number) ||
                      '(blank)'}
                  </p>
                </div>

                <div
                  style={{
                    background: '#dcfce7',
                    borderRadius: 8,
                    padding: 13,
                  }}
                >
                  <strong>Updated PO</strong>
                  <p
                    style={{
                      marginTop: 8,
                      fontWeight: 700,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {formatPoNumbers(item.proposedPo)}
                  </p>
                </div>
              </div>

              <p
                style={{
                  marginTop: 11,
                  color: '#166534',
                  fontSize: 13,
                }}
              >
                Adding: {formatPoNumbers(
                  item.missingReferences.join(' ')
                )}
              </p>

              <p
                style={{
                  marginTop: 9,
                  fontSize: 13,
                  color: '#64748b',
                }}
              >
                L{item.saved?.level ?? '?'}
                {' · '}
                {req.enteredBy || 'Unknown staff'}
              </p>

              <div
                style={{
                  overflowX: 'auto',
                  marginTop: 14,
                }}
              >
                <table
                  style={{
                    width: '100%',
                    minWidth: 490,
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
                      {['Item No.', 'Description', 'Qty'].map(
                        (heading) => (
                          <th
                            key={heading}
                            style={{
                              textAlign: 'left',
                              padding: 9,
                            }}
                          >
                            {heading}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {req.lines.map((line, index) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )
      })}

      <div
        style={{
          borderTop: '1px solid #cbd5e1',
          paddingTop: 15,
          marginTop: 20,
        }}
      >
        <strong>Undo My Last PO Sync</strong>

        <p
          style={{
            color: '#64748b',
            fontSize: 13,
            margin: '8px 0',
          }}
        >
          {latest
            ? `${latest.remaining} changes available.`
            : 'No outstanding PO synchronisation found.'}
        </p>

        <button
          type="button"
          style={button}
          disabled={working || !latest || latest.remaining === 0}
          onClick={() => void undoLast()}
        >
          Undo My Last PO Sync
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
