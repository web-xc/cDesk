import { create } from 'zustand'
import type { AppInfo, Capabilities, DisplayInfo, Peer, Settings } from '@shared/types'
import type { SessionRole, SessionTransport } from './lib/session'
import { randomPassword } from './lib/utils'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  title: string
  desc?: string
}

export interface SessionLaunch {
  role: SessionRole
  transport: SessionTransport
  pin: string
  connId?: string
  code?: string
  sessionId?: string
  offerSdp?: string
  peerName: string
  peerOs?: string
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
  signalConnected: boolean
  signalBroker: string
  signalError: string
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
  setSignalStatus(connected: boolean, broker: string, error?: string): void
  patchSettings(patch: Partial<Settings>): Promise<void>
  toast(kind: Toast['kind'], title: string, desc?: string): void
  dismissToast(id: string): void
}

function resolvePin(settings: Settings | null): string {
  if (settings?.pinMode === 'fixed' && settings.fixedPin.length >= 4) return settings.fixedPin
  return randomPassword(6)
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  info: null,
  settings: null,
  capabilities: null,
  displays: [],
  peers: [],
  hosting: true,
  pin: '',
  page: 'home',
  launch: null,
  signalConnected: false,
  signalBroker: '',
  signalError: '',
  toasts: [],

  async init() {
    if (get().booted) return
    const [info, settings, capabilities, displays] = await Promise.all([
      window.cdesk.app.info(),
      window.cdesk.settings.get(),
      window.cdesk.system.capabilities(),
      window.cdesk.system.displays()
    ])
    set({
      info,
      settings,
      capabilities,
      displays,
      booted: true,
      pin: resolvePin(settings),
      hosting: true
    })
    try {
      await window.cdesk.lan.start({
        id: settings.deviceId,
        name: settings.deviceName,
        hosting: true,
        version: info.version
      })
      set({ peers: await window.cdesk.lan.peers() })
    } catch (err) {
      console.error('LAN 启动失败', err)
    }
    void window.cdesk.signal.connect().then((status) => {
      get().setSignalStatus(status.connected, status.broker, status.error)
    })
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
    const nextPin = on ? pin || resolvePin(settings) : ''
    set({ hosting: on, pin: nextPin })
    await window.cdesk.lan.update({
      id: settings.deviceId,
      name: settings.deviceName,
      hosting: on,
      version: info.version
    })
    if (!on && launch?.role === 'host' && launch.transport === 'lan') set({ launch: null })
    get().toast(
      on ? 'success' : 'info',
      on ? '已允许远程控制' : '已停止接受连接',
      on ? '对方输入控制码与密码即可直接连接' : undefined
    )
  },

  regeneratePin() {
    const { settings, hosting } = get()
    if (!hosting) return
    if (settings?.pinMode === 'fixed' && settings.fixedPin.length >= 4) {
      set({ pin: settings.fixedPin })
      return
    }
    set({ pin: randomPassword(6) })
  },

  setPage(page) {
    set({ page })
  },

  setLaunch(launch) {
    set({ launch })
  },

  setSignalStatus(connected, broker, error = '') {
    set({ signalConnected: connected, signalBroker: broker, signalError: error })
  },

  async patchSettings(patch) {
    const previous = get().settings
    const settings = await window.cdesk.settings.set(patch)
    set({ settings })
    if (patch.theme) document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
    if (patch.reduceMotion !== undefined) {
      document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
    }
    if (
      patch.pinMode !== undefined ||
      patch.fixedPin !== undefined ||
      previous?.pinMode !== settings.pinMode
    ) {
      set({ pin: resolvePin(settings) })
    }
    if (patch.deviceName !== undefined) {
      const info = get().info
      await window.cdesk.lan.update({
        id: settings.deviceId,
        name: settings.deviceName,
        hosting: get().hosting,
        version: info?.version ?? '1.1.0'
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
