/** KeyboardEvent.code -> Windows Virtual-Key */
const WIN_VK: Record<string, number> = {
  KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45, KeyF: 0x46, KeyG: 0x47,
  KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4a, KeyK: 0x4b, KeyL: 0x4c, KeyM: 0x4d, KeyN: 0x4e,
  KeyO: 0x4f, KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52, KeyS: 0x53, KeyT: 0x54, KeyU: 0x55,
  KeyV: 0x56, KeyW: 0x57, KeyX: 0x58, KeyY: 0x59, KeyZ: 0x5a,
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77,
  F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b, F13: 0x7c, F14: 0x7d, F15: 0x7e,
  F16: 0x7f, F17: 0x80, F18: 0x81, F19: 0x82, F20: 0x83, F21: 0x84, F22: 0x85,
  F23: 0x86, F24: 0x87,
  Escape: 0x1b, Tab: 0x09, CapsLock: 0x14, Space: 0x20, Enter: 0x0d,
  Backspace: 0x08, Delete: 0x2e, Insert: 0x2d, Home: 0x24, End: 0x23,
  PageUp: 0x21, PageDown: 0x22,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
  AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c,
  ContextMenu: 0x5d, NumLock: 0x90, ScrollLock: 0x91, PrintScreen: 0x2c, Pause: 0x13,
  Minus: 0xbd, Equal: 0xbb, BracketLeft: 0xdb, BracketRight: 0xdd,
  Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Comma: 0xbc, Period: 0xbe,
  Slash: 0xbf, Backquote: 0xc0,
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadMultiply: 0x6a, NumpadDivide: 0x6f,
  NumpadDecimal: 0x6e, NumpadEnter: 0x0d
}

/** KeyboardEvent.code -> macOS virtual keycode (CGKeyCode) */
const MAC_KEYCODE: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9,
  KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17,
  Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24,
  Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30,
  KeyO: 31, KeyU: 32, BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37,
  KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44,
  KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51,
  Escape: 53, MetaLeft: 55, ShiftLeft: 56, CapsLock: 57, AltLeft: 58, ControlLeft: 59,
  ShiftRight: 60, AltRight: 61, ControlRight: 62, F17: 64, NumpadDecimal: 65,
  NumpadMultiply: 67, NumpadAdd: 69, NumLock: 71, NumpadDivide: 75, NumpadEnter: 76,
  NumpadSubtract: 78, F18: 79, F19: 80, NumpadEqual: 81,
  Numpad0: 82, Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86, Numpad5: 87,
  Numpad6: 88, Numpad7: 89, Numpad8: 91, Numpad9: 92,
  F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103, F13: 105, F16: 106,
  F14: 107, F10: 109, F12: 111, F15: 113, Home: 115, PageUp: 116, Delete: 117,
  F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122, ArrowLeft: 123, ArrowRight: 124,
  ArrowDown: 125, ArrowUp: 126, Insert: 114, Help: 114, ContextMenu: 110
}

const WIN_EXTENDED = new Set([
  'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
  'Insert', 'Delete', 'NumLock', 'NumpadDivide', 'NumpadEnter', 'PrintScreen',
  'ControlRight', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu'
])

export function windowsVk(code: string): number | undefined {
  return WIN_VK[code]
}

export function windowsExtended(code: string): boolean {
  return WIN_EXTENDED.has(code)
}

export function macKeycode(code: string): number | undefined {
  return MAC_KEYCODE[code]
}
