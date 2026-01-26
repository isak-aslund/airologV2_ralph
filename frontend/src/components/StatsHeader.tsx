import { useEffect, useState } from 'react'
import { getStats } from '../api/stats'
import type { Stats, DroneModel } from '../types'

const DRONE_MODELS: DroneModel[] = ['XLT', 'S1', 'CX10']

function formatHours(hours: number): string {
  return hours.toFixed(1)
}

function StatsSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-6 sm:items-center sm:justify-between">
        {/* Total stats skeleton */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
          <div>
            <div className="h-4 w-20 bg-gray-200 rounded mb-2" />
            <div className="h-8 w-16 bg-gray-200 rounded" />
          </div>
          <div>
            <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-8 w-20 bg-gray-200 rounded" />
          </div>
        </div>
        {/* Drone models skeleton */}
        <div className="flex flex-wrap gap-4 sm:gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gray-200 rounded" />
              <div>
                <div className="h-3 w-8 bg-gray-200 rounded mb-1" />
                <div className="h-5 w-12 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function StatsHeader() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true)
        setError(null)
        const data = await getStats()
        setStats(data)
      } catch (err) {
        setError('Failed to load statistics')
        console.error('Error fetching stats:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading) {
    return <StatsSkeleton />
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!stats) {
    return null
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-6 sm:items-center sm:justify-between">
        {/* Total stats */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Flights</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total_flights}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Flight Hours</p>
            <p className="text-2xl font-bold text-gray-900">{formatHours(stats.total_hours)} hrs</p>
          </div>
        </div>
        {/* Hours by model with drone thumbnails */}
        <div className="flex flex-wrap gap-4 sm:gap-6">
          {Object.entries(stats.hours_by_model).map(([model, hours]) => (
            <div key={model} className="flex items-center gap-2">
              {/* Show image for known models, icon for custom models */}
              {DRONE_MODELS.includes(model as DroneModel) ? (
                <img
                  src={`/img/${model}.png`}
                  alt={`${model} drone`}
                  className="w-10 h-10 object-contain"
                />
              ) : (
                <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 font-medium">{model}</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatHours(hours)} hrs
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
