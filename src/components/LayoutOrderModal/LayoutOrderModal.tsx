import { useEffect, useState, useRef, useCallback } from 'react'
import { Modal, ModalCloseButton, Button, Select, ToggleSwitch, notificationToastSignal } from '@pexip/components'
import type { InfinityClient, Participant } from '@pexip/infinity'

import './LayoutOrderModal.scss'

export interface PinningSnapshot {
  slots: (string | null)[]
  backfill: boolean
  viewSelf: boolean
  showReserved: boolean
  layoutCode: string
}

interface SlotDef {
  style?: React.CSSProperties
}

interface LayoutDef {
  name: string
  gridCols: string
  gridRows: string
  slotDefs: SlotDef[]
  hiddenSlots?: number
}

const LAYOUT_DEFS: Record<string, LayoutDef> = {
  '1:0': {
    name: 'Full Screen',
    gridCols: '1fr',
    gridRows: '1fr',
    slotDefs: [{}],
  },
  '4:0': {
    name: '2×2 Equal',
    gridCols: '1fr 1fr',
    gridRows: '1fr 1fr',
    slotDefs: Array.from({ length: 4 }, () => ({})),
  },
  '9:0': {
    name: '3×3 Equal',
    gridCols: 'repeat(3, 1fr)',
    gridRows: 'repeat(3, 1fr)',
    slotDefs: Array.from({ length: 9 }, () => ({})),
  },
  '16:0': {
    name: '4×4 Equal',
    gridCols: 'repeat(4, 1fr)',
    gridRows: 'repeat(4, 1fr)',
    slotDefs: Array.from({ length: 16 }, () => ({})),
  },
  '25:0': {
    name: '5×5 Equal',
    gridCols: 'repeat(5, 1fr)',
    gridRows: 'repeat(5, 1fr)',
    slotDefs: Array.from({ length: 25 }, () => ({})),
  },
  '1:7': {
    name: 'Speaker + 7',
    gridCols: 'repeat(7, 1fr)',
    gridRows: '3fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / -1' } },
      {}, {}, {}, {}, {}, {}, {},
    ],
  },
  '1:21': {
    name: 'Speaker + 21',
    gridCols: 'repeat(7, 1fr)',
    gridRows: '3fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / -1' } },
      {}, {}, {}, {}, {}, {}, {},
    ],
    hiddenSlots: 14,
  },
  '1:33': {
    name: 'Speaker + 33',
    gridCols: 'repeat(7, 1fr)',
    gridRows: '3fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / -1' } },
      {}, {}, {}, {}, {}, {}, {},
    ],
    hiddenSlots: 26,
  },
  '2:21': {
    name: '2 Speakers + 21',
    gridCols: 'repeat(14, 1fr)',
    gridRows: '3fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / 8', gridRow: '1' } },
      { style: { gridColumn: '8 / 15', gridRow: '1' } },
      { style: { gridColumn: '1 / 3', gridRow: '2' } },
      { style: { gridColumn: '3 / 5', gridRow: '2' } },
      { style: { gridColumn: '5 / 7', gridRow: '2' } },
      { style: { gridColumn: '7 / 9', gridRow: '2' } },
      { style: { gridColumn: '9 / 11', gridRow: '2' } },
      { style: { gridColumn: '11 / 13', gridRow: '2' } },
      { style: { gridColumn: '13 / 15', gridRow: '2' } },
    ],
    hiddenSlots: 14,
  },
  '5:7': {
    name: '5 + 7',
    gridCols: 'repeat(35, 1fr)',
    gridRows: '2fr 2fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / 13', gridRow: '1' } },
      { style: { gridColumn: '13 / 25', gridRow: '1' } },
      { style: { gridColumn: '25 / 36', gridRow: '1' } },
      { style: { gridColumn: '1 / 19', gridRow: '2' } },
      { style: { gridColumn: '19 / 36', gridRow: '2' } },
      { style: { gridColumn: '1 / 6', gridRow: '3' } },
      { style: { gridColumn: '6 / 11', gridRow: '3' } },
      { style: { gridColumn: '11 / 16', gridRow: '3' } },
      { style: { gridColumn: '16 / 21', gridRow: '3' } },
      { style: { gridColumn: '21 / 26', gridRow: '3' } },
      { style: { gridColumn: '26 / 31', gridRow: '3' } },
      { style: { gridColumn: '31 / 36', gridRow: '3' } },
    ],
  },
}

