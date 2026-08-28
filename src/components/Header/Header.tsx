import { Icon, IconTypes, PexipLogo } from '@pexip/components'
import './Header.scss'

interface HeaderProps {
  isConnected: boolean
  showSettings: boolean
  onDisconnectClick: () => void
  onSettingsClick: () => void
}

export const Header = ({ isConnected, showSettings, onDisconnectClick, onSettingsClick }: HeaderProps): JSX.Element => {
  return (
    <header className="AppHeader">
      <div className="AppHeader__left">
        <PexipLogo className="AppHeader__logo" />
        <span className="AppHeader__title">Conference Assistant</span>
      </div>
      <div className="AppHeader__right">
        {isConnected && (
          <button className="AppHeader__btn AppHeader__btn--danger" onClick={onDisconnectClick}>
            <Icon source={IconTypes.IconLeave} />
            Disconnect
          </button>
        )}
        {showSettings && (
          <button className="AppHeader__btn" onClick={onSettingsClick}>
            <Icon source={IconTypes.IconSettings} />
            Settings
          </button>
        )}
      </div>
    </header>
  )
}
