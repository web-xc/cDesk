import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { IncomingConnection, LaneMessage, LanProfile, Peer, PeerFrom } from './lan-types'

export type { IncomingConnection, LanProfile, Peer, PeerFrom }

const APP_TAG = 'cdesk'
const DISCOVERY_PORTS = [38999, 39001, 39003]
const BROADCAST_INTERVAL = 2000
const PEER_TTL = 7000

interface PeerState extends Peer {
  lastSeen: number
}

interface ConnState {
  socket: net.Socket
  from: PeerFrom
}

/**
 * 无服务器的局域网发现 + 点对点信令通道。
 * UDP 广播用于发现同网段设备，TCP 直连用于交换 WebRTC SDP / ICE，
 * 媒体与数据全部通过 WebRTC 点对点传输，不经过任何中转服务器。
 */
export class LanService extends EventEmitter {
  private udp: dgram.Socket | null = null
  private server: net.Server | null = null
  private tcpPort = 0
  private discoveryPort = 0
  private profile: LanProfile | null = null
  private peers = new Map<string, PeerState>()
  private conns = new Map<string, ConnState>()
  private timers: NodeJS.Timeout[] = []
  private starting: Promise<void> | null = null
  private started = false

  async start(profile: LanProfile): Promise<{ port: number }> {
    this.profile = profile
    if (!this.started) {
      if (!this.starting) this.starting = this.bootstrap()
      await this.starting
    }
    this.broadcast()
    return { port: this.tcpPort }
  }

  update(profile: LanProfile): void {
    this.profile = profile
    this.broadcast()
  }

  async stop(): Promise<void> {
    this.timers.forEach((t) => clearInterval(t))
    this.timers = []
    for (const [, c] of this.conns) {
      try {
        c.socket.destroy()
      } catch {
        /* ignore */
      }
    }
    this.conns.clear()
    this.peers.clear()
    if (this.udp) {
      try {
        this.udp.close()
      } catch {
        /* ignore */
      }
      this.udp = null
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
    }
    this.started = false
    this.starting = null
    this.tcpPort = 0
    this.discoveryPort = 0
  }

  isHosting(): boolean {
    return !!this.profile?.hosting
  }

  listPeers(): Peer[] {
    const now = Date.now()
    return [...this.peers.values()]
      .filter((p) => now - p.lastSeen < PEER_TTL && p.id !== this.profile?.id)
      .sort((a, b) => Number(b.hosting) - Number(a.hosting) || a.name.localeCompare(b.name))
      .map((p) => ({ ...p }))
  }

