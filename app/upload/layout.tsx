
import type { ReactNode } from 'react'
import CombinedUploadShell from './combined-upload-shell'

export default function UploadLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <CombinedUploadShell>
      {children}
    </CombinedUploadShell>
  )
}
