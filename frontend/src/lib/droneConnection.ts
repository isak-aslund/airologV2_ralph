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
  createLogRequestEndMessage,
  MSG_ID_HEARTBEAT,
  MSG_ID_LOG_ENTRY,
  MSG_ID_LOG_DATA,
  parseHeartbeat,
  parseLogEntry,
  parseLogData,
  MAV_COMP_ID_AUTOPILOT1,
} from './mavlink'
import type {
  MAVLinkMessage,
  HeartbeatMessage,
  LogEntryMessage,
  LogDataMessage,
} from './mavlink'

// Connection constants
const BAUD_RATE = 921600 // High baud rate for faster transfers (fallback to 115200 if needed)
const HEARTBEAT_INTERVAL_MS = 1000 // Send heartbeat every 1 second
const LOG_LIST_TIMEOUT_MS = 5000 // Timeout for log list request

// Download tuning
// First-byte timeout is much longer because the drone may need to close the
// previous log file, open a new one, and seek before sending any LOG_DATA.
// Once data is streaming, a shorter idle timeout catches dropped packets fast.
const LOG_DATA_IDLE_MS_FIRST_BYTE = 6000
const LOG_DATA_IDLE_MS_MID_STREAM = 1500
const LOG_DOWNLOAD_MAX_STALL_ROUNDS = 10 // Max consecutive idle rounds with zero new bytes before failing
const LOG_DOWNLOAD_INITIAL_CHUNK = 16 * 1024 * 1024 // First request size; covers all small logs in one shot

/**
 * Sparse set of received byte ranges, merged on insert.
 * Used to detect gaps in a serial log download where individual MAVLink
 * LOG_DATA messages may have been dropped.
 *
 * Ranges are stored as half-open intervals [start, end), sorted by start.
 */
class ReceivedRanges {
  private ranges: Array<[number, number]> = []

