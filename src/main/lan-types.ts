export interface PeerFrom {
  id: string
  name: string
  os: string
  address?: string
}

export interface IncomingConnection {
  connId: string
  from: PeerFrom
}

export interface LanProfile {
  id: string
  name: string
  hosting: boolean
  version: string
}

export interface LaneMessage {
  t?: string
  app?: string
  id?: string
  name?: string
  os?: string
  platform?: string
  port?: number
  hosting?: boolean
  version?: string
  data?: unknown
}

export interface Peer {
  id: string
  name: string
  os: string
  platform: string
  address: string
  port: number
  hosting: boolean
  version: string
  lastSeen: number
}
