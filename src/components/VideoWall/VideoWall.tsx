import { useState } from 'react'
import type { Vmr } from '../VmrList/VmrList'
import './VideoWall.scss'

interface VideoWallProps {
  vmrs: Vmr[]
  confNode: string | null
  onBack: () => void
}

const formatDuration = (startTime: string): string => {
  const ms = Date.now() - new Date(startTime.replace(' ', 'T') + 'Z').getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const VideoWall = ({ vmrs, confNode, onBack }: VideoWallProps): JSX.Element => {
  const [activeTiles, setActiveTiles] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [muteAll, setMuteAll] = useState(true)

  const buildPreviewUrl = (vmr: Vmr): string | null => {
    if (!confNode) return null
    const alias = vmr.primaryAlias ?? vmr.name
    const pin = localStorage.getItem(`pex-pin-${alias}`) ?? ''
    const base = `https://${confNode}/?conference=${encodeURIComponent(alias)}&name=Wall-${encodeURIComponent(vmr.name.slice(0, 12))}&callType=AudioRecvVideoRecvPresentationRecv&join=1`
    return pin ? `${base}&pin=${encodeURIComponent(pin)}&role=host` : base
  }

  const startAll = () => {
    setActiveTiles(new Set(vmrs.map(v => v.id)))
  }

  const stopAll = () => {
    setActiveTiles(new Set())
    setExpandedId(null)
  }

  const toggleTile = (id: string) => {
    setActiveTiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (expandedId === id) setExpandedId(null)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const activeVmrs = vmrs.filter(v => activeTiles.has(v.id))
  const inactiveVmrs = vmrs.filter(v => !activeTiles.has(v.id))

  const cols = activeVmrs.length <= 1 ? 1
    : activeVmrs.length <= 4 ? 2
    : activeVmrs.length <= 9 ? 3
    : 4

  const expanded = expandedId ? vmrs.find(v => v.id === expandedId) : null
  const expandedUrl = expanded ? buildPreviewUrl(expanded) : null

  return (
    <div className="VideoWall">
      <div className="VideoWall__toolbar">
        <button className="Btn Btn--ghost" onClick={onBack}>&larr; Back to List</button>
        <div className="VideoWall__toolbar-center">
          <span className="VideoWall__count">{activeVmrs.length} / {vmrs.length} monitoring</span>
        </div>
        <div className="VideoWall__toolbar-right">
          <button className="Btn Btn--ghost" onClick={() => setMuteAll(prev => !prev)}>
            {muteAll ? 'Unmute All' : 'Mute All'}
          </button>
          {activeVmrs.length < vmrs.length && (
            <button className="Btn Btn--primary" onClick={startAll}>Monitor All</button>
          )}
          {activeVmrs.length > 0 && (
            <button className="Btn Btn--danger-ghost" onClick={stopAll}>Stop All</button>
          )}
        </div>
      </div>

      {expanded && expandedUrl && (
        <div className="VideoWall__expanded" onClick={() => setExpandedId(null)}>
          <div className="VideoWall__expanded-inner" onClick={e => e.stopPropagation()}>
            <div className="VideoWall__expanded-header">
              <span className="VideoWall__expanded-name">{expanded.name}</span>
              <span className="VideoWall__expanded-meta">
                {expanded.participant_count} participants &middot; {formatDuration(expanded.start_time)}
              </span>
              <button className="Btn Btn--ghost" onClick={() => setExpandedId(null)}>Close</button>
            </div>
            <div className="VideoWall__expanded-video">
              <iframe
                src={expandedUrl}
                title={expanded.name}
                width="100%"
                height="100%"
                frameBorder="0"
                allow="camera; microphone; display-capture; autoplay"
              />
            </div>
          </div>
        </div>
      )}

      <div className="VideoWall__grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {activeVmrs.map(vmr => {
          const url = buildPreviewUrl(vmr)
          return (
            <div key={vmr.id} className="VideoWall__tile">
              <div className="VideoWall__tile-video">
                {url && (
                  <iframe
                    src={url}
                    title={vmr.name}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    allow={`camera; microphone; display-capture; autoplay${muteAll ? '' : ''}`}
                  />
                )}
              </div>
              <div className="VideoWall__tile-overlay" onClick={() => setExpandedId(vmr.id)}>
                <div className="VideoWall__tile-top">
                  <span className="VideoWall__tile-live">LIVE</span>
                </div>
                <div className="VideoWall__tile-bottom">
                  <span className="VideoWall__tile-name">{vmr.name}</span>
                  <span className="VideoWall__tile-meta">
                    {vmr.participant_count} &middot; {formatDuration(vmr.start_time)}
                  </span>
                </div>
              </div>
              <button
                className="VideoWall__tile-stop"
                onClick={() => toggleTile(vmr.id)}
                title="Stop monitoring"
              >
                &times;
              </button>
            </div>
          )
        })}
      </div>

      {inactiveVmrs.length > 0 && (
        <div className="VideoWall__pending">
          <h4>Not monitoring ({inactiveVmrs.length})</h4>
          <div className="VideoWall__pending-list">
            {inactiveVmrs.map(vmr => (
              <div key={vmr.id} className="VideoWall__pending-item">
                <span>{vmr.name}</span>
                <span className="VideoWall__pending-meta">{vmr.participant_count} participants</span>
                <button className="Btn Btn--ghost Btn--sm" onClick={() => toggleTile(vmr.id)}>
                  Monitor
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
