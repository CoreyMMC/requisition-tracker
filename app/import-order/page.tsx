'use client'

import { useState } from 'react'

type ParsedHeader = {
  requisition_no: string
  po_numbers: string
  date: string
  entered_by: string
  requisition_amount_aud: number | null
}

type ParsedItem = {
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number
  amount_aud: number | null
}

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return '—'

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value)
}

export default function ImportOrderPage() {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const [parsedHeader, setParsedHeader] = useState<ParsedHeader | null>(null)
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([])
  const [fileName, setFileName] = useState('')

  const [duplicateMessage, setDuplicateMessage] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    setDuplicateMessage('')
    setLoading(true)
    setParsedHeader(null)
    setParsedItems([])
    setFileName('')

    const form = e.currentTarget
    const fileInput = form.elements.namedItem('file') as HTMLInputElement
    const file = fileInput.files?.[0]

    if (!file) {
      setMessage('Please choose a PDF first')
      setLoading(false)
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/import-order', {
        method: 'POST',
        body: formData,
      })

      const raw = await res.text()

      let data: any = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }

      if (!res.ok) {
        setMessage(`Upload failed: ${data?.error || raw}`)
        setLoading(false)
        return
      }

      setParsedHeader(data.header)
      setParsedItems(data.items || [])
      setFileName(data.fileName || file.name)
      setMessage(`Parsed requisition ${data.header?.requisition_no}. Ready to import.`)
    } catch (err) {
      console.error(err)
      setMessage('Upload crashed in browser console')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport(overrideDuplicate = false) {
    if (!parsedHeader) {
      setMessage('Please upload and parse a PDF first.')
      return
    }

    setImporting(true)
    setMessage('')
    setDuplicateMessage('')

    try {
      const res = await fetch('/api/import-order', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          header: parsedHeader,
          items: parsedItems,
          title: null,
          overrideDuplicate,
        }),
      })

      const raw = await res.text()

      let data: any = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }

      if (res.status === 409) {
        setDuplicateMessage(
          data?.error || `Requisition ${parsedHeader.requisition_no} already exists.`
        )
        setImporting(false)
        return
      }

      if (!res.ok) {
        setMessage(`Import failed: ${data?.error || raw}`)
        setImporting(false)
        return
      }

      if (data?.overridden) {
        setMessage(`Success: Requisition ${parsedHeader.requisition_no} was overridden and re-imported.`)
      } else {
        setMessage(`Success: Requisition ${parsedHeader.requisition_no} imported successfully.`)
      }

      setDuplicateMessage('')
    } catch (error) {
      console.error(error)
      setMessage('Import crashed in browser console')
    } finally {
      setImporting(false)
    }
  }

  return (
    <main style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ marginBottom: '20px' }}>Import Order PDF</h1>

      <form onSubmit={handleSubmit}>
        <input type="file" name="file" accept="application/pdf,.pdf" />

        <div style={{ marginTop: '16px' }}>
          <button type="submit" disabled={loading}>
            {loading ? 'Uploading...' : 'Upload and Parse PDF'}
          </button>
        </div>
      </form>

      {message && (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 14px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            backgroundColor: '#f9fafb',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </div>
      )}

      {duplicateMessage && (
        <div
          style={{
            marginTop: '20px',
            padding: '16px',
            border: '2px solid #b91c1c',
            borderRadius: '8px',
            backgroundColor: '#fef2f2',
          }}
        >
          <div
            style={{
              color: '#991b1b',
              fontWeight: 700,
              marginBottom: '12px',
            }}
          >
            {duplicateMessage}
          </div>

          <button
            type="button"
            onClick={() => void handleImport(true)}
            disabled={importing}
            style={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: '2px solid #991b1b',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              cursor: importing ? 'not-allowed' : 'pointer',
              opacity: importing ? 0.6 : 1,
            }}
          >
            {importing ? 'Overriding...' : 'Override Import'}
          </button>
        </div>
      )}

      {parsedHeader && (
        <div
          style={{
            marginTop: '24px',
            border: '1px solid #d1d5db',
            borderRadius: '10px',
            padding: '20px',
            backgroundColor: '#ffffff',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Parsed Preview</h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px 24px',
              marginBottom: '20px',
            }}
          >
            <div>
              <strong>File:</strong> {fileName || '—'}
            </div>
            <div>
              <strong>Requisition:</strong> {parsedHeader.requisition_no || '—'}
            </div>
            <div>
              <strong>Date:</strong> {parsedHeader.date || '—'}
            </div>
            <div>
              <strong>Entered By:</strong> {parsedHeader.entered_by || '—'}
            </div>
            <div>
              <strong>PO Number(s):</strong> {parsedHeader.po_numbers || '—'}
            </div>
            <div>
              <strong>Total:</strong> {formatCurrency(parsedHeader.requisition_amount_aud)}
            </div>
            <div>
              <strong>Items:</strong> {parsedItems.length}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleImport(false)}
            disabled={importing}
            style={{
              backgroundColor: '#111111',
              color: '#ffffff',
              border: '1px solid #111111',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 700,
              cursor: importing ? 'not-allowed' : 'pointer',
              opacity: importing ? 0.6 : 1,
            }}
          >
            {importing ? 'Importing...' : 'Import Order'}
          </button>
        </div>
      )}
    </main>
  )
}