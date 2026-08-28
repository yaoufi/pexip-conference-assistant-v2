# Pexip Conference Assistant — Implementation Guide

This document describes the full architecture, patterns, and implementation details needed to build a Pexip Conference Assistant app from scratch. Give this file to Claude Code in a new project folder and ask it to build the app.

---

## What the app does

A React SPA that connects to a Pexip Infinity platform in one of two modes:

- **Management mode** — Authenticate with Pexip admin credentials. The app polls the Admin API every 5 seconds and shows all active conferences across the platform with participant counts, protocol/vendor breakdowns, and lock/unlock controls. Click any conference to join it as a silent observer.
- **Direct mode** — Join a specific VMR on a conference node directly (no admin credentials needed). Enter the node address, VMR alias, display name, and optional PIN.

In both modes the app joins using `ClientCallType.None` — no audio, no video, no camera/microphone permission required. It is a pure observer/control panel.

---

## Tech stack

```json
{
  "dependencies": {
    "@pexip/components": "^20.0.0",
    "@pexip/infinity": "^17.7.0",
    "axios": "^1.16.0",
    "compression": "^1.7.5",
    "cors": "^2.8.6",
    "express": "^5.2.1",
    "react": "~18.3.1",
    "react-dom": "~18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@types/react": "~18.3.2",
    "@types/react-dom": "~18.3.0",
    "@vitejs/plugin-basic-ssl": "^1.1.0",
    "@vitejs/plugin-react-swc": "^3.6.0",
    "sass": "^1.77.2",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

Vite + React + TypeScript. SCSS for styles. `@pexip/components` provides the Pexip design system (ThemeProvider, Spinner, NotificationToast, etc.). `@pexip/infinity` is the Infinity WebSocket client SDK.

---

## Vite config

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  base: '/assistant/',
  plugins: [react(), basicSsl()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/assistant/bridge': { target: 'http://localhost:3001', changeOrigin: true }
    }
  },
  build: { target: 'ES2022' }
})
```

- `base: '/assistant/'` — all assets and routes are prefixed with `/assistant/`
- `basicSsl()` — self-signed HTTPS in dev (required for Pexip WebSocket)
- Proxy `/assistant/bridge` → `localhost:3001` in dev so Admin API calls go through the local bridge server

---

## Production server (server.cjs)

CommonJS Express server. Serves the built `dist/` at `/assistant/` and provides two proxy endpoints.

```javascript
// server.cjs
const express    = require('express');
const compression = require('compression');
const cors       = require('cors');
const axios      = require('axios');
const https      = require('https');
const path       = require('path');

const app = express();
app.use(compression());
app.use(cors());

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── Proxy 1: Infinity Client SDK WebSocket/REST ────────────────────────────
// The SDK calls /api/client/... — proxy these to the Pexip conferencing node.
// Must be BEFORE express.json() so the body stream is not consumed.
let pexipNode = null;

app.use((req, res, next) => {
  if (!req.url.startsWith('/api/client')) return next();
  if (!pexipNode) return res.status(503).json({ error: 'No node set' });

  const HOP_BY_HOP = ['connection','keep-alive','transfer-encoding','te',
                       'trailers','upgrade','proxy-authenticate','proxy-authorization'];
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => !HOP_BY_HOP.includes(k.toLowerCase()))
  );
  headers['host'] = pexipNode;

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length > 0) headers['content-length'] = body.length;

    const proxyReq = https.request({
      hostname: pexipNode, port: 443, path: req.url,
      method: req.method, headers, rejectUnauthorized: false
    }, (proxyRes) => {
      const resHeaders = Object.fromEntries(
        Object.entries(proxyRes.headers).filter(([k]) => !HOP_BY_HOP.includes(k.toLowerCase()))
      );
      res.writeHead(proxyRes.statusCode, resHeaders);
      proxyRes.pipe(res);
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
    proxyReq.on('error', err => {
      if (!res.headersSent) res.status(502).json({ error: err.message });
    });
  });
});

app.use(express.json());

// Tell the proxy which Pexip node to forward SDK calls to
app.post('/set-node', (req, res) => {
  pexipNode = req.body.node;
  res.json({ ok: true });
});

// ── Proxy 2: Admin API bridge ──────────────────────────────────────────────
// Client puts the full Pexip Admin API URL in x-pexip-url header.
// Forwards Authorization and token headers.
app.all('/assistant/bridge', async (req, res) => {
  const targetUrl = req.headers['x-pexip-url'];
  const auth      = req.headers['authorization'];
  const token     = req.headers['token'];
  if (!targetUrl) return res.status(400).send('Missing x-pexip-url header');

  try {
    const config = {
      method: req.method,
      url: targetUrl,
      data: req.body,
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(auth  ? { Authorization: auth }  : {}),
        ...(token ? { token }                : {}),
      }
    };
    const response = await axios(config);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || error.message);
  }
});

// ── Serve React build ──────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use('/assistant', express.static(distPath));
app.get('/assistant/{*path}', (req, res) =>
  res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`Server running on port ${PORT}`));
```

