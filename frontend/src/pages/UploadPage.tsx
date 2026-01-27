import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createLog, extractMetadata } from '../api/logs'
import { getPilots } from '../api/pilots'
import TagInput from '../components/TagInput'
import DroneLogsPanel from '../components/DroneLogsPanel'
import type { DownloadedLog } from '../lib/droneConnection'
import type { DroneModel, ExtractedMetadata } from '../types'

// Known drone models for dropdowns
const DRONE_MODELS: DroneModel[] = ['XLT', 'S1', 'CX10']

interface FormData {
  title: string
  pilot: string
  drone_model: string  // Can be known model or custom value (e.g., "4001")
  comment: string
  tags: string[]
}

interface FormErrors {
  title?: string
  pilot?: string
  drone_model?: string
}

// Per-file override data
interface FileOverride {
  title: string  // Pre-populated from filename (without .ulg)
  pilot: string  // Optional override for pilot
  drone_model: string  // Optional override for drone model (can be custom)
  comment: string  // Optional comment
  tags: string[]  // Optional tags
}

// Per-file metadata state (for batch preview)
interface FileMetadataState {
  isLoading: boolean
  error: string | null
  metadata: ExtractedMetadata | null
}

// Per-file upload status (for batch upload)
interface FileUploadStatus {
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
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
  const [metadata, setMetadata] = useState<ExtractedMetadata | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Per-file override state
  const [fileOverrides, setFileOverrides] = useState<Map<string, FileOverride>>(new Map())
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // Per-file metadata state (for batch metadata preview)
  const [fileMetadataStates, setFileMetadataStates] = useState<Map<string, FileMetadataState>>(new Map())

  // Batch upload state
  const [isBatchUploading, setIsBatchUploading] = useState(false)
  const [batchUploadIndex, setBatchUploadIndex] = useState(0)
  const [fileUploadStatuses, setFileUploadStatuses] = useState<Map<string, FileUploadStatus>>(new Map())
  const [batchUploadComplete, setBatchUploadComplete] = useState(false)

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

  // Helper to get title from filename (without .ulg extension)
  const getTitleFromFilename = (filename: string): string => {
    return filename.replace(/\.ulg$/i, '')
  }

  // Get or create override for a file
  const getFileOverride = (filename: string): FileOverride => {
    const existing = fileOverrides.get(filename)
    if (existing) return existing
    return {
      title: getTitleFromFilename(filename),
      pilot: '',
      drone_model: '',
      comment: '',
      tags: [],
    }
  }

  // Update override for a file
  const updateFileOverride = (filename: string, field: keyof FileOverride, value: string | string[]) => {
    setFileOverrides(prev => {
      const newMap = new Map(prev)
      const current = getFileOverride(filename)
      newMap.set(filename, { ...current, [field]: value })
      return newMap
    })
  }

