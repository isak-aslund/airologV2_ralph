interface AndOrToggleProps {
  value: 'and' | 'or'
  onChange: (value: 'and' | 'or') => void
  disabled?: boolean
  disabledReason?: string
}

export default function AndOrToggle({ value, onChange, disabled, disabledReason }: AndOrToggleProps) {
  return (
    <div className="inline-flex rounded text-xs font-medium" title={disabled ? (disabledReason || 'Not applicable for this filter') : undefined}>
      <button
        type="button"
        onClick={() => !disabled && onChange('and')}
        disabled={disabled}
        className={`px-1.5 py-0.5 rounded-l border ${
          value === 'and'
            ? 'bg-blue-100 text-blue-800 border-blue-300'
            : 'bg-white text-gray-500 border-gray-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        AND
      </button>
      <button
        type="button"
        onClick={() => !disabled && onChange('or')}
        disabled={disabled}
        className={`px-1.5 py-0.5 rounded-r border-t border-r border-b ${
          value === 'or'
            ? 'bg-blue-100 text-blue-800 border-blue-300'
            : 'bg-white text-gray-500 border-gray-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        OR
      </button>
    </div>
  )
}