---

## localStorage keys (constants.ts)

```typescript
export const nodeKey        = 'pex-node'         // conferencing node FQDN (auto-detected)
export const conferenceKey  = 'pex-conference'   // last joined conference alias
export const displayNameKey = 'pex-display-name' // user's display name in meetings
export const hostPinKey     = 'pex-host-pin'     // last used PIN
export const mgmtNodeKey    = 'pex-mgmt-node'    // management node FQDN
export const adminUserKey   = 'pex-admin-user'   // admin username
export const adminPassKey   = 'pex-admin-pass'   // admin password
export const directNodeKey  = 'pex-direct-node'  // direct mode: conference node
export const directVmrKey   = 'pex-direct-vmr'   // direct mode: VMR alias
// Per-VMR PIN cache: key = `pex-pin-${alias}`, cleared on logout
```

---

## State machine (App.tsx)

```typescript
enum AppMode {
  None,        // Landing — choose Management or Direct
  Management,  // Admin API polling mode
  Direct       // Join specific VMR mode
}

enum AppState {
  Disconnected,  // Not connected — show login form
  Connecting,    // In progress — show spinner
  Authenticated, // Management: admin login succeeded — show conference list
  Connected,     // Direct or joined VMR: WebSocket connected — show controls
  Error          // Show error panel with reconnect
}
```

State transitions:
- Start: `None / Disconnected`
- Management login: `Disconnected → Connecting → Authenticated` (then poll every 5s)
- Join VMR from list: `Authenticated → Connecting → Connected`
- Direct mode: `Disconnected → Connecting → Connected`
- Disconnect from meeting: `Connected → Authenticated` (management) or `Connected → Disconnected` (direct)
- Any error: `→ Error`

---

## Infinity SDK setup

```typescript
import {
  ClientCallType,
  type InfinityClient,
  createCallSignals,
  createInfinityClient,
  createInfinityClientSignals,
  type Participant,
  type LayoutEvent,
  type ConferenceStatus,
  type ExtendedInfinityErrorCode
} from '@pexip/infinity'

// Create signals once at module level (outside the component)
const infinityClientSignals = createInfinityClientSignals([
  'onError', 'onDisconnected', 'onConnected',
  'onConferenceStatus', 'onLayoutUpdate', 'onParticipants', 'onMe'
])
const callSignals = createCallSignals([])

let infinityClient: InfinityClient
```

