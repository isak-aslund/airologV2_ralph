/**
 * TypeScript types matching the backend API schemas.
 */

// Known drone models as SYS_AUTOSTART values (for UI dropdowns)
export type DroneModel = '4006' | '4010' | '4030';  // XLT, S1, CX10

// Tag type
export interface Tag {
  id: number;
  name: string;
}

// Attachment type for files associated with flight logs
export interface Attachment {
  id: string;
  filename: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

// Flight log type with all fields including tags array
export interface FlightLog {
  id: string;
  title: string;
  pilot: string;
  serial_number: string | null;
  log_identifier: string | null; // Unique identifier within a drone (from filename)
  drone_model: string;
  duration_seconds: number | null;
  file_path: string;
  comment: string | null;
  takeoff_lat: number | null;
  takeoff_lon: number | null;
  flight_date: string | null; // ISO date string
  flight_review_id: string | null; // ID on Flight Review server (null if not uploaded)
  flight_modes: string[]; // Auto-extracted flight modes from ULog
  tow: number | null; // Takeoff weight in kg
  created_at: string; // ISO datetime string
  updated_at: string; // ISO datetime string
  tags: Tag[];
  attachments: Attachment[];
}

// Generic paginated response type
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Stats type for flight statistics
export interface Stats {
  total_flights: number;
  total_hours: number;
  hours_by_model: Record<string, number>;
}

// Request types for creating/updating flight logs
export interface FlightLogCreate {
  title: string;
  pilot: string;
  drone_model: string;
  serial_number?: string | null;
  duration_seconds?: number | null;
  comment?: string | null;
  takeoff_lat?: number | null;
  takeoff_lon?: number | null;
  flight_date?: string | null;
  tags?: string[];
  tow?: number | null;
}

export interface FlightLogUpdate {
  title?: string;
  pilot?: string;
  drone_model?: string;
  comment?: string | null;
  tags?: string[];
  tow?: number | null;
  flight_date?: string | null;
}

// Tag creation request
export interface TagCreate {
  name: string;
}

// Filter parameters for log list endpoint
export interface LogListParams {
  page?: number;
  per_page?: 25 | 50 | 100;
  search?: string;
  drone_model?: string; // Comma-separated DroneModel values
  pilot?: string;
  tags?: string; // Comma-separated tag names
  flight_modes?: string; // Comma-separated flight mode names
  date_from?: string; // ISO date
  date_to?: string; // ISO date
  tow_min?: number; // Minimum takeoff weight in kg
  tow_max?: number; // Maximum takeoff weight in kg
  has_attachments?: boolean; // Filter by whether log has attachments
}

// Extracted metadata from a .ulg file
export interface ExtractedMetadata {
  duration_seconds: number | null;
  flight_date: string | null; // ISO datetime string
  serial_number: string | null;
  drone_model: string | null; // SYS_AUTOSTART value (e.g., "4030", "4010", "4006")
  log_identifier: string | null; // Unique identifier derived from filename
  takeoff_lat: number | null;
  takeoff_lon: number | null;
  flight_modes: string[]; // Auto-extracted flight modes from ULog
}

// Duplicate check types
export interface DuplicateCheckItem {
  serial_number: string;
  log_identifier: string;
}

export interface DuplicateCheckRequest {
  items: DuplicateCheckItem[];
}

export interface DuplicateCheckResult {
  serial_number: string;
  log_identifier: string;
  exists: boolean;
  existing_log_id: string | null;
}

export interface DuplicateCheckResponse {
  results: DuplicateCheckResult[];
}

// Pilot stats types
export interface PilotStatsEntry {
  pilot: string;
  total_flights: number;
  total_hours: number;
  hours_by_model: Record<string, number>;
  longest_flight_seconds: number;
  most_recent_flight: string | null;
}

export interface PilotStatsResponse {
  pilots: PilotStatsEntry[];
}

// Records types
export interface RecordEntry {
  pilot: string;
  duration_seconds: number;
  flight_date: string | null;
  drone_model: string;
}

export interface DayRecord {
  date: string;
  flight_count: number;
  pilots: string[];
}

export interface WeekRecord {
  week_start: string;
  flight_count: number;
}

export interface RecordsResponse {
  longest_flight: RecordEntry | null;
  most_flights_in_a_day: DayRecord | null;
  busiest_week: WeekRecord | null;
  current_streak_days: number;
  total_flight_days: number;
}
