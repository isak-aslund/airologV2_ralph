import type { FilterState } from './FilterPanel'

interface ActiveFilterChipsProps {
  filters: FilterState
  onRemoveFilter: (type: keyof FilterState, value?: string) => void
}

export default function ActiveFilterChips({ filters, onRemoveFilter }: ActiveFilterChipsProps) {
  const chips: { label: string; type: keyof FilterState; value?: string }[] = []

  // Date range as single chip
  if (filters.dateFrom && filters.dateTo) {
    chips.push({
      label: `Date: ${filters.dateFrom} to ${filters.dateTo}`,
      type: 'dateFrom', // Will handle both dateFrom and dateTo removal
    })
  } else if (filters.dateFrom) {
    chips.push({
      label: `From: ${filters.dateFrom}`,
      type: 'dateFrom',
    })
  } else if (filters.dateTo) {
    chips.push({
      label: `To: ${filters.dateTo}`,
      type: 'dateTo',
    })
  }

  // Drone model chips (one per selected model)
  for (const model of filters.droneModels) {
    chips.push({
      label: `Model: ${model}`,
      type: 'droneModels',
      value: model,
    })
  }

  // Pilot chip
  if (filters.pilot) {
    chips.push({
      label: `Pilot: ${filters.pilot}`,
      type: 'pilot',
    })
  }

  // Tag chips (one per selected tag)
  for (const tag of filters.tags) {
    chips.push({
      label: `Tag: ${tag}`,
      type: 'tags',
      value: tag,
    })
  }

  // Flight mode chips (one per selected mode)
  for (const mode of filters.flightModes) {
    chips.push({
      label: `Mode: ${mode}`,
      type: 'flightModes',
      value: mode,
    })
  }

  // Don't render anything if no active filters
  if (chips.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, index) => (
        <span
          key={`${chip.type}-${chip.value ?? index}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm bg-gray-100 text-gray-700 rounded-full border border-gray-200"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onRemoveFilter(chip.type, chip.value)}
            className="hover:bg-gray-200 rounded-full p-0.5 transition-colors"
            title={`Remove ${chip.label}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  )
}