Wire signals in a `useEffect` with empty deps (run once on mount):
```typescript
useEffect(() => {
  const onError       = (e: { error: string; errorCode: ExtendedInfinityErrorCode }) => {
    setAppState(AppState.Error); setError(e.error);
  }
  const onConnected    = () => setAppState(AppState.Connected)
  const onDisconnected = () => {
    // Stay Authenticated in management mode so the conference list stays visible
    if (appModeRef.current === AppMode.Direct) setAppState(AppState.Disconnected)
    else setAppState(AppState.Authenticated)
  }
  const onConferenceStatus = (e: { id: string; status: ConferenceStatus }) => {
    if (e.id === 'main') setConferenceStatus(e.status)
  }
  const onLayoutUpdate = (e: LayoutEvent) => setLayoutStatus(e)
  const onParticipants = (e: { id: string; participants: Participant[] }) => {
    if (e.id === 'main') setParticipants(e.participants)
  }
  const onMe = (e: { id: string; participant: Participant }) => {
    if (e.id === 'main') setMe(e.participant)
  }

  infinityClientSignals.onError.add(onError)
  infinityClientSignals.onConnected.add(onConnected)
  infinityClientSignals.onDisconnected.add(onDisconnected)
  infinityClientSignals.onConferenceStatus.add(onConferenceStatus)
  infinityClientSignals.onLayoutUpdate.add(onLayoutUpdate)
  infinityClientSignals.onParticipants.add(onParticipants)
  infinityClientSignals.onMe.add(onMe)

  const onUnload = () => infinityClient?.disconnect({ reason: 'Browser closed' }).catch(() => {})
  window.addEventListener('beforeunload', onUnload)

  return () => {
    infinityClientSignals.onError.remove(onError)
    infinityClientSignals.onConnected.remove(onConnected)
    infinityClientSignals.onDisconnected.remove(onDisconnected)
    infinityClientSignals.onConferenceStatus.remove(onConferenceStatus)
    infinityClientSignals.onLayoutUpdate.remove(onLayoutUpdate)
    infinityClientSignals.onParticipants.remove(onParticipants)
    infinityClientSignals.onMe.remove(onMe)
    window.removeEventListener('beforeunload', onUnload)
  }
}, [])

// IMPORTANT: use useRef to track appMode inside signal callbacks
// (state value is stale inside closures set up at mount time)
const appModeRef = useRef<AppMode>(AppMode.None)
useEffect(() => { appModeRef.current = appMode }, [appMode])
```

Join a conference:
```typescript
const joinConference = async (node: string, alias: string, displayName: string, pin: string) => {
  infinityClient = createInfinityClient(infinityClientSignals, callSignals)
  await infinityClient.call({
    host: `https://${node}`,
    conferenceAlias: alias,
    displayName,
    bandwidth: 1280,
    callType: ClientCallType.None,  // no media — observer mode
    pin
  })
}
```

---

## Admin API — endpoints called

All calls go through `/assistant/bridge` with the full URL in `x-pexip-url` and `Authorization: Basic base64(user:pass)`.

```
GET  https://{mgmt}/api/admin/configuration/v1/licence/
     → Validates credentials (200 = valid, 401 = wrong credentials)

GET  https://{mgmt}/api/admin/configuration/v1/worker_vm/?limit=50
     → Returns all conferencing nodes; extract FQDN and IP addresses

GET  https://{mgmt}/api/admin/configuration/v1/conference/?limit=500
     → Returns all configured VMRs with aliases and PIN status

GET  https://{mgmt}/api/admin/status/v1/conference/?limit=500
     → Active conferences (polled every 5s); each object has:
       id, name, start_time, participant_count, is_locked, guests_muted

GET  https://{mgmt}/api/admin/status/v1/participant/?limit=500
     → Active participants; each object has:
       display_name, conference_name (or conference/service_name — try all three),
       protocol, vendor, encryption,
       call_quality (string: "0_unknown" | "1_good" | "2_ok" | "3_bad"),
       rx_bandwidth, tx_bandwidth (max configured kbps — not actual usage),
       media_node (IP of the conferencing node serving this participant)

POST https://{mgmt}/api/admin/command/v1/conference/lock/
     Body: { "conference_id": "<id>" }
     → Locks the conference

POST https://{mgmt}/api/admin/command/v1/conference/unlock/
     Body: { "conference_id": "<id>" }
     → Unlocks the conference
