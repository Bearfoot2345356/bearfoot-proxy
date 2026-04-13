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
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const CONFIG = {
  meta: { token: process.env.META_TOKEN, adAccount: process.env.META_AD_ACCOUNT || 'act_378262932806675', pageId: process.env.META_PAGE_ID || '441555446605737', pixelId: process.env.META_PIXEL_ID || '470255323754555' },
  google: { developerToken: process.env.GOOGLE_DEVELOPER_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, refreshToken: process.env.GOOGLE_REFRESH_TOKEN, managerAccountId: process.env.GOOGLE_MANAGER_ACCOUNT_ID || '4491645864', clientAccountId: process.env.GOOGLE_CLIENT_ACCOUNT_ID || '8166793966' },
  uppromotе: { apiKey: process.env.UPPROMOTЕ_API_KEY },
  x: { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET, bearerToken: process.env.X_BEARER_TOKEN, adsAccountId: process.env.X_ADS_ACCOUNT_ID || '18ce55nt6zg' },
  shopify: { accessToken: process.env.SHOPIFY_ACCESS_TOKEN, shop: 'bearfoot-athletics.myshopify.com', apiVersion: '2024-01' },
  tiktok: { accessToken: process.env.TIKTOK_ACCESS_TOKEN, advertiserId: process.env.TIKTOK_ADVERTISER_ID || '7257567360448593921', appId: process.env.TIKTOK_APP_ID || '7622939461445222401', appSecret: process.env.TIKTOK_APP_SECRET }
};

app.get('/config', (req, res) => res.json({ meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId }, google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId } }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), version: 'v24' }));
app.post('/api/debug', (req, res) => res.json({ body: req.body, query: req.query, contentType: req.headers['content-type'] }));

