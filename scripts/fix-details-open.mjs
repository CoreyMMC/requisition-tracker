
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()

const files = [
  'app/excel-sync/new-order-import.tsx',
  'app/excel-sync/po-sync-controls.tsx',
  'app/excel-sync/page.tsx',
]

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')

const backupFolder = path.join(
  os.homedir(),
  'Desktop',
  'RequisitionTrackerBackup',
  `BeforeDetailsFix-${stamp}`
)

let totalFixed = 0

for (const relativePath of files) {
  const filePath = path.join(root, relativePath)

  if (!fs.existsSync(filePath)) {
    console.log(`Not found: ${relativePath}`)
    continue
  }

  const original = fs.readFileSync(filePath, 'utf8')
  let fixedInFile = 0

  // Only change attributes on HTML <details> tags.
  // Leave custom component props named defaultOpen alone.
  const updated = original.replace(
    /<details\b[\s\S]*?>/g,
    (tag) =>
      tag.replace(/\bdefaultOpen\b/g, () => {
        fixedInFile++
        return 'open'
      })
  )

  if (updated === original) {
    console.log(`Already OK: ${relativePath}`)
    continue
  }

  const backupPath = path.join(
    backupFolder,
    relativePath
  )

  fs.mkdirSync(path.dirname(backupPath), {
    recursive: true,
  })

  fs.copyFileSync(filePath, backupPath)
  fs.writeFileSync(filePath, updated, 'utf8')

  totalFixed += fixedInFile

  console.log(
    `Fixed ${fixedInFile} attribute(s): ${relativePath}`
  )
}

console.log('')
console.log(`Total fixes: ${totalFixed}`)
console.log(`Backup location: ${backupFolder}`)
console.log('')
console.log('Now run: npm run build')
