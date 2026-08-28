import { useEffect, useState } from 'react'
import {
  Box,
  BoxHeader,
  Button,
  FontVariant,
  Icon,
  IconTypes,
  Input,
  Modal,
  ModalCloseButton,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContent,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSection,
  Text,
  Tooltip,
  notificationToastSignal
} from '@pexip/components'
import type { InfinityClient, Participant } from '@pexip/infinity'
import { conferenceKey } from '../../constants'
import { TextInputDialog } from '../TextInputDialog/TextInputDialog'

import './Participants.scss'

interface ParticipantsProps {
  infinityClient: InfinityClient
  participants: Participant[]
  me: Participant | undefined
}

interface Option {
  id: string
  isDisabled?: boolean | undefined
  label: string
}

enum Action {
  NoAction = 'no-action',
  Admit = 'admit',
  SetSpotlight = 'set-spotlight',
  RemoveSpotlight = 'remove-spotlight',
  LowerHand = 'lower-hand',
  MuteAudio = 'mute-audio',
  UnmuteAudio = 'unmute-audio',
  MuteVideo = 'mute-video',
  UnmuteVideo = 'unmute-video',
  MakeHost = 'make-host',
  MakeGuest = 'make-guest',
  Disconnect = 'disconnect',
  Transfer = 'transfer',
  Message = 'message',
  SetPersonalLayout = 'set-personal-layout'
}

const LAYOUT_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: '1:0',    label: 'Speaker only' },
  { id: '1:7',    label: 'Speaker + 7 thumbnails' },
  { id: '1:21',   label: 'Speaker + 21 thumbnails' },
  { id: '2:21',   label: '2 speakers + 21 thumbnails' },
  { id: '1:33',   label: 'Speaker + 33 thumbnails' },
  { id: '2x2',    label: '2×2 grid' },
  { id: '3x3',    label: '3×3 grid' },
  { id: '4x4',    label: '4×4 grid' },
  { id: '5x5',    label: '5×5 grid' },
  { id: '5:7',    label: '5 speakers + 7 thumbnails' }
]

