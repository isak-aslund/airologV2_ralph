/**
 * Drone Connection via Web Serial API
 *
 * Provides functions to connect to a drone via USB serial port,
 * maintain the connection with heartbeats, and receive MAVLink messages.
 */

import {
  MAVLinkParser,
  createHeartbeatMessage,
  createLogRequestListMessage,
  createLogRequestDataMessage,
  createParamRequestReadMessage,
  createParamSetMessage,
  MSG_ID_HEARTBEAT,
  MSG_ID_LOG_ENTRY,
  MSG_ID_LOG_DATA,
  MSG_ID_PARAM_VALUE,
  parseHeartbeat,
  parseLogEntry,
  parseLogData,
  parseParamValue,
  intToParamFloat,
  paramFloatToUint,
  MAV_COMP_ID_AUTOPILOT1,
  MAV_PARAM_TYPE_INT32,
} from './mavlink'
import type {
  MAVLinkMessage,
  HeartbeatMessage,
  LogEntryMessage,
  LogDataMessage,
  ParamValueMessage,
} from './mavlink'

// Connection constants
const BAUD_RATE = 921600 // High baud rate for faster transfers (fallback to 115200 if needed)
const HEARTBEAT_INTERVAL_MS = 1000 // Send heartbeat every 1 second
const LOG_LIST_TIMEOUT_MS = 5000 // Timeout for log list request
const LOG_DATA_TIMEOUT_MS = 10000 // Timeout for data chunk request
const LOG_REQUEST_CHUNK_SIZE = 32768 // Request 32KB at a time (drone streams back as multiple 90-byte messages)

// Connection state
export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

// Drone log entry (from log list)
export interface DroneLogEntry {
  id: number
  size: number
  timeUtc: number // Unix timestamp in seconds
}

// Download progress tracking
export interface DownloadProgress {
  logId: number
  bytesReceived: number
  totalBytes: number
  percent: number
  speedKBps: number // Download speed in kB/s
}

// Downloaded log result
export interface DownloadedLog {
  id: number
  blob: Blob
  timeUtc: number
}

// Event types for connection callbacks
export interface DroneConnectionEvents {
  onStateChange?: (state: ConnectionState) => void
  onHeartbeat?: (heartbeat: HeartbeatMessage, sysId: number) => void
  onLogEntry?: (entry: LogEntryMessage) => void
  onLogData?: (data: LogDataMessage) => void
  onParamValue?: (param: ParamValueMessage) => void
  onError?: (error: Error) => void
  onMessage?: (message: MAVLinkMessage) => void
}

/**
 * DroneConnection class manages the serial connection to a drone
 */
export class DroneConnection {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private parser: MAVLinkParser = new MAVLinkParser()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private readLoopActive = false
  private _state: ConnectionState = 'disconnected'
  private _droneSysId: number | null = null
  private events: DroneConnectionEvents = {}

  /**
   * Get current connection state
   */
  get state(): ConnectionState {
    return this._state
  }

  /**
   * Get connected drone's system ID
   */
  get droneSysId(): number | null {
    return this._droneSysId
  }

  /**
   * Set event callbacks
   */
  setEventHandlers(events: DroneConnectionEvents): void {
    this.events = events
  }

  /**
   * Update connection state and notify listeners
   */
  private setState(state: ConnectionState): void {
    this._state = state
    this.events.onStateChange?.(state)
  }

  /**
   * Check if Web Serial API is supported
   */
  static isSupported(): boolean {
    return 'serial' in navigator
  }

