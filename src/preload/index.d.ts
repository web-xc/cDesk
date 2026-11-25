import type { CdeskApi } from '@shared/types'

declare global {
  interface Window {
    cdesk: CdeskApi
  }
}

export {}
