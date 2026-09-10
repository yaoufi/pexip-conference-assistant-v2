const express = require('express');
const compression = require('compression');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const fs = require('fs');
const cookieSession = require('cookie-session');

const app = express();
app.disable('x-powered-by');

const BASE = process.env.BASE_PATH || '/assistant';
const MTX_HOST = process.env.MTX_HOST || 'localhost';
const ALLOW_SELF_SIGNED = (process.env.ALLOW_SELF_SIGNED || 'true').toLowerCase() === 'true';
const httpsAgent = new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED });
if (ALLOW_SELF_SIGNED) console.warn('[SECURITY] TLS certificate verification disabled (ALLOW_SELF_SIGNED=true). Set to false with valid certs.');

function validateBridgeUrl(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch { return 'Invalid URL'; }
  if (parsed.protocol !== 'https:') return 'Only HTTPS URLs are allowed';
  if (!parsed.pathname.startsWith('/api/')) return 'Only Pexip API paths (/api/) are allowed';
  const h = parsed.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1') return 'Loopback addresses are blocked';
  if (/^127\./.test(h)) return 'Loopback addresses are blocked';
  if (/^169\.254\./.test(h)) return 'Link-local/metadata addresses are blocked';
  if (h.startsWith('fe80:')) return 'Link-local addresses are blocked';
  return null;
}

function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, windowMs);
  if (cleanup.unref) cleanup.unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > maxRequests) {
      secLog('rate_limit', { ip: key, path: req.path, count: entry.count });
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: 'Too many requests, try again later' });
    }
    next();
  };
}

function secLog(event, details) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...details }));
}

const authLimiter = createRateLimiter(60000, 10);
const bridgeLimiter = createRateLimiter(60000, 200);
const adminLimiter = createRateLimiter(60000, 10);
const mediaLimiter = createRateLimiter(60000, 300);

// --- Persistent config ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KEY_PATH = path.join(DATA_DIR, 'oauth2_private_key.pem');

// --- Mutable config (loaded from file, env vars as fallback) ---
let OIDC_ISSUER = '';
let OIDC_CLIENT_ID = '';
let OIDC_CLIENT_SECRET = '';
let OIDC_REDIRECT_URI = '';
let OIDC_SCOPES = 'openid email profile groups';
let PEXIP_MGR_NODE = '';
let PEXIP_OAUTH2_CLIENT_ID = '';
let PEXIP_OAUTH2_KEY_PATH = '';
let SESSION_SECRET = '';

// --- OIDC Discovery Cache ---
let oidcConfig = null;
let jwksData = null;

// --- Pexip OAuth2 Token Cache ---
let pexipToken = null;
let pexipTokenExpiry = 0;

function loadConfig() {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[CONFIG] Failed to read config.json:', e.message);
  }

  OIDC_ISSUER = fileConfig.oidcIssuer || process.env.OIDC_ISSUER || '';
  OIDC_CLIENT_ID = fileConfig.oidcClientId || process.env.OIDC_CLIENT_ID || '';
  OIDC_CLIENT_SECRET = fileConfig.oidcClientSecret || process.env.OIDC_CLIENT_SECRET || '';
  OIDC_REDIRECT_URI = fileConfig.oidcRedirectUri || process.env.OIDC_REDIRECT_URI || '';
  OIDC_SCOPES = fileConfig.oidcScopes || process.env.OIDC_SCOPES || 'openid email profile groups';
  PEXIP_MGR_NODE = fileConfig.pexipMgrNode || process.env.PEXIP_MGR_NODE || '';
  PEXIP_OAUTH2_CLIENT_ID = fileConfig.pexipOauth2ClientId || process.env.PEXIP_OAUTH2_CLIENT_ID || '';
  PEXIP_OAUTH2_KEY_PATH = fileConfig.pexipOauth2KeyPath || process.env.PEXIP_OAUTH2_KEY_PATH || KEY_PATH;
  SESSION_SECRET = fileConfig.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  oidcConfig = null;
  jwksData = null;
  pexipToken = null;
  pexipTokenExpiry = 0;

  console.log('[CONFIG] Loaded — OIDC:', OIDC_ISSUER ? 'enabled' : 'disabled', '| Pexip MGR:', PEXIP_MGR_NODE || '(not set)');
}

