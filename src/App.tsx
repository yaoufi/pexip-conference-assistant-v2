import { useEffect, useRef, useState } from 'react'

  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

  import { Header } from './components/Header/Header'
  import { NotificationToast, Spinner, ThemeProvider } from '@pexip/components'
  import { Conference } from './components/Conference/Conference'
  import { Participants } from './components/Participants/Participants'
  import { Settings } from './components/Settings/Settings'
  import { VmrPreview } from './components/VmrPreview/VmrPreview'
  import { VmrList, type Vmr } from './components/VmrList/VmrList'
  import { PinDialog } from './components/PinDialog/PinDialog'
  import { BrandPanel } from './components/BrandPanel/BrandPanel'
  import type { PlatformStats, NodeLoad, ParticipantMediaData } from './types'
  import { adminPassKey, adminUserKey, conferenceKey, directNodeKey, directVmrKey, displayNameKey, hostPinKey, mgmtNodeKey, nodeKey, authMethodKey } from './constants'
  import {
    ClientCallType,
    type InfinityClient,
    createCallSignals,
    createInfinityClient,
    createInfinityClientSignals,
    type ExtendedInfinityErrorCode,
    type Participant,
    type LayoutEvent,
    type ConferenceStatus
  } from '@pexip/infinity'

  import './App.scss'
  import { ErrorPanel } from './components/ErrorPanel/ErrorPanel'
  import { VideoWall } from './components/VideoWall/VideoWall'
  import { SetupPage } from './components/SetupPage/SetupPage'

  enum AppMode {
    None,
    Management,
    Direct
  }

  enum AppState {
    Disconnected,
    Connecting,
    Authenticated,
    Connected,
    Error
  }

  let infinityClient: InfinityClient

  const infinityClientSignals = createInfinityClientSignals([
    'onError',
    'onDisconnected',
    'onConnected',
    'onConferenceStatus',
    'onLayoutUpdate',
    'onParticipants',
    'onMe'
  ])
  const callSignals = createCallSignals([])

  export const App = (): JSX.Element => {
    const [appMode, setAppMode] = useState<AppMode>(AppMode.None)
    const appModeRef = useRef<AppMode>(AppMode.None)
    const [appState, setAppState] = useState<AppState>(AppState.Disconnected)
    const [settingsOpened, setSettingsOpened] = useState<boolean>(false)
    const [error, setError] = useState('')
    const [loginMgmtNode, setLoginMgmtNode] = useState(() => localStorage.getItem(mgmtNodeKey) ?? '')
    const [loginAdminUser, setLoginAdminUser] = useState(() => localStorage.getItem(adminUserKey) ?? '')
    const [loginAdminPass, setLoginAdminPass] = useState('')
    const [loginDisplayName, setLoginDisplayName] = useState(() => localStorage.getItem(displayNameKey) ?? '')
    const [directNode, setDirectNode] = useState(() => localStorage.getItem(directNodeKey) ?? '')
    const [directVmr, setDirectVmr] = useState(() => localStorage.getItem(directVmrKey) ?? '')
    const [directDisplayName, setDirectDisplayName] = useState(() => localStorage.getItem(displayNameKey) ?? '')
    const [directPin, setDirectPin] = useState('')
    const [conferenceStatus, setConferenceStatus] = useState<ConferenceStatus>()
    const [layoutStatus, setLayoutStatus] = useState<LayoutEvent>()
    const [participants, setParticipants] = useState<Participant[]>([])
    const [me, setMe] = useState<Participant>()
    const [vmrs, setVmrs] = useState<Vmr[]>([])
    const [confNode, setConfNode] = useState<string | null>(null)
    const [pendingVmr, setPendingVmr] = useState<Vmr | null>(null)
    const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null)
    const [connectedNode, setConnectedNode] = useState('')
    const [connectedConference, setConnectedConference] = useState('')
    const [connectedPin, setConnectedPin] = useState('')
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const vmrAliasMap = useRef<Map<string, { alias: string, hasPin: boolean }>>(new Map())
    const confParticipantsRef = useRef<Record<string, { id: string, display_name: string }[]>>({})
    const nodeIpToHostname = useRef<Map<string, string>>(new Map())
    const seenVmrIds = useRef<Set<string>>(new Set())
    const newVmrTimestamps = useRef<Map<string, number>>(new Map())
    const [showVideoWall, setShowVideoWall] = useState(false)
    const [authMethod, setAuthMethod] = useState<'basic' | 'oidc'>(() => (localStorage.getItem(authMethodKey) as any) ?? 'basic')
    const [oidcUser, setOidcUser] = useState<{ name: string; email: string } | null>(null)
    const [oidcAvailable, setOidcAvailable] = useState(false)
    const [oidcMgrNode, setOidcMgrNode] = useState('')
    const [authError, setAuthError] = useState('')
    const [showSetupPage, setShowSetupPage] = useState(false)
    const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

    const getAuthHeaders = (): Record<string, string> => {
      return {}
    }

    const getMgmtNode = (): string => {
      if (authMethod === 'oidc') return oidcMgrNode
      return localStorage.getItem(mgmtNodeKey) ?? ''
    }

    useEffect(() => {
      localStorage.removeItem(adminPassKey)

      const params = new URLSearchParams(window.location.search)
      const err = params.get('auth_error')
      if (err) {
        setAuthError(err)
        window.history.replaceState({}, '', window.location.pathname)
      }

      fetch(`${API_BASE}/admin/status`).then(r => r.json()).then(status => {
        setNeedsSetup(!status.configured)
      }).catch(() => setNeedsSetup(false))

      fetch(`${API_BASE}/auth/config`).then(r => r.json()).then(cfg => {
        setOidcAvailable(cfg.oidcEnabled)
        if (cfg.pexipMgrNode) setOidcMgrNode(cfg.pexipMgrNode)
      }).catch(() => {})

      fetch(`${API_BASE}/auth/me`).then(r => r.json()).then(data => {
        if (data.authenticated && data.user) {
          if (data.user.authMethod === 'oidc') {
            setOidcUser(data.user)
            setAuthMethod('oidc')
            localStorage.setItem(authMethodKey, 'oidc')
          } else if (data.user.authMethod === 'basic') {
            setAuthMethod('basic')
            localStorage.setItem(authMethodKey, 'basic')
            if (data.user.name) setLoginAdminUser(data.user.name)
            if (data.mgmtNode) localStorage.setItem(mgmtNodeKey, data.mgmtNode)
            setAppMode(AppMode.Management)
            appModeRef.current = AppMode.Management
            authenticate().catch(console.error)
          }
        }
      }).catch(() => {})
    }, [])

    useEffect(() => {
      if (oidcUser && oidcMgrNode && appState === AppState.Disconnected) {
        setAppMode(AppMode.Management)
        appModeRef.current = AppMode.Management
        authenticate().catch(console.error)
      }
    }, [oidcUser, oidcMgrNode])

    useEffect(() => {
      const disconnectBrowserClosed = (): void => {
        infinityClient?.disconnect({ reason: 'Browser closed' }).catch((e) => {
          console.error(e)
        })
      }

      const onError = (e: { error: string; errorCode: ExtendedInfinityErrorCode }): void => {
        setAppState(AppState.Error)
        setError(e.error)
      }

      const onConnected = (): void => {
        setAppState(AppState.Connected)
      }

      const onDisconnected = (): void => {
        if (appModeRef.current === AppMode.Direct) {
          setAppState(AppState.Disconnected)
        } else {
          setAppState(AppState.Authenticated)
        }
      }

      const onConferenceStatus = (event: { id: string; status: ConferenceStatus }): void => {
        if (event.id === 'main') {
          setConferenceStatus(event.status)
        }
      }

      const onLayoutUpdate = (event: LayoutEvent): void => {
        setLayoutStatus(event)
      }

      const onParticipants = (event: { id: string; participants: Participant[] }): void => {
        if (event.id === 'main') {
          setParticipants(event.participants)
        }
      }

      const onMe = (event: { id: string; participant: Participant }): void => {
        if (event.id === 'main') {
          setMe(event.participant)
        }
      }

      window.addEventListener('beforeunload', disconnectBrowserClosed)
      infinityClientSignals.onError.add(onError)
      infinityClientSignals.onDisconnected.add(onDisconnected)
      infinityClientSignals.onConnected.add(onConnected)
      infinityClientSignals.onConferenceStatus.add(onConferenceStatus)
      infinityClientSignals.onLayoutUpdate.add(onLayoutUpdate)
      infinityClientSignals.onParticipants.add(onParticipants)
      infinityClientSignals.onMe.add(onMe)

      return () => {
        window.removeEventListener('beforeunload', disconnectBrowserClosed)
        infinityClientSignals.onError.remove(onError)
        infinityClientSignals.onDisconnected.remove(onDisconnected)
        infinityClientSignals.onConnected.remove(onConnected)
        infinityClientSignals.onConferenceStatus.remove(onConferenceStatus)
        infinityClientSignals.onLayoutUpdate.remove(onLayoutUpdate)
        infinityClientSignals.onParticipants.remove(onParticipants)
        infinityClientSignals.onMe.remove(onMe)
      }
    }, [])

    useEffect(() => {
      appModeRef.current = appMode
    }, [appMode])

    const isEncrypted = (enc: any): boolean => {
      if (enc == null) return true
      if (typeof enc === 'boolean') return enc
      const s = String(enc).toLowerCase()
      return s === 'on' || s === 'true' || s === '1' || s === 'encrypted'
    }

    const fetchVmrs = async (): Promise<void> => {
      const mgmtNode = getMgmtNode()
      if (!mgmtNode) return
      try {
        const [confRes, partRes] = await Promise.all([
          fetch(`${API_BASE}/bridge`, { headers: { 'x-pexip-url': `https://${mgmtNode}/api/admin/status/v1/conference/?limit=500` } }),
          fetch(`${API_BASE}/bridge`, { headers: { 'x-pexip-url': `https://${mgmtNode}/api/admin/status/v1/participant/?limit=500` } })
        ])
        if (!confRes.ok) return
        const confData = await confRes.json()

        const countMap = new Map<string, number>()

        let unencryptedCount = 0
        const nodeLoadMap = new Map<string, number>()
        const protocolMap = new Map<string, number>()
        const vendorMap = new Map<string, number>()

        if (partRes.ok) {
          const partData = await partRes.json()
          const newConfParticipants: Record<string, { id: string, display_name: string }[]> = {}
          for (const p of (partData.objects ?? [])) {
            const confName = p.conference_name ?? p.conference ?? p.service_name ?? ''
            countMap.set(confName, (countMap.get(confName) ?? 0) + 1)

            if (confName && p.id) {
              if (!newConfParticipants[confName]) newConfParticipants[confName] = []
              newConfParticipants[confName].push({ id: p.id, display_name: p.display_name ?? p.name ?? 'Unknown' })
            }

            if (!isEncrypted(p.encryption)) unencryptedCount++

            const nodeIp = p.media_node ?? p.media_node_address ?? ''
            const node = nodeIp ? (nodeIpToHostname.current.get(nodeIp) ?? nodeIp) : ''
            if (node) nodeLoadMap.set(node, (nodeLoadMap.get(node) ?? 0) + 1)

            const proto = (p.protocol ?? '').toUpperCase() || 'Unknown'
            if (proto) protocolMap.set(proto, (protocolMap.get(proto) ?? 0) + 1)

            const vendor = p.vendor ?? ''
            if (vendor) vendorMap.set(vendor, (vendorMap.get(vendor) ?? 0) + 1)
          }
          confParticipantsRef.current = newConfParticipants
        }

        const now = Date.now()
        const NEW_DURATION = 30000
        const isFirstPoll = seenVmrIds.current.size === 0

        const list = (confData.objects ?? []).map((v: any) => {
          const meta = vmrAliasMap.current.get(v.name)

          if (!isFirstPoll && !seenVmrIds.current.has(v.id)) {
            newVmrTimestamps.current.set(v.id, now)
          }
          seenVmrIds.current.add(v.id)

          const newTs = newVmrTimestamps.current.get(v.id)
          const isNew = newTs != null && (now - newTs) < NEW_DURATION

          return {
            ...v,
            participant_count: countMap.get(v.name) ?? 0,
            primaryAlias: meta?.alias,
            hasPin: meta?.hasPin ?? false,
            isNew
          }
        })
        setVmrs(list)

        const lockedCount = list.filter((v: any) => v.is_locked).length
        const mutedCount = list.filter((v: any) => v.guests_muted).length
        const pinnedCount = list.filter((v: any) => vmrAliasMap.current.get(v.name)?.hasPin).length
        const newCount = list.filter((v: any) => v.isNew).length

        let longestRunning: PlatformStats['longestRunning'] = null
        let busiest: PlatformStats['busiest'] = null

        if (list.length > 0) {
          const sorted = [...list].filter((v: any) => v.start_time)
            .sort((a: any, b: any) => {
              const toMs = (s: string) => new Date(s.replace(' ', 'T') + 'Z').getTime()
              return toMs(a.start_time) - toMs(b.start_time)
            })
          if (sorted.length > 0) {
            const v = sorted[0] as any
            const ms = now - new Date(v.start_time.replace(' ', 'T') + 'Z').getTime()
            const h = Math.floor(ms / 3600000)
            const m = Math.floor((ms % 3600000) / 60000)
            longestRunning = { name: v.name, duration: h > 0 ? `${h}h ${m}m` : `${m}m` }
          }
          const byPart = [...list].sort((a: any, b: any) => b.participant_count - a.participant_count)
          if (byPart[0]?.participant_count > 0) {
            busiest = { name: (byPart[0] as any).name, count: (byPart[0] as any).participant_count }
          }
        }

        const nodeLoads: NodeLoad[] = Array.from(nodeLoadMap.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([address, count]) => ({ address, count }))

        const protocols = Object.fromEntries(protocolMap)
        const vendors = Object.fromEntries(vendorMap)

        setPlatformStats({ unencryptedCount, lockedCount, mutedCount, pinnedCount, newCount, longestRunning, busiest, nodeLoads, protocols, vendors })
      } catch (e) {
        console.error('Failed to fetch VMR list', e)
      }
    }

    const startPolling = (): void => {
      fetchVmrs()
      pollingRef.current = setInterval(() => {
        fetchVmrs()
      }, 5000)
    }

    const stopPolling = (): void => {
      if (pollingRef.current != null) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    const fetchQuality = async (confName: string): Promise<ParticipantMediaData[]> => {
      const mgmtNode = getMgmtNode()
      const headers = getAuthHeaders()
      const participants = confParticipantsRef.current[confName] ?? []
      const results = await Promise.all(
        participants.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/bridge`, {
              headers: { ...headers, 'x-pexip-url': `https://${mgmtNode}/api/admin/status/v1/participant/${p.id}/media_stream/` }
            })
            if (!res.ok) return null
            const data = await res.json()
            return { display_name: p.display_name, streams: data.objects ?? [] } as ParticipantMediaData
          } catch {
            return null
          }
        })
      )
      return results.filter((r): r is ParticipantMediaData => r !== null)
    }

    const authenticate = async (): Promise<void> => {
      const mgmtNode = getMgmtNode()

      if (!mgmtNode) {
        if (authMethod === 'oidc') {
          setError('Server not configured with a Pexip management node. Set PEXIP_MGR_NODE on the server.')
        } else {
          alert('Please configure the management node credentials in Settings first.')
        }
        return
      }

      const headers = getAuthHeaders()
      setAppState(AppState.Connecting)

      try {
        const response = await fetch(`${API_BASE}/bridge`, {
          headers: {
            ...headers,
            'x-pexip-url': `https://${mgmtNode}/api/admin/configuration/v1/licence/`,
          }
        })

        if (response.status === 200) {
          const nodeRes = await fetch(`${API_BASE}/bridge`, {
            headers: {
              ...headers,
              'x-pexip-url': `https://${mgmtNode}/api/admin/configuration/v1/worker_vm/?limit=50`,
            }
          })
          if (nodeRes.ok) {
            const nodeData = await nodeRes.json()
            const ipMap = new Map<string, string>()
            for (const vm of (nodeData.objects ?? [])) {
              const hostname = vm.hostname && vm.domain ? `${vm.hostname}.${vm.domain}` : vm.hostname
              if (hostname && vm.address) ipMap.set(vm.address, hostname)
            }
            nodeIpToHostname.current = ipMap
            const confVm = (nodeData.objects ?? []).find((n: any) => n.node_type === 'CONFERENCING') ?? nodeData.objects?.[0]
            if (confVm) {
              const fqdn = confVm.hostname && confVm.domain
                ? `${confVm.hostname}.${confVm.domain}`
                : confVm.address
              if (fqdn) setConfNode(fqdn)
            }
          }
          try {
            const aliasRes = await fetch(`${API_BASE}/bridge`, {
              headers: {
                ...headers,
                'x-pexip-url': `https://${mgmtNode}/api/admin/configuration/v1/conference/?limit=500`,
              }
            })
            if (aliasRes.ok) {
              const aliasData = await aliasRes.json()
              const map = new Map<string, { alias: string, hasPin: boolean }>()
              for (const conf of (aliasData.objects ?? [])) {
                const first = conf.aliases?.[0]?.alias
                if (first != null) {
                  map.set(conf.name, { alias: first, hasPin: Boolean(conf.pin) })
                }
              }
              vmrAliasMap.current = map
            }
          } catch { /* non-fatal */ }

          setAppState(AppState.Authenticated)
          startPolling()
        } else {
          setError('Invalid credentials or management node unreachable.')
          setAppState(AppState.Error)
        }
      } catch (e) {
        setError('Could not reach the management node. Check the address and try again.')
        setAppState(AppState.Error)
      }
    }

    const connectDirect = async (): Promise<void> => {
      const node = directNode.trim()
      const vmr = directVmr.trim()
      const name = directDisplayName.trim() || 'Conference Assistant'

      localStorage.setItem(directNodeKey, node)
      localStorage.setItem(directVmrKey, vmr)
      localStorage.setItem(displayNameKey, name)

      setConnectedNode(node)
      setConnectedConference(vmr)
      setConnectedPin(directPin)

      appModeRef.current = AppMode.Direct
      setAppState(AppState.Connecting)

      try {
        infinityClient = createInfinityClient(infinityClientSignals, callSignals)
        await infinityClient.call({
          host: `https://${node}`,
          conferenceAlias: vmr,
          displayName: name,
          bandwidth: 1280,
          callType: ClientCallType.None,
          pin: directPin
        })
      } catch (e: any) {
        setError(e?.message ?? 'Failed to connect to the conference. Check the node address and try again.')
        setAppState(AppState.Error)
      }
    }

    const toggleLockVmr = async (vmr: Vmr): Promise<void> => {
      const mgmtNode = getMgmtNode()
      if (!mgmtNode) return

      const action = vmr.is_locked ? 'unlock' : 'lock'
      try {
        await fetch(`${API_BASE}/bridge`, {
          method: 'POST',
          headers: {
            'x-pexip-url': `https://${mgmtNode}/api/admin/command/v1/conference/${action}/`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ conference_id: vmr.id })
        })
        setVmrs((prev) => prev.map((v) => v.id === vmr.id ? { ...v, is_locked: !v.is_locked } : v))
      } catch (e) {
        console.error('Lock toggle failed:', e)
      }
    }

    const connectToVmr = async (vmr: Vmr, pin: string): Promise<void> => {
      const alias = vmr.primaryAlias ?? vmr.name
      const mgmtNode = localStorage.getItem(mgmtNodeKey)
      const displayName = localStorage.getItem(displayNameKey)

      if (mgmtNode == null || displayName == null) {
        alert('Missing configuration. Please check Settings.')
        return
      }

      if (pin) localStorage.setItem(`pex-pin-${alias}`, pin)

      const targetNode = confNode ?? mgmtNode
      localStorage.setItem(nodeKey, targetNode)
      localStorage.setItem(conferenceKey, alias)
      localStorage.setItem(hostPinKey, pin)

      setConnectedNode(targetNode)
      setConnectedConference(alias)
      setConnectedPin(pin)

      setAppState(AppState.Connecting)

      try {
        infinityClient = createInfinityClient(infinityClientSignals, callSignals)
        await infinityClient.call({
          host: `https://${targetNode}`,
          conferenceAlias: alias,
          displayName,
          bandwidth: 1280,
          callType: ClientCallType.None,
          pin
        })
      } catch (e: any) {
        console.error('Failed to join VMR:', e)
        setError(e?.message ?? 'Failed to connect to the conference. Check the PIN and try again.')
        setAppState(AppState.Error)
      }
    }

    const logout = (): void => {
      stopPolling()
      setVmrs([])
      setConfNode(null)
      seenVmrIds.current.clear()
      newVmrTimestamps.current.clear()
      nodeIpToHostname.current.clear()
      Object.keys(localStorage)
        .filter(k => k.startsWith('pex-pin-'))
        .forEach(k => localStorage.removeItem(k))
      if (authMethod === 'oidc') {
        fetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {})
        setOidcUser(null)
        localStorage.removeItem(authMethodKey)
      }
      setAppMode(AppMode.None)
      setAppState(AppState.Disconnected)
    }

    return (
      <div className="App">
        <ThemeProvider colorScheme="light">
          <NotificationToast timeout={3000} position="topCenter" />
          <Header
            isConnected={appState === AppState.Connected}
            showSettings={appState !== AppState.Disconnected && appMode === AppMode.Management}
            showSetup={true}
            onSetupClick={() => setShowSetupPage(true)}
            onDisconnectClick={() => {
              infinityClient?.disconnect({}).catch((e) => {
                console.error(e)
              })
              if (appMode === AppMode.Direct) {
                setAppState(AppState.Disconnected)
              } else {
                setAppState(AppState.Authenticated)
              }
            }}
            onSettingsClick={() => {
              setSettingsOpened(true)
            }}
          />

          <div className="PageContent">
            {appState === AppState.Disconnected && appMode === AppMode.None && (
              <div className="LoginScreen">
                <div className="ModeSelect">
                  <h2>Conference Assistant</h2>
                  <p>Choose how you want to connect</p>
                  <div className="ModeSelect__cards">
                    <button
                      className="ModeCard"
                      onClick={() => setAppMode(AppMode.Management)}
                    >
                      <div className="ModeCard__icon">&#9776;</div>
                      <h3>Management Node</h3>
                      <p>Connect with admin credentials to view and manage all active conferences across your Pexip platform.</p>
                    </button>
                    <button
                      className="ModeCard"
                      onClick={() => setAppMode(AppMode.Direct)}
                    >
                      <div className="ModeCard__icon">&#9654;</div>
                      <h3>Direct Conference</h3>
                      <p>Connect directly to a specific VMR on a conference node. No admin credentials required.</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {appState === AppState.Disconnected && appMode === AppMode.Management && (
              <div className="LoginScreen">
                <div className="LoginCard">
                  <h2>Management Node</h2>
                  {authError && (
                    <div className="LoginForm__error">{authError}</div>
                  )}

                  {oidcAvailable && (
                    <div className="LoginForm__oidc">
                      <p>Sign in with your organization account</p>
                      <button
                        className="Btn Btn--primary LoginForm__submit"
                        onClick={() => {
                          window.location.href = `${API_BASE}/auth/login`
                        }}
                      >
                        Sign in with SSO
                      </button>
                      <div className="LoginForm__divider">
                        <span>or use admin credentials</span>
                      </div>
                    </div>
                  )}

                  <form
                    className="LoginForm"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      setAuthMethod('basic')
                      localStorage.setItem(authMethodKey, 'basic')
                      localStorage.setItem(mgmtNodeKey, loginMgmtNode.trim())
                      localStorage.setItem(adminUserKey, loginAdminUser.trim())
                      localStorage.setItem(displayNameKey, loginDisplayName.trim() || 'Conference Assistant')
                      setAppState(AppState.Connecting)
                      try {
                        const res = await fetch(`${API_BASE}/auth/basic-login`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ mgmtNode: loginMgmtNode.trim(), username: loginAdminUser.trim(), password: loginAdminPass })
                        })
                        if (res.ok) {
                          authenticate().catch(console.error)
                        } else {
                          setError('Invalid credentials or management node unreachable.')
                          setAppState(AppState.Error)
                        }
                      } catch {
                        setError('Could not reach the server.')
                        setAppState(AppState.Error)
                      }
                    }}
                  >
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Management Node</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. pexip-mgmt.example.com"
                        required
                        value={loginMgmtNode}
                        onChange={(e) => setLoginMgmtNode(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Admin Username</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. admin"
                        required
                        value={loginAdminUser}
                        onChange={(e) => setLoginAdminUser(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Admin Password</label>
                      <input
                        className="LoginForm__input"
                        type="password"
                        placeholder="Admin password"
                        required
                        value={loginAdminPass}
                        onChange={(e) => setLoginAdminPass(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Your Display Name</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. Conference Assistant"
                        value={loginDisplayName}
                        onChange={(e) => setLoginDisplayName(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="Btn Btn--primary LoginForm__submit">
                      Connect to Management Node
                    </button>
                    <button
                      type="button"
                      className="Btn Btn--ghost LoginForm__submit"
                      onClick={() => setAppMode(AppMode.None)}
                    >
                      Back
                    </button>
                  </form>
                </div>
              </div>
            )}

            {appState === AppState.Disconnected && appMode === AppMode.Direct && (
              <div className="LoginScreen">
                <div className="LoginCard">
                  <h2>Direct Conference</h2>
                  <p>Connect directly to a VMR on a conference node.</p>
                  <form
                    className="LoginForm"
                    onSubmit={(e) => {
                      e.preventDefault()
                      connectDirect().catch(console.error)
                    }}
                  >
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Conference Node</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. 192.168.1.10 or conf.example.com"
                        required
                        value={directNode}
                        onChange={(e) => setDirectNode(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">VMR Name / Alias</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. meet.sales"
                        required
                        value={directVmr}
                        onChange={(e) => setDirectVmr(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">Display Name</label>
                      <input
                        className="LoginForm__input"
                        type="text"
                        placeholder="e.g. Conference Assistant"
                        required
                        value={directDisplayName}
                        onChange={(e) => setDirectDisplayName(e.target.value)}
                      />
                    </div>
                    <div className="LoginForm__field">
                      <label className="LoginForm__label">PIN (optional)</label>
                      <input
                        className="LoginForm__input"
                        type="password"
                        placeholder="Leave blank if no PIN"
                        value={directPin}
                        onChange={(e) => setDirectPin(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="Btn Btn--primary LoginForm__submit">
                      Join Conference
                    </button>
                    <button
                      type="button"
                      className="Btn Btn--ghost LoginForm__submit"
                      onClick={() => setAppMode(AppMode.None)}
                    >
                      Back
                    </button>
                  </form>
                </div>
              </div>
            )}

            {appState === AppState.Connecting && (
              <div className="SpinnerWrap">
                <Spinner colorScheme="dark" />
              </div>
            )}

            {appState === AppState.Authenticated && !showVideoWall && (
              <div className="AuthLayout">
                <VmrList
                  vmrs={vmrs}
                  confNode={confNode}
                  onFetchQuality={fetchQuality}
                  onSelect={(vmr) => {
                    if (vmr.hasPin) {
                      const saved = localStorage.getItem(`pex-pin-${vmr.primaryAlias ?? vmr.name}`)
                      if (saved != null) { void connectToVmr(vmr, saved) }
                      else { setPendingVmr(vmr) }
                    } else {
                      void connectToVmr(vmr, '')
                    }
                  }}
                  onToggleLock={(vmr) => { void toggleLockVmr(vmr) }}
                  onLogout={logout}
                  onVideoWall={() => setShowVideoWall(true)}
                />
                <BrandPanel
                  vmrCount={vmrs.length}
                  participantCount={vmrs.reduce((s, v) => s + v.participant_count, 0)}
                  stats={platformStats}
                />
              </div>
            )}

            {appState === AppState.Authenticated && showVideoWall && (
              <VideoWall
                vmrs={vmrs}
                confNode={confNode}
                onBack={() => setShowVideoWall(false)}
              />
            )}

            {pendingVmr != null && (
              <PinDialog
                vmrName={pendingVmr.name}
                savedPin={localStorage.getItem(`pex-pin-${pendingVmr.primaryAlias ?? pendingVmr.name}`) ?? undefined}
                onConfirm={(pin) => {
                  const vmr = pendingVmr
                  setPendingVmr(null)
                  void connectToVmr(vmr, pin)
                }}
                onCancel={() => { setPendingVmr(null) }}
              />
            )}

            {appState === AppState.Connected && (
              <div className="ConnectedLayout">
                <div className="LeftPanel">
                  <Conference
                    infinityClient={infinityClient}
                    conferenceStatus={conferenceStatus}
                    layoutStatus={layoutStatus}
                    participants={participants}
                  />
                </div>
                <div className="RightPanel">
                  <Participants
                    infinityClient={infinityClient}
                    participants={participants}
                    me={me}
                  />
                  <VmrPreview node={connectedNode} conference={connectedConference} pin={connectedPin} />
                </div>
              </div>
            )}

            {appState === AppState.Error && (
              <ErrorPanel
                message={error}
                onClose={() => {
                  if (appMode === AppMode.Management && pollingRef.current != null) {
                    setAppState(AppState.Authenticated)
                  } else {
                    setAppState(AppState.Disconnected)
                  }
                }}
              />
            )}

            {settingsOpened && (
              <Settings onClose={() => { setSettingsOpened(false) }} />
            )}
          </div>

          {showSetupPage && (
            <SetupPage
              isFirstRun={!!needsSetup}
              authHeaders={getAuthHeaders()}
              onConfigSaved={() => {
                setShowSetupPage(false)
                setNeedsSetup(false)
                fetch(`${API_BASE}/auth/config`).then(r => r.json()).then(cfg => {
                  setOidcAvailable(cfg.oidcEnabled)
                  if (cfg.pexipMgrNode) setOidcMgrNode(cfg.pexipMgrNode)
                }).catch(() => {})
              }}
              onClose={() => setShowSetupPage(false)}
            />
          )}
        </ThemeProvider>
      </div>
    )
  }