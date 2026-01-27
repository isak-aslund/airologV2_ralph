import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createLog, extractMetadata, checkDuplicates } from '../api/logs'
import { getPilots } from '../api/pilots'
import TagInput from '../components/TagInput'
import DroneLogsPanel from '../components/DroneLogsPanel'
import type { DownloadedLog } from '../lib/droneConnection'
import type { ExtractedMetadata, DuplicateCheckResult } from '../types'

// Known drone models as SYS_AUTOSTART values
const DRONE_MODELS: string[] = ['4006', '4010', '4030']  // XLT, S1, CX10

// Map SYS_AUTOSTART values to human-readable model names
const AUTOSTART_TO_MODEL: Record<string, string> = {
  '4006': 'XLT',
  '4010': 'S1',
  '4030': 'CX10',
}

// Format drone model for display: "4030 [CX10]" or just "4001" for unknown models
const formatDroneModel = (autostart: string | null | undefined): string | null => {
  if (!autostart) return null
  const modelName = AUTOSTART_TO_MODEL[autostart]
  if (modelName) {
    return `${autostart} [${modelName}]`
  }
  // For unknown SYS_AUTOSTART values, just show the number
  return autostart
}

// Drone base weights in kg (keyed by SYS_AUTOSTART)
const DRONE_WEIGHTS: Record<string, number> = {
  '4010': 1.65,   // S1
  '4006': 6.9,    // XLT
  '4030': 6.58,   // CX10
}

// Power options per drone type (keyed by SYS_AUTOSTART)
const POWER_OPTIONS: Record<string, Array<{ id: string; label: string; weight: number }>> = {
  '4010': [  // S1
    { id: 's1-small', label: '[S1] Small battery (6S 16Ah)', weight: 1.56 },
    { id: 's1-big', label: '[S1] Big battery (6S 30Ah)', weight: 2.68 },
    { id: 's1-tether', label: '[S1] Tether box', weight: 1.5 },
  ],
  '4006': [  // XLT
    { id: 'xlt-default', label: '[XLT] Default battery (12S 22Ah)', weight: 5.7 },
    { id: 'xlt-tether', label: '[XLT] Tether box', weight: 2.1 },
  ],
  '4030': [  // CX10
    { id: 'cx10-small', label: '[CX10] Small battery (12S 25Ah)', weight: 4.2 },
    { id: 'cx10-big', label: '[CX10] Big battery (12S 50Ah)', weight: 8.0 },
    { id: 'cx10-tether', label: '[CX10] Tether box', weight: 3.15 },
  ],
}

// Payload options (common for all drones)
const PAYLOAD_OPTIONS = [
  { id: 'hadron', label: 'Hadron', weight: 0.54 },
  { id: 'nextvision', label: 'Nextvision', weight: 0.3 },
  { id: 'workswell', label: 'Workswell', weight: 1.2 },
  { id: 'speaker', label: 'Speaker', weight: 0.3 },
  { id: 'sirius-compact', label: 'Sirius Compact', weight: 4.2 },
]

// Get all power options (for non-standard drones)
const getAllPowerOptions = () => {
  const allOptions: Array<{ id: string; label: string; weight: number }> = []
  Object.entries(POWER_OPTIONS).forEach(([, options]) => {
    options.forEach(opt => {
      allOptions.push(opt)
    })
  })
  return allOptions
}

interface FormData {
  title: string
  pilot: string
  drone_model: string  // Can be known model or custom value (e.g., "4001")
  serial_number: string
  comment: string
  tags: string[]
}

// Serial number format: exactly 10 digits
const SERIAL_NUMBER_REGEX = /^\d{10}$/

// Check if serial number has valid format (10 digits)
const isValidSerialFormat = (serial: string | null | undefined): boolean => {
  if (!serial) return false
  return SERIAL_NUMBER_REGEX.test(serial.trim())
}

