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

const TOKEN = 'EAARQ3HPftCIBQZCZCMucYRvSNC18PVBfc4V2fZBZB4pP2Ku4hefI3MUrBoeQrJG4tsZBsz38mnWvMieTDMF2g7bMSjjmAAjFsIounRiB9sbpEqZA6LtnpcptdWcWSw789MZAVdyopljt3xmcTDFptbARBU127oPVdd645djxkZBNiaM0tYCWodeU2ECvRqmFUwZDZD';

function metaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/v19.0${path}${sep}access_token=${TOKEN}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'graph.facebook.com',
      path: fullPath,
      method,
      headers: { 'Content-Type': 'application/json' }
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(process.env.PORT || 3000, () => console.log('Proxy running'));
