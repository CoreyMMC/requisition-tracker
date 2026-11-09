
/**
 * Formats PO and transfer-order numbers with commas.
 *
 * Example:
 * 5900009 59000008 5600000
 *
 * Becomes:
 * 5900009, 59000008, 5600000
 */

function isReference(value: string) {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    /\d/.test(value)
  )
}

export function formatPoNumbers(
  value: string | null | undefined
): string {
  const text = (value ?? '').trim()

  if (!text) return ''

  const values = text
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (values.length === 0) return ''

  // Preserve notes that aren't just reference numbers.
  if (!values.every(isReference)) {
    return text
      .replace(/\s*,\s*/g, ', ')
      .replace(/,\s*,+/g, ', ')
      .trim()
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const item of values) {
    const key = item.toUpperCase()

    if (seen.has(key)) continue

    seen.add(key)
    result.push(item)
  }

  return result.join(', ')
}

export function combinePoNumbers(
  existing: string | null | undefined,
  additions: string[]
): string {
  return formatPoNumbers(
    [existing ?? '', ...additions]
      .filter(Boolean)
      .join(', ')
  )
}
