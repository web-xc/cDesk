import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Settings } from '@shared/types'

/** 由 deviceId 派生 9 位固定远程码：同一设备永久不变 */
export function deriveDeviceCode(deviceId: string): string {
  const hash = createHash('sha256').update(`cdesk:code:${deviceId}`).digest()
  let value = 0n
  for (let i = 0; i < 8; i++) value = (value << 8n) + BigInt(hash[i])
  return (value % 1_000_000_000n).toString().padStart(9, '0')
}

const defaults = (): Settings => {
  const deviceId = randomUUID()
  return {
    deviceId,
    deviceCode: deriveDeviceCode(deviceId),
    deviceName: (os.hostname() || 'cDesk Device').slice(0, 40),
    theme: 'dark',
    pinMode: 'random',
    fixedPin: '',
    quality: 'balanced',
    clipboardSync: true,
    stunEnabled: true,
    turnUrl: '',
    turnUser: '',
    turnPass: '',
    launchAtLogin: false,
    showStats: true,
    viewOnly: false,
    reduceMotion: false,
    autoAccept: false
  }
}

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
    cache.deviceCode = deriveDeviceCode(cache.deviceId)
  } catch {
    cache = base
  }
  return cache
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const next = { ...current, ...patch }
  if (patch.deviceName !== undefined) {
    next.deviceName = String(patch.deviceName).slice(0, 40) || os.hostname()
  }
  // 远程码由 deviceId 派生，禁止修改
  next.deviceId = current.deviceId
  next.deviceCode = deriveDeviceCode(current.deviceId)
  if (patch.fixedPin !== undefined) {
    next.fixedPin = String(patch.fixedPin).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  }
  if (patch.turnUrl !== undefined) next.turnUrl = String(patch.turnUrl).trim().slice(0, 300)
  if (patch.turnUser !== undefined) next.turnUser = String(patch.turnUser).trim().slice(0, 120)
  if (patch.turnPass !== undefined) next.turnPass = String(patch.turnPass).slice(0, 120)
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
