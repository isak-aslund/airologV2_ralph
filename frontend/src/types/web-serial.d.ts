/**
 * Web Serial API Type Definitions
 * https://wicg.github.io/serial/
 */

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

interface SerialOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
  bufferSize?: number
  flowControl?: 'none' | 'hardware'
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  getInfo(): SerialPortInfo
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  forget(): Promise<void>
  setSignals(signals: {
    dataTerminalReady?: boolean
    requestToSend?: boolean
    break?: boolean
  }): Promise<void>
  getSignals(): Promise<{
    dataCarrierDetect: boolean
    clearToSend: boolean
    ringIndicator: boolean
    dataSetReady: boolean
  }>
}

interface Serial extends EventTarget {
  onconnect: ((this: Serial, ev: Event) => void) | null
  ondisconnect: ((this: Serial, ev: Event) => void) | null
  getPorts(): Promise<SerialPort[]>
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
}

interface Navigator {
  readonly serial: Serial
}
