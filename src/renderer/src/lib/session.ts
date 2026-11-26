import type { QualityPreset } from '@shared/types'
import { QUALITY_PRESETS } from './quality'
import { open, seal } from './secure'
import { clamp, uid } from './utils'

export type SessionRole = 'host' | 'viewer'
export type SessionTransport = 'lan' | 'code'
export type SessionPhase =
  | 'idle'
  | 'preparing'
  | 'waiting'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error'
  | 'closed'

export interface MonitorInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface RemoteInfo {
  name: string
  os: string
  platform: string
  monitors: MonitorInfo[]
  activeDisplayId: number
  canControl: boolean
  controlAllowed: boolean
  version: string
}

export interface SessionStats {
  fps: number
  kbps: number
  rtt: number
  width: number
  height: number
  codec: string
  loss: number
}

export interface FileState {
  id: string
  name: string
  size: number
  transferred: number
  direction: 'in' | 'out'
  status: 'pending' | 'active' | 'done' | 'error' | 'declined'
  path?: string
  error?: string
}

export interface ChatMessage {
  id: string
  from: 'me' | 'peer'
  text: string
  ts: number
}

export interface SessionHooks {
  onPhase?: (phase: SessionPhase, detail?: string) => void
  onStream?: (stream: MediaStream | null) => void
  onPreview?: (stream: MediaStream | null) => void
  onInfo?: (info: RemoteInfo) => void
  onStats?: (stats: SessionStats) => void
  onChat?: (msg: ChatMessage) => void
  onFile?: (file: FileState) => void
  onClipboard?: (text: string) => void
  onControl?: (state: {
    authorized: boolean
    allowControl: boolean
    controlling: boolean
  }) => void
  onError?: (message: string) => void
  onQuality?: (preset: QualityPreset) => void
  onNotice?: (message: string) => void
}

export interface SessionOptions {
  role: SessionRole
  transport: SessionTransport
  pin: string
  displayId: number
  quality: QualityPreset
  iceServers: RTCIceServer[]
  deviceId: string
  deviceName: string
  deviceOs: string
  wantAudio: boolean
  viewOnly: boolean
  signal?: (data: unknown) => void
  hooks?: SessionHooks
}

interface SignalPayload {
  kind: 'offer' | 'answer' | 'candidate' | 'bye'
  sdp?: string
  candidate?: RTCIceCandidateInit | null
}

/** 经 AES-GCM 封装的跨网信令负载 */
interface CodeSignal {
  v: number
  type: 'offer' | 'answer'
  sdp: string
  sessionId: string
  from?: { id?: string; name?: string; os?: string }
}

interface OutgoingFile {
  id: string
  file: File
  offset: number
  lastEmit: number
}

interface IncomingFile {
  id: string
  name: string
  handle: string
  size: number
  received: number
  path: string
  lastEmit: number
}

const CHUNK_SIZE = 64 * 1024
const HIGH_WATER = 4 * 1024 * 1024
const LOW_WATER = 512 * 1024

export class RemoteSession {
  readonly role: SessionRole
  readonly transport: SessionTransport
  private hooks: SessionHooks
  private pin: string
  private quality: QualityPreset
  private iceServers: RTCIceServer[]
  private signal: (data: unknown) => void
  private displayId: number
  private deviceId: string
  private deviceName: string
  private deviceOs: string
  private wantAudio: boolean
  private viewOnly: boolean
  private code = ''
  private sessionId = ''
  private offCodeSignal: (() => void) | null = null
  private codeTimer: ReturnType<typeof setTimeout> | null = null

  private pc: RTCPeerConnection | null = null
  private ctl: RTCDataChannel | null = null
  private fileDc: RTCDataChannel | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private videoSender: RTCRtpSender | null = null
  private monitorList: MonitorInfo[] = []
  private remoteInfo: RemoteInfo | null = null
  private remoteDisplayId = 0
  private canControl = true

  private phase: SessionPhase = 'idle'
  private authorized = false
  private allowControl = true
  private controlling = false
  private clipboardEnabled = true
  private destroyed = false
  private capturePromise: Promise<MediaStream> | null = null
  private authTimer: ReturnType<typeof setTimeout> | null = null
  private authAttempts = 0
  private connTimer: ReturnType<typeof setTimeout> | null = null

  private statsTimer: ReturnType<typeof setInterval> | null = null
  private clipboardTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private prevBytes = 0
  private prevTs = 0
  private statsBitrate = 0
  private stats: SessionStats = {
    fps: 0,
    kbps: 0,
    rtt: 0,
    width: 0,
    height: 0,
    codec: '',
    loss: 0
  }

  private lastClipboard = ''
  private lastRemoteClipboard = ''
  private outgoing: OutgoingFile | null = null
  private incoming: IncomingFile | null = null
  private pendingIncoming: { id: string; name: string; size: number } | null = null
  private writeChain: Promise<void> = Promise.resolve()
  constructor(options: SessionOptions) {
    this.role = options.role
    this.transport = options.transport
    this.pin = options.pin
    this.quality = options.quality
    this.iceServers = options.iceServers
    this.displayId = options.displayId
    this.deviceId = options.deviceId
    this.deviceName = options.deviceName
    this.deviceOs = options.deviceOs
    this.wantAudio = options.wantAudio
    this.viewOnly = options.viewOnly
    this.signal = options.signal ?? (() => {})
    this.hooks = options.hooks ?? {}
    void window.cdesk.session.setActive(true)
  }

