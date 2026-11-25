import type { QualityPreset } from '@shared/types'

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
    hint: '1280 × 720 · 30fps · 2.5 Mbps',
    width: 1280,
    fps: 30,
    bitrate: 2_500_000
  },
  balanced: {
    label: '均衡',
    hint: '1920 × 1080 · 30fps · 8 Mbps',
    width: 1920,
    fps: 30,
    bitrate: 8_000_000
  },
  sharp: {
    label: '高清',
    hint: '原始分辨率 · 60fps · 16 Mbps',
    width: 3840,
    fps: 60,
    bitrate: 16_000_000
  }
}

export const DEFAULT_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302'
]

export function buildIceServers(enabled: boolean, servers: string[] = DEFAULT_STUN): RTCIceServer[] {
  if (!enabled) return []
  return [{ urls: servers.length ? servers : DEFAULT_STUN }]
}
