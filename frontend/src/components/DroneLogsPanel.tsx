import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDroneConnection } from '../lib/droneConnection'
import type { ConnectionState, DroneLogEntry, DownloadProgress, DownloadedLog } from '../lib/droneConnection'

interface DroneLogsPanelProps {
  onLogsSelected?: (logs: DroneLogEntry[]) => void
  onLogsDownloaded?: (logs: DownloadedLog[]) => void
}

// Download state for tracking multiple log downloads
interface DownloadState {
  isDownloading: boolean
  currentLogId: number | null
  currentProgress: DownloadProgress | null
  completedCount: number
  totalCount: number
  downloadedLogs: DownloadedLog[]
  error: string | null
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

export default function DroneLogsPanel({ onLogsSelected, onLogsDownloaded }: DroneLogsPanelProps) {
  const navigate = useNavigate()
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [droneSysId, setDroneSysId] = useState<number | null>(null)
  const [logs, setLogs] = useState<DroneLogEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadState, setDownloadState] = useState<DownloadState>({
    isDownloading: false,
    currentLogId: null,
    currentProgress: null,
    completedCount: 0,
    totalCount: 0,
    downloadedLogs: [],
    error: null,
  })

  const connection = getDroneConnection()

  // Track connection state and heartbeat
  useEffect(() => {
    // Update state change handler to track connection
    const originalOnStateChange = connection['events']?.onStateChange
    const originalOnHeartbeat = connection['events']?.onHeartbeat
    connection.setEventHandlers({
      ...connection['events'],
      onStateChange: (state) => {
        originalOnStateChange?.(state)
        setConnectionState(state)
        if (state === 'disconnected') {
          setLogs([])
          setSelectedIds(new Set())
          setError(null)
          setDroneSysId(null)
        }
      },
      onHeartbeat: (heartbeat, sysId) => {
        originalOnHeartbeat?.(heartbeat, sysId)
        // Update drone system ID when heartbeat received
        if (droneSysId === null) {
          console.log('[DroneLogsPanel] Got heartbeat, setting sysId:', sysId)
          setDroneSysId(sysId)
        }
      },
    })

    // Sync initial state
    setConnectionState(connection.state)
    setDroneSysId(connection.droneSysId)

    return () => {
      // Cleanup not strictly needed for singleton
    }
  }, [connection, droneSysId])

