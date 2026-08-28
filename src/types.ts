export type CallQuality = 'good' | 'fair' | 'poor' | 'unknown'

export interface MediaStream {
  type: string
  rx_codec: string
  tx_codec: string
  rx_resolution: string
  tx_resolution: string
  rx_bitrate: number
  tx_bitrate: number
  rx_packet_loss: number
  tx_packet_loss: number
  rx_jitter: number
  tx_jitter: number
  rx_fps: number
  tx_fps: number
}

export interface ParticipantMediaData {
  display_name: string
  streams: MediaStream[]
}

export interface NodeLoad {
  address: string
  count: number
}

export interface PlatformStats {
  unencryptedCount: number
  lockedCount: number
  mutedCount: number
  pinnedCount: number
  newCount: number
  longestRunning: { name: string; duration: string } | null
  busiest: { name: string; count: number } | null
  nodeLoads: NodeLoad[]
  protocols: Record<string, number>
  vendors: Record<string, number>
}
