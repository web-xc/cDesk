/**
 * 控制码信令的端到端加密：
 * PBKDF2-SHA256(密码, 盐 = "cdesk:v1:<控制码>") -> AES-GCM-256。
 * 密码不会上传，broker 只能看到密文；解密成功即等价于密码校验通过。
 */

const ITERATIONS = 60000
const CACHE_LIMIT = 8
const keyCache = new Map<string, Promise<CryptoKey>>()

function saltOf(code: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`cdesk:v1:${code}`)
}

function deriveKey(password: string, code: string): Promise<CryptoKey> {
  const cacheKey = `${code}\u0000${password}`
  const cached = keyCache.get(cacheKey)
  if (cached) return cached
  const promise = (async () => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltOf(code), iterations: ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  })()
  if (keyCache.size >= CACHE_LIMIT) {
    const first = keyCache.keys().next().value
    if (first !== undefined) keyCache.delete(first)
  }
  keyCache.set(cacheKey, promise)
  return promise
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function seal(payload: unknown, password: string, code: string): Promise<string> {
  const key = await deriveKey(password, code)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return toBase64(out)
}

/** 解密失败（密码或控制码不匹配、内容损坏）返回 null，不抛异常 */
export async function open<T>(text: string, password: string, code: string): Promise<T | null> {
  try {
    const bytes = fromBase64(text)
    if (bytes.length <= 12 || bytes.length > 128 * 1024) return null
    const key = await deriveKey(password, code)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
      key,
      bytes.subarray(12)
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}
