export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function randomPin(length = 6): string {
  const digits = '0123456789'
  let out = ''
  const rand = new Uint32Array(length)
  crypto.getRandomValues(rand)
  for (let i = 0; i < length; i++) out += digits[rand[i] % 10]
  return out
}

export function shortId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return clean.slice(0, 4) + '-' + clean.slice(4, 8)
}

export function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function platformLabel(platform: string): string {
  if (platform === 'darwin' || /darwin|mac/i.test(platform)) return 'macOS'
  if (platform === 'win32' || /windows/i.test(platform)) return 'Windows'
  if (/linux/i.test(platform)) return 'Linux'
  return platform || '未知系统'
}

export function isMacOs(os: string, platform?: string): boolean {
  return platform === 'darwin' || /darwin|mac/i.test(os)
}