function isConfigured() {
  return fs.existsSync(CONFIG_PATH);
}

loadConfig();

if (!isConfigured()) {
  console.warn('[SECURITY] No config.json found — admin endpoints are open for initial setup. Complete setup promptly.');
}

async function getOidcConfig() {
  if (oidcConfig) return oidcConfig;
  const res = await axios.get(`${OIDC_ISSUER}/.well-known/openid-configuration`, { httpsAgent });
  oidcConfig = res.data;
  return oidcConfig;
}

async function getJwks() {
  if (jwksData) return jwksData;
  const config = await getOidcConfig();
  const res = await axios.get(config.jwks_uri, { httpsAgent });
  jwksData = res.data;
  return jwksData;
}

async function getPexipBearerToken() {
  if (pexipToken && Date.now() < pexipTokenExpiry) return pexipToken;

  let privateKeyPem;
  try {
    privateKeyPem = fs.readFileSync(PEXIP_OAUTH2_KEY_PATH, 'utf8');
  } catch (e) {
    console.error('Cannot read OAuth2 private key:', e.message);
    return null;
  }

  const { importPKCS8, SignJWT } = await import('jose');
  const privateKey = await importPKCS8(privateKeyPem, 'ES256');

  const tokenUrl = `https://${PEXIP_MGR_NODE}/oauth/token/`;
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    iss: PEXIP_OAUTH2_CLIENT_ID,
    sub: PEXIP_OAUTH2_CLIENT_ID,
    aud: tokenUrl,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: PEXIP_OAUTH2_CLIENT_ID })
    .sign(privateKey);

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: PEXIP_OAUTH2_CLIENT_ID,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope: 'is_admin use_api',
  });

  const res = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    httpsAgent,
    timeout: 10000,
  });

  pexipToken = res.data.access_token;
  const expiresIn = res.data.expires_in || 3600;
  pexipTokenExpiry = Date.now() + (expiresIn - 30) * 1000;
  console.log('[AUTH] Obtained Pexip bearer token, expires in', expiresIn, 's');
  return pexipToken;
}

// --- PKCE Helpers ---
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// --- Middleware ---
app.use(compression());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'application/sdp' }));

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'");
  next();
});

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.url);
  next();
});

app.use(cookieSession({
  name: 'assistant_session',
  keys: [SESSION_SECRET],
  maxAge: 8 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.SECURE_COOKIES !== 'false',
}));

// --- Admin auth middleware ---
async function requireAdminAuth(req, res, next) {
  if (!isConfigured()) return next();
  if (req.session?.user) return next();

  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ') && PEXIP_MGR_NODE) {
    try {
      const testRes = await axios.get(
        `https://${PEXIP_MGR_NODE}/api/admin/configuration/v1/licence/`,
        { headers: { Authorization: auth }, httpsAgent, timeout: 10000 }
      );
      if (testRes.status === 200) return next();
    } catch (e) { /* fall through */ }
  }

  res.status(401).json({ error: 'Authentication required' });
}

// --- Admin Setup Routes ---

app.get(`${BASE}/admin/status`, (req, res) => {
  res.json({
    configured: isConfigured(),
    authenticated: !!(req.session?.user) || !isConfigured(),
    oidcEnabled: !!(OIDC_CLIENT_ID && OIDC_ISSUER),
    pexipOauth2Enabled: !!(PEXIP_MGR_NODE && PEXIP_OAUTH2_CLIENT_ID),
  });
});

app.get(`${BASE}/admin/config`, requireAdminAuth, (req, res) => {
  res.json({
    oidcIssuer: OIDC_ISSUER,
    oidcClientId: OIDC_CLIENT_ID,
    oidcClientSecret: OIDC_CLIENT_SECRET ? '********' : '',
    oidcRedirectUri: OIDC_REDIRECT_URI,
    oidcScopes: OIDC_SCOPES,
    pexipMgrNode: PEXIP_MGR_NODE,
    pexipOauth2ClientId: PEXIP_OAUTH2_CLIENT_ID,
    sessionSecret: SESSION_SECRET ? '********' : '',
    hasPrivateKey: fs.existsSync(PEXIP_OAUTH2_KEY_PATH),
  });
});

