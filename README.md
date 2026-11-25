# cDesk

点对点远程桌面客户端。不依赖中转服务器，两台设备通过 WebRTC 直接建立加密连接；同一局域网自动发现，跨网络用可复制的邀请码完成握手。支持 Windows 与 macOS。

## 功能

- 屏幕共享与远程控制（鼠标、滚轮、键盘、中文输入）
- 多显示器切换、流畅 / 均衡 / 高清三档画质
- 6 位访问码鉴权，支持「仅观看」与「允许控制」切换
- 双向剪贴板同步、文件传输、会话内聊天
- 远程截图、会话录制、全屏、实时 FPS / 码率 / 延迟 / 分辨率统计
- 局域网 UDP 自动发现；跨网络邀请码 / 应答码离线信令
- 深色 / 浅色主题、开机启动、Windows/macOS 原生窗口行为

## 技术栈

- Electron 45 + React 19 + TypeScript 5.9 + Vite 7 + electron-vite
- WebRTC：屏幕视频轨 + 两个可靠 DataChannel（`ctl` / `file`），DTLS-SRTP 加密
- 信令：UDP 广播发现 + TCP 点对点交换 SDP/ICE；跨网络使用 deflate + base64url 邀请码
- 远程输入注入：koffi FFI 调用 Windows `SendInput` / mac CoreGraphics，无需 node-gyp 编译
- 状态管理 zustand，图标 lucide-react

## 环境要求

- Node.js 20+（建议 22），npm 10+
- Windows 10/11 x64，或 macOS 12+
- 打包 macOS 安装包需要 macOS 主机（appdmg 依赖系统 `hdiutil`）

## 本地开发

```bash
npm install
npm run dev
```

国内网络若 Electron 二进制下载失败，可先设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

类型检查：

```bash
npm run typecheck
```

## 打包 Windows

在 Windows 上执行：

```bash
npm ci
npm run dist:win
```

产物：

- `release/cDesk-<version>-x64-setup.exe`：NSIS 安装包（可选安装目录、桌面与开始菜单快捷方式）
- `release/win-unpacked/`：免安装版本，可直接运行 `cDesk.exe`

说明：

- 默认只构建 x64；Windows on ARM 可通过系统自带 x64 模拟运行。ARM 原生包需要在 ARM 主机上打包，否则会缺少 koffi 的 ARM 原生模块。
- 安装包未做代码签名，首次运行 SmartScreen 提示时选择「更多信息 → 仍要运行」。正式分发请配置代码签名证书。
- 国内网络可先设置 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 加速 Electron / NSIS 下载。

## 打包 macOS

必须在 macOS 上执行：

```bash
npm ci
npm run dist:mac:dmg
```

该命令会：

1. `npm run build` 构建渲染层与主进程
2. `electron-builder --mac --universal --dir` 生成通用架构（Intel + Apple Silicon）的 `release/mac-universal/cDesk.app`
3. 通过 appdmg 按 `build/dmg.json` 布局生成 `release/cDesk-<version>.dmg`

也可以使用 electron-builder 自带的 dmg 目标（按架构分别出包）：

```bash
npm run dist:mac
```

### 无 Mac 时用 GitHub Actions 出包

仓库内置 `.github/workflows/build-mac.yml`：在 GitHub Actions 页面选择「Build macOS DMG」→ Run workflow，结束后下载 `cDesk-macos-dmg` 产物。

### 签名与权限

- 未签名时首次打开需右键「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/cDesk.app`
- 正式签名需配置 Apple Developer ID：`CSC_LINK`、`CSC_KEY_PASSWORD`
- 首次运行需在「系统设置 → 隐私与安全性」中授予「屏幕录制」和「辅助功能」权限，应用内设置页提供跳转入口

## 使用

1. 被控端打开「允许远程控制」，获得 6 位访问码
2. 同一局域网：主控端在「局域网」列表中选择设备，输入访问码后连接
3. 跨网络：被控端生成邀请码发送给对方；对方粘贴邀请码后生成应答码；被控端粘贴应答码即完成握手
4. 连接建立后可切换显示器、画质，使用聊天、文件、剪贴板、截图与录制

## 网络与安全

- 局域网发现使用 UDP 广播（端口 38999），若系统防火墙拦截需放行
- 跨网络仅使用 STUN 做地址发现（可在设置中关闭），媒体与数据始终端到端直连
- 所有会话内容通过 DTLS-SRTP 加密传输，访问码用于二次授权

## 目录结构

```
src/
  main/            Electron 主进程（窗口、IPC、局域网信令、输入注入）
    input/         Windows / macOS 输入注入后端
  preload/         安全桥接 API
  renderer/        React 界面（主页、设置、远程会话）
  shared/          主进程与渲染层共享类型
build/             应用图标与 appdmg 配置
scripts/           图标生成与 macOS 打包脚本
.github/workflows/ macOS DMG 构建工作流
```

## 许可

MIT
