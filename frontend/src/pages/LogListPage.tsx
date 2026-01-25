import { useEffect, useState, useCallback } from 'react'
import StatsHeader from '../components/StatsHeader'
import FlightLogTable from '../components/FlightLogTable'
import SearchBar from '../components/SearchBar'
import FilterPanel, { type FilterState } from '../components/FilterPanel'
import ActiveFilterChips from '../components/ActiveFilterChips'
import Pagination from '../components/Pagination'
import { getLogs, downloadLog } from '../api/logs'
import type { FlightLog, PaginatedResponse, DroneModel } from '../types'

const initialFilterState: FilterState = {
  dateFrom: '',
  dateTo: '',
  droneModels: [],
  pilot: '',
  tags: [],
}

export default function LogListPage() {
  const [logsData, setLogsData] = useState<PaginatedResponse<FlightLog> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search and filter state
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterState>(initialFilterState)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<25 | 50 | 100>(25)

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

  // Reset to page 1 when search or filters change
  useEffect(() => {
    setPage(1)
  }, [search, filters])

  const handleSearch = (value: string) => {
    setSearch(value)
  }

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters)
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

    setFilters(newFilters)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const handlePerPageChange = (newPerPage: 25 | 50 | 100) => {
    setPerPage(newPerPage)
    setPage(1) // Reset to page 1 when changing per page
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
    // Placeholder - will be implemented in US-024 (Delete Confirmation Modal)
    console.log('Delete log:', log.id)
  }

  const handleViewParameters = (log: FlightLog) => {
    // Placeholder - will be implemented in US-025 (Parameter Viewer Modal)
    console.log('View parameters:', log.id)
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
    </div>
  )
}
