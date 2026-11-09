
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const targets = ['app', 'components']

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')

const backupRoot = path.join(
  os.homedir(),
  'Desktop',
  'RequisitionTrackerBackup',
  `BeforeL3L5-${stamp}`
)

const changedFiles = []

function updateLabels(source) {
  return source
    // Plain text labels, e.g. "Level 3".
    .replace(
      /\bLevel[ \t]+([35])\b/g,
      (_match, level) => `L${level}`
    )

    // JSX dynamic labels, e.g. Level {level}.
    .replace(
      /\bLevel[ \t]+\{([^}\n]+)\}/g,
      (_match, expression) => `L{${expression}}`
    )

    // Template strings, e.g. `Level ${level}`.
    .replace(
      /\bLevel[ \t]+\$\{([^}\n]+)\}/g,
      (_match, expression) => `L\${${expression}}`
    )
}

function walk(directory) {
  if (!fs.existsSync(directory)) return

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.next' ||
      entry.name === '.git'
    ) continue

    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      walk(absolute)
      continue
    }

    if (!entry.isFile() || !absolute.endsWith('.tsx')) {
      continue
    }

    const before = fs.readFileSync(absolute, 'utf8')
    const after = updateLabels(before)

    if (after === before) continue

    const relative = path.relative(root, absolute)
    const backupPath = path.join(backupRoot, relative)

    fs.mkdirSync(path.dirname(backupPath), {
      recursive: true,
    })

    fs.copyFileSync(absolute, backupPath)
    fs.writeFileSync(absolute, after, 'utf8')

    changedFiles.push(relative)
  }
}

for (const target of targets) {
  walk(path.join(root, target))
}

console.log('\nL3 / L5 label update complete.')
console.log(`Files changed: ${changedFiles.length}`)

for (const file of changedFiles) {
  console.log(`  ✓ ${file}`)
}

console.log(`\nBackups saved to:\n${backupRoot}`)

if (changedFiles.length === 0) {
  console.log(
    '\nNo matching labels found. They may already be shortened.'
  )
}

console.log(
  '\nRun npm run build to check the updated application.'
)
