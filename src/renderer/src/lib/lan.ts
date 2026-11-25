type MessageHandler = (data: unknown) => void

interface Waiter {
  connId: string
  handler: MessageHandler
}

const buffered = new Map<string, unknown[]>()
const waiters = new Set<Waiter>()
let initialized = false

function deliver(connId: string, data: unknown): void {
  for (const waiter of waiters) {
    if (waiter.connId === connId) {
      waiter.handler(data)
      return
    }
  }
  const list = buffered.get(connId) ?? []
  if (list.length > 200) list.shift()
  list.push(data)
  buffered.set(connId, list)
}

export function initLanBus(): void {
  if (initialized) return
  initialized = true
  window.cdesk.lan.onMessage(({ connId, data }) => deliver(connId, data))
}

/** 会话页面挂载时订阅自己的信令，先回放此前缓存的 offer/candidate */
export function subscribeSignals(connId: string, handler: MessageHandler): () => void {
  const waiter: Waiter = { connId, handler }
  waiters.add(waiter)
  const pending = buffered.get(connId)
  if (pending?.length) {
    buffered.delete(connId)
    for (const item of pending) handler(item)
  }
  return () => {
    waiters.delete(waiter)
  }
}

export function clearSignals(connId: string): void {
  buffered.delete(connId)
}

export function sendSignal(connId: string, data: unknown): void {
  void window.cdesk.lan.send(connId, data)
}

export function closeConnection(connId: string): void {
  clearSignals(connId)
  void window.cdesk.lan.close(connId)
}
