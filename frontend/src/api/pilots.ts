import client from './client'

/**
 * Get list of unique pilot names for autocomplete.
 */
export async function getPilots(): Promise<string[]> {
  const response = await client.get<string[]>('/pilots')
  return response.data
}

/**
 * Get list of unique drone models from the database.
 */
export async function getDroneModels(): Promise<string[]> {
  const response = await client.get<string[]>('/drone-models')
  return response.data
}

export async function getSessions(): Promise<string[]> {
  const response = await client.get<string[]>('/sessions')
  return response.data
}
