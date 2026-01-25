import { useEffect, useState } from 'react'
import StatsHeader from '../components/StatsHeader'
import FlightLogTable from '../components/FlightLogTable'
import { getLogs, downloadLog } from '../api/logs'
import type { FlightLog, PaginatedResponse } from '../types'

export default function LogListPage() {
  const [logsData, setLogsData] = useState<PaginatedResponse<FlightLog> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchLogs() {
      try {
        setLoading(true)
        setError(null)
        const data = await getLogs()
        setLogsData(data)
      } catch (err) {
        setError('Failed to load flight logs')
        console.error('Error fetching logs:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [])

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

  return (
    <div className="container mx-auto p-4">
      <StatsHeader />
      <h1 className="text-2xl font-bold mb-4">Flight Logs</h1>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      ) : (
        <FlightLogTable
          logs={logsData?.items ?? []}
          loading={loading}
          onDownload={handleDownload}
        />
      )}
    </div>
  )
}
