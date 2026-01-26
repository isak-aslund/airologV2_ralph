import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  getDroneConnection,
  isWebSerialSupported,
} from '../lib/droneConnection'
import type { ConnectionState } from '../lib/droneConnection'
import type { HeartbeatMessage } from '../lib/mavlink'

export default function DroneConnection() {
  const navigate = useNavigate()
  const location = useLocation()
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [serialNumber, setSerialNumber] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSupported] = useState(() => isWebSerialSupported())
  const [hasNavigated, setHasNavigated] = useState(false)

  // Get the singleton connection instance
  const connection = getDroneConnection()

  // Setup event handlers
  useEffect(() => {
    connection.setEventHandlers({
      onStateChange: (state) => {
        setConnectionState(state)
        if (state === 'disconnected') {
          setSerialNumber(null)
          setHasNavigated(false)
        }
      },
      onHeartbeat: (_heartbeat: HeartbeatMessage, sysId: number) => {
        // Use system ID as the serial number display for now
        // Real serial number would come from parameter or message parsing
        if (!serialNumber) {
          setSerialNumber(`SYS-${sysId}`)
        }
      },
      onError: (err) => {
        setError(err.message)
        // Clear error after 5 seconds
        setTimeout(() => setError(null), 5000)
      },
    })

    // Sync initial state
    setConnectionState(connection.state)
    if (connection.droneSysId) {
      setSerialNumber(`SYS-${connection.droneSysId}`)
    }

    // Cleanup not needed as we're using singleton
  }, [connection, serialNumber])

  // Navigate to upload page when connected (only once per connection)
  useEffect(() => {
    if (connectionState === 'connected' && !hasNavigated && location.pathname !== '/upload') {
      setHasNavigated(true)
      navigate('/upload')
    }
  }, [connectionState, hasNavigated, navigate, location.pathname])

  const handleConnect = useCallback(async () => {
    setError(null)
    try {
      await connection.connect()
    } catch (err) {
      // Error is already handled via onError callback
      // But we can catch user cancellation separately
      if ((err as DOMException).name === 'NotAllowedError') {
        setError('Connection cancelled by user')
      }
    }
  }, [connection])

  const handleDisconnect = useCallback(async () => {
    setError(null)
    await connection.disconnect()
  }, [connection])

  // Don't render if Web Serial API is not supported
  if (!isSupported) {
    return null
  }

  return (
    <div className="flex items-center gap-2">
      {/* Connection status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            connectionState === 'connected'
              ? 'bg-green-500'
              : connectionState === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-gray-400'
          }`}
          title={connectionState}
        />

        {connectionState === 'connected' && serialNumber && (
          <span className="text-xs sm:text-sm text-gray-600 font-mono">
            {serialNumber}
          </span>
        )}
      </div>

      {/* Connect/Disconnect button */}
      {connectionState === 'disconnected' ? (
        <button
          onClick={handleConnect}
          className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors"
          title="Connect to drone via USB"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span className="hidden sm:inline">Connect Drone</span>
          <span className="sm:hidden">Connect</span>
        </button>
      ) : connectionState === 'connecting' ? (
        <button
          disabled
          className="flex items-center gap-1.5 bg-yellow-100 text-yellow-700 px-2 py-1.5 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium cursor-wait"
        >
          <svg
            className="w-4 h-4 animate-spin"
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
          <span>Connecting...</span>
        </button>
      ) : (
        <button
          onClick={handleDisconnect}
          className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1.5 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors"
          title="Disconnect from drone"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          <span className="hidden sm:inline">Disconnect</span>
          <span className="sm:hidden">Disconnect</span>
        </button>
      )}

      {/* Error message */}
      {error && (
        <div className="absolute top-full right-0 mt-2 bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-md text-xs sm:text-sm shadow-lg max-w-xs">
          <div className="flex items-start gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  )
}
