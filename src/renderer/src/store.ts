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

export interface PendingRequest {
  kind: 'lan' | 'code'
  connId?: string
  offerSdp?: string
  code?: string
  sessionId?: string
  peerName: string
  peerOs?: string
  ts: number
  /** 15s 内未响应自动拒绝 */
  deadline: number
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
  pending: PendingRequest | null
  signalConnected: boolean
  signalBroker: string
  signalError: string
  latestVersion: string | null
  latestReleaseUrl: string | null
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
  setPending(pending: PendingRequest | null): void
  acceptPending(): void
  rejectPending(): void
  setSignalStatus(connected: boolean, broker: string, error?: string): void
  patchSettings(patch: Partial<Settings>): Promise<void>
  toast(kind: Toast['kind'], title: string, desc?: string): void
  dismissToast(id: string): void
  checkUpdates(silent?: boolean): Promise<void>
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
  pending: null,
  signalConnected: false,
  signalBroker: '',
  signalError: '',
  latestVersion: null,
  latestReleaseUrl: null,
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
      on ? '对方输入远程码与密码即可直接连接' : undefined
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

  setPending(pending) {
    set({ pending })
  },

  acceptPending() {
    const { pending, pin, displays } = get()
    if (!pending) return
    const displayId = displays.find((d) => d.primary)?.id ?? displays[0]?.id ?? 0
    set({
      launch: {
        role: 'host',
        transport: pending.kind,
        pin,
        connId: pending.connId,
        code: pending.code,
        sessionId: pending.sessionId,
        offerSdp: pending.offerSdp,
        peerName: pending.peerName,
        peerOs: pending.peerOs,
        displayId
      },
      pending: null
    })
  },

  rejectPending() {
    const pending = get().pending
    if (!pending) return
    if (pending.kind === 'lan' && pending.connId) {
      void window.cdesk.lan.close(pending.connId).catch(() => {})
    }
    set({ pending: null })
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
  },

  async checkUpdates(silent = true) {
    try {
      const release = await window.cdesk.app.latestRelease()
      if (!release?.version) {
        if (!silent) get().toast('error', '检查更新失败', '无法访问 GitHub Release，请检查网络')
        return
      }
      const cmp = (a: string, b: string) => {
        const pa = a.split('.').map(Number)
        const pb = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) {
          const x = pa[i] ?? 0
          const y = pb[i] ?? 0
          if (x !== y) return x - y
        }
        return 0
      }
      const current = get().info?.version ?? '0.0.0'
      set({ latestVersion: release.version, latestReleaseUrl: release.url })
      if (cmp(release.version, current) > 0) {
        get().toast('info', `发现新版本 v${release.version}`, '前往 GitHub Release 下载更新')
      } else if (!silent) {
        get().toast('success', '已是最新版本', `当前 v${current} 已是最新`)
      }
    } catch {
      if (!silent) get().toast('error', '检查更新失败', '请稍后重试')
    }
  }
}))
