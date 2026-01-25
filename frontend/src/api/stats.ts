import client from './client'
import type { Stats } from '../types'

/**
 * Get flight statistics including total flights, hours, and hours by model.
 */
export async function getStats(): Promise<Stats> {
  const response = await client.get<Stats>('/stats')
  return response.data
}
