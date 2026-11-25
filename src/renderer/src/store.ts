import { create } from 'zustand'
import type { AppInfo, Capabilities, DisplayInfo, Peer, Settings } from '@shared/types'
import type { SessionRole, SessionTransport } from './lib/session'
import { randomPin } from './lib/utils'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  title: string
  desc?: string
}

export interface IncomingCall {
  connId: string
  name: string
  os: string
  address?: string
  ts: number
}

export interface SessionLaunch {
  role: SessionRole
  transport: SessionTransport
  pin: string
  connId?: string
  peerName: string
  peerOs?: string
  invite?: string
  displayId?: number
}

export type Page = 'home' | 'settings'

interface AppState {
  booted: boolean
  info: AppInfo | null
  settings: Settings | null
  capabilities: Capabilities | null
  displays: DisplayInfo[]
  peers: Peer[]
  hosting: boolean
  pin: string
  page: Page
  launch: SessionLaunch | null
  incoming: IncomingCall | null
  toasts: Toast[]

  init(): Promise<void>
  refreshPeers(): Promise<void>
  setPeers(peers: Peer[]): void
  refreshDisplays(): Promise<void>
  refreshCapabilities(): Promise<void>
  setHosting(on: boolean): Promise<void>
  regeneratePin(): void
  setPage(page: Page): void
  setLaunch(launch: SessionLaunch | null): void
  setIncoming(call: IncomingCall | null): void
  patchSettings(patch: Partial<Settings>): Promise<void>
  toast(kind: Toast['kind'], title: string, desc?: string): void
  dismissToast(id: string): void
}

function resolvePin(settings: Settings | null): string {
  if (settings?.pinMode === 'fixed' && settings.fixedPin.length >= 4) return settings.fixedPin
  return randomPin(6)
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  info: null,
  settings: null,
  capabilities: null,
  displays: [],
  peers: [],
  hosting: false,
  pin: '',
  page: 'home',
  launch: null,
  incoming: null,
  toasts: [],

  async init() {
    if (get().booted) return
    const [info, settings, capabilities, displays] = await Promise.all([
      window.cdesk.app.info(),
      window.cdesk.settings.get(),
      window.cdesk.system.capabilities(),
      window.cdesk.system.displays()
    ])
    set({ info, settings, capabilities, displays, booted: true })
    try {
      await window.cdesk.lan.start({
        id: settings.deviceId,
        name: settings.deviceName,
        hosting: false,
        version: info.version
      })
      set({ peers: await window.cdesk.lan.peers() })
    } catch (err) {
      console.error('LAN 启动失败', err)
    }
    document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
  },

  async refreshPeers() {
    const peers = await window.cdesk.lan.peers()
    set({ peers })
  },

  setPeers(peers) {
    set({ peers })
  },

  async refreshDisplays() {
    set({ displays: await window.cdesk.system.displays() })
  },

  async refreshCapabilities() {
    set({ capabilities: await window.cdesk.system.capabilities() })
  },

  async setHosting(on) {
    const { settings, info, pin, launch } = get()
    if (!settings || !info) return
    const nextPin = on ? resolvePin(settings) || pin : ''
    set({ hosting: on, pin: on ? nextPin : '' })
    await window.cdesk.lan.update({
      id: settings.deviceId,
      name: settings.deviceName,
      hosting: on,
      version: info.version
    })
    if (!on) {
      set({ incoming: null })
      if (launch?.role === 'host' && launch.transport === 'lan') set({ launch: null })
    }
    get().toast(
      on ? 'success' : 'info',
      on ? '已允许远程控制' : '已停止接受连接',
      on ? '同一局域网的设备现在可以发现本机' : undefined
    )
  },

  regeneratePin() {
    const { settings, hosting } = get()
    if (!hosting) return
    set({ pin: resolvePin(settings) })
  },

  setPage(page) {
    set({ page })
  },

  setLaunch(launch) {
    set({ launch })
  },

  setIncoming(call) {
    set({ incoming: call })
  },

  async patchSettings(patch) {
    const settings = await window.cdesk.settings.set(patch)
    set({ settings })
    if (patch.theme) document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
    if (patch.reduceMotion !== undefined) {
      document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
    }
    if (patch.deviceName !== undefined || patch.deviceId !== undefined) {
      const info = get().info
      await window.cdesk.lan.update({
        id: settings.deviceId,
        name: settings.deviceName,
        hosting: get().hosting,
        version: info?.version ?? '1.0.0'
      })
    }
  },

  toast(kind, title, desc) {
    const id = Math.random().toString(36).slice(2)
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, desc }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  }
}))
