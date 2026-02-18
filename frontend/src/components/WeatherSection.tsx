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
  ReferenceArea,
} from 'recharts'

interface WeatherSectionProps {
  lat: number
  lon: number
  date: string
  durationSeconds: number | null
}

interface WeatherData {
  time: Date
  timeLabel: string
  wind_speed_10m: number | null
  wind_gusts_10m: number | null
  wind_speed_80m: number | null
  temperature_2m: number | null
}

const UNITS = { wind: 'm/s', temp: '\u00B0C' }

export default function WeatherSection({ lat, lon, date, durationSeconds }: WeatherSectionProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weatherData, setWeatherData] = useState<WeatherData[]>([])
  const [resolution, setResolution] = useState<'15min' | 'hourly'>('15min')

  const formattedDate = new Date(date).toISOString().split('T')[0]

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true)
        setError(null)

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

  const flightRange = (() => {
    if (!durationSeconds || weatherData.length === 0) return null
    const flightStart = new Date(date)
    if (isNaN(flightStart.getTime())) return null
    if (date.length <= 10) return null

    const flightStartMs = flightStart.getTime()
    const flightEndMs = flightStartMs + durationSeconds * 1000

    let startIdx = -1
    let endIdx = -1
    for (let i = 0; i < weatherData.length; i++) {
      const t = weatherData[i].time.getTime()
      if (t <= flightStartMs) startIdx = i
      if (t <= flightEndMs) endIdx = i
    }
    if (startIdx === -1) startIdx = 0
    if (endIdx === -1) endIdx = weatherData.length - 1
    if (endIdx < weatherData.length - 1) endIdx++

    if (startIdx > endIdx) return null
    return { x1: weatherData[startIdx].timeLabel, x2: weatherData[endIdx].timeLabel }
  })()

  const openMeteoUrl = `https://open-meteo.com/en/docs/historical-forecast-api?latitude=${lat}&longitude=${lon}&start_date=${formattedDate}&end_date=${formattedDate}&minutely_15=temperature_2m,wind_speed_10m,wind_speed_80m,wind_gusts_10m&wind_speed_unit=ms`

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg className="animate-spin h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="ml-2 text-sm text-gray-500">Loading weather data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        {resolution === '15min' ? '15-minute' : 'Hourly'} data from{' '}
        <a
          href={openMeteoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700"
        >
          Open-Meteo
        </a>
      </p>

      {/* Wind Chart */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Wind Speed ({UNITS.wind})</h4>
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
                label={{ value: UNITS.wind, angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                formatter={(value) => [`${(value as number)?.toFixed(1)} ${UNITS.wind}`, '']}
                labelFormatter={(label) => `Time: ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {flightRange && (
                <ReferenceArea
                  x1={flightRange.x1}
                  x2={flightRange.x2}
                  fill="#3b82f6"
                  fillOpacity={0.08}
                  stroke="#3b82f6"
                  strokeOpacity={0.3}
                  strokeDasharray="4 2"
                  label={{ value: 'Flight', position: 'insideTop', fontSize: 10, fill: '#3b82f6' }}
                />
              )}
              <Line type="monotone" dataKey="wind_speed_10m" name="Wind 10m" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="wind_gusts_10m" name="Gusts 10m" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="wind_speed_80m" name="Wind 80m" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Temperature Chart */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Temperature ({UNITS.temp})</h4>
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
                label={{ value: UNITS.temp, angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                formatter={(value) => [`${(value as number)?.toFixed(1)}${UNITS.temp}`, 'Temperature']}
                labelFormatter={(label) => `Time: ${label}`}
              />
              {flightRange && (
                <ReferenceArea
                  x1={flightRange.x1}
                  x2={flightRange.x2}
                  fill="#3b82f6"
                  fillOpacity={0.08}
                  stroke="#3b82f6"
                  strokeOpacity={0.3}
                  strokeDasharray="4 2"
                />
              )}
              <Line type="monotone" dataKey="temperature_2m" name="Temperature" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
