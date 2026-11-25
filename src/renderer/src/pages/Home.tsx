import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Copy,
  KeyRound,
  Laptop,
  Link2,
  Lock,
  MonitorUp,
  Pin,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wifi,
  Zap
} from 'lucide-react'
import { useApp } from '../store'
import { Button, CopyButton, DeviceAvatar, Input, Modal, Segmented, Spinner, Textarea } from '../components/ui'
import { cn, isMacOs, platformLabel, shortId, timeAgo } from '../lib/utils'

type Mode = 'lan' | 'code'

interface Recent {
  name: string
  os: string
  ts: number
  transport: 'lan' | 'code'
  role: 'viewer' | 'host'
}

const RECENTS_KEY = 'cdesk.recents'

function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Recent[]
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch {
    return []
  }
}

function pushRecent(entry: Recent) {
  try {
    const next = [entry, ...loadRecents().filter((r) => r.name !== entry.name || Date.now() - r.ts > 60000)]
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, 5)))
  } catch {
    /* ignore */
  }
}

function PinAttempt({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="pin-input"
      inputMode="numeric"
      autoFocus
      maxLength={8}
      placeholder="••••••"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function NearbyList({ onPick }: { onPick: (peerId: string) => void }) {
  const peers = useApp((s) => s.peers)
  const refresh = useApp((s) => s.refreshPeers)
  const [refreshing, setRefreshing] = useState(false)
  const available = useMemo(() => peers.filter((p) => p.hosting), [peers])

  const doRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setTimeout(() => setRefreshing(false), 600)
  }

  return (
    <div className="nearby">
      <div className="nearby-head">
        <span className="muted-label">
          <Radar size={13} /> 附近设备 · {available.length}
        </span>
        <button className={cn('text-btn', refreshing && 'is-spinning')} onClick={() => void doRefresh()}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>
      {available.length === 0 ? (
        <div className="nearby-empty">
          <div className="radar">
            <span className="radar-ring" />
            <span className="radar-ring" />
            <span className="radar-dot" />
            <Wifi size={18} />
          </div>
          <p>尚未发现可连接设备</p>
          <span>请让对方在本应用中开启「允许远程控制」，并确保处于同一局域网</span>
        </div>
      ) : (
        <div className="peer-list">
          {available.map((peer) => (
            <div key={peer.id} className="peer-row">
              <DeviceAvatar platform={peer.platform || peer.os} os={peer.os} live />
              <div className="peer-meta">
                <strong>{peer.name}</strong>
                <span>
                  {platformLabel(peer.platform || peer.os)} · {peer.address}
                </span>
              </div>
              <span className="chip chip-success">可连接</span>
              <Button size="sm" variant="soft" onClick={() => onPick(peer.id)}>
                连接
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const info = useApp((s) => s.info)
  const settings = useApp((s) => s.settings)
  const peers = useApp((s) => s.peers)
  const hosting = useApp((s) => s.hosting)
  const pin = useApp((s) => s.pin)
  const setHosting = useApp((s) => s.setHosting)
  const regeneratePin = useApp((s) => s.regeneratePin)
  const displays = useApp((s) => s.displays)
  const setLaunch = useApp((s) => s.setLaunch)
  const toast = useApp((s) => s.toast)

  const [mode, setMode] = useState<Mode>('lan')
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const [attemptPin, setAttemptPin] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [codePin, setCodePin] = useState('')
  const [recents, setRecents] = useState<Recent[]>([])

  useEffect(() => {
    setRecents(loadRecents())
  }, [])

  const peer = peers.find((p) => p.id === selectedPeer) ?? null

  const startLanControl = async () => {
    if (!peer) return
    if (attemptPin.trim().length < 4) {
      toast('error', '请输入访问码', '访问码显示在对方屏幕的主页上')
      return
    }
    setConnecting(true)
    try {
      const conn = await window.cdesk.lan.connect(peer.address, peer.port)
      pushRecent({ name: peer.name, os: peer.os, ts: Date.now(), transport: 'lan', role: 'viewer' })
      setRecents(loadRecents())
      setLaunch({
        role: 'viewer',
        transport: 'lan',
        connId: conn.connId,
        pin: attemptPin.trim(),
        peerName: peer.name,
        peerOs: peer.os
      })
      setSelectedPeer(null)
      setAttemptPin('')
    } catch (err) {
      toast('error', '无法连接设备', err instanceof Error ? err.message : '请检查网络与防火墙')
    } finally {
      setConnecting(false)
    }
  }

  const startCodeControl = () => {
    if (!inviteCode.trim()) {
      toast('error', '请粘贴邀请码')
      return
    }
    if (codePin.trim().length < 4) {
      toast('error', '请输入访问码')
      return
    }
    pushRecent({ name: '邀请码会话', os: 'cDesk', ts: Date.now(), transport: 'code', role: 'viewer' })
    setRecents(loadRecents())
    setLaunch({
      role: 'viewer',
      transport: 'manual',
      pin: codePin.trim(),
      peerName: '远程设备',
      invite: inviteCode.trim()
    })
  }

  const startManualHost = () => {
    const displayId = displays.find((d) => d.primary)?.id ?? displays[0]?.id ?? 0
    setLaunch({
      role: 'host',
      transport: 'manual',
      pin,
      peerName: '邀请码会话',
      displayId
    })
  }

  const primary = displays.find((d) => d.primary) ?? displays[0]
  const deviceId = settings ? shortId(settings.deviceId) : '----'

  return (
    <div className="page home-page">
      <header className="page-head">
        <div className="page-head-text">
          <span className="eyebrow">
            <Sparkles size={12} /> P2P REMOTE DESKTOP
          </span>
          <h1>你的设备，随时在手中</h1>
          <p>无需账号、无需服务器，设备之间直接建立端到端加密连接。</p>
        </div>
        <div className="identity-card">
          <DeviceAvatar platform={info?.platform} os={info?.osName} size={46} live={hosting} />
          <div className="identity-meta">
            <strong>{settings?.deviceName}</strong>
            <span>
              {info?.osName} · {deviceId}
            </span>
          </div>
          <CopyButton value={settings?.deviceId ?? ''} label="复制设备 ID" compact />
        </div>
      </header>

      <div className="home-grid">
        <section className="card connect-panel">
          <div className="card-head">
            <div>
              <h2>连接远程设备</h2>
              <p className="card-sub">选择附近设备，或使用邀请码跨网络直连</p>
            </div>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'lan', label: '局域网' },
                { value: 'code', label: '邀请码' }
              ]}
            />
          </div>

          {mode === 'lan' ? (
            <NearbyList onPick={setSelectedPeer} />
          ) : (
            <div className="code-form">
              <div className="code-steps">
                <span className="step-pill">
                  <Link2 size={12} /> 粘贴对方的邀请码
                </span>
                <span className="step-pill">
                  <KeyRound size={12} /> 输入对方访问码
                </span>
              </div>
              <Textarea
                rows={5}
                placeholder="粘贴邀请码，例如 CD1-eJyN…"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                spellCheck={false}
              />
              <div className="code-row">
                <Input
                  className="pin-inline"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="访问码"
                  value={codePin}
                  onChange={(e) => setCodePin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
                <Button variant="primary" icon={<ArrowRight size={16} />} onClick={startCodeControl}>
                  建立连接
                </Button>
              </div>
              <p className="code-hint">
                邀请码为一次性信令，仅用于交换网络信息，画面与控制数据始终点对点传输。
              </p>
            </div>
          )}
        </section>

        <section className={cn('card share-panel', hosting && 'is-live')}>
          <div className="share-orbit">
            <span className="orbit-ring ring-1" />
            <span className="orbit-ring ring-2" />
            <div className="share-core">
              <MonitorUp size={26} />
            </div>
          </div>
          <div className="share-text">
            <h2>{hosting ? '正在共享这台设备' : '共享这台设备'}</h2>
            <p>
              {hosting
                ? '局域网内的设备可以看到本机并发起连接，连接需要访问码验证。'
                : '开启后，同一局域网内的 cDesk 设备即可向你发起远程协助。'}
            </p>
          </div>

          {hosting ? (
            <>
              <div className="pin-block">
                <span className="pin-caption">访问码</span>
                <div className="pin-digits">
                  {pin.split('').map((digit, index) => (
                    <span key={index} className="pin-digit">
                      {digit}
                    </span>
                  ))}
                </div>
                <div className="pin-actions">
                  <CopyButton value={pin} label="复制" compact />
                  <button className="text-btn" onClick={regeneratePin}>
                    <RefreshCw size={12} /> 更换
                  </button>
                </div>
              </div>
              <Button variant="secondary" className="block" onClick={startManualHost} icon={<Link2 size={15} />}>
                生成跨网络邀请码
              </Button>
              <button className="link-btn" onClick={() => void setHosting(false)}>
                停止共享
              </button>
            </>
          ) : (
            <Button
              variant="primary"
              className="block"
              icon={<Zap size={16} />}
              onClick={() => void setHosting(true)}
            >
              允许远程控制
            </Button>
          )}

          <div className="share-meta">
            <span>
              <ShieldCheck size={13} /> DTLS-SRTP 加密
            </span>
            <span>
              <Laptop size={13} /> {primary ? `${primary.width} × ${primary.height}` : '自动选择显示器'}
            </span>
          </div>
        </section>
      </div>

      <div className="home-lower">
        <section className="card recent-panel">
          <div className="card-head compact">
            <h2>最近连接</h2>
            <span className="muted-label">{recents.length ? `${recents.length} 条记录` : '仅保存在本机'}</span>
          </div>
          {recents.length === 0 ? (
            <div className="recent-empty">
              <Pin size={16} />
              还没有连接记录，发起第一次远控吧
            </div>
          ) : (
            <div className="recent-list">
              {recents.map((item, index) => (
                <div className="recent-row" key={`${item.name}-${item.ts}-${index}`}>
                  <DeviceAvatar platform={item.os} os={item.os} size={36} />
                  <div className="recent-meta">
                    <strong>{item.name}</strong>
                    <span>
                      {item.transport === 'lan' ? '局域网直连' : '邀请码直连'} · {timeAgo(item.ts)}
                    </span>
                  </div>
                  <span className="chip">{item.role === 'viewer' ? '主控' : '被控'}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="feature-strip">
          <div className="feature">
            <div className="feature-icon"><Zap size={16} /></div>
            <div>
              <strong>超低延迟</strong>
              <span>WebRTC 直连，弱网自动降级</span>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><Lock size={16} /></div>
            <div>
              <strong>端到端加密</strong>
              <span>不经过任何中转服务器</span>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><Copy size={16} /></div>
            <div>
              <strong>剪贴板与文件</strong>
              <span>双向同步，拖拽即传</span>
            </div>
          </div>
        </section>
      </div>

      <Modal
        open={!!peer}
        onClose={() => {
          setSelectedPeer(null)
          setAttemptPin('')
        }}
        width={420}
        title="输入访问码"
        subtitle={peer ? `正在连接 ${peer.name} · ${platformLabel(peer.platform || peer.os)}` : ''}
      >
        <div className="pin-modal">
          <div className="pin-modal-device">
            <DeviceAvatar platform={peer?.platform || peer?.os} os={peer?.os} size={56} live />
            <span>{isMacOs(peer?.os ?? '', peer?.platform) ? 'macOS 设备' : '远程设备'}</span>
          </div>
          <PinAttempt value={attemptPin} onChange={setAttemptPin} />
          <p className="pin-tip">访问码显示在对方 cDesk 主页面板中</p>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setSelectedPeer(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void startLanControl()} disabled={connecting}>
              {connecting ? <Spinner size={15} /> : null}
              {connecting ? '连接中…' : '连接'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