  // Toggle file expansion
  const toggleFileExpanded = (filename: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filename)) {
        newSet.delete(filename)
      } else {
        newSet.add(filename)
      }
      return newSet
    })
  }

  // Check if file is expanded
  const isFileExpanded = (filename: string): boolean => {
    return expandedFiles.has(filename)
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

  // Extract metadata for all selected files in parallel
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setMetadata(null)
      return
    }

    // Find files that need metadata extraction (not already loading or loaded)
    const filesToExtract = selectedFiles.filter(file => {
      const state = fileMetadataStates.get(file.name)
      return !state // Only extract for files we haven't seen before
    })

    console.log('[UploadPage] Metadata extraction check:', {
      selectedFiles: selectedFiles.map(f => f.name),
      filesToExtract: filesToExtract.map(f => f.name),
      fileMetadataStates: Array.from(fileMetadataStates.keys())
    })

    if (filesToExtract.length === 0) {
      // All files already have metadata state - update single-file metadata for drone model prepopulation
      if (selectedFiles.length === 1) {
        const state = fileMetadataStates.get(selectedFiles[0].name)
        if (state) {
          setMetadata(state.metadata)
        }
      }
      return
    }

    console.log('[UploadPage] Starting metadata extraction for', filesToExtract.length, 'files')

    // Set loading state for new files
    setFileMetadataStates(prev => {
      const newMap = new Map(prev)
      for (const file of filesToExtract) {
        newMap.set(file.name, { isLoading: true, error: null, metadata: null })
      }
      return newMap
    })

    // For single file mode, also update metadata state
    if (selectedFiles.length === 1) {
      setMetadata(null)
    }

    // Extract metadata in parallel using Promise.all
    const extractAll = async () => {
      console.log('[UploadPage] Calling extractMetadata API for files:', filesToExtract.map(f => f.name))
      const results = await Promise.all(
        filesToExtract.map(async (file) => {
          try {
            console.log('[UploadPage] Extracting metadata for:', file.name, 'size:', file.size)
            const metadata = await extractMetadata(file)
            console.log('[UploadPage] Extraction successful for:', file.name, metadata)
            return { filename: file.name, metadata, error: null }
          } catch (err) {
            console.error('[UploadPage] Extraction failed for:', file.name, err)
            return {
              filename: file.name,
              metadata: null,
              error: err instanceof Error ? err.message : 'Failed to extract metadata'
            }
          }
        })
      )

      console.log('[UploadPage] All extractions complete, updating state')

      // Update state with results
      setFileMetadataStates(prev => {
        const newMap = new Map(prev)
        for (const result of results) {
          newMap.set(result.filename, {
            isLoading: false,
            error: result.error,
            metadata: result.metadata
          })
        }
        return newMap
      })

      // For single file mode, also update metadata state for drone model prepopulation
      if (selectedFiles.length === 1 && results.length === 1) {
        const result = results[0]
        setMetadata(result.metadata)
      }
    }

    extractAll()
  }, [selectedFiles, fileMetadataStates])

  // Prepopulate drone model from extracted metadata
  useEffect(() => {
    // Only prepopulate if drone_model is not already set
    if (formData.drone_model) return

    // For single file, use the metadata state
    if (selectedFiles.length === 1 && metadata?.drone_model) {
      const model = metadata.drone_model
      // Set any valid model (known models or custom values like "4001")
      if (model && model !== 'unknown') {
        setFormData(prev => ({ ...prev, drone_model: model }))
      }
      return
    }

    // For multiple files, use the first file's metadata as default
    if (selectedFiles.length > 1) {
      const firstFileMetadata = fileMetadataStates.get(selectedFiles[0]?.name)?.metadata
      if (firstFileMetadata?.drone_model) {
        const model = firstFileMetadata.drone_model
        if (model && model !== 'unknown') {
          setFormData(prev => ({ ...prev, drone_model: model }))
        }
      }
    }
  }, [metadata, fileMetadataStates, selectedFiles, formData.drone_model])

  // Check if upload is valid (defaults set + files selected)
  const isBatchUploadValid = formData.pilot.trim() && formData.drone_model && selectedFiles.length > 0

  // Handle batch upload submission (for multiple files)
  const handleBatchUpload = async () => {
    if (!isBatchUploadValid) return

    setIsBatchUploading(true)
    setBatchUploadIndex(0)
    setUploadError(null)

    // Initialize all files as pending
    const initialStatuses = new Map<string, FileUploadStatus>()
    selectedFiles.forEach(file => {
      initialStatuses.set(file.name, { status: 'pending' })
    })
    setFileUploadStatuses(initialStatuses)

    // Upload files sequentially
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      const override = getFileOverride(file.name)
      const fileMetadata = fileMetadataStates.get(file.name)?.metadata

      // Update current file index and status
      setBatchUploadIndex(i)
      setFileUploadStatuses(prev => {
        const newMap = new Map(prev)
        newMap.set(file.name, { status: 'uploading' })
        return newMap
      })

      try {
        const uploadData = new FormData()
        uploadData.append('file', file)

        // Use per-file title or default from filename
        const title = override.title.trim() || getTitleFromFilename(file.name)
        uploadData.append('title', title)

        // Use per-file override or default
        const pilot = override.pilot.trim() || formData.pilot.trim()
        uploadData.append('pilot', pilot)

        const droneModel = override.drone_model || formData.drone_model
        uploadData.append('drone_model', droneModel)

        // Comment: per-file override or default (if any)
        const comment = override.comment.trim() || formData.comment.trim()
        if (comment) {
          uploadData.append('comment', comment)
        }

        // Serial number from metadata if available
        if (fileMetadata?.serial_number) {
          uploadData.append('serial_number', fileMetadata.serial_number)
        }

        // Tags: per-file override or default
        const tags = override.tags.length > 0 ? override.tags : formData.tags
        if (tags.length > 0) {
          uploadData.append('tags', tags.join(','))
        }

        await createLog(uploadData)

        // Mark as success
        setFileUploadStatuses(prev => {
          const newMap = new Map(prev)
          newMap.set(file.name, { status: 'success' })
          return newMap
        })
      } catch (err) {
        // Mark as error but continue with next file
        setFileUploadStatuses(prev => {
          const newMap = new Map(prev)
          newMap.set(file.name, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Upload failed'
          })
          return newMap
        })
      }
    }

    setIsBatchUploading(false)
    setBatchUploadComplete(true)
  }

  // Get batch upload results summary
  const getBatchUploadSummary = () => {
    let succeeded = 0
    let failed = 0
    fileUploadStatuses.forEach((status) => {
      if (status.status === 'success') succeeded++
      if (status.status === 'error') failed++
    })
    return { succeeded, failed, total: succeeded + failed }
  }

  // Check if all files uploaded successfully
  const isAllFilesSucceeded = () => {
    if (selectedFiles.length === 0) return false
    return selectedFiles.every((file) => fileUploadStatuses.get(file.name)?.status === 'success')
  }

  // Retry upload for a single failed file
  const handleRetryFile = async (file: File) => {
    const override = getFileOverride(file.name)
    const fileMetadata = fileMetadataStates.get(file.name)?.metadata

    // Mark as uploading
    setFileUploadStatuses(prev => {
      const newMap = new Map(prev)
      newMap.set(file.name, { status: 'uploading' })
      return newMap
    })

    try {
      const uploadData = new FormData()
      uploadData.append('file', file)

      // Use per-file title or default from filename
      const title = override.title.trim() || getTitleFromFilename(file.name)
      uploadData.append('title', title)

      // Use per-file override or default
      const pilot = override.pilot.trim() || formData.pilot.trim()
      uploadData.append('pilot', pilot)

      const droneModel = override.drone_model || formData.drone_model
      uploadData.append('drone_model', droneModel)

      // Comment: per-file override or default (if any)
      const comment = override.comment.trim() || formData.comment.trim()
      if (comment) {
        uploadData.append('comment', comment)
      }

      // Serial number from metadata if available
      if (fileMetadata?.serial_number) {
        uploadData.append('serial_number', fileMetadata.serial_number)
      }

      // Tags: per-file override or default
      const tags = override.tags.length > 0 ? override.tags : formData.tags
      if (tags.length > 0) {
        uploadData.append('tags', tags.join(','))
      }

      await createLog(uploadData)

      // Mark as success
      setFileUploadStatuses(prev => {
        const newMap = new Map(prev)
        newMap.set(file.name, { status: 'success' })
        return newMap
      })
    } catch (err) {
      // Mark as error
      setFileUploadStatuses(prev => {
        const newMap = new Map(prev)
        newMap.set(file.name, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed'
        })
        return newMap
      })
    }
  }

  // Clear all successfully uploaded files from the list
  const handleClearCompleted = () => {
    const remainingFiles = selectedFiles.filter(
      (file) => fileUploadStatuses.get(file.name)?.status !== 'success'
    )

    // If all files were successful and we're clearing, reset everything
    if (remainingFiles.length === 0) {
      handleRemoveAllFiles()
      return
    }

    // Update selected files to only include non-successful ones
    setSelectedFiles(remainingFiles)

    // Clean up state for removed files
    const remainingNames = new Set(remainingFiles.map((f) => f.name))

    setFileOverrides(prev => {
      const newMap = new Map<string, FileOverride>()
      prev.forEach((value, key) => {
        if (remainingNames.has(key)) {
          newMap.set(key, value)
        }
      })
      return newMap
    })

    setExpandedFiles(prev => {
      const newSet = new Set<string>()
      prev.forEach((name) => {
        if (remainingNames.has(name)) {
          newSet.add(name)
        }
      })
      return newSet
    })

    setFileMetadataStates(prev => {
      const newMap = new Map<string, FileMetadataState>()
      prev.forEach((value, key) => {
        if (remainingNames.has(key)) {
          newMap.set(key, value)
        }
      })
      return newMap
    })

    setFileUploadStatuses(prev => {
      const newMap = new Map<string, FileUploadStatus>()
      prev.forEach((value, key) => {
        if (remainingNames.has(key)) {
          newMap.set(key, value)
        }
      })
      return newMap
    })

    // Reset batch complete state since we still have files to process
    setBatchUploadComplete(false)
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
    const removedFile = selectedFiles[index]
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    // Remove override, expanded state, and metadata state for the removed file
    if (removedFile) {
      setFileOverrides(prev => {
        const newMap = new Map(prev)
        newMap.delete(removedFile.name)
        return newMap
      })
      setExpandedFiles(prev => {
        const newSet = new Set(prev)
        newSet.delete(removedFile.name)
        return newSet
      })
      setFileMetadataStates(prev => {
        const newMap = new Map(prev)
        newMap.delete(removedFile.name)
        return newMap
      })
      setFileUploadStatuses(prev => {
        const newMap = new Map(prev)
        newMap.delete(removedFile.name)
        return newMap
      })
    }
    // Reset form state if all files removed
    if (selectedFiles.length === 1) {
      setMetadata(null)
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
    setFileOverrides(new Map())
    setExpandedFiles(new Set())
    setFileMetadataStates(new Map())
    setFileUploadStatuses(new Map())
    setMetadata(null)
    setFromDrone(false)
    setIsBatchUploading(false)
    setBatchUploadIndex(0)
    setBatchUploadComplete(false)
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

  // Handle logs downloaded from drone - convert to File objects and add to selectedFiles
  const handleDroneLogsDownloaded = useCallback((downloadedLogs: DownloadedLog[]) => {
    const newFiles: File[] = downloadedLogs.map((log) => {
      // Generate filename with full timestamp: log_ID_YYYY-MM-DD-HH-MM-SS.ulg
      // This format is parsed by the backend for flight_date extraction
      const date = new Date(log.timeUtc > 0 ? log.timeUtc * 1000 : Date.now())
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      const filename = `log_${log.id}_${year}-${month}-${day}-${hours}-${minutes}-${seconds}.ulg`
      return new File([log.blob], filename, { type: 'application/octet-stream' })
    })

    // Add new files to existing selection (avoid duplicates by filename)
    setSelectedFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name))
      const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name))
      return [...prev, ...uniqueNewFiles]
    })
    setFromDrone(true)
  }, [])

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Upload Flight Log</h1>

      {/* Drone Logs Panel - shown when drone is connected */}
      <div className="mb-6">
        <DroneLogsPanel onLogsDownloaded={handleDroneLogsDownloaded} />
      </div>

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
                {/* Show custom model if not in known models list */}
                {formData.drone_model && !DRONE_MODELS.includes(formData.drone_model as DroneModel) && (
                  <option value={formData.drone_model}>
                    {formData.drone_model}
                  </option>
                )}
              </select>
              {formErrors.drone_model && (
                <p className="mt-1 text-sm text-red-600">{formErrors.drone_model}</p>
              )}
            </div>
          </div>

          {/* Comment */}
          <div className="mt-4">
            <label htmlFor="default-comment" className="block text-sm font-medium text-gray-700 mb-1">
              Comment
            </label>
            <textarea
              id="default-comment"
              value={formData.comment}
              onChange={(e) => handleFormChange('comment', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional comment for all logs"
              rows={3}
            />
          </div>

          {/* Tags */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags
            </label>
            <TagInput
              selectedTags={formData.tags}
              onTagsChange={(tags) => handleFormChange('tags', tags)}
              placeholder="Search or create tags..."
            />
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

            {/* Scrollable file list with expandable overrides */}
            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg bg-white">
              {selectedFiles.map((file, index) => {
                const override = getFileOverride(file.name)
                const expanded = isFileExpanded(file.name)
                const metadataState = fileMetadataStates.get(file.name)
                const fileMetadata = metadataState?.metadata
                const isFileLoading = metadataState?.isLoading ?? true
                const fileError = metadataState?.error
                const uploadStatus = fileUploadStatuses.get(file.name)
                return (
                  <div
                    key={`${file.name}-${index}`}
                    className="border-b border-gray-100 last:border-b-0"
                  >
                    {/* File header row */}
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Expand/collapse button */}
                        <button
                          type="button"
                          onClick={() => toggleFileExpanded(file.name)}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          title={expanded ? 'Collapse' : 'Expand to edit details'}
                        >
                          <svg
                            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        {/* Upload status icon or file icon */}
                        {uploadStatus?.status === 'uploading' ? (
                          <svg
                            className="animate-spin w-5 h-5 text-blue-500 flex-shrink-0"
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
                        ) : uploadStatus?.status === 'success' ? (
                          <svg
                            className="w-5 h-5 text-green-500 flex-shrink-0"
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
                        ) : uploadStatus?.status === 'error' ? (
                          <svg
                            className="w-5 h-5 text-red-500 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        ) : (
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
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                            {uploadStatus?.status === 'uploading' && (
                              <span className="text-xs text-blue-600 font-medium">Uploading...</span>
                            )}
                            {uploadStatus?.status === 'success' && (
                              <span className="text-xs text-green-600 font-medium">Uploaded</span>
                            )}
                            {uploadStatus?.status === 'error' && (
                              <span className="text-xs text-red-600 font-medium" title={uploadStatus.error}>Failed</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          {uploadStatus?.status === 'error' && (
                            <div className="flex items-center gap-2 mt-0.5">
                              {uploadStatus.error && (
                                <p className="text-xs text-red-500">{uploadStatus.error}</p>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRetryFile(file)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {/* Metadata preview row */}
                          <div className="mt-1">
                            {isFileLoading ? (
                              // Loading spinner
                              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                <svg
                                  className="animate-spin h-3 w-3"
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
                                <span>Extracting metadata...</span>
                              </div>
                            ) : fileError ? (
                              // Error state
                              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span title={fileError}>Metadata extraction failed (file still uploadable)</span>
                              </div>
                            ) : fileMetadata ? (
                              // Metadata preview
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                                {fileMetadata.duration_seconds !== null && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    {formatDuration(fileMetadata.duration_seconds)}
                                  </span>
                                )}
                                {fileMetadata.flight_date !== null && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {formatDate(fileMetadata.flight_date)}
                                  </span>
                                )}
                                {fileMetadata.serial_number !== null && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                    </svg>
                                    {fileMetadata.serial_number}
                                  </span>
                                )}
                                {fileMetadata.takeoff_lat !== null && fileMetadata.takeoff_lon !== null && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    {formatCoordinates(fileMetadata.takeoff_lat, fileMetadata.takeoff_lon)}
                                  </span>
                                )}
                                {fileMetadata.flight_modes && fileMetadata.flight_modes.length > 0 && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    {fileMetadata.flight_modes.slice(0, 2).map((mode, i) => (
                                      <span key={i} className="px-1 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">
                                        {mode}
                                      </span>
                                    ))}
                                    {fileMetadata.flight_modes.length > 2 && (
                                      <span className="text-gray-400">+{fileMetadata.flight_modes.length - 2}</span>
                                    )}
                                  </span>
                                )}
                                {fileMetadata.duration_seconds === null &&
                                  fileMetadata.flight_date === null &&
                                  fileMetadata.serial_number === null &&
                                  fileMetadata.takeoff_lat === null &&
                                  (!fileMetadata.flight_modes || fileMetadata.flight_modes.length === 0) && (
                                  <span className="text-gray-400">No metadata available</span>
                                )}
                              </div>
                            ) : null}
                          </div>
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

                    {/* Expandable override section */}
                    {expanded && (
                      <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                        <div className="space-y-3">
                          {/* Title field - always shown */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Title
                            </label>
                            <input
                              type="text"
                              value={override.title}
                              onChange={(e) => updateFileOverride(file.name, 'title', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={getTitleFromFilename(file.name)}
                            />
                          </div>

                          {/* Optional override fields */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Pilot override */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Pilot <span className="text-gray-400">(override)</span>
                              </label>
                              <input
                                type="text"
                                value={override.pilot}
                                onChange={(e) => updateFileOverride(file.name, 'pilot', e.target.value)}
                                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Use default if empty"
                              />
                            </div>

                            {/* Drone model override */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Drone Model <span className="text-gray-400">(override)</span>
                              </label>
                              <select
                                value={override.drone_model}
                                onChange={(e) => updateFileOverride(file.name, 'drone_model', e.target.value)}
                                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">Use default if empty</option>
                                {DRONE_MODELS.map((model) => (
                                  <option key={model} value={model}>
                                    {model}
                                  </option>
                                ))}
                                {/* Show custom model from default if not in known models */}
                                {formData.drone_model && !DRONE_MODELS.includes(formData.drone_model as DroneModel) && (
                                  <option value={formData.drone_model}>
                                    {formData.drone_model}
                                  </option>
                                )}
                              </select>
                            </div>
                          </div>

                          {/* Comment override */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Comment <span className="text-gray-400">(override)</span>
                            </label>
                            <textarea
                              value={override.comment}
                              onChange={(e) => updateFileOverride(file.name, 'comment', e.target.value)}
                              rows={2}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Use default if empty"
                            />
                          </div>

                          {/* Tags override */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Tags <span className="text-gray-400">(override)</span>
                            </label>
                            <TagInput
                              selectedTags={override.tags}
                              onTagsChange={(tags) => updateFileOverride(file.name, 'tags', tags)}
                              placeholder="Use default if empty"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Batch upload completion summary */}
            {batchUploadComplete && (
              <div className={`p-4 rounded-lg ${isAllFilesSucceeded() ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                {isAllFilesSucceeded() ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-medium text-green-800">
                        All {getBatchUploadSummary().succeeded} files uploaded successfully!
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/')}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
                    >
                      Go to Flight Logs
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-sm font-medium text-amber-800">
                      {getBatchUploadSummary().succeeded} succeeded, {getBatchUploadSummary().failed} failed
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-center gap-3">
              {!batchUploadComplete && (
                <button
                  type="button"
                  onClick={handleBrowseClick}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Add More Files
                </button>
              )}
              {batchUploadComplete && getBatchUploadSummary().succeeded > 0 && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="px-4 py-2 text-sm font-medium text-green-700 bg-white border border-green-300 rounded-md hover:bg-green-50"
                >
                  Clear Completed
                </button>
              )}
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

      {/* Upload Section */}
      {selectedFiles.length > 0 && (
        <div className="mt-6 p-6 bg-white rounded-lg border border-gray-200">
          {/* Error Message */}
          {uploadError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
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

          {/* Upload Button */}
          <button
            type="button"
            onClick={handleBatchUpload}
            disabled={!isBatchUploadValid || isBatchUploading}
            className={`w-full py-3 px-4 text-white font-semibold rounded-md transition-colors flex items-center justify-center gap-2 ${
              isBatchUploadValid && !isBatchUploading
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            {isBatchUploading ? (
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
                {selectedFiles.length === 1
                  ? 'Uploading...'
                  : `Uploading ${batchUploadIndex + 1} of ${selectedFiles.length}...`
                }
              </>
            ) : (
              selectedFiles.length === 1
                ? 'Upload Flight Log'
                : `Upload All (${selectedFiles.length} files)`
            )}
          </button>
        </div>
      )}
    </div>
  )
}
