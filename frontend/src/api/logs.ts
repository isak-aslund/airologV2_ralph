import client from './client'
import type {
  DuplicateCheckRequest,
  DuplicateCheckResponse,
  ExtractedMetadata,
  FlightLog,
  FlightLogUpdate,
  LogListParams,
  PaginatedResponse,
} from '../types'

/**
 * Get paginated list of flight logs with optional filters.
 */
export async function getLogs(params?: LogListParams): Promise<PaginatedResponse<FlightLog>> {
  const response = await client.get<PaginatedResponse<FlightLog>>('/logs', { params })
  return response.data
}

/**
 * Get a single flight log by ID.
 */
export async function getLog(id: string): Promise<FlightLog> {
  const response = await client.get<FlightLog>(`/logs/${id}`)
  return response.data
}

/**
 * Create a new flight log with file upload.
 * @param formData - FormData containing file and metadata fields
 */
export async function createLog(formData: FormData): Promise<FlightLog> {
  const response = await client.post<FlightLog>('/logs', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data
}

/**
 * Update an existing flight log.
 */
export async function updateLog(id: string, data: FlightLogUpdate): Promise<FlightLog> {
  const response = await client.put<FlightLog>(`/logs/${id}`, data)
  return response.data
}

/**
 * Delete a flight log by ID.
 */
export async function deleteLog(id: string): Promise<void> {
  await client.delete(`/logs/${id}`)
}

/**
 * Download the ULog file for a flight log.
 * Returns the file as a Blob for browser download.
 */
export async function downloadLog(id: string): Promise<Blob> {
  const response = await client.get(`/logs/${id}/download`, {
    responseType: 'blob',
  })
  return response.data
}

/**
 * Parameter data with value, defaults, and modified flags.
 */
export interface ParameterData {
  value: unknown
  firmwareDefault: unknown | null
  frameDefault: unknown | null
  modifiedFromFirmware: boolean
  modifiedFromFrame: boolean
}

/**
 * Get parameters from the ULog file for a flight log.
 * Returns parameters with their values, defaults, and modified status.
 */
export async function getParameters(id: string): Promise<Record<string, ParameterData>> {
  const response = await client.get<Record<string, ParameterData>>(`/logs/${id}/parameters`)
  return response.data
}

/**
 * Extract metadata from a .ulg file without storing it.
 * Used during upload to pre-populate form fields.
 * @param file - The .ulg file to extract metadata from
 */
export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await client.post<ExtractedMetadata>('/extract-metadata', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data
}

/**
 * Upload a flight log to the Flight Review server.
 * If already uploaded, returns the existing URL.
 */
export async function uploadToFlightReview(id: string): Promise<{ flight_review_id: string; url: string }> {
  const response = await client.post<{ flight_review_id: string; url: string }>(`/logs/${id}/upload-to-flight-review`)
  return response.data
}

/**
 * Check if logs already exist in the database.
 * Used to prevent duplicate uploads.
 */
export async function checkDuplicates(request: DuplicateCheckRequest): Promise<DuplicateCheckResponse> {
  const response = await client.post<DuplicateCheckResponse>('/logs/check-duplicates', request)
  return response.data
}
