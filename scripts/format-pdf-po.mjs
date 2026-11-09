
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const relative = 'app/upload/page.tsx'
const target = path.join(root, relative)

if (!fs.existsSync(target)) {
  console.error(`File not found: ${relative}`)
  process.exitCode = 1
} else {
  const before = fs.readFileSync(target, 'utf8')
  let after = before
  let changed = 0

  const replacements = [
    {
      old: 'setParsedHeader(data.header ?? null)',
      new: `setParsedHeader(
        data.header
          ? {
              ...data.header,
              po_numbers: formatPoNumbers(
                data.header.po_numbers
              ),
            }
          : null
      )`,
    },
    {
      old: 'header: parsedHeader,',
      new: `header: {
            ...parsedHeader,
            po_numbers: formatPoNumbers(
              parsedHeader.po_numbers
            ),
          },`,
    },
  ]

  for (const replacement of replacements) {
    if (after.includes(replacement.old)) {
      after = after.replace(
        replacement.old,
        replacement.new
      )
      changed++
    }
  }

  if (changed > 0) {
    if (!after.includes(
      "import { formatPoNumbers } from '@/lib/po-numbers'"
    )) {
      after = after.replace(
        "'use client'",
        "'use client'\n\n" +
        "import { formatPoNumbers } from '@/lib/po-numbers'"
      )
    }

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')

    const backup = path.join(
      os.homedir(),
      'Desktop',
      'RequisitionTrackerBackup',
      `PDFPOBefore-${stamp}`,
      relative
    )

    fs.mkdirSync(path.dirname(backup), {
      recursive: true,
    })

    fs.copyFileSync(target, backup)
    fs.writeFileSync(target, after, 'utf8')

    console.log(
      `Updated ${changed} PDF PO formatting location(s).`
    )

    console.log(`Original backed up to: ${backup}`)
  } else {
    console.log(
      'No matching PDF code found. The PDF page was left unchanged.'
    )

    console.log(
      'This version of the PDF uploader uses a different ' +
      'parsing structure. Its PO preview still needs checking.'
    )
  }
}
