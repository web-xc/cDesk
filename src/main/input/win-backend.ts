import koffi from 'koffi'
import { windowsExtended, windowsVk } from './keymap'

export interface InjectableMouse {
  kind: 'move' | 'down' | 'up' | 'wheel'
  /** 主屏幕原点为基准的逻辑像素坐标（与 Electron screen.getAllDisplays() 返回的 bounds 同体系） */
  absX: number
  absY: number
  button: number
  delta: number
}

export interface InjectableKey {
  down: boolean
  code: string
  key: string
}

const MOUSEEVENTF = {
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  XDOWN: 0x0080,
  XUP: 0x0100,
  WHEEL: 0x0800,
  ABSOLUTE: 0x8000,
  VIRTUALDESK: 0x4000
}

const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004

export function createWindowsBackend() {
  const user32 = koffi.load('user32.dll')

  const mouseEvent = user32.func(
    'void mouse_event(int32 dwFlags, int32 dx, int32 dy, int32 dwData, uintptr dwExtraInfo)'
  )
  const SetCursorPos = user32.func('int32 SetCursorPos(int32 x, int32 y)')
  const keybdEvent = user32.func(
    'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'
  )

  const KEYBDINPUT = koffi.struct('cdesk_KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })
  const MOUSEINPUT = koffi.struct('cdesk_MOUSEINPUT', {
    dx: 'int32',
    dy: 'int32',
    mouseData: 'uint32',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })
  const HARDWAREINPUT = koffi.struct('cdesk_HARDWAREINPUT', {
    uMsg: 'uint32',
    wParamL: 'uint16',
    wParamH: 'uint16'
  })
  const INPUT_UNION = koffi.union('cdesk_INPUT_UNION', {
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
    hi: HARDWAREINPUT
  })
  const INPUT = koffi.struct('cdesk_INPUT', {
    type: 'uint32',
    u: INPUT_UNION
  })
  const SendInput = user32.func(
    'uint32 __stdcall SendInput(uint32 cInputs, cdesk_INPUT *pInputs, int cbSize)'
  )

  const inputSize = koffi.sizeof(INPUT)
  let wheelRemainder = 0

  function absolute(px: number, py: number): void {
    // 使用 SetCursorPos：DPI 感知的绝对坐标（相对主屏幕原点，像素精度）
    SetCursorPos(Math.round(px), Math.round(py))
  }

  function sendUnicode(text: string): boolean {
    const units: number[] = []
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i))
    if (!units.length) return true
    const inputs: unknown[] = []
    for (const unit of units) {
      inputs.push({
        type: 1,
        u: { ki: { wVk: 0, wScan: unit, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } }
      })
      inputs.push({
        type: 1,
        u: {
          ki: {
            wVk: 0,
            wScan: unit,
            dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0
          }
        }
      })
    }
    try {
      const sent = SendInput(inputs.length, inputs as never, inputSize)
      return sent === inputs.length
    } catch {
      return false
    }
  }

  return {
    name: 'win32-sendinput',
    mouse(msg: InjectableMouse): boolean {
      const flag = msg.button === 2 ? 'RIGHT' : msg.button === 1 ? 'MIDDLE' : 'LEFT'
      switch (msg.kind) {
        case 'move':
          absolute(msg.absX, msg.absY)
          return true
        case 'down':
          absolute(msg.absX, msg.absY)
          if (flag === 'RIGHT') mouseEvent(MOUSEEVENTF.RIGHTDOWN, 0, 0, 0, 0)
          else if (flag === 'MIDDLE') mouseEvent(MOUSEEVENTF.MIDDLEDOWN, 0, 0, 0, 0)
          else mouseEvent(MOUSEEVENTF.LEFTDOWN, 0, 0, 0, 0)
          return true
        case 'up':
          if (flag === 'RIGHT') mouseEvent(MOUSEEVENTF.RIGHTUP, 0, 0, 0, 0)
          else if (flag === 'MIDDLE') mouseEvent(MOUSEEVENTF.MIDDLEUP, 0, 0, 0, 0)
          else mouseEvent(MOUSEEVENTF.LEFTUP, 0, 0, 0, 0)
          return true
        case 'wheel': {
          wheelRemainder += msg.delta
          const notches = Math.trunc(wheelRemainder / 120)
          wheelRemainder -= notches * 120
          if (notches !== 0) {
            mouseEvent(MOUSEEVENTF.WHEEL, 0, 0, Math.max(-1200, Math.min(1200, notches * 120)), 0)
          }
          return true
        }
        default:
          return false
      }
    },
    key(msg: InjectableKey): boolean {
      const vk = windowsVk(msg.code)
      if (!vk) return false
      let flags = 0
      if (windowsExtended(msg.code)) flags |= KEYEVENTF_EXTENDEDKEY
      if (!msg.down) flags |= KEYEVENTF_KEYUP
      try {
        keybdEvent(vk, 0, flags, 0)
        return true
      } catch {
        return false
      }
    },
    text(text: string): boolean {
      return sendUnicode(text)
    }
  }
}
