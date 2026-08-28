  import { useMemo, useState } from 'react'
  import { PinDialog } from '../PinDialog/PinDialog'
  import type { CallQuality, MediaStream, ParticipantMediaData } from '../../types'
  import './VmrList.scss'

  export interface Vmr {
    id: string
    name: string
    primaryAlias?: string
    hasPin: boolean
    isNew?: boolean
    participant_count: number
    service_type: string
    start_time: string
    is_locked: boolean
    guests_muted: boolean
    tag: string
  }

  type SortBy = 'participants' | 'duration' | 'name'

  interface VmrListProps {
    vmrs: Vmr[]
    onSelect: (vmr: Vmr) => void
    onToggleLock: (vmr: Vmr) => void
    onLogout: () => void
    confNode?: string | null
    onFetchQuality?: (confName: string) => Promise<ParticipantMediaData[]>
  }

  const startMs = (vmr: Vmr): number => {
    if (!vmr.start_time) return 0
    return new Date(vmr.start_time.replace(' ', 'T') + 'Z').getTime()
  }

  const formatDuration = (startTime: string): string => {
    if (!startTime) return '—'
    const normalized = startTime.replace(' ', 'T') + 'Z'
    const ms = Date.now() - new Date(normalized).getTime()
    if (isNaN(ms) || ms < 0) return '—'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const streamQuality = (s: MediaStream): CallQuality => {
    const rxL = s.rx_packet_loss ?? 0
    const txL = s.tx_packet_loss ?? 0
    const rxJ = s.rx_jitter ?? 0
    const txJ = s.tx_jitter ?? 0
    if (rxL > 3 || txL > 3 || rxJ > 60 || txJ > 60) return 'poor'
    if (rxL > 1 || txL > 1 || rxJ > 30 || txJ > 30) return 'fair'
    return 'good'
  }

  const qualityLabel: Record<CallQuality, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'Unknown' }

  const fmt = (v: number | string | null | undefined, suffix = ''): string => {
    if (v == null || v === '') return '—'
    return `${v}${suffix}`
  }

  const CODEC_LABELS: Record<string, string> = {
    off_stage: 'WebRTC',
    offstage: 'WebRTC',
    'off stage': 'WebRTC',
  }

  const fmtCodec = (v: string | null | undefined): string => {
    if (v == null || v === '') return '—'
    return CODEC_LABELS[v.toLowerCase()] ?? v
  }

  const fmtJitter = (v: number | null | undefined): string => {
    if (v == null) return '—'
    return `${Number(v).toFixed(3)}ms`
  }

  const QualityPanel = ({ data, loading }: { data: ParticipantMediaData[], loading: boolean }): JSX.Element => {
    if (loading) return <div className="QualityPanel__empty">Loading…</div>
    if (data.length === 0) return <div className="QualityPanel__empty">No data — click Refresh to fetch.</div>

    const rows: JSX.Element[] = []
    for (const p of data) {
      const videoStreams = p.streams.filter(s => s.type !== 'audio' && s.rx_resolution !== '')
      if (videoStreams.length === 0) continue
      videoStreams.forEach((s, i) => {
        const q = streamQuality(s)
        rows.push(
          <tr key={`${p.display_name}-${i}`}>
            {i === 0 && <td rowSpan={videoStreams.length} style={{ verticalAlign: 'middle' }}>{p.display_name}</td>}
            <td>{s.type === 'slides' || s.type === 'presentation' ? 'Presentation' : 'Video'}</td>
            <td>
              <span className={`QualityDot QualityDot--${q}`} />
              {qualityLabel[q]}
            </td>
            <td>{fmt(s.rx_resolution)}</td>
            <td>{fmt(s.tx_resolution)}</td>
            <td className={s.rx_packet_loss > 3 ? 'stat--poor' : s.rx_packet_loss > 1 ? 'stat--fair' : ''}>{fmt(s.rx_packet_loss, '%')}</td>
            <td className={s.tx_packet_loss > 3 ? 'stat--poor' : s.tx_packet_loss > 1 ? 'stat--fair' : ''}>{fmt(s.tx_packet_loss, '%')}</td>
            <td className={s.rx_jitter > 60 ? 'stat--poor' : s.rx_jitter > 30 ? 'stat--fair' : ''}>{fmtJitter(s.rx_jitter)}</td>
            <td className={s.tx_jitter > 60 ? 'stat--poor' : s.tx_jitter > 30 ? 'stat--fair' : ''}>{fmtJitter(s.tx_jitter)}</td>
            <td>{fmt(s.rx_bitrate, ' kbps')}</td>
            <td>{fmtCodec(s.rx_codec)}</td>
          </tr>
        )
      })
    }

    if (rows.length === 0) return <div className="QualityPanel__empty">No video streams found.</div>

    return (
      <table className="QualityTable">
        <thead>
          <tr>
            <th>Participant</th>
            <th>Stream</th>
            <th>Quality</th>
            <th>RX Res</th>
            <th>TX Res</th>
            <th>RX Loss</th>
            <th>TX Loss</th>
            <th>RX Jitter</th>
            <th>TX Jitter</th>
            <th>Bitrate</th>
            <th>Codec</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    )
  }

  export const VmrList = ({ vmrs, onSelect, onToggleLock, onLogout, confNode, onFetchQuality }: VmrListProps): JSX.Element => {
    const [previewState, setPreviewState] = useState<{ vmrId: string; pin: string } | null>(null)
    const [qualityVmrId, setQualityVmrId] = useState<string | null>(null)
    const [qualityData, setQualityData] = useState<Record<string, ParticipantMediaData[]>>({})
    const [qualityLoading, setQualityLoading] = useState(false)
    const [pinDialogVmr, setPinDialogVmr] = useState<Vmr | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [sortBy, setSortBy] = useState<SortBy>('participants')

    const displayedVmrs = useMemo(() => {
      const q = searchQuery.toLowerCase()
      const filtered = q
        ? vmrs.filter(v => v.name.toLowerCase().includes(q) || (v.primaryAlias ?? '').toLowerCase().includes(q))
        : vmrs
      return [...filtered].sort((a, b) => {
        if (sortBy === 'participants') return b.participant_count - a.participant_count
        if (sortBy === 'duration') return startMs(a) - startMs(b)
        return a.name.localeCompare(b.name)
      })
    }, [vmrs, searchQuery, sortBy])

    const buildPreviewUrl = (vmr: Vmr, pin: string): string => {
      const alias = vmr.primaryAlias ?? vmr.name
      const base = `https://${confNode}/?conference=${encodeURIComponent(alias)}&name=API-Preview&callType=AudioRecvVideoRecvPresentationRecv&join=1`
      return pin ? `${base}&pin=${encodeURIComponent(pin)}&role=host` : base
    }

    const handleToggleQuality = (vmr: Vmr): void => {
      if (qualityVmrId === vmr.id) { setQualityVmrId(null); return }
      setQualityVmrId(vmr.id)
      if (onFetchQuality != null) {
        setQualityLoading(true)
        onFetchQuality(vmr.name).then(data => {
          setQualityData(prev => ({ ...prev, [vmr.id]: data }))
          setQualityLoading(false)
        }).catch(() => setQualityLoading(false))
      }
    }

    const handleRefreshQuality = (vmr: Vmr): void => {
      if (onFetchQuality == null) return
      setQualityLoading(true)
      onFetchQuality(vmr.name).then(data => {
        setQualityData(prev => ({ ...prev, [vmr.id]: data }))
        setQualityLoading(false)
      }).catch(() => setQualityLoading(false))
    }

    const handlePreview = (vmr: Vmr): void => {
      if (previewState?.vmrId === vmr.id) { setPreviewState(null); return }
      if (vmr.hasPin) {
        const saved = localStorage.getItem(`pex-pin-${vmr.primaryAlias ?? vmr.name}`)
        if (saved) { setPreviewState({ vmrId: vmr.id, pin: saved }) }
        else { setPinDialogVmr(vmr) }
      } else {
        setPreviewState({ vmrId: vmr.id, pin: '' })
      }
    }

    return (
      <>
        <div className="VmrList">
          <div className="VmrList__header">
            <div className="VmrList__title-wrap">
              <span className="VmrList__title">Active Conferences</span>
              <span className="VmrList__count">{vmrs.length}</span>
            </div>
            <button className="Btn Btn--ghost" onClick={onLogout}>Sign Out</button>
          </div>

          <div className="VmrList__toolbar">
            <input
              className="VmrList__search"
              type="text"
              placeholder="Search conferences…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="VmrList__sort">
              {(['participants', 'duration', 'name'] as SortBy[]).map(s => (
                <button
                  key={s}
                  className={`VmrList__sort-btn${sortBy === s ? ' active' : ''}`}
                  onClick={() => setSortBy(s)}
                >
                  {s === 'participants' ? 'Participants' : s === 'duration' ? 'Duration' : 'Name'}
                </button>
              ))}
            </div>
          </div>

          {displayedVmrs.length === 0 ? (
            <div className="VmrList__empty">
              {searchQuery ? 'No conferences match your search.' : 'No active conferences found.'}
            </div>
          ) : (
            displayedVmrs.map((vmr) => {
              const isPreviewing = previewState?.vmrId === vmr.id
              const isShowingQuality = qualityVmrId === vmr.id
              return (
                <div key={vmr.id} className="VmrCard">
                  <div className="VmrCard__row">
                    <div className="VmrCard__left">
                      <div className="VmrCard__name-row">
                        <span className="VmrCard__name">{vmr.name}</span>
                        {vmr.isNew === true && <span className="Badge Badge--new">New</span>}
                        <span className={`Badge ${vmr.service_type === 'conference' ? 'Badge--conf' : 'Badge--other'}`}>
                          {vmr.service_type}
                        </span>
                        {vmr.is_locked && <span className="Badge Badge--locked">Locked</span>}
                        {vmr.guests_muted && <span className="Badge Badge--muted">Muted</span>}
                      </div>
                      <div className="VmrCard__meta">
                        {vmr.primaryAlias != null && (
                          <span className="VmrCard__alias">{vmr.primaryAlias}</span>
                        )}
                        <span className="VmrCard__stat">
                          {vmr.participant_count} participant{vmr.participant_count !== 1 ? 's' : ''}
                        </span>
                        <span className="VmrCard__stat">{formatDuration(vmr.start_time)}</span>
                      </div>
                    </div>

                    <div className="VmrCard__right">
                      {onFetchQuality != null && (
                        <button
                          className={`Btn Btn--ghost${isShowingQuality ? ' active' : ''}`}
                          onClick={() => handleToggleQuality(vmr)}
                        >
                          Quality
                        </button>
                      )}
                      {confNode != null && (
                        <button
                          className={`Btn Btn--ghost${isPreviewing ? ' active' : ''}`}
                          onClick={() => handlePreview(vmr)}
                        >
                          {isPreviewing ? 'Stop Preview' : 'Preview'}
                        </button>
                      )}
                      <button
                        className={`Btn ${vmr.is_locked ? 'Btn--unlock' : 'Btn--lock'}`}
                        onClick={() => onToggleLock(vmr)}
                      >
                        {vmr.is_locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button className="Btn Btn--primary" onClick={() => onSelect(vmr)}>
                        Join &amp; Manage
                      </button>
                    </div>
                  </div>

                  {isShowingQuality && (
                    <div className="VmrCard__quality-pane">
                      <div className="QualityPane__toolbar">
                        <span className="QualityPane__title">Media Streams</span>
                        <button className="Btn Btn--ghost" onClick={() => handleRefreshQuality(vmr)}>Refresh</button>
                      </div>
                      <QualityPanel data={qualityData[vmr.id] ?? []} loading={qualityLoading} />
                    </div>
                  )}

                  {isPreviewing && confNode != null && (
                    <div className="VmrCard__preview-pane">
                      <iframe
                        src={buildPreviewUrl(vmr, previewState!.pin)}
                        title={`Preview: ${vmr.name}`}
                        width="100%"
                        height="320px"
                        frameBorder="0"
                        allow="camera; microphone; display-capture; autoplay"
                      />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {pinDialogVmr != null && (
          <PinDialog
            vmrName={pinDialogVmr.name}
            onConfirm={(pin) => {
              const vmr = pinDialogVmr
              setPinDialogVmr(null)
              setPreviewState({ vmrId: vmr.id, pin })
            }}
            onCancel={() => setPinDialogVmr(null)}
          />
        )}
      </>
    )
  }