app.post(`${BASE}/admin/config`, adminLimiter, requireAdminAuth, async (req, res) => {
  try {
    const body = req.body;
    const MAX_FIELD_LEN = 2048;
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string' && v.length > MAX_FIELD_LEN && k !== 'privateKeyPem') {
        return res.status(400).json({ error: `Field "${k}" exceeds maximum length` });
      }
    }
    const config = {};

    if (body.oidcIssuer !== undefined) config.oidcIssuer = body.oidcIssuer;
    if (body.oidcClientId !== undefined) config.oidcClientId = body.oidcClientId;
    if (body.oidcClientSecret !== undefined && body.oidcClientSecret !== '********')
      config.oidcClientSecret = body.oidcClientSecret;
    if (body.oidcRedirectUri !== undefined) config.oidcRedirectUri = body.oidcRedirectUri;
    if (body.oidcScopes !== undefined) config.oidcScopes = body.oidcScopes;
    if (body.pexipMgrNode !== undefined) config.pexipMgrNode = body.pexipMgrNode;
    if (body.pexipOauth2ClientId !== undefined) config.pexipOauth2ClientId = body.pexipOauth2ClientId;
    if (body.sessionSecret !== undefined && body.sessionSecret !== '********')
      config.sessionSecret = body.sessionSecret;

    let existing = {};
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      }
    } catch {}
    const merged = { ...existing, ...config };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');

    if (body.privateKeyPem && body.privateKeyPem.trim()) {
      fs.writeFileSync(KEY_PATH, body.privateKeyPem.trim() + '\n', 'utf8');
      merged.pexipOauth2KeyPath = KEY_PATH;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
      console.log('[ADMIN] Private key saved');
    }

    loadConfig();
    console.log('[ADMIN] Configuration saved and applied');
    res.json({ ok: true, message: 'Configuration saved and applied.' });
  } catch (e) {
    console.error('[ADMIN] Config save error:', e.message);
    res.status(500).json({ error: 'Failed to save configuration. Check server logs for details.' });
  }
});

app.post(`${BASE}/admin/test-oidc`, adminLimiter, requireAdminAuth, async (req, res) => {
  const { issuer } = req.body;
  if (!issuer || typeof issuer !== 'string') return res.status(400).json({ error: 'Missing issuer URL' });
  if (!issuer.startsWith('https://')) return res.status(400).json({ error: 'Issuer URL must use HTTPS' });
  try {
    const discoveryRes = await axios.get(`${issuer}/.well-known/openid-configuration`, { httpsAgent, timeout: 10000 });
    res.json({ ok: true, endpoints: {
      authorization: discoveryRes.data.authorization_endpoint,
      token: discoveryRes.data.token_endpoint,
      issuer: discoveryRes.data.issuer,
    }});
  } catch (e) {
    res.status(400).json({ error: 'Could not reach OIDC discovery endpoint. Verify the issuer URL is correct and reachable.' });
  }
});

// --- OIDC Auth Routes ---

app.get(`${BASE}/auth/config`, (req, res) => {
  res.json({
    oidcEnabled: !!(OIDC_CLIENT_ID && OIDC_ISSUER),
    pexipOauth2Enabled: !!(PEXIP_MGR_NODE && PEXIP_OAUTH2_CLIENT_ID),
    pexipMgrNode: PEXIP_MGR_NODE || null,
  });
});

app.get(`${BASE}/auth/login`, authLimiter, async (req, res) => {
  try {
    const config = await getOidcConfig();
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    req.session.pkce_verifier = verifier;
    req.session.oauth_state = state;
    req.session.oauth_nonce = nonce;

    const redirectUri = OIDC_REDIRECT_URI || `${req.protocol}://${req.get('host')}${BASE}/auth/callback`;

    const params = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      response_type: 'code',
      scope: OIDC_SCOPES,
      redirect_uri: redirectUri,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    res.redirect(`${config.authorization_endpoint}?${params.toString()}`);
  } catch (e) {
    console.error('[AUTH] Login error:', e.message);
    res.status(500).json({ error: 'OIDC configuration error' });
  }
});