const THUMB_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAFA3PE84MlBGQUZaVVBfeМiCeG5uePWvuZHI////////////////////////////2wBDAVVaWnhpeOuCguv////////////////////////////wAARCAeABDgDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAAfxAAUAQEAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwAB/9k=';
app.get('/thumbnail.jpg', (req, res) => {
  const buf = Buffer.from(THUMB_B64, 'base64');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

// GOOGLE ADS
let gToken = null, gTokenExpiry = 0;
async function getGToken() {
  if (gToken && Date.now() < gTokenExpiry) return gToken;
  const body = JSON.stringify({ client_id: CONFIG.google.clientId, client_secret: CONFIG.google.clientSecret, refresh_token: CONFIG.google.refreshToken, grant_type: 'refresh_token' });
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try { const p=JSON.parse(d); if(p.error) return reject(new Error(p.error+': '+p.error_description)); gToken=p.access_token; gTokenExpiry=Date.now()+(p.expires_in-60)*1000; resolve(gToken); } catch(e) { reject(e); } }); });
    r.on('error', reject); r.write(body); r.end();
  });
}
async function gAdsRequest(method, path, body = null) {
  const token = await getGToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'googleads.googleapis.com', path, method, headers: { 'Authorization': 'Bearer ' + token, 'developer-token': CONFIG.google.developerToken, 'login-customer-id': CONFIG.google.managerAccountId, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.post('/api/google/query', async (req, res) => {
  const { query, customerId } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  const cid = customerId || CONFIG.google.clientAccountId;
  try {
    const results = [];
    let pageToken = null;
    do {
      const body = { query };
      if (pageToken) body.pageToken = pageToken;
      const r = await gAdsRequest('POST', `/v20/customers/${cid}/googleAds:search`, body);
      if (r.error) { results.push({ error: r.error }); break; }
      results.push(r);
      pageToken = r.nextPageToken;
    } while (pageToken);
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/google/mutate', async (req, res) => {
  const { resource, operations, customerId } = req.body;
  if (!resource || !operations) return res.status(400).json({ error: 'Missing resource or operations' });
  const cid = customerId || CONFIG.google.clientAccountId;
  try {
    const r = await gAdsRequest('POST', `/v20/customers/${cid}/${resource}:mutate`, { operations });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// META ADS
async function metaRequest(method, path, body = null) {
  const token = CONFIG.meta.token;
  const baseUrl = 'https://graph.facebook.com/v20.0';
  const url = baseUrl + path + (path.includes('?') ? '&' : '?') + 'access_token=' + token;
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/meta', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await metaRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/meta', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await metaRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/meta', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await metaRequest('DELETE', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });

// META CAPI IMAGE UPLOAD
app.post('/api/meta/image-upload', async (req, res) => {
  const { image_url, name } = req.body;
  if (!image_url) return res.status(400).json({ error: 'Missing image_url' });
  try {
    const adAccountId = CONFIG.meta.adAccount;
    const token = CONFIG.meta.token;
    const bodyObj = { url: image_url, name: name || 'uploaded_image', access_token: token };
    const bodyStr = Object.entries(bodyObj).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
    const result = await new Promise((resolve, reject) => {
      const opts = { hostname: 'graph.facebook.com', path: `/v20.0/${adAccountId}/adimages`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyStr) } };
      const r = https.request(opts, res2 => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
      r.on('error', reject); r.write(bodyStr); r.end();
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SHOPIFY
async function shopifyRequest(method, path, body = null) {
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: CONFIG.shopify.shop, path: `/admin/api/${CONFIG.shopify.apiVersion}/${path}`, method, headers: { 'X-Shopify-Access-Token': CONFIG.shopify.accessToken, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const r = https.request(opts, res2 => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}
app.get('/api/shopify', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await shopifyRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/shopify', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await shopifyRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/shopify', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await shopifyRequest('DELETE', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });

// TIKTOK
async function tiktokRequest(method, path, body = null) {
  const token = CONFIG.tiktok.accessToken;
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'business-api.tiktok.com', path, method, headers: { 'Access-Token': token, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/tiktok', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await tiktokRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/tiktok', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await tiktokRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/tiktok/campaigns', async (req, res) => {
  try {
    const path = `/open_api/v1.3/campaign/get/?advertiser_id=${CONFIG.tiktok.advertiserId}&page_size=100`;
    res.json(await tiktokRequest('GET', path));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tiktok/upload-image', async (req, res) => {
  const { image_url, name } = req.body;
  if (!image_url) return res.status(400).json({ error: 'Missing image_url' });
  try {
    const body = { advertiser_id: CONFIG.tiktok.advertiserId, upload_type: 'UPLOAD_BY_URL', image_url, file_name: name || 'image' };
    res.json(await tiktokRequest('POST', '/open_api/v1.3/file/image/ad/upload/', body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// UPPROMOTE
app.get('/api/uppromote', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try {
    const result = await new Promise((resolve, reject) => {
      const opts = { hostname: 'aff-api.uppromote.com', path: '/api/v2' + decodeURIComponent(path), method: 'GET', headers: { 'X-API-KEY': process.env.UPPROMOTЕ_API_KEY, 'Content-Type': 'application/json' } };
      const r = https.request(opts, res2 => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
      r.on('error', reject); r.end();
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// X ADS (OAuth 1.0a)
function oauthSign(method, url, params, consumerKey, consumerSecret, tokenKey, tokenSecret) {
  const oauthParams = { oauth_consumer_key: consumerKey, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: Math.floor(Date.now()/1000).toString(), oauth_token: tokenKey, oauth_version: '1.0' };
  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams).sort().map(k => encodeURIComponent(k)+'='+encodeURIComponent(allParams[k])).join('&');
  const baseString = method.toUpperCase()+'&'+encodeURIComponent(url)+'&'+encodeURIComponent(sortedParams);
  const signingKey = encodeURIComponent(consumerSecret)+'&'+encodeURIComponent(tokenSecret);
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  return 'OAuth ' + Object.keys(oauthParams).sort().map(k => encodeURIComponent(k)+'="'+encodeURIComponent(oauthParams[k])+'"').join(', ');
}
async function xAdsRequest(method, path, body = null) {
  const url = 'https://ads-api.twitter.com' + path;
  const authHeader = oauthSign(method, url, {}, CONFIG.x.apiKey, CONFIG.x.apiSecret, CONFIG.x.accessToken, CONFIG.x.accessTokenSecret);
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/xads', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xAdsRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/xads', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xAdsRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

// X ORGANIC (Twitter v2)
async function xRequest(method, path, body = null) {
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const u = new URL('https://api.twitter.com' + path);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Authorization': 'Bearer ' + CONFIG.x.bearerToken, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/twitter', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await xRequest('DELETE', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });

// META CONVERSIONS API
function sha256(val) { if (!val) return null; return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex'); }
app.post('/api/capi/order', async (req, res) => {
  try {
    const order = req.body;
    const customer = order.customer || {};
    const addr = (order.billing_address || order.shipping_address || {});
    const userData = {
      em: sha256(customer.email),
      ph: sha256(customer.phone || addr.phone),
      fn: sha256(customer.first_name || addr.first_name),
      ln: sha256(customer.last_name || addr.last_name),
      ct: sha256(addr.city),
      st: sha256(addr.province_code ? addr.province_code.toLowerCase() : null),
      zp: sha256(addr.zip),
      country: sha256(addr.country_code ? addr.country_code.toLowerCase() : null),
      external_id: sha256(customer.id ? customer.id.toString() : null)
    };
    Object.keys(userData).forEach(k => { if (!userData[k]) delete userData[k]; });
    const contentIds = (order.line_items || []).map(i => (i.sku || (i.variant_id ? i.variant_id.toString() : null))).filter(Boolean);
    const eventData = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: 'order_' + order.id,
        action_source: 'website',
        event_source_url: 'https://bearfoot.store/checkouts/thank_you',
        user_data: userData,
        custom_data: {
          currency: order.currency || 'USD',
          value: parseFloat(order.total_price || 0),
          order_id: order.id.toString(),
          num_items: (order.line_items || []).length,
          content_ids: contentIds,
          content_type: 'product'
        }
      }]
    };
    const pixelId = CONFIG.meta.pixelId;
    const result = await metaRequest('POST', '/' + pixelId + '/events', eventData);
    console.log('CAPI Purchase order', order.id, ':', JSON.stringify(result));
    res.json({ ok: true, order_id: order.id, capi_result: result });
  } catch (e) {
    console.error('CAPI error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// TIKTOK OAUTH CALLBACK
app.get('/', async (req, res) => {
  const authCode = req.query.auth_code;
  if (!authCode) return res.send('<h2>Bearfoot Proxy v24 running</h2>');
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

// GOOGLE OAUTH FLOW - adds Content API scope to refresh token
app.get('/auth/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = 'https://bearfoot-proxy.onrender.com/auth/google';
  const scopes = ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/content'].join(' ');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&response_type=code&scope=' + encodeURIComponent(scopes) + '&access_type=offline&prompt=consent';
  res.redirect(url);
});

app.get('/auth/google', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('<h2>No code provided</h2>');
  try {
    const body = new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: 'https://bearfoot-proxy.onrender.com/auth/google', grant_type: 'authorization_code' }).toString();
    const result = await new Promise((resolve, reject) => {
      const opts = { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, res2 => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
      r.on('error', reject); r.write(body); r.end();
    });
    res.send('<h2>Google OAuth Complete</h2><p>Copy the refresh_token below and update GOOGLE_REFRESH_TOKEN in Render:</p><pre style="background:#000;color:#0f0;padding:20px;word-break:break-all">' + JSON.stringify(result, null, 2) + '</pre>');
  } catch(e) { res.status(500).send('<h2>Error</h2><pre>' + e.message + '</pre>'); }
});

// MERCHANT CENTER API
async function merchantRequest(method, path, body = null) {
  const token = await getGToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'shoppingcontent.googleapis.com', path: '/content/v2.1' + path, method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,1000) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/merchant', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await merchantRequest('GET', decodeURIComponent(path))); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/merchant', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await merchantRequest('POST', decodeURIComponent(path), req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

// REDDIT ADS
let redditToken = null, redditTokenExpiry = 0;
async function getRedditToken() {
  if (redditToken && Date.now() < redditTokenExpiry) return redditToken;
  const creds = Buffer.from(`${process.env.REDDIT_APP_ID}:${process.env.REDDIT_APP_SECRET}`).toString('base64');
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const opts = { hostname: 'www.reddit.com', path: '/api/v1/access_token', method: 'POST', headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BearfootProxy/1.0', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const p=JSON.parse(d); if(p.error) return reject(new Error(p.error)); redditToken=p.access_token; redditTokenExpiry=Date.now()+(p.expires_in-60)*1000; resolve(redditToken); } catch(e) { reject(e); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}
async function redditRequest(method, path, body = null) {
  const token = await getRedditToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'ads-api.reddit.com', path, method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'BearfootProxy/1.0' } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.substring(0,500) }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
app.get('/api/reddit', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await redditRequest('GET', path)); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/reddit', async (req, res) => { const path = req.query.path; if (!path) return res.status(400).json({ error: 'Missing path' }); try { res.json(await redditRequest('POST', path, req.body)); } catch(e) { res.status(500).json({ error: e.message }); } });

function keepAlive() { https.get('https://bearfoot-proxy.onrender.com/health', () => {}).on('error', () => {}); setTimeout(keepAlive, 840000); }
app.listen(process.env.PORT || 3000, () => { console.log('Bearfoot proxy v24 running'); setTimeout(keepAlive, 5000); });