```

---

## API field notes

**call_quality** — the only quality indicator available via the REST API. Computed server-side from packet loss measurements. Raw packet loss, jitter, and resolution are NOT exposed by the Admin REST API. Only available in the internal Django management UI (session auth required). Display the quality label only; do not attempt to derive numeric metrics.

Encryption check — the API returns various formats:
```typescript
const isEncrypted = (enc: any): boolean => {
  if (enc == null) return true
  if (typeof enc === 'boolean') return enc
  const s = String(enc).toLowerCase()
  return s === 'on' || s === 'true' || s === '1' || s === 'encrypted'
}
```

---

## Components

### `Header`
Props: `isConnected: boolean`, `showSettings: boolean`, `onDisconnectClick`, `onSettingsClick`

Shows the app title. When `isConnected=true` shows a Disconnect button. When `showSettings=true` shows a Settings button (only in management mode, while the conference list is visible).

### `Settings`
Props: `onClose: () => void`

Modal panel that reads/writes localStorage keys for management node credentials and display name. Shown as an overlay when the gear icon is clicked.

### `VmrList`
Props: `vmrs: Vmr[]`, `confNode: string | null`, `onSelect`, `onToggleLock`, `onLogout`

Displays active conferences in a searchable, sortable list. Each row shows: conference name, primary alias, participant count, duration, lock status, "NEW" badge (for conferences that appeared during this session, highlighted for 30s). Actions per row: lock/unlock toggle, join button. Search filters by name or alias. Sort options: name, participant count, start time.

The `Vmr` type:
```typescript
interface Vmr {
  id: string
  name: string
  start_time: string       // "2024-01-15 14:32:00" format
  participant_count: number
  is_locked: boolean
  guests_muted: boolean
  primaryAlias?: string    // first alias from configuration API
  hasPin: boolean          // whether the VMR has a PIN configured
  isNew: boolean           // appeared during this session (last 30s)
}
```

### `BrandPanel`
Props: `vmrCount: number`, `participantCount: number`, `stats: PlatformStats | null`

Right sidebar showing platform-wide metrics:
- Total conferences and participants
- Unencrypted participant count
- Locked and muted conference counts
- Node load: participants per conferencing node
- Protocol breakdown (SIP, H.323, WebRTC, etc.)
- Vendor breakdown (normalised: Chrome/Firefox/Safari → Browser, Cisco/Webex → Cisco, etc.)
- Longest-running conference and busiest conference

```typescript
interface PlatformStats {
  unencryptedCount: number
  lockedCount: number; mutedCount: number; pinnedCount: number; newCount: number
  longestRunning: { name: string; duration: string } | null
  busiest: { name: string; count: number } | null
  nodeLoads: { address: string; count: number }[]
  protocols: Record<string, number>
  vendors: Record<string, number>
}
```

> **Note:** Packet loss, jitter, and resolution are not exposed by the Pexip Admin REST API. Do not add quality alert sections or per-participant quality metrics — they cannot be populated with real data.

### `Conference`
Props: `infinityClient: InfinityClient`, `conferenceStatus: ConferenceStatus | undefined`, `layoutStatus: LayoutEvent | undefined`

Conference-level controls for when connected to a VMR:
- Lock/unlock the conference
- Mute/unmute all guests
- Change conference layout (uses `infinityClient.setLayout(...)`)
- Enable/disable overlay text
- Set a video banner message (`sendConferenceRequest({ path: 'set_message_text', method: 'POST', payload: { text } })`)

### `Participants`
Props: `infinityClient: InfinityClient`, `participants: Participant[]`, `me: Participant | undefined`

Participant roster with per-participant actions via a "More actions" dropdown:
- **Admit** — admit a waiting participant (`infinityClient.admit(...)`)
- **Spotlight / Remove spotlight** — (`infinityClient.spotlight(...)`)
- **Lower hand** — (`infinityClient.raiseHand({ raise: false })`)
- **Direct message** — send a private message (`sendConferenceRequest({ path: \`participants/${uuid}/message\`, ... })`)
- **Mute / Unmute audio** — (`infinityClient.mute(...)`)
- **Mute / Unmute video** — (`infinityClient.muteVideo(...)`)
- **Make host / Make guest** — (`infinityClient.setRole(...)`)
- **Transfer** — move to another conference (`sendConferenceRequest({ path: \`participants/${uuid}/transfer\`, ... })`)
- **Set personal layout** — set a custom layout view for one participant (see section below)
- **Disconnect** — (`infinityClient.kick(...)`)

Bulk actions in the header: Admit All, Move All to Lobby, Disconnect Guests, Lower All Hands, Broadcast to All.

The overlay text column uses an inline `<Input>` that calls `infinityClient.setTextOverlay(...)` on change. Because the SDK's participant objects are mutated in place, force a re-render by replacing the array reference: `setParticipants(JSON.parse(JSON.stringify(participants)))`.

### `VmrPreview`
Props: `node: string`, `conference: string`, `pin: string`

Shows a live thumbnail of the conference using the Pexip snapshot API:
```
GET https://{node}/api/client/v2/conferences/{alias}/snapshot/
    Headers: { token: <auth token> }
```
Polls every few seconds and displays the image.

### `PinDialog`
Props: `vmrName: string`, `savedPin?: string`, `onConfirm: (pin: string) => void`, `onCancel: () => void`

Modal PIN entry dialog. Appears when joining a PIN-protected conference that has no cached PIN. Pre-fills with `savedPin` if provided.

### `ErrorPanel`
Props: `message: string`, `onClose: () => void`

Full-page error display with the error message and a Reconnect/Close button.

---

## Authentication flow (Management mode)

1. User enters mgmtNode, adminUser, adminPass, displayName → submit
2. Save all to localStorage
3. `GET /assistant/bridge` → `https://{mgmt}/api/admin/configuration/v1/licence/`
   - 200 → credentials valid, continue
   - Non-200 → show error "Invalid credentials"
4. `GET /assistant/bridge` → `https://{mgmt}/api/admin/configuration/v1/worker_vm/?limit=50`
   - Build a Map of IP → FQDN for all conferencing nodes
   - Pick the first `CONFERENCING` node as the default join target (`confNode`)
5. `GET /assistant/bridge` → `https://{mgmt}/api/admin/configuration/v1/conference/?limit=500`
   - Build a Map of `conf.name → { alias: conf.aliases[0].alias, hasPin: Boolean(conf.pin) }`
6. `setAppState(AppState.Authenticated)`
7. Start polling every 5s: fetch both `/status/v1/conference/` and `/status/v1/participant/` in parallel

---

## Join flow from conference list

```typescript
const connectToVmr = async (vmr: Vmr, pin: string) => {
  const alias      = vmr.primaryAlias ?? vmr.name
  const targetNode = confNode ?? mgmtNode  // use discovered node, fallback to mgmt node
  const displayName = localStorage.getItem(displayNameKey) ?? 'Conference Assistant'

  // Cache the PIN for this alias
  if (pin) localStorage.setItem(`pex-pin-${alias}`, pin)

  setAppState(AppState.Connecting)
  infinityClient = createInfinityClient(infinityClientSignals, callSignals)
  await infinityClient.call({
    host: `https://${targetNode}`,
    conferenceAlias: alias,
    displayName,
    bandwidth: 1280,
    callType: ClientCallType.None,
    pin
  })
  // onConnected signal → setAppState(AppState.Connected)
}
```

PIN handling:
- If `vmr.hasPin` is true: check localStorage for `pex-pin-${alias}`
- If cached: use it directly
- If not cached: show `PinDialog` → user enters PIN → call `connectToVmr`

---

## New conference detection

Conferences that appear during the session (not present on first poll) are flagged as "new" and highlighted for 30 seconds:

```typescript
const seenVmrIds   = useRef<Set<string>>(new Set())
const newVmrTimestamps = useRef<Map<string, number>>(new Map())

