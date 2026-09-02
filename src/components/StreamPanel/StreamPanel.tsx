import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import './StreamPanel.scss'

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface StreamPlayerProps {
  streamKey: string
  onClose: () => void
}

export const StreamPlayer = ({ streamKey, onClose }: StreamPlayerProps): JSX.Element => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'waiting' | 'error'>('connecting')
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hlsUrl = `${API_BASE}/hls/${streamKey}/index.m3u8`

  const tryConnect = () => {
    const video = videoRef.current
    if (!video) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl
      video.addEventListener('loadeddata', () => setStatus('live'), { once: true })
      video.addEventListener('error', () => {
        setStatus('waiting')
        retryRef.current = setTimeout(tryConnect, 3000)
      }, { once: true })
      video.play().catch(() => {})
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
      })
      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('live')
        video.play().catch(() => {})
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          hls.destroy()
          hlsRef.current = null
          setStatus('waiting')
          retryRef.current = setTimeout(tryConnect, 3000)
        }
      })
    } else {
      setStatus('error')
    }
  }

  useEffect(() => {
    tryConnect()
    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [streamKey])

  return (
    <div className="StreamPlayer">
      <div className="StreamPlayer__header">
        <div className="StreamPlayer__status">
          <span className={`StreamPlayer__dot StreamPlayer__dot--${status}`} />
          {status === 'live' && 'LIVE'}
          {status === 'connecting' && 'Connecting…'}
          {status === 'waiting' && 'Waiting for stream…'}
          {status === 'error' && 'Playback not supported'}
        </div>
        <button className="StreamPlayer__close" onClick={onClose}>Stop Stream</button>
      </div>
      <video
        ref={videoRef}
        className="StreamPlayer__video"
        autoPlay
        muted
        playsInline
        controls
      />
    </div>
  )
}
