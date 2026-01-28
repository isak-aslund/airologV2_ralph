import { useEffect, useState, useMemo } from 'react'
import { getParameters, type ParameterData } from '../api/logs'

/**
 * Format parameter value for display.
 * Rounds floats to reasonable precision.
 */
function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    // Round floats to 6 decimal places max, remove trailing zeros
    if (!Number.isInteger(value)) {
      return parseFloat(value.toFixed(6)).toString()
    }
  }
  return String(value)
}

interface ParameterModalProps {
  logId: string
  logTitle: string
  onClose: () => void
}

type FilterMode = 'all' | 'modified'

export default function ParameterModal({ logId, logTitle, onClose }: ParameterModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<Record<string, ParameterData>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  useEffect(() => {
    const fetchParameters = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await getParameters(logId)
        setParameters(data)
      } catch (err) {
        console.error('Error fetching parameters:', err)
        setError('Failed to load parameters. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchParameters()
  }, [logId])

  // Count modified parameters (from frame defaults - the primary indicator)
  const modifiedFromFrameCount = useMemo(() => {
    return Object.values(parameters).filter(p => p.modifiedFromFrame).length
  }, [parameters])

  // Filter parameters by search term and filter mode
  const filteredParameters = useMemo(() => {
    let entries = Object.entries(parameters)

    // Apply modified filter (based on frame defaults)
    if (filterMode === 'modified') {
      entries = entries.filter(([, data]) => data.modifiedFromFrame)
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase()
      entries = entries.filter(([name]) => name.toLowerCase().includes(lowerSearch))
    }

    return entries.sort(([a], [b]) => a.localeCompare(b))
  }, [parameters, searchTerm, filterMode])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Flight Parameters
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {logTitle}
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

          {/* Search and filter controls */}
          <div className="p-4 border-b space-y-3">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter parameters by name..."
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-500"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Filter toggle */}
            {!loading && modifiedFromFrameCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    filterMode === 'all'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterMode('modified')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    filterMode === 'modified'
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  Modified from frame ({modifiedFromFrameCount})
                </button>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 px-4">
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
              <div className="p-4 mx-4 mt-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            ) : filteredParameters.length === 0 ? (
              <div className="text-center py-8 px-4 text-gray-500">
                {searchTerm ? (
                  <p>No parameters found matching "{searchTerm}"</p>
                ) : (
                  <p>No parameters available</p>
                )}
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                      Value
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                      Frame Default
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                      Firmware Default
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredParameters.map(([name, data], index) => (
                    <tr
                      key={name}
                      className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${
                        data.modifiedFromFrame ? 'border-l-2 border-l-amber-400' : ''
                      }`}
                    >
                      <td className="px-4 py-2 text-sm font-mono text-gray-900 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {name}
                          {data.modifiedFromFrame && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              modified
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`px-4 py-2 text-sm font-mono ${data.modifiedFromFrame ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                        {formatValue(data.value)}
                      </td>
                      <td className="px-4 py-2 text-sm font-mono text-gray-400">
                        {data.frameDefault !== null ? formatValue(data.frameDefault) : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm font-mono text-gray-400">
                        {data.firmwareDefault !== null ? formatValue(data.firmwareDefault) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer with parameter count */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <span className="text-sm text-gray-500">
              {loading ? '' : `${filteredParameters.length} of ${Object.keys(parameters).length} parameters`}
            </span>
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
