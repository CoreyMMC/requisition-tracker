
'use client'

import { useRef, useState } from 'react'
import type {
  ChangeEvent,
  DragEvent,
  ReactNode,
} from 'react'
import ExcelSyncPage from '../excel-sync/page'

type Props = {
  children: ReactNode
}

const button = {
  padding: '12px 19px',
  border: '1px solid #b9c4cc',
  borderRadius: 9,
  background: '#fff',
  color: '#111827',
  fontWeight: 700,
  cursor: 'pointer',
}

export default function CombinedUploadShell({
  children,
}: Props) {
  const sharedInput = useRef<HTMLInputElement>(null)
  const pdfArea = useRef<HTMLDivElement>(null)
  const excelArea = useRef<HTMLDivElement>(null)

  const [dragging, setDragging] = useState(false)
  const [pdfCount, setPdfCount] = useState(0)
  const [excelCount, setExcelCount] = useState(0)
  const [queuedPdfs, setQueuedPdfs] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function forward(
    area: HTMLDivElement | null,
    selector: string,
    files: File[]
  ) {
    const input = area?.querySelector<HTMLInputElement>(
      selector
    )

    if (!input) {
      throw new Error(
        `The existing ${selector.includes('pdf') ? 'PDF' : 'Excel'} ` +
        'file input could not be found.'
      )
    }

    const transfer = new DataTransfer()

    files.forEach((file) => transfer.items.add(file))

    input.files = transfer.files

    // This triggers the existing React file-change handler.
    input.dispatchEvent(
      new Event('change', { bubbles: true })
    )

    return input.multiple
  }

  function routeFiles(files: File[]) {
    const pdfs = files.filter((file) =>
      file.name.toLowerCase().endsWith('.pdf')
    )

    const excels = files.filter((file) =>
      file.name.toLowerCase().endsWith('.xlsx')
    )

    const unsupported = files.filter(
      (file) => !pdfs.includes(file) && !excels.includes(file)
    )

    setError('')
    setMessage('')

    const messages: string[] = []

    try {
      if (pdfs.length) {
        const input = pdfArea.current
          ?.querySelector<HTMLInputElement>(
            'input[type="file"][accept*="pdf"]'
          )

        if (!input) {
          throw new Error(
            'Could not locate the existing PDF upload input.'
          )
        }

        const accepted = input.multiple
          ? pdfs
          : pdfs.slice(0, 1)

        forward(
          pdfArea.current,
          'input[type="file"][accept*="pdf"]',
          accepted
        )

        setPdfCount(accepted.length)

        setQueuedPdfs(
          input.multiple ? [] : pdfs.slice(1)
        )

        messages.push(
          `${accepted.length} PDF file(s) selected`
        )
      }

      if (excels.length) {
        forward(
          excelArea.current,
          'input[type="file"][accept*=".xlsx"]',
          excels
        )

        setExcelCount((count) => count + excels.length)

        messages.push(
          `${excels.length} Excel file(s) sent for comparison`
        )
      }

      if (unsupported.length) {
        setError(
          `Unsupported files: ${unsupported
            .map((file) => file.name)
            .join(', ')}. Use PDF or XLSX.`
        )
      }

      setMessage(messages.join(' · '))
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not distribute uploaded files.'
      )
    }
  }

  function fileChange(event: ChangeEvent<HTMLInputElement>) {
    routeFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    routeFiles(Array.from(event.dataTransfer.files))
  }

  function loadNextPdf() {
    if (!queuedPdfs.length) return

    const [next, ...remaining] = queuedPdfs

    try {
      forward(
        pdfArea.current,
        'input[type="file"][accept*="pdf"]',
        [next]
      )

      setQueuedPdfs(remaining)
      setPdfCount(1)

      setMessage(
        `${next.name} selected. Parse and review this PDF before moving on.`
      )
      setError('')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not select the next PDF.'
      )
    }
  }

  return (
    <div
      className="requisition-combined-upload"
      style={{
        maxWidth: 1350,
        margin: '0 auto',
        padding: '24px 18px 65px',
      }}
    >
      <style>{`
        .requisition-combined-upload
        .combined-excel-review > main > nav,
        .requisition-combined-upload
        .combined-excel-review > main > header,
        .requisition-combined-upload
        .combined-excel-review > main > section:first-of-type {
          display: none !important;
        }

        .requisition-combined-upload
        .combined-pdf-review
        input[type="file"][accept*="pdf"] + div {
          display: none !important;
        }
      `}</style>

      <header
        style={{
          background: '#166534',
          borderRadius: 14,
          padding: '23px 25px',
          color: '#fff',
          marginBottom: 18,
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          Upload Requisitions
        </h1>

        <p style={{ marginTop: 8 }}>
          PDF Parsing + Excel Synchronisation
        </p>
      </header>

      <section
        style={{
          padding: 18,
          border: '1px solid #d1d5db',
          borderRadius: 13,
          background: '#fff',
          marginBottom: 18,
        }}
      >
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={drop}
          style={{
            textAlign: 'center',
            padding: '40px 18px',
            border: dragging
              ? '3px dashed #16a34a'
              : '2px dashed #9ca3af',
            background: dragging
              ? '#ecfdf5'
              : '#f8fafc',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 40 }}>
            📄 📊
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#111827',
              marginTop: 11,
            }}
          >
            Drag PDF or Excel files here
          </h2>

          <p
            style={{
              color: '#64748b',
              margin: '9px 0 18px',
            }}
          >
            One upload box for both file types.
          </p>

          <input
            ref={sharedInput}
            type="file"
            multiple
            accept=".pdf,.xlsx,application/pdf"
            style={{ display: 'none' }}
            onChange={fileChange}
          />

          <button
            type="button"
            style={{
              ...button,
              background: '#15803d',
              color: '#fff',
              border: 0,
            }}
            onClick={() => sharedInput.current?.click()}
          >
            Choose Files
          </button>

          <p
            style={{
              fontSize: 12,
              color: '#64748b',
              marginTop: 13,
            }}
          >
            PDF or XLSX · Review before importing
          </p>
        </div>

        {message && (
          <p
            role="status"
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              color: '#166534',
              background: '#f0fdf4',
            }}
          >
            {message}
          </p>
        )}

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              color: '#b91c1c',
              background: '#fef2f2',
            }}
          >
            {error}
          </p>
        )}

        {queuedPdfs.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              background: '#fffbeb',
              borderRadius: 8,
            }}
          >
            <p>
              {queuedPdfs.length} PDF(s) remaining.
              Your existing PDF importer accepts one at a time.
            </p>

            <button
              type="button"
              style={{ ...button, marginTop: 9 }}
              onClick={loadNextPdf}
            >
              Load Next PDF
            </button>
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid #d1d5db',
          borderRadius: 12,
          background: '#fff',
          marginBottom: 18,
        }}
      >
        <details open={pdfCount > 0}>
          <summary
            style={{
              padding: 17,
              fontSize: 19,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Parsed PDF Requisitions
          </summary>

          <div
            ref={pdfArea}
            className="combined-pdf-review"
          >
            {children}
          </div>
        </details>
      </section>

      <section
        style={{
          border: '1px solid #d1d5db',
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <details open={excelCount > 0}>
          <summary
            style={{
              padding: 17,
              fontSize: 19,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Excel Synchronisation
          </summary>

          <div
            ref={excelArea}
            className="combined-excel-review"
          >
            <ExcelSyncPage />
          </div>
        </details>
      </section>

      <button
        type="button"
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: 'smooth',
          })
        }
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 1000,
          padding: '12px 17px',
          border: '1px solid white',
          borderRadius: 25,
          background: '#111827',
          color: '#fff',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
        }}
      >
        ↑ Back to Top
      </button>
    </div>
  )
}
