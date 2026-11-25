import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Check,
  Circle,
  Clipboard,
  ClipboardCheck,
  Download,
  FolderUp,
  Gauge,
  Keyboard,
  Loader2,
  Maximize,
  MessageSquare,
  Minimize,
  Monitor,
  MousePointer2,
  PhoneOff,
  ShieldCheck,
  Signal,
  Square,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { QualityPreset } from '@shared/types'
import { useApp } from '../store'
import type { SessionLaunch } from '../store'
import { RemoteSession } from '../lib/session'
import type { ChatMessage, FileState, RemoteInfo, SessionPhase, SessionStats } from '../lib/session'
import { QUALITY_PRESETS, buildIceServers } from '../lib/quality'
import { closeConnection, sendSignal, subscribeSignals } from '../lib/lan'
import { cn, formatBytes, formatDuration, groupCode, platformLabel } from '../lib/utils'
import { Button, IconButton, Input, Modal, Popover, Spinner, Textarea } from '../components/ui'

function WaitingCard({
  children,
  tone = 'default'
}: {
  children: React.ReactNode
  tone?: 'default' | 'error'
}) {
  return <div className={cn('session-overlay', tone === 'error' && 'is-error')}>
    <div className="session-dialog">{children}</div>
  </div>
}

export default function SessionPage({ launch }: { launch: SessionLaunch }) {
  const setLaunch = useApp((s) => s.setLaunch)
  const toast = useApp((s) => s.toast)
  const appSettings = useApp((s) => s.settings)
  const appInfo = useApp((s) => s.info)
  const capabilities = useApp((s) => s.capabilities)
  const displays = useApp((s) => s.displays)

  const [phase, setPhase] = useState<SessionPhase>(launch.role === 'host' ? 'preparing' : 'connecting')
  const [detail, setDetail] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [allowControl, setAllowControl] = useState(true)
  const [controlling, setControlling] = useState(true)
  const [keyboardOn, setKeyboardOn] = useState(true)
  const [clipboardOn, setClipboardOn] = useState(appSettings?.clipboardSync ?? true)
  const [audioMuted, setAudioMuted] = useState(false)
  const [quality, setQuality] = useState<QualityPreset>(appSettings?.quality ?? 'balanced')
  const [panel, setPanel] = useState<'chat' | 'files' | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [unread, setUnread] = useState(0)
  const [files, setFiles] = useState<FileState[]>([])
  const [authPin, setAuthPin] = useState(launch.pin)
  const [authError, setAuthError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [textOpen, setTextOpen] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [chromeVisible, setChromeVisible] = useState(true)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)

  const sessionRef = useRef<RemoteSession | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pointerMove = useRef<{ x: number; y: number } | null>(null)
  const moveFrame = useRef(0)
  const hideTimer = useRef<number | null>(null)
  const lastButton = useRef(0)

  const isHost = launch.role === 'host'
  const connected = phase === 'connected'

  const monitors = useMemo(() => {
    if (isHost) {
      return displays.map((d) => ({
        id: d.id,
        label: d.label || `显示器 ${d.id}`,
        width: Math.round(d.width * d.scaleFactor),
        height: Math.round(d.height * d.scaleFactor),
        primary: d.primary
      }))
    }
    return remote?.monitors ?? []
  }, [displays, isHost, remote])

  const activeDisplayId = isHost ? sessionRef.current?.activeDisplayId ?? launch.displayId : remote?.activeDisplayId

  useEffect(() => {
    const settings = useApp.getState().settings
    if (!settings) return
    const primaryDisplay = displays.find((d) => d.primary)?.id ?? displays[0]?.id ?? 0
    const session = new RemoteSession({
      role: launch.role,
      transport: launch.transport,
      pin: launch.pin,
      displayId: launch.displayId ?? primaryDisplay,
      quality: settings.quality,
      iceServers: buildIceServers(settings),
      deviceId: settings.deviceId,
      deviceName: settings.deviceName,
      deviceOs: `${appInfo?.osName ?? 'PC'} ${appInfo?.osVersion ?? ''}`.trim(),
      wantAudio: launch.role === 'host' && !!capabilities?.loopbackAudio,
      viewOnly: settings.viewOnly,
      signal: launch.connId ? (data) => sendSignal(launch.connId!, data) : undefined,
      hooks: {
        onPhase: (next, message) => {
          setPhase(next)
          if (message) setDetail(message)
          if (next === 'authenticating') setAuthError('')
        },
        onStream: setStream,
        onPreview: setPreview,
        onInfo: (info) => setRemote(info),
        onStats: setStats,
        onChat: (msg) => {
          setChat((prev) => [...prev, msg])
          setPanel((current) => {
            if (current !== 'chat' && msg.from === 'peer') setUnread((n) => n + 1)
            return current
          })
        },
        onFile: (file) => {
          setFiles((prev) => {
            const index = prev.findIndex((f) => f.id === file.id)
            if (index < 0) return [file, ...prev]
            const next = [...prev]
            next[index] = {
              ...next[index],
              ...file,
              name: file.name || next[index].name,
              size: file.size || next[index].size
            }
            return next
          })
        },
        onControl: (state) => {
          setAuthorized(state.authorized)
          setAllowControl(state.allowControl)
          setControlling(state.controlling)
        },
        onError: (message) => {
          setDetail(message)
          toast('error', '会话提示', message)
        },
        onQuality: setQuality,
        onNotice: (message) => toast('info', message)
      }
    })
    sessionRef.current = session
    void window.cdesk.power.preventSleep(true)

    const offClosed = launch.connId
      ? window.cdesk.lan.onClosed(({ connId }) => {
          if (connId === launch.connId) session.disconnect('对方已断开连接')
        })
      : () => {}
    const offSignal = launch.connId
      ? subscribeSignals(launch.connId, (data) => {
          void session.handleSignal(data as never)
        })
      : () => {}

    let active = true
    const boot = async () => {
      try {
        if (launch.role === 'host') {
          await session.prepareHost(launch.displayId)
          if (launch.transport === 'code' && launch.offerSdp && launch.sessionId && launch.code) {
            await session.acceptCodeOffer(launch.offerSdp, launch.sessionId, launch.code, launch.pin)
          }
        } else if (launch.transport === 'code' && launch.code) {
          await session.connectCode(launch.code, launch.pin)
        } else {
          await session.connectLan()
        }
      } catch (err) {
        if (!active) return
        setPhase('error')
        setDetail(err instanceof Error ? err.message : '建立连接失败')
      }
    }
    void boot()

    const offFull = window.cdesk.window.onFullScreen(setFullscreen)

    return () => {
      active = false
      offSignal()
      offClosed()
      offFull()
      session.disconnect('页面已关闭')
      void window.cdesk.power.preventSleep(false)
      sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const source = isHost ? preview : stream
    if (video.srcObject !== source) {
      video.srcObject = source
      if (source) void video.play().catch(() => {})
    }
  }, [stream, preview, isHost, phase])

  useEffect(() => {
    const audio = stream?.getAudioTracks() ?? []
    audio.forEach((track) => {
      track.enabled = !audioMuted
    })
  }, [audioMuted, stream])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  // 远程键盘
  useEffect(() => {
    if (isHost || !connected || !controlling || !keyboardOn) return
    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        !!target.closest('[data-local-input]')
      )
    }
    const onDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      if (event.key === 'Meta' || event.key === 'Alt' || event.key === 'Control' || event.key === 'Shift') {
        // 修饰键照常下发
      }
      event.preventDefault()
      sessionRef.current?.sendKey('down', event.code, event.key, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey
      })
    }
    const onUp = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      event.preventDefault()
      sessionRef.current?.sendKey('up', event.code, event.key, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey
      })
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [isHost, connected, controlling, keyboardOn])

  // 全屏下自动隐藏工具栏
  useEffect(() => {
    if (!fullscreen) {
      setChromeVisible(true)
      return
    }
    const onMove = () => {
      setChromeVisible(true)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setChromeVisible(false), 2600)
    }
    window.addEventListener('mousemove', onMove)
    onMove()
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [fullscreen])

  const exit = () => {
    sessionRef.current?.disconnect('会话已结束')
    if (launch.connId) closeConnection(launch.connId)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    setLaunch(null)
  }

  const normalize = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const stage = stageRef.current
    const video = videoRef.current
    if (!stage || !video) return null
    const rect = stage.getBoundingClientRect()
    const vw = video.videoWidth || 1920
    const vh = video.videoHeight || 1080
    const scale = Math.min(rect.width / vw, rect.height / vh)
    const width = vw * scale
    const height = vh * scale
    const left = rect.left + (rect.width - width) / 2
    const top = rect.top + (rect.height - height) / 2
    return {
      x: Math.min(1, Math.max(0, (clientX - left) / width)),
      y: Math.min(1, Math.max(0, (clientY - top) / height))
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (isHost || !controlling) return
    const point = normalize(event.clientX, event.clientY)
    if (!point) return
    pointerMove.current = point
    if (moveFrame.current) return
    moveFrame.current = window.requestAnimationFrame(() => {
      moveFrame.current = 0
      const next = pointerMove.current
      if (next) sessionRef.current?.sendPointer('move', next.x, next.y)
    })
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (isHost || !controlling) return
    const point = normalize(event.clientX, event.clientY)
    if (!point) return
    lastButton.current = event.button
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    sessionRef.current?.sendPointer('down', point.x, point.y, event.button)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (isHost || !controlling) return
    const point = normalize(event.clientX, event.clientY)
    if (!point) return
    sessionRef.current?.sendPointer('up', point.x, point.y, lastButton.current || event.button)
  }

  const onWheel = (event: React.WheelEvent) => {
    if (isHost || !controlling) return
    event.preventDefault()
    const point = normalize(event.clientX, event.clientY)
    if (!point) return
    sessionRef.current?.sendPointer('wheel', point.x, point.y, 0, -event.deltaY * 1.2)
  }

  const takeScreenshot = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      toast('error', '当前没有可截取的画面')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const result = await window.cdesk.dialog.save(
        { defaultName: `cDesk-${Date.now()}.png`, filters: [{ name: 'PNG 图片', extensions: ['png'] }] },
        await blob.arrayBuffer()
      )
      if (!result.canceled) toast('success', '截图已保存', result.path)
    }, 'image/png')
  }

  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    if (!stream) {
      toast('error', '当前没有可录制的画面')
      return
    }
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm'
      })
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        const result = await window.cdesk.dialog.save(
          { defaultName: `cDesk-${Date.now()}.webm`, filters: [{ name: 'WebM 视频', extensions: ['webm'] }] },
          await blob.arrayBuffer()
        )
        setRecording(false)
        setRecordSeconds(0)
        if (!result.canceled) toast('success', '会话录制已保存', result.path)
      }
      recorder.start(1000)
      recorderRef.current = recorder
      setRecording(true)
      setRecordSeconds(0)
    } catch {
      toast('error', '无法启动录制')
    }
  }

  const sendChat = () => {
    const text = chatDraft.trim()
    if (!text) return
    sessionRef.current?.sendChat(text)
    setChatDraft('')
  }

  const pickFiles = async (list: FileList | null) => {
    if (!list?.length) return
    const file = list[0]
    try {
      await sessionRef.current?.offerFile(file)
    } catch (err) {
      toast('error', '无法发送文件', err instanceof Error ? err.message : undefined)
    }
  }

  const retryAuth = () => {
    if (authPin.trim().length < 4) return
    setAuthError('')
    sessionRef.current?.authenticate(authPin.trim())
  }

  const toggleFullscreen = async () => {
    await window.cdesk.window.setFullScreen(!fullscreen)
  }

  const changeQuality = (preset: QualityPreset) => {
    setQualityOpen(false)
    setQuality(preset)
    sessionRef.current?.requestQuality(preset)
  }

  const chooseMonitor = (id: number) => {
    setMonitorOpen(false)
    if (isHost) void sessionRef.current?.switchDisplay(id)
    else sessionRef.current?.requestDisplay(id)
  }

  const exitOverlay = (phase === 'error' || phase === 'closed') && (
    <WaitingCard tone="error">
      <div className="overlay-icon">{phase === 'error' ? <Signal size={22} /> : <Check size={22} />}</div>
      <h3>{phase === 'error' ? '连接未建立' : '会话已结束'}</h3>
      <p>{detail || (phase === 'error' ? '请检查网络或对方设备状态' : '感谢使用 cDesk')}</p>
      <div className="overlay-actions">
        <Button variant="primary" onClick={exit} icon={<ArrowLeft size={15} />}>
          返回主页
        </Button>
      </div>
    </WaitingCard>
  )

  return (
    <div className={cn('session', fullscreen && 'is-fullscreen')}>
      <div className={cn('session-top', !chromeVisible && 'is-hidden')}>
        <div className="session-peer">
          <span className={cn('live-dot', connected && 'is-live')} />
          <div>
            <strong>{launch.peerName || '远程设备'}</strong>
            <span>
              {connected
                ? isHost
                  ? '远程控制进行中'
                  : `${platformLabel(remote?.platform || remote?.os || '')} · 已直连`
                : phase === 'waiting'
                  ? '等待对方连接'
                  : phase === 'authenticating'
                    ? '正在验证访问码'
                    : '正在建立连接'}
            </span>
          </div>
          {remote?.canControl === false ? <span className="chip chip-warn">仅观看</span> : null}
        </div>

        <div className="session-top-right">
          {recording ? (
            <span className="rec-pill">
              <span className="rec-dot" /> {formatDuration(recordSeconds)}
            </span>
          ) : null}
          {stats && appSettings?.showStats && connected ? (
            <span className="stats-chip">
              <Gauge size={13} />
              {stats.fps || '–'} FPS · {stats.kbps || '–'} kbps · {stats.rtt || '–'} ms
              <em>
                {stats.width && stats.height ? `${stats.width}×${stats.height}` : ''}
              </em>
            </span>
          ) : null}
          <IconButton label={fullscreen ? '退出全屏' : '全屏'} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </IconButton>
          <IconButton label="结束会话" danger onClick={exit}>
            <PhoneOff size={16} />
          </IconButton>
        </div>
      </div>

      <div
        className={cn('stage', connected && (isHost ? 'is-host' : 'is-viewer'), controlling && 'can-control')}
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => {
          if (!isHost) e.preventDefault()
        }}
        onDragOver={(e) => {
          if (connected) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!connected) return
          e.preventDefault()
          void pickFiles(e.dataTransfer.files)
        }}
      >
        <video ref={videoRef} className="remote-video" playsInline muted={isHost || audioMuted} autoPlay />

        {!connected ? (
          <div className="stage-placeholder">
            <div className="waiting-panel compact-panel">
              <div className={cn('overlay-icon', phase !== 'error' && 'pulse')}>
                {phase === 'error' ? <X size={22} /> : phase === 'preparing' ? <Spinner size={22} /> : <Monitor size={22} />}
              </div>
              <h3>
                {phase === 'error'
                  ? '连接失败'
                  : isHost
                    ? '正在准备共享屏幕'
                    : '正在连接远程设备'}
              </h3>
              <p>
                {detail ||
                  (isHost
                    ? '密码验证通过，正在建立端到端加密连接'
                    : `控制码 ${groupCode(launch.code ?? '')} · 点对点直连`)}
              </p>
              {isHost && launch.code ? (
                <div className="waiting-pin">
                  <span>控制码</span>
                  <strong>{groupCode(launch.code)}</strong>
                  <span>控制密码</span>
                  <strong>{launch.pin}</strong>
                </div>
              ) : null}
              {!isHost && phase === 'authenticating' ? (
                <div className="auth-box">
                  <span className="field-label">{authError || '正在验证控制密码'}</span>
                  <div className="auth-row">
                    <Input
                      value={authPin}
                      maxLength={12}
                      onChange={(e) => setAuthPin(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12))}
                      data-local-input
                    />
                    <Button variant="secondary" onClick={retryAuth}>
                      重试
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="waiting-note">
                {phase === 'error' ? <X size={14} /> : <Loader2 size={14} className="spin" />}
                {phase === 'error' ? '请确认控制码与密码后重试' : '等待连接建立…'}
              </div>
              {phase === 'error' ? (
                <Button variant="secondary" onClick={() => setLaunch(null)}>
                  返回主页
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {connected && isHost ? (
          <div className="host-banner">
            <span className="live-dot is-live" />
            对方正在查看此屏幕{allowControl ? '并可控制鼠标键盘' : '（仅观看）'}
          </div>
        ) : null}

        {connected && !isHost && !controlling ? (
          <div className="view-only-hint">
            <MousePointer2 size={14} /> 当前为仅观看模式，点击工具栏中的鼠标图标可接管控制
          </div>
        ) : null}

        {exitOverlay}
      </div>

      {connected ? (
        <div className={cn('session-toolbar', !chromeVisible && 'is-hidden')}>
          <div className="toolbar-group">
            <IconButton label="返回" onClick={exit}>
              <ArrowLeft size={17} />
            </IconButton>
            {isHost ? (
              <button
                className={cn('toolbar-toggle', allowControl && 'is-on')}
                onClick={() => {
                  sessionRef.current?.setAllowControl(!allowControl)
                }}
              >
                <ShieldCheck size={16} />
                {allowControl ? '允许控制' : '仅观看'}
              </button>
            ) : (
              <button
                className={cn('toolbar-toggle', controlling && 'is-on')}
                onClick={() => {
                  const next = !controlling
                  setControlling(next)
                  sessionRef.current?.setControlling(next)
                }}
              >
                <MousePointer2 size={16} />
                {controlling ? '控制中' : '仅观看'}
              </button>
            )}
            {!isHost ? (
              <button
                className={cn('toolbar-toggle', keyboardOn && 'is-on')}
                onClick={() => setKeyboardOn((v) => !v)}
              >
                <Keyboard size={16} />
                键盘
              </button>
            ) : null}
            <button
              className={cn('toolbar-toggle', clipboardOn && 'is-on')}
              onClick={() => {
                const next = !clipboardOn
                setClipboardOn(next)
                sessionRef.current?.setClipboardEnabled(next)
                toast('info', next ? '已开启剪贴板同步' : '已关闭剪贴板同步')
              }}
            >
              {clipboardOn ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
              剪贴板
            </button>
            {!isHost ? (
              <IconButton label={audioMuted ? '取消静音' : '静音'} active={!audioMuted} onClick={() => setAudioMuted((v) => !v)}>
                {audioMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </IconButton>
            ) : null}
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <div className="toolbar-pop">
              <IconButton label="画质" onClick={() => setQualityOpen((v) => !v)} active={qualityOpen}>
                <Gauge size={17} />
              </IconButton>
              <Popover open={qualityOpen} onClose={() => setQualityOpen(false)}>
                <div className="popover-title">画质</div>
                {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((preset) => (
                  <button
                    key={preset}
                    className={cn('popover-item', quality === preset && 'is-active')}
                    onClick={() => changeQuality(preset)}
                  >
                    <div>
                      <strong>{QUALITY_PRESETS[preset].label}</strong>
                      <span>{QUALITY_PRESETS[preset].hint}</span>
                    </div>
                    {quality === preset ? <Check size={14} /> : null}
                  </button>
                ))}
              </Popover>
            </div>
            <div className="toolbar-pop">
              <IconButton label="显示器" onClick={() => setMonitorOpen((v) => !v)} active={monitorOpen}>
                <Monitor size={17} />
              </IconButton>
              <Popover open={monitorOpen} onClose={() => setMonitorOpen(false)}>
                <div className="popover-title">切换显示器</div>
                {monitors.length === 0 ? <div className="popover-empty">未检测到显示器</div> : null}
                {monitors.map((monitor) => (
                  <button
                    key={monitor.id}
                    className={cn('popover-item', activeDisplayId === monitor.id && 'is-active')}
                    onClick={() => chooseMonitor(monitor.id)}
                  >
                    <div>
                      <strong>{monitor.label}</strong>
                      <span>
                        {monitor.width} × {monitor.height}
                      </span>
                    </div>
                    {activeDisplayId === monitor.id ? <Check size={14} /> : null}
                  </button>
                ))}
              </Popover>
            </div>
            <IconButton
              label="聊天"
              active={panel === 'chat'}
              onClick={() => {
                setPanel((p) => (p === 'chat' ? null : 'chat'))
                setUnread(0)
              }}
            >
              <MessageSquare size={17} />
              {unread > 0 ? <span className="badge">{unread}</span> : null}
            </IconButton>
            <IconButton
              label="文件传输"
              active={panel === 'files'}
              onClick={() => setPanel((p) => (p === 'files' ? null : 'files'))}
            >
              <FolderUp size={17} />
              {files.some((f) => f.status === 'active') ? <span className="badge dot" /> : null}
            </IconButton>
            {!isHost ? (
              <IconButton label="发送文字" onClick={() => setTextOpen(true)}>
                <Square size={16} />
              </IconButton>
            ) : null}
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <IconButton label="截图" onClick={takeScreenshot}>
              <Camera size={17} />
            </IconButton>
            <IconButton label={recording ? '停止录制' : '录制会话'} active={recording} onClick={toggleRecording}>
              {recording ? <Square size={15} /> : <Circle size={17} />}
            </IconButton>
            <IconButton label="全屏" onClick={() => void toggleFullscreen()}>
              <Maximize size={17} />
            </IconButton>
            <IconButton label="断开" danger onClick={exit}>
              <PhoneOff size={17} />
            </IconButton>
          </div>
        </div>
      ) : null}

      {panel ? (
        <aside className="side-panel">
          <div className="side-panel-head">
            <div className="side-tabs">
              <button
                className={cn('side-tab', panel === 'chat' && 'is-active')}
                onClick={() => {
                  setPanel('chat')
                  setUnread(0)
                }}
              >
                <MessageSquare size={14} /> 聊天
              </button>
              <button
                className={cn('side-tab', panel === 'files' && 'is-active')}
                onClick={() => setPanel('files')}
              >
                <FolderUp size={14} /> 文件
              </button>
            </div>
            <IconButton label="关闭" onClick={() => setPanel(null)}>
              <X size={15} />
            </IconButton>
          </div>

          {panel === 'chat' ? (
            <div className="chat-panel">
              <div className="chat-list">
                {chat.length === 0 ? (
                  <div className="panel-empty">
                    <MessageSquare size={18} />
                    <p>会话内消息仅在两台设备之间传输</p>
                  </div>
                ) : (
                  chat.map((msg) => (
                    <div key={msg.id} className={cn('chat-bubble', msg.from === 'me' ? 'is-me' : 'is-peer')}>
                      <span>{msg.text}</span>
                      <em>
                        {new Date(msg.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </em>
                    </div>
                  ))
                )}
              </div>
              <div className="chat-input">
                <Input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder="输入消息，回车发送"
                  data-local-input
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                />
                <Button variant="primary" size="sm" onClick={sendChat}>
                  发送
                </Button>
              </div>
            </div>
          ) : (
            <div className="files-panel">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => {
                  void pickFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                <FolderUp size={20} />
                <strong>选择或拖入文件</strong>
                <span>文件通过点对点数据通道传输</span>
              </button>
              {files.length === 0 ? (
                <div className="panel-empty compact">
                  <p>暂无传输任务</p>
                </div>
              ) : (
                <div className="file-list">
                  {files.map((file) => {
                    const percent = file.size ? Math.min(100, Math.round((file.transferred / file.size) * 100)) : 0
                    return (
                      <div key={file.id} className={cn('file-item', `is-${file.status}`)}>
                        <div className="file-head">
                          <div className="file-meta">
                            <strong>{file.name || (file.direction === 'out' ? '发送文件' : '接收文件')}</strong>
                            <span>
                              {formatBytes(file.size)} ·{' '}
                              {file.status === 'pending'
                                ? '等待确认'
                                : file.status === 'active'
                                  ? `${percent}%`
                                  : file.status === 'done'
                                    ? '已完成'
                                    : file.status === 'declined'
                                      ? '已拒绝'
                                      : '失败'}
                            </span>
                          </div>
                          <span className="file-direction">{file.direction === 'out' ? '发送' : '接收'}</span>
                        </div>
                        {file.status === 'active' || file.status === 'done' ? (
                          <div className="progress">
                            <span style={{ width: `${file.status === 'done' ? 100 : percent}%` }} />
                          </div>
                        ) : null}
                        {file.status === 'pending' && file.direction === 'in' ? (
                          <div className="file-actions">
                            <Button size="sm" variant="ghost" onClick={() => sessionRef.current?.declineFile(file.id)}>
                              拒绝
                            </Button>
                            <Button size="sm" variant="primary" onClick={() => void sessionRef.current?.acceptFile(file.id)}>
                              <Download size={13} /> 接收
                            </Button>
                          </div>
                        ) : null}
                        {file.status === 'done' && file.path ? (
                          <button className="text-btn" onClick={() => void window.cdesk.dialog.openFolder(file.path!)}>
                            打开所在文件夹
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      ) : null}

      <Modal
        open={textOpen}
        onClose={() => setTextOpen(false)}
        title="发送文字"
        subtitle="直接将文字输入到远程光标位置，适合输入中文或粘贴内容"
        width={440}
      >
        <Textarea
          rows={5}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder="在此输入要发送到远程设备的文字…"
          data-local-input
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setTextOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              sessionRef.current?.sendTextInput(textValue)
              setTextValue('')
              setTextOpen(false)
              toast('success', '已发送文字')
            }}
            disabled={!textValue}
          >
            发送到远程
          </Button>
        </div>
      </Modal>
    </div>
  )
}
