// 通过 CDP 截取应用真实界面，用于 README 展示
// 用法: node scripts/capture-ui.mjs
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const PORT = process.env.SHOT_PORT || '9444'
const OUT = path.resolve('docs/screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* retry */
    }
    await sleep(500)
  }
  throw new Error('未找到可用的 Electron 页面，请确认应用已带 --remote-debugging-port 启动')
}

function connect(url) {
  const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
  let seq = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, ready, send }
}

async function shot(send, file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = path.join(OUT, file)
  fs.writeFileSync(target, Buffer.from(data, 'base64'))
  console.log(`[shot] ${path.relative(process.cwd(), target)}`)
}

async function clickByText(send, selector, text) {
  const expr = `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((n) => n.textContent && n.textContent.trim().includes(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`
  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return !!result?.value
}

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const page = await findPage()
  const { ws, ready, send } = connect(page.webSocketDebuggerUrl)
  await ready
  await send('Page.enable')
  await send('Runtime.enable')

  // 固定视口，保证截图一致
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1320,
    height: 860,
    deviceScaleFactor: 2,
    mobile: false
  })
  await sleep(2200)

  await shot(send, 'home.png')

  const okSettings = await clickByText(send, '.nav-item', '设置')
  if (okSettings) {
    await sleep(900)
    await shot(send, 'settings.png')
  }

  await clickByText(send, '.nav-item', '主页')
  await sleep(600)

  // 局域网 / 远程码切换区域
  await shot(send, 'connect.png')

  ws.close()
}

main().catch((err) => {
  console.error('[shot] failed:', err.message)
  process.exit(1)
})
