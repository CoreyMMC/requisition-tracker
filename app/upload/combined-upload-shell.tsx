
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  ChangeEvent,
  DragEvent,
  ReactNode,
} from 'react'
import ExcelSyncPage from '../excel-sync/page'
import type { ExcelSyncController } from '../excel-sync/page'

export type UploadResult = {
  succeeded: number
  failed: File[]
  errors: string[]
}

export type ImportResult = {
  succeeded: number
  failed: number
  cancelled: boolean
}

export type PdfStatus = {
  uploaded: number
  importable: number
  imported: number
  failed: number
}

export type PdfController = {
  upload: (files: File[]) => Promise<UploadResult>
  validateImport: () => string[]
  importAll: () => Promise<ImportResult>
  reset: () => void
}

type PdfBridge = {
  registerPdf: (controller: PdfController | null) => void
  reportPdf: (status: PdfStatus) => void
}

export const PdfUploadContext =
  createContext<PdfBridge | null>(null)

const emptyPdf: PdfStatus = {
  uploaded: 0,
  importable: 0,
  imported: 0,
  failed: 0,
}

type ExcelStatus = {
  uploaded: number
  newCount: number
  poCount: number
}

const emptyExcel: ExcelStatus = {
  uploaded: 0,
  newCount: 0,
  poCount: 0,
}

const mainButton = {
  padding: '11px 18px',
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
}