const LAYOUT_OPTIONS = Object.entries(LAYOUT_DEFS).map(([code, def]) => ({
  id: code,
  label: `${code} — ${def.name}`,
}))

function getLayoutDef(layoutCode: string | undefined): LayoutDef | null {
  if (!layoutCode) return null
  if (LAYOUT_DEFS[layoutCode]) return LAYOUT_DEFS[layoutCode]

  const parts = layoutCode.split(':')
  if (parts.length !== 2) return null
  const mainCount = parseInt(parts[0]) || 0
  const thumbCount = parseInt(parts[1]) || 0
  const total = mainCount + thumbCount
  if (total <= 0) return null

  if (thumbCount === 0) {
    const n = Math.ceil(Math.sqrt(mainCount))
    return {
      name: `${n}×${n} Grid`,
      gridCols: `repeat(${n}, 1fr)`,
      gridRows: `repeat(${Math.ceil(mainCount / n)}, 1fr)`,
      slotDefs: Array.from({ length: mainCount }, () => ({})),
    }
  }

  const visibleThumbs = Math.min(thumbCount, 7)
  return {
    name: `${mainCount} + ${thumbCount}`,
    gridCols: `repeat(${visibleThumbs}, 1fr)`,
    gridRows: '3fr 1fr',
    slotDefs: [
      { style: { gridColumn: '1 / -1' } },
      ...Array.from({ length: visibleThumbs }, () => ({})),
    ],
    hiddenSlots: thumbCount > visibleThumbs ? thumbCount - visibleThumbs : undefined,
  }
}

