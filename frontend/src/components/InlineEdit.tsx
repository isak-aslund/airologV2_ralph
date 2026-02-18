import { useState, useRef, useEffect } from 'react'

interface InlineEditProps {
  value: string
  onSave: (newValue: string) => Promise<void> | void
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea'
  options?: { value: string; label: string }[]
  displayValue?: string
  placeholder?: string
  step?: string
  suffix?: string
}

export default function InlineEdit({
  value,
  onSave,
  type = 'text',
  options,
  displayValue,
  placeholder = 'Click to edit',
  step,
  suffix,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (type !== 'select' && 'select' in inputRef.current) {
        (inputRef.current as HTMLInputElement).select()
      }
    }
  }, [editing, type])

  const handleSave = async () => {
    if (draft === value) {
      setEditing(false)
      return
    }
    try {
      setSaving(true)
      await onSave(draft)
      setEditing(false)
    } catch {
      // revert on error
      setDraft(value)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(value)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Enter' && e.metaKey && type === 'textarea') {
      e.preventDefault()
      handleSave()
    }
  }

  if (editing) {
    const inputClasses = 'w-full text-sm border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500'

    if (type === 'textarea') {
      return (
        <div>
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            rows={3}
            className={inputClasses + ' resize-y'}
            disabled={saving}
          />
        </div>
      )
    }

    if (type === 'select' && options) {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            // Auto-save on select change
            const newVal = e.target.value
            if (newVal !== value) {
              setSaving(true)
              Promise.resolve(onSave(newVal))
                .then(() => setEditing(false))
                .catch(() => { setDraft(value); setEditing(false) })
                .finally(() => setSaving(false))
            } else {
              setEditing(false)
            }
          }}
          onBlur={() => { if (!saving) setEditing(false) }}
          onKeyDown={handleKeyDown}
          className={inputClasses}
          disabled={saving}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    }

    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          step={step}
          className={inputClasses}
          disabled={saving}
        />
        {suffix && <span className="text-sm text-gray-500 ml-1">{suffix}</span>}
      </div>
    )
  }

  // Display mode
  const displayText = displayValue || value || placeholder
  const isEmpty = !value && !displayValue

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 text-left max-w-full"
    >
      <span className={`text-sm ${isEmpty ? 'text-gray-400 italic' : 'text-gray-900'}`}>
        {displayText}{suffix && value ? ` ${suffix}` : ''}
      </span>
      <svg
        className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
}
