const express = require('express');
const https = require('https');
const app = express();

// Universal body parser — reads raw stream, tries JSON then urlencoded
app.use((req, res, next) => {
  let data = Buffer.alloc(0);
  req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
  req.on('end', () => {
    const str = data.toString('utf8').trim();
    if (!str) { req.body = {}; return next(); }
    try { req.body = JSON.parse(str); return next(); } catch(e) {}
    try { req.body = Object.fromEntries(new URLSearchParams(str)); return next(); } catch(e) {}
    req.body = str;
    next();
  });
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
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
  }
};

app.get('/config', (req, res) => {
  res.json({
    meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId, pixelId: CONFIG.meta.pixelId },
    google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), version: 'v11' }));

app.post('/api/debug', (req, res) => {
  res.json({ body: req.body, query: req.query, contentType: req.headers['content-type'] });
});

function keepAlive() {
  https.get('https://bearfoot-proxy.onrender.com/health', (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => console.log('ping:', new Date().toISOString()));
  }).on('error', e => console.log('ping error:', e.message));
}
setInterval(keepAlive, 14 * 60 * 1000);

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
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  let { resource, operations } = body;
  if (typeof operations === 'string') { try { operations = JSON.parse(operations); } catch(e) {} }
  if (!operations) return res.status(400).json({ error: 'Missing operations' });
  try {
    const data = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/${resource}:mutate`,
      { operations }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Policy review — also available at /review as fallback
async function handleReview(req, res) {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  let resourceNames = null;
  if (body.names && typeof body.names === 'string') {
    resourceNames = body.names.split(',').map(s => s.trim()).filter(Boolean);
  } else if (body.resourceNames) {
    resourceNames = body.resourceNames;
    if (typeof resourceNames === 'string') {
      try { resourceNames = JSON.parse(resourceNames); } catch(e) {
        resourceNames = resourceNames.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  } else if (req.query.names) {
    resourceNames = req.query.names.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (!resourceNames || !resourceNames.length) {
    return res.status(400).json({ error: 'Missing resourceNames', receivedBody: body });
  }

  try {
    const data = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/adGroupAds:requestReview`,
      { resourceNames }
    );
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

app.post('/api/google/review', handleReview);
app.post('/review', handleReview);  // top-level fallback path

// UPPROMOTE
function uppromoteRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'aff-api.uppromote.com',
      path: `/api/v2${path}`,
      method,
      headers: { 'Authorization': CONFIG.uppromote.apiKey, 'Accept': 'application/json', 'Content-Type': 'application/json' }
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
  console.log('Bearfoot proxy v11 running');
  setTimeout(keepAlive, 5000);
});
