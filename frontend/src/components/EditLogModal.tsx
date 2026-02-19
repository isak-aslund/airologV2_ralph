import { useState, useEffect, useRef, useCallback } from 'react'
import type { FlightLog, DroneModel } from '../types'
import { updateLog } from '../api/logs'
import { getPilots } from '../api/pilots'
import { formatDateISO } from '../utils/date'
import TagInput from './TagInput'

// Known drone models as SYS_AUTOSTART values
const DRONE_MODELS: DroneModel[] = ['4006', '4010', '4030']  // XLT, S1, CX10

// Map SYS_AUTOSTART values to model names (for display)
const AUTOSTART_TO_MODEL: Record<string, string> = {
  '4006': 'XLT',
  '4010': 'S1',
  '4030': 'CX10',
}

// Format drone model for display: "4030 [CX10]" or just the number for unknown
const formatDroneModel = (autostart: string): string => {
  const modelName = AUTOSTART_TO_MODEL[autostart]
  if (modelName) {
    return `${autostart} [${modelName}]`
  }
  return autostart
}

interface EditLogModalProps {
  log: FlightLog
  onClose: () => void
  onSaved: () => void
}

interface FormData {
  title: string
  pilot: string
  drone_model: string  // Can be known model or custom value
  comment: string
  tags: string[]
}

interface FormErrors {
  title?: string
  pilot?: string
}

export default function EditLogModal({ log, onClose, onSaved }: EditLogModalProps) {
  const [formData, setFormData] = useState<FormData>({
    title: log.title,
    pilot: log.pilot,
    drone_model: log.drone_model,
    comment: log.comment || '',
    tags: log.tags.map((t) => t.name),
  })
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pilot autocomplete state
  const [pilots, setPilots] = useState<string[]>([])
  const [showPilotSuggestions, setShowPilotSuggestions] = useState(false)
  const pilotContainerRef = useRef<HTMLDivElement>(null)

  // Load pilots for autocomplete
  useEffect(() => {
    getPilots()
      .then(setPilots)
      .catch((err) => console.error('Error fetching pilots:', err))
  }, [])

  // Handle click outside for pilot suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pilotContainerRef.current && !pilotContainerRef.current.contains(event.target as Node)) {
        setShowPilotSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter pilots based on input
  const filteredPilots = pilots.filter((p) =>
    p.toLowerCase().includes(formData.pilot.toLowerCase())
  )

  const handleFormChange = (field: keyof FormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (formErrors[field as keyof FormErrors]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const handlePilotSelect = (pilot: string) => {
    handleFormChange('pilot', pilot)
    setShowPilotSuggestions(false)
  }

  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {}

    if (!formData.title.trim()) {
      errors.title = 'Title is required'
    }

    if (!formData.pilot.trim()) {
      errors.pilot = 'Pilot is required'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  const handleSave = async () => {
    if (!validateForm()) return

    try {
      setLoading(true)
      setError(null)

      await updateLog(log.id, {
        title: formData.title.trim(),
        pilot: formData.pilot.trim(),
        drone_model: formData.drone_model,
        comment: formData.comment.trim() || null,
        tags: formData.tags,
      })

      onSaved()
    } catch (err) {
      console.error('Error updating log:', err)
      setError('Failed to save changes. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Format duration from seconds to HH:MM:SS
  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return 'N/A'
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Format coordinates
  const formatCoordinates = (lat: number | null, lon: number | null): string => {
    if (lat === null || lon === null) return 'N/A'
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Edit Flight Log</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Read-only metadata section */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Flight Information (Read-only)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Duration</p>
                  <p className="text-sm font-medium text-gray-900">{formatDuration(log.duration_seconds)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Flight Date</p>
                  <p className="text-sm font-medium text-gray-900">{formatDateISO(log.flight_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Serial Number</p>
                  <p className="text-sm font-medium text-gray-900">{log.serial_number || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">GPS Coordinates</p>
                  <p className="text-sm font-medium text-gray-900">
                    {formatCoordinates(log.takeoff_lat, log.takeoff_lon)}
                  </p>
                </div>
              </div>
            </div>

            {/* Editable fields */}
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="edit-title"
                  value={formData.title}
                  onChange={(e) => handleFormChange('title', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    formErrors.title ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Enter a title for this flight log"
                />
                {formErrors.title && (
                  <p className="mt-1 text-sm text-red-600">{formErrors.title}</p>
                )}
              </div>

              {/* Pilot with autocomplete */}
              <div ref={pilotContainerRef} className="relative">
                <label htmlFor="edit-pilot" className="block text-sm font-medium text-gray-700 mb-1">
                  Pilot <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="edit-pilot"
                  value={formData.pilot}
                  onChange={(e) => handleFormChange('pilot', e.target.value)}
                  onFocus={() => setShowPilotSuggestions(true)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    formErrors.pilot ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Enter pilot name"
                  autoComplete="off"
                />
                {formErrors.pilot && (
                  <p className="mt-1 text-sm text-red-600">{formErrors.pilot}</p>
                )}
                {/* Pilot autocomplete dropdown */}
                {showPilotSuggestions && filteredPilots.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {filteredPilots.map((pilot) => (
                      <button
                        key={pilot}
                        type="button"
                        onClick={() => handlePilotSelect(pilot)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      >
                        {pilot}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Drone Model */}
              <div>
                <label htmlFor="edit-drone-model" className="block text-sm font-medium text-gray-700 mb-1">
                  Drone Model <span className="text-red-500">*</span>
                </label>
                <select
                  id="edit-drone-model"
                  value={formData.drone_model}
                  onChange={(e) => handleFormChange('drone_model', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DRONE_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {formatDroneModel(model)}
                    </option>
                  ))}
                  {/* Show custom model if not in known models list */}
                  {formData.drone_model && !DRONE_MODELS.includes(formData.drone_model as DroneModel) && (
                    <option value={formData.drone_model}>
                      {formatDroneModel(formData.drone_model)}
                    </option>
                  )}
                </select>
              </div>

              {/* Comment */}
              <div>
                <label htmlFor="edit-comment" className="block text-sm font-medium text-gray-700 mb-1">
                  Comment <span className="text-gray-400 text-xs">(optional)</span>
                </label>
                <textarea
                  id="edit-comment"
                  value={formData.comment}
                  onChange={(e) => handleFormChange('comment', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Add any notes or comments about this flight"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags <span className="text-gray-400 text-xs">(optional)</span>
                </label>
                <TagInput
                  selectedTags={formData.tags}
                  onTagsChange={(tags) => handleFormChange('tags', tags)}
                  placeholder="Search or create tags..."
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
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
                  Saving...
                </span>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
