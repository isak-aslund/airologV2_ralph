import { useState, useRef, useCallback, useEffect } from 'react'
import { extractMetadata } from '../api/logs'
import type { ExtractedMetadata } from '../types'

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<ExtractedMetadata | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Extract metadata when file is selected
  useEffect(() => {
    if (!selectedFile) {
      setMetadata(null)
      setExtractionError(null)
      return
    }

    const doExtract = async () => {
      setIsExtracting(true)
      setExtractionError(null)
      setMetadata(null)

      try {
        const result = await extractMetadata(selectedFile)
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
  }, [selectedFile])

  const handleFileSelect = useCallback((file: File | null) => {
    if (file && !file.name.toLowerCase().endsWith('.ulg')) {
      alert('Please select a .ulg file')
      return
    }
    setSelectedFile(file)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    handleFileSelect(file)
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
    const file = e.dataTransfer.files?.[0] || null
    handleFileSelect(file)
  }

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setMetadata(null)
    setExtractionError(null)
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
    <div className="container mx-auto p-4 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Upload Flight Log</h1>

      {/* File Selection Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragOver
            ? 'border-blue-500 bg-blue-50'
            : selectedFile
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
          onChange={handleInputChange}
          className="hidden"
        />

        {selectedFile ? (
          // File Selected State
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
            <div>
              <p className="text-lg font-semibold text-gray-900">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={handleBrowseClick}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Choose Different File
              </button>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
              >
                Remove
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
      {selectedFile && (
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

              {/* Placeholder for form fields - to be added in US-029 */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-gray-500 text-center text-sm">
                  Form fields for additional metadata will be added in the next story.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
