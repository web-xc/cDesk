import { useEffect, useState } from 'react'
import {
  Ban,
  Check,
  House,
  Info,
  Minus,
  MonitorPlay,
  Settings2,
  ShieldCheck,
  Square,
  Wifi,
  X
} from 'lucide-react'
import { useApp } from './store'
import { cn, groupCode } from './lib/utils'
import { initLanBus, clearSignals } from './lib/lan'
import { open } from './lib/secure'
import { Switch, ToastStack, Spinner, CopyButton, Modal, Button, DeviceAvatar } from './components/ui'
import HomePage from './pages/Home'
import SettingsPage from './pages/Settings'
import SessionPage from './pages/Session'

interface CodeOffer {
  v: number
  type: 'offer' | 'answer'
  sdp: string
  sessionId: string
  from?: { id?: string; name?: string; os?: string }
}

function TitleBar() {
  const info = useApp((s) => s.info)
  const launch = useApp((s) => s.launch)
  const isMac = window.cdesk.env.isMac
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.cdesk.window.isMaximized().then(setMaximized)
    return window.cdesk.window.onMaximized(setMaximized)
  }, [])

  return (
    <header className={cn('titlebar', isMac && 'is-mac')}>
      <div className="titlebar-brand">
        <span className="brand-mark" aria-hidden>
          <MonitorPlay size={15} />
        </span>
        <span className="brand-word">cDesk</span>
        <span className="brand-version">v{info?.version ?? '1.1.0'}</span>
      </div>
      <div className="titlebar-drag">
        {launch ? (
          <span className="titlebar-session">
            <span className="live-dot" />
            {launch.role === 'viewer' ? `正在控制 ${launch.peerName}` : `${launch.peerName} 正在连接`}
          </span>
        ) : null}
      </div>
      {!isMac ? (
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => void window.cdesk.window.minimize()}>
            <Minus size={15} />
          </button>
          <button aria-label={maximized ? '还原' : '最大化'} onClick={() => void window.cdesk.window.toggleMaximize()}>
            <Square size={12} />
          </button>
          <button aria-label="关闭" className="is-close" onClick={() => void window.cdesk.window.close()}>
            <X size={15} />
          </button>
        </div>
      ) : null}
    </header>
  )
}

function Sidebar() {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const hosting = useApp((s) => s.hosting)
  const setHosting = useApp((s) => s.setHosting)
  const pin = useApp((s) => s.pin)
  const settings = useApp((s) => s.settings)
  const capabilities = useApp((s) => s.capabilities)

  return (
    <aside className="sidebar">
      <nav className="nav">
        <button className={cn('nav-item', page === 'home' && 'is-active')} onClick={() => setPage('home')}>
          <House size={18} />
          <span>主页</span>
        </button>
        <button className={cn('nav-item', page === 'settings' && 'is-active')} onClick={() => setPage('settings')}>
          <Settings2 size={18} />
          <span>设置</span>
        </button>
      </nav>

      <div className={cn('host-card', hosting && 'is-live')}>
        <div className="host-card-head">
          <div className="host-state">
            <span className={cn('state-orb', hosting && 'is-live')} />
            <div>
              <strong>{hosting ? '可被远程控制' : '本机未开放'}</strong>
              <span>{hosting ? '输入远程码与密码即可连接' : '开启后允许远程连接'}</span>
            </div>
          </div>
          <Switch checked={hosting} onChange={(next) => void setHosting(next)} label="允许远程控制" />
        </div>
        {hosting ? (
          <div className="host-pin">
            <div>
              <span className="host-pin-label">远程码</span>
              <strong className="host-pin-value">{groupCode(settings?.deviceCode ?? '')}</strong>
              <span className="host-pin-label">控制密码 · {pin}</span>
            </div>
            <CopyButton
              value={`远程码：${groupCode(settings?.deviceCode ?? '')}\n密码：${pin}`}
              label="复制"
              compact
            />
          </div>
        ) : (
          <div className="host-footnote">
            <ShieldCheck size={13} />
            全程点对点加密，不经过服务器
          </div>
        )}
        {capabilities && !capabilities.remoteInput ? (
          <div className="host-warn">
            <Info size={13} />
            当前系统未启用远程输入注入，仅可观看屏幕
          </div>
        ) : null}
      </div>

      <div className="sidebar-foot">
        <div className="sidebar-status">
          <Wifi size={13} />
          <span>局域网发现已开启</span>
        </div>
        <p className="sidebar-hint">无需账号 · 无需服务器</p>
      </div>
    </aside>
  )
}

function BootScreen() {
  return (
    <div className="boot">
      <div className="boot-mark">
        <MonitorPlay size={26} />
      </div>
      <div className="boot-title">cDesk</div>
      <div className="boot-sub">
        <Spinner size={14} /> 正在启动点对点引擎…
      </div>
    </div>
  )
}

