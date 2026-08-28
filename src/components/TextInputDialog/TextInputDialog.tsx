import { useEffect, useRef, useState } from 'react'
import { Button, Form, Input, Modal, ModalCloseButton } from '@pexip/components'
import './TextInputDialog.scss'

interface TextInputDialogProps {
  title: string
  label: string
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export const TextInputDialog = ({ title, label, placeholder, onConfirm, onCancel }: TextInputDialogProps): JSX.Element => {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (value.trim()) onConfirm(value.trim())
  }

  return (
    <Modal isOpen={true} className="TextInputDialog">
      <ModalCloseButton className="CloseButton" onClose={onCancel} />
      <h2>{title}</h2>
      <Form onSubmit={handleSubmit}>
        <div className="InputContainer">
          <Input
            ref={inputRef}
            type="text"
            label={label}
            placeholder={placeholder ?? ''}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="ButtonContainer">
          <Button type="submit" disabled={!value.trim()}>Confirm</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </Form>
    </Modal>
  )
}