  get phaseValue(): SessionPhase {
    return this.phase
  }

  get isAuthorized(): boolean {
    return this.authorized
  }

  get currentQuality(): QualityPreset {
    return this.quality
  }

  get activeDisplayId(): number {
    return this.displayId
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  /* ------------------------------- 主机侧 ------------------------------- */

  async prepareHost(displayId?: number): Promise<void> {
    if (this.role !== 'host') return
    if (displayId !== undefined) this.displayId = displayId
    this.setPhase('preparing')
    await this.ensureCapture()
    await this.loadMonitors()
    this.setPhase('waiting')
  }

  private async bindHostTracks(): Promise<void> {
    const pc = this.ensurePc()
    const stream = this.localStream
    if (!stream) return
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind
      if (kind === 'video') {
        const track = stream.getVideoTracks()[0]
        if (track) {
          await transceiver.sender.replaceTrack(track)
          transceiver.direction = 'sendonly'
          this.videoSender = transceiver.sender
        }
      } else if (kind === 'audio') {
        const track = stream.getAudioTracks()[0]
        if (track) {
          await transceiver.sender.replaceTrack(track)
          transceiver.direction = 'sendonly'
        } else {
          transceiver.direction = 'inactive'
        }
      }
    }
  }

  private async createAnswerSdp(waitMs: number): Promise<string> {
    const pc = this.ensurePc()
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (waitMs > 0) await this.waitIce(pc, waitMs)
    return pc.localDescription?.sdp ?? ''
  }

  async acceptOffer(sdp: string): Promise<void> {
    const pc = this.ensurePc()
    await this.ensureCapture()
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await this.bindHostTracks()
    const answerSdp = await this.createAnswerSdp(0)
    this.signal({ kind: 'answer', sdp: answerSdp } satisfies SignalPayload)
    this.setPhase('connecting')
  }

  /** 被控端：接受远程码 offer，并把加密应答发布到对方的会话主题 */
  async acceptCodeOffer(
    sdp: string,
    sessionId: string,
    code: string,
    password: string
  ): Promise<void> {
    this.pin = password
    this.code = code
    this.sessionId = sessionId
    const pc = this.ensurePc()
    await this.ensureCapture()
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await this.bindHostTracks()
    const answerSdp = await this.createAnswerSdp(3500)
    const sealed = await seal(
      { v: 1, type: 'answer', sdp: answerSdp, sessionId } satisfies CodeSignal,
      this.pin,
      this.code
    )
    this.setPhase('connecting', '密码验证通过，正在建立点对点连接…')
    await window.cdesk.signal.publish(this.outTopic(), sealed)
  }

  async switchDisplay(displayId: number): Promise<void> {
    if (this.role !== 'host') return
    const previous = this.localStream
    const stream = await this.capture(displayId)
    const track = stream.getVideoTracks()[0]
    if (this.videoSender) await this.videoSender.replaceTrack(track)
    previous?.getTracks().forEach((t) => t.stop())
    this.localStream = stream
    this.hooks.onPreview?.(stream)
    this.displayId = displayId
    await this.loadMonitors()
    this.sendInfo()
  }

  setAllowControl(allow: boolean): void {
    this.allowControl = allow
    if (this.role === 'host') {
      this.ctl?.send(JSON.stringify({ t: 'control', allow }))
      this.hooks.onControl?.({
        authorized: this.authorized,
        allowControl: allow,
        controlling: false
      })
      this.sendInfo()
    }
  }

  forceAuthorize(): void {
    if (this.role !== 'host') return
    this.authorize()
  }

  /* ------------------------------- 主控侧 ------------------------------- */

