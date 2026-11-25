import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import mqtt, { type MqttClient } from 'mqtt'
import type { SignalMessage, SignalStatus } from '@shared/types'

/**
 * 公共 MQTT broker 仅承载加密后的 SDP 信令（密码派生的 AES-GCM 封装），
 * 屏幕、控制与文件数据始终走 WebRTC 点对点直连。
 */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt']

const TOPIC_PATTERN = /^cdesk\/v1\/\d{9}\/(inbox|out\/[A-Za-z0-9_-]+)$/

const CONNECT_TIMEOUT = 9000
const MAX_PAYLOAD = 96 * 1024

export class SignalService extends EventEmitter {
  private client: MqttClient | null = null
  private brokerIndex = 0
  private topics = new Set<string>()
  private status: SignalStatus = { connected: false, broker: '' }
  private connecting = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const client = this.client
    this.client = null
    this.connecting = false
    if (client) {
      try {
        client.end(true)
      } catch {
        /* ignore */
      }
    }
  }

  getStatus(): SignalStatus {
    return this.status
  }

  async connect(): Promise<SignalStatus> {
    if (this.status.connected) return this.status
    this.open()
    return await new Promise<SignalStatus>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        this.off('status', onStatus)
        resolve(this.status)
      }
      const onStatus = (next: SignalStatus): void => {
        if (next.connected) finish()
      }
      const timer = setTimeout(finish, 10000)
      this.on('status', onStatus)
      if (this.status.connected) finish()
    })
  }

  async subscribe(topic: string): Promise<void> {
    if (!TOPIC_PATTERN.test(topic)) throw new Error('非法的信令主题')
    this.topics.add(topic)
    const client = this.client
    if (!client || !this.status.connected) return
    await new Promise<void>((resolve) => client.subscribe(topic, { qos: 1 }, () => resolve()))
  }

  async unsubscribe(topic: string): Promise<void> {
    this.topics.delete(topic)
    const client = this.client
    if (!client || !this.status.connected) return
    await new Promise<void>((resolve) => client.unsubscribe(topic, () => resolve()))
  }

  async publish(topic: string, payload: string): Promise<void> {
    if (!TOPIC_PATTERN.test(topic)) throw new Error('非法的信令主题')
    if (payload.length > MAX_PAYLOAD) throw new Error('信令内容过大')
    const client = this.client
    if (!client || !this.status.connected) throw new Error('信令服务尚未连接，请稍后重试')
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve()))
    })
  }

  /* ------------------------------- 内部实现 ------------------------------- */

  private open(): void {
    if (this.stopped || this.connecting || this.client) return
    this.connecting = true
    const url = BROKERS[this.brokerIndex % BROKERS.length]
    const client = mqtt.connect(url, {
      clientId: `cdesk_${randomBytes(6).toString('hex')}`,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: CONNECT_TIMEOUT,
      keepalive: 30,
      protocolVersion: 4
    })
    this.client = client
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      this.connecting = false
      if (this.client === client) this.client = null
      this.setStatus({ connected: false, broker: url, error: '连接超时' })
      try {
        client.end(true)
      } catch {
        /* ignore */
      }
      this.scheduleNext(1500)
    }, CONNECT_TIMEOUT)

    client.on('connect', () => {
      if (this.client !== client) return
      settled = true
      clearTimeout(timeout)
      this.connecting = false
      this.setStatus({ connected: true, broker: url })
      for (const topic of this.topics) {
        client.subscribe(topic, { qos: 1 }, () => {})
      }
    })

    client.on('message', (topic, payload) => {
      const text = payload.toString()
      if (text.length > MAX_PAYLOAD) return
      this.emit('message', { topic, payload: text } satisfies SignalMessage)
    })

    client.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        this.connecting = false
        if (this.client === client) this.client = null
        this.setStatus({ connected: false, broker: url, error: err.message })
        try {
          client.end(true)
        } catch {
          /* ignore */
        }
        this.scheduleNext(1200)
      } else if (this.status.connected) {
        this.setStatus({ ...this.status, error: err.message })
      }
    })

    client.on('close', () => {
      if (this.client !== client) return
      settled = true
      clearTimeout(timeout)
      this.client = null
      this.connecting = false
      this.setStatus({ connected: false, broker: url })
      this.scheduleNext(2000)
    })
  }

  private scheduleNext(delay: number): void {
    if (this.stopped || this.reconnectTimer) return
    this.brokerIndex = (this.brokerIndex + 1) % BROKERS.length
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private setStatus(next: SignalStatus): void {
    const changed =
      next.connected !== this.status.connected ||
      next.broker !== this.status.broker ||
      next.error !== this.status.error
    this.status = next
    if (changed) this.emit('status', next)
  }
}
