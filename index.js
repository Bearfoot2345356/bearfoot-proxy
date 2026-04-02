const express = require('express');
const https = require('https');
const crypto = require('crypto');
const app = express();

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
  meta: { token: process.env.META_TOKEN, adAccount: process.env.META_AD_ACCOUNT || 'act_378262932806675', pageId: process.env.META_PAGE_ID || '441555446605737', pixelId: process.env.META_PIXEL_ID || '470255323754555' },
  google: { developerToken: process.env.GOOGLE_DEVELOPER_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, refreshToken: process.env.GOOGLE_REFRESH_TOKEN, managerAccountId: process.env.GOOGLE_MANAGER_ACCOUNT_ID || '4491645864', clientAccountId: process.env.GOOGLE_CLIENT_ACCOUNT_ID || '8166793966' },
  uppromote: { apiKey: process.env.UPPROMOTE_API_KEY },
  x: { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET, bearerToken: process.env.X_BEARER_TOKEN, adsAccountId: process.env.X_ADS_ACCOUNT_ID || '18ce55nt6zg' },
  tiktok: { accessToken: process.env.TIKTOK_ACCESS_TOKEN, advertiserId: process.env.TIKTOK_ADVERTISER_ID || '7257567360448593921', appId: process.env.TIKTOK_APP_ID || '7622939461445222401', appSecret: process.env.TIKTOK_APP_SECRET }
};

app.get('/config', (req, res) => res.json({ meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId }, google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId } }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), version: 'v16' }));
app.post('/api/debug', (req, res) => res.json({ body: req.body, query: req.query, contentType: req.headers['content-type'] }));

