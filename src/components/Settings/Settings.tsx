import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, ModalCloseButton } from '@pexip/components'
import { adminPassKey, adminUserKey, displayNameKey, mgmtNodeKey } from '../../constants'

import './Settings.scss'

interface SettingsProps {
  onClose: () => void
}

export const Settings = (props: SettingsProps): JSX.Element => {
  const [mgmtNode, setMgmtNode] = useState('')
  const [adminUser, setAdminUser] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    setMgmtNode(localStorage.getItem(mgmtNodeKey) ?? '')
    setAdminUser(localStorage.getItem(adminUserKey) ?? '')
    setAdminPass(localStorage.getItem(adminPassKey) ?? '')
    setDisplayName(localStorage.getItem(displayNameKey) ?? '')
  }, [])

  const save = (event: any): void => {
    localStorage.setItem(mgmtNodeKey, event.target.mgmtNode.value)
    localStorage.setItem(adminUserKey, event.target.adminUser.value)
    localStorage.setItem(adminPassKey, event.target.adminPass.value)
    localStorage.setItem(displayNameKey, event.target.displayName.value)
    props.onClose()
  }

  return (
    <Modal isOpen={true} className="Settings">
      <ModalCloseButton className="CloseButton" onClose={props.onClose} />
      <h2>Settings</h2>
      <Form
        onSubmit={(e) => {
          e.preventDefault()
          save(e)
        }}
      >
        <div className="InputContainer">
          <Input
            type="text"
            required
            label="Management Node"
            placeholder="e.g. pexip-mgmt.example.com"
            name="mgmtNode"
            value={mgmtNode}
            onChange={(e) => setMgmtNode(e.target.value)}
          />
          <Input
            type="text"
            required
            label="Admin Username"
            placeholder="e.g. admin"
            name="adminUser"
            value={adminUser}
            onChange={(e) => setAdminUser(e.target.value)}
          />
          <Input
            type="password"
            required
            label="Admin Password"
            placeholder="Admin password"
            name="adminPass"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
          />
          <Input
            type="text"
            required
            label="Display Name"
            placeholder="e.g. Conference Assistant"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="ButtonContainer">
          <Button type="submit">Save</Button>
          <Button onClick={props.onClose}>Cancel</Button>
        </div>
      </Form>
    </Modal>
  )
}