  /**
   * Request a serial port from the user
   * Opens the browser's port selection dialog
   */
  async requestPort(): Promise<SerialPort> {
    if (!DroneConnection.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser')
    }

    try {
      // Request port with filter for common PX4 USB devices
      // Most PX4 flight controllers use these USB vendor IDs
      const port = await navigator.serial.requestPort({
        filters: [
          // Common PX4/Pixhawk vendor IDs
          { usbVendorId: 0x26ac }, // Hex/ProfiCNC
          { usbVendorId: 0x3185 }, // CUAV
          { usbVendorId: 0x2dae }, // Holybro
          { usbVendorId: 0x1fc9 }, // NXP
          { usbVendorId: 0x0483 }, // STMicroelectronics
          { usbVendorId: 0x1209 }, // Generic (3DR)
        ],
      })
      return port
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') {
        throw new Error('No compatible device selected. Please select a PX4 flight controller.')
      }
      throw error
    }
  }

  /**
   * Connect to the drone via the provided or newly requested serial port
   */
  async connect(port?: SerialPort): Promise<void> {
    if (this._state !== 'disconnected') {
      throw new Error('Already connected or connecting')
    }

    this.setState('connecting')

    try {
      // Request port if not provided
      this.port = port ?? (await this.requestPort())

      // Open the port at 115200 baud
      await this.port.open({ baudRate: BAUD_RATE })

      // Get reader and writer
      if (!this.port.readable || !this.port.writable) {
        throw new Error('Port is not readable or writable')
      }

      this.reader = this.port.readable.getReader()
      this.writer = this.port.writable.getWriter()

      // Reset parser state
      this.parser.reset()

      // Start reading incoming data
      this.startReadLoop()

      // Start sending heartbeats
      this.startHeartbeat()

      this.setState('connected')
    } catch (error) {
      await this.cleanup()
      this.setState('disconnected')
      this.events.onError?.(error as Error)
      throw error
    }
  }

  /**
   * Disconnect from the drone
   */
  async disconnect(): Promise<void> {
    await this.cleanup()
    this.setState('disconnected')
    this._droneSysId = null
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Stop read loop
    this.readLoopActive = false

    // Release reader
    if (this.reader) {
      try {
        await this.reader.cancel()
        this.reader.releaseLock()
      } catch {
        // Ignore errors during cleanup
      }
      this.reader = null
    }

    // Release writer
    if (this.writer) {
      try {
        this.writer.releaseLock()
      } catch {
        // Ignore errors during cleanup
      }
      this.writer = null
    }

    // Close port
    if (this.port) {
      try {
        await this.port.close()
      } catch {
        // Ignore errors during cleanup
      }
      this.port = null
    }
  }

  /**
   * Start the heartbeat timer
   */
  private startHeartbeat(): void {
    // Send initial heartbeat immediately
    this.sendHeartbeat()

    // Then send periodically
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
  }

  /**
   * Send a heartbeat message to the drone
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.writer) return

    try {
      const heartbeat = createHeartbeatMessage(255) // GCS system ID 255
      await this.writer.write(heartbeat)
    } catch (error) {
      this.events.onError?.(error as Error)
    }
  }

  /**
   * Send raw bytes to the drone
   */
  async send(data: Uint8Array): Promise<void> {
    if (!this.writer || this._state !== 'connected') {
      throw new Error('Not connected')
    }

    await this.writer.write(data)
  }

  /**
   * Request the list of available logs from the drone
   * Sends LOG_REQUEST_LIST and collects LOG_ENTRY responses
   *
   * @returns Promise that resolves with array of log entries, or rejects on timeout
   */
  async requestLogList(): Promise<DroneLogEntry[]> {
    if (this._state !== 'connected') {
      throw new Error('Not connected')
    }

    if (this._droneSysId === null) {
      throw new Error('Drone system ID not yet received. Wait for heartbeat.')
    }

    console.log('[DroneConnection] Requesting log list from drone sysId:', this._droneSysId)

    return new Promise<DroneLogEntry[]>((resolve, reject) => {
      const logs: DroneLogEntry[] = []
      let expectedTotal = 0
      let receivedCount = 0
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      // Store the original onLogEntry handler
      const originalOnLogEntry = this.events.onLogEntry

      // Cleanup function
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        // Restore original handler
        this.events.onLogEntry = originalOnLogEntry
      }

      // Set up timeout
      timeoutId = setTimeout(() => {
        cleanup()
        console.log('[DroneConnection] Log list timeout - received', receivedCount, 'entries')
        if (receivedCount === 0) {
          reject(new Error('Timeout: No response from drone. Make sure the drone is connected and powered on.'))
        } else {
          // Partial response - return what we got
          resolve(logs)
        }
      }, LOG_LIST_TIMEOUT_MS)

      // Set up handler to collect LOG_ENTRY messages
      this.events.onLogEntry = (entry) => {
        console.log('[DroneConnection] Received LOG_ENTRY:', entry)
        // Call original handler if it exists
        originalOnLogEntry?.(entry)

        // Track expected total from first entry
        if (receivedCount === 0 && entry.numLogs > 0) {
          expectedTotal = entry.numLogs
          console.log('[DroneConnection] Expecting', expectedTotal, 'total log entries')
        }

        // Add to logs list (ignore entries with size 0 which indicate empty slots)
        if (entry.size > 0) {
          logs.push({
            id: entry.id,
            size: entry.size,
            timeUtc: entry.timeUtc,
          })
        }

        receivedCount++

        // Check if we've received all expected entries
        if (expectedTotal > 0 && receivedCount >= expectedTotal) {
          cleanup()
          console.log('[DroneConnection] Received all', logs.length, 'log entries')
          // Sort by ID descending (most recent first based on ID)
          logs.sort((a, b) => b.id - a.id)
          resolve(logs)
        }
      }

      // Send LOG_REQUEST_LIST message
      const requestMessage = createLogRequestListMessage(
        this._droneSysId!,
        MAV_COMP_ID_AUTOPILOT1,
        0, // start from first log
        0xffff // request all logs
      )

      console.log('[DroneConnection] Sending LOG_REQUEST_LIST message')
      this.send(requestMessage).catch((error) => {
        console.error('[DroneConnection] Failed to send LOG_REQUEST_LIST:', error)
        cleanup()
        reject(error)
      })
    })
  }

  /**
   * Download a single log from the drone
   * Sends LOG_REQUEST_DATA messages and collects LOG_DATA responses
   *
   * @param logEntry - The log entry to download (from requestLogList)
   * @param onProgress - Optional callback for progress updates
   * @param abortSignal - Optional AbortSignal to cancel the download
   * @returns Promise that resolves with the downloaded log as a Blob
   */
  async downloadLog(
    logEntry: DroneLogEntry,
    onProgress?: (progress: DownloadProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<DownloadedLog> {
    if (this._state !== 'connected') {
      throw new Error('Not connected')
    }

    if (this._droneSysId === null) {
      throw new Error('Drone system ID not yet received. Wait for heartbeat.')
    }

    return new Promise<DownloadedLog>((resolve, reject) => {
      const logId = logEntry.id
      const totalSize = logEntry.size
      const chunks: Map<number, Uint8Array> = new Map() // offset -> data
      let bytesReceived = 0
      let currentOffset = 0
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let isComplete = false
      const startTime = Date.now() // Track start time for speed calculation

      // Store the original onLogData handler
      const originalOnLogData = this.events.onLogData

      // Cleanup function
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        // Remove abort listener if it exists
        abortSignal?.removeEventListener('abort', handleAbort)
        // Restore original handler
        this.events.onLogData = originalOnLogData
      }

      // Handle abort signal
      const handleAbort = () => {
        cleanup()
        reject(new Error('Download cancelled'))
      }

      // Set up abort listener
      if (abortSignal) {
        if (abortSignal.aborted) {
          reject(new Error('Download cancelled'))
          return
        }
        abortSignal.addEventListener('abort', handleAbort)
      }

      // Reset timeout on each data chunk received
      const resetTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        timeoutId = setTimeout(() => {
          cleanup()
          if (bytesReceived === 0) {
            reject(new Error('Timeout: No data received from drone.'))
          } else if (bytesReceived < totalSize) {
            reject(new Error(`Download incomplete: received ${bytesReceived} of ${totalSize} bytes`))
          }
        }, LOG_DATA_TIMEOUT_MS)
      }

      // Track what we've requested
      let requestedUpTo = 0

      // Request next chunk of data (4KB at a time)
      const requestNextChunk = () => {
        if (requestedUpTo >= totalSize || isComplete) {
          return
        }

        const remaining = totalSize - requestedUpTo
        const chunkSize = Math.min(remaining, LOG_REQUEST_CHUNK_SIZE)

        const requestMessage = createLogRequestDataMessage(
          this._droneSysId!,
          MAV_COMP_ID_AUTOPILOT1,
          logId,
          requestedUpTo,
          chunkSize
        )

        requestedUpTo += chunkSize

        this.send(requestMessage).catch((error) => {
          cleanup()
          reject(error)
        })
      }

      // Assemble all chunks into final blob
      const assembleBlob = (): Blob => {
        // Create a single contiguous buffer and copy each chunk to its proper position
        const buffer = new Uint8Array(totalSize)

        for (const [offset, data] of chunks) {
          buffer.set(data, offset)
        }

        return new Blob([buffer], { type: 'application/octet-stream' })
      }

      // Set up handler to collect LOG_DATA messages
      this.events.onLogData = (data) => {
        // Call original handler if it exists
        originalOnLogData?.(data)

        // Only process data for our log
        if (data.id !== logId) {
          return
        }

        // Store the chunk
        if (!chunks.has(data.ofs)) {
          chunks.set(data.ofs, data.data)
          bytesReceived += data.count

          // Track highest offset received for requesting more data
          const endOffset = data.ofs + data.count
          if (endOffset > currentOffset) {
            currentOffset = endOffset
          }
        }

        // Report progress with speed calculation
        if (onProgress) {
          const elapsedSeconds = (Date.now() - startTime) / 1000
          const speedKBps = elapsedSeconds > 0 ? (bytesReceived / 1024) / elapsedSeconds : 0
          onProgress({
            logId,
            bytesReceived,
            totalBytes: totalSize,
            percent: Math.round((bytesReceived / totalSize) * 100),
            speedKBps: Math.round(speedKBps * 10) / 10, // Round to 1 decimal
          })
        }

        // Reset timeout since we received data
        resetTimeout()

        // Check if we've received all data
        if (bytesReceived >= totalSize) {
          isComplete = true
          cleanup()

          // Assemble the blob
          const blob = assembleBlob()
          resolve({
            id: logId,
            blob,
            timeUtc: logEntry.timeUtc,
          })
        } else if (currentOffset >= requestedUpTo && requestedUpTo < totalSize) {
          // We've received all data from current request, request more
          requestNextChunk()
        }
      }

      // Start timeout
      resetTimeout()

      // Start requesting data from the beginning
      requestNextChunk()
    })
  }

  /**
   * Start the read loop to receive data from the drone
   */
  private async startReadLoop(): Promise<void> {
    if (!this.reader) return

    this.readLoopActive = true

    try {
      while (this.readLoopActive) {
        const { value, done } = await this.reader.read()

        if (done) {
          break
        }

        if (value) {
          // Parse incoming data for MAVLink messages
          const messages = this.parser.parse(value)

          for (const message of messages) {
            this.handleMessage(message)
          }
        }
      }
    } catch (error) {
      if (this.readLoopActive) {
        // Only report error if we're still supposed to be reading
        this.events.onError?.(error as Error)
        await this.disconnect()
      }
    }
  }

  /**
   * Handle a received MAVLink message
   */
  private handleMessage(message: MAVLinkMessage): void {
    // Log all received messages for debugging
    if (message.msgId !== MSG_ID_HEARTBEAT) {
      console.log('[DroneConnection] Received message ID:', message.msgId, 'from sysId:', message.sysId, 'payload length:', message.payload.length)
    }

    // Notify generic message handler
    this.events.onMessage?.(message)

    // Handle specific message types
    switch (message.msgId) {
      case MSG_ID_HEARTBEAT: {
        const heartbeat = parseHeartbeat(message.payload)
        if (heartbeat) {
          // Store the drone's system ID from the first heartbeat
          if (this._droneSysId === null) {
            this._droneSysId = message.sysId
            console.log('[DroneConnection] Got first heartbeat from drone sysId:', message.sysId)
          }
          this.events.onHeartbeat?.(heartbeat, message.sysId)
        }
        break
      }

      case MSG_ID_LOG_ENTRY: {
        const entry = parseLogEntry(message.payload)
        if (entry) {
          this.events.onLogEntry?.(entry)
        } else {
          console.warn('[DroneConnection] Failed to parse LOG_ENTRY message')
        }
        break
      }

      case MSG_ID_LOG_DATA: {
        const data = parseLogData(message.payload)
        if (data) {
          this.events.onLogData?.(data)
        } else {
          console.warn('[DroneConnection] Failed to parse LOG_DATA message')
        }
        break
      }

      case MSG_ID_PARAM_VALUE: {
        const param = parseParamValue(message.payload)
        if (param) {
          console.log('[DroneConnection] Received PARAM_VALUE:', param.paramId, '=', param.paramValue)
          this.events.onParamValue?.(param)
        } else {
          console.warn('[DroneConnection] Failed to parse PARAM_VALUE message')
        }
        break
      }
    }
  }

  /**
   * Request a parameter value from the drone
   *
   * @param paramId - Parameter name to request
   * @param timeout - Timeout in milliseconds
   * @returns Promise that resolves with the parameter value
   */
  async requestParameter(paramId: string, timeout: number = 5000): Promise<ParamValueMessage> {
    if (this._state !== 'connected') {
      throw new Error('Not connected')
    }

    if (this._droneSysId === null) {
      throw new Error('Drone system ID not yet received. Wait for heartbeat.')
    }

    return new Promise<ParamValueMessage>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const originalOnParamValue = this.events.onParamValue

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.events.onParamValue = originalOnParamValue
      }

      timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for parameter: ${paramId}`))
      }, timeout)

      this.events.onParamValue = (param) => {
        originalOnParamValue?.(param)
        if (param.paramId === paramId) {
          cleanup()
          resolve(param)
        }
      }

      const requestMessage = createParamRequestReadMessage(
        this._droneSysId!,
        MAV_COMP_ID_AUTOPILOT1,
        paramId
      )

      console.log('[DroneConnection] Requesting parameter:', paramId)
      this.send(requestMessage).catch((error) => {
        cleanup()
        reject(error)
      })
    })
  }

  /**
   * Set a parameter value on the drone
   *
   * @param paramId - Parameter name to set
   * @param value - Value to set (as MAVLink float representation)
   * @param paramType - Parameter type
   * @param timeout - Timeout in milliseconds
   * @returns Promise that resolves with the confirmed parameter value
   */
  async setParameter(
    paramId: string,
    value: number,
    paramType: number = MAV_PARAM_TYPE_INT32,
    timeout: number = 5000
  ): Promise<ParamValueMessage> {
    if (this._state !== 'connected') {
      throw new Error('Not connected')
    }

    if (this._droneSysId === null) {
      throw new Error('Drone system ID not yet received. Wait for heartbeat.')
    }

    return new Promise<ParamValueMessage>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const originalOnParamValue = this.events.onParamValue

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.events.onParamValue = originalOnParamValue
      }

      timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for parameter confirmation: ${paramId}`))
      }, timeout)

      this.events.onParamValue = (param) => {
        originalOnParamValue?.(param)
        if (param.paramId === paramId) {
          cleanup()
          resolve(param)
        }
      }

      const setMessage = createParamSetMessage(
        this._droneSysId!,
        MAV_COMP_ID_AUTOPILOT1,
        paramId,
        value,
        paramType
      )

      console.log('[DroneConnection] Setting parameter:', paramId, '=', value)
      this.send(setMessage).catch((error) => {
        cleanup()
        reject(error)
      })
    })
  }

  /**
   * Read the AIROLIT_SERIAL parameter from the drone
   *
   * @returns Promise that resolves with the serial number as integer, or null if not set
   */
  async readAirolitSerial(): Promise<number | null> {
    try {
      const param = await this.requestParameter('AIROLIT_SERIAL')
      const serial = paramFloatToUint(param.paramValue)
      console.log('[DroneConnection] AIROLIT_SERIAL =', serial)
      return serial === 0 ? null : serial
    } catch (error) {
      console.warn('[DroneConnection] Failed to read AIROLIT_SERIAL:', error)
      return null
    }
  }

  /**
   * Set the AIROLIT_SERIAL parameter on the drone and verify it was set correctly
   *
   * @param serialNumber - The 10-digit serial number to set
   * @returns Promise that resolves with true if successful, false otherwise
   */
  async setAirolitSerial(serialNumber: number): Promise<boolean> {
    try {
      // Convert integer to float representation
      const floatValue = intToParamFloat(serialNumber)

      console.log('[DroneConnection] Setting AIROLIT_SERIAL to', serialNumber, '(float:', floatValue, ')')

      // Set the parameter
      const response = await this.setParameter('AIROLIT_SERIAL', floatValue, MAV_PARAM_TYPE_INT32)

      // Verify the value was set correctly
      const confirmedSerial = paramFloatToUint(response.paramValue)
      console.log('[DroneConnection] Confirmed AIROLIT_SERIAL =', confirmedSerial)

      if (confirmedSerial === serialNumber) {
        console.log('[DroneConnection] Serial number set successfully')
        return true
      } else {
        console.error('[DroneConnection] Serial mismatch: sent', serialNumber, 'got', confirmedSerial)
        return false
      }
    } catch (error) {
      console.error('[DroneConnection] Failed to set AIROLIT_SERIAL:', error)
      return false
    }
  }
}

// Singleton instance for global use
let connectionInstance: DroneConnection | null = null

/**
 * Get the global DroneConnection instance
 */
export function getDroneConnection(): DroneConnection {
  if (!connectionInstance) {
    connectionInstance = new DroneConnection()
  }
  return connectionInstance
}

/**
 * Check if Web Serial API is supported
 */
export function isWebSerialSupported(): boolean {
  return DroneConnection.isSupported()
}
