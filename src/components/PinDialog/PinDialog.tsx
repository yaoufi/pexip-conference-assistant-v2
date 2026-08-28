import { useEffect, useRef, useState } from 'react'
import { Button, Form, Input, Modal, ModalCloseButton } from '@pexip/components'

import './PinDialog.scss'

interface PinDialogProps {
  vmrName: string
  savedPin?: string
  onConfirm: (pin: string) => void
  onCancel: () => void
}

export const PinDialog = ({ vmrName, savedPin, onConfirm, onCancel }: PinDialogProps): JSX.Element => {
  const [pin, setPin] = useState(savedPin ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    onConfirm(pin)
  }

  return (
    <Modal isOpen={true} className="PinDialog">
      <ModalCloseButton className="CloseButton" onClose={onCancel} />
      <h2>Join &amp; Manage</h2>
      <p className="Subtitle">Enter the host PIN for <strong>{vmrName}</strong></p>
      <Form onSubmit={handleSubmit}>
        <div className="InputContainer">
          <Input
            ref={inputRef}
            type="password"
            label="Host PIN"
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        <div className="ButtonContainer">
          <Button type="submit">Join</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </Form>
    </Modal>
  )
}
