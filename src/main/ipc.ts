import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  powerSaveBlocker,
  screen,
  session,
  shell,
  systemPreferences,
  webContents
} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppInfo,
  Capabilities,
  DisplayInfo,
  KeyEventMessage,
  LanProfile,
  MouseEventMessage,
  SaveFileRequest,
  Settings
} from '@shared/types'
import { getSettings, setSettings } from './store'
import { LanService } from './lan'
import { SignalService } from './signal'
import { backendName, hasBackend, injectKey, injectMouse, injectText } from './input'

const lan = new LanService()
const signal = new SignalService()
let chosenDisplayId: number | null = null
let sleepBlockerId: number | null = null

let releaseCache: {
  at: number
  value: { version: string; url: string; notes: string }
} | null = null

interface Writer {
  stream: fs.WriteStream
  path: string
  size: number
  written: number
}

const writers = new Map<string, Writer>()

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

function osName(): string {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  return 'Linux'
}

function displayLabel(index: number, primary: boolean): string {
  return `显示器 ${index + 1}${primary ? '（主）' : ''}`
}

async function listDisplays(withThumbnails = true): Promise<DisplayInfo[]> {
  const displays = screen.getAllDisplays()
  let thumbs = new Map<string, string>()
  if (withThumbnails) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 360, height: 220 }
      })
      thumbs = new Map(sources.map((s) => [s.display_id, s.thumbnail.toDataURL()]))
    } catch {
      thumbs = new Map()
    }
  }
  return displays.map((d, i) => ({
    id: d.id,
    label: displayLabel(i, d.id === screen.getPrimaryDisplay().id) + (d.label ? ` · ${d.label}` : ''),
    width: d.bounds.width,
    height: d.bounds.height,
    scaleFactor: d.scaleFactor,
    primary: d.id === screen.getPrimaryDisplay().id,
    rotation: d.rotation,
    refreshRate: (d as unknown as { displayFrequency?: number }).displayFrequency ?? 60,
    thumbnail: thumbs.get(String(d.id)) ?? null
  }))
}

