/**
 * TypeScript types matching the backend API schemas.
 */

// Drone model enum/union type
export type DroneModel = 'XLT' | 'S1' | 'CX10';

// Tag type
export interface Tag {
  id: number;
  name: string;
}

// Flight log type with all fields including tags array
export interface FlightLog {
  id: string;
  title: string;
  pilot: string;
  serial_number: string | null;
  drone_model: DroneModel;
  duration_seconds: number | null;
  file_path: string;
  comment: string | null;
  takeoff_lat: number | null;
  takeoff_lon: number | null;
  flight_date: string | null; // ISO date string
  created_at: string; // ISO datetime string
  updated_at: string; // ISO datetime string
  tags: Tag[];
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
  hours_by_model: Record<DroneModel, number>;
}

// Request types for creating/updating flight logs
export interface FlightLogCreate {
  title: string;
  pilot: string;
  drone_model: DroneModel;
  serial_number?: string | null;
  duration_seconds?: number | null;
  comment?: string | null;
  takeoff_lat?: number | null;
  takeoff_lon?: number | null;
  flight_date?: string | null;
  tags?: string[];
}

export interface FlightLogUpdate {
  title?: string;
  pilot?: string;
  drone_model?: DroneModel;
  comment?: string | null;
  tags?: string[];
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
  date_from?: string; // ISO date
  date_to?: string; // ISO date
}

// Extracted metadata from a .ulg file
export interface ExtractedMetadata {
  duration_seconds: number | null;
  flight_date: string | null; // ISO datetime string
  serial_number: string | null;
  takeoff_lat: number | null;
  takeoff_lon: number | null;
}