// In fetchVmrs:
const isFirstPoll = seenVmrIds.current.size === 0
const now = Date.now()

for (const v of confData.objects) {
  if (!isFirstPoll && !seenVmrIds.current.has(v.id)) {
    newVmrTimestamps.current.set(v.id, now)  // mark when it first appeared
  }
  seenVmrIds.current.add(v.id)

  const newTs = newVmrTimestamps.current.get(v.id)
  const isNew = newTs != null && (now - newTs) < 30000
  return { ...v, isNew }
}
```

---

## Build and run

```bash
# Install
npm install

# Dev (HTTPS on port 3000, bridge proxy to 3001)
npm start
# In a separate terminal:
node server.cjs

# Production build
npx vite build    # use npx vite build, not npm run build if there are TS errors

# Production server (serves dist/ + bridge)
node server.cjs
# Access at http://localhost:3001/assistant/
```

---

## Personal layout (per-participant view)

Personal layout lets a host set a custom conference layout for one specific participant — e.g. give a remote speaker a different view than everyone else.

### Pexip server prerequisite

Personal layout requires `can_receive_personal_mix: true` in the participant's policy. Add this to the **Participant Policy** script in Pexip Management → Configuration → Policy → Local Policy Scripts:

```json
{
  "action": "continue",
  "result": {{participant|pex_update({"can_receive_personal_mix": true})|pex_to_json}}
}
```

This enables the feature for all participants. Save and have participants rejoin.

### REST API — two-step process

Personal layout is managed through the `video_mixes` conference endpoint (not a participant-level endpoint):

**Step 1 — Create the personal mix targeting the participant:**
```
POST /api/client/v2/conferences/{alias}/video_mixes/create
Body: { "mix_name": "main.!{participant_uuid}" }
```

**Step 2 — Configure the layout:**
```
POST /api/client/v2/conferences/{alias}/video_mixes/main.!{participant_uuid}/configure
Body: { "transform_layout": { "layout": "1:7" } }
```

**To reset to conference default (delete the personal mix):**
```
POST /api/client/v2/conferences/{alias}/video_mixes/main.!{participant_uuid}/delete
Body: {}
```

### Valid layout values

```
"1:0"   — Speaker only
"1:7"   — Speaker + 7 thumbnails
"1:21"  — Speaker + 21 thumbnails
"2:21"  — 2 speakers + 21 thumbnails
"1:33"  — Speaker + 33 thumbnails
"2x2"   — 2×2 grid
"3x3"   — 3×3 grid
"4x4"   — 4×4 grid
"5x5"   — 5×5 grid
"5:7"   — 5 speakers + 7 thumbnails
```

### Implementation using the Infinity SDK

```typescript
const applyPersonalLayout = async (participant: Participant, layout: string): Promise<void> => {
  const mixName = `main.!${participant.uuid}`
  if (layout === 'default') {
    // Remove personal mix → participant reverts to conference layout
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
}
```

`sendConferenceRequest` automatically includes the participant's token and targets the correct conference node.

---

## Key implementation notes for Claude Code

1. **`appModeRef`** — always keep a `useRef` in sync with `appMode` state. Signal callbacks are closures set up at mount; they capture the ref, not the state value.

2. **Bridge proxy** — the Admin API doesn't send CORS headers. Never call it directly from the browser. All calls must go through `/assistant/bridge` with the target URL in `x-pexip-url`.

3. **`ClientCallType.None`** — this is the critical flag for no-media joining. Without it, the browser will request camera/microphone access.

4. **`rejectUnauthorized: false`** in the server's `httpsAgent` — Pexip nodes often use self-signed certificates in lab environments.

5. **Polling with `useRef`** — store the `setInterval` return value in a `useRef`, not state. This prevents unnecessary re-renders and allows cleanup in `stopPolling()`.

6. **On disconnect in management mode** — the `onDisconnected` signal fires when leaving a VMR. Go back to `Authenticated` (not `Disconnected`) so the conference list stays visible.

7. **IP → hostname mapping** — the participant API returns `media_node` as an IP address. The `worker_vm` API maps IP → hostname. Build this map at login and use it to display readable node names in the load stats.

8. **Conference name vs alias** — the status API uses `name` (internal name). The configuration API provides `aliases`. Always display and use the alias for joining; use name only for internal mapping.

9. **`@pexip/components`** — wrap the entire app in `<ThemeProvider colorScheme="light">`. Use `<Spinner>` for the connecting state and `<NotificationToast>` for transient notifications.