  /** Insert [start, end), merging with any neighbours it touches or overlaps. */
  add(start: number, end: number): void {
    if (end <= start) return
    let i = 0
    while (i < this.ranges.length && this.ranges[i][1] < start) i++
    if (i === this.ranges.length) {
      this.ranges.push([start, end])
      return
    }
    if (this.ranges[i][0] > end) {
      this.ranges.splice(i, 0, [start, end])
      return
    }
    let mergedStart = Math.min(this.ranges[i][0], start)
    let mergedEnd = Math.max(this.ranges[i][1], end)
    let j = i + 1
    while (j < this.ranges.length && this.ranges[j][0] <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, this.ranges[j][1])
      j++
    }
    this.ranges.splice(i, j - i, [mergedStart, mergedEnd])
  }

  /** Sum of unique bytes covered in [0, upTo). */
  totalReceived(upTo: number): number {
    let total = 0
    for (const [s, e] of this.ranges) {
      if (s >= upTo) break
      total += Math.min(e, upTo) - s
    }
    return total
  }

  /** First missing [start, end) within [0, upTo), or null if fully covered. */
  firstMissing(upTo: number): [number, number] | null {
    let cursor = 0
    for (const [s, e] of this.ranges) {
      if (s > cursor) return [cursor, Math.min(s, upTo)]
      cursor = Math.max(cursor, e)
      if (cursor >= upTo) return null
    }
    if (cursor < upTo) return [cursor, upTo]
    return null
  }

  isComplete(totalSize: number): boolean {
    return this.firstMissing(totalSize) === null
  }
}

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
   * Download a single log from the drone.
   *
   * Sends LOG_REQUEST_DATA messages and collects LOG_DATA responses. The
   * MAVLink log-download protocol over a serial link can drop individual
   * LOG_DATA messages and the autopilot will not retransmit them on its own,
   * so this implementation tracks received byte ranges and re-requests any
   * gaps until the file is whole. Bytes that arrive past the declared file
   * size are clipped (some autopilots send a final 90-byte chunk that
   * overshoots) so we never corrupt the final blob with a buffer overflow.
   *
   * On success, failure, or abort, a LOG_REQUEST_END is sent so the drone
   * exits log-streaming mode and the next download starts from a clean state.
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

    const droneSysId = this._droneSysId
    const logId = logEntry.id
    const totalSize = logEntry.size

    if (totalSize === 0) {
      return {
        id: logId,
        blob: new Blob([], { type: 'application/octet-stream' }),
        timeUtc: logEntry.timeUtc,
      }
    }

    const sendLogRequestEnd = async (): Promise<void> => {
      try {
        const endMsg = createLogRequestEndMessage(droneSysId, MAV_COMP_ID_AUTOPILOT1)
        await this.send(endMsg)
      } catch {
        // Best-effort; failures here are not the user's problem.
      }
    }

    return new Promise<DownloadedLog>((resolve, reject) => {
      const buffer = new Uint8Array(totalSize)
      const received = new ReceivedRanges()
      const startTime = Date.now()

      let isSettled = false
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      let stallRounds = 0
      let bytesAtLastIdleCheck = 0
      let pendingRequest: [number, number] | null = null

      const originalOnLogData = this.events.onLogData

      const cleanup = () => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
        abortSignal?.removeEventListener('abort', handleAbort)
        this.events.onLogData = originalOnLogData
      }

      const succeed = () => {
        if (isSettled) return
        isSettled = true
        cleanup()
        // Don't send LOG_REQUEST_END on success: the drone naturally returns to
        // idle after sending all the bytes we asked for, and explicitly ending
        // the session can leave some autopilots slow to re-engage when the next
        // download immediately follows.
        const blob = new Blob([buffer], { type: 'application/octet-stream' })
        resolve({ id: logId, blob, timeUtc: logEntry.timeUtc })
      }

      const fail = (error: Error) => {
        if (isSettled) return
        isSettled = true
        cleanup()
        // On abort/failure, tell the drone to stop streaming so it isn't still
        // pumping LOG_DATA at us when the user starts a new download.
        sendLogRequestEnd().finally(() => reject(error))
      }

      const handleAbort = () => fail(new Error('Download cancelled'))

      if (abortSignal) {
        if (abortSignal.aborted) {
          reject(new Error('Download cancelled'))
          return
        }
        abortSignal.addEventListener('abort', handleAbort)
      }

      const reportProgress = () => {
        if (!onProgress) return
        const bytesReceived = received.totalReceived(totalSize)
        const elapsedSeconds = (Date.now() - startTime) / 1000
        const speedKBps = elapsedSeconds > 0 ? bytesReceived / 1024 / elapsedSeconds : 0
        onProgress({
          logId,
          bytesReceived,
          totalBytes: totalSize,
          percent: Math.round((bytesReceived / totalSize) * 100),
          speedKBps: Math.round(speedKBps * 10) / 10,
        })
      }

      const scheduleIdleTimer = () => {
        if (idleTimer !== null) clearTimeout(idleTimer)
        // Give the drone significantly more time on the very first byte —
        // opening a new log file and seeking can easily take a few seconds,
        // and re-requesting too eagerly just makes the drone restart the
        // file-open and we never make progress.
        const haveAnyBytes = received.totalReceived(totalSize) > 0
        const delay = haveAnyBytes
          ? LOG_DATA_IDLE_MS_MID_STREAM
          : LOG_DATA_IDLE_MS_FIRST_BYTE
        idleTimer = setTimeout(handleIdle, delay)
      }

      const requestRange = (offset: number, count: number) => {
        pendingRequest = [offset, offset + count]
        const msg = createLogRequestDataMessage(
          droneSysId,
          MAV_COMP_ID_AUTOPILOT1,
          logId,
          offset,
          count,
        )
        this.send(msg).catch((error) => fail(error as Error))
        scheduleIdleTimer()
      }

      const requestNextMissing = () => {
        const missing = received.firstMissing(totalSize)
        if (!missing) {
          succeed()
          return
        }
        const [start, end] = missing
        // Cap each request size so we don't ask for absurd amounts on a freshly
        // started download; subsequent rounds will fetch the next gap.
        const count = Math.min(end - start, LOG_DOWNLOAD_INITIAL_CHUNK)
        console.log(
          `[DroneConnection] Requesting log ${logId} bytes ${start}-${start + count - 1} (${count} bytes)`,
        )
        requestRange(start, count)
      }

      const handleIdle = () => {
        if (isSettled) return
        const bytesReceived = received.totalReceived(totalSize)
        if (bytesReceived === bytesAtLastIdleCheck) {
          stallRounds++
        } else {
          stallRounds = 0
          bytesAtLastIdleCheck = bytesReceived
        }
        if (stallRounds >= LOG_DOWNLOAD_MAX_STALL_ROUNDS) {
          const missing = received.firstMissing(totalSize)
          const missingDesc = missing ? `${missing[0]}-${missing[1]}` : 'unknown'
          fail(
            new Error(
              `Download stalled: received ${bytesReceived} of ${totalSize} bytes; first missing range ${missingDesc}`,
            ),
          )
          return
        }
        if (received.isComplete(totalSize)) {
          succeed()
          return
        }
        console.log(
          `[DroneConnection] Idle with ${bytesReceived}/${totalSize} bytes, re-requesting first gap (stall round ${stallRounds})`,
        )
        requestNextMissing()
      }

      this.events.onLogData = (data) => {
        originalOnLogData?.(data)
        if (isSettled) return
        if (data.id !== logId) return

        // Clip the incoming chunk to the declared file size. Some autopilots
        // (ArduPilot in particular) send a final LOG_DATA whose ofs+count
        // exceeds the size reported in LOG_ENTRY by a few bytes.
        const start = data.ofs
        if (start >= totalSize) return
        const end = Math.min(data.ofs + data.count, totalSize)
        if (end <= start) return
        const writeLen = end - start

        buffer.set(data.data.subarray(0, writeLen), start)
        received.add(start, end)

        reportProgress()

        if (received.isComplete(totalSize)) {
          succeed()
          return
        }

        // If we've drained the most recently requested range, eagerly ask
        // for the next gap rather than waiting for the idle timer.
        if (pendingRequest && end >= pendingRequest[1]) {
          pendingRequest = null
          requestNextMissing()
          return
        }

        scheduleIdleTimer()
      }

      // Kick off: ask for the whole file in one request. The drone will stream
      // it back as a long sequence of 90-byte LOG_DATA messages, and any
      // dropped chunks will be picked up by the idle/gap-recovery path.
      requestNextMissing()
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