  // Fetch logs from drone
  const fetchLogs = useCallback(async () => {
    console.log('[DroneLogsPanel] fetchLogs called, connection.state:', connection.state)
    if (connection.state !== 'connected') {
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('[DroneLogsPanel] Requesting log list...')
      const droneLogList = await connection.requestLogList()
      console.log('[DroneLogsPanel] Got', droneLogList.length, 'logs')
      setLogs(droneLogList)
      // Clear selection when refreshing
      setSelectedIds(new Set())
    } catch (err) {
      console.error('[DroneLogsPanel] Error fetching logs:', err)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [connection])

  // Fetch logs when connection established AND we have the drone system ID (heartbeat received)
  useEffect(() => {
    if (connectionState === 'connected' && logs.length === 0 && !loading && droneSysId !== null) {
      console.log('[DroneLogsPanel] Connection ready with sysId:', droneSysId, '- fetching logs')
      fetchLogs()
    }
  }, [connectionState, logs.length, loading, fetchLogs, droneSysId])

  // Notify parent when selection changes
  useEffect(() => {
    if (onLogsSelected) {
      const selectedLogs = logs.filter((log) => selectedIds.has(log.id))
      onLogsSelected(selectedLogs)
    }
  }, [selectedIds, logs, onLogsSelected])

  // Download selected logs from drone
  const handleDownloadSelected = useCallback(async () => {
    const selectedLogs = logs.filter((log) => selectedIds.has(log.id))
    if (selectedLogs.length === 0) return

    setDownloadState({
      isDownloading: true,
      currentLogId: null,
      currentProgress: null,
      completedCount: 0,
      totalCount: selectedLogs.length,
      downloadedLogs: [],
      error: null,
    })

    const downloadedLogs: DownloadedLog[] = []

    for (let i = 0; i < selectedLogs.length; i++) {
      const logEntry = selectedLogs[i]

      setDownloadState((prev) => ({
        ...prev,
        currentLogId: logEntry.id,
        currentProgress: {
          logId: logEntry.id,
          bytesReceived: 0,
          totalBytes: logEntry.size,
          percent: 0,
        },
      }))

      try {
        const downloadedLog = await connection.downloadLog(logEntry, (progress) => {
          setDownloadState((prev) => ({
            ...prev,
            currentProgress: progress,
          }))
        })

        downloadedLogs.push(downloadedLog)

        setDownloadState((prev) => ({
          ...prev,
          completedCount: i + 1,
          downloadedLogs: [...prev.downloadedLogs, downloadedLog],
        }))
      } catch (err) {
        setDownloadState((prev) => ({
          ...prev,
          isDownloading: false,
          error: `Failed to download log ${logEntry.id}: ${(err as Error).message}`,
        }))
        return
      }
    }

    // All downloads completed
    setDownloadState((prev) => ({
      ...prev,
      isDownloading: false,
      currentLogId: null,
      currentProgress: null,
    }))

    // Notify parent of downloaded logs and clear state if callback provided
    if (onLogsDownloaded && downloadedLogs.length > 0) {
      onLogsDownloaded(downloadedLogs)
      // Clear selection and downloaded logs since they've been passed to parent
      setSelectedIds(new Set())
      setDownloadState((prev) => ({
        ...prev,
        downloadedLogs: [],
      }))
    }
  }, [logs, selectedIds, connection, onLogsDownloaded])

  // Sort logs by date (most recent first)
  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => b.timeUtc - a.timeUtc)
  }, [logs])

  // Navigate to upload page with downloaded log
  const handleUploadLog = useCallback((downloadedLog: DownloadedLog) => {
    // Generate a filename for the blob based on log ID and timestamp
    // Format: log_ID_YYYY-MM-DD-HH-MM-SS.ulg (backend expects full timestamp for date extraction)
    const date = new Date(downloadedLog.timeUtc > 0 ? downloadedLog.timeUtc * 1000 : Date.now())
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    const filename = `log_${downloadedLog.id}_${year}-${month}-${day}-${hours}-${minutes}-${seconds}.ulg`

    // Navigate to upload page with the downloaded log data
    navigate('/upload', {
      state: {
        droneLog: {
          blob: downloadedLog.blob,
          filename,
          logId: downloadedLog.id,
          timeUtc: downloadedLog.timeUtc,
        }
      }
    })
  }, [navigate])

  // Don't render if not connected
  if (connectionState !== 'connected') {
    console.log('[DroneLogsPanel] Not rendering - connectionState:', connectionState)
    return null
  }
  console.log('[DroneLogsPanel] Rendering - connected, logs:', logs.length, 'loading:', loading)

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

          {/* Download Selected button */}
          <button
            onClick={handleDownloadSelected}
            disabled={loading || noneSelected || downloadState.isDownloading}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Selected
          </button>

          {/* Refresh button */}
          <button
            onClick={fetchLogs}
            disabled={loading || downloadState.isDownloading}
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

      {/* Download error message */}
      {downloadState.error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {downloadState.error}
        </div>
      )}

      {/* Download progress bar */}
      {downloadState.isDownloading && downloadState.currentProgress && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-blue-700 mb-2">
            <span>
              Downloading log {downloadState.currentLogId}
              {downloadState.totalCount > 1 && (
                <span className="text-blue-500">
                  {' '}({downloadState.completedCount + 1} of {downloadState.totalCount})
                </span>
              )}
            </span>
            <span>
              {formatSize(downloadState.currentProgress.bytesReceived)} / {formatSize(downloadState.currentProgress.totalBytes)}
            </span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-150"
              style={{ width: `${downloadState.currentProgress.percent}%` }}
            />
          </div>
          <div className="text-xs text-blue-600 mt-1 text-right">
            {downloadState.currentProgress.percent}%
          </div>
        </div>
      )}

      {/* Download complete notification with Upload buttons */}
      {!downloadState.isDownloading && downloadState.downloadedLogs.length > 0 && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-green-700 mb-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            {downloadState.downloadedLogs.length} log{downloadState.downloadedLogs.length !== 1 ? 's' : ''} downloaded successfully
          </div>
          {/* Upload buttons for each downloaded log */}
          <div className="flex flex-wrap gap-2">
            {downloadState.downloadedLogs.map((log) => (
              <button
                key={log.id}
                onClick={() => handleUploadLog(log)}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Upload Log {log.id}
              </button>
            ))}
          </div>
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
              {sortedLogs.map((log, index) => (
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
