import client from './client'

/**
 * Get list of unique pilot names for autocomplete.
 */
export async function getPilots(): Promise<string[]> {
  const response = await client.get<string[]>('/pilots')
  return response.data
}
