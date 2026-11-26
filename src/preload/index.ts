import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  Capabilities,
  CdeskApi,
  DisplayInfo,
  DisplaySummary,
  IncomingConnection,
  IncomingFileResult,
  KeyEventMessage,
  LanProfile,
  MouseEventMessage,
  Peer,
  SaveFileRequest,
  SaveFileResult,
  Settings,
  SignalMessage,
  SignalStatus
} from '@shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CdeskApi = {
  env: {
    platform: process.platform,
    isMac: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    version: process.versions.electron
  },
  app: {
    info: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
    relaunch: () => ipcRenderer.invoke('app:relaunch') as Promise<void>,
    setLaunchAtLogin: (on: boolean) =>
      ipcRenderer.invoke('app:launch-at-login', on) as Promise<void>,
    latestRelease: () => ipcRenderer.invoke('app:latest-release') as Promise<{
      version: string
      url: string
      notes: string
    } | null>
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    setFullScreen: (on: boolean) =>
      ipcRenderer.invoke('window:set-fullscreen', on) as Promise<void>,
    onMaximized: (cb) => on<boolean>('window:maximized', cb),
    onFullScreen: (cb) => on<boolean>('window:fullscreen', cb)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,
    onChange: (cb) => on<Settings>('settings:changed', cb)
  },
  system: {
    displays: () => ipcRenderer.invoke('system:displays') as Promise<DisplayInfo[]>,
    capabilities: () => ipcRenderer.invoke('system:capabilities') as Promise<Capabilities>,
    requestAccessibility: () =>
      ipcRenderer.invoke('system:request-accessibility') as Promise<boolean>,
    openPermission: (kind) =>
      ipcRenderer.invoke('system:open-permission', kind) as Promise<void>
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text) as Promise<void>
  },
  dialog: {
    save: (request: SaveFileRequest, data: ArrayBuffer | string) =>
      ipcRenderer.invoke('dialog:save', request, data) as Promise<SaveFileResult>,
    openFolder: (target: string) =>
      ipcRenderer.invoke('dialog:open-folder', target) as Promise<void>,
    chooseFiles: () =>
      ipcRenderer.invoke('dialog:choose-files') as Promise<
        { name: string; path: string; size: number }[]
      >
  },
  lan: {
    start: (profile: LanProfile) =>
      ipcRenderer.invoke('lan:start', profile) as Promise<{ port: number }>,
    update: (profile: LanProfile) =>
      ipcRenderer.invoke('lan:update', profile) as Promise<void>,
    stop: () => ipcRenderer.invoke('lan:stop') as Promise<void>,
    peers: () => ipcRenderer.invoke('lan:peers') as Promise<Peer[]>,
    connect: (address: string, port: number) =>
      ipcRenderer.invoke('lan:connect', address, port) as Promise<IncomingConnection>,
    send: (connId: string, data: unknown) =>
      ipcRenderer.invoke('lan:send', connId, data) as Promise<void>,
    close: (connId: string) => ipcRenderer.invoke('lan:close', connId) as Promise<void>,
    onPeers: (cb) => on<Peer[]>('lan:peers', cb),
    onConn: (cb) => on<IncomingConnection>('lan:conn', cb),
    onMessage: (cb) => on<{ connId: string; data: unknown }>('lan:message', cb),
    onClosed: (cb) => on<{ connId: string }>('lan:closed', cb)
  },
  signal: {
    status: () => ipcRenderer.invoke('signal:status') as Promise<SignalStatus>,
    connect: () => ipcRenderer.invoke('signal:connect') as Promise<SignalStatus>,
    subscribe: (topic: string) => ipcRenderer.invoke('signal:subscribe', topic) as Promise<void>,
    unsubscribe: (topic: string) =>
      ipcRenderer.invoke('signal:unsubscribe', topic) as Promise<void>,
    publish: (topic: string, payload: string) =>
      ipcRenderer.invoke('signal:publish', topic, payload) as Promise<void>,
    onMessage: (cb) => on<SignalMessage>('signal:message', cb),
    onStatus: (cb) => on<SignalStatus>('signal:status', cb)
  },
  capture: {
    chooseDisplay: (id: number) =>
      ipcRenderer.invoke('capture:choose-display', id) as Promise<void>,
    sources: () =>
      ipcRenderer.invoke('capture:sources') as Promise<
        { id: string; name: string; displayId: string; thumbnail: string }[]
      >
  },
  input: {
    mouse: (msg: MouseEventMessage) =>
      ipcRenderer.invoke('input:mouse', msg) as Promise<boolean>,
    key: (msg: KeyEventMessage) => ipcRenderer.invoke('input:key', msg) as Promise<boolean>,
    text: (text: string) => ipcRenderer.invoke('input:text', text) as Promise<boolean>
  },
  power: {
    preventSleep: (on: boolean) =>
      ipcRenderer.invoke('power:prevent-sleep', on) as Promise<void>
  },
  files: {
    beginReceive: (name: string, size: number) =>
      ipcRenderer.invoke('files:begin', name, size) as Promise<IncomingFileResult>,
    writeChunk: (handle: string, data: ArrayBuffer) =>
      ipcRenderer.invoke('files:chunk', handle, data) as Promise<void>,
    endReceive: (handle: string) => ipcRenderer.invoke('files:end', handle) as Promise<string>,
    abortReceive: (handle: string) => ipcRenderer.invoke('files:abort', handle) as Promise<void>
  },
  session: {
    setActive: (active: boolean) =>
      ipcRenderer.invoke('session:active', active) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('cdesk', api)
