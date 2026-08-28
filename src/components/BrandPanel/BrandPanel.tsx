import { PexipLogo } from '@pexip/components'
import type { PlatformStats } from '../../types'
import './BrandPanel.scss'

interface BrandPanelProps {
  vmrCount: number
  participantCount: number
  stats: PlatformStats | null
}

const formatNodeAddress = (addr: string): string => {
  const parts = addr.split('.')
  return parts.length >= 2 ? parts.slice(0, 2).join('.') + '…' : addr
}

const normalizeVendor = (vendor: string): string => {
  const v = vendor.toLowerCase()
  if (v.includes('chrome') || v.includes('firefox') || v.includes('safari') || v.includes('browser') || v.includes('web')) return 'Browser'
  if (v.includes('cisco') || v.includes('webex')) return 'Cisco'
  if (v.includes('teams') || v.includes('microsoft')) return 'Teams'
  if (v.includes('pexip')) return 'Pexip'
  if (v.includes('poly') || v.includes('polycom')) return 'Poly'
  if (v.includes('zoom')) return 'Zoom'
  if (v === '' || v === 'unknown') return 'Unknown'
  return vendor
}

export const BrandPanel = ({ vmrCount, participantCount, stats }: BrandPanelProps): JSX.Element => {
  const topNodes = stats?.nodeLoads.slice(0, 4) ?? []
  const maxNodeCount = topNodes.length > 0 ? topNodes[0].count : 1

  const topProtocols = stats ? Object.entries(stats.protocols).sort((a, b) => b[1] - a[1]).slice(0, 6) : []
  const topVendors = stats ? Object.entries(stats.vendors).sort((a, b) => b[1] - a[1]).slice(0, 6) : []

  return (
    <aside className="BrandPanel">
      {/* Header */}
      <div className="BrandPanel__brand">
        <PexipLogo className="BrandPanel__logo" />
        <div className="BrandPanel__divider" />
        <span className="BrandPanel__title">Conference Assistant</span>
        <p className="BrandPanel__subtitle">Real-time Pexip management</p>
      </div>

      {/* Summary counts */}
      <div className="BrandPanel__stats">
        <div className="BrandPanel__stat">
          <span>Active conferences</span>
          <strong>{vmrCount}</strong>
        </div>
        <div className="BrandPanel__stat">
          <span>Participants</span>
          <strong>{participantCount}</strong>
        </div>
        {stats != null && stats.lockedCount > 0 && (
          <div className="BrandPanel__stat">
            <span>Locked</span>
            <strong>{stats.lockedCount}</strong>
          </div>
        )}
        {stats != null && stats.mutedCount > 0 && (
          <div className="BrandPanel__stat">
            <span>Guests muted</span>
            <strong>{stats.mutedCount}</strong>
          </div>
        )}
        {stats != null && stats.newCount > 0 && (
          <div className="BrandPanel__stat BrandPanel__stat--accent">
            <span>New conferences</span>
            <strong>{stats.newCount}</strong>
          </div>
        )}
      </div>

      {/* Unencrypted calls warning */}
      {stats != null && stats.unencryptedCount > 0 && (
        <div className="BrandPanel__section">
          <div className="BrandPanel__warn-row">
            <span className="BrandPanel__warn-icon">⚠</span>
            <span>{stats.unencryptedCount} unencrypted call{stats.unencryptedCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Highlights */}
      {stats != null && (stats.longestRunning != null || stats.busiest != null) && (
        <div className="BrandPanel__section">
          <div className="BrandPanel__section-header"><span>Highlights</span></div>
          {stats.longestRunning != null && (
            <div className="BrandPanel__highlight">
              <span className="BrandPanel__highlight-label">Longest running</span>
              <span className="BrandPanel__highlight-name">{stats.longestRunning.name}</span>
              <span className="BrandPanel__highlight-value">{stats.longestRunning.duration}</span>
            </div>
          )}
          {stats.busiest != null && (
            <div className="BrandPanel__highlight">
              <span className="BrandPanel__highlight-label">Busiest</span>
              <span className="BrandPanel__highlight-name">{stats.busiest.name}</span>
              <span className="BrandPanel__highlight-value">{stats.busiest.count} participants</span>
            </div>
          )}
        </div>
      )}

      {/* Media node load */}
      {topNodes.length > 0 && (
        <div className="BrandPanel__section">
          <div className="BrandPanel__section-header"><span>Media Nodes</span></div>
          <div className="BrandPanel__nodes">
            {topNodes.map((n, i) => (
              <div key={i} className="BrandPanel__node">
                <span className="BrandPanel__node-name">{formatNodeAddress(n.address)}</span>
                <div className="BrandPanel__node-bar-wrap">
                  <div className="BrandPanel__node-bar" style={{ width: `${Math.round((n.count / maxNodeCount) * 100)}%` }} />
                </div>
                <span className="BrandPanel__node-count">{n.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol breakdown */}
      {topProtocols.length > 0 && (
        <div className="BrandPanel__section">
          <div className="BrandPanel__section-header"><span>Protocols</span></div>
          <div className="BrandPanel__chips">
            {topProtocols.map(([proto, count]) => (
              <span key={proto} className="BrandPanel__chip BrandPanel__chip--proto">
                {proto} <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Client/vendor breakdown */}
      {topVendors.length > 0 && (
        <div className="BrandPanel__section">
          <div className="BrandPanel__section-header"><span>Clients</span></div>
          <div className="BrandPanel__chips">
            {topVendors.map(([vendor, count]) => (
              <span key={vendor} className="BrandPanel__chip BrandPanel__chip--vendor">
                {normalizeVendor(vendor)} <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
