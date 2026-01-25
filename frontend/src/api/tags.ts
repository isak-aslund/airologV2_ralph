import client from './client'
import type { Tag, TagCreate } from '../types'

/**
 * Get all tags, optionally filtered by search term.
 */
export async function getTags(search?: string): Promise<Tag[]> {
  const params = search ? { search } : undefined
  const response = await client.get<Tag[]>('/tags', { params })
  return response.data
}

/**
 * Create a new tag. Returns existing tag if duplicate.
 */
export async function createTag(name: string): Promise<Tag> {
  const data: TagCreate = { name }
  const response = await client.post<Tag>('/tags', data)
  return response.data
}
