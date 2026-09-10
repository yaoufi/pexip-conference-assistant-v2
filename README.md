# Conference Assistant

A React web app for real-time management of Pexip conferences. Connects either via admin credentials or OIDC SSO to monitor and manage all active conferences across a Pexip platform, or directly to a single VMR as a no-media participant.

## Modes

### Management Node
Authenticate with Pexip admin credentials or OIDC SSO to get a live dashboard of all active conferences. Polls the Admin API every 5 seconds. From the dashboard you can:
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

## Authentication

The app supports two authentication methods:

### Basic Auth
Enter Pexip management node address and admin credentials directly. No server-side configuration required.

### OIDC Single Sign-On (SSO)
Authenticate via an identity provider (Okta, Azure AD, etc.). When SSO is enabled, the server uses an OAuth2 client with `private_key_jwt` to make API calls to the Pexip management node on behalf of the user.

SSO can be configured either via:
- **Environment variables** in `docker-compose.yml` (see below)
- **GUI Setup page** — accessible from the app's header after logging in, or automatically shown on first run if no config file exists

Both methods can coexist: SSO configuration is stored in `data/config.json` on the server, with environment variables as fallback.

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- Access to a Pexip Infinity deployment

> **Personal layout feature:** To use per-participant layout control, enable `can_receive_personal_mix` in the Pexip Participant Policy script (Management > Configuration > Policy > Local Policy Scripts).

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

> **Note:** Run `node server.cjs` in a separate terminal during development so the bridge is available.

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

Builds the React app and runs the bridge server inside a container.

```bash
docker-compose up --build
```

