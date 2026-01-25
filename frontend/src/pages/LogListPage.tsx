import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import StatsHeader from '../components/StatsHeader'
import FlightLogTable from '../components/FlightLogTable'
import SearchBar from '../components/SearchBar'
import FilterPanel, { type FilterState } from '../components/FilterPanel'
import ActiveFilterChips from '../components/ActiveFilterChips'
import Pagination from '../components/Pagination'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ParameterModal from '../components/ParameterModal'
import { getLogs, downloadLog } from '../api/logs'
import type { FlightLog, PaginatedResponse, DroneModel } from '../types'

const DRONE_MODELS: DroneModel[] = ['XLT', 'S1', 'CX10']
const VALID_PER_PAGE = [25, 50, 100] as const

// Parse URL search params into filter state
function parseFiltersFromParams(searchParams: URLSearchParams): FilterState {
  const droneModelParam = searchParams.get('drone_model')
  const droneModels = droneModelParam
    ? droneModelParam.split(',').filter((m): m is DroneModel => DRONE_MODELS.includes(m as DroneModel))
    : []

  const tagsParam = searchParams.get('tags')
  const tags = tagsParam ? tagsParam.split(',').filter(Boolean) : []

  return {
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
    droneModels,
    pilot: searchParams.get('pilot') || '',
    tags,
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

export default function LogListPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [logsData, setLogsData] = useState<PaginatedResponse<FlightLog> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteModalLog, setDeleteModalLog] = useState<FlightLog | null>(null)
  const [parameterModalLog, setParameterModalLog] = useState<FlightLog | null>(null)

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
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
      })
      setLogsData(data)
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
    }, true)
  }

  const handleRemoveFilter = (type: keyof FilterState, value?: string | DroneModel) => {
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
    }

    // Update URL params based on modified filters
    updateParams({
      date_from: newFilters.dateFrom || undefined,
      date_to: newFilters.dateTo || undefined,
      drone_model: newFilters.droneModels.length > 0 ? newFilters.droneModels.join(',') : undefined,
      pilot: newFilters.pilot || undefined,
      tags: newFilters.tags.length > 0 ? newFilters.tags.join(',') : undefined,
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
      a.download = `${log.title.replace(/[^a-zA-Z0-9]/g, '_')}.ulg`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Error downloading log:', err)
      alert('Failed to download log file')
    }
  }

  const handleEdit = (log: FlightLog) => {
    // Placeholder - will be implemented in US-031 (Edit Log Modal)
    console.log('Edit log:', log.id)
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

  return (
    <div className="container mx-auto p-4">
      <StatsHeader />
      <h1 className="text-2xl font-bold mb-4">Flight Logs</h1>

      {/* Search bar */}
      <div className="mb-4">
        <SearchBar onSearch={handleSearch} initialValue={search} />
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
    </div>
  )
}