  /** 主动连接到对方 TCP 信令端口（主控方发起） */
  async connect(address: string, port: number): Promise<IncomingConnection> {
    if (!this.server) throw new Error('LAN 服务未启动')
    const socket = net.createConnection({ host: address, port, timeout: 8000 })
    socket.setNoDelay(true)
    socket.setEncoding('utf8')
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('timeout', () => reject(new Error('连接超时，检查防火墙或设备是否在线')))
      socket.once('error', (err) => reject(err))
    })
    socket.setTimeout(0)
    const connId = randomUUID()
    const from: PeerFrom = { id: '', name: '', os: '', address }
    this.conns.set(connId, { socket, from })
    this.attach(socket, connId, true)
    this.emit('conn', { connId, from: { id: '', name: address, os: '', address } })
    return { connId, from }
  }

  send(connId: string, data: unknown): void {
    const conn = this.conns.get(connId)
    if (!conn || conn.socket.destroyed) return
    try {
      conn.socket.write(JSON.stringify({ t: 'msg', data }) + '\n')
    } catch {
      /* ignore */
    }
  }

  close(connId: string, notify = true): void {
    const conn = this.conns.get(connId)
    if (!conn) return
    this.conns.delete(connId)
    try {
      if (notify && !conn.socket.destroyed) {
        conn.socket.end(JSON.stringify({ t: 'bye' }) + '\n')
        setTimeout(() => conn.socket.destroy(), 400)
      } else {
        conn.socket.destroy()
      }
    } catch {
      /* ignore */
    }
  }

  private async bootstrap(): Promise<void> {
    await this.startUdp()
    await this.startTcp()
    this.started = true
    this.timers.push(setInterval(() => this.broadcast(), BROADCAST_INTERVAL))
    this.timers.push(
      setInterval(() => {
        const before = this.peers.size
        const now = Date.now()
        for (const [id, p] of this.peers) {
          if (now - p.lastSeen > PEER_TTL) this.peers.delete(id)
        }
        if (before !== this.peers.size) this.emitPeers()
      }, 2500)
    )
  }

  private async startUdp(): Promise<void> {
    let lastError: unknown = null
    for (const port of DISCOVERY_PORTS) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => {
            socket.removeListener('listening', onListening)
            reject(err)
          }
          const onListening = () => {
            socket.removeListener('error', onError)
            resolve()
          }
          socket.once('error', onError)
          socket.once('listening', onListening)
          socket.bind(port)
        })
        socket.setBroadcast(true)
        socket.on('message', (buf, rinfo) => this.onUdpMessage(buf, rinfo))
        socket.on('error', () => {
          /* 单次发送失败不影响运行 */
        })
        this.udp = socket
        this.discoveryPort = port
        return
      } catch (err) {
        lastError = err
        try {
          socket.close()
        } catch {
          /* ignore */
        }
      }
    }
    throw lastError ?? new Error('无法启动局域网发现')
  }

  private async startTcp(): Promise<void> {
    const server = net.createServer((socket) => {
      socket.setNoDelay(true)
      socket.setEncoding('utf8')
      const connId = randomUUID()
      this.attach(socket, connId, false)
    })
    server.on('error', () => {
      /* ignore */
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '0.0.0.0', () => resolve())
    })
    const address = server.address()
    this.tcpPort = typeof address === 'object' && address ? address.port : 0
    this.server = server
  }

  private attach(socket: net.Socket, connId: string, outbound: boolean): void {
    let buf = ''
    // 主动连接方已发送 hello，被动方需要先等待对方的 hello
    let greeted = outbound
    let closed = false

    const finish = () => {
      if (closed) return
      closed = true
      const existed = this.conns.delete(connId)
      if (existed) this.emit('closed', { connId })
    }

    if (outbound && this.profile) {
      socket.write(
        JSON.stringify({
          t: 'hello',
          app: APP_TAG,
          id: this.profile.id,
          name: this.profile.name,
          os: `${os.type()} ${os.release()}`,
          version: this.profile.version
        }) + '\n'
      )
    }

    socket.on('data', (chunk: string) => {
      buf += chunk
      let idx = buf.indexOf('\n')
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        idx = buf.indexOf('\n')
        if (!line) continue
        let msg: LaneMessage
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (!greeted) {
          if (msg.t !== 'hello' || msg.app !== APP_TAG) {
            socket.destroy()
            return
          }
          greeted = true
          if (!this.profile?.hosting) {
            try {
              socket.end(JSON.stringify({ t: 'busy' }) + '\n')
            } catch {
              /* ignore */
            }
            socket.destroy()
            return
          }
          const from: PeerFrom = {
            id: String(msg.id ?? ''),
            name: String(msg.name ?? '未命名设备'),
            os: String(msg.os ?? ''),
            address: socket.remoteAddress?.replace('::ffff:', '')
          }
          this.conns.set(connId, { socket, from })
          this.emit('conn', { connId, from })
          continue
        }
        if (msg.t === 'msg') {
          this.emit('message', { connId, data: msg.data })
        } else if (msg.t === 'bye') {
          socket.end()
        }
      }
    })
    socket.on('close', finish)
    socket.on('error', finish)
  }

  private onUdpMessage(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    let msg: LaneMessage
    try {
      msg = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    if (msg.app !== APP_TAG || !msg.id) return
    if (msg.id === this.profile?.id) return
    const id = String(msg.id)
    const prev = this.peers.get(id)
    const peer: PeerState = {
      id,
      name: String(msg.name ?? '未命名设备'),
      os: String(msg.os ?? ''),
      platform: String(msg.platform ?? ''),
      address: rinfo.address,
      port: Number(msg.port) || 0,
      hosting: !!msg.hosting,
      version: String(msg.version ?? ''),
      lastSeen: Date.now()
    }
    const changed =
      !prev ||
      prev.hosting !== peer.hosting ||
      prev.name !== peer.name ||
      prev.address !== peer.address ||
      prev.port !== peer.port
    this.peers.set(id, peer)
    if (changed) this.emitPeers()
  }

  private emitPeers(): void {
    this.emit('peers', this.listPeers())
  }

  private broadcast(): void {
    if (!this.udp || !this.profile) return
    const payload = Buffer.from(
      JSON.stringify({
        app: APP_TAG,
        v: 1,
        id: this.profile.id,
        name: this.profile.name,
        os: `${os.type()} ${os.release()}`,
        platform: process.platform,
        hosting: this.profile.hosting,
        port: this.tcpPort,
        version: this.profile.version
      }),
      'utf8'
    )
    const targets = ['255.255.255.255', '127.0.0.1']
    for (const addr of targets) {
      try {
        this.udp.send(payload, 0, payload.length, this.discoveryPort, addr, () => {})
      } catch {
        /* ignore */
      }
    }
  }
}