Open [http://localhost:3002/assistant/](http://localhost:3002/assistant/)

To run in the background:

```bash
docker-compose up -d --build
```

### Custom base path

To deploy at a different URL path (e.g. `/assistantv2/`), set `BASE_PATH` as both a build arg and runtime env var:

```yaml
services:
  assistant:
    build:
      context: .
      args:
        BASE_PATH: /assistantv2
    environment:
      - BASE_PATH=/assistantv2
```

---

## SSO Configuration

To enable OIDC SSO, set the following environment variables (or configure them via the GUI Setup page):

| Variable | Required | Description |
|---|---|---|
| `OIDC_ISSUER` | Yes | OIDC discovery URL (e.g. `https://company.okta.com/oauth2/default`) |
| `OIDC_CLIENT_ID` | Yes | Client ID from your identity provider |
| `OIDC_CLIENT_SECRET` | If required | Client secret (required for Web app types) |
| `OIDC_REDIRECT_URI` | Yes | Full callback URL (e.g. `https://example.com/assistant/auth/callback`) |
| `OIDC_SCOPES` | No | Scopes to request (default: `openid email profile groups`) |
| `PEXIP_MGR_NODE` | Yes | Pexip management node FQDN |
| `PEXIP_OAUTH2_CLIENT_ID` | Yes | OAuth2 client ID created on the management node |
| `PEXIP_OAUTH2_KEY_PATH` | Yes | Path to ES256 private key file inside the container |
| `SESSION_SECRET` | Recommended | Secret for signing session cookies |
| `BASE_PATH` | No | URL path prefix (default: `/assistant`) |

### Pexip OAuth2 client setup

1. On the Pexip management node, go to **Platform > OAuth2 Clients**
2. Create a new client with **Token auth method: private_key_jwt**
3. Download the ES256 private key
4. Copy the client ID
5. Trigger a config sync on the management node

### Identity provider setup

1. Create a Web application in your IdP (Okta, Azure AD, etc.)
2. Set the redirect URI to `https://your-domain/assistant/auth/callback`
3. Copy the client ID and client secret

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
  +-- React SPA (dist/ or Vite dev server)
        |-- /assistant/bridge  ->  server.cjs  ->  Pexip Admin API (HTTPS)
        |-- /assistant/auth/*  ->  server.cjs  ->  OIDC provider + session
        |-- /assistant/admin/* ->  server.cjs  ->  GUI config management
        +-- /api/client/*      ->  server.cjs  ->  Pexip Infinity WebSocket
```

**`server.cjs`** is a single Express server that:
- Serves the built `dist/` at the configured base path
- Proxies Admin API calls (`/bridge`) with credentials from Basic auth headers or OAuth2 bearer tokens
- Handles OIDC auth flow (`/auth/*`) with PKCE
- Provides admin setup routes (`/admin/*`) for GUI-based configuration
- Persists SSO config to `data/config.json` (env vars as fallback)
- Caches Pexip OAuth2 bearer tokens with auto-refresh

---

## Security (OWASP Top 10)

The server includes hardening measures aligned with the [OWASP Top 10 (2021)](https://owasp.org/Top10/):

### A01 — Broken Access Control
- **Bridge proxy URL validation**: The `/bridge` endpoint only allows HTTPS URLs with `/api/` path prefix. Loopback addresses (`127.x.x.x`, `localhost`), cloud metadata endpoints (`169.254.x.x`), and link-local addresses are blocked.
- **First-run warning**: When no `config.json` exists, the server logs a security warning that admin endpoints are temporarily unauthenticated.

### A02 — Cryptographic Failures
- **TLS verification is configurable**: Set `ALLOW_SELF_SIGNED=false` in production with valid certificates. Defaults to `true` for lab environments with self-signed Pexip certs.
- **Secure cookies**: Set `SECURE_COOKIES=true` when running behind HTTPS to mark session cookies as secure-only.
- **OIDC nonce verification**: The server validates the `nonce` claim in the ID token against the session-stored value to prevent replay attacks.

### A03 — Injection
- **Error sanitization**: Server-side errors (5xx) return generic messages. Internal details (stack traces, network topology) are never leaked to the client.
- **OIDC issuer validation**: The test-oidc endpoint requires HTTPS URLs only.

### A04 — Insecure Design
- **Rate limiting**: In-memory sliding-window rate limiters on all endpoints:
  - Auth endpoints (login, callback, basic-login): 10 requests per minute
  - Bridge proxy: 200 requests per minute
  - Admin config endpoints: 10 requests per minute
  - Media proxies (MTX, WHEP, HLS): 300 requests per minute
- **Content Security Policy (CSP)**: Strict CSP header blocks inline scripts, restricts connections to `self`, `https:`, and `wss:` origins. Iframes allowed from `self` and `https:` origins (required for Pexip conference previews).

### A05 — Security Misconfiguration
- **CORS restricted**: Cross-origin requests are disabled (`origin: false`). All API calls are same-origin since the Express server serves both the SPA and the API.
- **`X-Powered-By` disabled**: Express server fingerprint header removed.
- **Security headers on all responses**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy` (see A04)
- **`trust proxy` enabled** for correct protocol detection behind reverse proxies.
- **Non-root Docker container**: The app runs as the `node` user, not root.

### A07 — Identification and Authentication Failures
- **PKCE** (Proof Key for Code Exchange) on all OIDC authorization requests.
- **State parameter** validated on callback to prevent CSRF on the login flow.
- **Nonce** validated to prevent token replay.
- **Server-side credential storage**: Admin passwords are sent to the server once during login, validated, and stored in the server-side session — never persisted in `localStorage`. Old localStorage password entries are cleaned up on app load.

### A08 — Software and Data Integrity Failures
- **Lockfile verification**: Docker builds use `npm ci` instead of `npm install` to verify `package-lock.json` integrity and ensure reproducible installs.

### A09 — Security Logging and Monitoring Failures
- **Structured security event logging**: All security-relevant events are logged as JSON with timestamps and client IP:
  - `auth_success` / `auth_failure` — login attempts with method, user, and IP
  - `ssrf_blocked` — rejected bridge/login URLs with reason
  - `rate_limit` — rate limiter activations with path and request count

### A10 — Server-Side Request Forgery (SSRF)
- The bridge proxy and basic-login endpoint validate all target URLs before making outbound requests. Only `https://{host}/api/...` patterns are allowed. Internal, loopback, and metadata addresses are rejected.

### Security environment variables

| Variable | Default | Description |
|---|---|---|
| `ALLOW_SELF_SIGNED` | `true` | Set to `false` to enforce TLS certificate verification |
| `SECURE_COOKIES` | `false` | Set to `true` when running behind HTTPS |
