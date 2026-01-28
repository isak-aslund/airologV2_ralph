import { useState, useCallback } from 'react'
import { getDroneConnection } from '../lib/droneConnection'

// Default serial number pattern: 16925X0000 where X is a digit (model identifier)
const DEFAULT_SERIAL_PATTERN = /^16925\d0000$/

/**
 * Check if a serial number is a default/placeholder value
 */
export function isDefaultSerial(serial: number | null): boolean {
  if (serial === null || serial === 0) return true
  const serialStr = serial.toString()
  return DEFAULT_SERIAL_PATTERN.test(serialStr)
}

/**
 * Validate serial number format and value
 */
function validateSerialNumber(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return 'Serial number is required'
  }

  if (!/^\d+$/.test(trimmed)) {
    return 'Serial number must contain only digits'
  }

  if (trimmed.length !== 10) {
    return `Serial number must be exactly 10 digits (got ${trimmed.length})`
  }

  if (DEFAULT_SERIAL_PATTERN.test(trimmed)) {
    return 'This is a model default serial number and cannot be used'
  }

  if (trimmed === '0000000000') {
    return 'Serial number cannot be all zeros'
  }

  return null
}

interface SetSerialModalProps {
  currentSerial: number | null
  onClose: () => void
  onSerialSet: (newSerial: number) => void
}

type SetStep = 'input' | 'setting' | 'verifying' | 'success' | 'error'

export default function SetSerialModal({ currentSerial, onClose, onSerialSet }: SetSerialModalProps) {
  const [serialInput, setSerialInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [step, setStep] = useState<SetStep>('input')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const connection = getDroneConnection()

  const handleInputChange = (value: string) => {
    // Only allow digits
    const digitsOnly = value.replace(/\D/g, '').slice(0, 10)
    setSerialInput(digitsOnly)

    // Clear error on change
    if (inputError) {
      setInputError(null)
    }
  }

  const handleSetSerial = useCallback(async () => {
    // Validate input
    const error = validateSerialNumber(serialInput)
    if (error) {
      setInputError(error)
      return
    }

    const serialNumber = parseInt(serialInput, 10)

    try {
      setStep('setting')

      // Set the parameter
      const success = await connection.setAirolitSerial(serialNumber)

      if (!success) {
        throw new Error('Failed to set serial number - drone did not confirm the value')
      }

      // Verify by reading back
      setStep('verifying')
      const readBack = await connection.readAirolitSerial()

      if (readBack !== serialNumber) {
        throw new Error(`Verification failed: expected ${serialNumber}, got ${readBack}`)
      }

      setStep('success')

      // Notify parent after short delay to show success state
      setTimeout(() => {
        onSerialSet(serialNumber)
      }, 1500)

    } catch (err) {
      console.error('Error setting serial:', err)
      setStep('error')
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error occurred')
    }
  }, [serialInput, connection, onSerialSet])

  const handleRetry = () => {
    setStep('input')
    setErrorMessage(null)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={step === 'input' || step === 'error' ? onClose : undefined}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Set Drone Serial Number</h2>
            {(step === 'input' || step === 'error') && (
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            {step === 'input' && (
              <>
                {/* Current serial info */}
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        Default Serial Detected
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        Current serial: <code className="font-mono bg-amber-100 px-1 rounded">{currentSerial || 'Not set'}</code>
                      </p>
                      <p className="text-xs text-amber-600 mt-1">
                        Please set a unique serial number for this drone.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Serial input */}
                <div>
                  <label htmlFor="serial-input" className="block text-sm font-medium text-gray-700 mb-1">
                    New Serial Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="serial-input"
                    value={serialInput}
                    onChange={(e) => handleInputChange(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md font-mono text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      inputError ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="1234567890"
                    maxLength={10}
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Enter a unique 10-digit serial number
                  </p>
                  {inputError && (
                    <p className="mt-1 text-sm text-red-600">{inputError}</p>
                  )}
                </div>
              </>
            )}

            {step === 'setting' && (
              <div className="py-8 text-center">
                <svg
                  className="w-12 h-12 mx-auto text-blue-500 animate-spin"
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
                <p className="mt-4 text-gray-700 font-medium">Setting serial number...</p>
                <p className="mt-1 text-sm text-gray-500">Sending to drone</p>
              </div>
            )}

            {step === 'verifying' && (
              <div className="py-8 text-center">
                <svg
                  className="w-12 h-12 mx-auto text-blue-500 animate-spin"
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
                <p className="mt-4 text-gray-700 font-medium">Verifying...</p>
                <p className="mt-1 text-sm text-gray-500">Reading back to confirm</p>
              </div>
            )}

            {step === 'success' && (
              <div className="py-8 text-center">
                <div className="w-12 h-12 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <p className="mt-4 text-gray-700 font-medium">Serial number set successfully!</p>
                <p className="mt-1 text-sm text-gray-500 font-mono">{serialInput}</p>
              </div>
            )}

            {step === 'error' && (
              <div className="py-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-6 h-6 text-red-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-red-800">Failed to set serial number</p>
                      <p className="mt-1 text-sm text-red-700">{errorMessage}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
            {step === 'input' && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSetSerial}
                  disabled={serialInput.length !== 10}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Set Serial Number
                </button>
              </>
            )}

            {step === 'error' && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Try Again
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
