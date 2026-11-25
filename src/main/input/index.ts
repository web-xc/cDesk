import { screen } from 'electron'
import type { KeyEventMessage, MouseEventMessage } from '@shared/types'
import { createWindowsBackend } from './win-backend'
import { createMacBackend } from './mac-backend'

interface Backend {
  name: string
  mouse(msg: {
    kind: 'move' | 'down' | 'up' | 'wheel'
    absX: number
    absY: number
    button: number
    delta: number
  }): boolean
  key(msg: { down: boolean; code: string; key: string }): boolean
  text(text: string): boolean
}

let backend: Backend | null = null
let tried = false

function getBackend(): Backend | null {
  if (tried) return backend
  tried = true
  try {
    if (process.platform === 'win32') backend = createWindowsBackend()
    else if (process.platform === 'darwin') backend = createMacBackend()
  } catch (err) {
    console.error('[input] backend init failed:', err)
    backend = null
  }
  return backend
}

export function backendName(): string | null {
  return getBackend()?.name ?? null
}

export function hasBackend(): boolean {
  return !!getBackend()
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function injectMouse(msg: MouseEventMessage): boolean {
  const impl = getBackend()
  if (!impl) return false
  const displays = screen.getAllDisplays()
  const display =
    displays.find((d) => d.id === msg.displayId) ?? screen.getPrimaryDisplay()
  const nx = clamp01(msg.x)
  const ny = clamp01(msg.y)

  if (process.platform === 'win32') {
    const left = Math.min(...displays.map((d) => d.bounds.x))
    const top = Math.min(...displays.map((d) => d.bounds.y))
    const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))
    const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
    const vw = Math.max(1, right - left)
    const vh = Math.max(1, bottom - top)
    const px = display.bounds.x + nx * display.bounds.width
    const py = display.bounds.y + ny * display.bounds.height
    return impl.mouse({
      kind: msg.a,
      absX: (px - left) / vw,
      absY: (py - top) / vh,
      button: msg.button ?? 0,
      delta: msg.delta ?? 0
    })
  }

  const px = display.bounds.x + nx * display.bounds.width
  const py = display.bounds.y + ny * display.bounds.height
  return impl.mouse({
    kind: msg.a,
    absX: px,
    absY: py,
    button: msg.button ?? 0,
    delta: msg.delta ?? 0
  })
}

export function injectKey(msg: KeyEventMessage): boolean {
  const impl = getBackend()
  if (!impl) return false
  if ((msg.key?.length ?? 0) > 0 && msg.key !== 'Dead') {
    // 可打印字符优先用 Unicode 注入，确保跨键盘布局与输入法一致
    if (msg.key.length === 1 && !msg.ctrl && !msg.meta && !msg.alt) {
      const printable = msg.key.charCodeAt(0) >= 0x20
      if (printable) return impl.text(msg.key)
    }
  }
  return impl.key({ down: msg.a === 'down', code: msg.code, key: msg.key })
}

export function injectText(text: string): boolean {
  const impl = getBackend()
  if (!impl) return false
  return impl.text(text)
}
