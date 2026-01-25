import { useState, useEffect, useCallback } from 'react'
import { getDroneConnection } from '../lib/droneConnection'
import type { ConnectionState, DroneLogEntry } from '../lib/droneConnection'

interface DroneLogsPanelProps {
  onLogsSelected?: (logs: DroneLogEntry[]) => void
}

// Format bytes to human readable size
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Format UTC timestamp to readable date
function formatDate(utcSeconds: number): string {
  if (utcSeconds === 0) {
    return '--'
  }
  const date = new Date(utcSeconds * 1000)
  return date.toISOString().split('T')[0]
}

export default function DroneLogsPanel({ onLogsSelected }: DroneLogsPanelProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [logs, setLogs] = useState<DroneLogEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connection = getDroneConnection()

  // Track connection state
  useEffect(() => {
    const originalHandlers = { ...connection }

    // Update state change handler to track connection
    const originalOnStateChange = connection['events']?.onStateChange
    connection.setEventHandlers({
      ...connection['events'],
      onStateChange: (state) => {
        originalOnStateChange?.(state)
        setConnectionState(state)
        if (state === 'disconnected') {
          setLogs([])
          setSelectedIds(new Set())
          setError(null)
        }
      },
    })

    // Sync initial state
    setConnectionState(connection.state)

    return () => {
      // Cleanup not strictly needed for singleton
    }
  }, [connection])

  // Fetch logs from drone
  const fetchLogs = useCallback(async () => {
    if (connection.state !== 'connected') {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const droneLogList = await connection.requestLogList()
      setLogs(droneLogList)
      // Clear selection when refreshing
      setSelectedIds(new Set())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [connection])

  // Fetch logs when connection established
  useEffect(() => {
    if (connectionState === 'connected' && logs.length === 0 && !loading) {
      fetchLogs()
    }
  }, [connectionState, logs.length, loading, fetchLogs])

  // Notify parent when selection changes
  useEffect(() => {
    if (onLogsSelected) {
      const selectedLogs = logs.filter((log) => selectedIds.has(log.id))
      onLogsSelected(selectedLogs)
    }
  }, [selectedIds, logs, onLogsSelected])

  // Don't render if not connected
  if (connectionState !== 'connected') {
    return null
  }

  const handleSelectAll = () => {
    setSelectedIds(new Set(logs.map((log) => log.id)))
  }

  const handleDeselectAll = () => {
    setSelectedIds(new Set())
  }

  const handleToggleLog = (logId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(logId)) {
        next.delete(logId)
      } else {
        next.add(logId)
      }
      return next
    })
  }

  const allSelected = logs.length > 0 && selectedIds.size === logs.length
  const noneSelected = selectedIds.size === 0

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900">
          Drone Logs
          {logs.length > 0 && (
            <span className="ml-2 text-gray-500">({logs.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {/* Select All / Deselect All buttons */}
          <button
            onClick={handleSelectAll}
            disabled={loading || logs.length === 0 || allSelected}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Select All
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={handleDeselectAll}
            disabled={loading || noneSelected}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Deselect All
          </button>

          {/* Refresh button */}
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-1 text-gray-500 hover:text-gray-700 disabled:text-gray-300 disabled:cursor-not-allowed"
            title="Refresh log list"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && logs.length === 0 && (
        <div className="px-4 py-8 text-center">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm">Fetching logs from drone...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && logs.length === 0 && !error && (
        <div className="px-4 py-8 text-center text-gray-500 text-sm">
          No logs found on drone
        </div>
      )}

      {/* Log list table */}
      {logs.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 text-left">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Size
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.map((log, index) => (
                <tr
                  key={log.id}
                  className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${
                    selectedIds.has(log.id) ? 'bg-blue-50' : ''
                  } hover:bg-blue-50 cursor-pointer`}
                  onClick={() => handleToggleLog(log.id)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(log.id)}
                      onChange={() => handleToggleLog(log.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                    {log.id}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(log.timeUtc)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                    {formatSize(log.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Selection count footer */}
      {logs.length > 0 && selectedIds.size > 0 && (
        <div className="bg-blue-50 border-t border-blue-200 px-4 py-2 text-sm text-blue-700">
          {selectedIds.size} log{selectedIds.size !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  )
}
