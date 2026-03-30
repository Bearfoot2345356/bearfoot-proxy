const express = require('express');
const https = require('https');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const CONFIG = {
  meta: {
    token: process.env.META_TOKEN,
    adAccount: process.env.META_AD_ACCOUNT || 'act_378262932806675',
    pageId: process.env.META_PAGE_ID || '441555446605737',
    pixelId: process.env.META_PIXEL_ID || '470255323754555'
  },
  google: {
    developerToken: process.env.GOOGLE_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    managerAccountId: process.env.GOOGLE_MANAGER_ACCOUNT_ID || '4491645864',
    clientAccountId: process.env.GOOGLE_CLIENT_ACCOUNT_ID || '8166793966'
  },
  uppromote: {
    apiKey: process.env.UPPROMOTE_API_KEY
  },
  shopify: {
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    shop: 'bearfoot-athletics.myshopify.com',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || null
  }
};

let shopifyToken = CONFIG.shopify.accessToken;

app.get('/config', (req, res) => {
  res.json({
    meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId, pixelId: CONFIG.meta.pixelId },
    google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

function keepAlive() {
  https.get('https://bearfoot-proxy.onrender.com/health', (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => console.log('ping:', new Date().toISOString()));
  }).on('error', e => console.log('ping error:', e.message));
}
setInterval(keepAlive, 14 * 60 * 1000);

// SHOPIFY OAUTH CALLBACK
app.get('/auth/callback', (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).json({ error: 'Missing code or shop' });

  const bodyStr = JSON.stringify({
    client_id: CONFIG.shopify.clientId,
    client_secret: CONFIG.shopify.clientSecret,
    code
  });

  const opts = {
    hostname: shop,
    path: '/admin/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };

  const r2 = https.request(opts, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => {
      try {
        const p = JSON.parse(d);
        if (p.access_token) {
          shopifyToken = p.access_token;
          res.send('<h2>Token captured!</h2><p>Token: <code>' + p.access_token + '</code></p><p>Scope: ' + p.scope + '</p><p>Add this to Render as SHOPIFY_ACCESS_TOKEN</p>');
        } else {
          res.status(400).json({ error: 'No token in response', response: p });
        }
      } catch(e) {
        res.status(500).json({ error: e.message });
      }
    });
  });
  r2.on('error', e => res.status(500).json({ error: e.message }));
  r2.write(bodyStr);
  r2.end();
});

app.get('/auth/token', (req, res) => {
  if (shopifyToken) {
    res.json({ token: shopifyToken });
  } else {
    res.status(404).json({ error: 'No Shopify token yet' });
  }
});

// SHOPIFY API
function shopifyRequest(method, path, body) {
  const token = shopifyToken || CONFIG.shopify.accessToken;
  if (!token) return Promise.reject(new Error('No Shopify access token configured'));
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: CONFIG.shopify.shop,
      path,
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.get('/api/shopify', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try { res.json(await shopifyRequest('GET', path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shopify', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try { res.json(await shopifyRequest('POST', path, req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/shopify', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try { res.json(await shopifyRequest('PUT', path, req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shopify', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try { res.json(await shopifyRequest('DELETE', path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// META
function metaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/v19.0${path}${sep}access_token=${CONFIG.meta.token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'graph.facebook.com', path: fullPath, method, headers: { 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, r => {
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

// GOOGLE ADS
let gToken = null, gExpiry = 0;

async function getGToken() {
  if (gToken && Date.now() < gExpiry) return gToken;
  const body = new URLSearchParams({
    client_id: CONFIG.google.clientId,
    client_secret: CONFIG.google.clientSecret,
    refresh_token: CONFIG.google.refreshToken,
    grant_type: 'refresh_token'
  }).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const p = JSON.parse(d);
        if (p.error) return reject(new Error(p.error_description || p.error));
        gToken = p.access_token;
        gExpiry = Date.now() + (p.expires_in - 60) * 1000;
        resolve(gToken);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function gRequest(method, path, body) {
  const token = await getGToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'googleads.googleapis.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': CONFIG.google.developerToken,
        'login-customer-id': CONFIG.google.managerAccountId,
        'Content-Type': 'application/json'
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/api/google/query', async (req, res) => {
  const query = req.body && req.body.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const data = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/googleAds:searchStream`,
      { query }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/google/mutate', async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }
  let { resource, operations } = body;
  if (typeof operations === 'string') {
    try { operations = JSON.parse(operations); } catch(e) {}
  }
  if (!operations) return res.status(400).json({ error: 'Missing operations' });
  try {
    const data = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/${resource}:mutate`,
      { operations }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// UPPROMOTE
function uppromoteRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'aff-api.uppromote.com',
      path: `/api/v2${path}`,
      method,
      headers: {
        'Authorization': CONFIG.uppromote.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.get('/api/uppromote', async (req, res) => {
  const path = req.query.path || '/affiliates';
  try { res.json(await uppromoteRequest('GET', path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/uppromote', async (req, res) => {
  const path = req.query.path || '/affiliates';
  try { res.json(await uppromoteRequest('POST', path, req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Bearfoot proxy v7 running');
  setTimeout(keepAlive, 5000);
});
