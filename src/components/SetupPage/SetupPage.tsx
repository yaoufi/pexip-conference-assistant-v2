import { useEffect, useState } from 'react'
import './SetupPage.scss'

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface SetupPageProps {
  isFirstRun: boolean
  onConfigSaved: () => void
  onClose?: () => void
  authHeaders?: Record<string, string>
}

interface FormState {
  oidcIssuer: string
  oidcClientId: string
  oidcClientSecret: string
  oidcRedirectUri: string
  oidcScopes: string
  pexipMgrNode: string
  pexipOauth2ClientId: string
  sessionSecret: string
  privateKeyPem: string
}

const defaultForm: FormState = {
  oidcIssuer: '',
  oidcClientId: '',
  oidcClientSecret: '',
  oidcRedirectUri: '',
  oidcScopes: 'openid email profile groups',
  pexipMgrNode: '',
  pexipOauth2ClientId: '',
  sessionSecret: '',
  privateKeyPem: '',
}

export const SetupPage = ({ isFirstRun, onConfigSaved, onClose, authHeaders }: SetupPageProps): JSX.Element => {
  const [form, setForm] = useState<FormState>(defaultForm)
  const [hasPrivateKey, setHasPrivateKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [keyFileName, setKeyFileName] = useState('')

  useEffect(() => {
    if (!isFirstRun) {
      fetch(`${API_BASE}/admin/config`, { headers: authHeaders })
        .then(r => {
          if (r.status === 401) throw new Error('auth')
          return r.json()
        })
        .then(cfg => {
          setForm({
            oidcIssuer: cfg.oidcIssuer || '',
            oidcClientId: cfg.oidcClientId || '',
            oidcClientSecret: cfg.oidcClientSecret || '',
            oidcRedirectUri: cfg.oidcRedirectUri || '',
            oidcScopes: cfg.oidcScopes || 'openid email profile groups',
            pexipMgrNode: cfg.pexipMgrNode || '',
            pexipOauth2ClientId: cfg.pexipOauth2ClientId || '',
            sessionSecret: cfg.sessionSecret || '',
            privateKeyPem: '',
          })
          setHasPrivateKey(cfg.hasPrivateKey)
        })
        .catch(() => {})
    }
  }, [isFirstRun])

  const update = (field: keyof FormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setKeyFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      update('privateKeyPem', ev.target?.result as string)
    }
    reader.readAsText(file)
  }

  const handleTestOidc = async () => {
    if (!form.oidcIssuer) {
      setTestResult({ type: 'error', text: 'Enter an OIDC Issuer URL first.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`${API_BASE}/admin/test-oidc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ issuer: form.oidcIssuer }),
      })
      const data = await res.json()
      if (data.ok) {
        setTestResult({ type: 'success', text: `Connected to ${data.endpoints.issuer}` })
      } else {
        setTestResult({ type: 'error', text: data.error })
      }
    } catch (e: any) {
      setTestResult({ type: 'error', text: e.message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const payload: any = { ...form }
      if (!payload.privateKeyPem) delete payload.privateKeyPem
      if (!payload.sessionSecret || payload.sessionSecret === '********') delete payload.sessionSecret

      const res = await fetch(`${API_BASE}/admin/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok) {
        setMessage({ type: 'success', text: 'Configuration saved and applied.' })
        if (form.privateKeyPem) setHasPrivateKey(true)
        setTimeout(() => onConfigSaved(), 1200)
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save.' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="SetupPage">
      <div className="SetupCard">
        <div className="SetupCard__header">
          <h2>{isFirstRun ? 'Initial Setup' : 'SSO Configuration'}</h2>
          {isFirstRun && <p>Configure OIDC single sign-on for your Pexip deployment. You can also skip this and use basic authentication.</p>}
          {onClose && (
            <button className="SetupCard__close" onClick={onClose} aria-label="Close">&times;</button>
          )}
        </div>

        {message && (
          <div className={`SetupForm__message SetupForm__message--${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="SetupForm">
          <div className="SetupForm__section">
            <h3>Identity Provider (OIDC)</h3>
            <div className="SetupForm__field">
              <label>Issuer URL</label>
              <input
                type="url"
                placeholder="https://company.okta.com/oauth2/default"
                value={form.oidcIssuer}
                onChange={e => update('oidcIssuer', e.target.value)}
              />
              <span className="SetupForm__hint">The OIDC discovery endpoint base URL</span>
            </div>
            <div className="SetupForm__row">
              <button
                type="button"
                className="Btn Btn--ghost SetupForm__test"
                onClick={handleTestOidc}
                disabled={testing}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <span className={`SetupForm__testResult SetupForm__testResult--${testResult.type}`}>
                  {testResult.text}
                </span>
              )}
            </div>
            <div className="SetupForm__field">
              <label>Client ID</label>
              <input
                type="text"
                placeholder="Client ID from your identity provider"
                value={form.oidcClientId}
                onChange={e => update('oidcClientId', e.target.value)}
              />
            </div>
            <div className="SetupForm__field">
              <label>Client Secret</label>
              <input
                type="password"
                autoComplete="off"
                placeholder={form.oidcClientSecret === '********' ? '(unchanged)' : 'Client secret'}
                value={form.oidcClientSecret}
                onChange={e => update('oidcClientSecret', e.target.value)}
              />
            </div>
            <div className="SetupForm__field">
              <label>Redirect URI</label>
              <input
                type="url"
                placeholder={`https://your-domain${API_BASE}/auth/callback`}
                value={form.oidcRedirectUri}
                onChange={e => update('oidcRedirectUri', e.target.value)}
              />
              <span className="SetupForm__hint">Must match the redirect URI registered in your identity provider</span>
            </div>
            <div className="SetupForm__field">
              <label>Scopes</label>
              <input
                type="text"
                value={form.oidcScopes}
                onChange={e => update('oidcScopes', e.target.value)}
              />
            </div>
          </div>

          <div className="SetupForm__section">
            <h3>Pexip Management Node</h3>
            <div className="SetupForm__field">
              <label>Management Node FQDN</label>
              <input
                type="text"
                placeholder="pexip-mgmt.example.com"
                value={form.pexipMgrNode}
                onChange={e => update('pexipMgrNode', e.target.value)}
              />
            </div>
            <div className="SetupForm__field">
              <label>OAuth2 Client ID</label>
              <input
                type="text"
                placeholder="OAuth2 client ID from the Pexip management node"
                value={form.pexipOauth2ClientId}
                onChange={e => update('pexipOauth2ClientId', e.target.value)}
              />
              <span className="SetupForm__hint">Created under Platform &gt; OAuth2 Clients on the management node</span>
            </div>
            <div className="SetupForm__field">
              <label>Private Key (ES256 PEM)</label>
              <div className="SetupForm__fileUpload">
                <label className="Btn Btn--ghost SetupForm__fileBtn">
                  {keyFileName || (hasPrivateKey ? 'Replace key...' : 'Choose file...')}
                  <input type="file" accept=".pem,.key" onChange={handleFileSelect} hidden />
                </label>
                {hasPrivateKey && !form.privateKeyPem && (
                  <span className="SetupForm__keyStatus">Key uploaded</span>
                )}
                {form.privateKeyPem && (
                  <span className="SetupForm__keyStatus SetupForm__keyStatus--new">New key selected</span>
                )}
              </div>
              <textarea
                className="SetupForm__keyPaste"
                placeholder="Or paste PEM content here..."
                rows={3}
                value={form.privateKeyPem}
                onChange={e => update('privateKeyPem', e.target.value)}
              />
            </div>
          </div>

          <div className="SetupForm__actions">
            <button
              className="Btn Btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            {isFirstRun && onClose && (
              <button className="Btn Btn--ghost" onClick={onClose}>
                Skip — use basic auth
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