// Serve 9:16 black JPEG for TikTok ad thumbnails
const THUMB_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////////////////////////////////wAARCAeABDgDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwAB/9k=';
app.get('/thumbnail.jpg', (req, res) => {
  const buf = Buffer.from(THUMB_B64, 'base64');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

function keepAlive() {
  https.get('https://bearfoot-proxy.onrender.com/health', (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log('ping:',new Date().toISOString())); }).on('error', e=>console.log('ping error:',e.message));
}
setInterval(keepAlive, 14 * 60 * 1000);

function metaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/v19.0${path}${sep}access_token=${CONFIG.meta.token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'graph.facebook.com', path: fullPath, method, headers: { 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/meta', async (req, res) => { try { res.json(await metaRequest('GET', req.query.path)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/meta', async (req, res) => { try { res.json(await metaRequest('POST', req.query.path, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/meta', async (req, res) => { try { res.json(await metaRequest('DELETE', req.query.path)); } catch(e) { res.status(500).json({ error: e.message }); } });

let gToken = null, gExpiry = 0;
async function getGToken() {
  if (gToken && Date.now() < gExpiry) return gToken;
  const body = new URLSearchParams({ client_id: CONFIG.google.clientId, client_secret: CONFIG.google.clientSecret, refresh_token: CONFIG.google.refreshToken, grant_type: 'refresh_token' }).toString();
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ const p=JSON.parse(d); if(p.error) return reject(new Error(p.error_description||p.error)); gToken=p.access_token; gExpiry=Date.now()+(p.expires_in-60)*1000; resolve(gToken); }); });
    req.on('error', reject); req.write(body); req.end();
  });
}
async function gRequest(method, path, body) {
  const token = await getGToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'googleads.googleapis.com', path, method, headers: { 'Authorization': `Bearer ${token}`, 'developer-token': CONFIG.google.developerToken, 'login-customer-id': CONFIG.google.managerAccountId, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _rawResponse: d.substring(0,500), _statusCode: r.statusCode, _parseError: e.message }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.post('/api/google/query', async (req, res) => {
  const query = req.body && req.body.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try { res.json(await gRequest('POST', `/v20/customers/${CONFIG.google.clientAccountId}/googleAds:searchStream`, { query })); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/google/mutate', async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  let { resource, operations } = body;
  if (typeof operations === 'string') { try { operations = JSON.parse(operations); } catch(e) {} }
  if (!operations) return res.status(400).json({ error: 'Missing operations' });
  try { res.json(await gRequest('POST', `/v20/customers/${CONFIG.google.clientAccountId}/${resource}:mutate`, { operations })); } catch(e) { res.status(500).json({ error: e.message }); }
});
async function handleReview(req, res) {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  let resourceNames = null;
  if (body.names && typeof body.names === 'string') { resourceNames = body.names.split(',').map(s=>s.trim()).filter(Boolean); }
  else if (body.resourceNames) { resourceNames = body.resourceNames; if (typeof resourceNames === 'string') { try { resourceNames = JSON.parse(resourceNames); } catch(e) { resourceNames = resourceNames.split(',').map(s=>s.trim()).filter(Boolean); } } }
  else if (req.query.names) { resourceNames = req.query.names.split(',').map(s=>s.trim()).filter(Boolean); }
  if (!resourceNames || !resourceNames.length) return res.status(400).json({ error: 'Missing resourceNames', receivedBody: body });
  try { res.json(await gRequest('POST', `/v20/customers/${CONFIG.google.clientAccountId}/adGroupAds:requestReview`, { resourceNames })); } catch(e) { res.status(500).json({ error: e.message }); }
}
app.post('/api/google/review', handleReview);
app.post('/review', handleReview);

function uppromoteRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'aff-api.uppromote.com', path: `/api/v2${path}`, method, headers: { 'Authorization': CONFIG.uppromote.apiKey, 'Accept': 'application/json', 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/uppromote', async (req, res) => { const path = req.query.path || '/affiliates'; try { res.json(await uppromoteRequest('GET', path)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/uppromote', async (req, res) => { const path = req.query.path || '/affiliates'; try { res.json(await uppromoteRequest('POST', path, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

async function twitterRequest(method, path, body = null) {
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'api.twitter.com', path, method, headers: { 'Authorization': `Bearer ${CONFIG.x.bearerToken}`, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await twitterRequest('GET', path)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await twitterRequest('POST', path, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await twitterRequest('DELETE', path)); } catch(e) { res.status(500).json({ error: e.message }); } });

function xAdsOAuth1Header(method, url, queryParams = {}) {
  const oauthParams = { oauth_consumer_key: CONFIG.x.apiKey, oauth_token: CONFIG.x.accessToken, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: Math.floor(Date.now()/1000).toString(), oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_version: '1.0' };
  const allParams = { ...queryParams, ...oauthParams };
  const sortedParams = Object.keys(allParams).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
  const baseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(sortedParams)].join('&');
  const signingKey = `${encodeURIComponent(CONFIG.x.apiSecret)}&${encodeURIComponent(CONFIG.x.accessTokenSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  return 'OAuth ' + Object.keys(oauthParams).map(k=>`${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`).join(', ');
}
async function xAdsRequest(method, path, queryParams = {}, body = null) {
  const baseUrl = `https://ads-api.twitter.com${path}`;
  const qs = Object.keys(queryParams).length ? '?' + Object.entries(queryParams).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  const authHeader = xAdsOAuth1Header(method, baseUrl, queryParams);
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'ads-api.twitter.com', path: path+qs, method, headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/xads/account', async (req, res) => { try { res.json(await xAdsRequest('GET', `/11/accounts/${CONFIG.x.adsAccountId}`)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/xads/campaigns', async (req, res) => { try { res.json(await xAdsRequest('GET', `/11/accounts/${CONFIG.x.adsAccountId}/campaigns`)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/xads/analytics', async (req, res) => { try { res.json(await xAdsRequest('GET', `/11/stats/accounts/${CONFIG.x.adsAccountId}`, req.query)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/xads', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); const { path: _, ...params } = req.query; try { res.json(await xAdsRequest('GET', path, params)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/xads', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xAdsRequest('POST', path, {}, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

async function tiktokRequest(method, path, body = null) {
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'business-api.tiktok.com', path, method, headers: { 'Access-Token': CONFIG.tiktok.accessToken, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/tiktok/campaigns', async (req, res) => { try { res.json(await tiktokRequest('GET', `/open_api/v1.3/campaign/get/?advertiser_id=${CONFIG.tiktok.advertiserId}`)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/tiktok', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await tiktokRequest('GET', path)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/tiktok', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await tiktokRequest('POST', path, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

// TIKTOK IMAGE UPLOAD (multipart with MD5 signature)
app.post('/api/tiktok/upload-image', async (req, res) => {
  const { image_url, advertiser_id } = req.body;
  if (!image_url || !advertiser_id) return res.status(400).json({ error: 'Missing image_url or advertiser_id' });
  try {
    const imageBuffer = await new Promise((resolve, reject) => {
      const protocol = image_url.startsWith('https') ? https : require('http');
      const chunks = [];
      protocol.get(image_url, r => { r.on('data', c => chunks.push(c)); r.on('end', () => resolve(Buffer.concat(chunks))); }).on('error', reject);
    });
    const md5sig = crypto.createHash('md5').update(imageBuffer).digest('hex');
    const boundary = 'BearfootBoundary' + Date.now();
    const CRLF = '\r\n';
    const headerParts = [
      `--${boundary}${CRLF}Content-Disposition: form-data; name="advertiser_id"${CRLF}${CRLF}${advertiser_id}${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="upload_type"${CRLF}${CRLF}UPLOAD_BY_FILE${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="image_signature"${CRLF}${CRLF}${md5sig}${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="image_file"; filename="cover.jpg"${CRLF}Content-Type: image/jpeg${CRLF}${CRLF}`
    ].join('');
    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(headerParts), imageBuffer, Buffer.from(footer)]);
    const result = await new Promise((resolve, reject) => {
      const opts = { hostname: 'business-api.tiktok.com', path: '/open_api/v1.3/file/image/ad/upload/', method: 'POST', headers: { 'Access-Token': CONFIG.tiktok.accessToken, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } };
      const req2 = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
      req2.on('error', reject); req2.write(body); req2.end();
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// TIKTOK OAUTH CALLBACK
app.get('/', async (req, res) => {
  const authCode = req.query.auth_code;
  if (!authCode) return res.send('<h2>Bearfoot Proxy v16 running</h2>');
  try {
    const body = JSON.stringify({ app_id: CONFIG.tiktok.appId, secret: CONFIG.tiktok.appSecret, auth_code: authCode });
    const token = await new Promise((resolve, reject) => {
      const opts = { hostname: 'business-api.tiktok.com', path: '/open_api/v1.3/oauth2/access_token/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const req2 = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
      req2.on('error', reject); req2.write(body); req2.end();
    });
    res.send('<h2>TikTok Token Exchange Result</h2><pre>' + JSON.stringify(token, null, 2) + '</pre>');
  } catch(e) { res.status(500).send('<h2>Error</h2><pre>' + e.message + '</pre>'); }
});

app.listen(process.env.PORT || 3000, () => { console.log('Bearfoot proxy v16 running'); setTimeout(keepAlive, 5000); });