export const Participants = (props: ParticipantsProps): JSX.Element => {
  const [participants, setParticipants] = useState<Participant[]>()
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [directMsgParticipant, setDirectMsgParticipant] = useState<Participant | null>(null)
  const [transferParticipant, setTransferParticipant] = useState<Participant | null>(null)
  const [layoutParticipant, setLayoutParticipant] = useState<Participant | null>(null)
  const [selectedLayout, setSelectedLayout] = useState('1:7')

  useEffect(() => {
    if (props.me != null) {
      props.infinityClient
        .sendConferenceRequest({ path: 'participants', method: 'GET' })
        .then((response) => {
          if (response?.status === 200) {
            ;(response.data as any).result.forEach((user: any) => {
              const participant = props.participants.find((p) => p.uuid === user.uuid)
              if (participant) {
                ;(participant as any).overlayText = user.overlay_text
              }
            })
          }
          setParticipants(props.participants)
        })
        .catch((e) => { console.error(e) })
    }
  }, [props.participants])

  const createBodyCell = (content: JSX.Element | string, compact = false): JSX.Element => (
    <TableCell className={compact ? 'TableBodyCell CompactCell' : 'TableBodyCell'}>
      <Text variant="inherit" fontVariant={FontVariant.Body}>{content}</Text>
    </TableCell>
  )

  const createHeaderCell = (content: string, compact = false): JSX.Element => (
    <TableCell className={compact ? 'TableHeadCell CompactCell' : 'TableHeadCell'}>
      <TableHeadCell>
        <Text fontVariant={FontVariant.SmallBold} variant="inherit">{content}</Text>
      </TableHeadCell>
    </TableCell>
  )

  const createSelectCell = (participant: Participant): JSX.Element => {
    let options: Option[] = [{ id: Action.NoAction, isDisabled: true, label: 'More actions' }]

    if (participant.isWaiting) {
      options.push({ id: Action.Admit, label: 'Admit' })
    }
    if (participant.callType === 'video') {
      options.push({
        id: participant.isSpotlight ? Action.RemoveSpotlight : Action.SetSpotlight,
        label: participant.isSpotlight ? 'Remove spotlight' : 'Spotlight'
      })
    }
    if (participant.raisedHand) {
      options.push({ id: Action.LowerHand, label: 'Lower hand' })
    }
    if (props.me != null && props.me.uuid !== participant.uuid) {
      options.push({ id: Action.Message, label: 'Direct message' })
    }
    if (participant.protocol !== 'api') {
      options = options.concat([
        { id: participant.isMuted ? Action.UnmuteAudio : Action.MuteAudio, label: participant.isMuted ? 'Unmute audio' : 'Mute audio' },
        { id: participant.isCameraMuted ? Action.UnmuteVideo : Action.MuteVideo, label: participant.isCameraMuted ? 'Unmute video' : 'Mute video' }
      ])
    }
    if (props.me != null && props.me.uuid !== participant.uuid) {
      options.push({ id: participant.role === 'chair' ? Action.MakeGuest : Action.MakeHost, label: participant.role === 'chair' ? 'Make guest' : 'Make host' })
    }
    options.push({ id: Action.Transfer, label: 'Transfer' })
    options.push({ id: Action.SetPersonalLayout, label: 'Set personal layout' })
    if (props.me != null && props.me.uuid !== participant.uuid) {
        options.push({ id: Action.Disconnect, label: 'Disconnect' })
      }
    options.forEach((o) => { o.id = participant.uuid + '&' + o.id })

    return (
      <TableCell className="ActionsCell">
        <Select value={''} label={''} placeholder="Actions" onValueChange={onAction} options={options} />
      </TableCell>
    )
  }

  const onAction = (actionInfo: string): void => {
    const [participantUuid, action] = actionInfo.split('&')
    const participant = props.participants.find((p) => p.uuid === participantUuid)
    if (participant == null) return

    switch (action) {
      case Action.Admit: admit(participant); break
      case Action.SetSpotlight: spotlight(participant, true); break
      case Action.RemoveSpotlight: spotlight(participant, false); break
      case Action.LowerHand: lowerHand(participant); break
      case Action.MuteAudio: toggleMuteAudio(participant, true); break
      case Action.UnmuteAudio: toggleMuteAudio(participant, false); break
      case Action.MuteVideo: toggleMuteVideo(participant, true); break
      case Action.UnmuteVideo: toggleMuteVideo(participant, false); break
      case Action.MakeHost: changeRole(participant, 'chair'); break
      case Action.MakeGuest: changeRole(participant, 'guest'); break
      case Action.Disconnect: disconnect(participant); break
      case Action.Transfer: setTransferParticipant(participant); break
      case Action.Message: setDirectMsgParticipant(participant); break
      case Action.SetPersonalLayout: setLayoutParticipant(participant); break
      default: break
    }
  }

  const admit = (participant: Participant): void => {
    props.infinityClient.admit({ participantUuid: participant.uuid }).then(() => {
      notificationToastSignal.emit([{ message: `Admitted ${participant.displayName}` }])
    })
  }

  const spotlight = (participant: Participant, enable: boolean): void => {
    props.infinityClient.spotlight({ participantUuid: participant.uuid, enable }).then(() => {
      notificationToastSignal.emit([{ message: enable ? `Spotlighted ${participant.displayName}` : `Unspotlighted ${participant.displayName}` }])
    })
  }

  const lowerHand = (participant: Participant): void => {
    props.infinityClient.raiseHand({ participantUuid: participant.uuid, raise: false }).then(() => {
      notificationToastSignal.emit([{ message: `Lowered hand for ${participant.displayName}` }])
    })
  }

  const toggleMuteAudio = (participant: Participant, mute: boolean): void => {
    props.infinityClient.mute({ participantUuid: participant.uuid, mute }).then(() => {
      notificationToastSignal.emit([{ message: mute ? `Muted ${participant.displayName}` : `Unmuted ${participant.displayName}` }])
    })
  }

  const toggleMuteVideo = (participant: Participant, mute: boolean): void => {
    props.infinityClient.muteVideo({ participantUuid: participant.uuid, muteVideo: mute }).then(() => {
      notificationToastSignal.emit([{ message: mute ? `Disabled video for ${participant.displayName}` : `Enabled video for ${participant.displayName}` }])
    })
  }

  const changeRole = (participant: Participant, role: 'chair' | 'guest'): void => {
    props.infinityClient.setRole({ participantUuid: participant.uuid, role }).then(() => {
      notificationToastSignal.emit([{ message: `Set ${participant.displayName} to ${role}` }])
    })
  }

  const disconnect = (participant: Participant): void => {
    props.infinityClient.kick({ participantUuid: participant.uuid }).then(() => {
      notificationToastSignal.emit([{ message: `Disconnected ${participant.displayName}` }])
    })
  }

  const admitAll = (): void => {
    const waiting = participants?.filter((p) => p.isWaiting) ?? []
    if (waiting.length === 0) return
    waiting.forEach((p) => { props.infinityClient.admit({ participantUuid: p.uuid }).catch((e) => console.error(e)) })
    notificationToastSignal.emit([{ message: `Admitting all ${waiting.length} participants…` }])
  }

  const clearAllHands = (): void => {
    const raised = participants?.filter((p) => p.raisedHand) ?? []
    if (raised.length === 0) { notificationToastSignal.emit([{ message: 'No hands raised.' }]); return }
    raised.forEach((p) => { props.infinityClient.raiseHand({ participantUuid: p.uuid, raise: false }).catch((e) => console.error(e)) })
    notificationToastSignal.emit([{ message: `Lowering ${raised.length} hand(s)…` }])
  }

  const moveAllToWaitingRoom = async (): Promise<void> => {
    const currentVmr = localStorage.getItem(conferenceKey)
    const guests = participants?.filter((p) => p.role === 'guest' && !p.isWaiting) ?? []
    if (guests.length === 0) { notificationToastSignal.emit([{ message: 'No guests in the meeting.' }]); return }
    if (!currentVmr) return
    try {
      await props.infinityClient.lock({ lock: true })
      await new Promise(resolve => setTimeout(resolve, 1000))
      guests.forEach((p) => {
        props.infinityClient.sendConferenceRequest({ path: `participants/${p.uuid}/transfer`, method: 'POST', payload: { conference_alias: currentVmr, role: 'guest' } })
          .catch((e) => console.error(e))
      })
      notificationToastSignal.emit([{ message: 'Conference locked. Guests moved to lobby.' }])
    } catch (e) {
      console.error(e)
      notificationToastSignal.emit([{ message: 'Failed to secure room.' }])
    }
  }

  const applyPersonalLayout = async (participant: Participant, layout: string): Promise<void> => {
    const mixName = `main.!${participant.uuid}`
    try {
      if (layout === 'default') {
        await props.infinityClient.sendConferenceRequest({
          path: `video_mixes/${mixName}/delete`,
          method: 'POST',
          payload: {}
        })
      } else {
        await props.infinityClient.sendConferenceRequest({
          path: 'video_mixes/create',
          method: 'POST',
          payload: { mix_name: mixName }
        })
        await props.infinityClient.sendConferenceRequest({
          path: `video_mixes/${mixName}/configure`,
          method: 'POST',
          payload: { transform_layout: { layout } }
        })
      }
      notificationToastSignal.emit([{ message: `Personal layout set for ${participant.displayName}` }])
    } catch (e) {
      console.error(e)
      notificationToastSignal.emit([{ message: `Failed to set layout for ${participant.displayName}` }])
    }
  }

  const disconnectAllGuests = (): void => {
    const guests = participants?.filter((p) => p.role === 'guest') ?? []
    if (guests.length === 0) { notificationToastSignal.emit([{ message: 'No guests to disconnect.' }]); return }
    if (window.confirm(`Disconnect all ${guests.length} guests?`)) {
      guests.forEach((p) => { props.infinityClient.kick({ participantUuid: p.uuid }).catch((e) => console.error(e)) })
      notificationToastSignal.emit([{ message: 'Disconnecting all guests…' }])
    }
  }

  const participantsRows = participants?.map((participant) => (
    <TableRow key={participant.uuid}>
      {createBodyCell(participant.displayName ?? 'Unknown')}
      {createBodyCell(
        <Input
          type="text"
          className="OverlayText"
          onChange={(event: any) => {
            const overlayText = event.target.value
            props.infinityClient.setTextOverlay({ participantUuid: participant.uuid, text: overlayText })
            ;(participant as any).overlayText = overlayText
            setParticipants(JSON.parse(JSON.stringify(participants)))
          }}
          value={(participant as any).overlayText}
          label={''}
          name={''}
        />
      )}
      {createBodyCell(participant.role === 'chair' ? 'host' : 'guest', true)}
      {createBodyCell(participant.protocol, true)}
      {createBodyCell(participant.isWaiting ? <Tooltip text="Waiting"><Icon source={IconTypes.IconClock} /></Tooltip> : '-', true)}
      {createBodyCell(participant.isSpotlight ? <Tooltip text="Spotlighted"><Icon source={IconTypes.IconStar} /></Tooltip> : '-', true)}
      {createBodyCell(participant.raisedHand ? <Tooltip text="Hand raised"><Icon source={IconTypes.IconRaiseHand} /></Tooltip> : '-', true)}
      {createBodyCell(participant.isPresenting ? <Tooltip text="Presenting"><Icon source={IconTypes.IconPresentationOn} /></Tooltip> : '-', true)}
      {createBodyCell(
        !['audio', 'video'].includes(participant.callType) ? '-' :
        participant.isMuted
          ? <Tooltip text="Mic Off"><Icon source={IconTypes.IconMicrophoneOff} /></Tooltip>
          : <Tooltip text="Mic On"><Icon source={IconTypes.IconMicrophoneOn} /></Tooltip>,
        true
      )}
      {createBodyCell(
        participant.callType !== 'video' ? '-' :
        participant.isCameraMuted
          ? <Tooltip text="Camera Off"><Icon source={IconTypes.IconVideoOff} /></Tooltip>
          : <Tooltip text="Camera On"><Icon source={IconTypes.IconVideoOn} /></Tooltip>,
        true
      )}
      {createSelectCell(participant)}
    </TableRow>
  ))

  return (
    <>
      <Box className="Participants" colorScheme="light">
        <BoxHeader>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h3>Participants</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={admitAll}>Admit All</Button>
              <Button variant="secondary" onClick={moveAllToWaitingRoom}>Move All to Lobby</Button>
              <Button variant="secondary" onClick={disconnectAllGuests}>Disconnect Guests</Button>
              <Button variant="secondary" onClick={clearAllHands}>Lower All Hands</Button>
              <Button variant="secondary" onClick={() => setBroadcastOpen(true)}>Broadcast to All</Button>
            </div>
          </div>
        </BoxHeader>

        <div className="Container">
          <Table>
            <TableContent>
              <TableSection>
                <TableHead>
                  <TableRow>
                    {createHeaderCell('Display name')}
                    {createHeaderCell('Overlay text')}
                    {createHeaderCell('Role', true)}
                    {createHeaderCell('Protocol', true)}
                    {createHeaderCell('Waiting', true)}
                    {createHeaderCell('Spotlight', true)}
                    {createHeaderCell('Hand', true)}
                    {createHeaderCell('Presenting', true)}
                    {createHeaderCell('Audio', true)}
                    {createHeaderCell('Video', true)}
                    <TableCell className="TableHeadCell ActionsCell">
                      <TableHeadCell>
                        <Text fontVariant={FontVariant.SmallBold} variant="inherit">Actions</Text>
                      </TableHeadCell>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>{participantsRows}</TableBody>
              </TableSection>
            </TableContent>
          </Table>
        </div>
      </Box>

      {broadcastOpen && (
        <TextInputDialog
          title="Broadcast to All"
          label="Message"
          placeholder="Type your message…"
          onConfirm={(text) => {
            setBroadcastOpen(false)
            props.infinityClient.sendConferenceRequest({ path: 'message', method: 'POST', payload: { payload: text } })
              .then(() => { notificationToastSignal.emit([{ message: 'Broadcast sent.' }]) })
              .catch((e) => console.error(e))
          }}
          onCancel={() => setBroadcastOpen(false)}
        />
      )}

      {directMsgParticipant != null && (
        <TextInputDialog
          title={`Message to ${directMsgParticipant.displayName}`}
          label="Message"
          placeholder="Type your message…"
          onConfirm={(text) => {
            const p = directMsgParticipant
            setDirectMsgParticipant(null)
            props.infinityClient.sendConferenceRequest({ path: `participants/${p.uuid}/message`, method: 'POST', payload: { payload: text } })
              .then(() => { notificationToastSignal.emit([{ message: `Message sent to ${p.displayName}` }]) })
              .catch((e) => console.error(e))
          }}
          onCancel={() => setDirectMsgParticipant(null)}
        />
      )}

      {transferParticipant != null && (
        <TextInputDialog
          title={`Transfer ${transferParticipant.displayName}`}
          label="Destination alias or SIP URI"
          placeholder="e.g. meet.example.com"
          onConfirm={(target) => {
            const p = transferParticipant
            setTransferParticipant(null)
            props.infinityClient.sendConferenceRequest({
              path: `participants/${p.uuid}/transfer`, method: 'POST',
              payload: { conference_alias: target, role: 'guest', remote_display_name: p.displayName }
            }).then((response: any) => {
              if (response?.data?.result === false) {
                notificationToastSignal.emit([{ message: `Node could not route to ${target}.` }])
              } else {
                notificationToastSignal.emit([{ message: `Transferring ${p.displayName} to ${target}…` }])
              }
            }).catch((e) => console.error(e))
          }}
          onCancel={() => setTransferParticipant(null)}
        />
      )}

      {layoutParticipant != null && (
        <Modal isOpen className="PersonalLayoutDialog">
          <ModalCloseButton className="CloseButton" onClose={() => setLayoutParticipant(null)} />
          <h3>Personal layout — {layoutParticipant.displayName}</h3>
          <Select
            label="Layout"
            value={selectedLayout}
            options={LAYOUT_OPTIONS}
            onValueChange={(v) => setSelectedLayout(v)}
            isFullWidth
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <Button
              style={{ flex: 1 }}
              onClick={() => {
                const p = layoutParticipant
                setLayoutParticipant(null)
                applyPersonalLayout(p, selectedLayout)
              }}
            >
              Apply
            </Button>
            <Button variant="secondary" style={{ flex: 1 }} onClick={() => setLayoutParticipant(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
