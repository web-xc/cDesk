import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Settings } from '@shared/types'

const defaults = (): Settings => ({
  deviceId: randomUUID(),
  deviceName: (os.hostname() || 'cDesk Device').slice(0, 40),
  theme: 'dark',
  pinMode: 'random',
  fixedPin: '',
  quality: 'balanced',
  clipboardSync: true,
  stunEnabled: true,
  launchAtLogin: false,
  showStats: true,
  viewOnly: false,
  reduceMotion: false
})

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  const base = defaults()
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cache = { ...base, ...parsed }
    if (!cache.deviceId) cache.deviceId = base.deviceId
  } catch {
    cache = base
  }
  return cache
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  if (patch.deviceName !== undefined) {
    next.deviceName = String(patch.deviceName).slice(0, 40) || os.hostname()
  }
  if (patch.fixedPin !== undefined) {
    next.fixedPin = String(patch.fixedPin).replace(/\D/g, '').slice(0, 8)
  }
  cache = next
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(filePath()), { recursive: true })
      fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }, 200)
  if (patch.launchAtLogin !== undefined) {
    try {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
    } catch {
      /* ignore */
    }
  }
  return next
}
