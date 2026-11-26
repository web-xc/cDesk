export type QualityPreset = 'smooth' | 'balanced' | 'sharp'

export type ThemeMode = 'dark' | 'light' | 'system'

export interface Settings {
  deviceId: string
  /** 9 位固定远程码，由 deviceId 派生，永久不变 */
  deviceCode: string
  deviceName: string
  theme: ThemeMode
  pinMode: 'random' | 'fixed'
  /** 控制密码：随机模式下由客户端生成，自定义模式下为用户设置值 */
  fixedPin: string
  quality: QualityPreset
  clipboardSync: boolean
  stunEnabled: boolean
  turnUrl: string
  turnUser: string
  turnPass: string
  launchAtLogin: boolean
  showStats: boolean
  viewOnly: boolean
  reduceMotion: boolean
  /** true 表示密码匹配即自动接受；false 显示系统级接受/拒绝弹窗 */
  autoAccept: boolean
}

export interface SignalStatus {
  connected: boolean
  broker: string
  error?: string
}

export interface SignalMessage {
  topic: string
  payload: string
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
  hostname: string
  osName: string
  osVersion: string
  isDev: boolean
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  scaleFactor: number
  primary: boolean
  rotation: number
  refreshRate: number
  thumbnail: string | null
}

export interface Capabilities {
  remoteInput: boolean
  backend: string | null
  accessibility: 'granted' | 'denied' | 'unsupported'
  screen: 'granted' | 'denied' | 'unknown' | 'unsupported'
  loopbackAudio: boolean
}

export interface Peer {
  id: string
  name: string
  os: string
  platform: string
  address: string
  port: number
  hosting: boolean
  version: string
  lastSeen: number
}

export interface PeerFrom {
  id: string
  name: string
  os: string
  address?: string
}

export interface IncomingConnection {
  connId: string
  from: PeerFrom
}

export interface LanProfile {
  id: string
  name: string
  hosting: boolean
  version: string
}

export interface SaveFileRequest {
  defaultName: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveFileResult {
  canceled: boolean
  path?: string
}

export interface IncomingFileRequest {
  name: string
  size: number
}

export interface IncomingFileResult {
  handle: string
  path: string
}

export interface MouseEventMessage {
  a: 'move' | 'down' | 'up' | 'wheel'
  x: number
  y: number
  button?: number
  delta?: number
  displayId: number
}

export interface KeyEventMessage {
  a: 'down' | 'up'
  code: string
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}

export interface DisplaySummary {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface CdeskApi {
  env: {
    platform: NodeJS.Platform
    isMac: boolean
    isWindows: boolean
    version: string
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    relaunch(): Promise<void>
    setLaunchAtLogin(on: boolean): Promise<void>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    setFullScreen(on: boolean): Promise<void>
    onMaximized(cb: (max: boolean) => void): () => void
    onFullScreen(cb: (on: boolean) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  system: {
    displays(): Promise<DisplayInfo[]>
    capabilities(): Promise<Capabilities>
    requestAccessibility(): Promise<boolean>
    openPermission(kind: 'screen' | 'accessibility' | 'microphone'): Promise<void>
  }
  clipboard: {
    read(): Promise<string>
    write(text: string): Promise<void>
  }
  dialog: {
    save(request: SaveFileRequest, data: ArrayBuffer | string): Promise<SaveFileResult>
    openFolder(path: string): Promise<void>
    chooseFiles(): Promise<{ name: string; path: string; size: number }[]>
  }
  lan: {
    start(profile: LanProfile): Promise<{ port: number }>
    update(profile: LanProfile): Promise<void>
    stop(): Promise<void>
    peers(): Promise<Peer[]>
    connect(address: string, port: number): Promise<IncomingConnection>
    send(connId: string, data: unknown): Promise<void>
    close(connId: string): Promise<void>
    onPeers(cb: (peers: Peer[]) => void): () => void
    onConn(cb: (conn: IncomingConnection) => void): () => void
    onMessage(cb: (msg: { connId: string; data: unknown }) => void): () => void
    onClosed(cb: (msg: { connId: string }) => void): () => void
  }
  signal: {
    status(): Promise<SignalStatus>
    connect(): Promise<SignalStatus>
    subscribe(topic: string): Promise<void>
    unsubscribe(topic: string): Promise<void>
    publish(topic: string, payload: string): Promise<void>
    onMessage(cb: (msg: SignalMessage) => void): () => void
    onStatus(cb: (status: SignalStatus) => void): () => void
  }
  capture: {
    chooseDisplay(id: number): Promise<void>
    sources(): Promise<{ id: string; name: string; displayId: string; thumbnail: string }[]>
  }
  input: {
    mouse(msg: MouseEventMessage): Promise<boolean>
    key(msg: KeyEventMessage): Promise<boolean>
    text(text: string): Promise<boolean>
  }
  power: {
    preventSleep(on: boolean): Promise<void>
  }
  files: {
    beginReceive(name: string, size: number): Promise<IncomingFileResult>
    writeChunk(handle: string, data: ArrayBuffer): Promise<void>
    endReceive(handle: string): Promise<string>
    abortReceive(handle: string): Promise<void>
  }
  session: {
    setActive(active: boolean): Promise<void>
  }
}
