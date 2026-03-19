const express = require('express');
const https = require('https');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- CONFIG ----
const CONFIG = {
  meta: {
    token: 'EAARQ3HPftCIBQZCZCMucYRvSNC18PVBfc4V2fZBZB4pP2Ku4hefI3MUrBoeQrJG4tsZBsz38mnWvMieTDMF2g7bMSjjmAAjFsIounRiB9sbpEqZA6LtnpcptdWcWSw789MZAVdyopljt3xmcTDFptbARBU127oPVdd645djxkZBNiaM0tYCWodeU2ECvRqmFUwZDZD',
    adAccount: 'act_378262932806675',
    pageId: '441555446605737',
    pixelId: '470255323754555'
  },
  google: {
    developerToken: 'ZoHf32jakJf2ajRF-RZY8g',
    clientId: '6736684714-aas0ved9nrml829deu6d7jgf4j388p5s.apps.googleusercontent.com',
    clientSecret: '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',
    refreshToken: '1//04LHL5kmZkZnXCgYIARAAgAQSNwF-L9IrShx4wMHkN1pEMBljqZoGqRMVmjRj1b0c8K7BqasyfMCginGI4yCZY2MU77tpaWTlWxg',
    managerAccountId: '4491645864',
    clientAccountId: '8166793966'
  }
};

// Expose safe config to frontend
app.get('/config', (req, res) => {
  res.json({
    meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId, pixelId: CONFIG.meta.pixelId },
    google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---- KEEP ALIVE (ping self every 14 minutes) ----
function keepAlive() {
  https.get('https://bearfoot-proxy.onrender.com/health', (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => console.log('Keep-alive ping:', d));
  }).on('error', (e) => console.log('Keep-alive error:', e.message));
}
setInterval(keepAlive, 14 * 60 * 1000); // every 14 minutes

// ---- META API ----
function metaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/v19.0${path}${sep}access_token=${CONFIG.meta.token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'graph.facebook.com', path: fullPath, method, headers: { 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.get('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('GET', req.query.path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('POST', req.query.path, req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('DELETE', req.query.path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- GOOGLE ADS API ----
let googleAccessToken = null;
let googleTokenExpiry = 0;

async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < googleTokenExpiry) return googleAccessToken;
  const body = new URLSearchParams({
    client_id: CONFIG.google.clientId,
    client_secret: CONFIG.google.clientSecret,
    refresh_token: CONFIG.google.refreshToken,
    grant_type: 'refresh_token'
  }).toString();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const parsed = JSON.parse(d);
        if (parsed.error) return reject(new Error(parsed.error_description || parsed.error));
        googleAccessToken = parsed.access_token;
        googleTokenExpiry = Date.now() + (parsed.expires_in - 60) * 1000;
        resolve(googleAccessToken);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function googleRequest(method, path, body) {
  const token = await getGoogleAccessToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'googleads.googleapis.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': CONFIG.google.developerToken,
        'login-customer-id': CONFIG.google.managerAccountId,
        'Content-Type': 'application/json'
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/api/google/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const data = await googleRequest('POST',
      `/v18/customers/${CONFIG.google.clientAccountId}/googleAds:search`,
      { query }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/google/mutate', async (req, res) => {
  const { resource, operations } = req.body;
  if (!operations) return res.status(400).json({ error: 'Missing operations' });
  try {
    const data = await googleRequest('POST',
      `/v18/customers/${CONFIG.google.clientAccountId}/${resource}:mutate`,
      { operations }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Bearfoot proxy running');
  // Initial ping after 1 minute to register keep-alive
  setTimeout(keepAlive, 60 * 1000);
});