app.get(`${BASE}/auth/callback`, authLimiter, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('[AUTH] OIDC error:', error, error_description);
      return res.redirect(`${BASE}/?auth_error=${encodeURIComponent(error_description || error)}`);
    }

    if (!state || !req.session.oauth_state || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(req.session.oauth_state))) {
      return res.redirect(`${BASE}/?auth_error=state_mismatch`);
    }

    if (!code) {
      return res.redirect(`${BASE}/?auth_error=missing_authorization_code`);
    }

    const config = await getOidcConfig();
    const redirectUri = OIDC_REDIRECT_URI || `${req.protocol}://${req.get('host')}${BASE}/auth/callback`;

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OIDC_CLIENT_ID,
      code_verifier: req.session.pkce_verifier,
    });
    if (OIDC_CLIENT_SECRET) {
      tokenParams.set('client_secret', OIDC_CLIENT_SECRET);
    }

    const tokenRes = await axios.post(config.token_endpoint, tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent,
      timeout: 10000,
    });

    const { id_token, access_token } = tokenRes.data;

    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const jwks = createRemoteJWKSet(new URL(config.jwks_uri));
    const { payload } = await jwtVerify(id_token, jwks, {
      issuer: OIDC_ISSUER,
      audience: OIDC_CLIENT_ID,
    });

    if (req.session.oauth_nonce && (!payload.nonce || !crypto.timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(req.session.oauth_nonce)))) {
      return res.redirect(`${BASE}/?auth_error=nonce_mismatch`);
    }

    const userData = {
      sub: payload.sub,
      name: payload.name || payload.preferred_username || payload.email,
      email: payload.email,
      groups: payload.groups || [],
      authMethod: 'oidc',
    };
    req.session = null;
    req.session = {};
    req.session.user = userData;

    secLog('auth_success', { method: 'oidc', user: req.session.user.email, ip: req.ip });
    res.redirect(`${BASE}/`);
  } catch (e) {
    console.error('[AUTH] Callback error:', e.message);
    res.redirect(`${BASE}/?auth_error=token_exchange_failed`);
  }
});

app.post(`${BASE}/auth/basic-login`, authLimiter, async (req, res) => {
  const { mgmtNode, username, password } = req.body;
  if (!mgmtNode || !username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }
  const loginUrl = `https://${mgmtNode}/api/admin/configuration/v1/licence/`;
  const urlError = validateBridgeUrl(loginUrl);
  if (urlError) {
    console.warn(`[SECURITY] basic-login SSRF blocked: ${mgmtNode} — ${urlError} (IP: ${req.ip})`);
    return res.status(400).json({ error: 'Invalid management node address' });
  }
  const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  try {
    const testRes = await axios.get(
      loginUrl,
      { headers: { Authorization: basicAuth }, httpsAgent, timeout: 10000 }
    );
    if (testRes.status === 200) {
      const sessionData = { user: { name: username, authMethod: 'basic' }, basicAuth, mgmtNode };
      req.session = null;
      req.session = {};
      Object.assign(req.session, sessionData);
      secLog('auth_success', { method: 'basic', user: username, mgmtNode, ip: req.ip });
      return res.json({ ok: true });
    }
  } catch (e) { /* fall through */ }
  secLog('auth_failure', { method: 'basic', user: username, mgmtNode, ip: req.ip });
  res.status(401).json({ error: 'Invalid credentials or management node unreachable' });
});

app.get(`${BASE}/auth/me`, (req, res) => {
  if (req.session.user) {
    return res.json({ authenticated: true, user: req.session.user, mgmtNode: req.session.mgmtNode || null });
  }
  res.json({ authenticated: false });
});