// Default serial numbers that should not be prefilled
// Pattern: 16925X0000 (where X is 0-9) or 0
const isDefaultSerialNumber = (serial: string | null | undefined): boolean => {
  if (!serial) return false
  const trimmed = serial.trim()
  if (trimmed === '0') return true
  // Pattern: 16925X0000 where X is a digit (0-9)
  return /^16925\d0000$/.test(trimmed)
}

// Get human-readable label for default serial type
const getDefaultSerialLabel = (serial: string): string => {
  if (serial === '0') return 'Generic default'
  if (serial === '1692500000') return 'XLT default'
  if (serial === '1692520000') return 'S1 default'
  if (serial === '1692510000') return 'CX10 default'
  if (/^16925\d0000$/.test(serial)) return 'Factory default'
  return 'Default value'
}

// Get validation error message for serial number
const getSerialValidationError = (serial: string | null | undefined): string | null => {
  if (!serial || !serial.trim()) {
    return 'Serial number is required'
  }
  const trimmed = serial.trim()
  if (!/^\d+$/.test(trimmed)) {
    return 'Serial number must contain only digits (0-9)'
  }
  if (trimmed.length !== 10) {
    return `Serial number must be exactly 10 digits (currently ${trimmed.length})`
  }
  if (isDefaultSerialNumber(trimmed)) {
    return 'This is a model default serial number'
  }
  return null
}

interface FormErrors {
  title?: string
  pilot?: string
  drone_model?: string
  serial_number?: string
}

// Setup data for TOW calculation
interface SetupData {
  droneWeight: number
  power: string | null           // Selected option ID or 'custom'
  customPower: { weight: number; config: string }
  payloads: string[]             // Selected payload IDs
  custom: { name: string; comment: string; weight: number } | null
}

// Per-file override data
interface FileOverride {
  title: string  // Pre-populated from filename (without .ulg)
  pilot: string  // Optional override for pilot
  drone_model: string  // Optional override for drone model (can be custom)
  serial_number: string  // Serial number (required)
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

  // Per-file duplicate check state
  const [fileDuplicateStates, setFileDuplicateStates] = useState<Map<string, DuplicateCheckResult>>(new Map())

  // Batch upload state
  const [isBatchUploading, setIsBatchUploading] = useState(false)
  const [batchUploadIndex, setBatchUploadIndex] = useState(0)
  const [fileUploadStatuses, setFileUploadStatuses] = useState<Map<string, FileUploadStatus>>(new Map())
  const [batchUploadComplete, setBatchUploadComplete] = useState(false)

  // Setup state for TOW calculation
  const [setupData, setSetupData] = useState<SetupData>({
    droneWeight: 0,
    power: null,
    customPower: { weight: 0, config: '' },
    payloads: [],
    custom: null,
  })
  const [showCustomItem, setShowCustomItem] = useState(false)

