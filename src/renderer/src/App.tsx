import { useEffect, useState } from 'react'
import {
  House,
  Info,
  Settings2,
  Minus,
  Square,
  X,
  ShieldCheck,
  Radio,
  MonitorPlay,
  Wifi
} from 'lucide-react'
import { useApp } from './store'
import { cn } from './lib/utils'
import { initLanBus, clearSignals } from './lib/lan'
import { Button, Modal, Switch, ToastStack, Spinner, CopyButton, DeviceAvatar } from './components/ui'
import HomePage from './pages/Home'
import SettingsPage from './pages/Settings'
import SessionPage from './pages/Session'

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
        <span className="brand-version">v{info?.version ?? '1.0.0'}</span>
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
              <span>{hosting ? '局域网内设备可发现本机' : '开启后允许远程连接'}</span>
            </div>
          </div>
          <Switch checked={hosting} onChange={(next) => void setHosting(next)} label="允许远程控制" />
        </div>
        {hosting ? (
          <div className="host-pin">
            <div>
              <span className="host-pin-label">访问码</span>
              <strong className="host-pin-value">{pin}</strong>
            </div>
            <CopyButton value={pin} label="复制访问码" compact />
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

function IncomingDialog() {
  const incoming = useApp((s) => s.incoming)
  const setIncoming = useApp((s) => s.setIncoming)
  const setLaunch = useApp((s) => s.setLaunch)
  const pin = useApp((s) => s.pin)
  const displays = useApp((s) => s.displays)

  if (!incoming) return null

  const displayId = displays.find((d) => d.primary)?.id ?? displays[0]?.id ?? 0

  return (
    <Modal
      open
      width={430}
      onClose={() => {
        void window.cdesk.lan.close(incoming.connId)
        setIncoming(null)
      }}
      title="远程协助请求"
      subtitle="对方希望通过点对点直连控制这台设备"
    >
      <div className="incoming-device">
        <DeviceAvatar platform={incoming.os} os={incoming.os} size={52} live />
        <div className="incoming-meta">
          <strong>{incoming.name}</strong>
          <span>
            {incoming.os || '未知系统'} · {incoming.address ?? '局域网'}
          </span>
        </div>
        <span className="chip chip-accent">
          <Radio size={12} />
          直连
        </span>
      </div>
      <div className="incoming-code">
        <span>连接后对方需输入访问码</span>
        <div className="pin-row">
          <span className="pin-digits">{pin}</span>
          <CopyButton value={pin} label="复制" compact />
        </div>
      </div>
      <div className="modal-actions">
        <Button
          variant="ghost"
          onClick={() => {
            void window.cdesk.lan.close(incoming.connId)
            setIncoming(null)
          }}
        >
          拒绝
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setLaunch({
              role: 'host',
              transport: 'lan',
              connId: incoming.connId,
              pin,
              peerName: incoming.name,
              peerOs: incoming.os,
              displayId
            })
            setIncoming(null)
          }}
        >
          接受并共享屏幕
        </Button>
      </div>
    </Modal>
  )
}

export default function App() {
  const booted = useApp((s) => s.booted)
  const init = useApp((s) => s.init)
  const launch = useApp((s) => s.launch)
  const page = useApp((s) => s.page)
  const setIncoming = useApp((s) => s.setIncoming)

  useEffect(() => {
    initLanBus()
    void init()
  }, [init])

  useEffect(() => {
    const offPeers = window.cdesk.lan.onPeers((peers) => useApp.getState().setPeers(peers))
    const offConn = window.cdesk.lan.onConn((conn) => {
      const state = useApp.getState()
      if (!state.hosting) return
      if (state.launch) return
      if (conn.from.id && conn.from.id === state.settings?.deviceId) return
      setIncoming({
        connId: conn.connId,
        name: conn.from.name || '未知设备',
        os: conn.from.os || '未知系统',
        address: conn.from.address,
        ts: Date.now()
      })
    })
    const offClosed = window.cdesk.lan.onClosed(({ connId }) => {
      clearSignals(connId)
      const state = useApp.getState()
      if (state.incoming?.connId === connId) state.setIncoming(null)
    })
    const offSettings = window.cdesk.settings.onChange((settings) => useApp.setState({ settings }))
    return () => {
      offPeers()
      offConn()
      offClosed()
      offSettings()
    }
  }, [setIncoming])

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
      <ToastStack />
      <IncomingDialog />
    </div>
  )
}
