
'use client'

import { useRef, useState } from 'react'

type Props = {
  onFiles: (files: File[]) => void
  busy: boolean
  count: number
}

export default function ExcelUploadZone({
  onFiles,
  busy,
  count,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [warning, setWarning] = useState('')

  function acceptFiles(files: File[]) {
    if (busy || !files.length) return

    const valid = files.filter((file) =>
      file.name.toLowerCase().endsWith('.xlsx')
    )

    setWarning(
      files.length !== valid.length
        ? 'Only .xlsx Excel spreadsheets are supported.'
        : ''
    )

    if (valid.length) onFiles(valid)
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          acceptFiles(Array.from(event.dataTransfer.files))
        }}
        style={{
          border: `2px dashed ${dragging ? '#16a34a' : '#b8c5ba'}`,
          background: dragging ? '#f0fdf4' : '#f8fbf9',
          borderRadius: 16,
          padding: '35px 20px',
          textAlign: 'center',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 10 }}>
          📊
        </div>

        <h3
          style={{
            fontSize: 21,
            fontWeight: 800,
            marginBottom: 9,
          }}
        >
          {busy
            ? 'Processing spreadsheets...'
            : 'Upload Excel Requisitions'}
        </h3>

        <p
          style={{
            color: '#526158',
            fontSize: 14,
            marginBottom: 19,
            lineHeight: 1.6,
          }}
        >
          Drag and drop your Excel spreadsheet here,
          <br />
          or select it from your computer.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          disabled={busy}
          style={{ display: 'none' }}
          onChange={(event) => {
            acceptFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          style={{
            padding: '13px 25px',
            border: 0,
            borderRadius: 10,
            background: busy ? '#a3a3a3' : '#168347',
            color: '#fff',
            fontWeight: 800,
            fontSize: 15,
            cursor: busy ? 'wait' : 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.10)',
          }}
        >
          {busy ? 'Processing...' : 'Choose Excel Files'}
        </button>

        <p
          style={{
            color: '#68746c',
            fontSize: 12,
            marginTop: 15,
          }}
        >
          XLSX format only · One staff export or multiple
          exports supported
        </p>
      </div>

      {warning && (
        <p
          role="alert"
          style={{ color: '#b91c1c', marginTop: 10 }}
        >
          {warning}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          marginTop: 12,
          border: '1px solid #d8e2da',
          borderRadius: 10,
          background: '#fff',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <strong>
            {count === 0
              ? 'No spreadsheets uploaded'
              : `${count} spreadsheet${count === 1 ? '' : 's'} loaded`}
          </strong>
          <p
            style={{
              fontSize: 12,
              color: '#66736a',
              marginTop: 3,
            }}
          >
            {count === 0
              ? 'Choose a spreadsheet to begin.'
              : 'Review the file details and requisitions below.'}
          </p>
        </div>

        {count > 0 && (
          <span
            style={{
              padding: '7px 11px',
              background: '#dcfce7',
              borderRadius: 8,
              color: '#166534',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Files loaded
          </span>
        )}
      </div>

      <p
        style={{
          fontSize: 12,
          color: '#647067',
          marginTop: 12,
        }}
      >
        Your files are compared with the existing Orders
        and historical baseline. Nothing is imported until
        you explicitly confirm an action.
      </p>
    </div>
  )
}
