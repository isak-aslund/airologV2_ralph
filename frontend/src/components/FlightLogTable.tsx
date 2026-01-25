import { useState } from 'react'
import type { FlightLog } from '../types'

// Tooltip component for truncated comments
interface TooltipProps {
  text: string
  children: React.ReactNode
}

function Tooltip({ text, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [delayHandler, setDelayHandler] = useState<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    const handler = setTimeout(() => {
      setIsVisible(true)
    }, 200) // 200ms delay
    setDelayHandler(handler)
  }

  const handleMouseLeave = () => {
    if (delayHandler) {
      clearTimeout(delayHandler)
      setDelayHandler(null)
    }
    setIsVisible(false)
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div className="absolute z-50 bottom-full left-0 mb-2 px-3 py-2 text-sm text-white bg-gray-900 rounded-md shadow-lg max-w-sm whitespace-normal break-words">
          {text}
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

interface FlightLogTableProps {
  logs: FlightLog[]
  loading?: boolean
  onEdit?: (log: FlightLog) => void
  onDelete?: (log: FlightLog) => void
  onDownload?: (log: FlightLog) => void
  onViewParameters?: (log: FlightLog) => void
}

// Format duration from seconds to HH:MM:SS
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '--:--:--'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// Format date to YYYY-MM-DD
function formatDate(dateStr: string | null): string {
  if (!dateStr) {
    return '--'
  }
  const date = new Date(dateStr)
  return date.toISOString().split('T')[0]
}

// Truncate comment to 50 characters
function truncateComment(comment: string | null): { text: string; isTruncated: boolean; original: string | null } {
  if (!comment) {
    return { text: '--', isTruncated: false, original: null }
  }
  if (comment.length > 50) {
    return { text: comment.substring(0, 50) + '...', isTruncated: true, original: comment }
  }
  return { text: comment, isTruncated: false, original: comment }
}

// Tag badge colors - cycle through a predefined set
const TAG_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-yellow-100 text-yellow-800',
  'bg-pink-100 text-pink-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
]

function getTagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length]
}

function TableSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="animate-pulse">
        {/* Header skeleton */}
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
          <div className="flex gap-4">
            {[40, 60, 80, 60, 100, 80, 100, 120, 80, 100].map((width, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded" style={{ width: `${width}px` }} />
            ))}
          </div>
        </div>
        {/* Row skeletons */}
        {[1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="border-b border-gray-200 px-4 py-4">
            <div className="flex gap-4 items-center">
              <div className="w-10 h-10 bg-gray-200 rounded" />
              <div className="h-4 w-12 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="h-4 w-40 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-28 bg-gray-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FlightLogTable({
  logs,
  loading = false,
  onEdit,
  onDelete,
  onDownload,
  onViewParameters,
}: FlightLogTableProps) {
  if (loading) {
    return <TableSkeleton />
  }

  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">No flight logs found.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {/* Thumbnail */}
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Model
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Serial
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Pilot
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Title
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Duration
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Tags
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Comment
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {logs.map((log, index) => (
            <tr key={log.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {/* Thumbnail */}
              <td className="px-3 py-2 whitespace-nowrap">
                <img
                  src={`/img/${log.drone_model}.png`}
                  alt={`${log.drone_model} drone`}
                  className="w-10 h-10 object-contain"
                />
              </td>
              {/* Model */}
              <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                {log.drone_model}
              </td>
              {/* Serial */}
              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                {log.serial_number || '--'}
              </td>
              {/* Pilot */}
              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                {log.pilot}
              </td>
              {/* Title */}
              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                {log.title}
              </td>
              {/* Duration */}
              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 font-mono">
                {formatDuration(log.duration_seconds)}
              </td>
              {/* Tags */}
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="flex flex-wrap gap-1">
                  {log.tags.length === 0 ? (
                    <span className="text-sm text-gray-400">--</span>
                  ) : (
                    log.tags.map((tag, tagIndex) => (
                      <span
                        key={tag.id}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getTagColor(tagIndex)}`}
                      >
                        {tag.name}
                      </span>
                    ))
                  )}
                </div>
              </td>
              {/* Comment */}
              <td className="px-3 py-2 text-sm text-gray-500 max-w-xs">
                {(() => {
                  const { text, isTruncated, original } = truncateComment(log.comment)
                  if (isTruncated && original) {
                    return (
                      <Tooltip text={original}>
                        <span className="cursor-default">{text}</span>
                      </Tooltip>
                    )
                  }
                  return text
                })()}
              </td>
              {/* Date */}
              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                {formatDate(log.flight_date)}
              </td>
              {/* Actions - placeholder buttons for now, will be enhanced in US-016 */}
              <td className="px-3 py-2 whitespace-nowrap text-sm">
                <div className="flex gap-1">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(log)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="Edit"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(log)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="Delete"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                  {onDownload && (
                    <button
                      onClick={() => onDownload(log)}
                      className="p-1 text-gray-400 hover:text-green-600"
                      title="Download"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  )}
                  {onViewParameters && (
                    <button
                      onClick={() => onViewParameters(log)}
                      className="p-1 text-gray-400 hover:text-purple-600"
                      title="View Parameters"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </button>
                  )}
                  {/* Flight Review external link - always shown */}
                  <a
                    href={`http://10.0.0.100:5006/plot_app?log=${log.file_path.split('/').pop()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-gray-400 hover:text-indigo-600"
                    title="Open in Flight Review"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
