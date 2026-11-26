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

/** 随机控制密码：去掉易混淆字符（0/o/1/l/i），默认 6 位 */
export function randomPassword(length = 6): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz'
  let out = ''
  const rand = new Uint32Array(length)
  crypto.getRandomValues(rand)
  for (let i = 0; i < length; i++) out += chars[rand[i] % chars.length]
  return out
}

/** 远程码按 3-3-3 分组显示 */
export function groupCode(code: string): string {
  const clean = code.replace(/\D/g, '').slice(0, 9)
  return clean.replace(/(\d{3})(?=\d)/g, '$1 ')
}

/** 一键复制到剪贴板的完整远程操控信息 */
export function formatControlInfo(code: string, password: string): string {
  return `远程码：${groupCode(code)}\n密码：${password}`
}

/**
 * 解析“远程码 + 密码”：
 * 支持 "123456789 abc123"、"123 456 789 abc123"、
 * "远程码：123 456 789 密码：abc123"、多行粘贴等。
 */
export function parseControlInfo(input: string): { code: string; password: string } | null {
  const text = (input ?? '').trim()
  if (!text) return null
  const cleaned = text.replace(/(远程码|连接码|设备码|远程码|控制密码|密码|口令)/g, ' ')
  const codeMatch = cleaned.match(/(\d{3})[\s-]?(\d{3})[\s-]?(\d{3})(?!\d)/)
  if (!codeMatch) return null
  const code = codeMatch[1] + codeMatch[2] + codeMatch[3]
  const passLabeled = cleaned.match(/(?:password|pass)\s*[:：]?\s*([A-Za-z0-9]{4,16})/i)?.[1] ?? ''
  let password = passLabeled
  if (!password) {
    const rest = cleaned.replace(codeMatch[0], ' ')
    const tokens = rest.match(/[A-Za-z0-9]{4,16}/g) ?? []
    password = tokens.find((token) => token !== code && !/^\d{9}$/.test(token)) ?? ''
  }
  if (!password) return null
  return { code, password }
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
