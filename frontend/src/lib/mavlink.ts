/**
 * MAVLink v2 Protocol Parser
 *
 * Implements parsing and creation of MAVLink v2 messages for drone log download functionality.
 * Reference: https://mavlink.io/en/guide/serialization.html
 */

// MAVLink v2 constants
export const MAVLINK_STX_V2 = 0xfd // MAVLink v2 start byte
export const MAVLINK_STX_V1 = 0xfe // MAVLink v1 start byte (for compatibility)

// Message IDs
export const MSG_ID_HEARTBEAT = 0
export const MSG_ID_LOG_REQUEST_LIST = 117
export const MSG_ID_LOG_ENTRY = 118
export const MSG_ID_LOG_REQUEST_DATA = 119
export const MSG_ID_LOG_DATA = 120
export const MSG_ID_LOG_REQUEST_END = 122

// Component IDs
export const MAV_COMP_ID_AUTOPILOT1 = 1
export const MAV_COMP_ID_ALL = 0

// MAV_TYPE values
export const MAV_TYPE_GCS = 6 // Ground Control Station

// MAV_AUTOPILOT values
export const MAV_AUTOPILOT_INVALID = 8

// CRC-16/MCRF4XX extra bytes (message-specific CRC seed)
// These values are from mavlink generator and are specific to each message
const CRC_EXTRA: Record<number, number> = {
  [MSG_ID_HEARTBEAT]: 50,
  [MSG_ID_LOG_REQUEST_LIST]: 128,
  [MSG_ID_LOG_ENTRY]: 56,
  [MSG_ID_LOG_REQUEST_DATA]: 116,
  [MSG_ID_LOG_DATA]: 134,
  [MSG_ID_LOG_REQUEST_END]: 203,
}

// Parsed message types
export interface MAVLinkMessage {
  msgId: number
  sysId: number
  compId: number
  seq: number
  payload: Uint8Array
}

export interface HeartbeatMessage {
  type: number
  autopilot: number
  baseMode: number
  customMode: number
  systemStatus: number
  mavlinkVersion: number
}

export interface LogEntryMessage {
  id: number
  numLogs: number
  lastLogNum: number
  timeUtc: number
  size: number
}

export interface LogDataMessage {
  id: number
  ofs: number
  count: number
  data: Uint8Array
}

/**
 * X.25 CRC-16/MCRF4XX calculation for MAVLink
 */
function crc16Accumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff)
  tmp ^= (tmp << 4) & 0xff
  return (((crc >> 8) & 0xff) ^ (tmp << 8) ^ (tmp << 3) ^ ((tmp >> 4) & 0xff)) & 0xffff
}

function calculateCRC(buffer: Uint8Array, crcExtra: number): number {
  let crc = 0xffff
  for (const byte of buffer) {
    crc = crc16Accumulate(byte, crc)
  }
  crc = crc16Accumulate(crcExtra, crc)
  return crc
}

/**
 * MAVLink v2 message parser state machine
 */
export class MAVLinkParser {
  private buffer: number[] = []
  private state: 'IDLE' | 'HEADER' | 'PAYLOAD' | 'CRC' = 'IDLE'
  private expectedLength = 0
  private incomingMessage: Partial<MAVLinkMessage> = {}

