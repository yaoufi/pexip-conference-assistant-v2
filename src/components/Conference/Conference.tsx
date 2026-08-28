import { useEffect, useState } from 'react'
import { Box, BoxHeader, Select, ToggleSwitch, Button, Input, notificationToastSignal } from '@pexip/components'
import type { Transforms, InfinityClient, ConferenceStatus, LayoutEvent, Participant } from '@pexip/infinity'
import { LayoutOrderModal, type PinningSnapshot } from '../LayoutOrderModal/LayoutOrderModal'

import './Conference.scss'

const layouts = [
  '1:0',
  '1:7',
  '1:21',
  '2:21',
  '1:33',
  '4:0',
  '9:0',
  '16:0',
  '25:0',
  '5:7'
] as const
type Layout = (typeof layouts)[number]

interface ConferenceProps {
  infinityClient: InfinityClient
  conferenceStatus: ConferenceStatus | undefined
  layoutStatus: LayoutEvent | undefined
  participants: Participant[]
}

export const Conference = (props: ConferenceProps): JSX.Element => {
  const [locked, setLocked] = useState(false)
  const [guestsMuted, setGuestMuted] = useState(false)
  const [overlayText, setOverlayText] = useState(false)
  const [layout, setLayout] = useState<Layout>()
  const [bannerMessage, setBannerMessage] = useState('')
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [lastPinning, setLastPinning] = useState<PinningSnapshot | null>(null)

  useEffect(() => {
    if (props.conferenceStatus != null) {
      if (props.conferenceStatus.locked !== locked) {
        setLocked(props.conferenceStatus.locked)
      }
      if (props.conferenceStatus.guestsMuted !== guestsMuted) {
        setGuestMuted(props.conferenceStatus.guestsMuted)
      }
    }
  }, [props.conferenceStatus])

  useEffect(() => {
    if (props.layoutStatus != null) {
      const newLayout = props.layoutStatus.requested_layout.primary_screen.chair_layout
      if (newLayout !== layout) {
        setLayout(newLayout as Layout)
      }
      const newOverlayText = props.layoutStatus.overlay_text_enabled
      if (newOverlayText != null && newOverlayText !== overlayText) {
        setOverlayText(newOverlayText)
      }
    }
  }, [props.layoutStatus])

  const onToggleLockConference = (): void => {
    props.infinityClient
      .lock({
        lock: !locked
      })
      .catch((e) => {
        console.error(e)
      })
    setLocked(!locked)
  }

  const onToggleMuteGuests = (): void => {
    props.infinityClient
      .muteAllGuests({
        mute: !guestsMuted
      })
      .catch((e) => {
        console.error(e)
      })
    setGuestMuted(!guestsMuted)
  }

  const onToggleOverlayText = (): void => {
    const newOverlayText = !overlayText
    onChangeLayout(layout as string, newOverlayText)
    setOverlayText(newOverlayText)
  }

  const onChangeLayout = (id: string, enableOverlayText = overlayText): void => {
    const layout = id as Layout
    let transforms: Transforms
    if (layout != null && (layout as any) !== 'default') {
      transforms = { layout, enable_overlay_text: enableOverlayText }
    } else {
      transforms = { enable_overlay_text: enableOverlayText }
    }
    props.infinityClient
      .setLayout({
        transforms
      })
      .catch((e) => {
        console.error(e)
      })
    setLayout(layout)
  }

  const onSendBannerMessage = (): void => {
    props.infinityClient
      .sendConferenceRequest({
        path: 'set_message_text',
        method: 'POST',
        payload: {
          text: bannerMessage
        }
      })
      .then(() => {
        notificationToastSignal.emit([{ message: bannerMessage ? 'Banner message updated' : 'Banner message cleared' }])
      })
      .catch((e) => {
        console.error('Failed to set message text:', e)
      })
  }

  const onClearBannerMessage = (): void => {
    setBannerMessage('')
    props.infinityClient
      .sendConferenceRequest({
        path: 'set_message_text',
        method: 'POST',
        payload: {
          text: ''
        }
      })
      .then(() => {
        notificationToastSignal.emit([{ message: 'Banner message cleared' }])
      })
      .catch((e) => {
        console.error('Failed to clear message text:', e)
      })
  }

  return (
    <Box className="Conference" colorScheme="light">
      <BoxHeader>
        <h3>Conference</h3>
      </BoxHeader>
      
      {/* SECTION 1: SECURITY TOGGLES */}
      <div className="Container">
        <div className="TogglesContainer">
          <ToggleSwitch
            label="Locked"
            onChange={onToggleLockConference}
            checked={locked}
            name={''}
            className="Toggle"
          />
          <ToggleSwitch
            label="All guest muted"
            onChange={onToggleMuteGuests}
            checked={guestsMuted}
            name={''}
            className="Toggle"
          />
        </div>
      </div>

      {/* SECTION 2: LAYOUT CONTROLS */}
      <hr className="Separator" />
      <div className="Container">
        <Select
          value={layout ?? ''}
          label={'Layout'}
          isFullWidth={true}
          onValueChange={onChangeLayout}
          options={[
            {
              id: 'default',
              label: 'Default'
            }
          ].concat(
            layouts.map((layout) => ({
              id: layout,
              label: layout
            }))
          )}
        />
        <Button
          variant="secondary"
          onClick={() => setArrangeOpen(true)}
          style={{ width: '100%' }}
        >
          Arrange Layout Order
        </Button>
        <div className="TogglesContainer">
          <ToggleSwitch
            label="Overlay text"
            onChange={onToggleOverlayText}
            checked={overlayText}
            name={''}
            className="Toggle"
          />
        </div>
      </div>

      {/* SECTION 3: VIDEO BANNER */}
      <hr className="Separator" />
      <div className="Container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Input
            label="Video Banner"
            placeholder="Type message for video..."
            value={bannerMessage}
            onChange={(e: any) => setBannerMessage(e.target.value)}
            name="bannerMessage"
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button 
              onClick={onSendBannerMessage}
              style={{ flex: 1 }}
            >
              Set
            </Button>
            <Button 
              onClick={onClearBannerMessage}
              variant="secondary"
              style={{ flex: 1 }}
            >
              Clear
            </Button>
          </div>
        </div>
      </div>
      {arrangeOpen && (
        <LayoutOrderModal
          infinityClient={props.infinityClient}
          participants={props.participants}
          currentLayout={layout}
          lastApplied={lastPinning}
          onApplied={setLastPinning}
          onClose={() => setArrangeOpen(false)}
        />
      )}
    </Box>
  )
}