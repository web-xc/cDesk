import koffi from 'koffi'
import { macKeycode } from './keymap'
import type { InjectableKey, InjectableMouse } from './win-backend'

const kCGHIDEventTap = 0

const MOUSE_EVENTS = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  moved: 5,
  leftDragged: 6,
  rightDragged: 7,
  otherDown: 25,
  otherUp: 26,
  otherDragged: 27
}

export function createMacBackend() {
  const cg = koffi.load(
    '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
  )
  const cf = koffi.load(
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation'
  )
  const CGPoint = koffi.struct('cdesk_CGPoint', { x: 'double', y: 'double' })

  const CGEventCreateMouseEvent = cg.func(
    'void *CGEventCreateMouseEvent(void *source, int mouseType, cdesk_CGPoint position, int mouseButton)'
  )
  const CGEventCreateKeyboardEvent = cg.func(
    'void *CGEventCreateKeyboardEvent(void *source, uint16 key, bool keyDown)'
  )
  const CGEventCreateScrollWheelEvent2 = cg.func(
    'void *CGEventCreateScrollWheelEvent2(void *source, int units, uint32 wheelCount, int wheel1, int wheel2, int wheel3)'
  )
  const CGEventKeyboardSetUnicodeString = cg.func(
    'void CGEventKeyboardSetUnicodeString(void *event, unsigned long length, str16 text)'
  )
  const CGEventPost = cg.func('void CGEventPost(int tap, void *event)')
  const CFRelease = cf.func('void CFRelease(void *obj)')

  function post(event: unknown): void {
    if (!event) return
    CGEventPost(kCGHIDEventTap, event)
    CFRelease(event)
  }

  let wheelRemainder = 0
  let button = 0

  return {
    name: 'darwin-coregraphics',
    mouse(msg: InjectableMouse): boolean {
      const point = { x: msg.absX, y: msg.absY }
      try {
        if (msg.kind === 'move') {
          post(CGEventCreateMouseEvent(null, MOUSE_EVENTS.moved, point, 0))
          return true
        }
        if (msg.kind === 'down') {
          button = msg.button
          const type =
            msg.button === 2
              ? MOUSE_EVENTS.rightDown
              : msg.button === 1
                ? MOUSE_EVENTS.otherDown
                : MOUSE_EVENTS.leftDown
          post(CGEventCreateMouseEvent(null, type, point, msg.button))
          return true
        }
        if (msg.kind === 'up') {
          const type =
            button === 2
              ? MOUSE_EVENTS.rightUp
              : button === 1
                ? MOUSE_EVENTS.otherUp
                : MOUSE_EVENTS.leftUp
          post(CGEventCreateMouseEvent(null, type, point, button))
          return true
        }
        if (msg.kind === 'wheel') {
          wheelRemainder += msg.delta / 120
          const lines = Math.trunc(wheelRemainder)
          wheelRemainder -= lines
          if (lines !== 0) {
            post(CGEventCreateScrollWheelEvent2(null, 1, 1, lines, 0, 0))
          }
          return true
        }
        return false
      } catch {
        return false
      }
    },
    key(msg: InjectableKey): boolean {
      const code = macKeycode(msg.code)
      if (code === undefined) return false
      try {
        post(CGEventCreateKeyboardEvent(null, code, msg.down))
        return true
      } catch {
        return false
      }
    },
    text(text: string): boolean {
      try {
        for (const ch of Array.from(text)) {
          if (ch === '\n') {
            post(CGEventCreateKeyboardEvent(null, 36, true))
            post(CGEventCreateKeyboardEvent(null, 36, false))
            continue
          }
          const down = CGEventCreateKeyboardEvent(null, 0, true)
          if (!down) continue
          CGEventKeyboardSetUnicodeString(down, ch.length, ch)
          post(down)
        }
        return true
      } catch {
        return false
      }
    }
  }
}
