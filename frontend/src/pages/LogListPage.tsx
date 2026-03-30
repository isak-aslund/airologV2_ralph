import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import StatsHeader from '../components/StatsHeader'
import FlightLogTable from '../components/FlightLogTable'
import SearchBar from '../components/SearchBar'
import FilterPanel, { type FilterState } from '../components/FilterPanel'
import ActiveFilterChips from '../components/ActiveFilterChips'
import Pagination from '../components/Pagination'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ParameterModal from '../components/ParameterModal'
import EditLogModal from '../components/EditLogModal'
import { getLogs, downloadLog, uploadToFlightReview, bulkDownloadLogs, getFilteredLogIds } from '../api/logs'
import type { FlightLog, PaginatedResponse } from '../types'

const VALID_PER_PAGE = [25, 50, 100] as const

// Parse URL search params into filter state
function parseFiltersFromParams(searchParams: URLSearchParams): FilterState {
  const droneModelParam = searchParams.get('drone_model')
  const droneModels = droneModelParam
    ? droneModelParam.split(',').filter(Boolean)
    : []

  const tagsParam = searchParams.get('tags')
  const tags = tagsParam ? tagsParam.split(',').filter(Boolean) : []

  const flightModesParam = searchParams.get('flight_modes')
  const flightModes = flightModesParam ? flightModesParam.split(',').filter(Boolean) : []

  return {
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
    droneModels,
    pilot: searchParams.get('pilot') || '',
    tags,
    flightModes,
    towMin: searchParams.get('tow_min') || '',
    towMax: searchParams.get('tow_max') || '',
    hasAttachments: searchParams.get('has_attachments') || '',
    session: searchParams.get('session') || '',
    tagsLogic: (searchParams.get('tags_logic') as 'and' | 'or') || 'and',
    flightModesLogic: (searchParams.get('flight_modes_logic') as 'and' | 'or') || 'and',
    droneModelsLogic: (searchParams.get('drone_model_logic') as 'and' | 'or') || 'or',
  }
}

// Parse pagination from URL params
function parsePageFromParams(searchParams: URLSearchParams): number {
  const pageParam = searchParams.get('page')
  const parsed = pageParam ? parseInt(pageParam, 10) : 1
  return isNaN(parsed) || parsed < 1 ? 1 : parsed
}

function parsePerPageFromParams(searchParams: URLSearchParams): 25 | 50 | 100 {
  const perPageParam = searchParams.get('per_page')
  const parsed = perPageParam ? parseInt(perPageParam, 10) : 25
  return VALID_PER_PAGE.includes(parsed as 25 | 50 | 100) ? (parsed as 25 | 50 | 100) : 25
}

