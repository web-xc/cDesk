import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BellRing,
  Check,
  ChevronRight,
  Command,
  ExternalLink,
  Info,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
  Palette,
  Save,
  ShieldCheck,
  Sparkles,
  Zap
} from 'lucide-react'
import { useApp } from '../store'
import { Button, Field, Input, Segmented, Switch } from '../components/ui'
import { QUALITY_PRESETS } from '../lib/quality'
import { cn } from '../lib/utils'

export default function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const capabilities = useApp((s) => s.capabilities)
  const refreshCapabilities = useApp((s) => s.refreshCapabilities)
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState(settings?.deviceName ?? '')
  const [fixedPin, setFixedPin] = useState(settings?.fixedPin ?? '')

  useEffect(() => {
    setName(settings?.deviceName ?? '')
    setFixedPin(settings?.fixedPin ?? '')
  }, [settings?.deviceName, settings?.fixedPin])

  if (!settings) return null

  const saveName = async () => {
    if (name.trim() && name.trim() !== settings.deviceName) {
      await patchSettings({ deviceName: name.trim() })
      toast('success', '设备名称已更新')
    }
  }

  const savePin = async () => {
    if (fixedPin.length >= 4) {
      await patchSettings({ fixedPin })
      toast('success', '固定访问码已保存')
    } else {
      toast('error', '访问码至少需要 4 位数字')
    }
  }

  const requestAccess = async () => {
    const ok = await window.cdesk.system.requestAccessibility()
    await refreshCapabilities()
    if (ok) toast('success', '已获得辅助功能权限')
    else toast('info', '请在系统设置中允许 cDesk 控制这台电脑')
  }

  return (
    <div className="page settings-page">
      <header className="page-head compact-head">
        <div className="page-head-text">
          <span className="eyebrow">
            <Command size={12} /> PREFERENCES
          </span>
          <h1>设置</h1>
          <p>调整外观、安全与连接策略，所有配置仅保存在本机。</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="card settings-card">
          <div className="settings-title">
            <span className="settings-icon"><MonitorSmartphone size={16} /></span>
            <div>
              <h2>本机设备</h2>
              <p>其他设备在局域网中看到的信息</p>
            </div>
          </div>
          <Field label="设备名称" hint="最多 40 个字符，修改后立即广播">
            <div className="inline-field">
              <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} />
              <Button variant="secondary" icon={<Save size={14} />} onClick={() => void saveName()}>
                保存
              </Button>
            </div>
          </Field>
          <div className="kv-row">
            <span>设备 ID</span>
            <code>{settings.deviceId.slice(0, 8).toUpperCase()}</code>
          </div>
          <div className="kv-row">
            <span>运行平台</span>
            <span>{info?.osName} · {info?.arch}</span>
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-title">
            <span className="settings-icon"><Palette size={16} /></span>
            <div>
              <h2>外观</h2>
              <p>界面主题与动效</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>主题</strong>
              <span>跟随系统或手动切换</span>
            </div>
            <Segmented
              value={settings.theme}
              onChange={(theme) => void patchSettings({ theme })}
              options={[
                { value: 'dark', label: '深色' },
                { value: 'light', label: '浅色' },
                { value: 'system', label: '跟随系统' }
              ]}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>减少动态效果</strong>
              <span>关闭背景光晕与过渡动画</span>
            </div>
            <Switch checked={settings.reduceMotion} onChange={(v) => void patchSettings({ reduceMotion: v })} />
          </div>
          <div className="setting-row">
            <div>
              <strong>显示实时统计</strong>
              <span>在会话中显示帧率、码率与延迟</span>
            </div>
            <Switch checked={settings.showStats} onChange={(v) => void patchSettings({ showStats: v })} />
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-title">
            <span className="settings-icon"><LockKeyhole size={16} /></span>
            <div>
              <h2>安全</h2>
              <p>验证方式与远程控制权限</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>访问码方式</strong>
              <span>每次会话随机生成，或使用固定访问码</span>
            </div>
            <Segmented
              value={settings.pinMode}
              onChange={(pinMode) => void patchSettings({ pinMode })}
              options={[
                { value: 'random', label: '随机' },
                { value: 'fixed', label: '固定' }
              ]}
            />
          </div>
          {settings.pinMode === 'fixed' ? (
            <Field label="固定访问码" hint="4–8 位数字，建议仅在可信网络中使用">
              <div className="inline-field">
                <Input
                  value={fixedPin}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="例如 246810"
                  onChange={(e) => setFixedPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
                <Button variant="secondary" onClick={() => void savePin()}>
                  保存
                </Button>
              </div>
            </Field>
          ) : null}
          <div className="setting-row">
            <div>
              <strong>仅共享画面</strong>
              <span>被控时拒绝鼠标与键盘输入，仅观看屏幕</span>
            </div>
            <Switch checked={settings.viewOnly} onChange={(v) => void patchSettings({ viewOnly: v })} />
          </div>
          <div className="setting-row">
            <div>
              <strong>自动同步剪贴板</strong>
              <span>会话中双向同步文本剪贴板</span>
            </div>
            <Switch
              checked={settings.clipboardSync}
              onChange={(v) => void patchSettings({ clipboardSync: v })}
            />
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-title">
            <span className="settings-icon"><Zap size={16} /></span>
            <div>
              <h2>连接与画质</h2>
              <p>点对点传输策略</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>默认画质</strong>
              <span>{QUALITY_PRESETS[settings.quality].hint}</span>
            </div>
            <Segmented
              value={settings.quality}
              onChange={(quality) => void patchSettings({ quality })}
              options={[
                { value: 'smooth', label: '流畅' },
                { value: 'balanced', label: '均衡' },
                { value: 'sharp', label: '高清' }
              ]}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>NAT 穿透辅助（STUN）</strong>
              <span>跨网络时仅用于发现公网地址，媒体数据仍然直连</span>
            </div>
            <Switch checked={settings.stunEnabled} onChange={(v) => void patchSettings({ stunEnabled: v })} />
          </div>
          <div className="setting-row">
            <div>
              <strong>开机自动启动</strong>
              <span>登录系统后在后台启动 cDesk</span>
            </div>
            <Switch checked={settings.launchAtLogin} onChange={(v) => void patchSettings({ launchAtLogin: v })} />
          </div>
          <div className="notice">
            <Info size={14} />
            <span>局域网连接不依赖任何服务器；邀请码模式也仅通过你与对方之间的通道交换信令。</span>
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-title">
            <span className="settings-icon"><ShieldCheck size={16} /></span>
            <div>
              <h2>系统权限</h2>
              <p>远程控制所需的系统授权</p>
            </div>
          </div>
          <div className="permission-row">
            <div className="permission-main">
              <span className={cn('status-pill', capabilities?.remoteInput ? 'ok' : 'warn')}>
                {capabilities?.remoteInput ? <Check size={12} /> : <Info size={12} />}
                {capabilities?.remoteInput ? '输入注入可用' : '输入注入不可用'}
              </span>
              <strong>鼠标与键盘控制</strong>
              <span className="permission-sub">
                后端：{capabilities?.backend ?? '未加载'} · 辅助功能：
                {capabilities?.accessibility === 'granted' ? '已授权' : '未授权'}
              </span>
            </div>
            {window.cdesk.env.isMac ? (
              <Button variant="secondary" size="sm" onClick={() => void requestAccess()}>
                授权辅助功能
              </Button>
            ) : null}
          </div>
          <div className="permission-row">
            <div className="permission-main">
              <span className={cn('status-pill', capabilities?.screen === 'denied' ? 'warn' : 'ok')}>
                {capabilities?.screen === 'denied' ? <Info size={12} /> : <Check size={12} />}
                屏幕录制
              </span>
              <strong>共享屏幕内容</strong>
              <span className="permission-sub">
                状态：{capabilities?.screen === 'denied' ? '未授权' : '已授权'} · 系统音频：
                {capabilities?.loopbackAudio ? '支持' : '不支持'}
              </span>
            </div>
            {capabilities?.screen === 'denied' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void window.cdesk.system.openPermission('screen')}
              >
                前往系统设置
              </Button>
            ) : null}
          </div>
          <div className="permission-row">
            <div className="permission-main">
              <span className="status-pill ok">
                <LockKeyhole size={12} /> 端到端加密
              </span>
              <strong>DTLS-SRTP 传输</strong>
              <span className="permission-sub">WebRTC 强制加密，所有会话密钥仅存在于两端</span>
            </div>
          </div>
        </section>

        <section className="card settings-card about-card">
          <div className="settings-title">
            <span className="settings-icon"><Sparkles size={16} /></span>
            <div>
              <h2>关于 cDesk</h2>
              <p>无服务器的点对点远程桌面</p>
            </div>
          </div>
          <div className="about-grid">
            <div><span>版本</span><strong>v{info?.version}</strong></div>
            <div><span>Electron</span><strong>{info?.electron}</strong></div>
            <div><span>Chromium</span><strong>{info?.chrome}</strong></div>
            <div><span>架构</span><strong>P2P / WebRTC</strong></div>
          </div>
          <div className="about-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={<ExternalLink size={13} />}
              onClick={() => void window.cdesk.app.openExternal('https://webrtc.org/')}
            >
              WebRTC 技术
            </Button>
            <Button variant="ghost" size="sm" icon={<BellRing size={13} />} onClick={() => void patchSettings({})}>
              检查更新
            </Button>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <KeyRound size={13} /> 所有设置保存在本机用户目录，不会上传
        <ChevronRight size={13} />
        <span>{info?.hostname}</span>
        <ArrowLeft size={13} className="rotate-180" />
      </div>
    </div>
  )
}
