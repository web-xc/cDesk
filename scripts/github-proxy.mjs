// 本地 CONNECT 代理 v3
// 用法: node scripts/github-proxy.mjs
import net from 'node:net'

const PORT = 7899
const TARGET_IPS = [
  '140.82.112.3',
  '140.82.121.3',
  '20.205.243.166',
  '20.27.177.113',
  '20.6.7.17'
]

async function pickTarget(hostname) {
  if (!(hostname === 'github.com' || hostname === 'api.github.com' ||
        hostname === 'codeload.github.com' || hostname.endsWith('.github.com') ||
        hostname.endsWith('.githubusercontent.com'))) {
    return hostname
  }
  for (const ip of TARGET_IPS) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(443, ip, () => { s.destroy(); resolve() })
        s.on('error', reject)
        s.setTimeout(2500, () => { s.destroy(); reject(new Error('timeout')) })
      })
      return ip
    } catch {
      continue
    }
  }
  return TARGET_IPS[0]
}

const server = net.createServer((client) => {
  let buffer = Buffer.alloc(0)
  let remote = null
  let closed = false

  client.on('data', (chunk) => {
    if (remote) { remote.write(chunk); return }
    buffer = Buffer.concat([buffer, chunk])
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return

    const firstLine = buffer.slice(0, headerEnd).toString().split('\r\n')[0]
    const m = firstLine.match(/^CONNECT\s+([^:]+):(\d+)/)
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }

    const host = m[1]
    const port = parseInt(m[2], 10)
    const rest = buffer.slice(headerEnd + 4)

    pickTarget(host).then((target) => {
      remote = net.connect(port, target, () => {
        client.write('HTTP/1.1 200 Connection established\r\n\r\n')
        if (rest.length > 0) remote.write(rest)
        client.pipe(remote)
        remote.pipe(client)
      })
      remote.on('error', () => { if (!closed) client.end(); closed = true })
      remote.on('close', () => { try { client.destroy() } catch {} })
    })
  })
  client.on('error', () => { try { remote?.destroy() } catch {} })
  client.on('close', () => { closed = true; try { remote?.destroy() } catch {} })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] listening on 127.0.0.1:${PORT}`)
})