function SelectActionsDropdown({
  onSelectFiltered,
  onClearSelection,
}: {
  onSelectFiltered?: () => void
  onClearSelection?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasOptions = !!onSelectFiltered || !!onClearSelection

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!hasOptions}
        className={`p-2 rounded-md border transition-colors ${
          hasOptions
            ? 'border-gray-300 text-gray-600 hover:bg-gray-100'
            : 'border-gray-200 text-gray-300 cursor-not-allowed'
        }`}
        title={hasOptions ? 'Selection actions' : 'Apply filters or select logs to see actions'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
          {onSelectFiltered && (
            <button
              type="button"
              onClick={() => { onSelectFiltered(); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Select filtered
            </button>
          )}
          {onClearSelection && (
            <button
              type="button"
              onClick={() => { onClearSelection(); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function LogListPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [logsData, setLogsData] = useState<PaginatedResponse<FlightLog> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteModalLog, setDeleteModalLog] = useState<FlightLog | null>(null)
  const [parameterModalLog, setParameterModalLog] = useState<FlightLog | null>(null)
  const [editModalLog, setEditModalLog] = useState<FlightLog | null>(null)
  const [uploadingFlightReviewId, setUploadingFlightReviewId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDownloading, setBulkDownloading] = useState(false)

  // Parse state from URL params
  const search = searchParams.get('search') || ''
  const filters = useMemo(() => parseFiltersFromParams(searchParams), [searchParams])
  const page = parsePageFromParams(searchParams)
  const perPage = parsePerPageFromParams(searchParams)

  // Helper to update URL params
  const updateParams = useCallback((updates: Record<string, string | undefined>, resetPage = false) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)

      // Apply updates
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          newParams.delete(key)
        } else {
          newParams.set(key, value)
        }
      }

      // Reset page to 1 when search/filters change
      if (resetPage) {
        newParams.delete('page')
      }

      return newParams
    }, { replace: false }) // Use push for browser history navigation
  }, [setSearchParams])

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getLogs({
        page,
        per_page: perPage,
        search: search || undefined,
        drone_model: filters.droneModels.length > 0 ? filters.droneModels.join(',') : undefined,
        pilot: filters.pilot || undefined,
        tags: filters.tags.length > 0 ? filters.tags.join(',') : undefined,
        flight_modes: filters.flightModes.length > 0 ? filters.flightModes.join(',') : undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        tow_min: filters.towMin ? parseFloat(filters.towMin) : undefined,
        tow_max: filters.towMax ? parseFloat(filters.towMax) : undefined,
        has_attachments: filters.hasAttachments === 'true' ? true : filters.hasAttachments === 'false' ? false : undefined,
        session: filters.session || undefined,
        tags_logic: filters.tagsLogic !== 'and' ? filters.tagsLogic : undefined,
        flight_modes_logic: filters.flightModesLogic !== 'and' ? filters.flightModesLogic : undefined,
        drone_model_logic: filters.droneModelsLogic !== 'or' ? filters.droneModelsLogic : undefined,
      })
      setLogsData(data)
      setSelectedIds(new Set())
    } catch (err) {
      setError('Failed to load flight logs')
      console.error('Error fetching logs:', err)
    } finally {
      setLoading(false)
    }
  }, [page, perPage, search, filters])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSearch = (value: string) => {
    updateParams({ search: value || undefined }, true)
  }

  const handleFilterChange = (newFilters: FilterState) => {
    updateParams({
      date_from: newFilters.dateFrom || undefined,
      date_to: newFilters.dateTo || undefined,
      drone_model: newFilters.droneModels.length > 0 ? newFilters.droneModels.join(',') : undefined,
      pilot: newFilters.pilot || undefined,
      tags: newFilters.tags.length > 0 ? newFilters.tags.join(',') : undefined,
      flight_modes: newFilters.flightModes.length > 0 ? newFilters.flightModes.join(',') : undefined,
      tow_min: newFilters.towMin || undefined,
      tow_max: newFilters.towMax || undefined,
      has_attachments: newFilters.hasAttachments || undefined,
      session: newFilters.session || undefined,
      tags_logic: newFilters.tagsLogic !== 'and' ? newFilters.tagsLogic : undefined,
      flight_modes_logic: newFilters.flightModesLogic !== 'and' ? newFilters.flightModesLogic : undefined,
      drone_model_logic: newFilters.droneModelsLogic !== 'or' ? newFilters.droneModelsLogic : undefined,
    }, true)
  }

  const handleRemoveFilter = (type: keyof FilterState, value?: string) => {
    const newFilters = { ...filters }

    switch (type) {
      case 'dateFrom':
        // Remove both date fields when removing date range chip
        newFilters.dateFrom = ''
        newFilters.dateTo = ''
        break
      case 'dateTo':
        newFilters.dateTo = ''
        break
      case 'droneModels':
        if (value) {
          newFilters.droneModels = filters.droneModels.filter((m) => m !== value)
        }
        break
      case 'pilot':
        newFilters.pilot = ''
        break
      case 'tags':
        if (value) {
          newFilters.tags = filters.tags.filter((t) => t !== value)
        }
        break
      case 'flightModes':
        if (value) {
          newFilters.flightModes = filters.flightModes.filter((m) => m !== value)
        }
        break
      case 'towMin':
        // Remove both TOW fields when removing TOW range chip
        newFilters.towMin = ''
        newFilters.towMax = ''
        break
      case 'towMax':
        newFilters.towMax = ''
        break
      case 'hasAttachments':
        newFilters.hasAttachments = ''
        break
      case 'session':
        newFilters.session = ''
        break
    }

    // Update URL params based on modified filters
    updateParams({
      date_from: newFilters.dateFrom || undefined,
      date_to: newFilters.dateTo || undefined,
      drone_model: newFilters.droneModels.length > 0 ? newFilters.droneModels.join(',') : undefined,
      pilot: newFilters.pilot || undefined,
      tags: newFilters.tags.length > 0 ? newFilters.tags.join(',') : undefined,
      flight_modes: newFilters.flightModes.length > 0 ? newFilters.flightModes.join(',') : undefined,
      tow_min: newFilters.towMin || undefined,
      tow_max: newFilters.towMax || undefined,
      has_attachments: newFilters.hasAttachments || undefined,
      session: newFilters.session || undefined,
      tags_logic: newFilters.tagsLogic !== 'and' ? newFilters.tagsLogic : undefined,
      flight_modes_logic: newFilters.flightModesLogic !== 'and' ? newFilters.flightModesLogic : undefined,
      drone_model_logic: newFilters.droneModelsLogic !== 'or' ? newFilters.droneModelsLogic : undefined,
    }, true)
  }

  const handlePageChange = (newPage: number) => {
    updateParams({ page: newPage > 1 ? String(newPage) : undefined })
  }

  const handlePerPageChange = (newPerPage: 25 | 50 | 100) => {
    updateParams({
      per_page: newPerPage !== 25 ? String(newPerPage) : undefined,
      page: undefined, // Reset to page 1
    })
  }

  const handleDownload = async (log: FlightLog) => {
    try {
      const blob = await downloadLog(log.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${log.log_identifier || log.title.replace(/[^a-zA-Z0-9]/g, '_')}.ulg`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Error downloading log:', err)
      alert('Failed to download log file')
    }
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleToggleAll = () => {
    if (!logsData) return
    const pageIds = logsData.items.map((l) => l.id)
    const allSelected = pageIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) {
        if (allSelected) {
          next.delete(id)
        } else {
          next.add(id)
        }
      }
      return next
    })
  }

  const handleSelectFiltered = async () => {
    try {
      const ids = await getFilteredLogIds({
        search: search || undefined,
        drone_model: filters.droneModels.length > 0 ? filters.droneModels.join(',') : undefined,
        pilot: filters.pilot || undefined,
        tags: filters.tags.length > 0 ? filters.tags.join(',') : undefined,
        flight_modes: filters.flightModes.length > 0 ? filters.flightModes.join(',') : undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        tow_min: filters.towMin ? parseFloat(filters.towMin) : undefined,
        tow_max: filters.towMax ? parseFloat(filters.towMax) : undefined,
        has_attachments: filters.hasAttachments === 'true' ? true : filters.hasAttachments === 'false' ? false : undefined,
        session: filters.session || undefined,
        tags_logic: filters.tagsLogic !== 'and' ? filters.tagsLogic : undefined,
        flight_modes_logic: filters.flightModesLogic !== 'and' ? filters.flightModesLogic : undefined,
        drone_model_logic: filters.droneModelsLogic !== 'or' ? filters.droneModelsLogic : undefined,
      })
      setSelectedIds(new Set(ids))
    } catch (err) {
      console.error('Error selecting filtered logs:', err)
    }
  }

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return
    try {
      setBulkDownloading(true)
      const blob = await bulkDownloadLogs([...selectedIds])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'flight_logs.zip'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Error bulk downloading logs:', err)
      alert('Failed to download logs')
    } finally {
      setBulkDownloading(false)
    }
  }

  const hasActiveFilters =
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    filters.droneModels.length > 0 ||
    filters.pilot !== '' ||
    filters.tags.length > 0 ||
    filters.flightModes.length > 0 ||
    filters.towMin !== '' ||
    filters.towMax !== '' ||
    filters.hasAttachments !== '' ||
    filters.session !== ''

  const handleEdit = (log: FlightLog) => {
    setEditModalLog(log)
  }

  const handleEditModalClose = () => {
    setEditModalLog(null)
  }

  const handleEditSaved = () => {
    setEditModalLog(null)
    fetchLogs() // Refresh the table after successful edit
  }

  const handleDelete = (log: FlightLog) => {
    setDeleteModalLog(log)
  }

  const handleDeleteModalClose = () => {
    setDeleteModalLog(null)
  }

  const handleDeleted = () => {
    setDeleteModalLog(null)
    fetchLogs() // Refresh the table after successful delete
  }

  const handleViewParameters = (log: FlightLog) => {
    setParameterModalLog(log)
  }

  const handleParameterModalClose = () => {
    setParameterModalLog(null)
  }

  const handleOpenFlightReview = async (log: FlightLog) => {
    // If already uploaded, just open the URL
    if (log.flight_review_id) {
      window.open(`http://10.0.0.100:5006/plot_app?log=${log.flight_review_id}`, '_blank')
      return
    }

    // Upload first, then open
    try {
      setUploadingFlightReviewId(log.id)
      const result = await uploadToFlightReview(log.id)
      window.open(result.url, '_blank')
      // Update the log in local state so subsequent clicks don't re-upload
      setLogsData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === log.id ? { ...item, flight_review_id: result.flight_review_id } : item
          ),
        }
      })
    } catch (err) {
      console.error('Error uploading to Flight Review:', err)
      alert('Failed to upload to Flight Review. Please try again.')
    } finally {
      setUploadingFlightReviewId(null)
    }
  }

  return (
    <div className="container mx-auto p-4">
      <StatsHeader />
      <h1 className="text-2xl font-bold mb-4">Flight Logs</h1>

      {/* Search bar and bulk actions */}
      <div className="mb-4 flex items-center gap-3">
        <SearchBar onSearch={handleSearch} initialValue={search} />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleBulkDownload}
            disabled={selectedIds.size === 0 || bulkDownloading}
            title={selectedIds.size === 0 ? 'Select logs using the checkboxes to download' : `Download ${selectedIds.size} selected log(s) as zip`}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md whitespace-nowrap transition-colors ${
              selectedIds.size > 0 && !bulkDownloading
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            {bulkDownloading && (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {bulkDownloading ? 'Zipping...' : `Download${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
          <SelectActionsDropdown
            onSelectFiltered={hasActiveFilters ? handleSelectFiltered : undefined}
            onClearSelection={selectedIds.size > 0 ? () => setSelectedIds(new Set()) : undefined}
          />
        </div>
      </div>

      {/* Active filter chips */}
      <div className="mb-4">
        <ActiveFilterChips filters={filters} onRemoveFilter={handleRemoveFilter} />
      </div>

      {/* Filter panel */}
      <FilterPanel filters={filters} onFilterChange={handleFilterChange} />

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      ) : (
        <>
          <FlightLogTable
            logs={logsData?.items ?? []}
            loading={loading}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onDownload={handleDownload}
            onViewParameters={handleViewParameters}
            onOpenFlightReview={handleOpenFlightReview}
            uploadingFlightReviewId={uploadingFlightReviewId}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleAll={handleToggleAll}
          />

          {/* Pagination */}
          {logsData && logsData.total_pages > 0 && (
            <div className="mt-4">
              <Pagination
                page={page}
                totalPages={logsData.total_pages}
                perPage={perPage}
                onPageChange={handlePageChange}
                onPerPageChange={handlePerPageChange}
              />
            </div>
          )}
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteModalLog && (
        <DeleteConfirmModal
          log={deleteModalLog}
          onClose={handleDeleteModalClose}
          onDeleted={handleDeleted}
        />
      )}

      {/* Parameter viewer modal */}
      {parameterModalLog && (
        <ParameterModal
          logId={parameterModalLog.id}
          logTitle={parameterModalLog.title}
          onClose={handleParameterModalClose}
        />
      )}

      {/* Edit log modal */}
      {editModalLog && (
        <EditLogModal
          log={editModalLog}
          onClose={handleEditModalClose}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  )
}
