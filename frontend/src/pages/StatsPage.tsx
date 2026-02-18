import { useEffect, useState } from 'react'
import { getPilotStats, getRecords } from '../api/stats'
import type { PilotStatsResponse, RecordsResponse } from '../types'

const AUTOSTART_TO_MODEL: Record<string, string> = {
  '4006': 'XLT',
  '4010': 'S1',
  '4030': 'CX10',
}

function formatDroneModel(autostart: string): string {
  const name = AUTOSTART_TO_MODEL[autostart]
  return name ? `${autostart} [${name}]` : autostart
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatHours(hours: number): string {
  return hours.toFixed(1)
}

export default function StatsPage() {
  const [pilotStats, setPilotStats] = useState<PilotStatsResponse | null>(null)
  const [records, setRecords] = useState<RecordsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)
        setError(null)
        const [pilots, recs] = await Promise.all([getPilotStats(), getRecords()])
        setPilotStats(pilots)
        setRecords(recs)
      } catch (err) {
        setError('Failed to load statistics')
        console.error('Error fetching stats:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Pilot Stats & Records</h1>
        <div className="animate-pulse space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="h-6 w-48 bg-gray-200 rounded mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded" />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-lg shadow p-6">
                <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
                <div className="h-8 w-20 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  const pilots = pilotStats?.pilots ?? []

  // Collect all unique models across all pilots for table columns
  const allModels = Array.from(
    new Set(pilots.flatMap((p) => Object.keys(p.hours_by_model)))
  ).sort()

  // Find the max hours for bar scaling
  const maxModelHours = Math.max(
    ...pilots.flatMap((p) => Object.values(p.hours_by_model)),
    0.1
  )

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Pilot Stats & Records</h1>

      {/* Pilot Leaderboard */}
      <div className="bg-white rounded-lg shadow mb-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Pilot Leaderboard</h2>
        </div>
        {pilots.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">No flight data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Pilot</th>
                  <th className="px-6 py-3 text-right">Flights</th>
                  <th className="px-6 py-3 text-right">Total Hours</th>
                  <th className="px-6 py-3">Hours by Model</th>
                  <th className="px-6 py-3 text-right">Longest Flight</th>
                  <th className="px-6 py-3 text-right">Last Flight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pilots.map((p, idx) => (
                  <tr key={p.pilot} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-400 font-medium">{idx + 1}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">{p.pilot}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{p.total_flights}</td>
                    <td className="px-6 py-4 text-right text-gray-700 font-medium">
                      {formatHours(p.total_hours)} hrs
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 min-w-[160px]">
                        {allModels.map((model) => {
                          const hrs = p.hours_by_model[model] ?? 0
                          if (hrs === 0) return null
                          const pct = (hrs / maxModelHours) * 100
                          return (
                            <div key={model} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20 truncate" title={formatDroneModel(model)}>
                                {formatDroneModel(model)}
                              </span>
                              <div className="flex-1 bg-gray-100 rounded-full h-2 max-w-[100px]">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{ width: `${Math.max(pct, 2)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 w-12 text-right">
                                {formatHours(hrs)}h
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-700">
                      {formatDuration(p.longest_flight_seconds)}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-500">
                      {formatDate(p.most_recent_flight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Records & Streaks */}
      {records && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Records & Streaks</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Longest Flight Ever */}
            {records.longest_flight && (
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm font-medium text-gray-500 mb-1">Longest Flight Ever</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatDuration(records.longest_flight.duration_seconds)}
                </p>
                <div className="mt-2 text-sm text-gray-600 space-y-0.5">
                  <p>Pilot: <span className="font-medium">{records.longest_flight.pilot}</span></p>
                  <p>Model: <span className="font-medium">{formatDroneModel(records.longest_flight.drone_model)}</span></p>
                  <p>Date: {formatDate(records.longest_flight.flight_date)}</p>
                </div>
              </div>
            )}

            {/* Busiest Day */}
            {records.most_flights_in_a_day && (
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm font-medium text-gray-500 mb-1">Busiest Day</p>
                <p className="text-2xl font-bold text-gray-900">
                  {records.most_flights_in_a_day.flight_count} flights
                </p>
                <div className="mt-2 text-sm text-gray-600 space-y-0.5">
                  <p>Date: {formatDate(records.most_flights_in_a_day.date)}</p>
                  <p>Pilots: <span className="font-medium">{records.most_flights_in_a_day.pilots.join(', ')}</span></p>
                </div>
              </div>
            )}

            {/* Busiest Week */}
            {records.busiest_week && (
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm font-medium text-gray-500 mb-1">Busiest Week</p>
                <p className="text-2xl font-bold text-gray-900">
                  {records.busiest_week.flight_count} flights
                </p>
                <div className="mt-2 text-sm text-gray-600">
                  <p>Week of {formatDate(records.busiest_week.week_start)}</p>
                </div>
              </div>
            )}

            {/* Current Streak */}
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm font-medium text-gray-500 mb-1">Current Streak</p>
              <p className="text-2xl font-bold text-gray-900">
                {records.current_streak_days} day{records.current_streak_days !== 1 ? 's' : ''}
              </p>
              <p className="mt-2 text-sm text-gray-600">Consecutive days with flights</p>
            </div>

            {/* Total Flight Days */}
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm font-medium text-gray-500 mb-1">Total Flight Days</p>
              <p className="text-2xl font-bold text-gray-900">{records.total_flight_days}</p>
              <p className="mt-2 text-sm text-gray-600">Unique days with at least one flight</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
