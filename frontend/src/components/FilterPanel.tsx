import { useState, useEffect, useRef } from 'react'
import { getPilots, getDroneModels } from '../api/pilots'
import { getTags } from '../api/tags'
import type { Tag } from '../types'

// Available flight modes (matching backend FLIGHT_MODES)
const FLIGHT_MODES = [
  'Manual', 'Altitude', 'Position', 'Mission', 'Loiter',
  'Return to Land', 'Acro', 'Descend', 'Offboard', 'Stabilized',
  'Takeoff', 'Land', 'Follow Target', 'Precision Land', 'Orbit',
]

export interface FilterState {
  dateFrom: string
  dateTo: string
  droneModels: string[]  // Can be any drone model (known or custom)
  pilot: string
  tags: string[]
  flightModes: string[]
}

interface FilterPanelProps {
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
}

export default function FilterPanel({ filters, onFilterChange }: FilterPanelProps) {
  // Start collapsed on small screens (< 768px), expanded on larger screens
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768
    }
    return false
  })
  const [pilots, setPilots] = useState<string[]>([])
  const [pilotsLoading, setPilotsLoading] = useState(false)
  const [droneModels, setDroneModels] = useState<string[]>([])
  const [droneModelsLoading, setDroneModelsLoading] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)
  const [modeSearch, setModeSearch] = useState('')
  const modeDropdownRef = useRef<HTMLDivElement>(null)

  // Fetch pilots list on mount
  useEffect(() => {
    async function fetchPilots() {
      try {
        setPilotsLoading(true)
        const data = await getPilots()
        setPilots(data)
      } catch (err) {
        console.error('Error fetching pilots:', err)
      } finally {
        setPilotsLoading(false)
      }
    }
    fetchPilots()
  }, [])

  // Fetch drone models list on mount
  useEffect(() => {
    async function fetchDroneModels() {
      try {
        setDroneModelsLoading(true)
        const data = await getDroneModels()
        setDroneModels(data)
      } catch (err) {
        console.error('Error fetching drone models:', err)
      } finally {
        setDroneModelsLoading(false)
      }
    }
    fetchDroneModels()
  }, [])

  // Fetch tags list on mount
  useEffect(() => {
    async function fetchTags() {
      try {
        setTagsLoading(true)
        const data = await getTags()
        setAllTags(data)
      } catch (err) {
        console.error('Error fetching tags:', err)
      } finally {
        setTagsLoading(false)
      }
    }
    fetchTags()
  }, [])

  // Close tag dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setTagDropdownOpen(false)
      }
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setModeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleDateFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFilterChange({
      ...filters,
      dateFrom: e.target.value,
    })
  }

  function handleDateToChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFilterChange({
      ...filters,
      dateTo: e.target.value,
    })
  }

  function handleDroneModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const model = e.target.value
    onFilterChange({
      ...filters,
      droneModels: model ? [model] : [],
    })
  }

  function handlePilotChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onFilterChange({
      ...filters,
      pilot: e.target.value,
    })
  }

  function handleTagToggle(tagName: string) {
    const isSelected = filters.tags.includes(tagName)
    const newTags = isSelected
      ? filters.tags.filter((t) => t !== tagName)
      : [...filters.tags, tagName]
    onFilterChange({
      ...filters,
      tags: newTags,
    })
  }

  function handleRemoveTag(tagName: string) {
    onFilterChange({
      ...filters,
      tags: filters.tags.filter((t) => t !== tagName),
    })
  }

  function handleModeToggle(modeName: string) {
    const isSelected = filters.flightModes.includes(modeName)
    const newModes = isSelected
      ? filters.flightModes.filter((m) => m !== modeName)
      : [...filters.flightModes, modeName]
    onFilterChange({
      ...filters,
      flightModes: newModes,
    })
  }

  function handleRemoveMode(modeName: string) {
    onFilterChange({
      ...filters,
      flightModes: filters.flightModes.filter((m) => m !== modeName),
    })
  }

  function handleClearAll() {
    onFilterChange({
      dateFrom: '',
      dateTo: '',
      droneModels: [],
      pilot: '',
      tags: [],
      flightModes: [],
    })
  }

  // Filter tags based on search input
  const filteredTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(tagSearch.toLowerCase())
  )

  // Filter flight modes based on search input
  const filteredModes = FLIGHT_MODES.filter((mode) =>
    mode.toLowerCase().includes(modeSearch.toLowerCase())
  )

  // Check if any filters are active
  const hasActiveFilters =
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    filters.droneModels.length > 0 ||
    filters.pilot !== '' ||
    filters.tags.length > 0 ||
    filters.flightModes.length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-4">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {/* Filter icon */}
          <svg
            className="h-5 w-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          <span className="font-medium text-gray-700">Filters</span>
          {hasActiveFilters && (
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        {/* Chevron icon */}
        <svg
          className={`h-5 w-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible filter content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mt-4">
            {/* Date range - From */}
            <div>
              <label htmlFor="date-from" className="block text-sm font-medium text-gray-700 mb-1">
                From Date
              </label>
              <input
                type="date"
                id="date-from"
                value={filters.dateFrom}
                onChange={handleDateFromChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Date range - To */}
            <div>
              <label htmlFor="date-to" className="block text-sm font-medium text-gray-700 mb-1">
                To Date
              </label>
              <input
                type="date"
                id="date-to"
                value={filters.dateTo}
                onChange={handleDateToChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Drone Model dropdown */}
            <div>
              <label htmlFor="drone-model" className="block text-sm font-medium text-gray-700 mb-1">
                Drone Model
              </label>
              <select
                id="drone-model"
                value={filters.droneModels[0] || ''}
                onChange={handleDroneModelChange}
                disabled={droneModelsLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">All models</option>
                {droneModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            {/* Pilot dropdown */}
            <div>
              <label htmlFor="pilot" className="block text-sm font-medium text-gray-700 mb-1">
                Pilot
              </label>
              <select
                id="pilot"
                value={filters.pilot}
                onChange={handlePilotChange}
                disabled={pilotsLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">All pilots</option>
                {pilots.map((pilot) => (
                  <option key={pilot} value={pilot}>
                    {pilot}
                  </option>
                ))}
              </select>
            </div>

            {/* Tag filter with multi-select dropdown */}
            <div ref={tagDropdownRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <button
                type="button"
                onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                disabled={tagsLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center justify-between"
              >
                <span className={filters.tags.length === 0 ? 'text-gray-500' : ''}>
                  {filters.tags.length === 0
                    ? 'Select tags...'
                    : `${filters.tags.length} tag${filters.tags.length > 1 ? 's' : ''} selected`}
                </span>
                <svg
                  className={`h-5 w-5 text-gray-400 transition-transform ${tagDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {tagDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden">
                  {/* Search input in dropdown */}
                  <div className="p-2 border-b border-gray-200">
                    <input
                      type="text"
                      placeholder="Search tags..."
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {/* Tag list */}
                  <div className="max-h-40 overflow-y-auto">
                    {filteredTags.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">
                        {allTags.length === 0 ? 'No tags available' : 'No matching tags'}
                      </div>
                    ) : (
                      filteredTags.map((tag) => (
                        <label
                          key={tag.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={filters.tags.includes(tag.name)}
                            onChange={() => handleTagToggle(tag.name)}
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{tag.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Flight Modes filter with multi-select dropdown */}
            <div ref={modeDropdownRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Flight Modes</label>
              <button
                type="button"
                onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between"
              >
                <span className={filters.flightModes.length === 0 ? 'text-gray-500' : ''}>
                  {filters.flightModes.length === 0
                    ? 'Select modes...'
                    : `${filters.flightModes.length} mode${filters.flightModes.length > 1 ? 's' : ''} selected`}
                </span>
                <svg
                  className={`h-5 w-5 text-gray-400 transition-transform ${modeDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {modeDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden">
                  {/* Search input in dropdown */}
                  <div className="p-2 border-b border-gray-200">
                    <input
                      type="text"
                      placeholder="Search modes..."
                      value={modeSearch}
                      onChange={(e) => setModeSearch(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {/* Mode list */}
                  <div className="max-h-40 overflow-y-auto">
                    {filteredModes.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">
                        No matching modes
                      </div>
                    ) : (
                      filteredModes.map((mode) => (
                        <label
                          key={mode}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={filters.flightModes.includes(mode)}
                            onChange={() => handleModeToggle(mode)}
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <span className="text-sm text-gray-700">{mode}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Selected tags as removable chips */}
          {filters.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {filters.tags.map((tagName) => (
                <span
                  key={tagName}
                  className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded-full"
                >
                  {tagName}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tagName)}
                    className="hover:bg-blue-200 rounded-full p-0.5"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Selected flight modes as removable chips */}
          {filters.flightModes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {filters.flightModes.map((modeName) => (
                <span
                  key={modeName}
                  className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-indigo-100 text-indigo-800 rounded-full"
                >
                  {modeName}
                  <button
                    type="button"
                    onClick={() => handleRemoveMode(modeName)}
                    className="hover:bg-indigo-200 rounded-full p-0.5"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Clear All Filters button */}
          {hasActiveFilters && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleClearAll}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
