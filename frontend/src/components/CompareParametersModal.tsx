import { useEffect, useState, useMemo } from 'react'
import { getParameters, type ParameterData } from '../api/logs'
import type { FlightLog } from '../types'

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return parseFloat(value.toFixed(6)).toString()
    }
  }
  return String(value)
}

interface CompareParametersModalProps {
  logs: FlightLog[]
  onClose: () => void
}

type FilterMode = 'all' | 'differences'

export default function CompareParametersModal({ logs, onClose }: CompareParametersModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allParams, setAllParams] = useState<Map<string, Record<string, ParameterData>>>(new Map())
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  useEffect(() => {
    async function fetchAll() {
      try {
        setLoading(true)
        const results = await Promise.all(
          logs.map(async (log) => {
            const params = await getParameters(log.id)
            return { id: log.id, params }
          })
        )
        const map = new Map<string, Record<string, ParameterData>>()
        for (const { id, params } of results) {
          map.set(id, params)
        }
        setAllParams(map)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch parameters')
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [logs])

  // Collect all unique parameter names
  const allParamNames = useMemo(() => {
    const names = new Set<string>()
    for (const params of allParams.values()) {
      for (const name of Object.keys(params)) {
        names.add(name)
      }
    }
    return Array.from(names).sort()
  }, [allParams])

  // Check if a parameter row has different values across logs
  const hasDifference = (paramName: string): boolean => {
    const values: string[] = []
    for (const params of allParams.values()) {
      const p = params[paramName]
      values.push(p ? formatValue(p.value) : '')
    }
    return new Set(values).size > 1
  }

  // Filtered parameter names
  const filteredParams = useMemo(() => {
    let names = allParamNames
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      names = names.filter((n) => n.toLowerCase().includes(term))
    }
    if (filterMode === 'differences') {
      names = names.filter(hasDifference)
    }
    return names
  }, [allParamNames, searchTerm, filterMode, allParams])

  const diffCount = useMemo(() => allParamNames.filter(hasDifference).length, [allParamNames, allParams])

  const getLogLabel = (log: FlightLog) => log.log_identifier || log.title

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      <div className="flex items-start justify-center min-h-screen p-4 pt-12">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Compare Parameters</h3>
              <p className="text-sm text-gray-500 mt-1">
                {logs.length} logs &middot; {allParamNames.length} parameters &middot; {diffCount} difference{diffCount !== 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Controls */}
          <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-4 flex-shrink-0">
            <input
              type="text"
              placeholder="Search parameters..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
            <div className="inline-flex rounded-md text-sm font-medium">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-l border ${
                  filterMode === 'all'
                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                All ({allParamNames.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('differences')}
                className={`px-3 py-1.5 rounded-r border-t border-r border-b ${
                  filterMode === 'differences'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Differences ({diffCount})
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="ml-3 text-gray-500">Loading parameters...</span>
              </div>
            ) : error ? (
              <div className="p-6 text-center text-red-600">{error}</div>
            ) : filteredParams.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {searchTerm || filterMode === 'differences' ? 'No matching parameters' : 'No parameters found'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">
                      Parameter
                    </th>
                    {logs.map((log) => (
                      <th key={log.id} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider max-w-48">
                        <div className="truncate" title={getLogLabel(log)}>
                          {getLogLabel(log)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredParams.map((paramName) => {
                    const isDiff = hasDifference(paramName)
                    return (
                      <tr key={paramName} className={isDiff ? 'bg-amber-50' : ''}>
                        <td className="px-4 py-1.5 font-mono text-xs whitespace-nowrap sticky left-0 bg-inherit z-10">
                          {paramName}
                        </td>
                        {logs.map((log) => {
                          const params = allParams.get(log.id)
                          const p = params?.[paramName]
                          const val = p ? formatValue(p.value) : '-'
                          // Highlight cells that differ from the first log's value
                          const firstParams = allParams.get(logs[0].id)
                          const firstVal = firstParams?.[paramName] ? formatValue(firstParams[paramName].value) : '-'
                          const cellDiffers = isDiff && val !== firstVal
                          return (
                            <td
                              key={log.id}
                              className={`px-4 py-1.5 font-mono text-xs whitespace-nowrap ${
                                cellDiffers ? 'text-amber-800 font-semibold' : 'text-gray-700'
                              }`}
                            >
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
