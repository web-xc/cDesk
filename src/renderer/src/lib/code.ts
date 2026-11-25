/** 邀请码 / 应答码的编码：JSON -> deflate-raw -> base64url */

const PREFIX = 'CD1-'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function encodeSignal(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  if (typeof CompressionStream === 'undefined') {
    return PREFIX + toBase64Url(bytes)
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return PREFIX + toBase64Url(new Uint8Array(buffer))
}

export async function decodeSignal<T>(code: string): Promise<T> {
  const clean = code
    .trim()
    .replace(/\s+/g, '')
    .replace(/^CD1-/, '')
  if (!clean) throw new Error('邀请码为空')
  const bytes = fromBase64Url(clean)
  let json: string
  if (typeof DecompressionStream === 'undefined') {
    json = new TextDecoder().decode(bytes)
  } else {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    json = await new Response(stream).text()
  }
  const parsed = JSON.parse(json) as T
  if (!parsed) throw new Error('邀请码无效')
  return parsed
}

export function copyText(text: string): Promise<void> {
  return window.cdesk.clipboard.write(text)
}