  async connectLan(): Promise<void> {
    const pc = this.ensurePc()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    this.createChannels()
    await this.applyCodecPreference(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.setPhase('connecting')
    this.signal({ kind: 'offer', sdp: pc.localDescription?.sdp ?? '' } satisfies SignalPayload)
  }

  /** 主控端：向固定远程码发布加密 offer，并等待加密 answer */
  async connectCode(code: string, password: string): Promise<void> {
    this.code = code
    this.pin = password
    this.sessionId = uid()
    const topic = this.outTopic()
    this.offCodeSignal = window.cdesk.signal.onMessage((msg) => {
      if (msg.topic !== topic || this.destroyed) return
      void (async () => {
        const payload = await open<CodeSignal>(msg.payload, this.pin, this.code)
        if (!payload || payload.type !== 'answer' || payload.sessionId !== this.sessionId) return
        if (this.codeTimer) {
          clearTimeout(this.codeTimer)
          this.codeTimer = null
        }
        try {
          if (this.pc?.signalingState === 'have-local-offer') {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
            this.setPhase('connecting', '已收到对方应答，正在建立点对点连接…')
          }
        } catch (err) {
          this.fail(err instanceof Error ? err.message : '应答处理失败')
        }
      })()
    })
    try {
      await window.cdesk.signal.subscribe(topic)
    } catch {
      /* 发布阶段会给出更明确的错误 */
    }
    const pc = this.ensurePc()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    this.createChannels()
    await this.applyCodecPreference(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.setPhase('connecting', '正在收集网络地址…')
    await this.waitIce(pc, 4500)
    const sealed = await seal(
      {
        v: 1,
        type: 'offer',
        sdp: pc.localDescription?.sdp ?? '',
        sessionId: this.sessionId,
        from: { id: this.deviceId, name: this.deviceName, os: this.deviceOs }
      } satisfies CodeSignal,
      this.pin,
      this.code
    )
    this.setPhase('connecting', '正在通过加密信令联系对方…')
    this.startCodeTimer()
    await window.cdesk.signal.publish(`cdesk/v1/${code}/inbox`, sealed)
  }

  private outTopic(): string {
    return `cdesk/v1/${this.code}/out/${this.sessionId}`
  }

  private startCodeTimer(): void {
    if (this.codeTimer) clearTimeout(this.codeTimer)
    this.codeTimer = setTimeout(() => {
      this.codeTimer = null
      if (this.destroyed || this.phase === 'connected' || this.phase === 'closed') return
      this.fail('远程码不存在或密码错误，请确认对方已开启「允许远程控制」')
    }, 16000)
  }

  async handleSignal(data: SignalPayload): Promise<void> {
    if (this.destroyed) return
    try {
      if (data.kind === 'offer') {
        if (this.role === 'host') await this.acceptOffer(data.sdp ?? '')
      } else if (data.kind === 'answer') {
        if (this.role === 'viewer') {
          await this.pc?.setRemoteDescription({ type: 'answer', sdp: data.sdp ?? '' })
          this.setPhase('authenticating')
        }
      } else if (data.kind === 'candidate' && data.candidate) {
        await this.pc?.addIceCandidate(data.candidate)
      } else if (data.kind === 'bye') {
        this.setPhase('closed', '对方已断开连接')
      }
    } catch (err) {
      console.error('[session] signal error', err)
    }
  }

  authenticate(pin?: string): void {
    if (pin !== undefined) this.pin = pin
    this.sendAuth()
  }

  setControlling(controlling: boolean): void {
    if (this.role !== 'viewer') return
    this.controlling = controlling && this.authorized && this.canControl
    this.hooks.onControl?.({
      authorized: this.authorized,
      allowControl: this.remoteInfo?.controlAllowed ?? true,
      controlling: this.controlling
    })
    if (!this.controlling) this.ctl?.send(JSON.stringify({ t: 'release' }))
  }

  setClipboardEnabled(on: boolean): void {
    this.clipboardEnabled = on
    this.lastClipboard = ''
    this.lastRemoteClipboard = ''
  }

  requestDisplay(displayId: number): void {
    if (this.role !== 'viewer') return
    this.ctl?.send(JSON.stringify({ t: 'switch', id: displayId }))
  }

  requestQuality(preset: QualityPreset): void {
    this.quality = preset
    if (this.role === 'viewer') {
      this.ctl?.send(JSON.stringify({ t: 'quality', q: preset }))
      this.hooks.onQuality?.(preset)
      return
    }
    void this.applyQuality(preset)
  }

  /* --------------------------------- 通用 --------------------------------- */

  sendPointer(
    kind: 'move' | 'down' | 'up' | 'wheel',
    nx: number,
    ny: number,
    button = 0,
    delta = 0
  ): void {
    if (!this.canSendInput()) return
    this.ctl?.send(
      JSON.stringify({
        t: 'm',
        a: kind,
        x: clamp(nx, 0, 1),
        y: clamp(ny, 0, 1),
        b: button,
        d: delta,
        displayId: this.remoteDisplayId
      })
    )
  }

  sendKey(
    action: 'down' | 'up',
    code: string,
    key: string,
    mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
  ): void {
    if (!this.canSendInput()) return
    this.ctl?.send(JSON.stringify({ t: 'k', a: action, code, key, ...mods }))
  }

  sendTextInput(text: string): void {
    if (!this.canSendInput() || !text) return
    this.ctl?.send(JSON.stringify({ t: 'text', s: text }))
  }

  sendChat(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.ctl?.send(JSON.stringify({ t: 'chat', s: trimmed }))
    this.hooks.onChat?.({ id: uid(), from: 'me', text: trimmed, ts: Date.now() })
  }

  async offerFile(file: File): Promise<void> {
    if (!this.ctl || this.ctl.readyState !== 'open') throw new Error('连接尚未就绪')
    if (this.outgoing) throw new Error('已有文件正在发送')
    const id = uid()
    this.outgoing = { id, file, offset: 0, lastEmit: 0 }
    this.ctl.send(JSON.stringify({ t: 'file-offer', id, name: file.name, size: file.size }))
    this.hooks.onFile?.({
      id,
      name: file.name,
      size: file.size,
      transferred: 0,
      direction: 'out',
      status: 'pending'
    })
  }

  async acceptFile(id: string): Promise<void> {
    const pending = this.pendingIncoming
    if (!pending || pending.id !== id) return
    try {
      const { handle, path } = await window.cdesk.files.beginReceive(pending.name, pending.size)
      this.incoming = {
        id,
        name: pending.name,
        handle,
        size: pending.size,
        received: 0,
        path,
        lastEmit: 0
      }
      this.pendingIncoming = null
      this.ctl?.send(JSON.stringify({ t: 'file-accept', id }))
      this.hooks.onFile?.({
        id,
        name: pending.name,
        size: pending.size,
        transferred: 0,
        direction: 'in',
        status: 'active'
      })
    } catch (err) {
      this.hooks.onError?.(err instanceof Error ? err.message : '无法创建本地文件')
    }
  }

  declineFile(id: string): void {
    this.pendingIncoming = null
    this.ctl?.send(JSON.stringify({ t: 'file-decline', id }))
    this.hooks.onFile?.({
      id,
      name: '',
      size: 0,
      transferred: 0,
      direction: 'in',
      status: 'declined'
    })
  }

  disconnect(reason = '会话已结束'): void {
    if (this.destroyed) return
    this.destroyed = true
    this.clearTimers()
    this.offCodeSignal?.()
    this.offCodeSignal = null
    if (this.code && this.sessionId) {
      void window.cdesk.signal.unsubscribe(this.outTopic()).catch(() => {})
    }
    try {
      this.ctl?.send(JSON.stringify({ t: 'bye' }))
    } catch {
      /* ignore */
    }
    this.localStream?.getTracks().forEach((t) => t.stop())
    if (this.incoming) {
      void window.cdesk.files.abortReceive(this.incoming.handle)
      this.incoming = null
    }
    try {
      this.pc?.close()
    } catch {
      /* ignore */
    }
    this.pc = null
    this.ctl = null
    this.fileDc = null
    this.hooks.onStream?.(null)
    this.hooks.onPreview?.(null)
    void window.cdesk.session.setActive(false)
    this.setPhase('closed', reason)
  }

  /* ------------------------------- 内部实现 ------------------------------- */

  private ensurePc(): RTCPeerConnection {
    if (this.pc) return this.pc
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal({ kind: 'candidate', candidate: event.candidate.toJSON() })
      }
    }
    pc.ontrack = (event) => {
      if (!this.remoteStream) this.remoteStream = new MediaStream()
      const exists = this.remoteStream.getTracks().some((t) => t.id === event.track.id)
      if (!exists) this.remoteStream.addTrack(event.track)
      event.track.contentHint = 'detail'
      if (this.role === 'viewer') {
        this.hooks.onStream?.(this.remoteStream)
        if (!this.authorized) this.setPhase('authenticating')
      }
    }
    pc.ondatachannel = (event) => {
      if (event.channel.label === 'ctl') this.bindCtl(event.channel)
      else if (event.channel.label === 'file') this.bindFile(event.channel)
    }
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'connected') {
        if (this.connTimer) {
          clearTimeout(this.connTimer)
          this.connTimer = null
        }
        if (this.role === 'viewer' && !this.authorized) {
          this.setPhase('authenticating')
          this.sendAuth()
        } else if (this.role === 'host' && this.authorized) {
          this.setPhase('connected')
        }
      } else if (state === 'failed') {
        this.fail('点对点连接失败，可能被防火墙或网络策略拦截')
      } else if (state === 'disconnected' && !this.destroyed) {
        this.hooks.onNotice?.('网络波动，正在尝试恢复…')
      }
    }
    this.pc = pc
    return pc
  }

  private bindCtl(channel: RTCDataChannel): void {
    this.ctl = channel
    channel.onopen = () => {
      if (this.role === 'viewer') {
        this.sendAuth()
        this.startPing()
      }
    }
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data))
        this.handleControlMessage(data)
      } catch {
        /* ignore malformed */
      }
    }
    channel.onclose = () => {
      if (!this.destroyed && this.authorized) {
        this.hooks.onNotice?.('控制通道已断开')
      }
    }
  }

  private bindFile(channel: RTCDataChannel): void {
    this.fileDc = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = LOW_WATER
    channel.onmessage = (event) => {
      const data = event.data
      if (data instanceof ArrayBuffer) this.handleFileChunk(data)
    }
  }

  private createChannels(): void {
    const pc = this.ensurePc()
    if (!this.ctl) {
      const ctl = pc.createDataChannel('ctl', { ordered: true })
      this.bindCtl(ctl)
    }
    if (!this.fileDc) {
      const file = pc.createDataChannel('file', { ordered: true })
      this.bindFile(file)
    }
  }

  private async ensureCapture(): Promise<MediaStream> {
    if (this.localStream) return this.localStream
    if (this.capturePromise) return this.capturePromise
    this.capturePromise = this.capture(this.displayId).finally(() => {
      this.capturePromise = null
    })
    const stream = await this.capturePromise
    this.localStream = stream
    this.hooks.onPreview?.(stream)
    return stream
  }

  private async capture(displayId: number): Promise<MediaStream> {
    await window.cdesk.capture.chooseDisplay(displayId)
    const preset = QUALITY_PRESETS[this.quality]
    const constraints: MediaStreamConstraints = {
      audio: this.wantAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        : false,
      video: {
        frameRate: { ideal: preset.fps, max: 60 },
        width: { ideal: preset.width },
        height: { ideal: preset.width === 3840 ? 2160 : preset.width === 1920 ? 1080 : 720 }
      }
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
      const video = stream.getVideoTracks()[0]
      if (video) {
        video.contentHint = 'detail'
        try {
          await video.applyConstraints({
            frameRate: { ideal: preset.fps, max: 60 },
            width: { ideal: preset.width },
            height: constraints.video ? (constraints.video as MediaTrackConstraints).height : undefined
          })
        } catch { /* 平台不支持更高约束时忽略 */ }

        // Simulcast SVC 3 层编码（高/中/低），接收端弱网时可丢弃高层保帧率
        if (this.videoSender) {
          const params = this.videoSender.getParameters()
          const total = preset.bitrate
          params.encodings = [
            {
              rid: 'h',
              scaleResolutionDownBy: 1,
              maxBitrate: Math.round(total * 0.85),
              maxFramerate: preset.fps,
              priority: 'high'
            },
            {
              rid: 'm',
              scaleResolutionDownBy: 2,
              maxBitrate: Math.round(total * 0.35),
              maxFramerate: preset.fps,
              priority: 'medium'
            },
            {
              rid: 'l',
              scaleResolutionDownBy: 4,
              maxBitrate: Math.round(total * 0.12),
              maxFramerate: 30,
              priority: 'low'
            }
          ]
          params.degradationPreference = 'maintain-framerate'
          try {
            await this.videoSender.setParameters(params)
          } catch {
            // 浏览器不支持 Simulcast 时降级为单层
            const fallback = this.videoSender.getParameters()
            fallback.encodings = [{
              ...(fallback.encodings?.[0] ?? {}),
              maxBitrate: total * 1.3,
              maxFramerate: preset.fps
            }]
            fallback.degradationPreference = 'maintain-framerate'
            await this.videoSender.setParameters(fallback).catch(() => {})
          }
        }
      }
      return stream
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '无法捕获屏幕，请在系统设置中授予 cDesk 屏幕录制权限'
          : err instanceof Error
            ? err.message
            : '屏幕捕获失败'
      throw new Error(message)
    }
  }

  private async loadMonitors(): Promise<void> {
    try {
      const displays = await window.cdesk.system.displays()
      this.monitorList = displays.map((d, index) => ({
        id: d.id,
        label: d.label || `显示器 ${index + 1}`,
        width: Math.round(d.width * d.scaleFactor),
        height: Math.round(d.height * d.scaleFactor),
        primary: d.primary
      }))
    } catch {
      this.monitorList = []
    }
  }

  private async applyQuality(preset: QualityPreset): Promise<void> {
    this.quality = preset
    const config = QUALITY_PRESETS[preset]
    const track = this.localStream?.getVideoTracks()[0]
    if (track) {
      try {
        await track.applyConstraints({
          frameRate: { ideal: config.fps, max: config.fps },
          width: { ideal: config.width }
        })
      } catch {
        /* ignore */
      }
    }
    if (this.videoSender) {
      try {
        const params = this.videoSender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        params.encodings[0].maxBitrate = config.bitrate
        params.encodings[0].maxFramerate = config.fps
        await this.videoSender.setParameters(params)
      } catch {
        /* ignore */
      }
    }
    this.hooks.onQuality?.(preset)
    this.sendInfo()
  }

  private async applyCodecPreference(pc: RTCPeerConnection): Promise<void> {
    try {
      const caps = RTCRtpReceiver.getCapabilities('video')
      if (!caps) return
      // 远控优先 VP8（低延迟、软编高效）> H264 > VP9，AV1 因编码时延高排最后
      const rank = (mime: string): number => {
        if (/vp8/i.test(mime)) return 0
        if (/h264/i.test(mime)) return 1
        if (/vp9/i.test(mime)) return 2
        if (/av1/i.test(mime)) return 3
        return 4
      }
      const codecs = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType))
      for (const transceiver of pc.getTransceivers()) {
        try {
          transceiver.setCodecPreferences(codecs)
        } catch {
          /* ignore */
        }
      }
      // VP8 开启 SVC（Scalable Video Coding）分层编码，接收端可按需丢弃高层
      if ('setParameters' in pc.getTransceivers()[0]?.sender) {
        for (const t of pc.getTransceivers()) {
          if (t.sender && t.direction === 'sendonly') {
            try {
              const params = t.sender.getParameters()
              params.degradationPreference = 'maintain-framerate'
              await t.sender.setParameters(params)
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private waitIce(pc: RTCPeerConnection, timeout: number): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        pc.removeEventListener('icegatheringstatechange', onChange)
        clearTimeout(timer)
        resolve()
      }
      const onChange = (): void => {
        if (pc.iceGatheringState === 'complete') finish()
      }
      const timer = setTimeout(finish, timeout)
      pc.addEventListener('icegatheringstatechange', onChange)
    })
  }

  private sendAuth(): void {
    if (this.role !== 'viewer') return
    if (!this.ctl || this.ctl.readyState !== 'open') return
    this.ctl.send(JSON.stringify({ t: 'auth', pin: this.pin }))
    this.authAttempts++
    if (!this.authorized) this.setPhase('authenticating')
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = setTimeout(() => {
      if (!this.authorized && !this.destroyed) {
        this.fail('等待对方响应超时，请确认控制密码是否正确')
      }
    }, 15000)
  }

  private authorize(): void {
    this.authorized = true
    if (this.authTimer) {
      clearTimeout(this.authTimer)
      this.authTimer = null
    }
    this.startStats()
    this.startClipboard()
    this.sendInfo()
    this.hooks.onControl?.({
      authorized: true,
      allowControl: this.allowControl,
      controlling: this.role === 'viewer'
    })
    this.setPhase('connected')
  }

  private sendInfo(): void {
    if (this.role !== 'host' || !this.ctl || this.ctl.readyState !== 'open') return
    const info: RemoteInfo = {
      name: this.deviceName,
      os: this.deviceOs,
      platform: navigator.platform ?? '',
      monitors: this.monitorList,
      activeDisplayId: this.displayId,
      canControl: !this.viewOnly,
      controlAllowed: this.allowControl,
      version: '1.1.0'
    }
    try {
      this.ctl.send(JSON.stringify({ t: 'info', info }))
    } catch {
      /* ignore */
    }
  }

  private handleControlMessage(data: Record<string, unknown>): void {
    const type = data.t as string
    if (this.role === 'host') {
      switch (type) {
        case 'auth': {
          const pin = String(data.pin ?? '')
          if (pin === this.pin) {
            this.ctl?.send(JSON.stringify({ t: 'auth-result', ok: true }))
            this.authorize()
          } else {
            this.ctl?.send(JSON.stringify({ t: 'auth-result', ok: false, reason: '控制密码不正确' }))
            this.authAttempts++
            if (this.authAttempts > 6) {
              this.fail('控制密码错误次数过多，已断开连接')
              this.disconnect('验证失败')
            }
          }
          break
        }
        case 'm': {
          if (!this.canInject()) return
          void window.cdesk.input.mouse({
            a: data.a as 'move' | 'down' | 'up' | 'wheel',
            x: Number(data.x ?? 0),
            y: Number(data.y ?? 0),
            button: Number(data.b ?? 0),
            delta: Number(data.d ?? 0),
            displayId: Number(data.displayId ?? this.displayId)
          })
          break
        }
        case 'k': {
          if (!this.canInject()) return
          void window.cdesk.input.key({
            a: data.a as 'down' | 'up',
            code: String(data.code ?? ''),
            key: String(data.key ?? ''),
            ctrl: !!data.ctrl,
            alt: !!data.alt,
            shift: !!data.shift,
            meta: !!data.meta
          })
          break
        }
        case 'text': {
          if (!this.canInject()) return
          void window.cdesk.input.text(String(data.s ?? ''))
          break
        }
        case 'chat': {
          const text = String(data.s ?? '')
          if (text) this.hooks.onChat?.({ id: uid(), from: 'peer', text, ts: Date.now() })
          break
        }
        case 'clip': {
          const text = String(data.s ?? '')
          this.lastRemoteClipboard = text
          this.lastClipboard = text
          void window.cdesk.clipboard.write(text)
          this.hooks.onClipboard?.(text)
          break
        }
        case 'switch': {
          const id = Number(data.id)
          if (Number.isFinite(id) && id !== this.displayId) void this.switchDisplay(id)
          break
        }
        case 'quality': {
          const preset = data.q as QualityPreset
          if (preset && QUALITY_PRESETS[preset]) void this.applyQuality(preset)
          break
        }
        case 'release': {
          this.hooks.onControl?.({
            authorized: this.authorized,
            allowControl: this.allowControl,
            controlling: false
          })
          break
        }
        case 'ping': {
          this.ctl?.send(JSON.stringify({ t: 'pong', ts: data.ts }))
          break
        }
        case 'file-accept':
          void this.startOutgoing()
          break
        case 'file-decline':
          this.outgoing = null
          this.hooks.onFile?.({
            id: String(data.id ?? ''),
            name: '',
            size: 0,
            transferred: 0,
            direction: 'out',
            status: 'declined'
          })
          break
        case 'file-done': {
          const id = String(data.id ?? '')
          this.hooks.onFile?.({
            id,
            name: this.outgoing?.file.name ?? '',
            size: this.outgoing?.file.size ?? 0,
            transferred: this.outgoing?.file.size ?? 0,
            direction: 'out',
            status: 'done'
          })
          this.outgoing = null
          break
        }
        case 'bye':
          this.disconnect('对方已断开连接')
          break
        default:
          break
      }
      return
    }

    switch (type) {
      case 'auth-result': {
        if (data.ok) {
          this.authorize()
        } else {
          this.setPhase('authenticating', String(data.reason ?? '验证失败'))
          this.hooks.onError?.(String(data.reason ?? '控制密码不正确'))
        }
        break
      }
      case 'info': {
        const info = data.info as RemoteInfo
        if (!info) return
        this.remoteInfo = info
        this.remoteDisplayId = info.activeDisplayId
        this.canControl = info.canControl && info.controlAllowed
        this.hooks.onInfo?.(info)
        if (!this.controlling && this.canControl) this.setControlling(true)
        break
      }
      case 'control': {
        const allow = !!data.allow
        if (this.remoteInfo) this.remoteInfo.controlAllowed = allow
        this.canControl = (this.remoteInfo?.canControl ?? true) && allow
        if (!allow) this.setControlling(false)
        else this.setControlling(true)
        if (this.remoteInfo) this.hooks.onInfo?.(this.remoteInfo)
        break
      }
      case 'chat': {
        const text = String(data.s ?? '')
        if (text) this.hooks.onChat?.({ id: uid(), from: 'peer', text, ts: Date.now() })
        break
      }
      case 'clip': {
        const text = String(data.s ?? '')
        this.lastRemoteClipboard = text
        this.lastClipboard = text
        void window.cdesk.clipboard.write(text)
        this.hooks.onClipboard?.(text)
        break
      }
      case 'pong': {
        const sent = Number(data.ts ?? 0)
        if (sent) {
          this.stats = { ...this.stats, rtt: Math.max(1, Math.round(performance.now() - sent)) }
        }
        break
      }
      case 'file-offer': {
        const id = String(data.id ?? '')
        const name = String(data.name ?? '文件')
        const size = Number(data.size ?? 0)
        this.pendingIncoming = { id, name, size }
        this.hooks.onFile?.({
          id,
          name,
          size,
          transferred: 0,
          direction: 'in',
          status: 'pending'
        })
        break
      }
      case 'file-decline':
        this.outgoing = null
        this.hooks.onFile?.({
          id: String(data.id ?? ''),
          name: '',
          size: 0,
          transferred: 0,
          direction: 'out',
          status: 'declined'
        })
        break
      case 'file-accept':
        void this.startOutgoing()
        break
      case 'file-done': {
        this.hooks.onFile?.({
          id: String(data.id ?? ''),
          name: this.outgoing?.file.name ?? '',
          size: this.outgoing?.file.size ?? 0,
          transferred: this.outgoing?.file.size ?? 0,
          direction: 'out',
          status: 'done'
        })
        this.outgoing = null
        break
      }
      case 'bye':
        this.disconnect('对方已断开连接')
        break
      case 'error':
        this.hooks.onError?.(String(data.message ?? '发生未知错误'))
        break
      default:
        break
    }
  }

  private startOutgoing(): void {
    const job = this.outgoing
    const dc = this.fileDc
    if (!job || !dc || dc.readyState !== 'open') return
    dc.bufferedAmountLowThreshold = LOW_WATER
    const loop = async (): Promise<void> => {
      try {
        while (job.offset < job.file.size) {
          if (this.destroyed) return
          if (dc.readyState !== 'open') throw new Error('数据传输通道已关闭')
          if (dc.bufferedAmount > HIGH_WATER) {
            await new Promise<void>((resolve) => {
              const onLow = (): void => {
                dc.removeEventListener('bufferedamountlow', onLow)
                resolve()
              }
              dc.addEventListener('bufferedamountlow', onLow)
              setTimeout(() => {
                dc.removeEventListener('bufferedamountlow', onLow)
                resolve()
              }, 1000)
            })
            continue
          }
          const slice = job.file.slice(job.offset, job.offset + CHUNK_SIZE)
          const buffer = await slice.arrayBuffer()
          dc.send(buffer)
          job.offset += buffer.byteLength
          const now = performance.now()
          if (now - job.lastEmit > 120 || job.offset >= job.file.size) {
            job.lastEmit = now
            this.hooks.onFile?.({
              id: job.id,
              name: job.file.name,
              size: job.file.size,
              transferred: job.offset,
              direction: 'out',
              status: 'active'
            })
          }
        }
        this.hooks.onFile?.({
          id: job.id,
          name: job.file.name,
          size: job.file.size,
          transferred: job.file.size,
          direction: 'out',
          status: 'active'
        })
      } catch (err) {
        this.hooks.onError?.(err instanceof Error ? err.message : '文件发送失败')
        this.hooks.onFile?.({
          id: job.id,
          name: job.file.name,
          size: job.file.size,
          transferred: job.offset,
          direction: 'out',
          status: 'error'
        })
        this.outgoing = null
      }
    }
    void loop()
  }

  private handleFileChunk(buffer: ArrayBuffer): void {
    const incoming = this.incoming
    if (!incoming) return
    this.writeChain = this.writeChain.then(async () => {
      if (!this.incoming || this.incoming.id !== incoming.id) return
      try {
        await window.cdesk.files.writeChunk(incoming.handle, buffer)
        incoming.received += buffer.byteLength
        const now = performance.now()
        if (now - incoming.lastEmit > 120 || incoming.received >= incoming.size) {
          incoming.lastEmit = now
          this.hooks.onFile?.({
            id: incoming.id,
            name: incoming.name,
            size: incoming.size,
            transferred: incoming.received,
            direction: 'in',
            status: 'active'
          })
        }
        if (incoming.received >= incoming.size) {
          const path = await window.cdesk.files.endReceive(incoming.handle)
          this.ctl?.send(JSON.stringify({ t: 'file-done', id: incoming.id }))
          this.hooks.onFile?.({
            id: incoming.id,
            name: incoming.name,
            size: incoming.size,
            transferred: incoming.size,
            direction: 'in',
            status: 'done',
            path
          })
          this.incoming = null
        }
      } catch (err) {
        this.hooks.onError?.(err instanceof Error ? err.message : '文件写入失败')
        this.incoming = null
      }
    })
  }

  private canSendInput(): boolean {
    return (
      this.role === 'viewer' &&
      this.authorized &&
      this.controlling &&
      this.canControl &&
      this.ctl?.readyState === 'open'
    )
  }

  private canInject(): boolean {
    return this.authorized && this.allowControl && !this.viewOnly
  }

  private startStats(): void {
    if (this.statsTimer) return
    this.prevBytes = 0
    this.prevTs = 0
    this.statsTimer = setInterval(() => void this.tickStats(), 1000)
  }

  private async tickStats(): Promise<void> {
    const pc = this.pc
    if (!pc || this.destroyed) return
    try {
      const report = await pc.getStats()
      let bytes = 0
      let fps = 0
      let width = 0
      let height = 0
      let codec = ''
      let loss = 0
      let rtt = this.stats.rtt

      report.forEach((entry: unknown) => {
        const stat = entry as Record<string, unknown> & { type?: string }
        const type = stat.type
        const kind = stat.kind
        if (type === 'inbound-rtp' && kind === 'video') {
          bytes = Number(stat.bytesReceived ?? 0)
          fps = Number(stat.framesPerSecond ?? 0)
          width = Number(stat.frameWidth ?? 0)
          height = Number(stat.frameHeight ?? 0)
          const received = Number(stat.packetsReceived ?? 0)
          const lost = Number(stat.packetsLost ?? 0)
          if (received + lost > 0) loss = Math.round((lost / (received + lost)) * 1000) / 10
          const codecStat = stat.codecId
            ? (report.get(stat.codecId as string) as unknown as Record<string, unknown>)
            : null
          if (codecStat && typeof codecStat.mimeType === 'string') {
            codec = codecStat.mimeType.replace('video/', '')
          }
        } else if (type === 'outbound-rtp' && kind === 'video') {
          const sent = Number(stat.bytesSent ?? 0)
          if (sent > 0) bytes = sent
          const outFps = Number(stat.framesPerSecond ?? 0)
          if (outFps > 0) fps = outFps
          if (Number(stat.frameWidth ?? 0) > 0) {
            width = Number(stat.frameWidth)
            height = Number(stat.frameHeight)
          }
          const codecStat = stat.codecId
            ? (report.get(stat.codecId as string) as unknown as Record<string, unknown>)
            : null
          if (!codec && codecStat && typeof codecStat.mimeType === 'string') {
            codec = codecStat.mimeType.replace('video/', '')
          }
        } else if (type === 'candidate-pair') {
          const state = stat.state
          const nominated = stat.nominated
          const selected = stat.selected
          if ((state === 'succeeded' && (nominated || selected)) || state === 'succeeded') {
            const value = Number(stat.currentRoundTripTime ?? 0)
            if (value > 0) rtt = Math.round(value * 1000)
          }
        }
      })

      const now = performance.now()
      if (this.prevTs && bytes >= this.prevBytes) {
        const elapsed = (now - this.prevTs) / 1000
        if (elapsed > 0) this.statsBitrate = ((bytes - this.prevBytes) * 8) / elapsed / 1000
      }
      this.prevBytes = bytes
      this.prevTs = now
      this.stats = {
        fps: Math.round(fps),
        kbps: Math.round(this.statsBitrate),
        rtt,
        width,
        height,
        codec: codec || this.stats.codec,
        loss
      }
      this.hooks.onStats?.(this.stats)
    } catch {
      /* ignore */
    }
  }

  private startClipboard(): void {
    if (this.clipboardTimer) return
    this.clipboardTimer = setInterval(async () => {
      if (!this.clipboardEnabled || this.destroyed) return
      if (!this.ctl || this.ctl.readyState !== 'open') return
      try {
        const text = await window.cdesk.clipboard.read()
        if (
          text &&
          text.length < 400000 &&
          text !== this.lastClipboard &&
          text !== this.lastRemoteClipboard
        ) {
          this.lastClipboard = text
          this.ctl.send(JSON.stringify({ t: 'clip', s: text }))
        }
      } catch {
        /* ignore */
      }
    }, 900)
  }

  private startPing(): void {
    if (this.pingTimer) return
    this.pingTimer = setInterval(() => {
      if (this.ctl?.readyState === 'open') {
        this.ctl.send(JSON.stringify({ t: 'ping', ts: performance.now() }))
      }
    }, 4000)
  }

  private clearTimers(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.clipboardTimer) clearInterval(this.clipboardTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.authTimer) clearTimeout(this.authTimer)
    if (this.connTimer) clearTimeout(this.connTimer)
    if (this.codeTimer) clearTimeout(this.codeTimer)
    this.statsTimer = null
    this.clipboardTimer = null
    this.pingTimer = null
    this.authTimer = null
    this.connTimer = null
    this.codeTimer = null
  }

  private setPhase(phase: SessionPhase, detail?: string): void {
    if (this.phase === phase && !detail) return
    this.phase = phase
    this.hooks.onPhase?.(phase, detail)
  }

  private fail(message: string): void {
    if (this.destroyed) return
    this.setPhase('error', message)
    this.hooks.onError?.(message)
  }
}
