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

const TOKEN = 'EAARQ3HPftCIBQZBlD9qZBKtq2pwQfvZC4kiXdQnrfcnqs4HZBJ12OEv8IoYkzKldh42ZAisJbV91dTZCEEHLXCrOZCe2Sranto3XWtIWhNeFEBPPr5nLHzW3Chu67Y87jaZC9aaFDe8S6HPZCjK6xJF76meAfFso2m0u1MKsyhWKvOmicHDaXOZBPuSZCtZBiskEjAHZAG5GNpavX7xISXOHnQPV1HKuwnRRUvoLtTeQcGYcFGHQRpUr5u9EZCOx9DNWwnrsGYTzs3OcXKKBvZCj1RwMjGR';

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
