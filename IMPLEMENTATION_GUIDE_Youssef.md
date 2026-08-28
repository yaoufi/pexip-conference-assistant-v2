# Pexip Conference Assistant — Implementation Guide

This document describes how to build a Pexip Conference Management web app from scratch. It covers architecture decisions, the APIs and SDKs involved, and AI prompts your development team can use with GitHub Copilot, Cursor, or any AI coding assistant. No source code is included.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Pexip Admin REST API Reference](#4-pexip-admin-rest-api-reference)
5. [Pexip Infinity Client SDK Reference](#5-pexip-infinity-client-sdk-reference)
6. [@pexip/components UI Library Reference](#6-pexipcomponents-ui-library-reference)
7. [Application Modes & State Flow](#7-application-modes--state-flow)
8. [Data Model](#8-data-model)
9. [Component Breakdown](#9-component-breakdown)
10. [Persistent Settings (localStorage)](#10-persistent-settings-localstorage)
11. [Deployment](#11-deployment)
12. [AI Prompts — Build Sequence](#12-ai-prompts--build-sequence)

---

## 1. Project Overview

The app has two operating modes:

**Management Node mode** — Authenticate with Pexip admin credentials. Poll the Pexip Admin REST API every 5 seconds to show a live dashboard of all active conferences across the platform. Allows locking/unlocking VMRs, viewing node load, protocol/vendor breakdown, and joining any VMR as a host for further control.

**Direct Conference mode** — Join a specific VMR on a known conference node using the `@pexip/infinity` WebSocket SDK. No admin credentials needed. Provides full in-meeting control: layout, participant actions, text overlays, broadcast messages, transfers.

In both modes the client joins as a **no-media participant** — no camera or microphone, control only.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 |
| Language | TypeScript 5 |
| Build tool | Vite 5 |
| UI components | `@pexip/components` v20 |
| Pexip WebSocket SDK | `@pexip/infinity` v17 |
| Styling | SCSS |
| Dev HTTPS | `@vitejs/plugin-basic-ssl` |
| Bridge server | Node.js + Express 5 |
| Server HTTP client | axios |

---

## 3. Architecture

### Why a bridge server?

The Pexip Admin REST API does not include CORS headers, so browser-side fetch calls are rejected. An Express server sits between the React app and Pexip: the app sends every Admin API request to a local `/bridge` endpoint, and the server proxies it server-side where CORS is not enforced. The server also disables TLS certificate verification so self-signed Pexip certificates are accepted.

### Request flow (Admin API)

```
React app
  → POST /bridge
      header x-pexip-url: https://{pexipNode}/api/admin/...
      header authorization: Basic {base64(user:pass)}
  → Express bridge
  → Pexip Admin API
  → response JSON back to React
```

### Request flow (Infinity SDK)

The `@pexip/infinity` SDK connects directly from the browser to the Pexip conference node over WebSocket/HTTPS. No proxy is needed — the SDK manages the connection lifecycle.

### URL structure

| Environment | App URL | Bridge endpoint |
|---|---|---|
| Development (Vite) | `https://localhost:3000/assistant/` | `/assistant/bridge` — Express must run separately on port 3001 |
| Production (Express) | `http://localhost:3001/assistant/` | `/assistant/bridge` (same Express process) |
| Docker | `http://localhost:3002/assistant/` | `/assistant/bridge` (container port 80) |

### API_BASE constant

Define a module-scope constant `API_BASE = '/assistant'` and use it as the prefix for all bridge fetch calls: `${API_BASE}/bridge`. This resolves to `/assistant/bridge` in both dev and production. In development the Express bridge server must be running separately on port 3001 so these calls have a target — the Vite dev server forwards them there.

### Base path

All assets and routes use `/assistant/` as the base path. This is set in the Vite config (`base: '/assistant/'`) and reflected in the Express static file serving.

---

## 4. Pexip Admin REST API Reference

**Base URL:** `https://{managementNode}`
**Authentication:** HTTP Basic Auth — `Authorization: Basic {base64(username:password)}`
**Required header on all requests:** `X-Requested-With: XMLHttpRequest`
**Content type:** `application/json`

All requests are proxied through the bridge server. The React app never calls Pexip directly.

---

### 4.1 Validate Credentials

```
GET /api/admin/configuration/v1/licence/
```

Used only for credential validation. HTTP 200 = valid. Response body is not needed.

---

### 4.2 Discover Conference Nodes

```
GET /api/admin/configuration/v1/worker_vm/?limit=50
```

Returns a list of Pexip worker VMs. Filter by `node_type === 'CONFERENCING'` to find conference nodes. Each object provides `hostname`, `domain`, and `address` (IP). Build a map of IP → FQDN (`hostname.domain`) for resolving media node addresses reported in participant status later.

---

### 4.3 VMR Alias and PIN Map

```
GET /api/admin/configuration/v1/conference/?limit=500
```

Returns all configured VMRs. Each object includes `name`, `aliases` (array, use `aliases[0].alias`), and `pin` (truthy = PIN-protected). Build a lookup map of `name → { alias, hasPin }` — used when a user wants to join a VMR from the status dashboard.

---

### 4.4 Active Conference Status

```
GET /api/admin/status/v1/conference/?limit=500
```

Poll every 5 seconds. Returns all currently active conferences. Key fields per object:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Used for lock/unlock commands |
| `name` | string | Conference name — join key with alias map |
| `service_type` | string | e.g. `conference`, `lecture` |
| `start_time` | string | Format: `"YYYY-MM-DD HH:MM:SS"` — replace space with `T` and append `Z` to get ISO 8601 |
| `is_locked` | boolean | |
| `guests_muted` | boolean | |
| `tag` | string | Optional label |
| `participant_count` | number | |

---

### 4.5 Active Participant Status

```
GET /api/admin/status/v1/participant/?limit=500
```

Poll every 5 seconds (parallel with conference poll). Key fields per object:

| Field | Notes |
|---|---|
| `conference_name` (or `conference` or `service_name`) | Try all three — use whichever is non-empty |
| `display_name` (or `name`) | Participant name |
| `protocol` | e.g. `WebRTC`, `SIP`, `H323` |
| `vendor` | Raw user-agent string — normalise to friendly names |
| `encryption` | Normalise: `'on'`, `'true'`, `'1'`, `'encrypted'`, `true` → encrypted |
| `media_node` / `media_node_address` | Media node IP — resolve to FQDN using worker_vm map |

---

### 4.6 Lock a Conference

```
POST /api/admin/command/v1/conference/lock/
Body: { "conference_id": "<id>" }
```

---

### 4.7 Unlock a Conference

```
POST /api/admin/command/v1/conference/unlock/
Body: { "conference_id": "<id>" }
```

---

## 5. Pexip Infinity Client SDK Reference

Package: `@pexip/infinity` (available on npm)

### 5.1 TypeScript Imports

All of the following are named exports from `@pexip/infinity`:

| Export | Kind | Purpose |
|---|---|---|
| `createInfinityClient` | function | Creates an InfinityClient instance |
| `createInfinityClientSignals` | function | Creates the signals object |
| `createCallSignals` | function | Creates call-level signals |
| `ClientCallType` | enum | Pass `ClientCallType.None` for no-media |
| `InfinityClient` | type | Type for the client instance |
| `Participant` | type | Type for a conference participant |
| `ConferenceStatus` | type | Type for conference lock/mute state |
| `LayoutEvent` | type | Type for layout update events |
| `Transforms` | type | Type for setLayout payload |
| `ExtendedInfinityErrorCode` | type | Error code enum for onError handler |

---

### 5.2 Initialisation (module scope)

Create the signals object and call signals object **once at module scope** (outside the React component). This avoids recreating them on re-renders. Then create the client instance each time the user joins a conference.

Signals to subscribe to: `onError`, `onDisconnected`, `onConnected`, `onConferenceStatus`, `onLayoutUpdate`, `onParticipants`, `onMe`

Call signals: not needed for a no-media management client — pass an empty array.

### 5.2 Joining a Conference

Call `infinityClient.call()` with:

| Parameter | Value |
|---|---|
| `host` | `https://{conferenceNode}` |
| `conferenceAlias` | VMR alias string |
| `displayName` | Name shown to other participants |
| `bandwidth` | `1280` |
| `callType` | `ClientCallType.None` (no audio/video) |
| `pin` | Host PIN string, or empty string if no PIN |

The `onConnected` signal fires asynchronously when the call is established.

### 5.3 SDK Signals

| Signal | Payload | Use |
|---|---|---|
| `onConnected` | — | Transition UI to in-meeting state |
| `onDisconnected` | — | Return to pre-meeting state |
| `onError` | `{ error, errorCode }` | Show error message |
| `onConferenceStatus` | `{ id, status }` | Sync lock/mute state; use `id === 'main'` |
| `onLayoutUpdate` | layout event object | Sync current layout and overlay state |
| `onParticipants` | `{ id, participants }` | Refresh participant list; use `id === 'main'` |
| `onMe` | `{ id, participant }` | Track local participant (to suppress self-action buttons) |

### 5.4 Conference-Level Methods

| Method | Parameters | Purpose |
|---|---|---|
| `lock` | `{ lock: boolean }` | Lock or unlock the conference |
| `muteAllGuests` | `{ mute: boolean }` | Mute or unmute all guests |
| `setLayout` | `{ transforms: { layout: string } }` | Change conference layout |
| `sendConferenceRequest` | `{ path, method, payload }` | General-purpose REST call within the conference |
| `disconnect` | `{}` | Leave the conference |

**Layout values:** `'default'`, `'1:0'`, `'1:7'`, `'1:21'`, `'2:21'`, `'1:33'`, `'4:0'`, `'9:0'`, `'16:0'`, `'25:0'`, `'5:7'`

**Setting a video banner text:** `sendConferenceRequest` with path `set_message_text`, method `POST`, payload `{ text: "..." }` — pass empty string to clear.

### 5.5 Participant-Level Methods

All take `{ participantUuid }` plus action-specific fields.

| Method | Extra fields | Purpose |
|---|---|---|
| `admit` | — | Admit a waiting participant |
| `spotlight` | `{ enable: boolean }` | Set or remove spotlight |
| `raiseHand` | `{ raise: false }` | Lower a raised hand |
| `mute` | `{ mute: boolean }` | Mute/unmute audio |
| `muteVideo` | `{ muteVideo: boolean }` | Mute/unmute video |
| `setRole` | `{ role: 'chair' \| 'guest' }` | Promote or demote |
| `kick` | — | Disconnect the participant |
| `setTextOverlay` | `{ text: string }` | Set name/title overlay on participant tile |
| `sendConferenceRequest` | path: `participants/{uuid}/message`, method: `POST`, payload: `{ payload: text }` | Send a private message |
| `sendConferenceRequest` | path: `participants/{uuid}/transfer`, method: `POST`, payload: `{ conference_alias, role, remote_display_name? }` | Transfer to another VMR |

### 5.6 Participant Object Fields

`uuid`, `displayName`, `role` (`'chair'` / `'guest'`), `protocol`, `callType`, `isWaiting`, `isSpotlight`, `raisedHand`, `isPresenting`, `isMuted`, `isCameraMuted`

### 5.7 ConferenceStatus Fields Used

`locked`, `guestsMuted`

### 5.8 LayoutEvent Fields Used

`requested_layout.primary_screen.chair_layout` (current layout string), `overlay_text_enabled` (boolean)

### 5.9 Overlay Text Workaround

`overlayText` (the per-participant name/title overlay) is **not included** in the SDK's `Participant` type. To read and write it you need a workaround:

**Reading overlay text:** After each `onParticipants` signal, make an additional `sendConferenceRequest` call with path `participants` and method `GET`. The response body contains a `result` array where each entry has an `overlay_text` field (snake_case). Cast the response to `any` to access it, then write it onto the participant object as `(participant as any).overlayText` (camelCase) for display in the table.

**Writing overlay text:** After calling `setTextOverlay`, update the value directly on the object with the same `(participant as any).overlayText = newText` pattern, then force a re-render by replacing the participants array with a deep copy.

**Why force a re-render:** Because you mutated an object inside the array rather than replacing it, React will not detect the change. Create a deep copy of the array (e.g. via `JSON.parse(JSON.stringify(participants))`) and call the state setter with that copy.

**Signal subscription note:** The `onConferenceStatus` and `onParticipants` signals provide their data wrapped in an object `{ id, status }` / `{ id, participants }`. Always check `id === 'main'` before updating state. The `onLayoutUpdate` signal provides the `LayoutEvent` directly (no wrapper).

---

## 6. @pexip/components UI Library Reference

This is Pexip's own React component library. It is available on npm as `@pexip/components`. You must also import its CSS in your entry point:

```
import '@pexip/components/src/fonts.css'
import '@pexip/components/dist/style.css'
```

---

### 6.1 ThemeProvider

Wraps the entire application. Must be the outermost component.

| Prop | Value |
|---|---|
| `colorScheme` | `"light"` |

---

### 6.2 NotificationToast

Placed inside `ThemeProvider`, wraps the rest of the app. Renders toast notifications triggered imperatively via `notificationToastSignal`.

| Prop | Value |
|---|---|
| `timeout` | `3000` (ms) |
| `position` | `"topCenter"` |

---

### 6.3 notificationToastSignal

An imperative signal exported from `@pexip/components`. Call it directly from event handlers — no React state needed.

Usage pattern: `notificationToastSignal.emit([{ message: 'Your message here' }])`

The argument is always an **array containing one object** with a single `message` string property. This is the only shape used.

Call it after every async participant action to confirm it happened. Examples:
- After admitting: `'Admitted {displayName}'`
- After muting: `'Muted {displayName}'`
- After kicking: `'Disconnected {displayName}'`
- After bulk actions: `'Admitting all {n} participants…'`, `'Conference locked. Guests moved to lobby.'`
- After broadcast: `'Broadcast sent.'`
- After transfer: `'Transferring {displayName} to {alias}…'`

---

### 6.4 Spinner

| Prop | Value |
|---|---|
| `colorScheme` | `"dark"` |

Wrap it in a `<div className="SpinnerWrap">` for centering. Rendered during `AppState.Connecting`.

---

### 6.5 Modal

Conditionally mount/unmount the component rather than toggling `isOpen`. Always render with `isOpen={true}`.

| Prop | Type | Notes |
|---|---|---|
| `isOpen` | `true` | Always true — parent controls mounting |
| `className` | string | Component-specific class name |
| `sizeModifier` | `"compact"` | Only for small dialogs like ErrorPanel |

Always include `<ModalCloseButton className="CloseButton" onClose={handler} />` inside the Modal.

---

### 6.6 Button

| Prop | Type | Notes |
|---|---|---|
| `onClick` | function | Action handler |
| `variant` | `"secondary"` | Used for cancel/secondary actions |
| `type` | `"submit"` | Inside Form elements |
| `disabled` | boolean | e.g. `!value.trim()` to disable when empty |
| `colorScheme` | `"dark"` | For buttons on dark backgrounds |
| `style` | object | e.g. `{ flex: 1 }` for equal-width button pairs |

---

### 6.7 Input

| Prop | Type | Notes |
|---|---|---|
| `label` | string | Required. Can be `''` for unlabelled inputs |
| `name` | string | Required by the component |
| `value` | string | Controlled value |
| `onChange` | function | Standard change handler |
| `placeholder` | string | Placeholder text |
| `type` | `"text"` \| `"password"` | Defaults to text |
| `required` | boolean | For form validation |
| `className` | string | For custom styling |
| `ref` | React ref | For auto-focus via `useRef<HTMLInputElement>` |

Auto-focus pattern: create a `useRef<HTMLInputElement>`, pass it as `ref` to the Input, call `ref.current?.focus()` in a `useEffect` on mount.

---

### 6.8 Select

| Prop | Type | Notes |
|---|---|---|
| `label` | string | Label above the select |
| `value` | string | Currently selected option id |
| `options` | array | `{ id: string, label: string, isDisabled?: boolean }[]` |
| `onValueChange` | function | Receives the selected option's `id` as a string |
| `isFullWidth` | boolean | Makes the select fill its container |
| `placeholder` | string | Shown when value is empty |

For the layout selector: options are `{ id: 'default', label: 'Default' }` followed by one entry per layout string.

For an actions dropdown that resets after selection: set `value=""` always and use the selected `id` in `onValueChange` to dispatch the action. This makes the dropdown stateless — it always shows the placeholder.

Compound id pattern for participant actions: encode both the participant UUID and the action name in the option id as `"{uuid}&{action}"`, then split on `&` in `onValueChange` to extract both.

---

### 6.9 Box and BoxHeader

`Box` is a styled container panel.

| Prop | Type | Notes |
|---|---|---|
| `className` | string | Component name used as class |
| `colorScheme` | `"light"` \| `"dark"` | Panel colour scheme |
| `style` | object | Inline overrides |

`BoxHeader` renders the panel title bar. Place it as the first child of `Box`.

---

### 6.10 Icon

| Prop | Type | Notes |
|---|---|---|
| `source` | `IconTypes` enum member | Which icon to render |

Always wrap in `<Tooltip>` in a table context to explain what the icon means.

Icon values used in this app:

| `IconTypes` member | Meaning |
|---|---|
| `IconTypes.IconLeave` | Disconnect / leave |
| `IconTypes.IconSettings` | Settings |
| `IconTypes.IconClock` | Waiting |
| `IconTypes.IconStar` | Spotlight |
| `IconTypes.IconRaiseHand` | Raised hand |
| `IconTypes.IconPresentationOn` | Presenting |
| `IconTypes.IconMicrophoneOff` | Audio muted |
| `IconTypes.IconMicrophoneOn` | Audio active |
| `IconTypes.IconVideoOff` | Video muted |
| `IconTypes.IconVideoOn` | Video active |

---

### 6.11 Table (compositional API)

The table is built by composing child components — there is no `columns` or `data` prop pattern.

Component hierarchy:
```
Table
  TableContent
    TableSection
      TableHead
        TableRow
          TableCell > TableHeadCell > Text   (column headers)
      TableBody
        TableRow (one per participant)
          TableCell > Text                   (data cells)
```

No props are needed on `Table`, `TableContent`, `TableSection`, `TableHead`, or `TableBody`. Add `className` to `TableCell` to differentiate head cells from body cells.

Wrap cell text in `<Text variant="inherit" fontVariant={FontVariant.Body}>` for consistent typography.

---

### 6.12 Form

Wraps `Input` fields and `Button type="submit"` inside modals. No special props needed beyond standard HTML form attributes.

---

### 6.13 PexipLogo

Renders the Pexip logo SVG. No props required. Used in `Header` and `BrandPanel`.

---

### 6.14 Text and Tooltip

`Text` — renders styled text. Props: `variant`, `fontVariant` (use `FontVariant.Body` from the `FontVariant` enum).

`Tooltip` — wraps an element to show a tooltip on hover. Props: `overlay` (string, the tooltip text). Wrap `Icon` components in `Tooltip` inside tables.

---

## 7. Application Modes & State Flow



### Modes

- **None** — initial state, mode selection screen
- **Management** — Admin API polling mode
- **Direct** — Infinity SDK direct join mode

### States

- **Disconnected** — not logged in / not connected
- **Connecting** — SDK call in progress
- **Authenticated** — logged in to Admin API; VMR dashboard visible
- **Connected** — Infinity SDK call active; in-meeting controls visible
- **Error** — something went wrong; error panel shown

### Key transitions

- Submit credentials → `authenticate()` → Authenticated (or Error)
- Click "Join & Manage" on a VMR → PIN dialog (if VMR has a PIN) → Connecting → Connected
- `onConnected` signal → Connected
- `onDisconnected` signal → Authenticated (Management mode) or Disconnected (Direct mode)
- Close error panel → Authenticated (if still logged in) or Disconnected

### Stale closure avoidance

The `onDisconnected` signal handler is registered once on mount. To avoid reading stale state inside it, keep a React `ref` in sync with the current mode via `useEffect`, and read the ref inside the handler instead of the state value directly.

### "NEW" VMR badge

On the first poll, all VMR IDs are recorded without badges. Any VMR that appears in a subsequent poll that was not in the previous set is marked as new for 30 seconds.

---

## 7. Data Model

### VMR object

| Field | Type | Source |
|---|---|---|
| `id` | string | Admin status API |
| `name` | string | Admin status API |
| `alias` | string | Admin configuration API |
| `serviceType` | string | Admin status API |
| `startTime` | ISO 8601 string | Admin status API (normalised) |
| `isLocked` | boolean | Admin status API |
| `guestsMuted` | boolean | Admin status API |
| `tag` | string | Admin status API |
| `participantCount` | number | Admin status API |
| `hasPin` | boolean | Admin configuration API |
| `isNew` | boolean | Derived — true for 30 s after first appearance |

### Platform stats object

| Field | Description |
|---|---|
| `nodeLoad` | Map of node hostname → participant count |
| `protocolCounts` | Map of protocol string → count |
| `vendorCounts` | Map of normalised vendor name → count |
| `unencryptedCount` | Number of unencrypted participants |
| `lockedCount` | Number of locked conferences |
| `mutedCount` | Number of conferences with guests muted |
| `longestVmr` | VMR name and duration string |
| `busiestVmr` | VMR name and participant count |

---

## 8. Component Breakdown

### VmrList

Renders the active conference dashboard. Features:
- Live-updating list sourced from the Admin status poll
- Text search filter and sort (by participant count, duration, or name)
- Per-row lock/unlock and "Join & Manage" actions
- "NEW" badge for recently appeared VMRs
- Inline iframe preview of any conference's video feed (expand on row click)

**Inline preview URL pattern:** `https://{confNode}/?conference={alias}&name=API-Preview&callType=AudioRecvVideoRecvPresentationRecv&join=1` — append `&pin={pin}&role=host` if a PIN is available.

### BrandPanel

Renders platform-wide stats alongside the VMR list. Sections:

1. Summary counts (total VMRs, total participants)
2. Unencrypted calls warning (if any)
3. Highlights — longest-running VMR, busiest VMR
4. Node load — top 4 media nodes by participant count
5. Protocol breakdown — top 6 protocols
6. Vendor breakdown — top 6 vendors (normalised: Chrome/Firefox/Safari → Browser; Cisco/Webex → Cisco; Teams/Microsoft → Teams; etc.)

### Conference

In-meeting conference controls. Syncs lock state, mute-all state, current layout, and overlay-text flag from SDK signals. Provides: lock toggle, mute-all toggle, layout selector, overlay text toggle, video banner input.

### Participants

In-meeting participant table. Columns: name, overlay text (inline editable), role, protocol, waiting/spotlight/hand/presenting indicators, audio/video mute state, per-row action menu.

Bulk actions: Admit All, Move All to Lobby, Disconnect Guests, Lower All Hands, Broadcast Message.

**Move All to Lobby flow:** lock conference → wait 1 second → transfer each non-waiting guest back to the same VMR as a guest (effectively puts them in the waiting room).

Suppress action buttons on the local participant's own row using the `me` signal.

### PinDialog

Modal for entering a VMR PIN. Pre-fills with any PIN saved from a previous successful join of the same VMR alias.

### TextInputDialog

Generic reusable modal for any single-text-field input (broadcast message, transfer alias, overlay text, etc.). Confirm is disabled if input is empty.

### ErrorPanel

Compact error display with a close button. Closing it returns to Authenticated or Disconnected state depending on whether polling is active.

---

## 9. Persistent Settings (localStorage)

All settings are persisted in `localStorage` so they survive page refreshes.

| Key | Purpose |
|---|---|
| `pex-mgmt-node` | Management node hostname |
| `pex-admin-user` | Admin API username |
| `pex-admin-pass` | Admin API password |
| `pex-display-name` | Display name for joining as participant |
| `pex-node` | Last used conference node |
| `pex-conference` | Last used conference alias |
| `pex-host-pin` | Last used host PIN |
| `pex-direct-node` | Conference node for Direct mode |
| `pex-direct-vmr` | VMR alias for Direct mode |
| `pex-pin-{alias}` | Cached PIN per VMR alias |

All `pex-pin-*` keys are cleared on logout (scan `localStorage.keys()` for the prefix).

---

## 10. Deployment

### Development

Vite dev server on `https://localhost:3000/assistant/` (self-signed cert). Requires an Express bridge server running separately on port 3001 so `/bridge` proxy calls have a target. Run both in parallel.

### Production

Run `npm run build` to produce `dist/`, then `node server.cjs`. The Express server serves `dist/` at `/assistant/` and handles the bridge at `/assistant/bridge`. Default port: 3001.

### Docker

Multi-stage build: Node 20 Alpine builder stage compiles the React app, runtime stage serves it via Express. Container port 80 mapped to host `127.0.0.1:3002`. Place an nginx reverse proxy in front for public access.

---

## 11. AI Prompts — Build Sequence

Paste these prompts in order into your AI coding assistant.

---

### Prompt 1 — Project scaffold

```
Set up a React 18 + TypeScript + Vite 5 project with the following configuration:
- Base URL path: /assistant/
- Dev server on HTTPS port 3000 using @vitejs/plugin-basic-ssl for self-signed certificates
- Dev proxy: forward all requests starting with /bridge to http://localhost:3001
- Build target ES2022
- SCSS support
- Install packages: @pexip/infinity, @pexip/components, express, axios, compression, cors
```

---

### Prompt 1b — CSS imports and ThemeProvider setup

```
In src/main.tsx, add these two CSS imports before any other imports:
  @pexip/components/src/fonts.css
  @pexip/components/dist/style.css

In the root App component, wrap the entire JSX return in:
  <ThemeProvider colorScheme="light"> from @pexip/components
    <NotificationToast timeout={3000} position="topCenter">
      ... rest of the app
    </NotificationToast>
  </ThemeProvider>

NotificationToast and ThemeProvider are both imported from @pexip/components.
Toasts are triggered imperatively via notificationToastSignal.emit([{ message: 'text' }])
from anywhere in the app — no React state needed.
```

---

### Prompt 2 — TypeScript data model

```
Define TypeScript interfaces for a Pexip conference management app:

Vmr: represents an active conference — id, name, alias (dial-in string), serviceType,
startTime (ISO 8601 string), isLocked, guestsMuted, tag, participantCount, hasPin (boolean),
isNew (boolean — new badge for 30s)

PlatformStats: platform-wide aggregates — unencryptedCount, lockedCount, mutedCount,
pinnedCount, newCount, nodeLoads ({ address: string, count: number }[]),
protocols (Record<string, number>), vendors (Record<string, number>),
longestRunning ({ name: string, duration: string } | null),
busiest ({ name: string, count: number } | null)

```

---

### Prompt 3 — localStorage constants

```
Create a constants file that exports named string constants for all localStorage keys:
management node hostname, admin username, admin password, display name,
conference node (last joined), conference alias (last joined), host PIN (last joined),
direct mode node, direct mode VMR alias.
These keys all use a "pex-" prefix convention.
```

---

### Prompt 4 — Express bridge server

```
Create a Node.js Express server (CommonJS) that:
1. Proxies Admin API calls: POST /assistant/bridge reads the target Pexip URL from an
   x-pexip-url request header, reads auth from the authorization header, and forwards the
   request server-side using axios with TLS verification disabled (for self-signed Pexip certs).
   Returns the response JSON or an error status.
2. Serves the built React app from ./dist at /assistant/ with SPA fallback to index.html.
3. Uses compression and CORS middleware.
4. Listens on process.env.PORT (default 3001).
The bridge exists to avoid CORS errors when calling the Pexip Admin API from a browser.
```

---

### Prompt 5 — App state machine

```
Create the root App component for a Pexip conference management app with two modes:
Management Node (Admin API polling) and Direct Conference (Infinity SDK join).

Define an AppMode enum (None, Management, Direct) and AppState enum
(Disconnected, Connecting, Authenticated, Connected, Error).

At module scope — outside the component — initialise the @pexip/infinity SDK:
- createInfinityClientSignals with: onError, onDisconnected, onConnected,
  onConferenceStatus, onLayoutUpdate, onParticipants, onMe
- createCallSignals with an empty array (no media signals needed)
- a module-level variable to hold the InfinityClient instance

In a single useEffect on mount, subscribe to all signals. Use a ref kept in sync
with the current AppMode (via a separate useEffect) to avoid stale closures in the
onDisconnected handler — the handler needs to know the current mode to decide
whether to return to Authenticated or Disconnected.

Register a beforeunload handler to call disconnect on the infinity client.

Render based on AppState:
- Disconnected: mode selection or login form
- Connecting: loading spinner
- Authenticated: VmrList + BrandPanel
- Connected: Conference + Participants + VmrPreview
- Error: ErrorPanel
```

---

### Prompt 6 — Pexip Admin API integration

```
Add Admin API functions to the App component. All calls go through POST /assistant/bridge
with the real URL in the x-pexip-url header and Basic auth in the authorization header.

authenticate(mgmtNode, username, password):
- Validate credentials: GET /api/admin/configuration/v1/licence/ — 200 = valid
- Discover conference node: GET /api/admin/configuration/v1/worker_vm/?limit=50
  Filter node_type=CONFERENCING, build FQDN from hostname+domain, build IP-to-FQDN map
- Load VMR alias/PIN map: GET /api/admin/configuration/v1/conference/?limit=500
  Map name → { alias: aliases[0].alias, hasPin: !!pin }
- On success: set state to Authenticated and start polling

pollData() — called every 5000ms via setInterval:
- Fetch in parallel:
  GET /api/admin/status/v1/conference/?limit=500
  GET /api/admin/status/v1/participant/?limit=500
- Normalise start_time: replace space with T, append Z
- From participants compute: participant count per conference, node load map, protocol counts,
  vendor counts (normalise vendor strings to friendly names), unencrypted count
- Mark VMRs as isNew=true for 30s if their ID was not in the previous poll
- Update vmrs and platformStats state

toggleLockVmr(vmr): POST lock or unlock command, optimistically flip isLocked in state
```

---

### Prompt 7 — Infinity SDK join flow

```
Add join functions to the App component using the @pexip/infinity SDK.

At module scope (outside the component), import from @pexip/infinity:
  createInfinityClient, createInfinityClientSignals, createCallSignals, ClientCallType
  (types only): InfinityClient, Participant, ConferenceStatus, LayoutEvent, Transforms,
  ExtendedInfinityErrorCode

Create at module scope:
  infinityClientSignals = createInfinityClientSignals([
    'onError','onDisconnected','onConnected','onConferenceStatus','onLayoutUpdate',
    'onParticipants','onMe'
  ])
  callSignals = createCallSignals([])   // empty array — no media signals needed
  let infinityClient: InfinityClient   // reassigned on each join

connectToVmr(vmr, pin) and connectDirect(node, alias, pin) should both:
1. Write connection params to localStorage (node, alias, pin, pex-pin-{alias})
2. Set AppState to Connecting
3. Reassign infinityClient = createInfinityClient(infinityClientSignals, callSignals)
4. Call infinityClient.call({
     host: https://{node},
     conferenceAlias: alias,
     displayName: (read from localStorage pex-display-name),
     bandwidth: 1280,
     callType: ClientCallType.None,
     pin: pin
   })
The onConnected signal fires asynchronously and sets AppState to Connected.

Add a PIN dialog flow: if a VMR has hasPin=true and localStorage has no cached
pex-pin-{alias}, show a PinDialog before calling connectToVmr.

In the onParticipants, onConferenceStatus handlers: always check id === 'main' before
updating state. onLayoutUpdate provides the LayoutEvent directly (no id wrapper).
```

---

### Prompt 8 — Conference controls component

```
Create a Conference component that receives infinityClient, conferenceStatus, and layoutStatus as props.

Sync local state from props each time they change:
- locked from conferenceStatus.locked
- guestsMuted from conferenceStatus.guestsMuted
- currentLayout from layoutStatus.requested_layout.primary_screen.chair_layout
- overlayEnabled from layoutStatus.overlay_text_enabled

Render controls for:
1. Lock/unlock toggle → infinityClient.lock({ lock: boolean })
2. Mute all guests toggle → infinityClient.muteAllGuests({ mute: boolean })
3. Layout selector with values: default, 1:0, 1:7, 1:21, 2:21, 1:33, 4:0, 9:0, 16:0, 25:0, 5:7
   → infinityClient.setLayout({ transforms: { layout: value } })
4. Overlay text toggle → infinityClient.setLayout({ transforms: { overlayText: boolean } })
5. Video banner text input with set/clear buttons
   → infinityClient.sendConferenceRequest({ path: 'set_message_text', method: 'POST', payload: { text } })
```

---

### Prompt 9 — Participants table component

```
Create a Participants component receiving infinityClient, participants array, and me (local participant).
Import Table, TableContent, TableSection, TableHead, TableBody, TableRow, TableCell,
TableHeadCell, TableBodyCell, Text, FontVariant, Icon, IconTypes, Tooltip, Input, Select,
Button, Box, BoxHeader, notificationToastSignal from @pexip/components.

Render a table using the compositional API — no columns/data props:
  Table > TableContent > TableSection
    TableHead > TableRow > TableCell > TableHeadCell > Text  (one per column)
    TableBody > TableRow (one per participant)

Columns: display name, overlay text (editable Input), role, protocol,
waiting (IconTypes.IconClock), spotlight (IconTypes.IconStar),
raised hand (IconTypes.IconRaiseHand), presenting (IconTypes.IconPresentationOn),
audio muted (IconTypes.IconMicrophoneOff/On), video muted (IconTypes.IconVideoOff/On),
actions (Select dropdown).

Wrap each Icon in a Tooltip with an overlay string describing the icon.
Wrap cell content in <Text variant="inherit" fontVariant={FontVariant.Body}>.

IMPORTANT — overlay text workaround:
overlayText is not in the SDK Participant type. On every onParticipants event, call
sendConferenceRequest({ path: 'participants', method: 'GET' }) and read overlay_text
(snake_case) from each entry in response.data.result. Cast the participant object to any
and write (participant as any).overlayText = value. After writing, force a React re-render
by replacing the participants array with JSON.parse(JSON.stringify(participants)).
Use (participant as any).overlayText as the value for the overlay text Input.

Actions dropdown: use Select with value="" always (stateless), placeholder "Actions",
options array where each option id encodes both participantUuid and action name as
"{uuid}&{action}". In onValueChange, split on "&" to extract uuid and action.
First option always has isDisabled: true and label "More actions".

Per-participant actions (encode as option ids): admit (if isWaiting), spotlight toggle,
lower hand, mute audio toggle, mute video toggle, promote/demote role, send DM,
set overlay text, transfer to VMR, disconnect.

Suppress the actions Select on the row where participant.uuid === me?.uuid.

After each action, call notificationToastSignal.emit([{ message: 'confirmation text' }])
to confirm it happened (e.g. 'Muted Alice', 'Disconnected Bob', 'Broadcast sent.').

Bulk action buttons (above the table):
- Admit All: admit every isWaiting participant, toast 'Admitting all {n} participants…'
- Move All to Lobby: lock({ lock: true }), wait 1000ms, transfer each non-waiting guest
  back to the current VMR alias as role guest, toast 'Conference locked. Guests moved to lobby.'
- Disconnect Guests: kick all role=guest participants, toast 'Disconnecting all guests…'
- Lower All Hands: raiseHand({ raise: false }) for all with raisedHand===true
- Broadcast: sendConferenceRequest path message, method POST, payload { payload: text }
  toast 'Broadcast sent.'
```

---

### Prompt 10 — Platform stats panel

```
Create a BrandPanel component receiving vmrCount, participantCount, and a platformStats object.

Render these sections:
1. Summary row: total active VMRs and total participants (also locked count, muted count if non-zero)
2. Unencrypted calls warning: display if stats.unencryptedCount > 0
3. Highlights: show longest-running VMR and busiest VMR (highest participantCount)
4. Node load: horizontal bar per entry in stats.nodeLoads, sorted descending, top 4
5. Protocol breakdown: chip per protocol in stats.protocols, top 6, sorted by count
6. Vendor breakdown: chip per vendor in stats.vendors, top 6, sorted by count
   Normalise raw vendor strings: chrome/firefox/safari → Browser, cisco/webex → Cisco,
   teams/microsoft → Teams, pexip → Pexip, poly → Poly, zoom → Zoom, empty → Unknown

```

---

### Prompt 11 — VMR list with inline preview

```
Create a VmrList component receiving vmrs, onSelect, onToggleLock, onLogout,
and confNode as props.

Features:
1. Search input that filters VMRs by name or alias (case-insensitive)
2. Sort controls: by participant count (desc), duration (asc from startTime), or name (asc)
3. Card rows showing: name, primary alias, participant count, duration (calculate from startTime to now),
   lock status badge, Muted badge if guests_muted, NEW badge if vmr.isNew is true
4. Per-row buttons: lock/unlock (calls onToggleLock), Preview (inline iframe toggle),
   Join & Manage (calls onSelect)
5. Inline iframe preview — embed URL:
   https://{confNode}/?conference={alias}&name=API-Preview&callType=AudioRecvVideoRecvPresentationRecv&join=1
   Append &pin={pin}&role=host if a PIN is available in localStorage (pex-pin-{alias}).
   iframe height 320px, allow camera microphone display-capture autoplay.
6. Sign Out button → calls onLogout
```

---

### Prompt 12 — Docker deployment

```
Create a multi-stage Dockerfile for a React + Node.js app:
- Builder stage: Node 20 Alpine, install all dependencies, run npm run build
- Runtime stage: Node 20 Alpine, copy dist/ and server.cjs, install production dependencies only
- Expose port 80, set PORT=80 env var, start with node server.cjs

Create docker-compose.yml with a single service, build from current directory,
map host port 127.0.0.1:3002 to container port 80, restart unless-stopped.
```