  // Form state
  const [formData, setFormData] = useState<FormData>({
    title: '',
    pilot: '',
    drone_model: '',
    serial_number: '',
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

  // Get log identifier from filename (filename without .ulg extension)
  // This is used to uniquely identify a log within a drone's serial number
  const getLogIdentifier = (filename: string): string => {
    return filename.replace(/\.ulg$/i, '')
  }

  // Extract drone log ID from filename (format: log_ID_YYYY-MM-DD-HH-MM-SS.ulg)
  const getLogIdFromFilename = (filename: string): number | null => {
    const match = filename.match(/^log_(\d+)_/)
    return match ? parseInt(match[1], 10) : null
  }

  // Compute set of log IDs currently in staging area
  const stagedLogIds = useMemo(() => {
    const ids = new Set<number>()
    for (const file of selectedFiles) {
      const logId = getLogIdFromFilename(file.name)
      if (logId !== null) {
        ids.add(logId)
      }
    }
    return ids
  }, [selectedFiles])

  // Get or create override for a file
  const getFileOverride = (filename: string): FileOverride => {
    const existing = fileOverrides.get(filename)
    if (existing) return existing
    return {
      title: '',
      pilot: '',
      drone_model: '',
      serial_number: '',
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

  // Get the common detected drone model (if all files have the same model)
  const commonDetectedModel = useMemo(() => {
    if (selectedFiles.length === 0) return null

    const models = new Set<string>()
    for (const file of selectedFiles) {
      const meta = fileMetadataStates.get(file.name)?.metadata
      if (meta?.drone_model && meta.drone_model !== 'unknown') {
        models.add(meta.drone_model)
      }
    }
    // Return the common model if exactly one unique model, otherwise null
    if (models.size === 1) {
      return Array.from(models)[0]
    }
    return null
  }, [selectedFiles, fileMetadataStates])

  // Check if all files have the same drone model (for showing/hiding default drone model field)
  const allFilesSameDroneModel = commonDetectedModel !== null || selectedFiles.length <= 1

  // Effective drone model for Setup section: user selection or common detected model
  const effectiveDroneModel = formData.drone_model || commonDetectedModel || ''

  // Update drone weight and reset power when effective drone model changes
  useEffect(() => {
    const knownWeight = DRONE_WEIGHTS[effectiveDroneModel]
    setSetupData(prev => ({
      ...prev,
      droneWeight: knownWeight ?? 0,
      power: null,  // Reset power selection when model changes
      customPower: { weight: 0, config: '' },
    }))
  }, [effectiveDroneModel])

  // Calculate TOW
  const tow = useMemo(() => {
    let total = setupData.droneWeight

    // Add power weight
    if (setupData.power === 'custom') {
      total += setupData.customPower.weight
    } else if (setupData.power) {
      // Find the selected power option
      const options = DRONE_WEIGHTS[effectiveDroneModel] ? POWER_OPTIONS[effectiveDroneModel] : getAllPowerOptions()
      const selectedOption = options?.find(opt => opt.id === setupData.power)
      if (selectedOption) {
        total += selectedOption.weight
      }
    }

    // Add payload weights
    for (const payloadId of setupData.payloads) {
      const payload = PAYLOAD_OPTIONS.find(p => p.id === payloadId)
      if (payload) {
        total += payload.weight
      }
    }

    // Add custom item weight
    if (setupData.custom) {
      total += setupData.custom.weight
    }

    return total
  }, [setupData, effectiveDroneModel])

  // Check if setup is valid (drone weight > 0 and power selected)
  const isSetupValid = setupData.droneWeight > 0 && setupData.power !== null

  // Get effective serial number for a file (considering override, metadata, and default)
  const getEffectiveSerialNumber = (filename: string): string => {
    const override = getFileOverride(filename)
    const fileMetadata = fileMetadataStates.get(filename)?.metadata

    // Priority: 1. File override, 2. Metadata (if not default), 3. Default form value
    if (override.serial_number.trim()) {
      return override.serial_number.trim()
    }
    if (fileMetadata?.serial_number && !isDefaultSerialNumber(fileMetadata.serial_number)) {
      return fileMetadata.serial_number
    }
    return formData.serial_number.trim()
  }

  // Check if a file has a valid serial number (correct format and not a default)
  const hasValidSerialNumber = (filename: string): boolean => {
    const serial = getEffectiveSerialNumber(filename)
    return isValidSerialFormat(serial) && !isDefaultSerialNumber(serial)
  }

  // Get validation error for a file's serial number
  const getFileSerialError = (filename: string): string | null => {
    const serial = getEffectiveSerialNumber(filename)
    return getSerialValidationError(serial)
  }

  // Check if all files have valid serial numbers
  const allFilesHaveValidSerialNumbers = selectedFiles.every(file => hasValidSerialNumber(file.name))

  // Check if a file is a duplicate (already in database)
  const isFileDuplicate = (filename: string): boolean => {
    const dupState = fileDuplicateStates.get(filename)
    return dupState?.exists ?? false
  }

  
  // Check for duplicates when files have valid serial numbers
  useEffect(() => {
    const checkFileDuplicates = async () => {
      // Build list of files to check (those with valid serial numbers)
      const itemsToCheck: { filename: string; serial_number: string; log_identifier: string }[] = []

      for (const file of selectedFiles) {
        const serial = getEffectiveSerialNumber(file.name)
        if (isValidSerialFormat(serial) && !isDefaultSerialNumber(serial)) {
          const logId = getLogIdentifier(file.name)
          // Only check if we haven't already checked this combo
          const existing = fileDuplicateStates.get(file.name)
          if (!existing || existing.serial_number !== serial || existing.log_identifier !== logId) {
            itemsToCheck.push({
              filename: file.name,
              serial_number: serial,
              log_identifier: logId,
            })
          }
        }
      }

      if (itemsToCheck.length === 0) return

      try {
        const response = await checkDuplicates({
          items: itemsToCheck.map(item => ({
            serial_number: item.serial_number,
            log_identifier: item.log_identifier,
          })),
        })

        // Update duplicate states
        setFileDuplicateStates(prev => {
          const newMap = new Map(prev)
          for (let i = 0; i < itemsToCheck.length; i++) {
            const item = itemsToCheck[i]
            const result = response.results[i]
            if (result) {
              newMap.set(item.filename, result)
            }
          }
          return newMap
        })
      } catch (error) {
        console.error('Failed to check duplicates:', error)
      }
    }

    checkFileDuplicates()
  }, [selectedFiles, fileMetadataStates, fileOverrides, formData.serial_number])

  // Count files that are duplicates
  const duplicateFileCount = selectedFiles.filter(file => isFileDuplicate(file.name)).length

  // Files that can be uploaded (not duplicates and have valid serial)
  const uploadableFiles = selectedFiles.filter(file => hasValidSerialNumber(file.name) && !isFileDuplicate(file.name))

  // Check if all files have a valid drone model (from override, default, or detected metadata)
  const allFilesHaveDroneModel = useMemo(() => {
    if (formData.drone_model) return true  // Default is set, all files will use it
    // Check each file has its own drone model
    return selectedFiles.every(file => {
      const override = fileOverrides.get(file.name)
      if (override?.drone_model) return true
      const metadata = fileMetadataStates.get(file.name)?.metadata
      return metadata?.drone_model && metadata.drone_model !== 'unknown'
    })
  }, [formData.drone_model, selectedFiles, fileOverrides, fileMetadataStates])

  // Check if upload is valid (defaults set + files selected + all have valid serial numbers + no duplicates)
  const isBatchUploadValid = formData.pilot.trim() && allFilesHaveDroneModel && uploadableFiles.length > 0 && allFilesHaveValidSerialNumbers && duplicateFileCount === 0 && isSetupValid

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

        // Use per-file title, default title, or filename
        const title = override.title.trim() || formData.title.trim() || getTitleFromFilename(file.name)
        uploadData.append('title', title)

        // Use per-file override or default
        const pilot = override.pilot.trim() || formData.pilot.trim()
        uploadData.append('pilot', pilot)

        // Drone model: per-file override, or default, or detected from metadata
        const fileMetadata = fileMetadataStates.get(file.name)?.metadata
        const droneModel = override.drone_model || formData.drone_model || fileMetadata?.drone_model || ''
        uploadData.append('drone_model', droneModel)

        // Comment: per-file override or default (if any)
        const comment = override.comment.trim() || formData.comment.trim()
        if (comment) {
          uploadData.append('comment', comment)
        }

        // Serial number (required) - use effective serial number
        const serialNumber = getEffectiveSerialNumber(file.name)
        uploadData.append('serial_number', serialNumber)

        // Tags: per-file override or default
        const tags = override.tags.length > 0 ? override.tags : formData.tags
        if (tags.length > 0) {
          uploadData.append('tags', tags.join(','))
        }

        // TOW
        if (tow > 0) {
          uploadData.append('tow', tow.toString())
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

    // Mark as uploading
    setFileUploadStatuses(prev => {
      const newMap = new Map(prev)
      newMap.set(file.name, { status: 'uploading' })
      return newMap
    })

    try {
      const uploadData = new FormData()
      uploadData.append('file', file)

      // Use per-file title, default title, or filename
      const title = override.title.trim() || formData.title.trim() || getTitleFromFilename(file.name)
      uploadData.append('title', title)

      // Use per-file override or default
      const pilot = override.pilot.trim() || formData.pilot.trim()
      uploadData.append('pilot', pilot)

      // Drone model: per-file override, or default, or detected from metadata
      const droneModel = override.drone_model || formData.drone_model || metadata?.drone_model || ''
      uploadData.append('drone_model', droneModel)

      // Comment: per-file override or default (if any)
      const comment = override.comment.trim() || formData.comment.trim()
      if (comment) {
        uploadData.append('comment', comment)
      }

      // Serial number (required) - use effective serial number
      const serialNumber = getEffectiveSerialNumber(file.name)
      uploadData.append('serial_number', serialNumber)

      // Tags: per-file override or default
      const tags = override.tags.length > 0 ? override.tags : formData.tags
      if (tags.length > 0) {
        uploadData.append('tags', tags.join(','))
      }

      // TOW
      if (tow > 0) {
        uploadData.append('tow', tow.toString())
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
      setFileDuplicateStates(prev => {
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
        serial_number: '',
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
    setFileDuplicateStates(new Map())
    setMetadata(null)
    setFromDrone(false)
    setIsBatchUploading(false)
    setBatchUploadIndex(0)
    setBatchUploadComplete(false)
    setFormData({
      title: '',
      pilot: '',
      drone_model: '',
      serial_number: '',
      comment: '',
      tags: [],
    })
    setSetupData({
      droneWeight: 0,
      power: null,
      customPower: { weight: 0, config: '' },
      payloads: [],
      custom: null,
    })
    setShowCustomItem(false)
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
        <DroneLogsPanel onLogsDownloaded={handleDroneLogsDownloaded} stagedLogIds={stagedLogIds} />
      </div>

      {/* File Selection Area - moved to top */}
      <div
        className={`
          mb-6 border-2 border-dashed rounded-lg p-8 text-center transition-colors
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
                        ) : isFileDuplicate(file.name) ? (
                          // Red cloud icon for duplicates
                          <span title="Already in database">
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
                                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                              />
                            </svg>
                          </span>
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
                            {!uploadStatus && isFileDuplicate(file.name) && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium" title="This log already exists in the database">
                                Already in database
                              </span>
                            )}
                            {!uploadStatus && !isFileDuplicate(file.name) && !hasValidSerialNumber(file.name) && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 font-medium" title="Serial number required">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                No S/N
                              </span>
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
                                {fileMetadata.drone_model && (
                                  <span className="inline-flex items-center gap-1">
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                    </svg>
                                    {formatDroneModel(fileMetadata.drone_model)}
                                  </span>
                                )}
                                {fileMetadata.serial_number !== null && (
                                  isDefaultSerialNumber(fileMetadata.serial_number) ? (
                                    <span className="inline-flex items-center gap-1 text-amber-600" title={`AIROLIT_SERIAL=${fileMetadata.serial_number} is a model default. Each drone must have a unique serial number. Update the PX4 AIROLIT_SERIAL parameter or enter one manually.`}>
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                      </svg>
                                      S/N: {fileMetadata.serial_number} ({getDefaultSerialLabel(fileMetadata.serial_number)})
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1">
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                      </svg>
                                      S/N: {fileMetadata.serial_number}
                                    </span>
                                  )
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
                                  !fileMetadata.drone_model &&
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
                              Title <span className="text-gray-400">(override)</span>
                            </label>
                            <input
                              type="text"
                              value={override.title}
                              onChange={(e) => updateFileOverride(file.name, 'title', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={formData.title || getTitleFromFilename(file.name)}
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
                                {fileMetadata?.drone_model && (
                                  <span className="text-gray-400 font-normal ml-1">(detected: {formatDroneModel(fileMetadata.drone_model)})</span>
                                )}
                              </label>
                              <select
                                value={override.drone_model}
                                onChange={(e) => updateFileOverride(file.name, 'drone_model', e.target.value)}
                                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">Use default if empty</option>
                                {DRONE_MODELS.map((model) => (
                                  <option key={model} value={model}>
                                    {formatDroneModel(model)}
                                  </option>
                                ))}
                                {/* Show custom model from default if not in known models */}
                                {formData.drone_model && !DRONE_MODELS.includes(formData.drone_model) && (
                                  <option value={formData.drone_model}>
                                    {formData.drone_model}
                                  </option>
                                )}
                              </select>
                            </div>
                          </div>

                          {/* Serial Number */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Serial Number <span className="text-red-500">*</span>
                              {fileMetadata?.serial_number && !isDefaultSerialNumber(fileMetadata.serial_number) && (
                                <span className="text-gray-400 font-normal ml-1">(from metadata)</span>
                              )}
                            </label>
                            {fileMetadata?.serial_number && isDefaultSerialNumber(fileMetadata.serial_number) && (
                              <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                                <div className="flex items-start gap-1.5">
                                  <svg className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                  <div>
                                    <span className="font-medium">AIROLIT_SERIAL={fileMetadata.serial_number}</span> is a model default ({getDefaultSerialLabel(fileMetadata.serial_number)}).
                                    <br />
                                    Each drone must have a unique serial number. Please update the PX4 <code className="bg-amber-100 px-1 rounded">AIROLIT_SERIAL</code> parameter to a unique value, or enter one manually below.
                                  </div>
                                </div>
                              </div>
                            )}
                            <input
                              type="text"
                              value={override.serial_number}
                              onChange={(e) => updateFileOverride(file.name, 'serial_number', e.target.value)}
                              className={`w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                !hasValidSerialNumber(file.name) ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                              }`}
                              placeholder={
                                fileMetadata?.serial_number && !isDefaultSerialNumber(fileMetadata.serial_number)
                                  ? fileMetadata.serial_number
                                  : formData.serial_number || 'Enter serial number'
                              }
                            />
                            {!hasValidSerialNumber(file.name) && (
                              <p className="mt-1 text-xs text-amber-600">
                                {getFileSerialError(file.name) || 'Serial number required'}
                              </p>
                            )}
                            {hasValidSerialNumber(file.name) && (
                              <p className="mt-1 text-xs text-green-600">
                                Valid serial number
                              </p>
                            )}
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

      {/* Defaults for all files - shown when files are selected */}
      {selectedFiles.length > 0 && (
        <div className="mb-6 p-6 bg-white rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Defaults for all files</h2>

          {/* Title - spans full width */}
          <div className="mb-4">
            <label htmlFor="default-title" className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              id="default-title"
              value={formData.title}
              onChange={(e) => handleFormChange('title', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Leave empty to use filename"
            />
            <p className="mt-1 text-xs text-gray-500">
              Applied to all files unless overridden individually
            </p>
          </div>

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
                  !formData.pilot.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="Enter pilot name"
                autoComplete="off"
              />
              {formErrors.pilot && (
                <p className="mt-1 text-sm text-red-600">{formErrors.pilot}</p>
              )}
              {!formData.pilot.trim() && !formErrors.pilot && (
                <p className="mt-1 text-sm text-red-600">Pilot name is required</p>
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

            {/* Drone Model - only show if all files have the same model */}
            {allFilesSameDroneModel ? (
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
                      {formatDroneModel(model)}
                    </option>
                  ))}
                  {/* Show custom model if not in known models list */}
                  {formData.drone_model && !DRONE_MODELS.includes(formData.drone_model) && (
                    <option value={formData.drone_model}>
                      {formData.drone_model}
                    </option>
                  )}
                </select>
                {formErrors.drone_model && (
                  <p className="mt-1 text-sm text-red-600">{formErrors.drone_model}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-md">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Files have different drone models - each will use its detected model</span>
              </div>
            )}
          </div>

          {/* Serial Number - only show if files need it */}
          {selectedFiles.some(file => {
            const fileMetadata = fileMetadataStates.get(file.name)?.metadata
            const override = getFileOverride(file.name)
            // Show default serial field if any file needs a serial number
            // (no override, and either no metadata serial or metadata serial is a default)
            return !override.serial_number.trim() &&
              (!fileMetadata?.serial_number || isDefaultSerialNumber(fileMetadata.serial_number))
          }) && (
            <div className="mt-4">
              <label htmlFor="default-serial-number" className="block text-sm font-medium text-gray-700 mb-1">
                Default Serial Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="default-serial-number"
                value={formData.serial_number}
                onChange={(e) => handleFormChange('serial_number', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formData.serial_number && getSerialValidationError(formData.serial_number)
                    ? 'border-amber-400 bg-amber-50'
                    : formData.serial_number && !getSerialValidationError(formData.serial_number)
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-300'
                }`}
                placeholder="e.g. 1234567890"
                maxLength={10}
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be exactly 10 digits. Used for files without a valid AIROLIT_SERIAL in metadata.
              </p>
              {formData.serial_number && getSerialValidationError(formData.serial_number) && (
                <p className="mt-1 text-sm text-amber-600">{getSerialValidationError(formData.serial_number)}</p>
              )}
              {formData.serial_number && !getSerialValidationError(formData.serial_number) && (
                <p className="mt-1 text-sm text-green-600">Valid serial number</p>
              )}
            </div>
          )}

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

      {/* Setup Section - shown when files are selected */}
      {selectedFiles.length > 0 && (
        <div className="mb-6 p-6 bg-white rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Setup</h2>

          {/* Drone Weight */}
          <div className="mb-4">
            <label htmlFor="drone-weight" className="block text-sm font-medium text-gray-700 mb-1">
              Drone Weight <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                id="drone-weight"
                value={setupData.droneWeight || ''}
                onChange={(e) => setSetupData(prev => ({ ...prev, droneWeight: parseFloat(e.target.value) || 0 }))}
                step="0.01"
                min="0"
                className={`w-32 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  setupData.droneWeight <= 0 ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="0.00"
              />
              <span className="text-sm text-gray-500">kg</span>
              {DRONE_WEIGHTS[effectiveDroneModel] && (
                <span className="text-xs text-gray-400">(prefilled for {formatDroneModel(effectiveDroneModel)})</span>
              )}
            </div>
            {setupData.droneWeight <= 0 && (
              <p className="mt-1 text-sm text-red-600">Drone weight must be greater than 0</p>
            )}
          </div>

          {/* Power */}
          <div className="mb-4">
            <label htmlFor="power-select" className="block text-sm font-medium text-gray-700 mb-1">
              Power <span className="text-red-500">*</span>
            </label>
            <select
              id="power-select"
              value={setupData.power || ''}
              onChange={(e) => {
                const value = e.target.value || null
                setSetupData(prev => ({
                  ...prev,
                  power: value,
                  customPower: value === 'custom' ? prev.customPower : { weight: 0, config: '' },
                }))
              }}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                !setupData.power ? 'border-red-500 bg-red-50' : 'border-gray-300'
              }`}
            >
              <option value="">Select power source</option>
              {(DRONE_WEIGHTS[effectiveDroneModel] ? POWER_OPTIONS[effectiveDroneModel] : getAllPowerOptions())?.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} ({opt.weight} kg)
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>
            {!setupData.power && (
              <p className="mt-1 text-sm text-red-600">Power source is required</p>
            )}

            {/* Custom power fields */}
            {setupData.power === 'custom' && (
              <div className="mt-3 p-3 bg-gray-50 rounded-md border border-gray-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Weight (kg)</label>
                    <input
                      type="number"
                      value={setupData.customPower.weight || ''}
                      onChange={(e) => setSetupData(prev => ({
                        ...prev,
                        customPower: { ...prev.customPower, weight: parseFloat(e.target.value) || 0 },
                      }))}
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Config/Description</label>
                    <input
                      type="text"
                      value={setupData.customPower.config}
                      onChange={(e) => setSetupData(prev => ({
                        ...prev,
                        customPower: { ...prev.customPower, config: e.target.value },
                      }))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Custom 10S 20Ah"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Payloads */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payload <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="space-y-2">
              {PAYLOAD_OPTIONS.map(payload => (
                <label key={payload.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupData.payloads.includes(payload.id)}
                    onChange={(e) => {
                      setSetupData(prev => ({
                        ...prev,
                        payloads: e.target.checked
                          ? [...prev.payloads, payload.id]
                          : prev.payloads.filter(id => id !== payload.id),
                      }))
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{payload.label}</span>
                  <span className="text-xs text-gray-500">({payload.weight} kg)</span>
                </label>
              ))}
            </div>
          </div>

          {/* Custom Item */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            {!showCustomItem && !setupData.custom ? (
              <button
                type="button"
                onClick={() => setShowCustomItem(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add custom item
              </button>
            ) : (
              <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={setupData.custom?.name || ''}
                      onChange={(e) => setSetupData(prev => ({
                        ...prev,
                        custom: { name: e.target.value, comment: prev.custom?.comment || '', weight: prev.custom?.weight || 0 },
                      }))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Item name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Comment</label>
                    <input
                      type="text"
                      value={setupData.custom?.comment || ''}
                      onChange={(e) => setSetupData(prev => ({
                        ...prev,
                        custom: { name: prev.custom?.name || '', comment: e.target.value, weight: prev.custom?.weight || 0 },
                      }))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Weight (kg)</label>
                    <input
                      type="number"
                      value={setupData.custom?.weight || ''}
                      onChange={(e) => setSetupData(prev => ({
                        ...prev,
                        custom: { name: prev.custom?.name || '', comment: prev.custom?.comment || '', weight: parseFloat(e.target.value) || 0 },
                      }))}
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSetupData(prev => ({ ...prev, custom: null }))
                    setShowCustomItem(false)
                  }}
                  className="mt-2 text-xs text-red-600 hover:text-red-700"
                >
                  Remove custom item
                </button>
              </div>
            )}
          </div>

          {/* TOW Display */}
          <div className="pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">TOW (Takeoff Weight)</span>
              <span className="text-lg font-semibold text-gray-900">{tow.toFixed(2)} kg</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Calculated from drone weight + power + payloads + custom items
            </p>
          </div>
        </div>
      )}

      {/* Upload Section */}
      {selectedFiles.length > 0 && (
        <div className="mt-6 p-6 bg-white rounded-lg border border-gray-200">
          {/* Validation warnings */}
          {!allFilesHaveValidSerialNumbers && selectedFiles.length > 0 && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800">Valid serial number required</p>
                  <p className="text-sm text-amber-700 mt-1">
                    {selectedFiles.filter(f => !hasValidSerialNumber(f.name)).length} file(s) need a valid serial number.
                    Serial numbers must be exactly 10 digits and not a model default.
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    Expand the file(s) to enter a serial number, or set a default serial number above.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Setup validation warning */}
          {!isSetupValid && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800">Setup incomplete</p>
                  <p className="text-sm text-amber-700 mt-1">
                    {setupData.droneWeight <= 0 && 'Drone weight must be greater than 0. '}
                    {!setupData.power && 'Power source is required.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Duplicate warning */}
          {duplicateFileCount > 0 && (
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
                    d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-800">Duplicate logs detected</p>
                  <p className="text-sm text-red-700 mt-1">
                    {duplicateFileCount} file(s) already exist in the database and cannot be uploaded again.
                    Remove these files to continue.
                  </p>
                </div>
              </div>
            </div>
          )}

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