  /**
   * Parse incoming byte stream and return complete messages
   */
  parse(data: Uint8Array): MAVLinkMessage[] {
    const messages: MAVLinkMessage[] = []

    for (const byte of data) {
      switch (this.state) {
        case 'IDLE':
          if (byte === MAVLINK_STX_V2) {
            this.buffer = [byte]
            this.state = 'HEADER'
          }
          break

        case 'HEADER':
          this.buffer.push(byte)
          // MAVLink v2 header: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3)
          if (this.buffer.length === 10) {
            this.expectedLength = this.buffer[1] // payload length
            this.incomingMessage = {
              seq: this.buffer[4],
              sysId: this.buffer[5],
              compId: this.buffer[6],
              msgId: this.buffer[7] | (this.buffer[8] << 8) | (this.buffer[9] << 16),
            }
            if (this.expectedLength > 0) {
              this.state = 'PAYLOAD'
            } else {
              this.state = 'CRC'
            }
          }
          break

        case 'PAYLOAD':
          this.buffer.push(byte)
          // Header (10) + payload (expectedLength)
          if (this.buffer.length === 10 + this.expectedLength) {
            this.state = 'CRC'
          }
          break

        case 'CRC':
          this.buffer.push(byte)
          // Header (10) + payload + CRC (2)
          if (this.buffer.length === 10 + this.expectedLength + 2) {
            // Verify CRC
            const msgId = this.incomingMessage.msgId!
            const crcExtra = CRC_EXTRA[msgId] ?? 0

            // CRC is calculated over bytes 1 to end of payload (excluding STX and CRC itself)
            const crcData = new Uint8Array(this.buffer.slice(1, 10 + this.expectedLength))
            const calculatedCRC = calculateCRC(crcData, crcExtra)
            const receivedCRC = this.buffer[this.buffer.length - 2] | (this.buffer[this.buffer.length - 1] << 8)

            if (calculatedCRC === receivedCRC) {
              const payload = new Uint8Array(this.buffer.slice(10, 10 + this.expectedLength))
              messages.push({
                ...this.incomingMessage,
                payload,
              } as MAVLinkMessage)
            }

            // Reset state
            this.buffer = []
            this.state = 'IDLE'
            this.incomingMessage = {}
          }
          break
      }
    }

    return messages
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.buffer = []
    this.state = 'IDLE'
    this.incomingMessage = {}
  }
}

/**
 * Create a MAVLink v2 message
 */
function createMAVLinkMessage(
  msgId: number,
  payload: Uint8Array,
  sysId: number = 255,
  compId: number = MAV_COMP_ID_ALL,
  seq: number = 0
): Uint8Array {
  const crcExtra = CRC_EXTRA[msgId] ?? 0

  // Build header
  const header = new Uint8Array(10)
  header[0] = MAVLINK_STX_V2 // STX
  header[1] = payload.length // payload length
  header[2] = 0 // incompat_flags
  header[3] = 0 // compat_flags
  header[4] = seq & 0xff // sequence
  header[5] = sysId // system ID
  header[6] = compId // component ID
  header[7] = msgId & 0xff // msgid low
  header[8] = (msgId >> 8) & 0xff // msgid mid
  header[9] = (msgId >> 16) & 0xff // msgid high

  // Calculate CRC (over header bytes 1-9 + payload)
  const crcData = new Uint8Array(9 + payload.length)
  crcData.set(header.slice(1, 10))
  crcData.set(payload, 9)
  const crc = calculateCRC(crcData, crcExtra)

  // Build complete message
  const message = new Uint8Array(10 + payload.length + 2)
  message.set(header)
  message.set(payload, 10)
  message[message.length - 2] = crc & 0xff
  message[message.length - 1] = (crc >> 8) & 0xff

  return message
}

// Sequence counter for outgoing messages
let messageSeq = 0

function getNextSeq(): number {
  const seq = messageSeq
  messageSeq = (messageSeq + 1) & 0xff
  return seq
}

/**
 * Create a HEARTBEAT message
 * Used to maintain connection with the drone
 */
