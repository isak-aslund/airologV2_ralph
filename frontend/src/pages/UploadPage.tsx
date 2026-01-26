import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createLog, extractMetadata } from '../api/logs'
import { getPilots } from '../api/pilots'
import TagInput from '../components/TagInput'
import type { DroneModel, ExtractedMetadata } from '../types'

const DRONE_MODELS: DroneModel[] = ['XLT', 'S1', 'CX10']

interface FormData {
  title: string
  pilot: string
  drone_model: DroneModel | ''
  comment: string
  tags: string[]
}

interface FormErrors {
  title?: string
  pilot?: string
  drone_model?: string
}

// Navigation state interface for receiving drone log from DroneLogsPanel
interface DroneLogState {
  droneLog?: {
    blob: Blob
    filename: string
    logId: number
    timeUtc: number
  }
}

export default function UploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [fromDrone, setFromDrone] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<ExtractedMetadata | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [formData, setFormData] = useState<FormData>({
    title: '',
    pilot: '',
    drone_model: '',
    comment: '',
    tags: [],
  })
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [pilots, setPilots] = useState<string[]>([])
  const [showPilotSuggestions, setShowPilotSuggestions] = useState(false)
  const pilotInputRef = useRef<HTMLInputElement>(null)
  const pilotContainerRef = useRef<HTMLDivElement>(null)

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleString()
    } catch {
      return dateStr
    }
  }

  const formatCoordinates = (lat: number | null, lon: number | null): string | null => {
    if (lat === null || lon === null) return null
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }

  // Load pilots for autocomplete
  useEffect(() => {
    getPilots()
      .then(setPilots)
      .catch((err) => console.error('Error fetching pilots:', err))
  }, [])

  // Handle pre-populated file from drone download (via navigation state)
  useEffect(() => {
    const state = location.state as DroneLogState | null
    if (state?.droneLog) {
      const { blob, filename } = state.droneLog
      // Convert Blob to File object
      const file = new File([blob], filename, { type: 'application/octet-stream' })
      setSelectedFiles([file])
      setFromDrone(true)

      // Clear the navigation state to prevent re-processing on refresh
      // Use replace to avoid adding to history
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

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

  // Extract metadata when a single file is selected (for single-file mode - will be enhanced in future story)
  useEffect(() => {
    // Only extract metadata for single file selection (existing behavior)
    if (selectedFiles.length !== 1) {
      setMetadata(null)
      setExtractionError(null)
      return
    }

    const doExtract = async () => {
      setIsExtracting(true)
      setExtractionError(null)
      setMetadata(null)

      try {
        const result = await extractMetadata(selectedFiles[0])
        setMetadata(result)
      } catch (err) {
        setExtractionError(
          err instanceof Error ? err.message : 'Failed to extract metadata from file'
        )
      } finally {
        setIsExtracting(false)
      }
    }

    doExtract()
  }, [selectedFiles])

  // Validate required form fields
  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {}

    if (!formData.title.trim()) {
      errors.title = 'Title is required'
    }

    if (!formData.pilot.trim()) {
      errors.pilot = 'Pilot is required'
    }

    if (!formData.drone_model) {
      errors.drone_model = 'Drone model is required'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  // Check if form is valid for enabling submit button (without setting errors)
  const isFormValid = formData.title.trim() && formData.pilot.trim() && formData.drone_model

  // Handle form submission (single file mode - will be enhanced in future story for batch)
  const handleSubmit = async () => {
    if (!validateForm() || selectedFiles.length === 0) return

    setIsUploading(true)
    setUploadError(null)

    try {
      // For now, upload only the first file (batch upload will be added in future story)
      const uploadData = new FormData()
      uploadData.append('file', selectedFiles[0])
      uploadData.append('title', formData.title.trim())
      uploadData.append('pilot', formData.pilot.trim())
      uploadData.append('drone_model', formData.drone_model)

      if (formData.comment.trim()) {
        uploadData.append('comment', formData.comment.trim())
      }

      // Include serial number from metadata if available
      if (metadata?.serial_number) {
        uploadData.append('serial_number', metadata.serial_number)
      }

      // Tags as comma-separated string
      if (formData.tags.length > 0) {
        uploadData.append('tags', formData.tags.join(','))
      }

      await createLog(uploadData)
      setUploadSuccess(true)

      // Redirect to log list after short delay to show success message
      setTimeout(() => {
        navigate('/')
      }, 1500)
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to upload flight log. Please try again.'
      )
    } finally {
      setIsUploading(false)
    }
  }

  // Form field handlers
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

  // Filter pilots based on input
  const filteredPilots = pilots.filter((p) =>
    p.toLowerCase().includes(formData.pilot.toLowerCase())
  )

  const handleFilesSelect = useCallback((files: File[]) => {
    // Filter to only .ulg files
    const validFiles = files.filter(file => file.name.toLowerCase().endsWith('.ulg'))
    const invalidCount = files.length - validFiles.length

    if (invalidCount > 0) {
      alert(`${invalidCount} file(s) were skipped because they are not .ulg files`)
    }

    if (validFiles.length > 0) {
      // Add new files to existing selection (avoid duplicates by filename)
      setSelectedFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name))
        const newFiles = validFiles.filter(f => !existingNames.has(f.name))
        return [...prev, ...newFiles]
      })
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    handleFilesSelect(files)
    // Reset input so the same files can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    handleFilesSelect(files)
  }

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    // Reset form state if all files removed
    if (selectedFiles.length === 1) {
      setMetadata(null)
      setExtractionError(null)
      setFromDrone(false)
      setFormData({
        title: '',
        pilot: '',
        drone_model: '',
        comment: '',
        tags: [],
      })
      setFormErrors({})
    }
  }

  const handleRemoveAllFiles = () => {
    setSelectedFiles([])
    setMetadata(null)
    setExtractionError(null)
    setFromDrone(false)
    setFormData({
      title: '',
      pilot: '',
      drone_model: '',
      comment: '',
      tags: [],
    })
    setFormErrors({})
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Helper to check which fields were extracted
  const getExtractionStatus = () => {
    if (!metadata) return []
    const fields = []
    if (metadata.duration_seconds !== null) fields.push('Duration')
    if (metadata.flight_date !== null) fields.push('Flight Date')
    if (metadata.serial_number !== null) fields.push('Serial Number')
    if (metadata.takeoff_lat !== null && metadata.takeoff_lon !== null) fields.push('GPS Coordinates')
    return fields
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Upload Flight Log</h1>

      {/* Defaults for all files - shown when files are selected */}
      {selectedFiles.length > 0 && (
        <div className="mb-6 p-6 bg-white rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Defaults for all files</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pilot with autocomplete */}
            <div ref={pilotContainerRef} className="relative">
              <label htmlFor="default-pilot" className="block text-sm font-medium text-gray-700 mb-1">
                Pilot <span className="text-red-500">*</span>
              </label>
              <input
                ref={pilotInputRef}
                type="text"
                id="default-pilot"
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
              <label htmlFor="default-drone-model" className="block text-sm font-medium text-gray-700 mb-1">
                Drone Model <span className="text-red-500">*</span>
              </label>
              <select
                id="default-drone-model"
                value={formData.drone_model}
                onChange={(e) => handleFormChange('drone_model', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.drone_model ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Select drone model</option>
                {DRONE_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              {formErrors.drone_model && (
                <p className="mt-1 text-sm text-red-600">{formErrors.drone_model}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* File Selection Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragOver
            ? 'border-blue-500 bg-blue-50'
            : selectedFiles.length > 0
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".ulg"
          multiple
          onChange={handleInputChange}
          className="hidden"
        />

        {selectedFiles.length > 0 ? (
          // Files Selected State
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <svg
                className="w-12 h-12 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            {/* File count and total size */}
            <div>
              {fromDrone && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mb-2">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  Downloaded from drone
                </span>
              )}
              <p className="text-lg font-semibold text-gray-900">
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
              </p>
              <p className="text-sm text-gray-500">
                Total: {formatFileSize(selectedFiles.reduce((sum, f) => sum + f.size, 0))}
              </p>
            </div>

            {/* Scrollable file list */}
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(index)}
                    className="ml-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Remove file"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={handleBrowseClick}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add More Files
              </button>
              <button
                type="button"
                onClick={handleRemoveAllFiles}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
              >
                Remove All
              </button>
            </div>
          </div>
        ) : (
          // No File State
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <svg
                className={`w-16 h-16 ${isDragOver ? 'text-blue-500' : 'text-gray-400'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900">
                {isDragOver ? 'Drop your file here' : 'Drag and drop your .ulg file here'}
              </p>
              <p className="text-sm text-gray-500 mt-1">or</p>
            </div>
            <button
              type="button"
              onClick={handleBrowseClick}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Browse Files
            </button>
            <p className="text-xs text-gray-400 mt-2">Only .ulg files are accepted</p>
          </div>
        )}
      </div>

      {/* Metadata Extraction Section */}
      {selectedFiles.length > 0 && (
        <div className="mt-8 p-6 bg-white rounded-lg border border-gray-200">
          {isExtracting ? (
            // Loading State
            <div className="flex flex-col items-center justify-center py-8">
              <svg
                className="animate-spin h-10 w-10 text-blue-600 mb-4"
                xmlns="http://www.w3.org/2000/svg"
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
              <p className="text-gray-600 font-medium">Extracting metadata from file...</p>
              <p className="text-sm text-gray-400 mt-1">This may take a moment for large files</p>
            </div>
          ) : extractionError ? (
            // Error State
            <div className="flex flex-col items-center justify-center py-8">
              <div className="rounded-full bg-red-100 p-3 mb-4">
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-red-600 font-medium">Failed to extract metadata</p>
              <p className="text-sm text-gray-500 mt-1">{extractionError}</p>
            </div>
          ) : metadata ? (
            // Success State - Display Extracted Metadata
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Extracted Metadata</h2>
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-sm text-green-600">
                    {getExtractionStatus().length} fields extracted
                  </span>
                </div>
              </div>

              {/* Extraction Results Summary */}
              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Found: </span>
                  {getExtractionStatus().length > 0
                    ? getExtractionStatus().join(', ')
                    : 'No metadata could be extracted'}
                </p>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Duration */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-500 mb-1">Duration</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {metadata.duration_seconds !== null
                      ? formatDuration(metadata.duration_seconds)
                      : <span className="text-gray-400 font-normal">Not available</span>
                    }
                  </p>
                </div>

                {/* Flight Date */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-500 mb-1">Flight Date</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {metadata.flight_date !== null
                      ? formatDate(metadata.flight_date)
                      : <span className="text-gray-400 font-normal">Not available</span>
                    }
                  </p>
                </div>

                {/* Serial Number */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-500 mb-1">Serial Number</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {metadata.serial_number !== null
                      ? metadata.serial_number
                      : <span className="text-gray-400 font-normal">Not available</span>
                    }
                  </p>
                </div>

                {/* GPS Coordinates */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-500 mb-1">GPS Coordinates</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCoordinates(metadata.takeoff_lat, metadata.takeoff_lon)
                      ?? <span className="text-gray-400 font-normal">Not available</span>
                    }
                  </p>
                </div>
              </div>

              {/* Form Fields */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Flight Details</h3>
                <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="title"
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

                  {/* Comment */}
                  <div>
                    <label htmlFor="comment" className="block text-sm font-medium text-gray-700 mb-1">
                      Comment <span className="text-gray-400 text-xs">(optional)</span>
                    </label>
                    <textarea
                      id="comment"
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

                  {/* Error Message */}
                  {uploadError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                      <div className="flex items-start gap-3">
                        <svg
                          className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-red-800">Upload failed</p>
                          <p className="text-sm text-red-700 mt-1">{uploadError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success Message */}
                  {uploadSuccess && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                      <div className="flex items-center gap-3">
                        <svg
                          className="h-5 w-5 text-green-600 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-green-800">
                            Flight log uploaded successfully!
                          </p>
                          <p className="text-sm text-green-700 mt-1">
                            Redirecting to log list...
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!isFormValid || isUploading || uploadSuccess}
                      className={`w-full py-3 px-4 text-white font-semibold rounded-md transition-colors flex items-center justify-center gap-2 ${
                        isFormValid && !isUploading && !uploadSuccess
                          ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <svg
                            className="animate-spin h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
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
                          Uploading...
                        </>
                      ) : uploadSuccess ? (
                        'Uploaded!'
                      ) : (
                        'Upload Flight Log'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