function compactSlots(arr: (string | null)[]): (string | null)[] {
  const filled = arr.filter((s): s is string => s !== null)
  return Array.from({ length: arr.length }, (_, i) => filled[i] ?? null)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LayoutOrderModalProps {
  infinityClient: InfinityClient
  participants: Participant[]
  currentLayout: string | undefined
  lastApplied: PinningSnapshot | null
  onApplied: (snapshot: PinningSnapshot | null) => void
  onClose: () => void
}

export const LayoutOrderModal = ({
  infinityClient,
  participants,
  currentLayout,
  lastApplied,
  onApplied,
  onClose,
}: LayoutOrderModalProps): JSX.Element => {
  const initialLayout =
    (currentLayout && getLayoutDef(currentLayout)) ? currentLayout :
    (lastApplied?.layoutCode && getLayoutDef(lastApplied.layoutCode)) ? lastApplied.layoutCode :
    ''
  const [selectedLayout, setSelectedLayout] = useState(initialLayout)

  const layoutDef = getLayoutDef(selectedLayout || undefined)
  const slotCount = layoutDef?.slotDefs.length ?? 0

  const [slots, setSlots] = useState<(string | null)[]>(() =>
    Array.from({ length: slotCount }, () => null)
  )
  const [backfill, setBackfill] = useState(true)
  const [viewSelf, setViewSelf] = useState(true)
  const [showReserved, setShowReserved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [foreignConfig, setForeignConfig] = useState<string | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragOverList, setDragOverList] = useState(false)

  const dragRef = useRef<{
    type: 'list' | 'slot'
    uuid: string
    slotIdx?: number
  } | null>(null)

  const pinnableParticipants = participants.filter(p => !p.isWaiting)
  const liveUuids = new Set(pinnableParticipants.map(p => p.uuid))

  const nameOf = useCallback(
    (uuid: string) => {
      const p = pinnableParticipants.find(pp => pp.uuid === uuid)
      return p?.displayName ?? uuid.slice(0, 8) + '…'
    },
    [pinnableParticipants]
  )

  const changeGridLayout = (newLayout: string) => {
    const pinned = slots.filter((s): s is string => s !== null)
    setSelectedLayout(newLayout)
    const newDef = getLayoutDef(newLayout)
    const newCount = newDef?.slotDefs.length ?? 0
    setSlots(Array.from({ length: newCount }, (_, i) => pinned[i] ?? null))
  }

  useEffect(() => {
    void fetchCurrentState()
  }, [])

  const fetchCurrentState = async () => {
    setLoading(true)
    try {
      const result: any = await infinityClient.sendConferenceRequest({
        path: 'get_pinning_config',
        method: 'GET',
        payload: {},
      })
      console.log('get_pinning_config response:', result)

      const configDict =
        result?.pinning_config_dict ?? result?.result?.pinning_config_dict ?? null
      const configName =
        result?.pinning_config ?? result?.result?.pinning_config ?? null

      if (configDict && configName) {
        setHasConfig(true)
        const dictName = configDict.name || configName
        if (dictName !== 'assistant_layout_order') {
          setForeignConfig(dictName)
        }

        const configSlots: any[] = configDict.slots || []
        const newSlots = Array.from({ length: slotCount }, (_, i) => {
          const groups: string[] = configSlots[i]?.layout_groups || []
          const pinned = groups.find(
            (g: string) => g.startsWith('!') && UUID_RE.test(g.slice(1))
          )
          if (pinned) {
            const uuid = pinned.slice(1).toLowerCase()
            return liveUuids.has(uuid) ? uuid : null
          }
          return null
        })
        setSlots(newSlots)
        setBackfill(configDict.backfill ?? true)
        setViewSelf(!(configDict.remove_self ?? false))
        const firstSlot = (configDict.slots || [])[0]
        setShowReserved(firstSlot?.show_reserved ?? false)
        setLoading(false)
        return
      }
    } catch (e) {
      console.warn(
        'get_pinning_config fetch failed, falling back to local state:',
        e
      )
    }

    if (lastApplied) {
      setHasConfig(true)
      if (lastApplied.layoutCode === selectedLayout) {
        const restored = lastApplied.slots.map(uuid =>
          uuid && liveUuids.has(uuid) ? uuid : null
        )
        setSlots(
          restored
            .slice(0, slotCount)
            .concat(
              Array.from(
                { length: Math.max(0, slotCount - restored.length) },
                () => null
              )
            )
        )
      } else {
        const uuids = lastApplied.slots.filter(
          (u): u is string => u !== null && liveUuids.has(u)
        )
        setSlots(
          Array.from({ length: slotCount }, (_, i) => uuids[i] ?? null)
        )
      }
      setBackfill(lastApplied.backfill)
      setViewSelf(lastApplied.viewSelf)
      setShowReserved(lastApplied.showReserved ?? false)
    }
    setLoading(false)
  }

  const filledSlots = slots.filter((s): s is string => s !== null)
  const pinnedSet = new Set(filledSlots)
  const unpinned = pinnableParticipants.filter(p => !pinnedSet.has(p.uuid))

  /* ---- Drag & Drop ---- */

  const onListDragStart = (e: React.DragEvent, uuid: string) => {
    dragRef.current = { type: 'list', uuid }
    e.dataTransfer.effectAllowed = 'move'
  }

  const onSlotDragStart = (e: React.DragEvent, slotIdx: number) => {
    const uuid = slots[slotIdx]
    if (!uuid) return
    dragRef.current = { type: 'slot', uuid, slotIdx }
    e.dataTransfer.effectAllowed = 'move'
  }

  const onSlotDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }

  const onSlotDragLeave = () => {
    setDragOverIdx(null)
  }

  const onSlotDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault()
    setDragOverIdx(null)
    const drag = dragRef.current
    if (!drag) return

    setSlots(prev => {
      const next = [...prev]
      if (drag.type === 'list') {
        const existingIdx = next.indexOf(drag.uuid)
        if (existingIdx >= 0) next[existingIdx] = null
        next[targetIdx] = drag.uuid
      } else if (drag.type === 'slot' && drag.slotIdx !== undefined) {
        if (drag.slotIdx !== targetIdx) {
          const temp = next[targetIdx]
          next[targetIdx] = next[drag.slotIdx]
          next[drag.slotIdx] = temp
        }
      }
      return compactSlots(next)
    })
    dragRef.current = null
  }

  const onListDragOver = (e: React.DragEvent) => {
    if (dragRef.current?.type === 'slot') {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverList(true)
    }
  }

  const onListDragLeave = () => {
    setDragOverList(false)
  }

  const onListDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverList(false)
    const drag = dragRef.current
    if (!drag || drag.type !== 'slot' || drag.slotIdx === undefined) return
    setSlots(prev => {
      const next = [...prev]
      next[drag.slotIdx!] = null
      return compactSlots(next)
    })
    dragRef.current = null
  }

  const removeFromSlot = (idx: number) => {
    setSlots(prev => {
      const next = [...prev]
      next[idx] = null
      return compactSlots(next)
    })
  }

  const onDragEnd = () => {
    dragRef.current = null
    setDragOverIdx(null)
    setDragOverList(false)
  }

  /* ---- Apply / Reset ---- */

  const applyConfig = async () => {
    const pinned = slots.filter((uuid): uuid is string => uuid !== null)
    if (pinned.length === 0) return
    const configSlots = pinned.map(uuid => ({
      layout_groups: [`!${uuid.toLowerCase()}`],
      show_reserved: showReserved,
    }))

    setBusy(true)
    try {
      // Switch the conference layout to match the selected grid
      if (selectedLayout) {
        await infinityClient.setLayout({
          transforms: { layout: selectedLayout as any },
        })
      }

      await infinityClient.sendConferenceRequest({
        path: 'set_pinning_config',
        method: 'POST',
        payload: {
          dynamic_pinning_config: {
            name: 'assistant_layout_order',
            slots: configSlots,
            backfill,
            remove_self: !viewSelf,
          },
        },
      })
      onApplied({
        slots: [...slots],
        backfill,
        viewSelf,
        showReserved,
        layoutCode: selectedLayout,
      })
      notificationToastSignal.emit([
        { message: `Layout set to ${selectedLayout}, pinned ${configSlots.length} participant(s)` },
      ])
      onClose()
    } catch (e) {
      console.error('Failed to set pinning config:', e)
      notificationToastSignal.emit([
        { message: 'Failed to apply layout arrangement' },
      ])
    }
    setBusy(false)
  }

  const clearConfig = async () => {
    setBusy(true)
    try {
      await infinityClient.sendConferenceRequest({
        path: 'set_pinning_config',
        method: 'POST',
        payload: { pinning_config: '' },
      })
      onApplied(null)
      notificationToastSignal.emit([
        { message: 'Layout arrangement cleared — back to voice switching' },
      ])
      onClose()
    } catch (e) {
      console.error('Failed to clear pinning config:', e)
      notificationToastSignal.emit([
        { message: 'Failed to reset layout arrangement' },
      ])
    }
    setBusy(false)
  }

  return (
    <Modal isOpen className="LayoutOrderModal">
      <ModalCloseButton className="CloseButton" onClose={onClose} />

      <div className="lo-header">
        <h3>Arrange layout</h3>
        <p className="lo-description">
          Drag participants into the grid. Position 1 is most prominent.
          Swap between cells to reorder.
        </p>
      </div>

      <div className="lo-layout-picker">
        <Select
          value={selectedLayout}
          label="Grid layout"
          isFullWidth
          onValueChange={changeGridLayout}
          options={LAYOUT_OPTIONS}
        />
      </div>

      {foreignConfig && (
        <div className="lo-notice">
          A pinning configuration <strong>{foreignConfig}</strong> from a
          theme or policy is currently active. Applying here replaces it.
        </div>
      )}

      {loading ? (
        <div className="lo-loading">Loading current arrangement&hellip;</div>
      ) : !layoutDef ? (
        <div className="lo-empty">
          Select a layout above to start arranging participants.
        </div>
      ) : (
        <>
          <div className="lo-main">
            <div className="lo-grid-wrapper">
              <div
                className="lo-grid"
                style={{
                  gridTemplateColumns: layoutDef.gridCols,
                  gridTemplateRows: layoutDef.gridRows,
                }}
              >
                {layoutDef.slotDefs.map((slotDef, idx) => {
                  const uuid = slots[idx]
                  const isDragOver = dragOverIdx === idx
                  return (
                    <div
                      key={idx}
                      className={[
                        'lo-cell',
                        uuid ? 'lo-cell--filled' : 'lo-cell--empty',
                        isDragOver ? 'lo-cell--dragover' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={slotDef.style}
                      draggable={!!uuid}
                      onDragStart={e => onSlotDragStart(e, idx)}
                      onDragOver={e => onSlotDragOver(e, idx)}
                      onDragLeave={onSlotDragLeave}
                      onDrop={e => onSlotDrop(e, idx)}
                      onDragEnd={onDragEnd}
                      title={uuid ? nameOf(uuid) : `Position ${idx + 1}`}
                    >
                      <span className="lo-cell-badge">{idx + 1}</span>
                      {uuid ? (
                        <>
                          <span className="lo-cell-name">
                            {nameOf(uuid)}
                          </span>
                          <button
                            className="lo-cell-remove"
                            onClick={() => removeFromSlot(idx)}
                            title="Remove"
                          >
                            &times;
                          </button>
                        </>
                      ) : (
                        <span className="lo-cell-hint">Drop here</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {layoutDef.hiddenSlots != null &&
                layoutDef.hiddenSlots > 0 && (
                  <div className="lo-hidden-note">
                    + {layoutDef.hiddenSlots} more voice-switched positions
                  </div>
                )}
            </div>

            <div
              className={[
                'lo-pool',
                dragOverList ? 'lo-pool--dragover' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragOver={onListDragOver}
              onDragLeave={onListDragLeave}
              onDrop={onListDrop}
            >
              <div className="lo-pool-title">
                Participants ({unpinned.length})
              </div>
              {unpinned.length === 0 ? (
                <div className="lo-pool-empty">
                  {filledSlots.length > 0
                    ? 'All participants pinned'
                    : 'No participants available'}
                </div>
              ) : (
                <ul className="lo-pool-list">
                  {unpinned.map(p => (
                    <li
                      key={p.uuid}
                      className="lo-pool-item"
                      draggable
                      onDragStart={e => onListDragStart(e, p.uuid)}
                      onDragEnd={onDragEnd}
                      title={p.displayName}
                    >
                      <span className="lo-pool-name">
                        {p.displayName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lo-options">
            <ToggleSwitch
              label="Fill remaining positions (voice-switched)"
              checked={backfill}
              onChange={() => setBackfill(b => !b)}
              name="backfill"
            />
            <ToggleSwitch
              label="Reserve slot when participant is absent"
              checked={showReserved}
              onChange={() => setShowReserved(r => !r)}
              name="showReserved"
            />
            <ToggleSwitch
              label="Show self in layout"
              checked={viewSelf}
              onChange={() => setViewSelf(v => !v)}
              name="viewSelf"
            />
          </div>

          <p className="lo-caveat">
            Pinning has no visible effect in Adaptive Composition or
            Teams-like layouts. Reset returns to voice switching.
          </p>
        </>
      )}

      <div className="lo-footer">
        <Button
          variant="danger"
          onClick={clearConfig}
          disabled={busy || !hasConfig}
        >
          Reset
        </Button>
        <div className="lo-footer-right">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={applyConfig} disabled={busy || filledSlots.length === 0}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  )
}