export default function App() {
  const booted = useApp((s) => s.booted)
  const init = useApp((s) => s.init)
  const launch = useApp((s) => s.launch)
  const page = useApp((s) => s.page)
  const hosting = useApp((s) => s.hosting)
  const deviceCode = useApp((s) => s.settings?.deviceCode ?? '')
  const pin = useApp((s) => s.pin)
  const pending = useApp((s) => s.pending)
  const autoAccept = useApp((s) => s.settings?.autoAccept ?? false)
  const acceptPending = useApp((s) => s.acceptPending)
  const rejectPending = useApp((s) => s.rejectPending)
  const setPending = useApp((s) => s.setPending)
  const checkUpdates = useApp((s) => s.checkUpdates)

  useEffect(() => {
    initLanBus()
    void init()
  }, [init])

  useEffect(() => {
    const offPeers = window.cdesk.lan.onPeers((peers) => useApp.getState().setPeers(peers))
    const offConn = window.cdesk.lan.onConn((conn) => {
      const state = useApp.getState()
      if (!state.hosting || state.launch || state.pending) return
      if (conn.from.id && conn.from.id === state.settings?.deviceId) return
      if (state.settings?.autoAccept) {
        const displayId = state.displays.find((d) => d.primary)?.id ?? state.displays[0]?.id ?? 0
        state.setLaunch({
          role: 'host', transport: 'lan', connId: conn.connId, pin: state.pin,
          peerName: conn.from.name || '未知设备', peerOs: conn.from.os, displayId
        })
        state.toast('info', `${conn.from.name || '未知设备'} 正在连接`, '已自动接受')
      } else {
        state.setPending({
          kind: 'lan', connId: conn.connId, peerName: conn.from.name || '未知设备',
          peerOs: conn.from.os, ts: Date.now(), deadline: Date.now() + 15000
        })
      }
    })
    const offClosed = window.cdesk.lan.onClosed(({ connId }) => {
      clearSignals(connId)
      const state = useApp.getState()
      if (state.pending?.connId === connId) state.setPending(null)
    })
    const offSettings = window.cdesk.settings.onChange((settings) => useApp.setState({ settings }))
    return () => {
      offPeers(); offConn(); offClosed(); offSettings()
    }
  }, [])

  // 15s 超时自动拒绝 pending 请求
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => {
      const state = useApp.getState()
      if (state.pending && Date.now() >= state.pending.deadline) {
        state.rejectPending()
        state.toast('info', '连接请求已超时')
      }
    }, Math.max(0, pending.deadline - Date.now()))
    return () => clearTimeout(t)
  }, [pending])

  // 启动后检查一次更新
  useEffect(() => {
    if (booted) void checkUpdates()
  }, [booted, checkUpdates])

  useEffect(() => {
    const apply = (status: { connected: boolean; broker: string; error?: string }): void => {
      useApp.getState().setSignalStatus(status.connected, status.broker, status.error)
    }
    const off = window.cdesk.signal.onStatus(apply)
    void window.cdesk.signal.status().then(apply)
    return off
  }, [])

  // 被控端：订阅远程码收件箱，密码可解密即自动接受，无需人工确认
  useEffect(() => {
    if (!hosting || !deviceCode || pin.length < 4) return
    const topic = `cdesk/v1/${deviceCode}/inbox`
    let disposed = false
    const off = window.cdesk.signal.onMessage((msg) => {
      if (msg.topic !== topic || disposed) return
      void (async () => {
        const state = useApp.getState()
        if (state.launch || state.pending) return
        const offer = await open<CodeOffer>(msg.payload, pin, deviceCode)
        if (!offer || offer.type !== 'offer' || !offer.sessionId) return
        if (offer.from?.id && offer.from.id === state.settings?.deviceId) return
        if (state.settings?.autoAccept) {
          const latest = useApp.getState()
          if (latest.launch) return
          const displayId = latest.displays.find((d) => d.primary)?.id ?? latest.displays[0]?.id ?? 0
          latest.setLaunch({
            role: 'host',
            transport: 'code',
            pin,
            code: deviceCode,
            sessionId: offer.sessionId,
            offerSdp: offer.sdp,
            peerName: offer.from?.name || '远程设备',
            peerOs: offer.from?.os,
            displayId
          })
          latest.toast('info', `${offer.from?.name || '远程设备'} 正在连接`, '密码验证通过，已自动接受')
        } else {
          state.setPending({
            kind: 'code',
            code: deviceCode,
            sessionId: offer.sessionId,
            offerSdp: offer.sdp,
            peerName: offer.from?.name || '远程设备',
            peerOs: offer.from?.os,
            ts: Date.now(),
            deadline: Date.now() + 30000
          })
        }
      })()
    })
    void window.cdesk.signal.subscribe(topic).catch((err) => {
      console.error('信令订阅失败', err)
    })
    return () => {
      disposed = true
      off()
      void window.cdesk.signal.unsubscribe(topic).catch(() => {})
    }
  }, [hosting, deviceCode, pin])

  if (!booted) {
    return (
      <div className="shell">
        <div className="ambient" aria-hidden>
          <span className="orb orb-a" />
          <span className="orb orb-b" />
        </div>
        <BootScreen />
      </div>
    )
  }

  return (
    <div className={cn('shell', launch && 'in-session')}>
      <div className="ambient" aria-hidden>
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <TitleBar />
      <div className="shell-body">
        {!launch ? <Sidebar /> : null}
        <main className={cn('shell-main', launch && 'is-session')}>
          {launch ? (
            <SessionPage launch={launch} />
          ) : page === 'home' ? (
            <HomePage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
      {pending && !launch ? (
        <Modal
          open
          width={440}
          onClose={() => rejectPending()}
          title="远程协助请求"
          subtitle={`${pending.kind === 'code' ? '远程码直连' : '局域网直连'} · 15 秒内未响应将自动拒绝`}
        >
          <div className="incoming-device">
            <DeviceAvatar platform={pending.peerOs} os={pending.peerOs} size={52} live />
            <div className="incoming-meta">
              <strong>{pending.peerName}</strong>
              <span>{pending.peerOs || '未知系统'}</span>
            </div>
            <span className="chip chip-accent">
              <Wifi size={12} />
              密码已验证
            </span>
          </div>
          <p className="incoming-hint">对方已正确输入远程码与控制密码，是否接受远程协助？</p>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => rejectPending()} icon={<Ban size={16} />}>拒绝</Button>
            <Button variant="primary" onClick={() => acceptPending()} icon={<Check size={16} />}>接受并共享屏幕</Button>
          </div>
        </Modal>
      ) : null}
      <ToastStack />
    </div>
  )
}
