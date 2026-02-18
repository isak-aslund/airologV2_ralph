import client from './client'
import type { Stats, PilotStatsResponse, RecordsResponse } from '../types'

/**
 * Get flight statistics including total flights, hours, and hours by model.
 */
export async function getStats(): Promise<Stats> {
  const response = await client.get<Stats>('/stats')
  return response.data
}

/**
 * Get per-pilot statistics.
 */
export async function getPilotStats(): Promise<PilotStatsResponse> {
  const response = await client.get<PilotStatsResponse>('/stats/pilots')
  return response.data
}

/**
 * Get fun records and streaks.
 */
export async function getRecords(): Promise<RecordsResponse> {
  const response = await client.get<RecordsResponse>('/stats/records')
  return response.data
}
