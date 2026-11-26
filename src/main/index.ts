import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { installDisplayMediaHandler, registerIpc } from './ipc'
import { getSettings } from './store'

// 强制开启高 DPI 感知（Per-Monitor V2），让 screen.getAllDisplays()
// 返回物理像素 bounds，配合 SetCursorPos 获得精确的输入注入
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let mainWindow: BrowserWindow | null = null

const isMac = process.platform === 'darwin'

function createMainWindow(): BrowserWindow {
  const settings = getSettings()
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : settings.theme

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: '#F4F7FC',
    title: 'cDesk',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 15 }
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  return win
}

function buildMenu(): Menu {
  if (!isMac) {
    return Menu.buildFromTemplate([
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      }
    ])
  }
  return Menu.buildFromTemplate([
    {
      label: 'cDesk',
      submenu: [
        { role: 'about', label: '关于 cDesk' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 cDesk' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出 cDesk' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'close', label: '关闭' }
      ]
    }
  ])
}

// 允许通过环境变量指定独立的数据目录（用于同机多实例调试 / 便携运行）
if (process.env['CDESK_USER_DATA']) {
  app.setPath('userData', process.env['CDESK_USER_DATA'])
}

const multiInstance = !!process.env['CDESK_MULTI'] && !!process.env['CDESK_USER_DATA']
const gotLock = multiInstance || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      mainWindow = createMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.cdesk.app')
    installDisplayMediaHandler()
    registerIpc()
    Menu.setApplicationMenu(buildMenu())
    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
