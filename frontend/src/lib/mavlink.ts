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
export const MSG_ID_PARAM_REQUEST_READ = 20
export const MSG_ID_PARAM_VALUE = 22
export const MSG_ID_PARAM_SET = 23
export const MSG_ID_LOG_REQUEST_LIST = 117
export const MSG_ID_LOG_ENTRY = 118
export const MSG_ID_LOG_REQUEST_DATA = 119
export const MSG_ID_LOG_DATA = 120
export const MSG_ID_LOG_REQUEST_END = 122

// MAVLink parameter types
export const MAV_PARAM_TYPE_INT32 = 6
export const MAV_PARAM_TYPE_REAL32 = 9

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
  [MSG_ID_PARAM_REQUEST_READ]: 214,
  [MSG_ID_PARAM_VALUE]: 220,
  [MSG_ID_PARAM_SET]: 168,
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

export interface ParamValueMessage {
  paramId: string
  paramValue: number // float representation
  paramCount: number
  paramIndex: number
  paramType: number
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
 * MAVLink wire format (sorted by type size):
 * custom_mode: uint32 (offset 0-3)
 * type: uint8 (offset 4)
 * autopilot: uint8 (offset 5)
 * base_mode: uint8 (offset 6)
 * system_status: uint8 (offset 7)
 * mavlink_version: uint8 (offset 8)
 */
export function createHeartbeatMessage(sysId: number = 255): Uint8Array {
  const payload = new Uint8Array(9)
  // custom_mode at offset 0-3, leave as 0
  payload[4] = MAV_TYPE_GCS // type: GCS
  payload[5] = MAV_AUTOPILOT_INVALID // autopilot: invalid (GCS doesn't have autopilot)
  payload[6] = 0 // base_mode
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
  // LOG_REQUEST_LIST payload - MAVLink wire format (sorted by type size):
  // start: uint16 (offset 0-1)
  // end: uint16 (offset 2-3)
  // target_system: uint8 (offset 4)
  // target_component: uint8 (offset 5)
  const payload = new Uint8Array(6)
  payload[0] = start & 0xff
  payload[1] = (start >> 8) & 0xff
  payload[2] = end & 0xff
  payload[3] = (end >> 8) & 0xff
  payload[4] = targetSysId
  payload[5] = targetCompId

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
  // LOG_REQUEST_DATA payload - MAVLink wire format (sorted by type size):
  // ofs: uint32 (offset 0-3)
  // count: uint32 (offset 4-7)
  // id: uint16 (offset 8-9)
  // target_system: uint8 (offset 10)
  // target_component: uint8 (offset 11)
  const payload = new Uint8Array(12)
  payload[0] = offset & 0xff
  payload[1] = (offset >> 8) & 0xff
  payload[2] = (offset >> 16) & 0xff
  payload[3] = (offset >> 24) & 0xff
  payload[4] = count & 0xff
  payload[5] = (count >> 8) & 0xff
  payload[6] = (count >> 16) & 0xff
  payload[7] = (count >> 24) & 0xff
  payload[8] = logId & 0xff
  payload[9] = (logId >> 8) & 0xff
  payload[10] = targetSysId
  payload[11] = targetCompId

  return createMAVLinkMessage(MSG_ID_LOG_REQUEST_DATA, payload, 255, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Parse a LOG_ENTRY message payload
 * MAVLink wire format (sorted by type size):
 * time_utc: uint32 (offset 0-3)
 * size: uint32 (offset 4-7)
 * id: uint16 (offset 8-9)
 * num_logs: uint16 (offset 10-11)
 * last_log_num: uint16 (offset 12-13)
 *
 * Note: MAVLink allows trailing zero bytes to be omitted, so payload may be shorter than 14 bytes
 */
export function parseLogEntry(payload: Uint8Array): LogEntryMessage | null {
  // Minimum 10 bytes needed (time_utc + size + id)
  if (payload.length < 10) return null

  // Helper to safely get byte (returns 0 if out of bounds - handles MAVLink zero trimming)
  const getByte = (index: number) => index < payload.length ? payload[index] : 0

  return {
    timeUtc: getByte(0) | (getByte(1) << 8) | (getByte(2) << 16) | ((getByte(3) << 24) >>> 0),
    size: getByte(4) | (getByte(5) << 8) | (getByte(6) << 16) | ((getByte(7) << 24) >>> 0),
    id: getByte(8) | (getByte(9) << 8),
    numLogs: getByte(10) | (getByte(11) << 8),
    lastLogNum: getByte(12) | (getByte(13) << 8),
  }
}

/**
 * Parse a LOG_DATA message payload
 * MAVLink wire format (sorted by type size):
 * ofs: uint32 (offset 0-3)
 * id: uint16 (offset 4-5)
 * count: uint8 (offset 6)
 * data: uint8[90] (offset 7+)
 */
export function parseLogData(payload: Uint8Array): LogDataMessage | null {
  if (payload.length < 7) return null

  const count = payload[6]
  const data = payload.slice(7, 7 + count)

  return {
    ofs: payload[0] | (payload[1] << 8) | (payload[2] << 16) | ((payload[3] << 24) >>> 0),
    id: payload[4] | (payload[5] << 8),
    count,
    data: new Uint8Array(data),
  }
}

/**
 * Parse a HEARTBEAT message payload
 * MAVLink wire format (sorted by type size):
 * custom_mode: uint32 (offset 0-3)
 * type: uint8 (offset 4)
 * autopilot: uint8 (offset 5)
 * base_mode: uint8 (offset 6)
 * system_status: uint8 (offset 7)
 * mavlink_version: uint8 (offset 8)
 */
export function parseHeartbeat(payload: Uint8Array): HeartbeatMessage | null {
  if (payload.length < 9) return null

  return {
    customMode: payload[0] | (payload[1] << 8) | (payload[2] << 16) | ((payload[3] << 24) >>> 0),
    type: payload[4],
    autopilot: payload[5],
    baseMode: payload[6],
    systemStatus: payload[7],
    mavlinkVersion: payload[8],
  }
}

/**
 * Parse a PARAM_VALUE message payload
 * MAVLink wire format (sorted by type size):
 * param_value: float (offset 0-3)
 * param_count: uint16 (offset 4-5)
 * param_index: uint16 (offset 6-7)
 * param_id: char[16] (offset 8-23)
 * param_type: uint8 (offset 24)
 */
export function parseParamValue(payload: Uint8Array): ParamValueMessage | null {
  if (payload.length < 25) return null

  // Parse float value from bytes
  const floatBytes = new Uint8Array([payload[0], payload[1], payload[2], payload[3]])
  const floatView = new DataView(floatBytes.buffer)
  const paramValue = floatView.getFloat32(0, true) // little-endian

  // Parse param_id (null-terminated string)
  let paramId = ''
  for (let i = 8; i < 24 && payload[i] !== 0; i++) {
    paramId += String.fromCharCode(payload[i])
  }

  return {
    paramValue,
    paramCount: payload[4] | (payload[5] << 8),
    paramIndex: payload[6] | (payload[7] << 8),
    paramId,
    paramType: payload[24],
  }
}

/**
 * Create a PARAM_REQUEST_READ message
 * Requests a single parameter by name
 *
 * @param targetSysId - Target system ID (drone)
 * @param targetCompId - Target component ID
 * @param paramId - Parameter name (max 16 chars)
 */
export function createParamRequestReadMessage(
  targetSysId: number,
  targetCompId: number = MAV_COMP_ID_AUTOPILOT1,
  paramId: string
): Uint8Array {
  // PARAM_REQUEST_READ payload - MAVLink wire format (sorted by type size):
  // param_index: int16 (offset 0-1) - use -1 to request by name
  // target_system: uint8 (offset 2)
  // target_component: uint8 (offset 3)
  // param_id: char[16] (offset 4-19)
  const payload = new Uint8Array(20)

  // param_index = -1 means request by name
  payload[0] = 0xff // -1 as int16 little-endian
  payload[1] = 0xff
  payload[2] = targetSysId
  payload[3] = targetCompId

  // Copy param_id (null-padded)
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(paramId)
  for (let i = 0; i < 16 && i < nameBytes.length; i++) {
    payload[4 + i] = nameBytes[i]
  }

  return createMAVLinkMessage(MSG_ID_PARAM_REQUEST_READ, payload, 255, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Create a PARAM_SET message
 * Sets a parameter value on the drone
 *
 * @param targetSysId - Target system ID (drone)
 * @param targetCompId - Target component ID
 * @param paramId - Parameter name (max 16 chars)
 * @param paramValue - Parameter value as float bytes
 * @param paramType - Parameter type (MAV_PARAM_TYPE_*)
 */
export function createParamSetMessage(
  targetSysId: number,
  targetCompId: number = MAV_COMP_ID_AUTOPILOT1,
  paramId: string,
  paramValue: number,
  paramType: number = MAV_PARAM_TYPE_INT32
): Uint8Array {
  // PARAM_SET payload - MAVLink wire format (sorted by type size):
  // param_value: float (offset 0-3)
  // target_system: uint8 (offset 4)
  // target_component: uint8 (offset 5)
  // param_id: char[16] (offset 6-21)
  // param_type: uint8 (offset 22)
  const payload = new Uint8Array(23)

  // Write float value
  const floatView = new DataView(new ArrayBuffer(4))
  floatView.setFloat32(0, paramValue, true) // little-endian
  payload[0] = floatView.getUint8(0)
  payload[1] = floatView.getUint8(1)
  payload[2] = floatView.getUint8(2)
  payload[3] = floatView.getUint8(3)

  payload[4] = targetSysId
  payload[5] = targetCompId

  // Copy param_id (null-padded)
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(paramId)
  for (let i = 0; i < 16 && i < nameBytes.length; i++) {
    payload[6 + i] = nameBytes[i]
  }

  payload[22] = paramType

  return createMAVLinkMessage(MSG_ID_PARAM_SET, payload, 255, MAV_COMP_ID_ALL, getNextSeq())
}

/**
 * Convert an integer to float bytes for MAVLink parameter transmission
 * MAVLink transmits INT32 parameters as the bit-pattern reinterpreted as a float
 */
export function intToParamFloat(value: number): number {
  const buffer = new ArrayBuffer(4)
  const intView = new DataView(buffer)
  intView.setInt32(0, value, true) // write as int32 little-endian
  return intView.getFloat32(0, true) // read as float little-endian
}

/**
 * Convert float bytes back to integer for MAVLink parameter reception
 */
export function paramFloatToInt(value: number): number {
  const buffer = new ArrayBuffer(4)
  const floatView = new DataView(buffer)
  floatView.setFloat32(0, value, true) // write as float little-endian
  return floatView.getInt32(0, true) // read as int32 little-endian
}

/**
 * Convert float bytes back to unsigned integer for MAVLink parameter reception
 */
export function paramFloatToUint(value: number): number {
  const buffer = new ArrayBuffer(4)
  const floatView = new DataView(buffer)
  floatView.setFloat32(0, value, true) // write as float little-endian
  return floatView.getUint32(0, true) // read as uint32 little-endian
}
