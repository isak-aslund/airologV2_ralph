/**
 * Format a date to ISO 8601 format: "2026-01-12 15:13:12"
 * @param date - Date string, Date object, or Unix timestamp (seconds)
 * @param includeTime - Whether to include time portion (default: true)
 * @returns Formatted date string or '--' if invalid
 */
export function formatDateISO(
  date: string | Date | number | null | undefined,
  includeTime: boolean = true
): string {
  if (date === null || date === undefined) {
    return '--'
  }

  try {
    let d: Date

    if (typeof date === 'number') {
      // Assume Unix timestamp in seconds if number is small enough
      // Otherwise assume milliseconds
      d = date < 1e12 ? new Date(date * 1000) : new Date(date)
    } else if (typeof date === 'string') {
      d = new Date(date)
    } else {
      d = date
    }

    if (isNaN(d.getTime())) {
      return '--'
    }

    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')

    if (!includeTime) {
      return `${year}-${month}-${day}`
    }

    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  } catch {
    return '--'
  }
}
