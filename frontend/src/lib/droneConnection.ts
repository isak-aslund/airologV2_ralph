/**
 * Drone Connection via Web Serial API
 *
 * Provides functions to connect to a drone via USB serial port,
 * maintain the connection with heartbeats, and receive MAVLink messages.
 */

import {
  MAVLinkParser,
  MAVLinkMessage,
  createHeartbeatMessage,
  MSG_ID_HEARTBEAT,
  MSG_ID_LOG_ENTRY,
  MSG_ID_LOG_DATA,
  parseHeartbeat,
  parseLogEntry,
  parseLogData,
  HeartbeatMessage,
  LogEntryMessage,
  LogDataMessage,
} from './mavlink'

// Connection constants
const BAUD_RATE = 115200
const HEARTBEAT_INTERVAL_MS = 1000 // Send heartbeat every 1 second

// Connection state
export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

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
          }
          this.events.onHeartbeat?.(heartbeat, message.sysId)
        }
        break
      }

      case MSG_ID_LOG_ENTRY: {
        const entry = parseLogEntry(message.payload)
        if (entry) {
          this.events.onLogEntry?.(entry)
        }
        break
      }

      case MSG_ID_LOG_DATA: {
        const data = parseLogData(message.payload)
        if (data) {
          this.events.onLogData?.(data)
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
