import { useState, useEffect, useRef } from 'react'
import { getTags, createTag } from '../api/tags'
import type { Tag } from '../types'

interface TagInputProps {
  selectedTags: string[]
  onTagsChange: (tags: string[]) => void
  placeholder?: string
}

export default function TagInput({
  selectedTags,
  onTagsChange,
  placeholder = 'Search or create tags...',
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<Tag[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch suggestions when input changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (inputValue.trim() === '') {
      // Fetch all tags when input is empty but dropdown is open
      if (isDropdownOpen) {
        fetchTags('')
      } else {
        setSuggestions([])
      }
      return
    }

    debounceRef.current = setTimeout(() => {
      fetchTags(inputValue.trim())
    }, 200)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [inputValue, isDropdownOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchTags(search: string) {
    try {
      setIsLoading(true)
      const tags = await getTags(search || undefined)
      // Filter out already selected tags
      const filteredTags = tags.filter((tag) => !selectedTags.includes(tag.name))
      setSuggestions(filteredTags)
    } catch (err) {
      console.error('Error fetching tags:', err)
      setSuggestions([])
    } finally {
      setIsLoading(false)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
    if (!isDropdownOpen) {
      setIsDropdownOpen(true)
    }
  }

  function handleInputFocus() {
    setIsDropdownOpen(true)
    if (inputValue.trim() === '') {
      fetchTags('')
    }
  }

  function handleSelectTag(tagName: string) {
    if (!selectedTags.includes(tagName)) {
      onTagsChange([...selectedTags, tagName])
    }
    setInputValue('')
    setSuggestions([])
    setIsDropdownOpen(false)
    inputRef.current?.focus()
  }

  function handleRemoveTag(tagName: string) {
    onTagsChange(selectedTags.filter((t) => t !== tagName))
  }

  async function handleCreateTag() {
    const tagName = inputValue.trim().toLowerCase()
    if (!tagName || selectedTags.includes(tagName)) {
      return
    }

    try {
      setIsCreating(true)
      await createTag(tagName)
      handleSelectTag(tagName)
    } catch (err) {
      console.error('Error creating tag:', err)
    } finally {
      setIsCreating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmedInput = inputValue.trim().toLowerCase()

      // If there's an exact match in suggestions, select it
      const exactMatch = suggestions.find((tag) => tag.name === trimmedInput)
      if (exactMatch) {
        handleSelectTag(exactMatch.name)
        return
      }

      // If no exact match and input is not empty, create new tag
      if (trimmedInput && !selectedTags.includes(trimmedInput)) {
        handleCreateTag()
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false)
      inputRef.current?.blur()
    } else if (e.key === 'Backspace' && inputValue === '' && selectedTags.length > 0) {
      // Remove last tag when backspace on empty input
      onTagsChange(selectedTags.slice(0, -1))
    }
  }

  // Check if current input value can create a new tag
  const canCreateTag =
    inputValue.trim() !== '' &&
    !selectedTags.includes(inputValue.trim().toLowerCase()) &&
    !suggestions.some((tag) => tag.name === inputValue.trim().toLowerCase())

  return (
    <div ref={containerRef} className="relative">
      {/* Input container with selected tags as chips */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 border border-gray-300 rounded-md bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent min-h-[42px]">
        {/* Selected tags as removable chips */}
        {selectedTags.map((tagName) => (
          <span
            key={tagName}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-sm bg-blue-100 text-blue-800 rounded-full"
          >
            {tagName}
            <button
              type="button"
              onClick={() => handleRemoveTag(tagName)}
              className="hover:bg-blue-200 rounded-full p-0.5 focus:outline-none"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </span>
        ))}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={selectedTags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none text-sm text-gray-900 placeholder-gray-500"
        />
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden">
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
          ) : (
            <>
              {/* Suggestions list */}
              {suggestions.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  {suggestions.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleSelectTag(tag.name)}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Create new tag option */}
              {canCreateTag && (
                <button
                  type="button"
                  onClick={handleCreateTag}
                  disabled={isCreating}
                  className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-t border-gray-200 disabled:opacity-50"
                >
                  {isCreating ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="animate-spin h-4 w-4"
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
                      Creating...
                    </span>
                  ) : (
                    <>Create: {inputValue.trim().toLowerCase()}</>
                  )}
                </button>
              )}

              {/* Empty state */}
              {suggestions.length === 0 && !canCreateTag && inputValue.trim() === '' && (
                <div className="px-3 py-2 text-sm text-gray-500">
                  No tags available. Type to create one.
                </div>
              )}

              {suggestions.length === 0 && !canCreateTag && inputValue.trim() !== '' && (
                <div className="px-3 py-2 text-sm text-gray-500">
                  Tag already selected.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
