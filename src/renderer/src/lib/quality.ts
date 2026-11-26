import type { QualityPreset, Settings } from '@shared/types'

export const QUALITY_PRESETS: Record<
  QualityPreset,
  {
    label: string
    hint: string
    width: number
    fps: number
    bitrate: number
  }
> = {
  smooth: {
    label: '流畅',
    hint: '1280 × 720 · 60fps · 3 Mbps',
    width: 1280,
    fps: 60,
    bitrate: 3_000_000
  },
  balanced: {
    label: '均衡',
    hint: '1920 × 1080 · 60fps · 12 Mbps',
    width: 1920,
    fps: 60,
    bitrate: 12_000_000
  },
  sharp: {
    label: '高清',
    hint: '原始分辨率 · 60fps · 20 Mbps',
    width: 3840,
    fps: 60,
    bitrate: 20_000_000
  }
}

/** 国内可用的公共 STUN，Google 作为兜底；STUN 只用于发现公网地址 */
export const DEFAULT_STUN = [
  'stun:stun.miwifi.com:3478',
  'stun:stun.chat.bilibili.com:3478',
  'stun:stun.hitv.com:3478',
  'stun:stun.l.google.com:19302'
]

export function buildIceServers(
  settings: Pick<Settings, 'stunEnabled' | 'turnUrl' | 'turnUser' | 'turnPass'>,
  servers: string[] = DEFAULT_STUN
): RTCIceServer[] {
  const list: RTCIceServer[] = []
  if (settings.stunEnabled) {
    list.push({ urls: servers.length ? servers : DEFAULT_STUN })
  }
  const turnUrls = (settings.turnUrl ?? '')
    .split(/[\s,;]+/)
    .map((url) => url.trim())
    .filter(Boolean)
  if (turnUrls.length) {
    list.push({
      urls: turnUrls,
      username: settings.turnUser || undefined,
      credential: settings.turnPass || undefined
    })
  }
  return list
}
