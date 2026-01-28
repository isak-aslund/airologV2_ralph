import { useEffect, useState } from 'react'
import { fetchWeatherApi } from 'openmeteo'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface WeatherModalProps {
  lat: number
  lon: number
  date: string // ISO date string
  logTitle: string
  onClose: () => void
}

interface WeatherData {
  time: Date
  timeLabel: string
  wind_speed_10m: number | null
  wind_gusts_10m: number | null
  wind_speed_80m: number | null
  temperature_2m: number | null
}

function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function WeatherModal({ lat, lon, date, logTitle, onClose }: WeatherModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weatherData, setWeatherData] = useState<WeatherData[]>([])
  const [units] = useState({ wind: 'm/s', temp: '°C' })
  const [resolution, setResolution] = useState<'15min' | 'hourly'>('15min')

  // Format date to YYYY-MM-DD
  const formattedDate = new Date(date).toISOString().split('T')[0]

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true)
        setError(null)

        // Try historical forecast API first (supports minutely_15 for recent past dates)
        const params = {
          latitude: lat,
          longitude: lon,
          start_date: formattedDate,
          end_date: formattedDate,
          minutely_15: ['temperature_2m', 'wind_speed_10m', 'wind_speed_80m', 'wind_gusts_10m'],
          wind_speed_unit: 'ms',
        }

        let transformed: WeatherData[] = []
        let success = false

        // Try historical forecast API first
        try {
          const responses = await fetchWeatherApi(
            'https://historical-forecast-api.open-meteo.com/v1/forecast',
            params
          )

          const response = responses[0]
          const minutely15 = response.minutely15()

          if (minutely15) {
            const utcOffsetSeconds = response.utcOffsetSeconds()
            const timeStart = Number(minutely15.time())
            const timeEnd = Number(minutely15.timeEnd())
            const interval = minutely15.interval()

            const times = Array.from(
              { length: (timeEnd - timeStart) / interval },
              (_, i) => new Date((timeStart + i * interval + utcOffsetSeconds) * 1000)
            )

            const temperature = minutely15.variables(0)!.valuesArray()!
            const windSpeed10m = minutely15.variables(1)!.valuesArray()!
            const windSpeed80m = minutely15.variables(2)!.valuesArray()!
            const windGusts10m = minutely15.variables(3)!.valuesArray()!

            transformed = times.map((time, i) => ({
              time,
              timeLabel: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              temperature_2m: temperature[i],
              wind_speed_10m: windSpeed10m[i],
              wind_speed_80m: windSpeed80m[i],
              wind_gusts_10m: windGusts10m[i],
            }))

            setResolution('15min')
            success = true
          }
        } catch (e) {
          console.log('Historical forecast API failed, trying archive API...', e)
        }

        // Fall back to archive API for older dates
        if (!success) {
          const archiveParams = {
            latitude: lat,
            longitude: lon,
            start_date: formattedDate,
            end_date: formattedDate,
            hourly: ['temperature_2m', 'wind_speed_10m', 'wind_speed_80m', 'wind_gusts_10m'],
            wind_speed_unit: 'ms',
          }

          const responses = await fetchWeatherApi(
            'https://archive-api.open-meteo.com/v1/archive',
            archiveParams
          )

          const response = responses[0]
          const hourly = response.hourly()

          if (hourly) {
            const utcOffsetSeconds = response.utcOffsetSeconds()
            const timeStart = Number(hourly.time())
            const timeEnd = Number(hourly.timeEnd())
            const interval = hourly.interval()

            const times = Array.from(
              { length: (timeEnd - timeStart) / interval },
              (_, i) => new Date((timeStart + i * interval + utcOffsetSeconds) * 1000)
            )

            const temperature = hourly.variables(0)!.valuesArray()!
            const windSpeed10m = hourly.variables(1)!.valuesArray()!
            const windSpeed80m = hourly.variables(2)!.valuesArray()!
            const windGusts10m = hourly.variables(3)!.valuesArray()!

            transformed = times.map((time, i) => ({
              time,
              timeLabel: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              temperature_2m: temperature[i],
              wind_speed_10m: windSpeed10m[i],
              wind_speed_80m: windSpeed80m[i],
              wind_gusts_10m: windGusts10m[i],
            }))

            setResolution('hourly')
            success = true
          }
        }

        if (!success || transformed.length === 0) {
          throw new Error('No weather data available for this date')
        }

        setWeatherData(transformed)
      } catch (err) {
        console.error('Error fetching weather:', err)
        setError('Failed to load weather data. The date might be outside the available range.')
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
  }, [lat, lon, formattedDate])

  const openMeteoUrl = `https://open-meteo.com/en/docs/historical-forecast-api?latitude=${lat}&longitude=${lon}&start_date=${formattedDate}&end_date=${formattedDate}&minutely_15=temperature_2m,wind_speed_10m,wind_speed_80m,wind_gusts_10m&wind_speed_unit=ms`

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Historical Weather
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {logTitle} - {formatDateDisplay(date)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Location: {lat.toFixed(4)}, {lon.toFixed(4)}
                {!loading && !error && (
                  <span className="ml-2">({resolution === '15min' ? '15-minute' : 'hourly'} data)</span>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
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
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Wind Chart */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Wind Speed ({units.wind})
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={weatherData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="timeLabel"
                          tick={{ fontSize: 10 }}
                          stroke="#9ca3af"
                          interval={resolution === '15min' ? 7 : 1}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          label={{ value: units.wind, angle: -90, position: 'insideLeft', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number) => [`${value?.toFixed(1)} ${units.wind}`, '']}
                          labelFormatter={(label) => `Time: ${label}`}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Line
                          type="monotone"
                          dataKey="wind_speed_10m"
                          name="Wind 10m"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="wind_gusts_10m"
                          name="Gusts 10m"
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="wind_speed_80m"
                          name="Wind 80m"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Temperature Chart */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Temperature ({units.temp})
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={weatherData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="timeLabel"
                          tick={{ fontSize: 10 }}
                          stroke="#9ca3af"
                          interval={resolution === '15min' ? 7 : 1}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          label={{ value: units.temp, angle: -90, position: 'insideLeft', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number) => [`${value?.toFixed(1)}${units.temp}`, 'Temperature']}
                          labelFormatter={(label) => `Time: ${label}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="temperature_2m"
                          name="Temperature"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <a
              href={openMeteoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <span>View on Open-Meteo</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
