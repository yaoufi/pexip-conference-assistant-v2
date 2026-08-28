const express = require('express');
const compression = require('compression');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const path = require('path');
const app = express();

app.use(compression());
app.use(cors());
app.use(express.json());

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Universal Admin API bridge
app.all('/assistant/bridge', async (req, res) => {
  const targetUrl = req.headers['x-pexip-url'];
  const pexipToken = req.headers['token'];
  const auth = req.headers['authorization'];

  if (!targetUrl) return res.status(400).send('Missing target URL in headers.');

  try {
    const config = {
      method: req.method,
      url: targetUrl,
      data: req.body,
      httpsAgent,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    };
    if (auth) config.headers['Authorization'] = auth;
    if (pexipToken) config.headers['token'] = pexipToken;

    const response = await axios(config);
    res.json(response.data);
  } catch (error) {
    console.error('Bridge Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || error.message);
  }
});

// Serve React static build (production only — dist/ won't exist in dev)
const distPath = path.join(__dirname, 'dist');
app.use('/assistant', express.static(distPath));
   app.get('/assistant/{*path}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });


const PORT = process.env.PORT ?? 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Universal Bridge running on port ${PORT}`);
});