function capabilities(): Capabilities {
  let accessibility: Capabilities['accessibility'] = 'unsupported'
  let screenPermission: Capabilities['screen'] = 'granted'
  if (process.platform === 'darwin') {
    try {
      accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    } catch {
      accessibility = 'denied'
    }
    try {
      screenPermission = systemPreferences.getMediaAccessStatus(
        'screen'
      ) as Capabilities['screen']
    } catch {
      screenPermission = 'unknown'
    }
  } else {
    accessibility = hasBackend() ? 'granted' : 'denied'
    screenPermission = 'granted'
  }
  return {
    remoteInput: hasBackend(),
    backend: backendName(),
    accessibility,
    screen: screenPermission,
    loopbackAudio: process.platform === 'win32'
  }
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160)
  return base || 'cdesk-file'
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  let candidate = path.join(dir, name)
  let i = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${i})${ext}`)
    i++
  }
  return candidate
}

export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        if (!sources.length) {
          callback({})
          return
        }
        const match =
          (chosenDisplayId !== null &&
            sources.find((s) => s.display_id === String(chosenDisplayId))) ||
          sources[0]
        const streams: Record<string, unknown> = { video: match }
        if (process.platform === 'win32') streams.audio = 'loopback'
        callback(streams as never)
      } catch (err) {
        console.error('[capture] display-media handler:', err)
        callback({})
      }
    },
    { useSystemPicker: false }
  )
}

export function registerIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => {
    const settings = getSettings()
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      osName: osName(),
      osVersion: os.release(),
      isDev: !app.isPackaged
    }
  })

  ipcMain.handle('app:open-external', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('app:launch-at-login', (_e, on: boolean) => {
    setSettings({ launchAtLogin: !!on })
  })

  // GitHub Release 版本检查放在主进程，避免渲染层 CSP 限制 connect-src
  ipcMain.handle('app:latest-release', async () => {
    if (releaseCache && Date.now() - releaseCache.at < 10 * 60 * 1000) {
      return releaseCache.value
    }
    try {
      const res = await net.fetch('https://api.github.com/repos/web-xc/cDesk/releases/latest', {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `cDesk/${app.getVersion()}`
        }
      })
      if (!res.ok) return releaseCache?.value ?? null
      const data = (await res.json()) as {
        tag_name?: string
        html_url?: string
        body?: string
      }
      const version = (data.tag_name ?? '').replace(/^v/i, '')
      if (!version) return null
      const value = {
        version,
        url: data.html_url ?? 'https://github.com/web-xc/cDesk/releases/latest',
        notes: data.body ?? ''
      }
      releaseCache = { at: Date.now(), value }
      return value
    } catch (err) {
      console.error('[update] check failed:', err)
      return releaseCache?.value ?? null
    }
  })

  ipcMain.handle('settings:get', (): Settings => getSettings())

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('window:set-fullscreen', (event, on: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(!!on)
  })

  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>): Settings => {
    const next = setSettings(patch ?? {})
    broadcast('settings:changed', next)
    return next
  })

  ipcMain.handle('system:displays', (): Promise<DisplayInfo[]> => listDisplays(false))

  ipcMain.handle('system:capabilities', (): Capabilities => capabilities())

  ipcMain.handle('system:request-accessibility', (): boolean => {
    if (process.platform !== 'darwin') return hasBackend()
    try {
      return systemPreferences.isTrustedAccessibilityClient(true)
    } catch {
      return false
    }
  })

  ipcMain.handle('system:open-permission', async (_e, kind: string) => {
    if (process.platform === 'darwin') {
      const map: Record<string, string> = {
        screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
        microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
      }
      await shell.openExternal(map[kind] ?? map.screen)
    } else if (process.platform === 'win32') {
      if (kind === 'microphone') await shell.openExternal('ms-settings:privacy-microphone')
      else await shell.openExternal('ms-settings:privacy-screenshots')
    }
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.handle(
    'dialog:save',
    async (_e, request: SaveFileRequest, data: ArrayBuffer | string) => {
      const win = webContents.getFocusedWebContents() ?? null
      const result = win
        ? await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), request.defaultName), filters: request.filters })
        : await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), request.defaultName), filters: request.filters })
      if (result.canceled || !result.filePath) return { canceled: true }
      let buffer: Buffer
      if (typeof data === 'string') {
        const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
        buffer = Buffer.from(base64, 'base64')
      } else {
        buffer = Buffer.from(data)
      }
      await fs.promises.writeFile(result.filePath, buffer)
      return { canceled: false, path: result.filePath }
    }
  )

  ipcMain.handle('dialog:open-folder', (_e, target: string) => {
    if (target) shell.showItemInFolder(target)
  })

  ipcMain.handle('dialog:choose-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((p) => ({
      name: path.basename(p),
      path: p,
      size: fs.statSync(p).size
    }))
  })

  ipcMain.handle('capture:choose-display', (_e, id: number) => {
    chosenDisplayId = Number(id)
  })

  ipcMain.handle('capture:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 360, height: 220 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  ipcMain.handle('input:mouse', (_e, msg: MouseEventMessage) => injectMouse(msg))
  ipcMain.handle('input:key', (_e, msg: KeyEventMessage) => injectKey(msg))
  ipcMain.handle('input:text', (_e, text: string) => injectText(String(text ?? '')))

  ipcMain.handle('power:prevent-sleep', (_e, on: boolean) => {
    if (on && sleepBlockerId === null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else if (!on && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId)
      sleepBlockerId = null
    }
  })

  ipcMain.handle('files:begin', async (_e, name: string, size: number) => {
    const dir = app.getPath('downloads')
    const target = uniquePath(dir, sanitizeFileName(name))
    const stream = fs.createWriteStream(target)
    const handle = randomUUID()
    writers.set(handle, { stream, path: target, size: Number(size) || 0, written: 0 })
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    return { handle, path: target }
  })

  ipcMain.handle('files:chunk', async (_e, handle: string, data: ArrayBuffer) => {
    const writer = writers.get(handle)
    if (!writer) throw new Error('传输句柄无效')
    const buffer = Buffer.from(data)
    writer.written += buffer.byteLength
    await new Promise<void>((resolve, reject) => {
      writer.stream.write(buffer, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle('files:end', async (_e, handle: string) => {
    const writer = writers.get(handle)
    if (!writer) return ''
    writers.delete(handle)
    await new Promise<void>((resolve) => writer.stream.end(() => resolve()))
    return writer.path
  })

  ipcMain.handle('files:abort', async (_e, handle: string) => {
    const writer = writers.get(handle)
    if (!writer) return
    writers.delete(handle)
    try {
      writer.stream.destroy()
      await fs.promises.unlink(writer.path).catch(() => {})
    } catch {
      /* ignore */
    }
  })

  ipcMain.handle('lan:start', async (_e, profile: LanProfile) => {
    return lan.start(profile)
  })

  ipcMain.handle('lan:update', (_e, profile: LanProfile) => {
    lan.update(profile)
  })

  ipcMain.handle('lan:stop', async () => {
    await lan.stop()
  })

  ipcMain.handle('lan:peers', () => lan.listPeers())

  ipcMain.handle('lan:connect', async (_e, address: string, port: number) => {
    return lan.connect(address, port)
  })

  ipcMain.handle('lan:send', (_e, connId: string, data: unknown) => {
    lan.send(connId, data)
  })

  ipcMain.handle('lan:close', (_e, connId: string) => {
    lan.close(connId)
  })

  ipcMain.handle('session:active', (_e, active: boolean) => {
    if (active && sleepBlockerId === null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else if (!active && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId)
      sleepBlockerId = null
    }
  })

  ipcMain.handle('signal:status', () => signal.getStatus())
  ipcMain.handle('signal:connect', () => signal.connect())
  ipcMain.handle('signal:subscribe', (_e, topic: string) => signal.subscribe(String(topic)))
  ipcMain.handle('signal:unsubscribe', (_e, topic: string) => signal.unsubscribe(String(topic)))
  ipcMain.handle('signal:publish', (_e, topic: string, payload: string) =>
    signal.publish(String(topic), String(payload))
  )

  lan.on('peers', (peers) => broadcast('lan:peers', peers))
  lan.on('conn', (conn) => broadcast('lan:conn', conn))
  lan.on('message', (msg) => broadcast('lan:message', msg))
  lan.on('closed', (msg) => broadcast('lan:closed', msg))

  signal.on('message', (msg) => broadcast('signal:message', msg))
  signal.on('status', (status) => broadcast('signal:status', status))
  signal.start()
}