function identity(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export default function CombinedUploadShell({
  children,
}: {
  children: ReactNode
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const pdfController = useRef<PdfController | null>(null)
  const excelController = useRef<ExcelSyncController | null>(
    null
  )

  const [staged, setStaged] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [working, setWorking] = useState(false)

  const [pdfStatus, setPdfStatus] = useState(emptyPdf)
  const [excelStatus, setExcelStatus] =
    useState(emptyExcel)

  const [error, setError] = useState('')

  const registerPdf = useCallback(
    (controller: PdfController | null) => {
      pdfController.current = controller
    },
    []
  )

  const registerExcel = useCallback(
    (controller: ExcelSyncController | null) => {
      excelController.current = controller
    },
    []
  )

  const reportPdf = useCallback(
    (status: PdfStatus) => setPdfStatus(status),
    []
  )

  const reportExcel = useCallback(
    (status: ExcelStatus) => setExcelStatus(status),
    []
  )

  const bridge = useMemo(
    () => ({
      registerPdf,
      reportPdf,
    }),
    [registerPdf, reportPdf]
  )

  function stageFiles(files: File[]) {
    if (working || !files.length) return

    const invalid = files.filter(
      (file) =>
        !file.name.toLowerCase().endsWith('.pdf') &&
        !file.name.toLowerCase().endsWith('.xlsx')
    )

    const valid = files.filter(
      (file) => !invalid.includes(file)
    )

    setStaged((current) => {
      const known = new Set(current.map(identity))

      return [
        ...current,
        ...valid.filter((file) => {
          const key = identity(file)

          if (known.has(key)) return false

          known.add(key)
          return true
        }),
      ]
    })

    setError(
      invalid.length
        ? `Unsupported file(s): ${invalid
            .map((file) => file.name)
            .join(', ')}`
        : ''
    )
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    stageFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    stageFiles(Array.from(event.dataTransfer.files))
  }

  async function uploadFiles() {
    if (working || staged.length === 0) return

    if (!pdfController.current ||
        !excelController.current) {
      setError('The upload screens are still loading.')
      return
    }

    setWorking(true)
    setError('')

    const pdfFiles = staged.filter((file) =>
      file.name.toLowerCase().endsWith('.pdf')
    )

    const excelFiles = staged.filter((file) =>
      file.name.toLowerCase().endsWith('.xlsx')
    )

    const failed: File[] = []
    const messages: string[] = []

    try {
      if (pdfFiles.length) {
        try {
          const result =
            await pdfController.current.upload(pdfFiles)

          failed.push(...result.failed)
          messages.push(...result.errors)
        } catch (caught) {
          failed.push(...pdfFiles)
          messages.push(
            caught instanceof Error
              ? caught.message
              : 'PDF upload failed.'
          )
        }
      }

      if (excelFiles.length) {
        try {
          const result =
            await excelController.current.upload(excelFiles)

          failed.push(...result.failed)
          messages.push(...result.errors)
        } catch (caught) {
          failed.push(...excelFiles)
          messages.push(
            caught instanceof Error
              ? caught.message
              : 'Excel upload failed.'
          )
        }
      }

      // Successfully processed files leave the queue.
      // Failed files remain available for retry.
      setStaged(failed)

      if (messages.length) {
        setError(messages.join('\n'))
      }
    } finally {
      setWorking(false)
    }
  }

  async function importRequisitions() {
    if (working) return

    if (staged.length) {
      setError(
        'Upload the remaining selected files before importing.'
      )
      return
    }

    const pdf = pdfController.current
    const excel = excelController.current

    if (!pdf || !excel) {
      setError('The import screens are still loading.')
      return
    }

    const hasPdf = pdfStatus.importable > 0
    const hasExcel = excelStatus.newCount > 0

    if (!hasPdf && !hasExcel) return

    const problems: string[] = []

    // Validate both types before writing any orders.
    if (hasExcel) {
      problems.push(...excel.validateImport())
    }

    if (hasPdf) {
      problems.push(...pdf.validateImport())
    }

    if (problems.length) {
      setError(problems.join('\n'))
      return
    }

    setWorking(true)
    setError('')

    let successful = 0
    let failed = false

    try {
      // Excel goes first so its review confirmation is
      // accepted before any PDF orders are inserted.
      if (hasExcel) {
        const result = await excel.importAll()

        if (result.cancelled) return

        successful += result.succeeded

        if (result.failed > 0) {
          failed = true
        }
      }

      // A failed Excel import stops the PDF portion.
      if (failed) {
        setError(
          'The Excel import did not complete. Review the error below.'
        )
        return
      }

      if (hasPdf) {
        const result = await pdf.importAll()

        successful += result.succeeded

        if (result.failed > 0 || result.cancelled) {
          failed = true
        }
      }

      if (failed) {
        setError(
          'One or more requisitions were not imported. ' +
          'Check the review cards before retrying.'
        )
        return
      }

      if (successful > 0) {
        router.replace('/orders')
        router.refresh()
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Import did not complete.'
      )
    } finally {
      setWorking(false)
    }
  }

  function clearAll() {
    if (working) return

    pdfController.current?.reset()
    excelController.current?.reset()

    setStaged([])
    setPdfStatus(emptyPdf)
    setExcelStatus(emptyExcel)
    setError('')

    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const uploaded =
    pdfStatus.uploaded + excelStatus.uploaded

  const importable =
    pdfStatus.importable + excelStatus.newCount

  const showPdf =
    pdfStatus.uploaded > 0 ||
    pdfStatus.failed > 0

  const showExcel = excelStatus.uploaded > 0

  return (
    <PdfUploadContext.Provider value={bridge}>
      <main
        style={{
          maxWidth: 1320,
          margin: '0 auto',
          padding: '20px 20px 70px',
          color: '#111827',
        }}
      >
        <Link
          href="/orders"
          style={{
            display: 'inline-block',
            padding: '10px 16px',
            border: '2px solid #111',
            borderRadius: 8,
            background: '#fff',
            color: '#111',
            fontWeight: 700,
            textDecoration: 'none',
            marginBottom: 20,
          }}
        >
          Back to Orders
        </Link>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.xlsx,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={onInput}
        />

        <div
          onClick={() => {
            if (!working) inputRef.current?.click()
          }}
          onDragOver={(event) => {
            event.preventDefault()
            if (!working) setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={onDrop}
          style={{
            padding: '38px 24px',
            border: dragging
              ? '3px solid #16a34a'
              : '2px dashed #888',
            borderRadius: 12,
            background: dragging
              ? '#f0fdf4'
              : '#fafafa',
            cursor: working ? 'wait' : 'pointer',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              marginBottom: 8,
            }}
          >
            Drag PDF or Excel requisitions here
          </div>

          <div style={{ fontSize: 17 }}>
            Or click to choose one or multiple files
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 11,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            disabled={working || staged.length === 0}
            onClick={() => void uploadFiles()}
            style={{
              ...mainButton,
              border: '2px solid #166534',
              background: '#16a34a',
              color: '#fff',
              opacity:
                working || staged.length === 0 ? 0.5 : 1,
            }}
          >
            {working
              ? 'Processing...'
              : `Upload Files (${staged.length})`}
          </button>

          <button
            type="button"
            disabled={
              working ||
              importable === 0 ||
              staged.length > 0
            }
            onClick={() => void importRequisitions()}
            style={{
              ...mainButton,
              border: '2px solid #1d4ed8',
              background: '#2563eb',
              color: '#fff',
              opacity:
                working ||
                importable === 0 ||
                staged.length > 0
                  ? 0.5
                  : 1,
            }}
          >
            {working
              ? 'Processing...'
              : `Import Requisitions (${importable})`}
          </button>

          <button
            type="button"
            disabled={working}
            onClick={clearAll}
            style={{
              ...mainButton,
              border: '1px solid #aaa',
              background: '#fff',
              color: '#111',
            }}
          >
            Clear All
          </button>
        </div>

        <p
          style={{
            marginTop: 15,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Uploaded: {uploaded}
        </p>

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 13,
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

        <div
          style={{
            display: showPdf ? 'block' : 'none',
            marginTop: 22,
          }}
        >
          {children}
        </div>

        <div
          style={{
            display: showExcel ? 'block' : 'none',
            marginTop: 22,
          }}
        >
          <ExcelSyncPage
            embedded
            onRegister={registerExcel}
            onStatus={reportExcel}
          />
        </div>

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
            right: 20,
            bottom: 20,
            zIndex: 1000,
            padding: '12px 17px',
            borderRadius: 25,
            border: '1px solid #fff',
            background: '#111827',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow:
              '0 3px 12px rgba(0,0,0,0.25)',
          }}
        >
          ↑ Back to Top
        </button>
      </main>
    </PdfUploadContext.Provider>
  )
}
