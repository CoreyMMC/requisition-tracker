'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

type ParsedOrderHeader = {
  requisition_no?: string
  po_numbers?: string
  date?: string
  entered_by?: string
  requisition_amount_aud?: number | string | null
}

type ParsedOrderItem = {
  line_no: number
  item_no: string
  item_name: string
  qty_ordered: number | string
  amount_aud?: number | string | null
}

type ParseResponse = {
  ok?: boolean
  fileName?: string
  fileSize?: number
  header?: ParsedOrderHeader
  items?: ParsedOrderItem[]
  raw_line_count?: number
  kept_line_count?: number
  error?: string
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'

  const numeric = Number(value)
  if (Number.isNaN(numeric)) return String(value)

  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(numeric)
}

export default function UploadPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [message, setMessage] = useState('No response yet')

  const [parsedHeader, setParsedHeader] = useState<ParsedOrderHeader | null>(null)
  const [parsedItems, setParsedItems] = useState<ParsedOrderItem[]>([])
  const [rawLineCount, setRawLineCount] = useState<number>(0)
  const [keptLineCount, setKeptLineCount] = useState<number>(0)

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateMessage, setDuplicateMessage] = useState('')

  function handleSelectedFile(file: File | null) {
    if (!file) return

    const isPdf =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')

    if (!isPdf) {
      setSelectedFile(null)
      setMessage('That file is not a PDF')
      alert('Please upload a PDF file only')
      return
    }

    setSelectedFile(file)
    setMessage(`Selected file: ${file.name}`)
    setParsedHeader(null)
    setParsedItems([])
    setRawLineCount(0)
    setKeptLineCount(0)
    setDuplicateModalOpen(false)
    setDuplicateMessage('')
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    handleSelectedFile(file)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)

    const file = e.dataTransfer.files?.[0] || null
    handleSelectedFile(file)
  }

  function handleChooseFile() {
    inputRef.current?.click()
  }

  async function handleUpload() {
    if (!selectedFile) {
      setMessage('No file selected')
      alert('Choose or drag a PDF first')
      return
    }

    setLoading(true)
    setMessage(`Uploading: ${selectedFile.name}`)
    setDuplicateModalOpen(false)
    setDuplicateMessage('')

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const res = await fetch('/api/import-order', {
        method: 'POST',
        body: formData,
      })

      const raw = await res.text()

      if (!res.ok) {
        setMessage(`Server error (${res.status}): ${raw}`)
        alert(`Server error (${res.status})`)
        return
      }

      let data: ParseResponse

      try {
        data = JSON.parse(raw)
      } catch {
        setMessage(`Server returned non-JSON:\n${raw}`)
        alert('Server returned non-JSON response')
        return
      }

      setParsedHeader(data.header ?? null)
      setParsedItems(data.items ?? [])
      setRawLineCount(data.raw_line_count ?? 0)
      setKeptLineCount(data.kept_line_count ?? 0)
      setMessage(`Success. Parsed ${data.items?.length ?? 0} item rows.`)
    } catch (error) {
      console.error('UPLOAD ERROR:', error)
      setMessage(
        error instanceof Error
          ? `Browser error: ${error.message}`
          : 'Unknown browser error'
      )
      alert('Upload failed - check browser console')
    } finally {
      setLoading(false)
    }
  }

  async function handleImportOrder(overrideDuplicate = false) {
    if (!parsedHeader) {
      alert('Parse the PDF first')
      return
    }

    setImporting(true)
    setDuplicateModalOpen(false)
    setMessage(overrideDuplicate ? 'Overriding duplicate requisition...' : 'Importing order...')

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

      let data: {
        error?: string
        orderId?: string
        ok?: boolean
        duplicate?: boolean
        overridden?: boolean
      }

      try {
        data = JSON.parse(raw)
      } catch {
        setMessage(`Import returned non-JSON:\n${raw}`)
        alert('Import returned non-JSON response')
        return
      }

      if (res.status === 409) {
        const reqNo = parsedHeader.requisition_no || 'This requisition'
        setDuplicateMessage(data.error || `Requisition ${reqNo} already exists.`)
        setDuplicateModalOpen(true)
        setMessage('Duplicate requisition found.')
        return
      }

      if (!res.ok) {
        setMessage(data.error || 'Import failed')
        alert(data.error || 'Import failed')
        return
      }

      if (overrideDuplicate) {
        setMessage('Duplicate requisition imported as a new copy — returning to Orders...')
      } else {
        setMessage('Import successful — returning to Orders...')
      }

      router.replace('/orders')
      router.refresh()
    } catch (error) {
      console.error('IMPORT ERROR:', error)
      setMessage(
        error instanceof Error
          ? `Import error: ${error.message}`
          : 'Unknown import error'
      )
      alert('Import failed')
    } finally {
      setImporting(false)
    }
  }

  function updateHeader(field: keyof ParsedOrderHeader, value: string) {
    setParsedHeader((prev) => ({
      ...(prev ?? {}),
      [field]:
        field === 'requisition_amount_aud'
          ? value === ''
            ? null
            : Number(value)
          : value,
    }))
  }

  function updateItem(
    index: number,
    field: keyof ParsedOrderItem,
    value: string
  ) {
    setParsedItems((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]:
                field === 'line_no' ||
                field === 'qty_ordered' ||
                field === 'amount_aud'
                  ? value === ''
                    ? ''
                    : Number(value)
                  : value,
            }
          : item
      )
    )
  }

  return (
    <main style={{ padding: 24, maxWidth: 1300, position: 'relative' }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/orders"
          style={{
            display: 'inline-block',
            padding: '10px 16px',
            border: '2px solid black',
            borderRadius: 8,
            background: 'white',
            color: 'black',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Back to Orders
        </Link>
      </div>

      <h1>Upload PDF</h1>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleChooseFile}
        style={{
          marginTop: 20,
          padding: '36px 24px',
          border: dragActive ? '3px solid #000' : '2px dashed #777',
          borderRadius: 12,
          background: dragActive ? '#f2f2f2' : '#fafafa',
          cursor: 'pointer',
          textAlign: 'center',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Drag PDF here
        </div>

        <div style={{ fontSize: 18, marginBottom: 10 }}>
          or click this box to choose a PDF
        </div>

        <div style={{ color: '#666' }}>PDF only</div>

        {selectedFile && (
          <div style={{ marginTop: 18, fontWeight: 700 }}>
            Selected: {selectedFile.name}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={handleUpload}
          disabled={loading}
          style={{
            padding: '10px 18px',
            fontSize: 16,
            cursor: loading ? 'not-allowed' : 'pointer',
            border: '2px solid #166534',
            borderRadius: 8,
            background: '#16a34a',
            color: 'white',
            fontWeight: 700,
          }}
        >
          {loading ? 'Uploading...' : 'Upload PDF'}
        </button>

        <button
          type="button"
          onClick={() => {
            setSelectedFile(null)
            setParsedHeader(null)
            setParsedItems([])
            setRawLineCount(0)
            setKeptLineCount(0)
            setMessage('No response yet')
            setDuplicateModalOpen(false)
            setDuplicateMessage('')
            if (inputRef.current) inputRef.current.value = ''
          }}
          disabled={loading || importing}
          style={{
            padding: '10px 18px',
            fontSize: 16,
            cursor: loading || importing ? 'not-allowed' : 'pointer',
            border: '1px solid #999',
            borderRadius: 8,
            background: 'white',
            color: 'black',
          }}
        >
          Clear
        </button>

        {parsedHeader && (
          <button
            type="button"
            onClick={() => void handleImportOrder(false)}
            disabled={importing}
            style={{
              padding: '10px 18px',
              fontSize: 16,
              cursor: importing ? 'not-allowed' : 'pointer',
              border: '2px solid #1d4ed8',
              borderRadius: 8,
              background: '#2563eb',
              color: 'white',
              fontWeight: 700,
            }}
          >
            {importing ? 'Importing...' : 'Import Order'}
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 16,
          border: '1px solid #ccc',
          background: '#f7f7f7',
          whiteSpace: 'pre-wrap',
        }}
      >
        <strong>Status:</strong>
        <div style={{ marginTop: 8 }}>{message}</div>
      </div>

      {parsedHeader && (
        <div style={{ marginTop: 24 }}>
          <h2>Review Parsed Data</h2>

          <div
            style={{
              padding: 16,
              border: '1px solid #ccc',
              background: '#fafafa',
              marginBottom: 20,
            }}
          >
            <p><strong>Raw text lines:</strong> {rawLineCount}</p>
            <p><strong>Kept item rows:</strong> {keptLineCount}</p>
          </div>

          <h3>Header</h3>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              background: 'white',
              marginBottom: 24,
            }}
          >
            <tbody>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: 8, width: 260 }}>
                  <strong>Requisition No</strong>
                </td>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <input
                    type="text"
                    value={parsedHeader.requisition_no || ''}
                    onChange={(e) => updateHeader('requisition_no', e.target.value)}
                    style={{ width: '100%', padding: 8 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <strong>PO Number(s)</strong>
                </td>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <input
                    type="text"
                    value={parsedHeader.po_numbers || ''}
                    onChange={(e) => updateHeader('po_numbers', e.target.value)}
                    style={{ width: '100%', padding: 8 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <strong>Date</strong>
                </td>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <input
                    type="text"
                    value={parsedHeader.date || ''}
                    onChange={(e) => updateHeader('date', e.target.value)}
                    style={{ width: '100%', padding: 8 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <strong>Entered By</strong>
                </td>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <input
                    type="text"
                    value={parsedHeader.entered_by || ''}
                    onChange={(e) => updateHeader('entered_by', e.target.value)}
                    style={{ width: '100%', padding: 8 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <strong>Requisition Amount (Total Cost)</strong>
                </td>
                <td style={{ border: '1px solid #ccc', padding: 8 }}>
                  <input
                    type="number"
                    step="0.01"
                    value={parsedHeader.requisition_amount_aud ?? ''}
                    onChange={(e) =>
                      updateHeader('requisition_amount_aud', e.target.value)
                    }
                    style={{ width: '100%', padding: 8 }}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <h3>Items</h3>

          {parsedItems.length > 0 ? (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: 'white',
              }}
            >
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ccc', padding: 8, textAlign: 'left' }}>Line No.</th>
                  <th style={{ border: '1px solid #ccc', padding: 8, textAlign: 'left' }}>Item No.</th>
                  <th style={{ border: '1px solid #ccc', padding: 8, textAlign: 'left' }}>Item Name</th>
                  <th style={{ border: '1px solid #ccc', padding: 8, textAlign: 'left' }}>Qty Ordered</th>
                  <th style={{ border: '1px solid #ccc', padding: 8, textAlign: 'left' }}>Amount (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.map((item, index) => (
                  <tr key={`${item.line_no}-${index}`}>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <input
                        type="number"
                        value={item.line_no}
                        onChange={(e) => updateItem(index, 'line_no', e.target.value)}
                        style={{ width: '100%', padding: 8 }}
                      />
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <input
                        type="text"
                        value={item.item_no}
                        onChange={(e) => updateItem(index, 'item_no', e.target.value)}
                        style={{ width: '100%', padding: 8 }}
                      />
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <input
                        type="text"
                        value={item.item_name}
                        onChange={(e) => updateItem(index, 'item_name', e.target.value)}
                        style={{ width: '100%', padding: 8 }}
                      />
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <input
                        type="number"
                        value={item.qty_ordered}
                        onChange={(e) => updateItem(index, 'qty_ordered', e.target.value)}
                        style={{ width: '100%', padding: 8 }}
                      />
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <input
                        type="number"
                        step="0.01"
                        value={item.amount_aud ?? ''}
                        onChange={(e) => updateItem(index, 'amount_aud', e.target.value)}
                        style={{ width: '100%', padding: 8 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No item rows were recognised yet.</p>
          )}

          {parsedHeader && (
            <div style={{ marginTop: 20 }}>
              <p>
                <strong>Preview Total:</strong>{' '}
                {formatCurrency(parsedHeader.requisition_amount_aud)}
              </p>
            </div>
          )}
        </div>
      )}

      {duplicateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 560,
              background: '#ffffff',
              borderRadius: 12,
              boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '28px 32px 22px 32px',
                fontSize: 18,
                color: '#444',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              {duplicateMessage || 'This requisition already exists.'}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
                padding: '18px 24px',
                background: '#fafafa',
              }}
            >
              <button
                type="button"
                onClick={() => setDuplicateModalOpen(false)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #9ca3af',
                  background: '#ffffff',
                  color: '#111827',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => void handleImportOrder(true)}
                disabled={importing}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '2px solid #991b1b',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: importing ? 'not-allowed' : 'pointer',
                  opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? 'Importing copy...' : 'Import as New Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}