export function createHeartbeatMessage(sysId: number = 255): Uint8Array {
  // HEARTBEAT payload: type(1) + autopilot(1) + base_mode(1) + custom_mode(4) + system_status(1) + mavlink_version(1) = 9 bytes
  const payload = new Uint8Array(9)
  payload[0] = MAV_TYPE_GCS // type: GCS
  payload[1] = MAV_AUTOPILOT_INVALID // autopilot: invalid (GCS doesn't have autopilot)
  payload[2] = 0 // base_mode
  // custom_mode is 4 bytes at offset 3, leave as 0
  payload[7] = 0 // system_status: uninitialized
  payload[8] = 3 // mavlink_version

  return createMAVLinkMessage(MSG_ID_HEARTBEAT, payload, sysId, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Create a LOG_REQUEST_LIST message
 * Requests the list of available logs from the drone
 *
 * @param targetSysId - Target system ID (drone)
 * @param targetCompId - Target component ID
 * @param start - First log ID to request (0 for first available)
 * @param end - Last log ID to request (0xffff for last available)
 */
export function createLogRequestListMessage(
  targetSysId: number,
  targetCompId: number = MAV_COMP_ID_AUTOPILOT1,
  start: number = 0,
  end: number = 0xffff
): Uint8Array {
  // LOG_REQUEST_LIST payload: target_system(1) + target_component(1) + start(2) + end(2) = 6 bytes
  const payload = new Uint8Array(6)
  payload[0] = targetSysId
  payload[1] = targetCompId
  payload[2] = start & 0xff
  payload[3] = (start >> 8) & 0xff
  payload[4] = end & 0xff
  payload[5] = (end >> 8) & 0xff

  return createMAVLinkMessage(MSG_ID_LOG_REQUEST_LIST, payload, 255, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Create a LOG_REQUEST_DATA message
 * Requests log data from the drone
 *
 * @param targetSysId - Target system ID (drone)
 * @param targetCompId - Target component ID
 * @param logId - Log ID to download
 * @param offset - Offset into the log (byte position)
 * @param count - Number of bytes to request
 */
export function createLogRequestDataMessage(
  targetSysId: number,
  targetCompId: number = MAV_COMP_ID_AUTOPILOT1,
  logId: number,
  offset: number,
  count: number
): Uint8Array {
  // LOG_REQUEST_DATA payload: target_system(1) + target_component(1) + id(2) + ofs(4) + count(4) = 12 bytes
  const payload = new Uint8Array(12)
  payload[0] = targetSysId
  payload[1] = targetCompId
  payload[2] = logId & 0xff
  payload[3] = (logId >> 8) & 0xff
  payload[4] = offset & 0xff
  payload[5] = (offset >> 8) & 0xff
  payload[6] = (offset >> 16) & 0xff
  payload[7] = (offset >> 24) & 0xff
  payload[8] = count & 0xff
  payload[9] = (count >> 8) & 0xff
  payload[10] = (count >> 16) & 0xff
  payload[11] = (count >> 24) & 0xff

  return createMAVLinkMessage(MSG_ID_LOG_REQUEST_DATA, payload, 255, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Parse a LOG_ENTRY message payload
 */
export function parseLogEntry(payload: Uint8Array): LogEntryMessage | null {
  if (payload.length < 14) return null

  return {
    // uint16_t id (offset 0)
    id: payload[0] | (payload[1] << 8),
    // uint16_t num_logs (offset 2)
    numLogs: payload[2] | (payload[3] << 8),
    // uint16_t last_log_num (offset 4)
    lastLogNum: payload[4] | (payload[5] << 8),
    // uint32_t time_utc (offset 6)
    timeUtc: payload[6] | (payload[7] << 8) | (payload[8] << 16) | (payload[9] << 24),
    // uint32_t size (offset 10)
    size: payload[10] | (payload[11] << 8) | (payload[12] << 16) | (payload[13] << 24),
  }
}

/**
 * Parse a LOG_DATA message payload
 */
export function parseLogData(payload: Uint8Array): LogDataMessage | null {
  if (payload.length < 7) return null

  const count = payload[6]
  const data = payload.slice(7, 7 + count)

  return {
    // uint16_t id (offset 0)
    id: payload[0] | (payload[1] << 8),
    // uint32_t ofs (offset 2)
    ofs: payload[2] | (payload[3] << 8) | (payload[4] << 16) | (payload[5] << 24),
    // uint8_t count (offset 6)
    count,
    // uint8_t[90] data (offset 7)
    data: new Uint8Array(data),
  }
}

/**
 * Parse a HEARTBEAT message payload
 */
export function parseHeartbeat(payload: Uint8Array): HeartbeatMessage | null {
  if (payload.length < 9) return null

  return {
    type: payload[0],
    autopilot: payload[1],
    baseMode: payload[2],
    // custom_mode is uint32_t at offset 3 (little-endian)
    customMode: payload[3] | (payload[4] << 8) | (payload[5] << 16) | (payload[6] << 24),
    systemStatus: payload[7],
    mavlinkVersion: payload[8],
  }
}