app.post(`${BASE}/auth/logout`, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// --- Universal Admin API bridge ---
app.all(`${BASE}/bridge`, bridgeLimiter, async (req, res) => {
  const targetUrl = req.headers['x-pexip-url'];
  const pexipToken = req.headers['token'];
  const auth = req.headers['authorization'];

  if (!targetUrl) return res.status(400).json({ error: 'Missing target URL in headers' });
  const urlError = validateBridgeUrl(targetUrl);
  if (urlError) {
    secLog('ssrf_blocked', { url: targetUrl, reason: urlError, ip: req.ip });
    return res.status(403).json({ error: urlError });
  }

  try {
    const config = {
      method: req.method,
      url: targetUrl,
      data: req.body,
      httpsAgent,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    };

    if (auth) {
      config.headers['Authorization'] = auth;
    } else if (req.session.user?.authMethod === 'oidc') {
      const bearer = await getPexipBearerToken();
      if (bearer) {
        config.headers['Authorization'] = `Bearer ${bearer}`;
      }
    } else if (req.session.basicAuth) {
      config.headers['Authorization'] = req.session.basicAuth;
    }

    if (pexipToken) config.headers['token'] = pexipToken;

    const response = await axios(config);
    res.json(response.data);
  } catch (error) {
    console.error('Bridge Error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({ error: status >= 500 ? 'Bridge proxy error' : 'Request failed' });
  }
});

// --- MediaMTX API proxy ---
app.all(`${BASE}/mtx/{*path}`, mediaLimiter, async (req, res) => {
  const mtxPath = '/' + (req.params.path || '');
  if (mtxPath.includes('..')) return res.status(400).json({ error: 'Invalid path' });
  try {
    const response = await axios({
      method: req.method,
      url: `http://${MTX_HOST}:9997${mtxPath}`,
      data: req.body,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 502).json(error.response?.data || { error: 'MediaMTX unreachable' });
  }
});

// --- WHEP proxy ---
app.post(`${BASE}/whep/{*path}`, mediaLimiter, async (req, res) => {
  const whepPath = req.url.replace(`${BASE}/whep`, '');
  if (whepPath.includes('..')) return res.status(400).send('Invalid path');
  const targetUrl = `http://${MTX_HOST}:8889${whepPath}`;
  try {
    const response = await axios.post(targetUrl, req.body, {
      headers: { 'Content-Type': 'application/sdp' },
      responseType: 'text',
      timeout: 10000,
      transformRequest: [(data) => data],
      transformResponse: [(data) => data]
    });
    res.set('Content-Type', 'application/sdp');
    res.set('Location', response.headers.location || '');
    res.status(response.status).send(response.data);
  } catch (e) {
    res.status(e.response?.status || 502).send(e.response?.data || 'WHEP proxy error');
  }
});

// --- HLS proxy ---
app.get(`${BASE}/hls/{*path}`, mediaLimiter, (req, res) => {
  const hlsPath = '/' + (req.params.path || '');
  if (hlsPath.includes('..')) return res.status(400).send('Invalid path');
  const proxyReq = http.request({
    hostname: MTX_HOST,
    port: 8888,
    path: hlsPath,
    method: 'GET',
    timeout: 10000,
  }, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => res.status(502).send('HLS proxy error'));
  proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(504).send('HLS proxy timeout'); });
  proxyReq.end();
});

// --- Serve React static build ---
const distPath = path.join(__dirname, 'dist');
app.use(BASE, express.static(distPath));
app.get(`${BASE}/{*path}`, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// --- Global error handler (A10: Mishandling of Exceptional Conditions) ---
app.use((err, req, res, _next) => {
  secLog('unhandled_error', { path: req.path, method: req.method, ip: req.ip, error: err.message });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

process.on('uncaughtException', (err) => {
  secLog('uncaught_exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  secLog('unhandled_rejection', { error: String(reason) });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Assistant server on port ${PORT}, base path: ${BASE}`);
  console.log(`OIDC issuer: ${OIDC_ISSUER || '(not configured)'}`);
  console.log(`Pexip MGR node: ${PEXIP_MGR_NODE || '(not configured)'}`);
  console.log(`Config file: ${isConfigured() ? CONFIG_PATH : '(not yet created — setup required)'}`);
});
