# Conference Assistant

A React web app for real-time management of Pexip conferences. Connects either via admin credentials to monitor and manage all active conferences across a Pexip platform, or directly to a single VMR as a no-media participant.

## Modes

### Management Node
Authenticate with Pexip admin credentials to get a live dashboard of all active conferences. Polls the Admin API every 5 seconds. From the dashboard you can:
- Search and sort active conferences
- View participant counts, duration, lock status, and call quality per conference
- Lock / unlock conferences
- Join any conference as a host to control layout, mute, disconnect participants, set personal layouts
- **Participant pinning**: visual drag-and-drop grid to pin participants to specific layout positions (uses Pexip `set_pinning_config` API). Supports all standard layouts (1:0, 4:0, 9:0, 1:7, 2:21, etc.), backfill, show-reserved, and remove-self options.
- Preview a conference's video feed inline
- Monitor platform health: node load, quality alerts, protocol/vendor distribution

### Direct Conference
Connect directly to a specific VMR on a conference node without admin credentials. Useful for managing a single known conference.

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- Access to a Pexip Infinity deployment

> **Personal layout feature:** To use per-participant layout control, enable `can_receive_personal_mix` in the Pexip Participant Policy script (Management → Configuration → Policy → Local Policy Scripts). See `IMPLEMENTATION_GUIDE.md` for details.

---

## Installation

```bash
npm install
```

---

## Development

Starts a Vite dev server with self-signed HTTPS on port 3000. The browser will warn about the certificate — accept it to proceed.

```bash
npm start
```

Open [https://localhost:3000/assistant/](https://localhost:3000/assistant/)

The app hot-reloads on file changes. API bridge calls are proxied to `http://localhost:3001`.

> **Note:** Run `node server.cjs` in a separate terminal during development so the bridge is available (see Production below).

---

## Production

Build the React app, then start the bridge server which serves the built files and proxies all Pexip API calls.

```bash
npm run build
node server.cjs
```

Open [http://localhost:3001/assistant/](http://localhost:3001/assistant/)

The server listens on port 3001 by default. Set the `PORT` environment variable to override:

```bash
PORT=8080 node server.cjs
```

---

## Docker

Builds the React app and runs the bridge server inside a container, exposed on port 3002 (localhost only).

```bash
docker-compose up --build
```

Open [http://localhost:3002/assistant/](http://localhost:3002/assistant/)

To run in the background:

```bash
docker-compose up -d --build
```

---

## Other Scripts

```bash
# Type-check and lint
npm run lint

# Build only (output goes to dist/)
npm run build
```

---

## Architecture

```
Browser
  └── React SPA (dist/ or Vite dev server)
        ├── /assistant/bridge  →  server.cjs  →  Pexip Admin API (HTTPS)
        └── /api/client/*      →  server.cjs  →  Pexip Infinity WebSocket
```

**`server.cjs`** is a single Express server that:
- Serves the built `dist/` at `/assistant/`
- Proxies Admin API calls (`/assistant/bridge`) with the credentials passed in headers
- Proxies Infinity Client SDK calls (`/api/client/*`) to the selected conference node

SSL verification is disabled on the server side to support self-signed Pexip certificates.
